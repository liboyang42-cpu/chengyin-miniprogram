'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
let pageConfig
let requests

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44 },
  getUserID: () => 'merchant-a',
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  navigateTo() {},
  makePhoneCall() {},
  setNavigationBarColor() {},
  setBackgroundColor() {},
}

global.Page = (config) => { pageConfig = config }

function loadPage() {
  pageConfig = null
  requests = []
  const absolute = path.join(ROOT, 'pages/merchant/customer/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

function customerRow(id, name, overrides) {
  return Object.assign({
    memberId: id,
    name,
    avatar: '',
    phone: null,
    contactHint: '需要客户敏感信息权限',
    arrivedCount: 1,
    pendingCount: 0,
    refundedCount: 0,
    paidAmount: null,
    lastTime: '2026-08-20T10:00:00.000+08:00',
    lastAction: '最近已到店',
    tier: 'new',
    sourceType: 'TOPIC',
  }, overrides || {})
}

function customerResponse(id, name) {
  return {
    code: 200,
    data: {
      rows: [customerRow(id, name)],
      total: 40,
      segmentCounts: { all: 40, pending: 0, repeat: 0, dormant: 0, abnormal: 0 },
    },
  }
}

test('已渲染 A 后输入 B 的 debounce 窗口内，loadMore 不得把 B 分页追加到 A', () => {
  const page = loadPage()
  page.data.keyword = 'A'
  page.load()
  requests[0].success(customerResponse(101, 'A 客户'))
  requests[0].complete()
  assert.deepEqual(page.data.rows.map((row) => row.memberId), [101])

  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  let deferredSearch
  global.setTimeout = (callback) => {
    deferredSearch = callback
    return 1
  }
  global.clearTimeout = () => {}

  try {
    page.onKeywordInput({ detail: { value: 'B' } })
    assert.equal(typeof deferredSearch, 'function', 'B 查询应仍在 debounce 等待期')

    page.loadMore()
    const leakedRequest = requests[1]
    if (leakedRequest) {
      leakedRequest.success(customerResponse(221, 'B 客户'))
      leakedRequest.complete()
    }

    assert.deepEqual(page.data.rows.map((row) => row.memberId), [101],
      'B 的分页响应不得混入仍显示 A 的客户列表')
    assert.equal(requests.length, 1, '查询键切到 B 后不得继续发出 A 列表的分页请求')
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
})

test('keyword 与 segment 均未变化时仍可加载下一页', () => {
  const page = loadPage()
  page.data.keyword = 'A'
  page.load()
  requests[0].success(customerResponse(101, 'A 客户'))
  requests[0].complete()

  page.loadMore()
  assert.equal(requests.length, 2)
  assert.deepEqual(JSON.parse(requests[1].data), {
    pageNum: 2,
    pageSize: 20,
    keyword: 'A',
    segment: 'all',
    tagId: null,
    sourceType: null,
    sourceStart: null,
    sourceEnd: null,
  })

  requests[1].success(customerResponse(121, 'A 客户 21'))
  requests[1].complete()
  assert.deepEqual(page.data.rows.map((row) => row.memberId), [101, 121])
})

test('客户名单缺失 total 时不得把满页误判成没有更多', () => {
  const page = loadPage()
  page.load()
  requests[0].success({
    code: 200,
    data: {
      rows: Array.from({ length: 20 }, (_, index) => customerRow(index + 1, `客户${index + 1}`)),
      segmentCounts: { all: 20 },
    },
  })
  requests[0].complete()

  assert.deepEqual(page.data.rows, [])
  assert.match(page.data.error, /加载失败/)
  assert.equal(page._hasMore, true)
})

test('客户名单任一畸形行都整页 fail-closed，不能过滤或默认成可点击客户', () => {
  const malformedRows = [
    customerRow(7, '缺主键', { memberId: null }),
    customerRow(8, '布尔主键', { memberId: true }),
    customerRow(9, '未知层级', { tier: 'vip' }),
    customerRow(10, '负数计数', { pendingCount: -1 }),
    customerRow(11, '未知来源', { sourceType: 'FOREIGN' }),
  ]

  for (const malformed of malformedRows) {
    const page = loadPage()
    page.data.rows = [customerRow(99, '上一份可信客户')]
    page._hasMore = false
    page.load()
    requests[0].success({
      code: 200,
      data: {
        rows: [customerRow(12, '合法行'), malformed],
        total: 2,
        segmentCounts: { all: 2, pending: 0, repeat: 0, dormant: 0, abnormal: 0 },
      },
    })
    requests[0].complete()

    assert.deepEqual(page.data.rows.map((row) => row.memberId), [99], JSON.stringify(malformed))
    assert.match(page.data.error, /数据.*异常|加载失败/, JSON.stringify(malformed))
    assert.equal(page._hasMore, false, '畸形 200 不得推进可信分页状态')
  }
})

test('客户页卸载会取消待执行的关键词防抖，不在离页后发新请求', () => {
  const page = loadPage()
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout
  const cleared = []
  let deferred
  global.setTimeout = (callback) => { deferred = callback; return 17 }
  global.clearTimeout = (timer) => { cleared.push(timer) }

  try {
    page.onKeywordInput({ detail: { value: '离页搜索' } })
    page.onUnload()
    assert.deepEqual(cleared, [17])
    deferred()
    assert.equal(requests.length, 0)
  } finally {
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  }
})

test('客户 access/me 业务失败或非法角色即使夹带权限数据也必须关闭', () => {
  for (const data of [
    {
      active: true,
      merchant: { id: 7, name: '残留门店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:crm:read', 'merchant:crm:segment'],
    },
    {
      active: true,
      merchant: { id: 7, name: '非法角色门店' },
      roleCode: 'UNKNOWN_ROLE',
      permissions: ['merchant:crm:read', 'merchant:crm:segment'],
    },
  ]) {
    const page = loadPage()
    page.onLoad()
    requests[0].success({ code: data.roleCode === 'UNKNOWN_ROLE' ? 200 : 500, data })
    assert.equal(page.data.noPermission, true)
    assert.equal(page.data.canSegment, false)
    assert.equal(requests.length, 1, '非法身份不得继续请求客户数据')
  }
})

/**
 * CU-M-146:castCount 是底栏「当前筛选 · N 人」和「定向广播」按钮的唯一依据,
 * 但它只在成功回包里写。换分段/换筛选后不跟着名单一起清,就会在新一轮请求
 * 还没回来的窗口里继续报上一分段的人数(走查读到的「全部 1 人」配「回头客 0 人」)。
 */
test('换分段后到本次请求回来之前，底栏不得沿用上一分段的人数', () => {
  const page = loadPage()
  page.load()
  requests[0].success(customerResponse(101, '甲'))
  assert.equal(page.data.castCount, 40)

  page.data.segment = 'repeat'
  page.load()
  assert.equal(page.data.castCount, 0, '这一版还没回，人数该空着，不是上一分段的 40')

  // 失败同样不许留旧数：_clearScopedData 与名单一起清
  requests[1].success({ code: 500, msg: 'boom' })
  assert.equal(page.data.castCount, 0)
})

/**
 * CU-M-102：页头「N 位 · 本月新增 M」改成全量口径后，空态判据得跟着换 ——
 * 标签/来源筛空名单时，segmentCounts 依然有 12 位，沿用旧兜底就会把
 * 「筛没了」报成「名单这次没取回来」，把人支去下拉刷新。
 */
test('标签筛空名单时说「这个筛选条件下没有客户」，不说名单没取回来', () => {
  const page = loadPage()
  page.data.tagId = 7
  page.load()
  requests[0].success({
    code: 200,
    data: {
      rows: [], total: 0,
      segmentCounts: { all: 12, pending: 0, repeat: 0, noted: 0, monthlyNew: 3 },
    },
  })
  assert.equal(page.data.emptyTitle, '这个筛选条件下没有客户')
  assert.equal(page.data.emptyAction, 'clear-advanced')
  // 页头读的是全量:筛空了它也不跟着变 0
  assert.equal(page.data.customerSummaryText, '12 位 · 本月新增 3')

  // 负控的一半:清除这条筛选后回到全量空态的老判据,不能把「真没客户」也说成筛没了
  page.onEmptyAction()
  assert.equal(page.data.tagId, '', '清除筛选要把标签清掉')
  requests[1].success({
    code: 200,
    data: { rows: [], total: 0, segmentCounts: { all: 0, pending: 0, repeat: 0, noted: 0, monthlyNew: 0 } },
  })
  assert.equal(page.data.emptyTitle, '还没有客户')
  assert.equal(page.data.emptyAction, 'go-coop')
})
