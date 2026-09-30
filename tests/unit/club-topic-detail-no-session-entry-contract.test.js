// §5-断6(2026-09-15 晚复核):主题还没有场次时,俱乐部活动详情的底部主键「开始准备」
// 点下去只弹一句「还没有场次，先从场次管理开一场」——长得能点、点了什么也不发生,就是死入口。
// 用户口径:**不留死入口**。
//
// 现码判据:导演台的三段状态流转(开始准备/开始活动/结束活动)都以**一场具体场次**为对象
// (onPrimary 的 _directorActivityId 闸 + projection 状态机,notReady 只兜底),没场次时
// 它真做不了事 —— 所以走 (a):主键换成真动作「去开场」(进场次管理把场开出来),并在页尾
// 就地写出原因;没有俱乐部上下文(开不了场)时干脆不出主键。核销区在没场次时本来就不渲染,
// 团码另有自己的空态页(暂无可带队的场次),不在本次改动里。
//
// 装真页面跑真方法,不看源码字符串 —— 改写法也逃不掉;负控用源码变异证明这条门禁能判红。
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_JS = 'pages/club/topic-detail/index.js'
const PAGE_WXML = 'pages/club/topic-detail/index.wxml'

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 页面 require 的既有模块按真身装进去(director.js 里的状态机与 adapter 链在 Node 里能直接加载,
// 与 club-topic-detail-status-truth 同一个装法);toast/loading/modal 由 ui-sandbox-vm 接管。
function pageRequire(id) {
  return require(path.resolve(ROOT, 'pages/club/topic-detail', id))
}

function loadPage(source) {
  let definition = null
  const requests = []
  const navigations = []
  const toasts = []
  const wx = {
    showToast: (o) => toasts.push(o.title),
    hideToast: () => {},
    navigateTo: (o) => navigations.push(o.url),
    redirectTo: (o) => navigations.push(o.url),
    switchTab: (o) => navigations.push(o.url),
    navigateBack: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getSystemInfoSync: () => ({}),
  }
  const previous = { getApp: global.getApp, wx: global.wx, getCurrentPages: global.getCurrentPages }
  global.wx = wx
  global.getApp = () => ({ globalData: {}, sendRequest: () => {} })
  global.getCurrentPages = () => [{}]
  try {
    vm.runInNewContext(source || read(PAGE_JS), {
      getApp: () => ({
        globalData: { statusBarHeight: 20, navBarHeight: 44 },
        sendRequest: (o) => requests.push(o),
        tips: (m) => toasts.push(m),
      }),
      Page: (config) => { definition = config },
      getCurrentPages: () => [{}],
      wx,
      require: pageRequire,
      console,
    }, { filename: PAGE_JS })
  } finally {
    global.getApp = previous.getApp
    global.wx = previous.wx
    global.getCurrentPages = previous.getCurrentPages
  }
  assert.ok(definition, '页面没有注册到 Page()')
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch, callback) {
      Object.assign(this.data, patch)
      if (typeof callback === 'function') callback.call(this)
    },
  })
  // 进导演台后拉 projection 是另一条链路;这条门禁只钉宿主页的路由与文案,把它桩掉
  page.loadProjection = function () { page._projectionLoads = (page._projectionLoads || 0) + 1 }
  page.onPrepareSession = function () { page._prepared = true }
  // 拍板1(2026-09-17):管理身份由 topic-manage-stats 的 canDirect/canManageSessions/canViewVerify 下发;本门禁钉的是主理人视角
  page._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true }
  return { page, requests, navigations, toasts }
}

const NO_SESSION = { status: 1, isOwner: 1, name: '还没有场次的主题', activityList: [] }
const ONE_SESSION = { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702, name: '第一场' }] }
const TWO_SESSIONS = { status: 1, isOwner: 1, name: 't', activityList: [{ id: 701, name: '一场' }, { id: 702, name: '二场' }] }

test('没场次:主键是真动作「去开场」,点它进场次管理;不再弹「还没有场次」的 toast', () => {
  const { page, navigations, toasts } = loadPage()
  page._topicId = 88; page._clubId = 9
  page.applyDetail(NO_SESSION)
  assert.equal(page.data.primary.text, '去开场', '没场次时主键还是导演台文案 = 点了没反应的死入口')
  assert.equal(page.data.primary.disabled, false)
  assert.match(page.data.sessionHint, /先开一场/, '就地要说明为什么核销/团码出不来')
  // ⚠️ 只断言 data.sessionHint 守不住渲染层:2026-09-16 实测,把 wxml 里渲染它的那一行删掉,
  // 这 5 条测试照样全绿,而用户界面上那句说明已经没了。所以必须同时钉住 wxml 真的把它渲染出来。
  assert.match(read(PAGE_WXML), /\{\{sessionHint\}\}/,
    'wxml 没有渲染 sessionHint —— 数据算出来了但用户看不到,等于没做')
  page.onPrimary()
  assert.deepEqual(navigations, ['/pages/club/event-ops/index?clubId=9&topicId=88'])
  assert.deepEqual(toasts, [], '点了没反应的 toast 不许再出现')
})

test('有多场但没带 activityId:主键「去选一场」先弹选场半屏,选中后带 activityId 进场次运营', () => {
  const { page, navigations, toasts } = loadPage()
  page._topicId = 88; page._clubId = 9
  page.applyDetail(TWO_SESSIONS)
  assert.equal(page.data.primary.text, '去选一场')
  // CU-C-79(2026-09-24 用户裁决 B):文案承诺「选一场」,原来直接跳系列编辑页且不带
  // activityId —— 页面上根本没有「选」这个动作。现在先弹选场半屏。
  page.onPrimary()
  assert.deepEqual(navigations, [], '没选之前不许跳 —— 跳过去也就没有「选」这个动作了')
  assert.equal(page.data.sessionPickVisible, true, '点主键应当弹选场半屏')
  assert.deepEqual(page.data.sessionPickRows.map((row) => row.id), [701, 702])
  assert.match(read(PAGE_WXML), /\{\{sessionPickRows\}\}/, '半屏没渲染候选行 = 数据算了也没得选')
  page.onSessionPick({ currentTarget: { dataset: { id: 702 } } })
  assert.deepEqual(navigations, ['/pages/club/event-ops/index?clubId=9&topicId=88&activityId=702'],
    '选中后必须带 activityId 进 —— 不带就还是「选了等于没选」')
  assert.equal(page.data.sessionPickVisible, false)
  assert.deepEqual(toasts, [])
})

test('没有俱乐部上下文(开不了场):干脆不出主键,也不留 toast', () => {
  const { page, navigations, toasts } = loadPage()
  page._topicId = 88
  page.applyDetail(NO_SESSION)
  assert.equal(page.data.primary.text, '', '开不了场就整条不出 —— 不留点了没反应的入口')
  page.onPrimary()
  assert.deepEqual(navigations, [])
  assert.deepEqual(toasts, [])
  // 模板真按文案出没控制渲染,不是渲染一个空按钮
  assert.match(read(PAGE_WXML), /wx:if="\{\{primary\.text\}\}"[\s\S]{0,240}?bindtap="onPrimary"/,
    '主键没有 wx:if,空文案会被渲染成一个点不出反应的按钮')
})

test('有唯一一场时:主键仍归导演台状态机,「去开场」不许劫持它', () => {
  const { page, navigations, toasts } = loadPage()
  page._topicId = 88; page._clubId = 9
  page.applyDetail(ONE_SESSION)
  assert.equal(page._directorActivityId, 702, '唯一一场必须照旧自动进导演台')
  assert.equal(page.data.primary.text, '开始准备', '有场次时主键是状态机动作,不该被换掉')
  page.onPrimary()
  assert.equal(page._prepared, true, '有场次时点主键要落到导演台动作上')
  assert.deepEqual(navigations, [])
  assert.deepEqual(toasts, [])
})

test('负控:源码变异把「去开场」换回旧文案,同一条断言必须判红', () => {
  const source = read(PAGE_JS)
  const mutated = source.replace("'去开场'", "'开始准备'")
  assert.notEqual(mutated, source, '变异注入失败:锚点已漂')
  const { page } = loadPage(mutated)
  page._topicId = 88; page._clubId = 9
  page.applyDetail(NO_SESSION)
  assert.throws(
    () => assert.equal(page.data.primary.text, '去开场'),
    (error) => error instanceof assert.AssertionError,
    '变异后的页面居然还能通过「去开场」断言 —— 这条门禁在空转',
  )
})
