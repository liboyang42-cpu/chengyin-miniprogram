'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
let pageConfig
let requests
let activeMemberId

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44 },
  getUserID: () => activeMemberId,
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  getWindowInfo: () => ({ statusBarHeight: 44 }),
  showToast() {},
  navigateBack() {},
  navigateTo() {},
  reLaunch() {},
  setNavigationBarColor() {},
  setBackgroundColor() {},
}

global.Page = (config) => { pageConfig = config }

function loadPage(relativePath) {
  pageConfig = null
  requests = []
  activeMemberId = 'merchant-a'
  const absolute = path.join(ROOT, relativePath)
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function allowMerchant(request) {
  assert.equal(request.url, '/api/merchant/access/me')
  request.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:verify:record:read', 'merchant:finance:read'],
    },
  })
}

function allowCrm(request, merchantId = 7) {
  assert.equal(request.url, '/api/merchant/access/me')
  request.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: merchantId, name: '测试门店' },
      roleCode: 'MERCHANT_MANAGER',
      permissions: ['merchant:basic:read', 'merchant:crm:read'],
    },
  })
}

function crmRow(memberId, name, phone) {
  return {
    memberId, name, phone: phone || null, avatar: '', contactHint: null,
    arrivedCount: 1, pendingCount: 0, refundedCount: 0, paidAmount: null,
    lastTime: '2026-08-20 10:00:00', lastAction: '最近已到店', tier: 'new', sourceType: 'TOPIC',
  }
}

function assertSecondaryStateMarkup(aiWxml, customerWxml, ledgerWxml) {
  assert.match(aiWxml, /loading\s*&&\s*!facts/, '店铺参谋只有无旧 facts 时才用首载骨架')
  assert.match(aiWxml, /error\s*&&\s*!facts/, '店铺参谋只有无旧 facts 时才用整页错误')
  assert.doesNotMatch(aiWxml, /<cy-inline-error\b[^>]*wx:if="\{\{error && facts\}\}"/,
    '店铺参谋刷新失败要保留事实层并局部提示')
  assert.match(aiWxml, /基础数据可用/, 'AI 降级必须明确基础数据仍可用')
  assert.match(aiWxml, /factState\s*===\s*'unknown'/, '店铺参谋必须区分事实未知与明确为零')
  assert.match(aiWxml, /factState\s*===\s*'empty'/, '店铺参谋只有明确零值才进入业务空态')

  assert.match(customerWxml, /<cy-error\b[^>]*wx:elif="\{\{error && !rows\.length\}\}"/,
    '客户页只有首载失败才显示整页错误')
  assert.doesNotMatch(customerWxml, /<cy-inline-error\b[^>]*wx:if="\{\{error && rows\.length\}\}"/,
    '已有客户时刷新失败静默降级,旧列表留在屏上')
  assert.match(customerWxml, /\{\{customerSummaryText\}\}/,
    '客户总量必须由标题摘要承接，未知时沿用加载中口径')
  assert.doesNotMatch(customerWxml, /class="cu-seg-num"/,
    'Figma 25:124 的分段 chip 只显示业务词，不再渲染分段计数')
  assert.match(customerWxml, /<cy-empty\b[^>]*cta="\{\{emptyCta\}\}"[^>]*bind:cta="onEmptyAction"/,
    '客户空态必须给与成因一致的唯一主动作')

  assert.match(ledgerWxml, /loading\s*&&\s*!hasLoaded/, '账本只有首载才被骨架替换')
  assert.match(ledgerWxml, /error\s*&&\s*!hasLoaded/, '账本有旧记录时不得被整页错误替换')
  assert.match(ledgerWxml, /<cy-inline-error\b[^>]*wx:if="\{\{error && hasLoaded\}\}"/,
    '账本刷新失败必须保留资金记录并原位恢复')
  assert.match(ledgerWxml,
    /class="ledger-inline-state ledger-inline-state--global"[^>]*wx:if="\{\{hasLoaded && \(loading \|\| error\)[^}]*settlementLoading\.overview[^}]*settlementErrors\.batches\}\}"[\s\S]*?正在核对商家身份与最新结算…[\s\S]*?<cy-inline-error wx:elif="\{\{error\}\}"[^>]*title="最新结算暂未取回"[^>]*action="重试"[^>]*bind:action="retry"/,
    '结算有旧金额时，身份重验 loading/error 必须显式标记 stale 并提供恢复动作')
  assert.match(ledgerWxml, /kind="missing-param"[^>]*primary="返回工作台"/,
    '账本缺参不能提供无效重试')
  assert.match(ledgerWxml, /type="merchant-metric"/, '资金首载骨架必须与金额 hero 同构')
  for (const section of ['overview', 'entries', 'batches']) {
    assert.match(ledgerWxml, new RegExp(`settlementErrors\\.${section}`),
      `结算 ${section} 必须有独立错误与恢复入口`)
  }
  assert.match(ledgerWxml, /<cy-skeleton[^>]*wx:if="\{\{settlementLoading\.overview\s*&&\s*!overview\}\}"/,
    '概览在其它区块先完成后仍要保留局部骨架')
  assert.match(ledgerWxml, /<cy-skeleton[^>]*wx:elif="\{\{settlementLoading\.entries\}\}"/,
    '收入明细在途且无缓存时不能提前冒充业务空态')
  assert.match(ledgerWxml, /!settlementLoading\.entries\s*&&\s*!settlementErrors\.entries/,
    '收入空态只能在请求成功完成且无错误时出现')
  assert.match(ledgerWxml, /<cy-skeleton[^>]*wx:elif="\{\{settlementLoading\.batches\}\}"/,
    '对公批次在途且无缓存时必须有局部加载反馈')
  assert.match(ledgerWxml, /!settlementLoading\.batches\s*&&\s*!settlementErrors\.batches/,
    '对公批次成功空列表要显示空态，错误时不能伪装为空')
}

test('店铺参谋、客户、账本采用首载与 stale-content 分层状态', () => {
  assertSecondaryStateMarkup(
    read('pages/merchant/marketing/ai-insight/index.wxml'),
    read('pages/merchant/customer/index.wxml'),
    read('pages/merchant/ledger/index.wxml'),
  )
  for (const page of [
    'pages/merchant/marketing/ai-insight/index.json',
    'pages/merchant/customer/index.json',
    'pages/merchant/ledger/index.json',
  ]) {
    assert.match(read(page), /"cy-inline-error"/, `${page} 必须注册局部错误组件`)
  }
})

test('店铺参谋和客户刷新失败保留最后一次成功内容', () => {
  const insight = loadPage('pages/merchant/marketing/ai-insight/index.js')
  insight.data.facts = { crowd: { members: 8 } }
  insight.data.valueCard = { visitors: 8 }
  insight.load()
  requests[0].fail({ msg: '网络连接失败' })
  requests[0].complete()
  assert.deepEqual(insight.data.facts, { crowd: { members: 8 } })
  assert.equal(insight.data.error, '网络连接失败')

  const customer = loadPage('pages/merchant/customer/index.js')
  customer.data.rows = [{ memberId: 7, displayName: '林野' }]
  customer.load()
  requests[0].fail()
  requests[0].complete()
  assert.deepEqual(customer.data.rows, [{ memberId: 7, displayName: '林野' }])
  assert.match(customer.data.error, /网络连接失败/)
})

test('客户页分群失败时保留旧数据并提供局部重试', () => {
  const customer = loadPage('pages/merchant/customer/index.js')
  customer.data.savedSegments = [{ id: 3, name: '复购客' }]

  customer.loadSavedSegments()
  requests.at(-1).success({ code: 500, msg: '分群服务失败' })
  assert.deepEqual(customer.data.savedSegments, [{ id: 3, name: '复购客' }])
  assert.equal(customer.data.savedSegmentsError, '分群服务失败')

  const wxml = read('pages/merchant/customer/index.wxml')
  assert.equal((wxml.match(/<cy-inline-error[^>]*wx:if="\{\{savedSegmentsError\}\}"[^>]*bind:action="loadSavedSegments"/g) || []).length, 1)
})

test('客户页辅助列表只接受最后一次请求结果', () => {
  const customer = loadPage('pages/merchant/customer/index.js')
  const cases = [
    {
      load: 'loadSavedSegments', dataKey: 'savedSegments', errorKey: 'savedSegmentsError',
      fresh: [{ id: 5, name: '新分群' }], stale: [{ id: 4, name: '旧分群' }],
    },
  ]

  cases.forEach((item) => {
    customer[item.load]()
    const staleRequest = requests.at(-1)
    customer[item.load]()
    const freshRequest = requests.at(-1)
    freshRequest.success({ code: 200, data: item.fresh })
    staleRequest.success({ code: 200, data: item.stale })
    staleRequest.fail()
    assert.equal(customer.data[item.dataKey][0].id, item.fresh[0].id)
    if (item.errorKey) assert.equal(customer.data[item.errorKey], '')
  })
})

test('店铺参谋只接受最后一次请求，卸载后迟到回调不得继续写页', () => {
  const insight = loadPage('pages/merchant/marketing/ai-insight/index.js')
  insight.load()
  insight.load()
  const oldRequest = requests[0]
  const freshRequest = requests[1]
  const response = (visitors) => ({
    code: 200,
    data: { facts: { attribution: { visitors, checkins: 1, redeems: 1 } } },
  })

  freshRequest.success(response(22))
  freshRequest.complete()
  oldRequest.success(response(11))
  oldRequest.complete()
  assert.equal(insight.data.valueCard.visitors, '22')

  insight.load()
  const lateRequest = requests[2]
  let postUnloadWrites = 0
  const originalSetData = insight.setData
  insight.setData = function (patch) { postUnloadWrites += 1; originalSetData.call(this, patch) }
  insight.onUnload()
  lateRequest.success(response(33))
  lateRequest.fail({ msg: '迟到失败' })
  lateRequest.complete()
  assert.equal(postUnloadWrites, 0)
})

test('店铺参谋切换商家主体时立即清空上一商家的敏感展示', () => {
  const insight = loadPage('pages/merchant/marketing/ai-insight/index.js')
  insight.load()
  requests[0].success({
    code: 200,
    data: {
      facts: { attribution: { visitors: 9, checkins: 3, redeems: 1 } },
      ai: { summary: 'A 商家建议' },
      profile: { configured: true },
      recentVisitors: [{ memberId: 7, displayName: 'A 商家顾客' }],
    },
  })
  requests[0].complete()
  assert.equal(insight.data.valueCard.visitors, '9')

  activeMemberId = 'merchant-b'
  insight.onShow()
  assert.equal(requests.length, 2, '主体变化必须立即发起新主体请求')
  assert.equal(insight.data.facts, null)
  assert.equal(insight.data.ai, null)
  assert.equal(insight.data.profile, null)
  assert.deepEqual(insight.data.recentVisitors, [])
  assert.equal(insight.data.valueCard, null)

  requests[1].fail({ msg: 'B 商家网络失败' })
  requests[1].complete()
  assert.equal(insight.data.facts, null, 'B 请求失败后也不能恢复 A 的事实数据')
  assert.equal(insight.data.error, 'B 商家网络失败')
})

test('客户页请求与展示都绑定商家主体，A 数据不得进入 B 视角', () => {
  const pending = loadPage('pages/merchant/customer/index.js')
  pending.onLoad()
  const requestA = requests[0]
  activeMemberId = 'merchant-b'
  allowCrm(requestA)
  assert.deepEqual(pending.data.rows, [], 'A 在途响应不得写入 B 视角')
  assert.equal(requests.length, 1, 'A 的迟到身份不得为 B 发起客户请求')

  const rendered = loadPage('pages/merchant/customer/index.js')
  rendered.onLoad()
  allowCrm(requests[0])
  const customerA = requests.find((request) => request.url === '/api/merchant/crm/customers/list')
  customerA.success({
    code: 200,
    data: {
      rows: [crmRow(8, 'A 已显示客户', '13900000000')],
      total: 1,
      segmentCounts: { all: 1, pending: 0, repeat: 0, dormant: 0, abnormal: 0 },
    },
  })
  customerA.complete()
  assert.equal(rendered.data.rows.length, 1)
  const savedSegmentsA = requests.find((request) => request.url === '/api/merchant/crm/segments')
  Object.assign(rendered.data, {
    availableTags: [{ id: 2, name: '高价值' }],
    selecting: true,
    selectedIds: [8],
    batchTagName: '高价值',
    savedSegments: [{ id: 3, name: '复购客' }],
    segmentName: '复购客',
    exportTask: { taskId: 'export-a' },
    exportState: 'polling',
  })
  rendered._exportToken = 'export-token-a'
  activeMemberId = 'merchant-b'
  const beforeShowRequests = requests.length
  rendered.onShow()
  savedSegmentsA.success({ code: 200, data: [{ id: 3, name: 'A 迟到分群' }] })
  assert.deepEqual(rendered.data.rows, [], '返回页面时必须先清 A 客户敏感数据')
  assert.deepEqual(rendered.data.availableTags, [], '标签候选也属于商家主体数据')
  assert.deepEqual(rendered.data.selectedIds, [], '批量选择不得跨主体保留')
  assert.deepEqual(rendered.data.savedSegments, [], '保存分群不得跨主体保留')
  assert.equal(rendered.data.exportTask, null, '导出任务不得跨主体轮询')
  assert.equal(rendered._exportToken, '', '换主体必须作废导出轮询 token')
  assert.equal(requests.length, beforeShowRequests + 1, '清场后必须为 B 重新确认客户权限')
})

test('账本请求与已渲染资金都绑定商家主体，换号立即失效并清场', () => {
  const pending = loadPage('pages/merchant/ledger/index.js')
  pending.loadRedemptions()
  const requestA = requests[0]
  activeMemberId = 'merchant-b'
  requestA.success({
    code: 200,
    data: {
      rows: [{ recordKey: 'a-secret', signedAmount: 88, displayState: 'SETTLED' }],
      total: 1,
      summary: { count: 1, pendingAmount: 0, arrivedAmount: 88 },
    },
  })
  assert.deepEqual(pending.data.redemptions, [], 'A 在途账本响应不得写入 B 视角')

  const rendered = loadPage('pages/merchant/ledger/index.js')
  rendered._scopeMemberId = 'merchant-a'
  Object.assign(rendered.data, {
    view: 'settlement',
    hasLoaded: true,
    overview: { personalNetDisplay: '¥88.00' },
    entries: [{ entryKey: 'a-entry' }],
    batches: [{ batchId: 'a-batch' }],
  })
  activeMemberId = 'merchant-b'
  rendered.onShow()
  assert.equal(rendered.data.overview, null)
  assert.deepEqual(rendered.data.entries, [])
  assert.deepEqual(rendered.data.batches, [])
  assert.equal(rendered.data.hasLoaded, false)
  allowMerchant(requests[0])
  assert.deepEqual(requests.slice(1).map((item) => item.url), [
    '/api/merchant/finance/overview',
    '/api/merchant/finance/settlement-entries',
    '/api/merchant/finance/public-transfer-batches',
  ])
})

test('同账号商家资格被撤销后，返回页面必须重验并清除客户、资金与 AI 敏感缓存', () => {
  const insight = loadPage('pages/merchant/marketing/ai-insight/index.js')
  insight.onLoad()
  insight.onShow()
  requests[0].success({
    code: 200,
    data: {
      facts: { attribution: { visitors: 6, checkins: 2, redeems: 1 } },
      ai: { summary: '仅商家可见' },
      profile: { configured: true },
      recentVisitors: [{ memberId: 7, displayName: '敏感访客' }],
    },
  })
  requests[0].complete()
  insight.onShow()
  assert.equal(requests.length, 2, '返回店铺参谋时必须重新确认服务端商家资格')
  // 当前后端 gate 用 AjaxResult.error(String)，HTTP 200 + 业务 code=500。
  requests[1].success({ code: 500, msg: '仅商家可使用店铺参谋' })
  requests[1].complete()
  assert.equal(insight.data.facts, null)
  assert.equal(insight.data.ai, null)
  assert.equal(insight.data.profile, null)
  assert.deepEqual(insight.data.recentVisitors, [])

  const customer = loadPage('pages/merchant/customer/index.js')
  customer.onLoad()
  customer.onShow()
  allowCrm(requests[0])
  const customerList = requests.find((request) => request.url === '/api/merchant/crm/customers/list')
  customerList.success({
    code: 200,
    data: {
      rows: [crmRow(8, '敏感客户', '13900000000')],
      total: 1,
      segmentCounts: { all: 1, pending: 0, repeat: 0, dormant: 0, abnormal: 0 },
    },
  })
  customerList.complete()
  customer.onShow()
  const revokedAccess = requests.filter((request) => request.url === '/api/merchant/access/me').at(-1)
  assert.notEqual(revokedAccess, requests[0], '返回客户页时必须重新确认服务端商家资格')
  revokedAccess.success({ code: 500, msg: '仅启用且审核通过的商家可查看客户名册' })
  assert.deepEqual(customer.data.rows, [])
  assert.equal(customer.data.segments.every((segment) => segment.count === null), true)

  const customerHttpDenied = loadPage('pages/merchant/customer/index.js')
  customerHttpDenied.data.rows = [{ memberId: 9, displayName: 'HTTP 拒权前客户', phoneText: '13800000000' }]
  customerHttpDenied.load()
  requests[0].fail({ statusCode: 403, errMsg: 'request:fail forbidden' })
  requests[0].complete()
  assert.deepEqual(customerHttpDenied.data.rows, [], 'HTTP 403 走 fail 回调时也必须清除姓名与手机号')

  const ledger = loadPage('pages/merchant/ledger/index.js')
  ledger.onLoad({ view: 'redemptions' })
  ledger.onShow()
  assert.equal(requests[0].url, '/api/merchant/access/me', '资金接口前必须先走商家域身份闸')
  requests[0].success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:verify:record:read', 'merchant:finance:read'],
    },
  })
  requests[1].success({
    code: 200,
    data: {
      rows: [{ recordKey: 'secret', settlementAmount: 88, displayState: 'SETTLED' }],
      total: 1,
      summary: { count: 1, pendingAmount: 0, arrivedAmount: 88 },
    },
  })
  ledger.onShow()
  assert.equal(requests.length, 3, '返回账本时必须先重新确认服务端商家资格')
  assert.equal(requests[2].url, '/api/merchant/access/me')
  requests[2].success({
    code: 200,
    data: {
      active: false,
      merchant: null,
      roleCode: '',
      permissions: [],
    },
  })
  assert.equal(requests.length, 3, '撤权后不得继续请求缺少服务端商家 gate 的资金接口')
  assert.deepEqual(ledger.data.redemptions, [])
  assert.deepEqual(ledger.data.redemptionGroups, [])
  assert.equal(ledger.data.summary, null)
  assert.equal(ledger.data.hasLoaded, false)
})

test('账本刷新失败保留已确认记录，未知金额不格式化为 ¥0', () => {
  const ledger = loadPage('pages/merchant/ledger/index.js')
  const row = { recordKey: 'r1', dayKey: '2026-08-23' }
  ledger.data.hasLoaded = true
  ledger.data.redemptions = [row]
  ledger.data.redemptionGroups = [{ dayKey: row.dayKey, rows: [row] }]
  ledger.loadRedemptions()
  requests[0].success(null)
  assert.deepEqual(ledger.data.redemptions, [row])
  assert.equal(ledger.data.error, true)
  assert.equal(ledger.data.hasLoaded, true)

  requests = []
  ledger._scopeMemberId = activeMemberId
  ledger.onShow()
  requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.deepEqual(ledger.data.redemptions, [row], '身份探针普通断网不得冒充撤权并清空已确认账本')
  assert.equal(ledger.data.hasLoaded, true)
  assert.equal(ledger.data.loading, false)
  assert.equal(ledger.data.error, true)

  assert.equal(ledger.entryRow({ signedAmount: null, occurredAt: '', displayState: 'PENDING_SETTLEMENT' }).amountDisplay,
    '待定')
  assert.equal(ledger.batchRow({ amountTotal: null, displayState: 'PENDING_SETTLEMENT' }).amountDisplay,
    '待定')
})

test('结算身份重验与断网时保留旧金额，但全程显式标记 stale 状态', () => {
  const ledger = loadPage('pages/merchant/ledger/index.js')
  ledger._scopeMemberId = activeMemberId
  ledger._skipNextShowReload = false
  Object.assign(ledger.data, {
    view: 'settlement',
    hasLoaded: true,
    overview: { personalNetDisplay: '¥88.00' },
    entries: [{ entryKey: 'confirmed-entry' }],
    batches: [{ batchId: 'confirmed-batch' }],
  })

  ledger.onShow()
  assert.equal(requests[0].url, '/api/merchant/access/me')
  assert.equal(ledger.data.loading, true)
  assert.equal(ledger.data.error, false)
  assert.equal(ledger.data.hasLoaded, true)
  assert.equal(ledger.data.overview.personalNetDisplay, '¥88.00')

  requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(ledger.data.loading, false)
  assert.equal(ledger.data.error, true)
  assert.equal(ledger.data.hasLoaded, true)
  assert.equal(ledger.data.overview.personalNetDisplay, '¥88.00')
  assert.deepEqual(ledger.data.entries.map((item) => item.entryKey), ['confirmed-entry'])
})

test('账本汇总缺笔数或金额非法时整条隐藏，不伪造 0 笔或 ¥null', () => {
  const missingCount = loadPage('pages/merchant/ledger/index.js')
  missingCount.data.merchantAccess = { canReadFinance: true }
  missingCount.loadRedemptions()
  requests[0].success({
    code: 200,
    data: { rows: [], total: 0, summary: { pendingAmount: 12, arrivedAmount: 8 } },
  })
  assert.equal(missingCount.data.summary, null)

  const invalidMoney = loadPage('pages/merchant/ledger/index.js')
  invalidMoney.data.merchantAccess = { canReadFinance: true }
  invalidMoney.loadRedemptions()
  requests[0].success({
    code: 200,
    data: { rows: [], total: 0, summary: { count: 2, pendingAmount: 'bad', arrivedAmount: 8 } },
  })
  assert.equal(invalidMoney.data.summary, null)
})

test('结算概览未知净额不得被描述成已净入账', () => {
  const ledger = loadPage('pages/merchant/ledger/index.js')
  ;[null, undefined, '', 'bad'].forEach((value) => {
    const overview = ledger.overviewRow({ personalArrivedThisMonthNet: value })
    assert.equal(overview.netLabel, '状态待定')
    assert.equal(overview.personalNetDisplay, '待定')
  })
  assert.equal(ledger.overviewRow({ personalArrivedThisMonthNet: -2 }).netLabel, '净调整')
  assert.equal(ledger.overviewRow({ personalArrivedThisMonthNet: 2 }).netLabel, '净入账')
})

test('账本三路结算独立提交：成功区块更新，失败区块保留旧内容并可局部重试', () => {
  const ledger = loadPage('pages/merchant/ledger/index.js')
  const previous = {
    overview: { personalNetDisplay: '¥88.00' },
    entries: [{ entryKey: 'e-old' }],
    batches: [{ batchId: 'b-old' }],
  }
  Object.assign(ledger.data, previous, { view: 'settlement', hasLoaded: true })

  ledger.loadSettlement()
  assert.equal(requests.length, 3)
  requests[0].success({ code: 200, data: { personalArrivedThisMonthNet: '90.00' } })
  requests[1].fail()
  requests[2].success({ code: 200, data: { rows: [], total: 0 } })

  assert.equal(ledger.data.loading, false, '失败响应也必须让三路聚合结束，不能无限 loading')
  assert.equal(ledger.data.error, true)
  assert.equal(ledger.data.hasLoaded, true)
  assert.equal(ledger.data.overview.personalNetDisplay, '¥90.00')
  assert.deepEqual(ledger.data.entries, previous.entries)
  assert.deepEqual(ledger.data.batches, [])
  assert.equal(ledger.data.settlementErrors.overview, '')
  assert.match(ledger.data.settlementErrors.entries, /收入明细/)
  assert.equal(ledger.data.settlementErrors.batches, '')

  requests = []
  ledger.retrySettlementEntries()
  allowMerchant(requests[0])
  assert.deepEqual(requests.slice(1).map((item) => item.url), ['/api/merchant/finance/settlement-entries'])
})

test('账本首载任一区块先成功时立即露出该区块，不被最慢请求继续整页遮挡', () => {
  const ledger = loadPage('pages/merchant/ledger/index.js')
  ledger.data.view = 'settlement'
  ledger.loadSettlement()

  requests[0].success({ code: 200, data: { personalArrivedThisMonthNet: 12 } })

  assert.equal(ledger.data.hasLoaded, true)
  assert.equal(ledger.data.loading, true, '其它区块仍在加载时保留局部 loading')
  assert.equal(ledger.data.overview.personalNetDisplay, '¥12.00')
  assert.equal(ledger.data.settlementLoading.overview, false)
  assert.equal(ledger.data.settlementLoading.entries, true)
})

test('账本卸载后结算三路迟到回调不得继续写页', () => {
  const ledger = loadPage('pages/merchant/ledger/index.js')
  ledger.data.view = 'settlement'
  ledger.loadSettlement()
  const pending = requests.slice()
  let postUnloadWrites = 0
  const originalSetData = ledger.setData
  ledger.setData = function (patch) { postUnloadWrites += 1; originalSetData.call(this, patch) }

  ledger.onUnload()
  pending[0].success({ code: 200, data: { personalArrivedThisMonthNet: 12 } })
  pending[1].fail()
  pending[2].success({ code: 200, data: { rows: [], total: 0 } })

  assert.equal(postUnloadWrites, 0)
})

test('结算任一路被拒绝后，另外两路迟到回调不得复活成功态或清掉拒绝错误', () => {
  const ledger = loadPage('pages/merchant/ledger/index.js')
  ledger.data.view = 'settlement'
  ledger.loadSettlement()
  assert.equal(requests.length, 3)

  requests[0].success({ code: 403, msg: '商家资格已失效' })
  requests[1].success({ code: 200, data: { rows: [{ entryKey: 'late-entry' }], total: 1 } })
  requests[2].success({ code: 200, data: { rows: [{ batchId: 'late-batch' }], total: 1 } })

  assert.equal(ledger.data.error, true)
  assert.equal(ledger.data.hasLoaded, false)
  assert.equal(ledger.data.overview, null)
  assert.deepEqual(ledger.data.entries, [])
  assert.deepEqual(ledger.data.batches, [])
})

test('账本切换筛选后忽略上一筛选的迟到响应', () => {
  const ledger = loadPage('pages/merchant/ledger/index.js')
  ledger.data.merchantAccess = { active: true, canReadFinance: true }
  ledger.data.redemptionFilter = 'all'
  ledger.loadRedemptions()
  const allRequest = requests[0]

  ledger.onRedemptionFilter({ detail: { key: 'pending' } })
  allowMerchant(requests[1])
  const pendingRequest = requests[2]
  pendingRequest.success({
    code: 200,
    data: { rows: [{ recordKey: 'pending-1', displayState: 'PENDING_SETTLEMENT' }], total: 1 },
  })
  allRequest.success({
    code: 200,
    data: { rows: [{ recordKey: 'all-late', displayState: 'SETTLED' }], total: 1 },
  })

  assert.equal(ledger.data.redemptionFilter, 'pending')
  assert.deepEqual(ledger.data.redemptions.map((item) => item.recordKey), ['pending-1'])
})

test('账本快速重试两个结算区块时，两路结果都能独立完成', () => {
  const ledger = loadPage('pages/merchant/ledger/index.js')
  ledger.data.view = 'settlement'
  ledger.data.hasLoaded = true
  ledger.data.settlementErrors = { overview: '概览失败', entries: '明细失败', batches: '' }

  ledger.retrySettlementOverview()
  ledger.retrySettlementEntries()
  assert.equal(requests.length, 2)
  allowMerchant(requests[1])
  allowMerchant(requests[0])
  requests[2].success({ code: 200, data: { rows: [{ entryKey: 'e-new', signedAmount: 6 }], total: 1 } })
  requests[3].success({ code: 200, data: { personalArrivedThisMonthNet: 12 } })

  assert.equal(ledger.data.overview.personalNetDisplay, '¥12.00')
  assert.deepEqual(ledger.data.entries.map((item) => item.entryKey), ['e-new'])
  assert.equal(ledger.data.settlementLoading.overview, false)
  assert.equal(ledger.data.settlementLoading.entries, false)
  assert.equal(ledger.data.loading, false)
})

test('AI 事实未知不冒充有数,数字位写 0、状态位说实话(2026-09-19 用户裁决)', () => {
  const insight = loadPage('pages/merchant/marketing/ai-insight/index.js')
  const unknown = insight._buildValueCard({ attribution: {} })
  // ★数字位不再是状态位:未知写 0,「这不是零」由下面的 factState 与 lowSample 提示表达。
  assert.equal(unknown.visitors, '0')
  assert.equal(unknown.checkins, '0')
  assert.equal(insight._buildMetricCards({ checkin: {}, crowd: {}, supply: {} })[0].num, '0%')

  insight.load()
  requests[0].success({ code: 200, data: { facts: { attribution: {} } } })
  requests[0].complete()
  assert.equal(insight.data.factState, 'unknown')

  insight.load()
  requests[1].success({ code: 200, data: { facts: { attribution: { visitors: 0, checkins: 0, redeems: 0 } } } })
  requests[1].complete()
  assert.equal(insight.data.factState, 'empty')

  insight.load()
  requests[2].success({ code: 200, data: { facts: { attribution: { visitors: 2, checkins: 1, redeems: 0 } } } })
  requests[2].complete()
  assert.equal(insight.data.factState, 'ready')
})

test('客户分段缺失保持未知，三类空态都有正确恢复动作', () => {
  const customer = loadPage('pages/merchant/customer/index.js')
  assert.ok(customer.data.segments.every((item) => item.count === null))
  assert.equal(customer.data.customerSummaryText, '客户数量加载中')

  customer.data.keyword = '不存在'
  assert.equal(customer._emptyCopy(customer.data.segments).emptyAction, 'clear-search')
  customer.data.keyword = ''
  customer.data.segment = 'repeat'
  assert.equal(customer._emptyCopy(customer.data.segments).emptyAction, 'clear-filter')
  customer.data.segment = 'all'
  assert.equal(customer._emptyCopy(customer.data.segments).emptyAction, 'retry')

  const zeroSegments = customer.data.segments.map((item) => Object.assign({}, item, { count: 0 }))
  assert.equal(customer._emptyCopy(zeroSegments).emptyAction, 'go-coop')
})

// CU-M-120 / CU-M-147:分段标签本身带「客」,再拼一次「客户」会念成「回头客客户」。
// CU-M-143:关键词非空时旧实现无条件先回「换个姓名再试试」,而真正原因是当前分段没人 ——
// 同一个词切回「全部」就能命中,这句把人往错的方向推。
test('客户分段空态不重复「客」，带关键词时按分段给恢复动作', () => {
  const customer = loadPage('pages/merchant/customer/index.js')
  const segments = customer.data.segments

  customer.data.keyword = ''
  customer.data.segment = 'repeat'
  assert.equal(customer._emptyCopy(segments).emptyTitle, '还没有回头客')
  customer.data.segment = 'new'
  assert.equal(customer._emptyCopy(segments).emptyTitle, '还没有新客')
  customer.data.segment = 'noted'
  assert.equal(customer._emptyCopy(segments).emptyTitle, '还没有有备注的客户')

  customer.data.keyword = '城瘾'
  customer.data.segment = 'repeat'
  const inSegment = customer._emptyCopy(segments)
  assert.equal(inSegment.emptyTitle, '这个分组没有匹配客户')
  assert.equal(inSegment.emptyAction, 'clear-filter')
  assert.ok(inSegment.emptyTitle.indexOf('换个姓名') < 0)
  assert.ok(inSegment.emptySub.indexOf('换个姓名') < 0)

  customer.data.segment = 'all'
  assert.equal(customer._emptyCopy(segments).emptyAction, 'clear-search')
})

test('客户换搜索条件后不在新条件下展示上一查询的姓名和电话', () => {
  const customer = loadPage('pages/merchant/customer/index.js')
  customer._renderedQueryKey = JSON.stringify({ keyword: '', segment: 'all' })
  customer.data.rows = [{ memberId: 1, displayName: '上一位客户', phoneText: '13800000000' }]
  customer.data.keyword = '新名字'
  customer.load()
  assert.deepEqual(customer.data.rows, [])
  assert.equal(requests[0].url, '/api/merchant/crm/customers/list')
})

test('负控：恢复整页互斥错误或把未知金额写成零时必须判红', () => {
  const ai = read('pages/merchant/marketing/ai-insight/index.wxml')
  const customer = read('pages/merchant/customer/index.wxml')
  const ledger = read('pages/merchant/ledger/index.wxml')
  const mutatedAi = ai.replace(/error\s*&&\s*!facts/, 'error')
  const mutatedCustomer = customer.replace(/error\s*&&\s*!rows\.length/, 'error')
  const mutatedLedger = ledger.replace(/error\s*&&\s*!hasLoaded/, 'error')
  assert.throws(() => assertSecondaryStateMarkup(mutatedAi, mutatedCustomer, mutatedLedger),
    /无旧 facts|首载失败|有旧记录/)

  const page = loadPage('pages/merchant/ledger/index.js')
  const mutant = Object.assign({}, page, {
    entryRow(row) { return { amountDisplay: `¥${Number(row.signedAmount || 0).toFixed(2)}` } },
  })
  assert.notEqual(mutant.entryRow({ signedAmount: null }).amountDisplay, '待定',
    '负控必须能制造未知金额冒充 ¥0')

  const fabricatedAi = ai.replace(/factState\s*===\s*'unknown'/g, "factState === 'empty'")
  assert.throws(() => assertSecondaryStateMarkup(fabricatedAi, customer, ledger), /区分事实未知/)

  const missingCustomerSummary = customer.replace(/\{\{customerSummaryText\}\}/, '0 位')
  assert.throws(() => assertSecondaryStateMarkup(ai, missingCustomerSummary, ledger), /标题摘要/)

  const missingSettlementStale = ledger.replace(
    /\n\s*<view class="ledger-inline-state ledger-inline-state--global"[\s\S]*?<\/view>\n/,
    '\n',
  )
  assert.throws(() => assertSecondaryStateMarkup(ai, customer, missingSettlementStale),
    /结算有旧金额时/,
    '负控必须证明移除结算身份重验状态条会判红')
})
