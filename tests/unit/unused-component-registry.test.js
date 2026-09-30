'use strict'

/* 零使用组件登记(2026-08-26)
 *
 * 起因:给 `cy-points` 接数字滚动,写完才发现它**全仓零调用方** —— 给没人用的组件接线是白做。
 * 顺手扫了一遍:94 个 `cy-*` 组件里有 13 个零使用。
 *
 * ⚠️ **不是一律删**。至少 `play-pause` 是**有意退役**的,`play-ui-contract` 明确
 * `assert.doesNotMatch(playWxml, /<cy-play-pause/)` 钉着不许再用 —— 删掉它反而会让
 * 那条契约失去被保护的对象。其余多数还没人说清是「待用」「已退役」还是「忘了」。
 *
 * 所以这条门禁做的是**登记**不是清理:
 *   · 新出现的零使用组件必须显式登记并写理由 —— 逼着人回答「造它干嘛」;
 *   · 已经被用起来的要从登记里删掉,否则登记会过期变成假信息。
 *
 * 判定口径:一个组件算「在用」= 有某个 json 注册了它 **且** 同目录 wxml 里真的出现了那个标签。
 * 只注册不用不算 —— 那种情况页面照样不渲染它,只是白白多一条依赖。
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const CY_DIR = path.join(ROOT, 'components/cy')
const SKIP = new Set(['node_modules', 'miniprogram_npm', 'dist'])

/* 登记表:零使用组件 → 为什么还留着。
 * ⚠️ 新增一行之前先问:这个组件是不是根本不该造?
 *    留下来的成本不只是文件,还有「以后有人给它加功能」的白工(cy-points 就是这么被我接了一半)。 */
const REGISTERED_UNUSED = {
  // 2026-09-02 导演台 10 张卡收编成 cy-club-director-*(P2-A)。这两张的触发按钮按施工文档
  // 落在**活动详情页底部主键三段**上,而那一页在另一个 PR(俱乐部活动详情 H1-H6)里 ——
  // 组件本体与合同已完工,接线是拆出去的另一件事。谁合上活动详情页,谁把 show +
  // bind:close 接上,并从这里删掉这两行。
  'play-pause': '有意退役:play-ui-contract 用 assert.doesNotMatch 钉着不许再出现在 play/roam',
  'city-card': '待判(2026-08-26 扫出)。⚠️ #849 曾把它的进度条改成 scaleX —— 改的是死代码',
  'level-progress': '待判(2026-08-26 扫出)。⚠️ 同上,#849 改过它的进度条',
  'points': '待判(2026-08-26 扫出)。数字滚动本想接它,发现零调用后撤销',
  'divider': '待判(2026-08-26 扫出)',
  'node': '待判(2026-08-26 扫出)',
  'section-header': '待判(2026-08-26 扫出)',
  'work-item': '待判(2026-08-26 扫出)',
  // 2026-09-02:客户系统 P2-B(feature/xcx-club-customers-0902)。J2「主题内客户」是
  // T3 全屏弹窗,入口是**活动详情页**(pages/club/topic-detail)的「客户」圆钮 ——
  // 那页归并行分支 feature/xcx-club-topic-detail-0902(PR #985),两边同时改必冲突,
  // 所以组件先交付、接线放到两个 PR 都合进 master 之后做。
  // 接上后要把本行删掉(登记表不许过期,另有契约钉着)。
  'scene-topic-customers': '2026-09-02:等 PR #985 活动详情页合并后由「客户」圆钮接线',
  'identity-tag': '2026-09-12 审核收口删旧 talent/search 后零调用;本体仍有 identity-tag-contract,有名字旁身份标签的页再接',
  // 2026-09-02:P2-A 导演台收编(feature/xcx-club-game-director-fold-0902)。这 8 个组件是
  // pages/club/game-director 的 10 张卡收编成的可复用组件/弹窗,按设计交给并行在做的
  // feature/xcx-club-topic-detail-0902(活动详情页)引用——那条分支不在本 PR 里,故此刻零调用方。
  // 待活动详情页接线后从本登记表删除。
  // 2026-09-02:P2-A 主题内弹窗五件套,由活动详情页的四圆钮唤起。详情页本身在另一个并行分支
  // (feature/xcx-club-topic-detail-0902)开发,按施工须知本 PR 不碰那个页面 —— 接线在那条分支完成。
  'club-topic-merchants': '待接线(2026-09-02):宿主是并行分支的活动详情页,本 PR 只交付组件',
  'club-topic-settings': '待接线(2026-09-02):宿主是并行分支的活动详情页,本 PR 只交付组件',
  'club-topic-groupcode': '待接线(2026-09-02):宿主是并行分支的活动详情页,本 PR 只交付组件',
  'club-topic-onboarding': '待接线(2026-09-02):宿主是并行分支的活动详情页,本 PR 只交付组件',
  // 2026-09-02:J2「客户 · 主题内」T3 全屏弹窗,宿主是正在并行重做的活动详情页(H3/H4)。
  // 那一页归另一条分支,两边同时改会撞;组件先落地并自带契约测试,活动详情页合并后由它接上
  // <cy-scene-topic-customers show topic-id bind:close>,那时这一条要从本表删掉。
  'club-publish-sheet': 'G1 发布 · 三选一(T1,2026-09-02 按 Figma 落地)。仓库里还没有一个'
    + '「俱乐部端发布入口」页面拥有触发它的按钮 —— pages/club/workbench 只是转到 club/detail 的历史深链'
    + '兜底壳,pages/publish/fabu 是另一模块的大文件、不在本次改动范围。谁拥有「发布」入口按钮,谁接上'
    + 'show + bind:choose(={key:"city"|"explore"|"event"})并从这里删掉这一行。',
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) walk(full, acc)
    else if (/\.json$/.test(e.name)) acc.push(full)
  }
  return acc
}

/* ⚠️ 扫描逻辑参数化,负控喂内存 —— **测试不能往仓库里写探针目录**。
   本仓单测并发跑,动作台账等扫描器同时在遍历目录,临时建出来的探针会被它们看见,
   把无关用例带红(2026-08-26 在另一条门禁上实测踩过)。 */
function usedFromPairs(pairs) {
  const used = new Set()
  for (const pair of pairs) {
    const uc = pair.usingComponents
    if (!uc) continue
    for (const [tag, target] of Object.entries(uc)) {
      if (typeof target !== 'string') continue
      if (!new RegExp('<' + tag + '[\\s/>]').test(pair.markup || '')) continue
      used.add(path.normalize(target.startsWith('/')
        ? path.join(ROOT, target)
        : path.resolve(pair.dir, target)))
    }
  }
  return used
}

function repoPairs() {
  const pairs = []
  for (const jsonFile of walk(ROOT)) {
    let parsed
    try {
      parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
    } catch (e) {
      continue // 不是合法 json 的(比如带注释的配置)跳过,不影响判定
    }
    if (!parsed || !parsed.usingComponents) continue
    const wxml = jsonFile.replace(/\.json$/, '.wxml')
    pairs.push({
      dir: path.dirname(jsonFile),
      usingComponents: parsed.usingComponents,
      markup: fs.existsSync(wxml) ? fs.readFileSync(wxml, 'utf8') : '',
    })
  }
  return pairs
}

/** 真正在用的组件目录集合(只读仓库) */
function usedComponentDirs() {
  return usedFromPairs(repoPairs())
}

function scanUnused() {
  const used = usedComponentDirs()
  return fs.readdirSync(CY_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !used.has(path.normalize(path.join(CY_DIR, name, 'index'))))
    .sort()
}

test('扫描分母正常:cy 组件目录必须都被看到', () => {
  const all = fs.readdirSync(CY_DIR, { withFileTypes: true }).filter((e) => e.isDirectory())
  assert.ok(all.length > 50, '只扫到 ' + all.length + ' 个组件,扫描根多半错了')
})

test('新出现的零使用组件必须显式登记 —— 造它之前先回答「造它干嘛」', () => {
  const unused = scanUnused()
  const unregistered = unused.filter((name) => !REGISTERED_UNUSED[name])
  assert.deepEqual(unregistered, [],
    '这些组件没有任何页面在用,却也没登记理由:\n  ' + unregistered.join('\n  ') +
    '\n要么接上调用方,要么在 REGISTERED_UNUSED 里写明为什么留着。')
})

test('登记表不许过期 —— 已经用起来的要从表里删掉,否则登记会变成假信息', () => {
  const unused = new Set(scanUnused())
  const stale = Object.keys(REGISTERED_UNUSED).filter((name) => !unused.has(name))
  assert.deepEqual(stale, [],
    '这些组件已经有人用了,请从 REGISTERED_UNUSED 删掉:\n  ' + stale.join('\n  '))
})

test('负控:注册了但 wxml 没用,必须仍算「零使用」', () => {
  // 全内存,不碰磁盘
  const used = usedFromPairs([{
    dir: path.join(ROOT, 'pages/probe'),
    usingComponents: { 'cy-probe': '/components/cy/__probe__/index' },
    markup: '<view>页面注册了它,但一个标签都没用</view>',
  }])
  assert.equal(used.size, 0, '只注册不使用被当成了「在用」—— 页面照样不渲染它')

  const used2 = usedFromPairs([{
    dir: path.join(ROOT, 'pages/probe'),
    usingComponents: { 'cy-probe': '/components/cy/__probe__/index' },
    markup: '<cy-probe />',
  }])
  assert.equal(used2.size, 1, '真的用了标签就必须算「在用」')
})
