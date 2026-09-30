'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_PATH = path.join(ROOT, 'pages/merchant/index/index.js')
const WXML_PATH = path.join(ROOT, 'pages/merchant/index/index.wxml')
const JSON_PATH = path.join(ROOT, 'pages/merchant/index/index.json')

let pageConfig
let requests
let userId = 9
let switches
let navigations
let roleUpdates
let typeUpdates

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44 },
  getUserID: () => userId,
  getUserRole: () => 'merchant',
  getUserType: () => 2,
  setUserRole(value) { roleUpdates.push(value) },
  setUserType(value) { typeUpdates.push(value) },
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 44 }),
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
  showToast() {},
  showLoading() {},
  hideLoading() {},
  switchTab(options) { switches.push(options) },
  navigateTo(options) { navigations.push(options && options.url) },
  stopPullDownRefresh() {},
  setNavigationBarColor() {},
  setBackgroundColor() {},
  setNavigationBarTitle() {},
}

global.Page = (config) => { pageConfig = config }

function loadPage() {
  pageConfig = null
  requests = []
  switches = []
  navigations = []
  roleUpdates = []
  typeUpdates = []
  userId = 9
  delete require.cache[require.resolve(PAGE_PATH)]
  require(PAGE_PATH)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

function merchantAccess(id = 3, name = 'A店') {
  return {
    code: 200,
    data: {
      active: true,
      merchant: { id, name },
      roleCode: 'MERCHANT_OWNER',
      permissions: [
        'merchant:basic:read', 'merchant:profile:write', 'merchant:project:manage',
        'merchant:finance:read', 'merchant:verify', 'merchant:verify:record:read',
      ],
    },
  }
}

function assertPartialStateUi(wxml, json) {
  // 2026-09-16 去闸:身份确认不再整屏;确认期用普通骨架,失败落页内内联错误。
  assert.doesNotMatch(wxml, /rv-gate|consoleState/,
    '整屏身份闸必须删除,确认期走普通加载态')
  assert.match(json, /"cy-inline-error"\s*:\s*"\/components\/cy\/inline-error\/index"/,
    '商家工作台必须注册局部错误组件')
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{consoleError\}\}"[^>]*bind:action="reloadConsole"/,
    '身份/加载失败必须有页内重试出路')
  assert.match(wxml, /dashboardLoading\s*&&\s*dashboardData\.revenue\s*==\s*null/,
    '只有没有旧收入时才显示首载骨架')
  assert.match(wxml, /dashboardLoading\s*&&\s*dashboardData\.revenue\s*!=\s*null/,
    '已有收入刷新时必须留下正在更新提示')
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{dashboardError\}\}"[^>]*bind:action="reloadDashboard"/,
    '收入局部失败必须原位说明并只重试经营数据')
  assert.match(wxml, /!projectCards\.length\s*&&\s*\(joinLoading\s*\|\|\s*hostLoading\s*\|\|\s*todoLoading\s*\|\|\s*gameEntryLoading\)/,
    '项目骨架只能遮住还没有旧项目的首载')
  assert.doesNotMatch(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{joinError\s*\|\|\s*hostError\s*\|\|\s*todoError\}\}"/,
    '项目刷新失败静默降级:保留成功卡片,不挂区块横幅')
}

test('商家工作台采用首载骨架、stale 内容与局部恢复三段式状态', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const json = fs.readFileSync(JSON_PATH, 'utf8')
  assertPartialStateUi(wxml, json)
})

test('收入局部重试通过无参 wrapper，组件 event 不会被误当成 data epoch', () => {
  const page = loadPage()
  page._dataEpoch = 4
  page.data.merchantAccess = { canReadFinance: true }
  assert.equal(typeof page.reloadDashboard, 'function')
  page.reloadDashboard({ type: 'action', detail: {} })
  const request = requests.find((item) => item.url === '/api/merchant/dashboard')
  assert.ok(request)
  request.success({ code: 200, data: { revenue: 66, pendingOrders: 1 } })
  request.complete()
  assert.equal(page.data.dashboardData.revenue, '66.00')
  assert.equal(page.data.dashboardLoading, false)
})

test('商家身份请求 pending 时 fail closed，过期回调不能覆盖新一轮结果', () => {
  const page = loadPage()
  assert.equal(page.data.merchantAccess.active, false, '身份确认前不得放行任何经营入口')

  page.onShow()
  assert.equal(page.data.merchantAccess.active, false)
  const first = requests.find((item) => item.url === '/api/merchant/access/me')
  assert.ok(first)

  page.onShow()
  const identities = requests.filter((item) => item.url === '/api/merchant/access/me')
  assert.equal(identities.length, 2)
  identities[1].success(merchantAccess())
  assert.equal(page.data.merchantAccess.active, true)
  assert.equal(page.data.consoleError, '')

  first.fail({ msg: '过期错误' })
  assert.equal(page.data.merchantAccess.active, true, '上一轮身份失败不能重新关掉已经确认的工作台')
  assert.equal(page.data.consoleError, '', '迟到失败不得往新身份上写错误态')
})

test('账号在请求途中变化时，旧身份与旧经营回调都不得写入新账号视角', () => {
  const identityPending = loadPage()
  userId = 9
  identityPending.onShow()
  const identityA = requests.find((item) => item.url === '/api/merchant/access/me')
  const requestCount = requests.length
  let identityWrites = 0
  const identitySetData = identityPending.setData
  identityPending.setData = function (patch) { identityWrites += 1; identitySetData.call(this, patch) }

  userId = 10
  identityA.success(merchantAccess())
  identityA.fail({ msg: 'A 迟到失败' })
  assert.equal(identityWrites, 0)
  assert.equal(requests.length, requestCount, 'A 身份回调不得为 B 发起商家子请求')
  assert.deepEqual(roleUpdates, [])
  assert.deepEqual(typeUpdates, [])

  const dataPending = loadPage()
  userId = 9
  dataPending.onShow()
  requests.find((item) => item.url === '/api/merchant/access/me').success(merchantAccess())
  const merchantInfoA = requests.find((item) => item.url === '/api/merchant/info')
  merchantInfoA.success({ code: 200, data: { id: 3, name: 'A店' } })
  const dashboardA = requests.find((item) => item.url === '/api/merchant/dashboard')
  userId = 10
  dashboardA.success({ code: 200, data: { revenue: 999, pendingOrders: 1 } })
  dashboardA.complete()
  merchantInfoA.success({ code: 200, data: { id: 3, name: 'A店迟到' } })

  assert.equal(dataPending.data.displayName, 'A店', '旧子请求不得覆盖已确认身份头之外的后续视图')
  assert.equal(dataPending.data.dashboardData.revenue, null)
})

test('页面卸载后身份成功、降级或失败回调都不得写页、跳转或再发子请求', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
  assert.match(source, /this\._refreshEndTimer\s*=\s*setTimeout/)
  assert.match(source, /clearTimeout\(this\._refreshEndTimer\)/)
  const cases = [
    (request) => request.success(merchantAccess()),
    (request) => request.success({ code: 200, data: { active: false } }),
    (request) => request.fail({ msg: '迟到失败' }),
  ]

  cases.forEach((completeIdentity) => {
    const page = loadPage()
    page.onShow()
    const identity = requests.find((item) => item.url === '/api/merchant/access/me')
    const requestCount = requests.length
    let setDataCalls = 0
    const originalSetData = page.setData
    page.setData = function (patch) { setDataCalls += 1; originalSetData.call(this, patch) }

    page.onUnload()
    completeIdentity(identity)

    assert.equal(setDataCalls, 0)
    assert.equal(requests.length, requestCount)
    assert.deepEqual(switches, [])
  })
})

test('登出或切换商家后，旧主体的子请求不能回填品牌、金额与待办', () => {
  const page = loadPage()
  page.onShow()
  const identityA = requests.find((item) => item.url === '/api/merchant/access/me')
  identityA.success(merchantAccess())

  const todoA = requests.find((item) => item.url === '/api/merchant/todo-summary')
  const merchantInfoA = requests.find((item) => item.url === '/api/merchant/info')
  assert.ok(todoA && merchantInfoA)

  userId = 0
  page.onShow()
  assert.equal(page.data.displayName, '商家')
  assert.equal(page.data.dashboardData.revenue, null)

  merchantInfoA.success({ code: 200, data: { id: 3, name: 'A店迟到结果' } })
  todoA.success({
    code: 200,
    data: {
      biddingTopics: 9, pendingVerify: 7, verifiedCount: 1,
      pendingScanConfirm: 2, pendingOrders: 3, refundCount: 1,
    },
  })
  const staleDashboard = requests.find((item) => item.url === '/api/merchant/dashboard')
  if (staleDashboard) {
    staleDashboard.success({ code: 200, data: { revenue: 888, pendingOrders: 2 } })
    staleDashboard.complete()
  }
  assert.equal(page.data.displayName, '商家')
  assert.equal(page.data.dashboardData.revenue, null)
  assert.equal(page.data.todo.pendingVerify, 0)

  userId = 10
  page.onShow()
  const identityB = requests.filter((item) => item.url === '/api/merchant/access/me').at(-1)
  identityB.success(merchantAccess(4, 'B店'))
  assert.equal(page.data.displayName, 'B店')
  merchantInfoA.success({ code: 200, data: { id: 3, name: 'A店再次迟到' } })
  assert.equal(page.data.displayName, 'B店')
})

test('经营数据刷新失败保留最后一次已确认金额，未知值仍为 null', () => {
  const page = loadPage()
  page.data.dashboardData = { revenue: '128.50', pendingOrders: 2 }

  page.loadDashboard()
  assert.deepEqual(page.data.dashboardData, { revenue: '128.50', pendingOrders: 2 },
    '发起刷新不能先把已确认经营数据清空')
  const request = requests.find((item) => item.url === '/api/merchant/dashboard')
  assert.ok(request)
  request.fail({ msg: '网络连接失败' })
  request.complete()

  assert.deepEqual(page.data.dashboardData, { revenue: '128.50', pendingOrders: 2 })
  assert.equal(page.data.dashboardError, '网络连接失败')
  assert.equal(page.data.dashboardLoading, false)
})

test('连续整台刷新只接受最后一轮响应，旧经营快照不得倒灌', () => {
  const page = loadPage()
  page._dataEpoch = 3

  page._reloadAll()
  const firstAccess = requests.filter((item) => item.url === '/api/merchant/access/me').at(-1)
  firstAccess.success(merchantAccess(3, '旧经营快照'))
  const firstMerchant = requests.filter((item) => item.url === '/api/merchant/info').at(-1)
  const firstEpoch = page._dataEpoch
  page._reloadAll()
  const secondAccess = requests.filter((item) => item.url === '/api/merchant/access/me').at(-1)
  secondAccess.success(merchantAccess(4, '新经营快照'))
  const secondMerchant = requests.filter((item) => item.url === '/api/merchant/info').at(-1)

  assert.ok(firstMerchant && secondMerchant && firstMerchant !== secondMerchant)
  assert.equal(page._dataEpoch, firstEpoch + 1, '每次整台刷新必须换代')
  secondMerchant.success({ code: 200, data: { id: 4, name: '新经营快照' } })
  firstMerchant.success({ code: 200, data: { id: 3, name: '迟到旧快照' } })

  assert.equal(page.data.displayName, '新经营快照')
  assert.equal(requests.filter((item) => item.url === '/api/merchant/todo-summary').length, 2,
    '整台刷新不能只刷新四个区块并让待办停在旧代次')
})

// 2026-09-17 拍板 #23:竞猜「给答案」48 小时待办只在 IM 私信里,商家不看私信就超时作废。
// 它现在进 todo-summary(pendingPredict),工作台有待办入口且直达待答页;答完/作废归零即消失。
function assertPredictTodoEntry(wxml) {
  assert.match(wxml, /todo\.pendingPredict\s*>\s*0/,
    '待答入口只在真有轮次时出现')
  assert.match(wxml, /todo\.pendingPredict\s*>\s*0[\s\S]{0,400}?bindtap="goPredictInbox"/,
    '待答入口必须可点')
}

test('竞猜待答进工作台待办:点击直达竞猜待答页,归零后入口消失', () => {
  const page = loadPage()
  page._dataEpoch = 1
  page._dataMemberId = '9'
  page.data.merchantAccess = { canManageProjects: true }
  page.loadTodo(1)
  const request = requests.find((item) => item.url === '/api/merchant/todo-summary')
  assert.ok(request)
  request.success({
    code: 200,
    data: {
      biddingTopics: 1, pendingVerify: 0, verifiedCount: 0, pendingScanConfirm: 0,
      pendingOrders: 0, refundCount: 0, pendingPredict: 2, byProject: [],
    },
  })
  assert.equal(page.data.todo.pendingPredict, 2)

  page.goPredictInbox()
  assert.equal(navigations.at(-1), '/pages/merchant/predict/index', '待答入口必须直达给答案的页面')

  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  assertPredictTodoEntry(wxml)
  // 负控:拿掉待答入口的 handler 绑定,契约必须判红。
  const mutated = wxml.replace('bindtap="goPredictInbox"', 'bindtap="noop"')
  assert.notEqual(mutated, wxml, '负控锚点失效')
  assert.throws(() => assertPredictTodoEntry(mutated), assert.AssertionError)
})

test('项目子请求失败不清空其它已经成功的项目数据', () => {
  const join = loadPage()
  join.data.projectList = [{ id: 1, title: '沿江路线' }]
  join.data.joinTotal = 1
  join.loadJoinList()
  requests.find((item) => item.url === '/api/registration/merchant/list').fail({})
  assert.deepEqual(join.data.projectList, [{ id: 1, title: '沿江路线' }])
  assert.equal(join.data.joinTotal, 1)
  assert.equal(join.data.joinError, true)

  const host = loadPage()
  host.data.hostProjectList = [{ id: 2, title: '夜行活动' }]
  host.data.hostProjectTotal = 1
  host.loadHostProjects()
  requests.find((item) => item.url === '/api/project/my').fail({})
  assert.deepEqual(host.data.hostProjectList, [{ id: 2, title: '夜行活动' }])
  assert.equal(host.data.hostProjectTotal, 1)
  assert.equal(host.data.hostError, true)
})

test('负控：把收入和项目恢复为互斥整块 loading 时必须判红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const json = fs.readFileSync(JSON_PATH, 'utf8')
  const mutated = wxml
    .replace(/dashboardLoading\s*&&\s*dashboardData\.revenue\s*==\s*null/, 'dashboardLoading')
    .replace(/!projectCards\.length\s*&&\s*\(joinLoading\s*\|\|\s*hostLoading\s*\|\|\s*todoLoading\)/,
      'joinLoading || hostLoading || todoLoading')
  assert.notEqual(mutated, wxml, '负控锚点失效')
  assert.throws(() => assertPartialStateUi(mutated, json), /只有没有旧收入时|项目骨架只能/)
})

test('负控：把整屏身份闸加回工作台必须判红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const json = fs.readFileSync(JSON_PATH, 'utf8')
  const mutated = wxml.replace(
    '<cy-inline-error class="rv-console-error"',
    '<view class="rv-gate" wx:if="{{consoleState}}">整屏闸</view>\n    <cy-inline-error class="rv-console-error"',
  )
  assert.notEqual(mutated, wxml, '负控锚点失效')
  assert.throws(() => assertPartialStateUi(mutated, json), /整屏身份闸必须删除/)
})
