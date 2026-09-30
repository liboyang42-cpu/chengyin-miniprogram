// 二级页导航契约。
//
// 2026-07-29 导航统一(Revolut 式)推翻了本文件的旧立论:旧契约锁的是「这批页保持系统导航、
// 只声明稳定原生标题」,而现在全站二级页统一转 navigationStyle:custom —— 返回钮在上、
// 大标题在返回钮下方。于是契约翻面成:
//
//   ① 名单内的页必须真的转成 custom(json)
//   ② 转了 custom 就没有系统返回钮了 ⇒ wxml 必须自带 cy-nav-bar,否则这一页退不出去
//   ③ 转了 custom 导航区不再占位 ⇒ 必须有让位(cy-page-title 自带 safeTop,或显式 spacer),
//      否则正文压在状态栏/胶囊底下
//   ④ 原生标题仍要留:分享卡片、从后台唤起、以及 custom 失效时的兜底都读它
//   ⑤ 标题只有一处:既转 custom 又把 title 挂回 cy-nav-bar 就是双标题
//
// 2026-07-29 ADA(WT3a)再翻一次 searchmap:它转了 custom,但**不走** cy-nav-bar +
// 大标题这一套 —— 它是全屏地图页,处方要求「只留浮动圆形返回钮、整页无色带」,
// 再压一条返回钮下大标题就是在地图上盖一块色带,与该页存在的理由相反。
// 于是它自成第三类 FULLSCREEN_MAP_NAV_PAGES,锁的是这一类真正的风险:
//   ① 转了 custom 就没系统返回钮 ⇒ 必须有页面自己的浮动返回钮 + 绑定
//   ② 返回必须可恢复:栈空时也要能出去(不能只调 navigateBack 就完事)
//   ③ 顶部让位必须由页面自己算(statusBarHeight),否则返回钮压进状态栏
//   ④ 原生标题仍要留(分享卡片/外部唤起/custom 失效兜底)
//   ⑤ 不许再挂 cy-page-title/nav title —— 那正是要拆掉的色带
// 名单摆在这里,哪天它变了,是显式改名单,不是静默漂移。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 已转 Revolut 式 custom 导航的二级页:页面路径(不含后缀) → 稳定标题
const CUSTOM_NAV_PAGES = {
  'pages/search2/index': '搜索',
  'subpackageA/pages/infomation/infomation': '城瘾玩法',
  'subpackageA/pages/infomationdetail/infomationdetail': '玩法详情',
  'pages/publish/activity/index': '发布活动',
  'pages/publish/templateadd/templateadd': '创建节点玩法',
}

const TOPICADD_REDIRECT_SHELL = 'pages/publish/topicadd/topicadd'
const DIRECT_PRO_ENTRY_CALLERS = [
  ['components/cy/publish-sheet/index.js', ["'/pages/publish/fabu/index?mode=' + this.data.selectedMode"]],
  ['pages/club/detail/index.js', ["'/pages/publish/fabu/index?clubId=' + cid + '&mode=' + mode"]],
  ['pages/merchant/marketing/index.js', ["'/pages/publish/fabu/index?mode=2&scope=MERCHANT'", "'/pages/publish/fabu/index?scope=MERCHANT'"]],
  ['subpackageA/pages/myproject/index.js', ["'/pages/publish/fabu/index'"]],
  ['pages/square/list/index.js', ["'/pages/publish/fabu/index'"]],
  ['pages/talent/list/index.js', ["'/pages/publish/fabu/index'"]],
]

// 用户明确要求只保留返回出口与正文首控件的二级页：仍需真实 nav 占位，但不画 L1 标题。
const TITLELESS_CUSTOM_NAV_PAGES = {
  'pages/square/detail/index': '动态',
  'pages/search2/result/index': '搜索结果',
  'pages/gerenziliao/gerenziliao': '个人资料',
}

// 仍留在系统导航的页(尚未纳入统一改造)。
// 现在是空的:名单空 ≠ 契约作废 —— 下面的断言与负控照跑,新页落进这一类时直接挂上来即可。
const SYSTEM_NAV_PAGES = {
}

// 全屏地图页:custom 导航 + 页面自己的浮动圆形返回钮,无大标题、无色带
const FULLSCREEN_MAP_NAV_PAGES = {
  'pages/searchmap/index': '地图搜索',
}

function assertCustomNavPage({ json, wxml }, expected, file) {
  const config = JSON.parse(json)
  assert.equal(config.navigationStyle, 'custom', `${file} 必须转成 custom 导航`)
  assert.equal(config.navigationBarTitleText, expected,
    `${file} 转 custom 后仍要留稳定原生标题(分享卡片/外部唤起读它)`)

  const components = config.usingComponents || {}
  assert.equal(components['cy-nav-bar'], '/components/cy/nav-bar/index', `${file} 必须注册 cy-nav-bar`)

  // ② 自带返回出口:custom 导航把系统返回钮一起关掉了,没有 cy-nav-bar 这一页就退不出去
  assert.match(wxml, /<cy-nav-bar[\s\S]*?(?:\/>|>)/, `${file} 转 custom 后必须自带 cy-nav-bar,否则没有返回出口`)

  // ③ 让位:cy-page-title 默认 safeTop 会让出 状态栏+导航 实高;传 false 的页必须另有 spacer
  const titleTag = wxml.match(/<cy-page-title[^>]*>/)
  const hasExplicitSpacer = /style="height: \{\{statusBarHeight \+ navBarHeight\}\}px;"/.test(wxml)
  assert.ok(titleTag || hasExplicitSpacer, `${file} 转 custom 后必须有让位(cy-page-title 或 spacer)`)
  if (titleTag && /safe-top="\{\{false\}\}"/.test(titleTag[0])) {
    assert.ok(hasExplicitSpacer,
      `${file} 的 cy-page-title 关掉了 safeTop 却没有显式 spacer,正文会压在状态栏/胶囊下`)
  }

  // ④⑤ 标题只有一处,且文案与原生标题一致
  assert.ok(titleTag, `${file} 必须有返回钮下方的大标题`)
  assert.equal(components['cy-page-title'], '/components/cy/page-title/index', `${file} 必须注册 cy-page-title`)
  const titlePattern = file === 'pages/publish/activity/index'
    ? /title="\{\{pageTitle\}\}"/
    : new RegExp(`title="${expected}"`)
  assert.match(titleTag[0], titlePattern, `${file} 大标题文案必须与原生标题一致`)
  const navTag = wxml.match(/<cy-nav-bar[\s\S]*?(?:\/>|>)/)
  assert.doesNotMatch(navTag[0], /\stitle="[^"]+"/,
    `${file} 已有返回钮下大标题,导航条上不能再挂 title(双标题)`)
}

function assertSystemNavPage({ json }, expected, file) {
  const config = JSON.parse(json)
  assert.equal(config.navigationBarTitleText, expected, `${file} must provide its stable native title`)
  assert.notEqual(config.navigationStyle, 'custom',
    `${file} 还没纳入导航统一改造,转 custom 就会失去系统返回钮而页面没有 cy-nav-bar 顶上`)
}

function assertTitlelessCustomNavPage({ json, wxml, js }, expected, file) {
  const config = JSON.parse(json)
  assert.equal(config.navigationStyle, 'custom', `${file} 必须保留 custom 导航`)
  assert.equal(config.navigationBarTitleText, expected, `${file} 仍须保留原生标题作为外部唤起兜底`)
  assert.equal(config.usingComponents['cy-nav-bar'], '/components/cy/nav-bar/index', `${file} 必须注册 cy-nav-bar`)
  const navTag = wxml.match(/<cy-nav-bar[\s\S]*?(?:\/>|>)/)
  assert.ok(navTag, `${file} 必须保留返回出口`)
  assert.doesNotMatch(navTag[0], /\stitle="[^"]+"/, `${file} 的 nav 也不能偷偷画标题`)
  assert.match(wxml, /style="height: \{\{statusBarHeight \+ navBarHeight\}\}px;"/,
    `${file} 无页标题时必须用 nav 实高占位，正文不能压进胶囊`)
  assert.doesNotMatch(wxml, /<cy-page-title\b/, `${file} 是用户点名的无标题页`)
  assert.equal(config.usingComponents['cy-page-title'], undefined, `${file} 不应保留无消费的 page-title 注册`)
  assert.match(js, /^\s*statusBarHeight:/m, `${file} 必须把状态栏高度落进 data`)
  assert.match(js, /^\s*navBarHeight:/m, `${file} 必须把导航高度落进 data`)
}

function assertFullscreenMapNavPage({ json, wxml, js }, expected, file) {
  const config = JSON.parse(json)
  // ④ 原生标题仍要留
  assert.equal(config.navigationBarTitleText, expected,
    `${file} 转 custom 后仍要留稳定原生标题(分享卡片/外部唤起读它)`)
  assert.equal(config.navigationStyle, 'custom', `${file} 必须转成 custom 导航(全屏地图不留系统色带)`)

  // ① 页面自带的浮动返回钮:custom 关掉了系统返回钮,没有它这一页退不出去
  const backTag = wxml.match(/<view class="smap-back"[\s\S]*?>/)
  assert.ok(backTag, `${file} 转 custom 后必须自带浮动返回钮 .smap-back,否则没有返回出口`)
  assert.match(backTag[0], /bindtap="goBack"/, `${file} 的浮动返回钮必须真的绑上 goBack`)

  // ③ UI-14 返修(2026-09-18):顶部整行(返回/搜索/筛选)的让位必须按微信胶囊实测值算。
  //    写死让位宽度(statusBar+8 顶边、200rpx 右让)在窄机/胶囊下移时会让筛选压住胶囊;
  //    行几何由 JS 下发,walkthrough 的返修目标就是「整行落进胶囊安全区且三件共线」。
  assert.match(wxml, /class="smapso"[^>]*style="padding-top:\{\{navTop\}\}px; padding-right:\{\{navRight\}\}px;"/,
    `${file} 顶部整行必须消费 JS 按胶囊实测值下发的几何(navTop/navRight)`)
  assert.match(js, /getMenuButtonBoundingClientRect/,
    `${file} 必须实测微信胶囊 rect 来算安全区,不能写死让位宽度`)
  assert.match(js, /resolveMenuChrome/,
    `${file} 胶囊几何必须走共享 resolver(utils/nav-safe-area.js)`)
  assert.match(js, /capsuleHeight \/ 2 - rowHeight \/ 2/,
    `${file} 行中心线必须与胶囊中心线共线,返回/搜索/筛选才在同一行垂直居中`)
  assert.match(js, /statusBarHeight: app\.globalData\.statusBarHeight \|\| 20/,
    `${file} 必须真的把 statusBarHeight 读进 data(否则离线横幅的兜底定位锁的是恒为兜底值的常量)`)

  // ② 返回可恢复:栈空(分享/扫码直达)时不能死在页面里
  assert.match(js, /goBack\(\)\s*\{[\s\S]*?wx\.navigateBack\([\s\S]*?wx\.switchTab\(/,
    `${file} 的返回必须在 navigateBack 失败时回落到根 tab,不能留死路`)

  // ⑤ 不许再有大标题/nav title —— 那就是要拆掉的色带
  assert.doesNotMatch(wxml, /<cy-page-title/, `${file} 是全屏地图页,不挂返回钮下大标题(会盖出一条色带)`)
  assert.doesNotMatch(wxml, /<cy-nav-bar/, `${file} 是全屏地图页,不走 cy-nav-bar`)
}

const sourcesOf = (page) => ({ json: read(page + '.json'), wxml: read(page + '.wxml'), js: read(page + '.js') })

function assertDirectProfessionalEntryCallers() {
  assert.equal(DIRECT_PRO_ENTRY_CALLERS.length, 6, '专业编辑入口调用方必须保持 6 个文件的完整清单')
  assert.equal(DIRECT_PRO_ENTRY_CALLERS.reduce((sum, [, destinations]) => sum + destinations.length, 0), 7,
    '专业编辑入口必须覆盖 7 处跳转(marketing 两处；工作台空态改去承接，不再直达 fabu)')
  DIRECT_PRO_ENTRY_CALLERS.forEach(([file, destinations]) => {
    const source = read(file)
    assert.doesNotMatch(source, /\/pages\/publish\/topicadd\/topicadd/,
      `${file} 不得再经过已退役的 topicadd 中间页`)
    destinations.forEach((destination) => {
      assert.ok(source.includes(destination), `${file} 必须直达 ${destination}`)
    })
  })
}

function runTopicaddRedirect(options) {
  let definition
  const redirects = []
  vm.runInNewContext(read(TOPICADD_REDIRECT_SHELL + '.js'), {
    Page(config) { definition = config },
    wx: {
      redirectTo({ url }) { redirects.push(url) },
    },
  }, { filename: TOPICADD_REDIRECT_SHELL + '.js' })
  assert.ok(definition, 'topicadd 重定向壳必须注册 Page')
  definition.onLoad(options)
  return redirects
}

test('6 个专业编辑入口(7 处跳转)全部直达 fabu', () => {
  assertDirectProfessionalEntryCallers()
})

test('topicadd 兼容壳使用 redirectTo，并原样透传 templateName/mode/clubId', () => {
  assert.deepEqual(runTopicaddRedirect({
    templateName: '夜 行&档案',
    mode: '0',
    clubId: 'club/7',
  }), ['/pages/publish/fabu/index?templateName=%E5%A4%9C%20%E8%A1%8C%26%E6%A1%A3%E6%A1%88&mode=0&clubId=club%2F7'])
  assert.deepEqual(runTopicaddRedirect({}), ['/pages/publish/fabu/index'])
})

test('二级页已转 Revolut 式 custom 导航:返回钮 + 返回钮下大标题 + 让位', () => {
  Object.entries(CUSTOM_NAV_PAGES).forEach(([page, expected]) => {
    assertCustomNavPage(sourcesOf(page), expected, page)
  })
})

test('用户点名的无标题二级页:返回钮 + 实高占位 + 不画 L1 标题', () => {
  Object.entries(TITLELESS_CUSTOM_NAV_PAGES).forEach(([page, expected]) => {
    assertTitlelessCustomNavPage(sourcesOf(page), expected, page)
  })
})

test('尚未改造的页仍保持系统导航与稳定标题', () => {
  Object.entries(SYSTEM_NAV_PAGES).forEach(([page, expected]) => {
    assertSystemNavPage(sourcesOf(page), expected, page)
  })
})

test('全屏地图页:custom 导航 + 页面自带浮动返回钮 + 无大标题色带', () => {
  Object.entries(FULLSCREEN_MAP_NAV_PAGES).forEach(([page, expected]) => {
    assertFullscreenMapNavPage(sourcesOf(page), expected, page)
  })
})

const MAP_SAMPLE = 'pages/searchmap/index'

test('negative control: 全屏地图页丢掉浮动返回钮(退不出去)必须判红', () => {
  const src = sourcesOf(MAP_SAMPLE)
  const mutated = { ...src, wxml: src.wxml.replace(/<view class="smap-back"[\s\S]*?<\/view>/, '') }
  assert.notEqual(mutated.wxml, src.wxml, '变异锚点失效(源码已改动?)')
  assert.throws(
    () => assertFullscreenMapNavPage(mutated, FULLSCREEN_MAP_NAV_PAGES[MAP_SAMPLE], MAP_SAMPLE),
    (e) => e instanceof assert.AssertionError && /必须自带浮动返回钮/.test(e.message),
    '丢掉返回钮必须由「没有返回出口」这道闸判红,不能被别的断言顺手接住',
  )
})

test('negative control: 返回只调 navigateBack 不做栈空兜底必须判红', () => {
  const src = sourcesOf(MAP_SAMPLE)
  const mutated = { ...src, js: src.js.replace(/fail: function \(\) \{ wx\.switchTab\([^)]*\)[^}]*\}/, '') }
  assert.notEqual(mutated.js, src.js, '变异锚点失效(源码已改动?)')
  assert.throws(
    () => assertFullscreenMapNavPage(mutated, FULLSCREEN_MAP_NAV_PAGES[MAP_SAMPLE], MAP_SAMPLE),
    (e) => e instanceof assert.AssertionError && /回落到根 tab/.test(e.message),
    '拆掉兜底必须由「返回可恢复」这道闸判红',
  )
})

const SAMPLE = 'pages/search2/index'
const TITLELESS_SAMPLE = 'pages/gerenziliao/gerenziliao'

test('negative control: 无标题页把旧 L1 标题加回来必须判红', () => {
  const src = sourcesOf(TITLELESS_SAMPLE)
  const mutated = { ...src, wxml: src.wxml.replace('<cy-nav-bar />', '<cy-nav-bar />\n<cy-page-title title="个人资料" />') }
  assert.notEqual(mutated.wxml, src.wxml, '变异锚点失效')
  assert.throws(() => assertTitlelessCustomNavPage(mutated, TITLELESS_CUSTOM_NAV_PAGES[TITLELESS_SAMPLE], TITLELESS_SAMPLE), /无标题页/)
})

test('negative control: custom 页丢掉 cy-nav-bar(退不出去)必须判红', () => {
  const src = sourcesOf(SAMPLE)
  const mutated = { ...src, wxml: src.wxml.replace(/<cy-nav-bar[\s\S]*?\/>/, '') }
  assert.notEqual(mutated.wxml, src.wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCustomNavPage(mutated, CUSTOM_NAV_PAGES[SAMPLE], SAMPLE), assert.AssertionError)
})

test('negative control: custom 页丢掉让位(正文压在胶囊下)必须判红', () => {
  const src = sourcesOf(SAMPLE)
  const mutated = { ...src, wxml: src.wxml.replace('<cy-page-title title="搜索" />', '<cy-page-title title="搜索" safe-top="{{false}}" />') }
  assert.notEqual(mutated.wxml, src.wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCustomNavPage(mutated, CUSTOM_NAV_PAGES[SAMPLE], SAMPLE), assert.AssertionError)
})

test('negative control: custom 页把标题挂回导航条(双标题)必须判红', () => {
  const src = sourcesOf(SAMPLE)
  const mutated = { ...src, wxml: src.wxml.replace('<cy-nav-bar', '<cy-nav-bar title="搜索"') }
  assert.notEqual(mutated.wxml, src.wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCustomNavPage(mutated, CUSTOM_NAV_PAGES[SAMPLE], SAMPLE), assert.AssertionError)
})

test('negative control: custom 页悄悄退回系统导航必须判红', () => {
  const src = sourcesOf(SAMPLE)
  const mutated = { ...src, json: src.json.replace('"navigationStyle": "custom"', '"navigationStyle": "default"') }
  assert.notEqual(mutated.json, src.json, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertCustomNavPage(mutated, CUSTOM_NAV_PAGES[SAMPLE], SAMPLE), assert.AssertionError)
})

test('negative control: an empty native title is rejected', () => {
  const src = sourcesOf(SAMPLE)
  const mutated = { ...src, json: src.json.replace('"搜索"', '""') }
  assert.throws(() => assertCustomNavPage(mutated, CUSTOM_NAV_PAGES[SAMPLE], SAMPLE), assert.AssertionError)
})

// SYSTEM_NAV_PAGES 现在是空名单,不能再拿真实页做这条负控的底本:
// searchmap 已经转 custom 了,拿它当底本会「因为名单里查不到期望标题」先炸,
// 于是这条负控看着绿、其实没验到「转 custom 必须判红」那道闸 —— 用合成夹具锁死。
const SYSTEM_NAV_FIXTURE = { json: JSON.stringify({ navigationBarTitleText: '示例页' }), wxml: '<view />' }

test('negative control: 未改造的页被转成 custom(而 wxml 没有 nav)必须判红', () => {
  // 先证明未变异的夹具是绿的,否则下面的红说明不了是变异造成的
  assertSystemNavPage(SYSTEM_NAV_FIXTURE, '示例页', 'fixture')
  const mutated = {
    ...SYSTEM_NAV_FIXTURE,
    json: JSON.stringify({ navigationStyle: 'custom', navigationBarTitleText: '示例页' }),
  }
  assert.throws(
    () => assertSystemNavPage(mutated, '示例页', 'fixture'),
    (e) => e instanceof assert.AssertionError && /还没纳入导航统一改造/.test(e.message),
    '转 custom 必须由「未改造的页不许转 custom」这道闸判红',
  )
})
