'use strict'

// CU-C-32 契约:履约窗(场次)已过的票种不能当可售票。
//
// 走查实证:9 月 23 日仍能在活动详情的报名日期里选到 9 月 22 日的 ¥69 票并进结算。
// 根因是票的 startTime(场次日期)前后端都不参与可售判定 —— 前端只拿 endTime 当
// 「报名截止」用,场次日期只负责显示,于是过期的场次照样在卖。
//
// 本契约钉三处口径一致:utils/ticket-window.js(唯一判据)、详情组件的卡面与两个入口、
// 结算页的默认选中与换票弹层。任何一处退回「只判 endTime」都会红。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const ticketWindow = require('../../utils/ticket-window.js')

const PAST = '2020-01-01 09:00:00'
const PAST_END = '2020-01-01 18:00:00'
const FUTURE = '2999-01-01 09:00:00'
const FUTURE_END = '2999-01-01 18:00:00'

function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

/* ── 判据本身 ────────────────────────────────────────────────────────────── */

test('票种可售窗:场次一开始即不可售;startTime 缺失时退到 endTime;缺时间不判', () => {
  // 已结束(开始、结束都过了)
  assert.equal(ticketWindow.ticketWindowState({ startTime: PAST, endTime: PAST_END }), 'ended')
  assert.equal(ticketWindow.ticketWindowText({ startTime: PAST, endTime: PAST_END }), '场次已结束')
  // ★9-25 裁决的关键变化:开场后、散场前(now 在 start 与 end 之间)以前还能卖,现在判「已开始」不可售。
  assert.equal(ticketWindow.ticketWindowState({ startTime: PAST, endTime: FUTURE_END }), 'started')
  assert.equal(ticketWindow.ticketWindowPassed({ startTime: PAST, endTime: FUTURE_END }), true,
    '场次一到开始时间就停售 —— 这是撤销修复后必红的那条')
  // startTime 可判、endTime 缺失 ⇒ 同样判已开始
  assert.equal(ticketWindow.ticketWindowState({ startTime: PAST }), 'started')
  assert.equal(ticketWindow.ticketWindowText({ startTime: PAST }), '场次已开始')
  // startTime 缺失/不可解析 ⇒ 退到 endTime 这唯一已知边界
  assert.equal(ticketWindow.ticketWindowPassed({ endTime: PAST_END }), true, '缺 startTime 时 endTime 仍要判')
  // 还没到开始时间 ⇒ 可售
  assert.equal(ticketWindow.ticketWindowState({ startTime: FUTURE, endTime: FUTURE_END }), '')
  assert.equal(ticketWindow.ticketWindowPassed({ startTime: FUTURE, endTime: FUTURE_END }), false)
  // 两个时间都解析不出来 ⇒ 不判(≠ 过期,拿它拦会误伤正常票)
  assert.equal(ticketWindow.ticketWindowPassed({ startTime: '待定', endTime: '' }), false)
  assert.equal(ticketWindow.ticketWindowPassed(null), false)
  assert.equal(ticketWindow.ticketWindowText({ startTime: FUTURE }), '', '可售时调用方据此整句不出')
})

/* ── 详情组件 ────────────────────────────────────────────────────────────── */

function mountComponent() {
  const requests = []
  const app = {
    sendRequest(options) { requests.push(options) },
    getUserID: () => 7,
    getUserType: () => 1,
  }
  let definition
  const absolutePath = path.join(ROOT, 'components/cy/scene-play-activity-detail/index.js')
  const sandbox = {
    Date, Math, Promise, String, Number, Array, Object, JSON, console,
    getApp: () => app,
    wx: { vibrateShort() {}, showToast() {} },
    require(id) {
      if (!id.startsWith('.')) return require(id)
      return require(path.resolve(path.dirname(absolutePath), id))
    },
    Component(options) { definition = options },
  }
  const previousBehavior = global.Behavior
  global.Behavior = (config) => config
  try {
    vm.runInNewContext(read('components/cy/scene-play-activity-detail/index.js'), sandbox, { filename: absolutePath })
  } finally {
    global.Behavior = previousBehavior
  }
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback()
    },
    triggerEvent() {},
  }
  Object.entries(definition.methods || {}).forEach(([name, method]) => {
    instance[name] = method.bind(instance)
  })
  return { instance, requests }
}

function loadDetailWithTickets(omsTicketList) {
  const harness = mountComponent()
  harness.instance.data.activityId = 'activity-1'
  harness.instance.load('activity-1')
  harness.requests[0].success({
    code: 200,
    data: { id: 1, memberId: 8, name: '过期场次活动', isSignUp: 0, omsTicketList },
  })
  return harness
}

function captureToasts(run) {
  const shown = []
  const previousWx = global.wx
  const previousPages = global.getCurrentPages
  const navigations = []
  global.wx = { showToast: (options) => shown.push(options && options.title), navigateTo: (o) => navigations.push(o) }
  // toast.js 先找页面里的 #cy-toast;沙箱里没有页面栈,直接让它回落 wx.showToast
  global.getCurrentPages = undefined
  try {
    run()
  } finally {
    global.wx = previousWx
    global.getCurrentPages = previousPages
  }
  return { shown, navigations }
}

test('详情票种:已开始/已结束的场次置灰并写明理由,卡点不再放行', () => {
  const harness = loadDetailWithTickets([
    { id: 11, name: '9.22 场', price: 69, remainingInventory: 5, startTime: PAST, endTime: PAST_END },
    { id: 12, name: '只有场次日期', price: 69, remainingInventory: 5, startTime: PAST },
    { id: 13, name: '10.1 场', price: 69, remainingInventory: 5, startTime: FUTURE, endTime: FUTURE_END },
    { id: 15, name: '进行中场次', price: 69, remainingInventory: 5, startTime: PAST, endTime: FUTURE_END },
  ])
  const tickets = harness.instance.data.tickets
  // ★9-25 裁决:id15「已开始但未散场」原来可卖,现在也置灰(passed)。
  assert.deepEqual(tickets.map((t) => t._windowPassed), [true, true, false, true])
  assert.deepEqual(tickets.map((t) => t._windowText), ['场次已结束', '场次已开始', '', '场次已开始'])
  assert.equal(tickets[2]._dateText, '场次时间 1月1日 09:00 - 1月1日 18:00',
    '票种行标注「场次时间」,与顶部的活动时间分区,同日多场靠这个时间区分')

  const wxml = read('components/cy/scene-play-activity-detail/index.wxml')
  assert.match(wxml, /item\._available \|\| item\._windowPassed \? 'ticket--disabled'/,
    '过期场次必须与售罄同样置灰')
  assert.match(wxml, /item\._windowText \? ' · ' \+ item\._windowText/,
    '置灰还不够 —— 卡面要写明是场次问题,不然用户以为还能捡漏')

  const blocked = captureToasts(() => {
    harness.instance.selectTicket({ currentTarget: { dataset: { id: '11' } } })
    harness.instance.selectTicket({ currentTarget: { dataset: { id: '12' } } })
  })
  assert.deepEqual(blocked.shown, ['场次已结束', '场次已开始'], '理由要说准,不能一律报「已售罄」')
  assert.equal(harness.instance.data.selectedTicketId, '', '过期场次不得被选中')

  // ★开场即停售:进行中场次(id15,startTime 已过)现在同样不能被选中
  const inProgress = captureToasts(() => {
    harness.instance.selectTicket({ currentTarget: { dataset: { id: '15' } } })
  })
  assert.deepEqual(inProgress.shown, ['场次已开始'], '场次一到开始时间就不再放行,不再「进行中照样能买」')
  assert.equal(harness.instance.data.selectedTicketId, '', '已开始场次不得被选中')

  const ok2 = captureToasts(() => {
    harness.instance.selectTicket({ currentTarget: { dataset: { id: '13' } } })
  })
  assert.deepEqual(ok2.shown, [], '还没到开始时间的场次照常能买')
  assert.equal(harness.instance.data.selectedTicketId, '13')

  // 深链/刷新后 selectedTicketId 停在过期票上时,立即报名同样要拦
  harness.instance.setData({ selectedTicketId: '11', canConfirmSignup: true })
  const open = captureToasts(() => harness.instance.openSignup())
  assert.deepEqual(open.shown, ['场次已结束'])
  assert.deepEqual(open.navigations, [], '过窗票不得进入结算页')
})

/* ── 结算页 ──────────────────────────────────────────────────────────────── */

function loadBaomingPage() {
  const requests = []
  let config
  global.getApp = () => ({
    globalData: { user_id: 9, features: {} },
    getUserID: () => 9,
    getUserType: () => 1,
    isDevEnv: () => false,
    tips() {},
    recordConsent: () => Promise.resolve(),
    sendRequest(options) {
      requests.push(options)
      return { abort() {} }
    },
  })
  global.Page = (value) => { config = value }
  global.getCurrentPages = () => [{}]
  global.wx = {
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
    navigateBack() {}, redirectTo() {}, navigateTo() {},
  }
  const pagePath = path.resolve(ROOT, 'pages/activity/baoming/baoming.js')
  delete require.cache[require.resolve(pagePath)]
  require(pagePath)
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
    if (callback) callback()
  }
  return { page, requests }
}

const TICKETS = [
  { id: 11, name: '9.22 场', price: 69, remainingInventory: 5, startTime: PAST, endTime: PAST_END },
  { id: 13, name: '10.1 场', price: 69, remainingInventory: 5, startTime: FUTURE, endTime: FUTURE_END },
  { id: 14, name: '10.2 场', price: 69, remainingInventory: 5, startTime: FUTURE, endTime: FUTURE_END },
]
function loadBaomingWithTickets(ticketId, tickets) {
  const harness = loadBaomingPage()
  Object.assign(harness.page.data, { activityId: 500, ticketId: ticketId == null ? null : ticketId })
  harness.page.getActivityInfo()
  harness.requests[harness.requests.length - 1].success({
    code: 200,
    data: {
      id: 500, name: '含过期场次的活动', startDate: FUTURE, endDate: FUTURE_END,
      address: '静安区愚园路 68 号', omsTicketList: tickets || TICKETS,
    },
  })
  return harness.page
}

test('结算页:没有指定票种时默认落在还能卖的场次上,不选过期那张', () => {
  const page = loadBaomingWithTickets(null)
  assert.equal(page.data.selectedTicket.id, 13, '列表第一张已过期,默认选中必须跳过它')
  assert.equal(page.data.signupState, 'available')
})

test('结算页:显式指定的票种即使过期也如实停在「报名已截止」', () => {
  const page = loadBaomingWithTickets(11)
  assert.equal(page.data.selectedTicket.id, 11, '深链指定的票种不能被悄悄换成别的场次')
  assert.equal(page.data.signupState, 'closed', '过期场次不能摆出可付款的表单')
  page.refreshPaymentState()
  assert.equal(page.data.signupClosed, true)
  assert.equal(page.data.canPay, false)
})

test('结算页:全部场次都过期时不装作有票可买', () => {
  const page = loadBaomingWithTickets(null, [TICKETS[0]])
  assert.equal(page.data.selectedTicket.id, 11)
  assert.equal(page.data.signupState, 'closed')
})

test('结算页:已开始的场次即使未散场也停售,默认落到还没开始的那场', () => {
  const page = loadBaomingWithTickets(null, [
    { id: 11, name: '进行中场次', price: 69, remainingInventory: 5, startTime: PAST, endTime: FUTURE_END },
    { id: 13, name: '10.1 场', price: 69, remainingInventory: 5, startTime: FUTURE, endTime: FUTURE_END },
  ])
  assert.equal(page.data.selectedTicket.id, 13,
    '★9-25 裁决:startTime 已过即停售,默认选中不得停在已开始的那场(撤销修复后这里会是 11)')
  assert.equal(page.data.signupState, 'available')
})

test('结算页换票弹层:已开始/过期场次不出现,选项按场次开始时间排序并带上时间', () => {
  const page = loadBaomingWithTickets(null)
  page.openTicketSheet()
  assert.deepEqual(page.data.ticketSheetItems, ['10.1 场 · 01-01 09:00 · ¥69.00', '10.2 场 · 01-01 09:00 · ¥69.00'],
    '过期/已开始场次不得出现;同日多场靠带上场次时间区分')
  page.onTicketSheetSelect({ detail: { index: 1 } })
  assert.equal(page.data.selectedTicket.id, 14, '下标必须落在过滤后的那份列表上')
})

/* ── 负控:三处口径各自退回旧行为,契约必须判红 ───────────────────────────── */

test('负控:判据退回「只比 endTime」,场次开始即停售这条必须判红', () => {
  const source = read('utils/ticket-window.js')
  const broken = source.replace(
    "  const start = toTimestamp(ticket.startTime)\n  if (!Number.isNaN(start)) {\n    if (at < start) return ''\n    const end = toTimestamp(ticket.endTime)\n    return !Number.isNaN(end) && at > end ? 'ended' : 'started'\n  }\n",
    '',
  )
  assert.notEqual(broken, source, '负控锚点失效:startTime 主判据已不在 ticketWindowState 里')
  const sandbox = { module: { exports: {} }, require: (id) => (id.startsWith('.') ? require(path.resolve(ROOT, 'utils', id)) : null) }
  vm.runInNewContext(broken, sandbox)
  const degraded = sandbox.module.exports
  assert.equal(degraded.ticketWindowPassed({ startTime: PAST, endTime: FUTURE_END }), false,
    '旧口径只认 endTime:开场但未散场仍放行 —— 这正是走查里 9.23 还能买 9.22 场的根因')
})
