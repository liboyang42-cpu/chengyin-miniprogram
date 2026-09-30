const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE_PATH = '../../pages/activity/baoming/baoming.js'

let config
let requests
let requestTasks
let navigation
let pageStackDepth

beforeEach(() => {
  config = null
  requests = []
  requestTasks = []
  navigation = []
  pageStackDepth = 1

  global.getApp = () => ({
    globalData: { user_id: 9, features: {} },
    getUserID: () => 9,
    isDevEnv: () => false,
    tips() {},
    recordConsent: () => Promise.resolve(),
    sendRequest(options) {
      requests.push(options)
      const task = {
        aborted: false,
        abort() { this.aborted = true },
      }
      requestTasks.push(task)
      return task
    },
  })
  global.getCurrentPages = () => Array.from({ length: pageStackDepth }, () => ({}))
  global.Page = value => { config = value }
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showToast() {},
    showModal() {},
    showLoading() {},
    hideLoading() {},
    navigateBack(options = {}) {
      navigation.push({ type: 'back' })
    },
    redirectTo(options) { navigation.push({ type: 'redirect', url: options.url }) },
    navigateTo(options) { navigation.push({ type: 'navigate', url: options.url }) },
  }
})

function setByPath(target, path, value) {
  const parts = path.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage(source) {
  if (source) {
    // B-08 负控:按变异源码建模块,不污染 require 缓存
    const Module = require('node:module')
    const modulePath = path.resolve(__dirname, PAGE_PATH)
    const m = new Module(modulePath, module)
    m.filename = modulePath
    m.paths = Module._nodeModulePaths(path.dirname(modulePath))
    m._compile(source, modulePath)
  } else {
    delete require.cache[require.resolve(PAGE_PATH)]
    require(PAGE_PATH)
  }
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([path, value]) => setByPath(this.data, path, value))
    if (callback) callback()
  }
  return page
}

test('缺少 activityId 时进入 missing-param、零请求，并能返回或去活动发现页', () => {
  const page = loadPage()

  page.onLoad({ ticketId: '34' })

  assert.equal(page.data.pageState, 'missing-param')
  assert.equal(requests.length, 0, '缺参终态不能发用户、活动或参与人请求')

  pageStackDepth = 2
  page.onNavBack()
  pageStackDepth = 1
  page.onNavBack()
  page.goDiscoverActivities()
  assert.deepEqual(navigation, [
    { type: 'back' },
    { type: 'redirect', url: '/pages/activity/list/index' },
    { type: 'redirect', url: '/pages/activity/list/index' },
  ])

  const dir = path.join(__dirname, '../../pages/activity/baoming')
  const wxml = fs.readFileSync(path.join(dir, 'baoming.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(dir, 'baoming.wxss'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'baoming.json'), 'utf8'))
  assert.ok(json.usingComponents['cy-empty'])
  assert.match(wxml, /<cy-nav-bar[^>]*custom-back[^>]*bind:back="onNavBack"/)
  assert.match(wxml, /<cy-empty[^>]*class="page-terminal"[^>]*wx:if="\{\{pageState === 'missing-param'\}\}"[^>]*kind="missing-param"/)
  assert.match(wxml, /cta="去发现活动"[^>]*bind:cta="goDiscoverActivities"/)
  assert.match(wxss, /cy-empty\.page-terminal\s*\{/)
  assert.doesNotMatch(wxss, /cy-error\s*,\s*cy-empty\s*\{/,
    '整页终态的 flex 规则不能污染费用区和弹窗里的局部 cy-empty')
})

test('参与人初次请求有独立 loading/error/ready，失败不会冒充空名单', () => {
  const page = loadPage()

  page.getAddressList()
  assert.equal(page.data.participantState, 'loading')
  assert.equal(requests.length, 1)

  requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(page.data.participantState, 'error')
  assert.equal(page.data.addressList.length, 0)

  page.getAddressList()
  requests[1].success({ code: '200', data: { rows: [] } })
  assert.equal(page.data.participantState, 'ready')

  const dir = path.join(__dirname, '../../pages/activity/baoming')
  const wxml = fs.readFileSync(path.join(dir, 'baoming.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'baoming.json'), 'utf8'))
  assert.ok(json.usingComponents['cy-inline-error'])
  assert.match(wxml, /<cy-skeleton[^>]*participantState === 'loading'[^>]*addressList.length === 0/)
  assert.match(wxml, /<cy-inline-error[^>]*participantState === 'error'[^>]*action="重试"[^>]*bind:action="retryAddressList"/)
  assert.match(wxml, /<cy-empty[^>]*participantState === 'ready'[^>]*addressList.length === 0/)
})

test('参与人仍在加载或加载失败时，点击入口只展示真实状态而不误导去新增', () => {
  const page = loadPage()

  page.getAddressList()
  page.checkAndShowAddressPopup()
  assert.equal(page.data.showAddressPopup, true)
  assert.equal(navigation.length, 0)

  requests[0].fail({ errMsg: 'request:fail timeout' })
  page.setData({ showAddressPopup: false })
  page.checkAndShowAddressPopup()
  assert.equal(page.data.showAddressPopup, true)
  assert.equal(navigation.length, 0)
})

test('参与人名单刷新失败进入 staleError，并保留已有名单和选择', () => {
  const page = loadPage()
  const existing = [{ id: 7, fullName: '已有参与人', mobilePhone: '13800138000' }]
  page.data.addressList = existing
  page.data.selectedAddress = existing[0]

  page.getAddressList()
  assert.equal(page.data.participantState, 'loading')
  assert.equal(page.data.addressList, existing)

  requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(page.data.participantState, 'staleError')
  assert.equal(page.data.addressList, existing)
  assert.equal(page.data.selectedAddress, existing[0])

  const wxml = fs.readFileSync(
    path.join(__dirname, '../../pages/activity/baoming/baoming.wxml'), 'utf8')
  assert.match(wxml, /<cy-inline-error[^>]*participantState === 'staleError'[^>]*action="重试"[^>]*bind:action="retryAddressList"/)
  assert.doesNotMatch(wxml, /participantState === 'staleError'[^\n>]*暂无参与人信息/)
})

test('活动 200 但无有效票时明确暂不可报名，付款资格和模板都不碰空票', () => {
  const page = loadPage()
  page.data.activityId = 12

  page.getActivityInfo()
  requests[0].success({
    code: '200',
    data: { id: 12, name: '夜行城市', startDate: '2026-08-01 19:00:00', omsTicketList: [] },
  })

  assert.equal(page.data.pageState, 'ready')
  assert.equal(page.data.signupState, 'unavailable')
  assert.equal(page.data.selectedTicket, null)
  assert.equal(page.data.totalAmount, 0)

  page.data.hostShareChecked = true
  page.data.selectedAddress = { id: 7 }
  page.data.paymentReady = true
  page.refreshPaymentState()
  assert.equal(page.data.canPay, false, '没有选中票时即使其余前置满足也不能付款')

  page.handlePayment()
  assert.equal(requests.length, 1, '空票禁用 CTA 不能发报价或下单请求')

  const wxml = fs.readFileSync(
    path.join(__dirname, '../../pages/activity/baoming/baoming.wxml'), 'utf8')
  assert.match(wxml, /wx:if="\{\{pageState === 'ready' && signupState === 'unavailable'\}\}"[^>]*title="暂不可报名"/)
  assert.match(wxml, /wx:if="\{\{pageState === 'ready' && selectedTicket\}\}"[^>]*class="setly"/)
  assert.match(wxml, /!selectedTicket \? '暂不可报名：暂无可用票'/)
})

test('参与人请求单飞且 epoch 拒绝已结束请求的迟到响应', () => {
  const page = loadPage()

  page.getAddressList()
  page.getAddressList()
  assert.equal(requests.length, 1, '同一参与人请求在途时不能重复发送')

  const first = requests[0]
  first.fail({ errMsg: 'request:fail timeout' })
  page.retryAddressList()
  assert.equal(requests.length, 2)
  assert.equal(page.data.participantState, 'loading')

  first.success({ code: '200', data: { rows: [{ id: 1, fullName: '迟到旧名单' }] } })
  assert.equal(page.data.participantState, 'loading')
  assert.equal(page.data.addressList.length, 0)

  requests[1].success({ code: '200', data: { rows: [{ id: 2, fullName: '最新名单' }] } })
  assert.equal(page.data.participantState, 'ready')
  assert.equal(page.data.addressList[0].id, 2)
})

test('活动详情请求单飞且 epoch 拒绝旧请求覆盖重试结果', () => {
  const page = loadPage()
  page.data.activityId = 12

  page.getActivityInfo()
  page.getActivityInfo()
  assert.equal(requests.length, 1, '同一活动详情在途时不能重复发送')

  const first = requests[0]
  first.fail({ errMsg: 'request:fail timeout' })
  page.retryActivityInfo()
  assert.equal(requests.length, 2)
  assert.equal(page.data.pageState, 'loading')

  first.success({
    code: '200',
    data: { id: 12, name: '迟到旧活动', startDate: '2026-08-01 19:00:00', omsTicketList: [] },
  })
  assert.equal(page.data.pageState, 'loading')
  assert.notEqual(page.data.activityInfo.name, '迟到旧活动')

  requests[1].success({
    code: '200',
    data: { id: 12, name: '最新活动', startDate: '2026-08-02 19:00:00', omsTicketList: [] },
  })
  assert.equal(page.data.pageState, 'ready')
  assert.equal(page.data.activityInfo.name, '最新活动')
})

test('页面卸载会失效并中止活动详情与参与人请求', () => {
  const page = loadPage()
  page.data.activityId = 12
  page.getActivityInfo()
  page.getAddressList()
  const activityRequest = requests[0]
  const participantRequest = requests[1]

  page.onUnload()

  assert.equal(requestTasks[0].aborted, true)
  assert.equal(requestTasks[1].aborted, true)
  assert.equal(page._activityInfoRequest, null)
  assert.equal(page._participantRequest, null)

  activityRequest.success({
    code: '200',
    data: { id: 12, name: '卸载后活动', startDate: '2026-08-01 19:00:00', omsTicketList: [] },
  })
  participantRequest.success({ code: '200', data: { rows: [{ id: 1, fullName: '卸载后名单' }] } })
  assert.notEqual(page.data.activityInfo.name, '卸载后活动')
  assert.equal(page.data.addressList.length, 0)
})

// ---------- B-08:深链缺 ticketId 时的票种切换 ----------

function openMultiTicketPage(overrides) {
  const page = loadPage(overrides)
  page.data.activityId = 12
  page.getActivityInfo()
  requests[0].success({
    code: '200',
    data: {
      id: 12, name: '夜行城市', startDate: '2026-08-01 19:00:00',
      omsTicketList: [
        { id: 34, name: '标准票', price: 100 },
        { id: 35, name: 'VIP 票', price: 200 },
      ],
    },
  })
  return page
}

test('B-08:多票种时票种行可点开选择,切换后金额与报价都跟新票种走', () => {
  const page = openMultiTicketPage()
  assert.equal(page.data.selectedTicket.id, 34, '缺 ticketId 仍默认第一张,行为不变')

  page.openTicketSheet()
  assert.equal(page.data.ticketSheetShow, true)
  assert.deepEqual(page.data.ticketSheetItems, ['标准票 · ¥100.00', 'VIP 票 · ¥200.00'])
  assert.equal(page.data.ticketSheetIndex, 0, '预选当前票种')

  page.onTicketSheetSelect({ detail: { index: 1 } })
  assert.equal(page.data.ticketSheetShow, false)
  assert.equal(page.data.selectedTicket.id, 35)
  assert.equal(page.data.totalAmount, 200)
  assert.equal(page.data.signupState, 'available')

  const quotes = requests.filter((request) => request.url === '/api/registration/quote')
  assert.ok(quotes.length >= 2, '切换后必须重新报价,不能复用旧 quoteSign')
  assert.equal(JSON.parse(quotes.at(-1).data).ticketId, 35)
  const waitlists = requests.filter((request) => request.url === '/api/club/event-ops/waitlist/status')
  assert.equal(JSON.parse(waitlists.at(-1).data).ticketId, 35, '候补状态也按新票种重查')
})

test('B-08:单票种保持原样,不给换票入口;候补 hold 待支付时也不给', () => {
  const single = loadPage()
  single.data.activityId = 12
  single.getActivityInfo()
  requests[0].success({
    code: '200',
    data: { id: 12, name: '夜行城市', startDate: '2026-08-01 19:00:00', omsTicketList: [{ id: 34, name: '标准票', price: 100 }] },
  })
  single.openTicketSheet()
  assert.equal(single.data.ticketSheetShow, false, '只有一个票种不发选择弹层')

  const offered = openMultiTicketPage()
  offered.setData({ waitlistState: 'OFFERED' })
  offered.openTicketSheet()
  assert.equal(offered.data.ticketSheetShow, false, 'OFFERED 是真实库存 hold,不让换票打断付款')

  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/activity/baoming/baoming.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(__dirname, '../../pages/activity/baoming/baoming.json'), 'utf8'))
  assert.match(wxml, /wx:if="\{\{ticketList\.length > 1 && waitlistState !== 'OFFERED'\}\}"[^>]*bindtap="openTicketSheet"/)
  assert.match(wxml, /<cy-option-sheet[^>]*show="\{\{ticketSheetShow\}\}"[^>]*items="\{\{ticketSheetItems\}\}"[^>]*bind:select="onTicketSheetSelect"/)
  assert.equal(json.usingComponents['cy-option-sheet'], '/components/cy/option-sheet/index')
})

test('B-08 负控:选择回调不更新 selectedTicket,主用例必须真红', () => {
  const source = fs.readFileSync(path.join(__dirname, PAGE_PATH), 'utf8')
  const broken = source.replace(
    '    const ticket = (this._ticketSheetList || [])[index];',
    '    const ticket = (this._ticketSheetList || [])[0];',
  )
  assert.notEqual(broken, source, '负控锚点失效:票种选择未命中')
  const page = openMultiTicketPage(broken)
  page.openTicketSheet()
  page.onTicketSheetSelect({ detail: { index: 1 } })
  assert.equal(page.data.selectedTicket.id, 34, '负控必须复现「选了第二张仍是第一张」')
})
