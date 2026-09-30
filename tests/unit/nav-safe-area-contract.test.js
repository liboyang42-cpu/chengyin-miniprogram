const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// 2026-08-06：主页统一到 cy-profile 共用组件后，member/index 与 userinfo 的 wxml
// 只剩一行 <cy-profile />，本文件的断言原本钉在旧结构的节点上。约束没失效、只是搬进了
// 组件 —— 用 helper 在读文件这一层展开，断言原样保留。

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

const ROOT = path.resolve(__dirname, '../..')
const { resolveMenuChrome } = require(path.join(ROOT, 'utils/nav-safe-area'))

function assertCapsuleClearance(windowWidth, menuButtonInfo) {
  const chrome = resolveMenuChrome({ windowWidth, statusBarHeight: 24 }, menuButtonInfo)
  const closeLeft = windowWidth - chrome.actionRight - 44

  assert.ok(chrome.actionTop >= 24, 'close action must stay below the status area')
  assert.ok(chrome.contentTop > chrome.actionTop, 'content must start below close action')
  assert.ok(
    closeLeft + 44 <= menuButtonInfo.left - 12,
    '44px close target must retain a 12px gap before the capsule',
  )
}

function assertSharedResolver(source, relativePath) {
  assert.match(
    source,
    /require\(['"]\.\.\/\.\.\/utils\/nav-safe-area(?:\.js)?['"]\)|require\(['"]\.\.\/\.\.\/\.\.\/utils\/nav-safe-area(?:\.js)?['"]\)/,
    `${relativePath} must use the shared capsule resolver`,
  )
  assert.match(source, /resolveMenuChrome/, `${relativePath} must calculate chrome from the resolver`)
}

function assertPublishChrome(source) {
  // class 允许带动态修饰(2026-08-09 起返回钮压在地图上/压在 sheet 上要换前景色),
  // 但必须是空格分隔的追加,slopes-backXXX 这种改名不算数;style 表达式仍然钉死。
  assert.match(source, /class="slopes-back(?:\s+[^"]*)?" style="top: \{\{chrome\.actionTop\}\}px;"/, 'publish back must use dynamic capsule top')
  // 2026-08-10 平铺:四格步骤条退役(没有步骤了)。原先由它承担的「右上角要避开胶囊」,
  // 现在归常驻的发布动作 —— 它同样固定在右上,同样必须读 chrome 的动态值,不能写死。
  // 2026-08-10 两页:顶部常驻发布按钮撤销,发布回第 2 页底部;右上角改回两格进度条,
  // 它同样必须读 chrome 的动态值来避开胶囊。
  // 2026-08-10 三改:顶部两格进度条退役(Figma 4028:13649),切页移到底部 tab。
  // 于是「右上角避开胶囊」这条在本页没有主体了 —— 顶部只剩左上角返回钮,
  // 它同样必须读 chrome 的动态值,不能写死,否则窄机/胶囊下移时会压在状态栏上。
  assert.match(source, /class="slopes-back[^"]*"[^>]*style="top: \{\{chrome\.actionTop\}\}px;"/, 'publish back button must clear the capsule')
  // 原契约锁的是「创作 / 票务两个入口都在」。2026-08-10 两个入口都换了地方,
  // 形状变了但这条保护不能丢 —— 少了任一个,用户就会卡在其中一页出不去:
  //   去票务 = 第 1 页的「票务设置」卡(底部两个图标是内容/地图视图切换,不是页签)
  //   回创作 = 第 2 页底部左槽那个 data-page="1" 的入口
  assert.match(source, /class="pd-modecard" data-page="2" bindtap="switchEditorPage"/, 'publish must retain the 票务 entry')
  // 2026-08-11:回创作那个入口从返回箭头改成文字「完成」(用户定:两页平铺、没有先后,
  // 箭头会读成"上一步",暗示一条并不存在的流程顺序)。形状又变了,保护照旧 ——
  // 只钉「有一个 data-page="1" 的 switchEditorPage 入口」,不钉它长什么样,
  // 免得下次换个说法又红一次;真正要防的是这条路被整个删掉。
  assert.match(source, /data-page="1" bindtap="switchEditorPage"/, 'ticketing page must retain a way back to 创作')
  // 2026-09-05:发布从第 2 页底部收回第 1 页底栏(删掉「预览」后那个位置空出来),
  // 文案「检查并发布」→「发布」并带箭头。这条守的是「发布入口还在、还能点到」,
  // 所以只钉 bindtap="submitForm" 这个事实,不钉文案与内部结构。
  assert.match(source, /<cy-btn[^>]*bindtap="submitForm"/, 'publish CTA must remain reachable')
}

test('P0 capsule geometry keeps the close target reachable at 375/393 widths and shifted capsules', () => {
  assertCapsuleClearance(375, { left: 278, top: 30, bottom: 62, height: 32 })
  assertCapsuleClearance(393, { left: 296, top: 31, bottom: 63, height: 32 })
  assertCapsuleClearance(393, { left: 310, top: 29, bottom: 61, height: 32 })

  const fallback = resolveMenuChrome({ windowWidth: 375, statusBarHeight: 20 }, null)
  // sheetTop:2026-08-10 新增,弹窗顶贴到「胶囊底 +5px」(比 contentTop 的 +12 更紧,
  // 因为弹窗顶那一条是抓手/留白,不放可点的东西)。
  assert.deepEqual(fallback, { actionTop: 28, actionRight: 12, contentTop: 76, sheetTop: 69 })
})

test('P0 publish and roam pages share one dynamic capsule formula', () => {
  const files = [
    'pages/publish/fabu/index.js',
    'pages/roam/index.js',
    // subpackageRoam/history/index.js 2026-08-04 移出本清单:它已收口到 cy-nav-bar + cy-page-title,
    // 胶囊避让归组件算,页面自己不再持有 chrome 常数 —— 再要求它引 resolveMenuChrome 就成了
    // 「必须手写一份用不上的公式」。仍手写导航条的页面继续受本契约约束。
  ]

  files.forEach((relativePath) => {
    assertSharedResolver(readResolved(relativePath), relativePath)
  })
  assertPublishChrome(readResolved('pages/publish/fabu/index.wxml'))
})

test('negative control: removing the resolver import makes the shared-formula guard fail', () => {
  const source = readResolved('pages/roam/index.js')
  const mutated = source.replace(/.*nav-safe-area.*\n/, '')

  assert.throws(() => assertSharedResolver(mutated, 'pages/roam/index.js'))
})

test('negative control: restoring the status-bar-only publish layout is rejected', () => {
  const source = readResolved('pages/publish/fabu/index.wxml')
  // 变异对象跟着断言走:进度条退役后,本页受契约约束的是左上角返回钮的 chrome.actionTop。
  const mutated = source.replace('chrome.actionTop', 'statusBarHeight + 18')

  assert.throws(() => assertPublishChrome(mutated))
})

test('悬浮 tabBar 页面为正文保留完整底部安全区', () => {
  const cases = [
    ['pages/member/index/index.wxss', '.pc-body', 'var(--cy-tabbar-h)'],
    ['pages/merchant/marketing/index.wxss', '.body', 'var(--cy-tabbar-h)'],
    ['pages/merchant/relation/index.wxss', '.body', 'var(--cy-tabbar-h)'],
  ]
  cases.forEach(([relativePath, selector, token]) => {
    const source = readResolved(relativePath)
    const rule = source.match(new RegExp(`${selector.replace('.', '\\.') }\\s*\\{([\\s\\S]*?)\\}`))
    assert.ok(rule, `${relativePath} must define ${selector}`)
    assert.ok(rule[1].includes(token), `${relativePath} must include tabBar clearance`)
  })
})

test('negative control: removing tabBar clearance from merchant marketing is rejected', () => {
  const source = readResolved('pages/merchant/marketing/index.wxss')
  const mutated = source.replace('var(--cy-tabbar-h)', 'var(--cy-space-5)')
  const rule = mutated.match(/\.body\s*\{([\s\S]*?)\}/)
  assert.ok(rule)
  assert.throws(() => assert.match(rule[1], /var\(--cy-tabbar-h\)/))
})
