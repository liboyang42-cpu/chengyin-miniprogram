const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const PAGE_PATH = path.resolve(__dirname, '../../pages/activity/baoming/baoming.js')
let sandbox

beforeEach(() => {
  sandbox = { requests: [], tips: [], navigations: [], modals: [] }
  global.getApp = () => ({
    globalData: { user_id: 41 },
    getUserID: () => 41,
    getUserType: () => 1,
    tips: message => sandbox.tips.push(message),
    sendRequest: options => { sandbox.requests.push(options); return {} },
    recordConsent: () => Promise.resolve(),
    goBack: () => {},
    isDevEnv: () => false
  })
  global.Page = config => { sandbox.config = config }
  global.wx = {
    showModal: options => { sandbox.modals.push(options); options.success({ confirm: true }) },
    showLoading: () => {},
    hideLoading: () => {},
    showToast: options => sandbox.tips.push(options.title),
    requestPayment: () => {},
    requestSubscribeMessage: options => options.success && options.success({}),
    navigateTo: options => sandbox.navigations.push(options.url),
    redirectTo: options => sandbox.navigations.push(options.url),
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {}
  }
})

function page() {
  delete require.cache[require.resolve(PAGE_PATH)]
  require(PAGE_PATH)
  const vm = Object.assign({}, sandbox.config)
  vm.data = Object.assign({}, sandbox.config.data, {
    activityId: 31,
    selectedTicket: { id: 51, price: 80, remainingInventory: 0 },
    ticketSoldOut: true
  })
  vm.setData = function (patch, callback) {
    Object.assign(this.data, patch)
    if (callback) callback()
  }
  return vm
}

function status(vm, entry) {
  vm.loadWaitlistStatus()
  const request = sandbox.requests[sandbox.requests.length - 1]
  assert.equal(request.url, '/api/club/event-ops/waitlist/status')
  request.success({ code: 200, data: entry })
}

test('候补状态回读覆盖空、WAITING、OFFERED、CLAIMED、CONVERTED', () => {
  let vm = page()
  status(vm, { state: 'NONE', eligibilityState: 'ELIGIBLE', waitlistJoinAllowed: true })
  assert.equal(vm.data.waitlistState, 'NONE')

  vm = page()
  status(vm, { id: 61, state: 'WAITING', eligibilityState: 'ELIGIBLE', waitlistJoinAllowed: true })
  assert.equal(vm.data.waitlistState, 'WAITING')

  vm = page()
  status(vm, { id: 61, state: 'OFFERED', eligibilityState: 'ELIGIBLE', waitlistJoinAllowed: true,
    offerToken: 'raw-token', offerExpiresAt: new Date(Date.now() + 60_000).toISOString() })
  assert.equal(vm.data.waitlistState, 'OFFERED')
  assert.equal(vm.data.waitlistOfferId, 61)
  assert.equal(vm.data.waitlistOfferToken, 'raw-token')
  const quote = sandbox.requests[sandbox.requests.length - 1]
  assert.equal(quote.url, '/api/registration/quote')
  assert.deepEqual(JSON.parse(quote.data).waitlistOfferId, 61)
  vm.onUnload()

  vm = page()
  status(vm, { id: 61, state: 'CLAIMED', registrationId: 71,
    eligibilityState: 'ELIGIBLE', waitlistJoinAllowed: true })
  assert.equal(vm.data.waitlistState, 'CLAIMED')
  assert.equal(vm.data.waitlistRegistrationId, 71)

  vm = page()
  status(vm, { id: 61, state: 'CONVERTED', registrationId: 71,
    eligibilityState: 'ALREADY_REGISTERED', waitlistJoinAllowed: false })
  assert.equal(vm.data.waitlistState, 'CONVERTED')
})

test('无系列等稳定业务状态不进入 ERROR，也不会发出后端必拒绝的加入请求', () => {
  const vm = page()
  status(vm, {
    state: 'NONE',
    eligibilityState: 'NO_SERIES',
    waitlistJoinAllowed: false
  })

  assert.equal(vm.data.waitlistState, 'NONE')
  assert.equal(vm.data.waitlistEligibility, 'NO_SERIES')
  assert.equal(vm.data.waitlistError, '')
  assert.match(vm.data.waitlistPaymentText, /未配置候补/)

  const before = sandbox.requests.length
  vm.joinWaitlist()
  assert.equal(sandbox.requests.length, before)
  assert.match(sandbox.tips.at(-1), /未配置候补/)
})

test('过期 OFFERED 响应在前端立即降为 EXPIRED，清凭证且禁付', () => {
  const vm = page()
  vm.data.pageState = 'ready'
  status(vm, {
    id: 61,
    state: 'OFFERED',
    eligibilityState: 'ELIGIBLE',
    waitlistJoinAllowed: true,
    offerToken: 'stale-token',
    offerExpiresAt: '2020-01-01 00:00:00'
  })

  assert.equal(vm.data.waitlistState, 'EXPIRED')
  assert.equal(vm.data.waitlistOfferId, null)
  assert.equal(vm.data.waitlistOfferToken, '')
  assert.equal(sandbox.requests.some(item => item.url === '/api/registration/quote'), false)

  vm.data.selectedAddress = { id: 1 }
  vm.data.hostShareChecked = true
  vm.data.paymentReady = true
  vm.refreshPaymentState()
  assert.equal(vm.data.canPay, false)
  vm.handlePayment()
  assert.equal(sandbox.requests.some(item => item.url === '/api/registration/create'), false)
  assert.match(sandbox.tips.at(-1), /名额已过期/)
})

test('CANCELLED/EXPIRED 只在真实售罄且政策允许时显示可执行的重新加入动作', () => {
  let vm = page()
  status(vm, {
    id: 61,
    state: 'EXPIRED',
    eligibilityState: 'ELIGIBLE',
    waitlistJoinAllowed: true
  })
  assert.equal(vm.data.showWaitlistJoin, true)
  vm.joinWaitlist()
  assert.equal(sandbox.requests.at(-1).url, '/api/club/event-ops/waitlist/join')

  vm = page()
  vm.data.ticketSoldOut = false
  vm.data.selectedTicket.remainingInventory = 1
  status(vm, {
    id: 62,
    state: 'CANCELLED',
    eligibilityState: 'ELIGIBLE',
    waitlistJoinAllowed: true
  })
  assert.equal(vm.data.showWaitlistJoin, false)
  assert.match(vm.data.waitlistStatusDetail, /直接报名/)
  const beforeAvailableJoin = sandbox.requests.length
  vm.joinWaitlist()
  assert.equal(sandbox.requests.length, beforeAvailableJoin)
  assert.match(sandbox.tips.at(-1), /直接报名/)

  vm = page()
  status(vm, {
    id: 63,
    state: 'EXPIRED',
    eligibilityState: 'WAITLIST_CLOSED',
    waitlistJoinAllowed: false
  })
  assert.equal(vm.data.showWaitlistJoin, false)
  const beforeClosedJoin = sandbox.requests.length
  vm.joinWaitlist()
  assert.equal(sandbox.requests.length, beforeClosedJoin)
})

test('已有有效报名即使票仍有库存也禁用重复付款入口', () => {
  const vm = page()
  vm.data.pageState = 'ready'
  vm.data.ticketSoldOut = false
  vm.data.selectedTicket.remainingInventory = 3
  status(vm, {
    state: 'NONE',
    eligibilityState: 'ALREADY_REGISTERED',
    waitlistJoinAllowed: false
  })
  vm.data.selectedAddress = { id: 1 }
  vm.data.hostShareChecked = true
  vm.data.paymentReady = true
  vm.refreshPaymentState()

  assert.equal(vm.data.canPay, false)
  assert.match(vm.data.waitlistPaymentText, /已有该票种报名/)
  vm.handlePayment()
  assert.equal(sandbox.requests.some(item => item.url === '/api/registration/create'), false)
  assert.match(sandbox.tips.at(-1), /已有该票种/)
})

test('候补无权或失败明确进入 ERROR，重试读取且处理中不重复加入', () => {
  const vm = page()
  vm.loadWaitlistStatus()
  sandbox.requests[0].success({ code: 403, msg: '仅俱乐部成员可候补' })
  assert.equal(vm.data.waitlistState, 'ERROR')
  assert.match(vm.data.waitlistError, /俱乐部成员/)

  vm.retryWaitlistStatus()
  assert.equal(sandbox.requests[1].url, '/api/club/event-ops/waitlist/status')
  sandbox.requests[1].success({
    code: 200,
    data: { state: 'NONE', eligibilityState: 'ELIGIBLE', waitlistJoinAllowed: true }
  })

  vm.joinWaitlist()
  vm.joinWaitlist()
  assert.equal(sandbox.requests.filter(item => item.url.endsWith('/waitlist/join')).length, 1)
  sandbox.requests[2].fail()
  assert.equal(vm.data.waitlistState, 'ERROR')
})

test('HTTP 200 但候补 data 为空或关键字段缺失时 fail-closed 且绝不发 join', () => {
  for (const malformed of [
    null,
    {},
    { state: 'NONE', waitlistJoinAllowed: true },
    { state: 'NONE', eligibilityState: 'ELIGIBLE' },
    { state: 'UNKNOWN', eligibilityState: 'ELIGIBLE', waitlistJoinAllowed: true },
    { state: 'NONE', eligibilityState: 'UNEXPECTED', waitlistJoinAllowed: true }
  ]) {
    const vm = page()
    status(vm, malformed)

    assert.equal(vm.data.waitlistState, 'UNKNOWN')
    assert.equal(vm.data.waitlistEligibility, 'UNKNOWN')
    assert.equal(vm.data.waitlistJoinAllowed, false)
    assert.equal(vm.data.showWaitlistJoin, false)
    const before = sandbox.requests.length
    vm.joinWaitlist()
    assert.equal(sandbox.requests.length, before)
  }
})

test('售罄票未获 OFFERED 时阻止建单，有效 offer 原样进入 create', () => {
  let vm = page()
  vm.data.pageState = 'ready'
  vm.data.waitlistState = 'WAITING'
  vm.handlePayment()
  assert.equal(sandbox.requests.length, 0)
  assert.match(sandbox.tips[0], /候补排队中/)

  vm = page()
  vm.data.pageState = 'ready'
  vm.data.waitlistState = 'OFFERED'
  vm.data.waitlistOfferId = 61
  vm.data.waitlistOfferToken = 'raw-token'
  vm._waitlistOfferExpiresAt = new Date(Date.now() + 60_000).toISOString()
  vm.data.selectedAddress = { id: 1 }
  vm.data.userInfo = { realName: '成员', phone: '13800138000', email: '' }
  vm.data.hostShareChecked = true
  vm.data.hostShareConsentReady = true
  vm._hostShareConsentReady = true
  vm.data.totalAmount = 80
  vm.data.paymentReady = true
  vm._quoteSign = 'offer-quote'
  vm._initWorkflow()
  vm.handlePayment()

  const create = sandbox.requests.find(item => item.url === '/api/registration/create')
  assert.ok(create)
  const body = JSON.parse(create.data)
  assert.equal(body.waitlistOfferId, 61)
  assert.equal(body.waitlistOfferToken, 'raw-token')
  assert.equal(body.quoteSign, 'offer-quote')
})

test('OFFERED 在点击付款前刚过期时再次 fail-closed，不发 create', () => {
  const vm = page()
  vm.data.pageState = 'ready'
  vm.data.waitlistState = 'OFFERED'
  vm.data.waitlistEligibility = 'ELIGIBLE'
  vm.data.waitlistOfferId = 61
  vm.data.waitlistOfferToken = 'raw-token'
  vm._waitlistOfferExpiresAt = '2020-01-01 00:00:00'
  vm.data.selectedAddress = { id: 1 }
  vm.data.userInfo = { realName: '成员', phone: '13800138000', email: '' }
  vm.data.hostShareChecked = true
  vm.data.hostShareConsentReady = true
  vm._hostShareConsentReady = true
  vm.data.totalAmount = 80
  vm.data.paymentReady = true
  vm._quoteSign = 'offer-quote'
  vm._initWorkflow()

  vm.handlePayment()

  assert.equal(vm.data.waitlistState, 'EXPIRED')
  assert.equal(sandbox.requests.some(item => item.url === '/api/registration/create'), false)
  assert.match(sandbox.tips.at(-1), /名额已过期/)
})

test('WAITING/OFFERED 都可显式取消，确认后调用服务端取消接口', () => {
  const vm = page()
  vm.data.waitlistState = 'OFFERED'
  vm.data.waitlistOfferId = 61
  vm.data.waitlistOfferToken = 'raw-token'
  vm.cancelWaitlist()

  assert.equal(sandbox.modals.length, 1)
  assert.match(sandbox.modals[0].content, /立即让给下一位/)
  assert.equal(sandbox.requests[0].url, '/api/club/event-ops/waitlist/cancel')
  sandbox.requests[0].success({ code: 200, data: true })
  assert.equal(vm.data.waitlistState, 'LOADING')
  assert.equal(vm.data.waitlistOfferToken, '')
  assert.equal(sandbox.requests[1].url, '/api/activity/info')
})

test('候补卡只渲染状态允许的动作，稳定状态不会显示无效重试', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/activity/baoming/baoming.wxml'), 'utf8')
  assert.match(wxml, /wx:if="\{\{showWaitlistJoin\}\}"[^>]*bindtap="joinWaitlist"/)
  assert.match(wxml, /\{\{waitlistStatusTitle\}\}/)
  assert.match(wxml, /\{\{waitlistStatusDetail\}\}/)
  assert.doesNotMatch(wxml, /<cy-btn(?![^>]*wx:if)[^>]*bindtap="joinWaitlist"/)
})
