const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')

const BAOMING_PAGE = '../../pages/activity/baoming/baoming.js'

let pageConfig
let requests
let tips
let loadingShown = 0
let loadingHidden = 0

global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  getUserID: () => 9,
  tips: (msg) => { tips.push(msg) },
  sendRequest: (request) => { requests.push(request) },
  recordConsent: () => {
    const settled = {
      then(resolve) { resolve(); return settled },
      catch() { return settled },
    }
    return settled
  },
})

global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showLoading() { loadingShown += 1 },
  hideLoading() { loadingHidden += 1 },
  showToast() {},
  showModal() {},
  requestSubscribeMessage() {},
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  pageConfig = null
  requests = []
  tips = []
  loadingShown = 0
  loadingHidden = 0
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

function loadPage() {
  delete require.cache[require.resolve(BAOMING_PAGE)]
  // utils/loading.js 的原生回落带 show/hide 计数,跟页面一起重装,别让上一条用例的余额漏进来
  delete require.cache[require.resolve('../../utils/loading.js')]
  require(BAOMING_PAGE)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([path, value]) => setByPath(page.data, path, value))
    if (callback) callback()
  }
  return page
}

function readyPage() {
  const page = loadPage()
  page.data.activityId = 12
  page.data.ticketId = 34
  page.getActivityInfo()
  requests[0].success({
    code: '200',
    data: {
      id: 12,
      name: '夜行城市',
      startDate: '2026-08-01 19:00:00',
      omsTicketList: [{ id: 34, name: '标准票', price: 88 }],
    },
  })
  requests.length = 0
  return page
}

test('活动详情加载中不渲染活动卡与付款区（三态之 loading）', () => {
  const page = loadPage()
  page.data.activityId = 12

  page.getActivityInfo()

  assert.equal(page.data.pageState, 'loading')
  assert.equal(requests.length, 1)
})

test('活动详情业务码非 200 时进入 error 且不渲染付款区', () => {
  const page = loadPage()
  page.data.activityId = 12

  page.getActivityInfo()
  requests[0].success({ code: '500', msg: '活动不存在' })

  assert.equal(page.data.pageState, 'error')
  assert.match(page.data.loadErrorMsg, /活动不存在/)
})

test('活动详情 200 但 data 为空时进入 error 而不是崩在 startDate', () => {
  const page = loadPage()
  page.data.activityId = 12

  page.getActivityInfo()
  assert.doesNotThrow(() => requests[0].success({ code: '200', data: null }))

  assert.equal(page.data.pageState, 'error')
})

test('活动详情响应对象为空时进入 error 且不解引用崩溃', () => {
  const page = loadPage()
  page.data.activityId = 12

  page.getActivityInfo()
  assert.doesNotThrow(() => requests[0].success(null))

  assert.equal(page.data.pageState, 'error')
})

test('活动详情票务元素或价格类型异常时 fail-closed', () => {
  const badTickets = [
    [null],
    [{ id: 34, price: '50' }],
    [{ id: 34, price: Infinity }],
    {},
  ]
  for (const omsTicketList of badTickets) {
    requests = []
    const page = loadPage()
    page.data.activityId = 12
    page.getActivityInfo()

    assert.doesNotThrow(() => requests[0].success({
      code: '200',
      data: { id: 12, startDate: '2026-08-01 19:00:00', omsTicketList },
    }))
    assert.equal(page.data.pageState, 'error')
  }
})

test('活动详情 200 但 data 是空对象/数组时进入 error 而不是渲染 ¥0 空卡', () => {
  for (const bad of [{}, [], [{ id: 12 }], { id: '' }, { id: 0 }, { name: '夜行城市' }, 'ok', 0]) {
    requests = []
    const page = loadPage()
    page.data.activityId = 12

    page.getActivityInfo()
    requests[0].success({ code: '200', data: bad })

    assert.equal(page.data.pageState, 'error', JSON.stringify(bad) + ' 不该判为 ready')
    assert.equal(page.data.selectedTicket, null)
    assert.equal(page.data.totalAmount, 0)
  }
})

test('活动详情网络失败时进入 error', () => {
  const page = loadPage()
  page.data.activityId = 12

  page.getActivityInfo()
  requests[0].fail({ errMsg: 'request:fail' })

  assert.equal(page.data.pageState, 'error')
})

test('真实解析异常不能被吞成静默 error', () => {
  const page = loadPage()
  page.data.activityId = 12
  page.formatDateTimeForDisplay = () => { throw new Error('boom') }

  page.getActivityInfo()
  assert.throws(() => requests[0].success({
    code: '200',
    data: { id: 12, startDate: '2026-08-01 19:00:00', omsTicketList: [{ id: 34, price: 88 }] },
  }), /boom/)
})

test('有效响应进入 ready 并保留票种与金额', () => {
  const page = readyPage()

  assert.equal(page.data.pageState, 'ready')
  assert.equal(page.data.selectedTicket.id, 34)
  assert.equal(page.data.totalAmount, 88)
  assert.equal(page.data.activityInfo.name, '夜行城市')
})

test('error 态重试沿用当前 activityId/ticketId 并可回到 ready', () => {
  const page = loadPage()
  page.data.activityId = 12
  page.data.ticketId = 34

  page.getActivityInfo()
  requests[0].fail({ errMsg: 'request:fail' })
  assert.equal(page.data.pageState, 'error')

  page.retryActivityInfo()
  assert.equal(page.data.pageState, 'loading')
  assert.equal(requests.length, 2)
  assert.equal(requests[1].data.id, 12)

  requests[1].success({
    code: '200',
    data: {
      id: 12,
      name: '夜行城市',
      startDate: '2026-08-01 19:00:00',
      omsTicketList: [{ id: 34, name: '标准票', price: 88 }],
    },
  })
  assert.equal(page.data.pageState, 'ready')
  assert.equal(page.data.selectedTicket.id, 34)
})

test('非 ready 态点付款不发任何下单请求', () => {
  for (const state of ['loading', 'error']) {
    requests = []
    tips = []
    const page = readyPage()
    page.data.pageState = state
    page.data.selectedAddress = { id: 1 }
    page.data.agreementChecked = true
    page.data.hostShareChecked = true
    page.data.userInfo = { realName: '张三', phone: '13800138000', point: 0 }

    page.handlePayment()

    assert.equal(requests.length, 0, state + ' 态不能发出任何请求')
    assert.equal(page.data.isPaying, false, state + ' 态不能进入提交中')
  }
})

test('模板在非 ready 态不渲染活动卡/金额/报名勾选/付款 CTA', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(
    path.join(__dirname, '../../pages/activity/baoming/baoming.wxml'), 'utf8')

  // 行为断言:每个含付款语义的区块都必须挂在 ready 闸门上
  // (原 setly_hj 独立总计块已并入 .setly 费用明细块,闸门由 setly 那条覆盖;
  //  总计仍在闸门内这件事由下面的位置断言单独钉住,不是删掉了事。)
  const guarded = ['set', 'setbox', 'bmbottom']
  for (const cls of guarded) {
    const re = new RegExp('<view[^>]*wx:if="\\{\\{pageState === \'ready\'\\}\\}"[^>]*class="' + cls + '"'
      + '|<view[^>]*class="' + cls + '"[^>]*wx:if="\\{\\{pageState === \'ready\'\\}\\}"')
    assert.match(wxml, re, cls + ' 区块必须只在 ready 渲染')
  }
  assert.match(wxml, /wx:if="\{\{pageState === 'ready' && selectedTicket\}\}"[^>]*class="setly"/,
    '费用明细必须同时受 ready 和有效票闸门保护')
  // 总计行必须**真的嵌套在** .setly(已受 ready 闸门保护)元素内部。
  // ⚠️ 不能只判字符串先后:把总计行挪到 .setly 闭合之后,位置断言仍可能假绿。
  //    必须按标签配对取子树。
  const setlyOpen = wxml.indexOf('<view wx:if="{{pageState === \'ready\' && selectedTicket}}" class="setly">')
  assert.ok(setlyOpen > 0, '找不到 .setly 费用明细块的开标签')
  let depth = 0, i = setlyOpen, end = -1
  const tag = /<view\b|<\/view>/g
  tag.lastIndex = setlyOpen
  let m
  while ((m = tag.exec(wxml))) {
    depth += m[0] === '</view>' ? -1 : 1
    if (depth === 0) { end = m.index; break }
  }
  assert.ok(end > setlyOpen, '.setly 块标签未配平')
  const setlySubtree = wxml.slice(setlyOpen, end)
  assert.ok(setlySubtree.includes('setly_li--total'),
    '总计行必须嵌套在 ready 闸门内的 .setly 费用明细块中')
  assert.doesNotMatch(wxml, /pay-rule/, '精简后不得恢复多行付款说明')
  // 已选参与人信息也属订单表单,详情未就绪时不该展示
  assert.match(wxml, /wx:if="\{\{pageState === 'ready' && selectedAddress\}\}"[^>]*class="address-info"/)
  assert.match(wxml, /<cy-error[^>]*wx:if="\{\{pageState === 'error'\}\}"/)
  assert.match(wxml, /bind:retry="retryActivityInfo"/)
})

test('loading 态必须有可见提示，不能只是一片空白', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const dir = path.join(__dirname, '../../pages/activity/baoming')
  const wxml = fs.readFileSync(path.join(dir, 'baoming.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'baoming.json'), 'utf8'))

  // 统一状态组件负责骨架的可见性与排版，页面只需把 loading 闸接到它。
  assert.ok(json.usingComponents['cy-skeleton'], 'loading 态必须注册统一骨架组件')
  assert.match(wxml, /<cy-skeleton[^>]*wx:if="\{\{pageState === 'loading'\}\}"[^>]*type="card"/, 'loading 态需要渲染可见骨架')
})


// 回归 2026-08-01:补报价请求(BE-10 quoteSign)在 setData({isPaying:true}) + showLoading 之后
// 发出,其回调直接重入 handlePayment。而 handlePayment 开头就有 `if (isPaying) return` 守卫,
// 于是重入被自己挡住:loading 永远转、isPaying 永远 true,用户既等不到结果也无法重试
// (二次点击同样被守卫拦下)。补报价失败(含 HTTP 5xx 回落到 fail)时尤其致命。
function startPaymentNeedingQuote() {
  const page = readyPage()
  page.data.selectedTicket = { id: 34, name: '标准票', price: 88 }
  page.data.pageState = 'ready'
  page.data.paymentReady = true
  page.data.totalAmount = 88
  // 走到补报价那步前的前置闸:参与人信息必须已选,否则先跳去填地址。
  page.data.selectedAddress = { id: 7, name: '张三', phone: '13800000000' }
  page.data.addressList = [page.data.selectedAddress]
  // handlePayment 在补报价之前还有一串前置闸,逐条满足,否则测不到目标分支。
  page.data.agreementChecked = true
  page.data.hostShareChecked = true
  page.data.userInfo = { realName: '张三', phone: '13800000000' }
  page._quoteSign = ''
  page._quoteRetried = false
  page.handlePayment()
  return page
}

test('补报价失败后必须解开支付锁并关掉 loading(否则永久卡死)', () => {
  const page = startPaymentNeedingQuote()
  const quote = requests.find((r) => r.url === '/api/registration/quote')
  assert.ok(quote, '应先发出补报价请求')
  assert.equal(page.data.isPaying, true, '补报价在途时应处于提交中')

  const before = loadingHidden
  // 重入后会一路走到真正的下单(依赖 checkout workflow),那部分不在本测试边界内;
  // 这里只断言「锁解开了且真的重入了」—— 被守卫挡回的话会停在 handlePayment 开头,
  // 既不会再 showLoading,也走不到下单。
  try { quote.fail({}) } catch (e) { assert.match(String(e), /submit/, '只容忍下单阶段的未 mock 依赖') }

  // 不断言最终 isPaying=false:重入后新一轮提交会重新置 true,那是对的。
  // 决定性证据是下面两条 —— 被守卫挡回的话既不会 hideLoading 也不会有第二次 showLoading。
  assert.equal(loadingHidden, before + 1, 'loading 必须被关掉——wx.hideToast 关不掉 loading')
  assert.ok(loadingShown >= 2, '应真正重入 handlePayment,而不是被自己的 isPaying 守卫挡回')
})

test('补报价成功后同样解锁并重入,不被自己的 isPaying 守卫挡住', () => {
  const page = startPaymentNeedingQuote()
  const quote = requests.find((r) => r.url === '/api/registration/quote')
  const before = loadingHidden

  try { quote.success({ code: '200', data: { quoteSign: 'sign-abc' } }) }
  catch (e) { assert.match(String(e), /submit/, '只容忍下单阶段的未 mock 依赖') }

  assert.equal(page._quoteSign, 'sign-abc')
  assert.equal(page.data.quoteReady, true, '报价成功后必须同步可审计的 checkout 状态')
  assert.equal(loadingHidden, before + 1)
  assert.ok(loadingShown >= 2, '应真正重入而非被守卫拦下')
})

// ---------------------------------------------------------------------------
// 报名截止:详情组件入口拦过一次(scene-play-activity-detail),深链直入本页时绕过了它。
// 本仓票种 endTime 的口径就是「报名截止」(详情 wxml:82 标成「报名截止」)。

function closedTicketPatch(endTime) {
  return {
    code: '200',
    data: {
      id: 12,
      name: '夜行城市',
      startDate: '2026-08-01 19:00:00',
      omsTicketList: [{ id: 34, name: '标准票', price: 88, endTime }],
    },
  }
}

function loadWithTicketEndTime(endTime) {
  const page = loadPage()
  page.data.activityId = 12
  page.data.ticketId = 34
  page.getActivityInfo()
  requests[0].success(closedTicketPatch(endTime))
  requests.length = 0
  return page
}

function fillSignupForm(page) {
  page.data.hostShareChecked = true
  page.data.hostShareConsentReady = true
  page.data.selectedAddress = { id: 7, name: '张三', phone: '13800000000' }
  page.data.addressList = [page.data.selectedAddress]
  page.data.userInfo = { realName: '张三', phone: '13800000000' }
  page.data.paymentReady = true
}

test('深链直入已过报名截止的票:加载当刻就判 closed,不是一路填到建单才被拒', () => {
  const page = loadWithTicketEndTime('2020-01-01 10:00:00')

  assert.equal(page.data.pageState, 'ready')
  assert.equal(page.data.signupState, 'closed')
  assert.equal(page.data.signupClosed, true)
  fillSignupForm(page)
  page.refreshPaymentState()
  assert.equal(page.data.canPay, false, '已截止的票不能因为表单填满了就放行付款')
})

test('未过期与未填截止的票一律照常可报名 —— 截止闸不许臆造', () => {
  // 票种时间串是不带时区的中国时间(见 utils/datetime.js 头注),所以"未来"要取一个
  // 在任何时区里都成立的远端值 —— 拿本地 getter 拼出的小时数在本机(PDT)会被
  // 中国时区解析回过去,把这条断言变成时区敏感的假红。
  const open = loadWithTicketEndTime('2099-01-01 10:00:00')
  assert.equal(open.data.signupState, 'available')
  assert.equal(open.data.signupClosed, false)

  // 商家没填截止时间 ≠ 卖完了:与「库存未知不判售罄」同一条兜底方向
  const unset = loadWithTicketEndTime(null)
  assert.equal(unset.data.signupState, 'available')
  assert.equal(unset.data.signupClosed, false)
})

test('已截止时点付款当场给理由且不发任何下单请求', () => {
  const page = loadWithTicketEndTime('2020-01-01 10:00:00')
  fillSignupForm(page)

  page.handlePayment()

  assert.equal(requests.length, 0, '已截止不得发出报价/建单请求')
  assert.equal(page.data.isPaying, false)
  assert.match(tips.join('|'), /报名已截止/)
})

test('候补名额另算售止:拿着未过期 OFFER 的人不被票种截止误伤', () => {
  const page = loadWithTicketEndTime('2020-01-01 10:00:00')
  fillSignupForm(page)
  page.data.ticketSoldOut = true
  page.data.waitlistState = 'OFFERED'
  page.data.waitlistOfferId = 5
  page.data.waitlistOfferToken = 'offer-token'
  page._waitlistOfferExpiresAt = Date.now() + 60_000

  page.refreshPaymentState()
  assert.equal(page.data.signupClosed, false, '候补凭证在途时截止闸必须让路')
  assert.equal(page.data.canPay, true)

  page.data.waitlistState = 'EXPIRED'
  page.refreshPaymentState()
  assert.equal(page.data.signupClosed, true, '凭证一旦失效,截止闸重新落下')
  assert.equal(page.data.canPay, false)
})

test('模板把「报名已截止」说到人看得见的地方:空态与置灰 CTA 文案都另有出口', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(
    path.join(__dirname, '../../pages/activity/baoming/baoming.wxml'), 'utf8')

  assert.match(wxml, /<cy-empty[^>]*signupState === 'closed'[^>]*title="报名已截止"/,
    '已截止要有整屏可见的说明,不能只有置灰按钮')
  const payBtn = wxml.split('\n').filter((line) => line.includes('disabled="{{!canPay}}"'))
  assert.equal(payBtn.length, 1, '付款 CTA 应当只有一条')
  assert.match(payBtn[0], /signupClosed \? '报名已截止'/, '置灰的 CTA 必须自己带理由')
})
