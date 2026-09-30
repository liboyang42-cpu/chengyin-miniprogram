// 2026-08-07 用户明确把注销改为弹窗；独立路由只保留深链兼容壳，
// shezhi 仍是它的真实 caller，入口改为 openScene('settings-deregister')。
// 「fallback 必须指向真打开它的那一页」这条判据不变。
// C03-R5:截图主导的修复守卫。判据真源:vault C03 优化文档 §11.7 裁决表。
//
// 只守「源码里证到的缺陷」:
//  ① deregister 请求失败时 js 会 setData({status:'ERROR'}),但 WXML 没有 ERROR 分支
//     ⇒ 失败被渲染成**永久转圈**(静默失败)。必须有显式错误态 + 重试。
//  ② deregister / addressinfo 用裸 <cy-nav-bar /> 且无 onBack ⇒ 栈深 1 时箭头是死控件。
//     必须接管并回落到各自真实 caller 的无参路由。
//  ③ infomationdetail 在「错误态 + 栈深 1 直达」下返回必须可用(R3 已实现,本轮钉住防回退)。
//
// 不守的:S1 保存可见性、08 顶部态 —— 源码分析未发现缺陷,记为需重采复位(§11.8),
// 不写断言去锁一个未证实的结论。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '')

let sandbox

beforeEach(() => {
  sandbox = { requests: [], toasts: [], navBacks: [], switchTabs: [], redirects: [], navigates: [], modals: [] }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: { left: 300 } },
    tips: (m) => sandbox.toasts.push(m),
    sendRequest: (o) => { sandbox.requests.push(o) },
    getRequestErrorMessage: (r, f) => (r && r.msg) || f || '未知错误',
    getPageSize: () => 10,
    getUserID: () => 1,
    recordConsent: () => Promise.resolve(),
  })
  global.Page = (c) => { sandbox.pageConfig = c }
  global.Component = (c) => { sandbox.componentConfig = c }
  global.wx = {
    showToast: (o) => sandbox.toasts.push(o && o.title),
    showModal: (o) => sandbox.modals.push(o),
    hideLoading() {}, showLoading() {},
    navigateTo: (o) => sandbox.navigates.push(o && o.url),
    navigateBack: (o) => sandbox.navBacks.push(o || {}),
    switchTab: (o) => sandbox.switchTabs.push(o && o.url),
    redirectTo: (o) => sandbox.redirects.push(o && o.url),
    reLaunch: (o) => sandbox.navigates.push(o && o.url),
    setNavigationBarTitle() {}, stopPullDownRefresh() {},
    getWindowInfo: () => ({ windowWidth: 375 }),
    getSystemInfoSync: () => ({ windowWidth: 375 }),
  }
})

function loadPage(rel) {
  const abs = path.join(ROOT, rel)
  delete require.cache[require.resolve(abs)]
  require(abs)
  const vm = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() },
  })
  vm.data = JSON.parse(JSON.stringify(sandbox.pageConfig.data || {}))
  return vm
}

function loadComponent(rel) {
  const abs = path.join(ROOT, rel)
  delete require.cache[require.resolve(abs)]
  delete require.cache[require.resolve(path.join(ROOT, DEREG_FLOW_JS))]
  require(abs)
  const vm = Object.assign({}, sandbox.componentConfig.methods, {
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() },
  })
  vm.data = JSON.parse(JSON.stringify(sandbox.componentConfig.data || {}))
  return vm
}

const req = (url) => sandbox.requests.find((r) => r.url === url)

/* ---------- ① deregister:失败不得渲染成永久转圈 ---------- */

const DEREG_JS = 'pages/deregister/index.js'
const DEREG_SCENE_JS = 'components/cy/scene-settings-deregister/index.js'
const DEREG_WXML = 'pages/deregister/index.wxml'
const DEREG_SCENE_WXML = 'components/cy/scene-settings-deregister/index.wxml'
const DEREG_FLOW_JS = 'utils/deregister-flow.js'

test('① status 接口失败 ⇒ 落 ERROR 态(行为)', () => {
  const vm = loadComponent(DEREG_SCENE_JS)
  vm.loadStatus()
  req('/api/user/deregister/status').fail()
  assert.equal(vm.data.status, 'ERROR')
})

test('① precheck 接口失败 ⇒ 落 ERROR 态(行为)', () => {
  const vm = loadComponent(DEREG_SCENE_JS)
  vm.loadStatus()
  req('/api/user/deregister/status').success({ code: 200, data: { status: 'NORMAL' } })
  req('/api/user/deregister/precheck').fail()
  assert.equal(vm.data.status, 'ERROR')
})

test('① WXML 必须有显式 ERROR 分支,不能让 ERROR 掉进 wx:else 的 loading', () => {
  const wxml = stripComments(read(DEREG_SCENE_WXML))
  assert.match(wxml, /status === 'ERROR'/,
    "js 会 setData({status:'ERROR'}),WXML 却没有该分支 ⇒ 失败被画成永久转圈(静默失败)")
  // loading 兜底必须排在 ERROR 之后,且 ERROR 不得复用 loading 的转圈语义
  const errIdx = wxml.indexOf("status === 'ERROR'")
  const loadingIdx = wxml.indexOf('kind="loading"')
  assert.ok(errIdx > -1 && loadingIdx > -1 && errIdx < loadingIdx,
    'ERROR 分支必须在 loading 兜底之前,否则永远命中不到')
})

test('① ERROR 态必须给可重试入口(不是死胡同)', () => {
  const wxml = stripComments(read(DEREG_SCENE_WXML))
  const seg = wxml.slice(wxml.indexOf("status === 'ERROR'"))
  assert.match(seg.slice(0, 400), /bind:retry|bindtap="loadStatus"|retryLoad/,
    'ERROR 态必须能重试')
  const vm = loadComponent(DEREG_SCENE_JS)
  assert.equal(typeof vm.loadStatus, 'function', '重试要落到真实的重新核验方法上')
})

test('① 重试真的会重新发起核验请求(行为)', () => {
  const vm = loadComponent(DEREG_SCENE_JS)
  vm.loadStatus()
  req('/api/user/deregister/status').fail()
  assert.equal(vm.data.status, 'ERROR')
  sandbox.requests.length = 0
  vm.loadStatus()
  assert.ok(req('/api/user/deregister/status'), '重试必须重新打 status 接口')
})

test('① 不得伪造 eligibility:失败路径不许把 status 写成 ELIGIBLE/PENDING', () => {
  const src = read(DEREG_FLOW_JS)
  const fails = src.match(/fail:\s*\(\)\s*=>[^,\n]*/g) || []
  assert.ok(fails.length >= 2, '两个核验请求都应有 fail 分支')
  for (const f of fails) {
    assert.doesNotMatch(f, /ELIGIBLE|PENDING/, `失败分支不得伪造可注销态:${f}`)
  }
})

/* ---------- ② 栈深 1 时返回必须可用(deregister / addressinfo) ---------- */

const BACK_PAGES = [
  {
    name: 'deregister',
    js: DEREG_JS, wxml: DEREG_WXML,
    api: 'redirectTo', url: '/pages/shezhi/shezhi',
    caller: 'pages/shezhi/shezhi.js', callerPat: /openScene\('settings-deregister'\)/,
  },
  {
    name: 'addressinfo',
    js: 'pages/addressinfo/addressinfo.js', wxml: 'pages/addressinfo/addressinfo.wxml',
    api: 'redirectTo', url: '/pages/address/address',
    caller: 'pages/address/address.js', callerPat: /\/pages\/addressinfo\/addressinfo/,
  },
]

for (const p of BACK_PAGES) {
  test(`② ${p.name} 接管返回(custom-back + bind:back),且不靠隐藏箭头假修`, () => {
    const wxml = stripComments(read(p.wxml))
    assert.match(wxml, /<cy-nav-bar[^>]*custom-back/)
    assert.match(wxml, /<cy-nav-bar[^>]*bind:back="onBack"/)
    assert.doesNotMatch(wxml, /<cy-nav-bar[^>]*back="\{\{false\}\}"/, '不得隐藏箭头')
  })

  test(`② ${p.name} onBack:navigateBack 失败回落 ${p.api} ${p.url}(行为)`, () => {
    const vm = loadPage(p.js)
    assert.equal(typeof vm.onBack, 'function')
    vm.onBack()
    assert.equal(sandbox.navBacks.length, 1)
    const opts = sandbox.navBacks[0]
    assert.equal(typeof opts.fail, 'function', '没有 fail 兜底 ⇒ 栈深 1 时箭头仍是死的')
    opts.fail()
    const bucket = p.api === 'switchTab' ? sandbox.switchTabs : sandbox.redirects
    assert.deepEqual(bucket, [p.url])
  })

  test(`② ${p.name} 的 fallback 必须无参,且指向真实 caller 所在页`, () => {
    assert.doesNotMatch(p.url, /\?/, 'fallback 不得带 query')
    assert.match(read(p.caller), p.callerPat, `${p.caller} 仍应是 ${p.name} 的真实 caller`)
  })
}

/* ---------- ③ infomationdetail:错误态 + 栈深 1 直达时返回可用(防回退) ---------- */

test('③ infomationdetail 无 id 直达 ⇒ 错误态,且返回仍可用回落到玩法列表(行为)', () => {
  const vm = loadPage('subpackageA/pages/infomationdetail/infomationdetail.js')
  vm.onLoad({})                       // 无 id = 真实直达/深链形态,不编造 query
  assert.equal(vm.data.missing, true, '无 id 应落参数缺失态(零假重试,不与网络/业务失败混为一谈)')
  assert.equal(vm.data.loading, false, '参数缺失态不得同时停在 loading')
  vm.onBack()
  const opts = sandbox.navBacks[0]
  assert.equal(typeof opts.fail, 'function')
  opts.fail()
  assert.deepEqual(sandbox.redirects, ['/subpackageA/pages/infomation/infomation'])
})

/* ---------- ⑤ R6:整链必须有最终出口(详情 → 列表 → 设置) ----------
 *
 * 独立审查发现的真死链:infomationdetail 栈首返回会 redirectTo 玩法列表,
 * 而 redirectTo **本身就把新页放在栈首**;列表页当时是裸 <cy-nav-bar /> 且无 onBack
 * ⇒ 组件内 onBack 在栈深 1 时不动 ⇒ 用户被停在列表页,箭头点了没反应。
 * 链路:infomationdetail.js:114-117 → infomation.wxml:2 → cy-nav-bar/index.js onBack。
 * R6 只补列表页这一环:回落到源码里唯一真实 caller shezhi.js:93 所在的设置页
 * (设置页自身已有 member tab 兜底,于是整链有终点)。 */

const INFO_LIST_JS = 'subpackageA/pages/infomation/infomation.js'
const INFO_LIST_WXML = 'subpackageA/pages/infomation/infomation.wxml'
const INFO_DETAIL_JS = 'subpackageA/pages/infomationdetail/infomationdetail.js'

test('⑤ 玩法列表接管返回(它是详情页 fallback 的落点,栈首时必须还能走)', () => {
  const wxml = stripComments(read(INFO_LIST_WXML))
  assert.match(wxml, /<cy-nav-bar[^>]*custom-back/)
  assert.match(wxml, /<cy-nav-bar[^>]*bind:back="onBack"/)
  assert.doesNotMatch(wxml, /<cy-nav-bar[^>]*back="\{\{false\}\}"/, '不得隐藏箭头')
})

test('⑤ 玩法列表 onBack 回落设置页(由 sceneStack 统一承载玩法入口)', () => {
  const vm = loadPage(INFO_LIST_JS)
  assert.equal(typeof vm.onBack, 'function')
  vm.onBack()
  const opts = sandbox.navBacks[0]
  assert.equal(typeof opts.fail, 'function', '没有 fail 兜底 ⇒ 栈首仍是死箭头')
  opts.fail()
  assert.deepEqual(sandbox.redirects, ['/pages/shezhi/shezhi'])
  assert.match(read('pages/shezhi/shezhi.js'),
    /navigateTo\(\{ url: '\/subpackageA\/pages\/infomation\/infomation' \}\)/,
    'shezhi 必须仍是玩法入口的真实 caller')
  assert.match(read('utils/scene-registry.js'), /'settings-how-to-play':\s*\{[^}]*route:\s*'\/subpackageA\/pages\/infomation\/infomation'/,
    'scene registry 必须保留玩法列表真实 route')
})

test('⑤ 整链负控:详情(栈首) → 列表(栈首) → 设置,每一跳都不能停住', () => {
  // 第一跳:详情栈首返回 → 落列表
  const detail = loadPage(INFO_DETAIL_JS)
  detail.onBack()
  sandbox.navBacks[0].fail()
  assert.deepEqual(sandbox.redirects, ['/subpackageA/pages/infomation/infomation'],
    '详情栈首返回应落玩法列表')

  // 第二跳:列表也是 redirectTo 进来的 ⇒ 同样栈深 1,必须还能继续往外走
  sandbox.navBacks.length = 0
  sandbox.redirects.length = 0
  const list = loadPage(INFO_LIST_JS)
  list.onBack()
  assert.equal(sandbox.navBacks.length, 1, '列表页必须也尝试 navigateBack')
  sandbox.navBacks[0].fail()
  assert.deepEqual(sandbox.redirects, ['/pages/shezhi/shezhi'], '列表栈首返回应落设置页')

  // 终点:设置页自身已有 tab 兜底 ⇒ 整链有出口
  sandbox.navBacks.length = 0
  sandbox.switchTabs.length = 0
  const shezhi = loadPage('pages/shezhi/shezhi.js')
  shezhi.onBack()
  sandbox.navBacks[0].fail()
  assert.deepEqual(sandbox.switchTabs, ['/pages/member/index/index'], '设置页必须能落到 tab')
})

/* ---------- ④ S1:资料页「保存」必须在顶部与滚到底两种状态都可见/可达 ----------
 *
 * 总控重开图确认:02(顶部)有白色保存栏,S1_scroll_bottom **完全没有保存栏** ⇒ 确认失败。
 * 源码定位到的机制:.bmbottom 是 position: fixed 但**没有任何 z-index**,
 * 是本队列里唯一一个不带层级的固定栏 —— 同队列 address / addressinfo 的底栏都走
 * cy-footer-bar(z-index: var(--cy-z-nav)=90)。无层级的 fixed 元素不参与既定层叠顺序,
 * 滚动后可被后续绘制内容盖掉/丢掉,这正是它消失而另两页不消失的差别所在。
 * ⇒ 收编到同队列同功能范式 cy-footer-bar(带 z-index + 安全区 + 页边距),不再自造底栏。 */

const GZ_WXML = 'pages/gerenziliao/gerenziliao.wxml'
const GZ_WXSS = 'pages/gerenziliao/gerenziliao.wxss'
const GZ_JSON = 'pages/gerenziliao/gerenziliao.json'

test('④ 保存动作必须落在带层级的固定底栏里(收编 cy-footer-bar,与队列内 address/addressinfo 同范式)', () => {
  const wxml = stripComments(read(GZ_WXML))
  assert.match(wxml, /<cy-footer-bar>[\s\S]*?<cy-btn[^>]*bindtap="saveInfo"[\s\S]*?<\/cy-footer-bar>/,
    '保存必须包在 cy-footer-bar 内 —— 它带 z-index/安全区/页边距,自造裸 fixed 栏会在滚动后丢失')
  assert.match(read(GZ_JSON), /"cy-footer-bar"/, 'json 必须注册 cy-footer-bar')
})

test('④ 不得再留没有 z-index 的自造固定底栏(S1 消失的直接机制)', () => {
  const wxss = read(GZ_WXSS)
  const bar = /\.bmbottom\s*\{([^}]*)\}/.exec(wxss)
  if (bar) {
    assert.match(bar[1], /z-index/,
      '.bmbottom 若保留,必须显式给 z-index;裸 fixed 无层级会在滚动后被盖/丢')
  } else {
    assert.doesNotMatch(stripComments(read(GZ_WXML)), /class="bmbottom"/,
      '.bmbottom 规则已删,WXML 不应再引用它')
  }
})

test('④ cy-footer-bar 的层级低于 cy-sheet ⇒ 底栏不会盖住本页四个编辑面板', () => {
  const tokens = read('style/tokens.wxss')
  const zNav = /--cy-z-nav:\s*(\d+)/.exec(tokens)
  const zSheet = /--cy-z-sheet:\s*(\d+)/.exec(tokens)
  assert.ok(zNav && zSheet)
  assert.ok(Number(zNav[1]) < Number(zSheet[1]), '底栏层级必须低于 sheet,否则弹面板会被压住')
})

test('④ 页面必须为固定底栏留出等高滚动空白(末项能滚过底栏)', () => {
  const wxss = read(GZ_WXSS)
  const hold = /\.gz-footer-hold\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(hold, '必须保留底栏避让占位')
  assert.match(hold[1], /--cy-comp-footer-h/,
    '收编 cy-footer-bar 后,占位就该用它的官方高度 token(不再手算自造栏的三档)')
  assert.doesNotMatch(stripComments(read(GZ_WXML)), /style="height:\s*\d+rpx"/,
    '占位不得退回内联字面高度')
})
