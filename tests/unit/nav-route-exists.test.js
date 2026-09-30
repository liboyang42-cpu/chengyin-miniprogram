const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

/**
 * 导航目标页面必须真实存在于 app.json。
 *
 * 为什么要有这道门禁:2026-08-07 主包瘦身把 19 个页面目录搬进分包
 * (pages/member/order → subpackageMember/order 等)。此前**没有任何东西**检查
 * `wx.navigateTo({url:'/pages/...'})` 指向的页面还在不在 —— 死链门禁管的是
 * wxml 的事件绑定有没有对应方法,管不到导航目标。
 *
 * 而这类断裂的表现是「点了没反应」:navigateTo 到不存在的页面会 fail,
 * 绝大多数调用点没写 fail 回调 ⇒ 用户侧静默、日志里也没有,
 * 跟 memory 里「{ok:true} ≠ 真跳过去了」是同一类坑。
 *
 * ⚠️ 它守的是「路径存在」,不是「跳过去好用」—— 后者静态检查证明不了。
 */

const ROOT = path.resolve(__dirname, '../..')
// 只看页面路径:/pages/xxx 或 /subpackageXxx/yyy。/api/... 之类一律不是导航目标。
// url 是 wx API 常用字段；path/focusPath 是搜索等导航数据的真实消费入口。
const PAGE_TARGET = /\b(url|path|focusPath)\s*:\s*(['"`])(\/(?:pages|subpackage[A-Za-z0-9]*)\/[^'"`]*)/g
const SKIP_DIRS = new Set(['node_modules', 'miniprogram_npm', '.git', '.serena', 'docs', 'scripts', '.mcp-artifacts', '.impeccable'])
const EXPECTED_DYNAMIC_NAV = []

function knownRoutes() {
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'))
  const out = new Set(app.pages.map(p => '/' + p))
  for (const sub of app.subPackages || app.subpackages || []) {
    for (const p of sub.pages) out.add(`/${sub.root.replace(/\/$/, '')}/${p}`)
  }
  return out
}

function sourceFiles() {
  const out = []
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue }
      if (/\.(js|wxml)$/.test(e.name)) out.push(path.join(dir, e.name))
    }
  }
  walk(ROOT)
  return out
}

/** @returns {{hits: Array, dynamic: Array}} hits=可静态判定的;dynamic=拼接的,必须进显式盘点 */
function collect(sources) {
  const hits = [], dynamic = []
  const entries = sources || sourceFiles().map((file) => ({
    rel: path.relative(ROOT, file),
    source: fs.readFileSync(file, 'utf8'),
  }))
  for (const { rel, source } of entries) {
    if (rel.startsWith('tests/')) continue
    source.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|<!--)/.test(line)) return   // 注释里的旧路径不算(搬迁说明会提到)
      for (const m of line.matchAll(PAGE_TARGET)) {
        const field = m[1]
        const raw = m[3]
        const route = raw.split('?')[0]
        const concatenated = /['"`]\s*\+/.test(line.slice(m.index))
        // 查询参数可以动态,但路由 path 必须能静态回读；只把 path 本身拼接的列入盘点。
        if (route.includes('${') || (!raw.includes('?') && concatenated)) {
          dynamic.push({ rel, line: i + 1, field, raw })
          continue
        }
        hits.push({ rel, line: i + 1, field, route })
      }
    })
  }
  return { hits, dynamic }
}

function assertRoutesExist(routes, hits) {
  const dead = hits.filter(h => !routes.has(h.route))
    .map(h => `${h.rel}:${h.line} ${h.field} → ${h.route}`)
  assert.deepEqual(dead, [],
    '导航指向了 app.json 里不存在的页面 —— 用户点了没反应,且线上零告警')
}

function dynamicKey(item) {
  return `${item.rel}:${item.field}:${item.raw}`
}

function assertDynamicInventory(dynamic, expected = EXPECTED_DYNAMIC_NAV) {
  assert.deepEqual(dynamic.map(dynamicKey).sort(), expected.slice().sort(),
    '动态导航清单发生漂移 —— 新增/改动须人工核对目标并更新显式盘点')
}

test('所有静态导航目标都在 app.json 里真实存在', () => {
  const routes = knownRoutes()
  const { hits } = collect()
  assertRoutesExist(routes, hits)
})

test('这道门禁确实扫到了导航调用(不是零命中的橡皮图章)', () => {
  const { hits } = collect()
  assert.ok(hits.length > 50,
    `只扫到 ${hits.length} 处导航,正则或扫描范围多半失效了 —— 那这条测试恒绿等于没有`)
})

test('动态拼接的导航路径逐条列出,不静默放过', () => {
  const { dynamic } = collect()
  assertDynamicInventory(dynamic)
})

test('negative control：url/path/focusPath 坏路径必须经真实 source scanner 判红', () => {
  const routes = knownRoutes()
  for (const field of ['url', 'path', 'focusPath']) {
    const { hits } = collect([{
      rel: `fixtures/${field}.js`,
      source: `const target = { ${field}: '/pages/this-page-does-not-exist/index' }`,
    }])
    assert.equal(hits.length, 1, `${field} 坏路径必须先被 source scanner 命中`)
    assert.throws(() => assertRoutesExist(routes, hits), {
      name: 'AssertionError',
      message: /导航指向了 app\.json 里不存在的页面/,
    })
  }
})

test('negative control：未盘点的模板串导航必须判红', () => {
  const { dynamic } = collect([{
    rel: 'fixtures/template.js',
    source: 'const target = { url: `/pages/member/${memberId}` }',
  }])
  assert.equal(dynamic.length, 1, '模板串必须先被 source scanner 命中')
  assert.throws(() => assertDynamicInventory(dynamic, []), {
    name: 'AssertionError',
    message: /动态导航清单发生漂移/,
  })
})

test('negative control：搬迁前的旧路径必须判红', () => {
  const routes = knownRoutes()
  // 这两个是 2026-08-07 真的搬走了的,拿它们当哨兵:哪天有人把页面搬回主包又忘了这里,也会红
  for (const old of ['/pages/member/order/order', '/pages/roam/session/index']) {
    assert.equal(routes.has(old), false, `${old} 应该已经搬进分包了`)
  }
})

test('退役孤儿页不得重新注册', () => {
  const routes = knownRoutes()
  const retired = [
    '/pages/activity/official-publish/index',
    '/pages/hezuozhe/hezuozhe',
    '/subpackageTemplate/topicdetail/index',
    // 2026-09-06 三端审核孤儿页清理(#10-2):
    '/pages/explore/index',
    '/pages/play/stopwatch/play/index',
    '/pages/merchant/discover/index',
    '/pages/club/dissolution-blockers/index',
    '/pages/publish/biaoqian/biaoqian',
  ]
  for (const route of retired) {
    assert.equal(routes.has(route), false, `${route} 已退役，不应重新注册`)
  }
})

// 2026-09-06 孤儿页负控(三端审核 §10-2):这条门禁原来只拦「跳不存在的路由」,拦不住「页存在但没人跳」——
// 09-05 日报里 settlement / topic-story 两页造好即孤儿就是这么漏的。现在反向断言:app.json 里每一页
// 都得有至少一处静态可读的运行时跳转,或者在下面显式豁免表里说清为什么没有。
const ORPHAN_EXEMPT = new Map([
  // 刻意保留的深链/兼容壳(分享链接、扫码、旧路由),站内不再有人 navigateTo
  ['/pages/club/workbench/index', '历史深链壳,转 club/detail'],
  ['/pages/agreement/index', '协议深链页,站内用 agreement-sheet'],
  ['/pages/coop/withdraw/records/index', '旧提现记录路由壳,redirect 到 tixianjilu'],
  // 2026-09-15 收款模型定稿 §3:平台不打款,俱乐部结算页原来唯一指向这里的 navigateTo 撤掉了。
  // 本页留着当历史路由壳(旧分享链接/旧扫码仍会落到它):唯一动作已改成弹平台客服微信。
  ['/pages/coop/withdraw/index', '旧提现入口路由壳,唯一动作改为弹平台客服微信'],
  ['/pages/merchant/profile/index', '旧商家主页路由壳'],
  ['/pages/publish/topicadd/topicadd', '旧发布路由壳,2026-10 到期删(见 topicadd.js:19)'],
  // 已知孤儿,待接线/拍板(三端审核清单 §7):接上后从这里删掉
  // 2026-09-17 B-06 曾把 pricing/partner 整页退役(全仓零入口);2026-09-19 批复1-a=2 裁决复活并
  // 接进定价页「合作阵容」(pricing/index.js goPartner)——页有真实入口,不再需要豁免条目。
  ['/pages/play/circle/index', '退役兼容壳:圈层 2026-08-29 退役,旧分享兜底,2026-12-31 到期删(见 circle/index.js 顶部排期)'],
  ['/pages/publish/simple/index', '待拍板:AI 简易发布页,2026-09-06 本契约首次抓出全仓零跳转(创建入口只到 fabu/temp)'],
  // 2026-09-22 Phase 0 立体藏品卡闸口页:走查用的实验室页,站内不给入口(卡好不好看还没拍板),
  // 真机录屏与截图矩阵 F89 都靠编译模式直达。Phase 1/2 把 objectCard 接进玩法后从这里删掉。
])

// 门禁本体:注册页 − 被跳到的页(排除页面自身目录的自引用与 scene-registry 宿主) − 豁免表
function orphansOf(routes, hits, exempt) {
  const reached = new Set(hits.filter((h) => !('/' + h.rel).startsWith(h.route.replace(/\/[^/]+$/, '/'))).map((h) => h.route))
  const registry = fs.readFileSync(path.join(ROOT, 'utils/scene-registry.js'), 'utf8')
  for (const m of registry.matchAll(/route:\s*'(\/[^']+)'/g)) reached.add(m[1])
  return {
    orphans: [...routes].filter((r) => !reached.has(r) && !exempt.has(r)),
    staleExempt: [...exempt.keys()].filter((r) => routes.has(r) && reached.has(r)),
  }
}

test('app.json 每一页至少有一处运行时跳转指向它,否则必须在豁免表里写明原因(孤儿页负控)', () => {
  const { orphans, staleExempt } = orphansOf(knownRoutes(), collect().hits, ORPHAN_EXEMPT)
  assert.deepEqual(orphans, [], '这些页面注册了但全仓没有任何静态跳转指向它(页存在没人跳 = 造了白造):\n  ' + orphans.join('\n  '))
  assert.deepEqual(staleExempt, [], '这些豁免项已经有人跳了,把它从豁免表删掉:\n  ' + staleExempt.join('\n  '))
})

test('负控:把一页的唯一跳转拿掉,孤儿页负控必须变红', () => {
  const routes = knownRoutes()
  const { hits } = collect()
  const target = '/pages/club/customer-detail/index'
  assert.ok(routes.has(target))
  assert.deepEqual(orphansOf(routes, hits, ORPHAN_EXEMPT).orphans, [], '基线本身必须是绿的,负控才有意义')
  const mutated = orphansOf(routes, hits.filter((h) => h.route !== target), ORPHAN_EXEMPT)
  assert.deepEqual(mutated.orphans, [target], '拿掉跳转后必须被判成孤儿')
})
