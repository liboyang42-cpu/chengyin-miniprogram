'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const PAGES = {
  order: 'pages/merchant/ledger/order-detail/index',
  batch: 'pages/merchant/ledger/batch-detail/index',
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少 ${selector} 样式`)
  return match[1]
}

function loadPage(kind, source) {
  const base = PAGES[kind]
  const jsPath = `${base}.js`
  const requests = []
  const navigation = []
  let stops = 0
  let definition
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { requests.push(options) },
  }
  const sandbox = {
    console,
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    Page(value) { definition = value },
    require(id) {
      if (id.includes('merchant-theme')) {
        return { merchantPageShow() {}, merchantPageRestore() {} }
      }
      return require(path.resolve(path.dirname(path.join(ROOT, jsPath)), id))
    },
    wx: {
      navigateBack() { navigation.push('back') },
      reLaunch(options) { navigation.push(options.url) },
      navigateTo(options) { navigation.push(options.url) },
      setClipboardData() {},
      stopPullDownRefresh() { stops += 1 },
    },
  }
  vm.runInNewContext(source || read(jsPath), sandbox, { filename: jsPath })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return { page, requests, navigation, stops: () => stops }
}

test('订单与批次详情缺少必要参数时进入 missing-param，不发送空请求', () => {
  const cases = [
    ['order', {}],
    ['batch', {}],
  ]
  cases.forEach(([kind, query]) => {
    const { page, requests } = loadPage(kind)
    page.onLoad(query)
    assert.equal(requests.length, 0, `${kind} 缺参不得发请求`)
    assert.equal(page.data.loadState, 'missing-param')
  })
})

test('两页结构为首载、缺参和不可见记录提供互斥状态出口', () => {
  Object.values(PAGES).forEach((base) => {
    const wxml = read(`${base}.wxml`)
    assert.match(wxml, /loadState === 'loading'/, `${base} 缺少明确首载态`)
    assert.match(wxml, /<cy-empty\b[^>]*loadState === 'missing-param'[^>]*kind="missing-param"/s,
      `${base} 缺少 missing-param 空态`)
    assert.match(wxml, /<cy-empty\b[^>]*loadState === 'missing-record'[^>]*kind="empty"/s,
      `${base} 缺少 missing-record 空态`)
  })
})

function orderPayload(overrides) {
  return Object.assign({
    recordKey: 'redemption:31',
    recordType: 'redemption',
    recordId: '31',
    fulfillmentState: 'ACTIVE',
    settlementState: 'PENDING',
    settlementRoute: 'CHAPTER_OFFER',
    displayState: 'PENDING_SETTLEMENT',
  }, overrides)
}

function batchPayload(overrides) {
  return Object.assign({
    batchId: '8',
    periodYm: '2026-08',
    amountTotal: '12.00',
    netDirection: 'PLATFORM_PAYS_MERCHANT',
    paymentState: 'PENDING',
    invoiceState: 'NONE',
    holdState: 'NORMAL',
  }, overrides)
}

function successPayload(kind, revision) {
  if (kind === 'order') {
    return {
      code: 200,
      data: orderPayload({
        topicName: revision,
        settlementAmount: '12.00',
      }),
    }
  }
  return {
    code: 200,
    data: {
      batch: {
        ...batchPayload({ periodYm: revision }),
      },
      earningEntries: [],
      adjustments: [],
    },
  }
}

function detailRevision(kind, detail) {
  return kind === 'order' ? detail.topicName : detail.batch.periodYm
}

test('两页首载 single-flight，刷新保留旧详情，失败可原位恢复且卸载后不写回', () => {
  const cases = [
    ['order', { recordType: 'redemption', recordId: '31' }],
    ['batch', { batchId: '8' }],
  ]
  cases.forEach(([kind, query]) => {
    const { page, requests, stops } = loadPage(kind)
    page.onLoad(query)
    assert.equal(requests.length, 1)
    assert.equal(page.data.loadState, 'loading')

    page.load()
    assert.equal(requests.length, 1, `${kind} 同步重入不得生成第二条请求`)
    requests[0].success(successPayload(kind, 'old'))
    assert.equal(page.data.loadState, 'ready')
    assert.equal(detailRevision(kind, page.data.detail), 'old')

    page.onPullDownRefresh()
    assert.equal(requests.length, 2)
    assert.equal(page.data.loadState, 'refreshing')
    assert.equal(detailRevision(kind, page.data.detail), 'old', `${kind} 刷新时不得清空旧详情`)
    requests[1].fail({ errMsg: 'request:fail timeout' })
    assert.equal(page.data.loadState, 'stale-error')
    assert.equal(page.data.errorKind, 'network')
    assert.equal(detailRevision(kind, page.data.detail), 'old')
    assert.ok(stops() >= 1)

    page.retryLoad()
    assert.equal(requests.length, 3)
    assert.equal(page.data.loadState, 'refreshing')
    requests[1].fail({ msg: 'late duplicate callback' })
    assert.equal(page.data.loadState, 'refreshing', `${kind} 旧航班不得覆盖重试`)
    requests[2].success(successPayload(kind, 'new'))
    assert.equal(page.data.loadState, 'ready')
    assert.equal(detailRevision(kind, page.data.detail), 'new')

    page.onPullDownRefresh()
    assert.equal(requests.length, 4)
    page.onUnload()
    requests[3].success(successPayload(kind, 'after-unload'))
    assert.equal(detailRevision(kind, page.data.detail), 'new', `${kind} 离页后的回调不得写回`)
  })
})

test('详情存在时，更新中与更新失败都在原位显示而不替换正文', () => {
  Object.values(PAGES).forEach((base) => {
    const wxml = read(`${base}.wxml`)
    assert.match(wxml, /wx:if="\{\{detail\}\}"[\s\S]*loadState === 'refreshing'[\s\S]*loadState === 'stale-error'/,
      `${base} 缺少旧详情上的刷新状态`)
    assert.match(wxml, /<cy-inline-error\b[^>]*bind:action="retryLoad"/s,
      `${base} 陈旧刷新失败必须可原位重试`)
  })
})

test('两页保持既有资金 API、POST JSON header 与查询 payload', () => {
  const order = loadPage('order')
  order.page.onLoad({ recordType: 'redemption', recordId: 31 })
  assert.equal(order.requests[0].url, '/api/merchant/finance/redemption-detail')
  assert.equal(order.requests[0].method, 'POST')
  assert.equal(order.requests[0].header['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(order.requests[0].data), { recordType: 'redemption', recordId: '31' })

  const batch = loadPage('batch')
  batch.page.onLoad({ batchId: 8 })
  assert.equal(batch.requests[0].url, '/api/merchant/finance/public-transfer-batch-detail')
  assert.equal(batch.requests[0].method, 'POST')
  assert.equal(batch.requests[0].header['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(batch.requests[0].data), { batchId: '8' })
})

test('后端明确记录不可见时进入 missing-record；HTTP、登录、服务错误与设备断网分开', () => {
  const cases = [
    ['order', { recordType: 'redemption', recordId: '31' }],
    ['batch', { batchId: '8' }],
  ]
  cases.forEach(([kind, query]) => {
    const missing = loadPage(kind)
    missing.page.onLoad(query)
    missing.requests[0].success({ code: 500, msg: '记录不可见' })
    assert.equal(missing.page.data.loadState, 'missing-record', `${kind} 不可见记录不得伪装成服务故障`)
    assert.equal(missing.page.data.detail, null)

    const service = loadPage(kind)
    service.page.onLoad(query)
    service.requests[0].fail({ msg: '网络结算服务暂不可用' })
    assert.equal(service.page.data.loadState, 'error')
    assert.equal(service.page.data.errorKind, 'data', `${kind} 业务文案含网络二字也不是设备断网`)
    assert.equal(service.page.data.errorText, '网络结算服务暂不可用')

    const http = loadPage(kind)
    http.page.onLoad(query)
    http.requests[0].fail({ statusCode: 503, errMsg: 'request:fail network', msg: '网络结算服务暂不可用' })
    assert.equal(http.page.data.errorKind, 'data', `${kind} HTTP 状态证据必须优先于 transport 字样`)

    const login = loadPage(kind)
    login.page.onLoad(query)
    login.requests[0].fail({ code: 2, errMsg: 'request:fail', msg: '登录状态失效' })
    assert.equal(login.page.data.errorKind, 'data', `${kind} 登录失效不得误报成设备断网`)

    const offline = loadPage(kind)
    offline.page.onLoad(query)
    offline.requests[0].fail({ errMsg: 'request:fail timeout' })
    assert.equal(offline.page.data.loadState, 'error')
    assert.equal(offline.page.data.errorKind, 'network')
  })
})

test('核销详情 code=200 仍校验身份与结算状态完整性，空对象和半对象不得冒充 ready', () => {
  const invalidPayloads = [
    {},
    { recordType: 'redemption', recordId: '31' },
    orderPayload({ recordKey: 'redemption:99', recordId: '99' }),
    orderPayload({ settlementRoute: null }),
  ]
  invalidPayloads.forEach((data) => {
    const mounted = loadPage('order')
    mounted.page.onLoad({ recordType: 'redemption', recordId: '31' })
    mounted.requests[0].success({ code: 200, data })
    assert.equal(mounted.page.data.loadState, 'error')
    assert.equal(mounted.page.data.detail, null)
    assert.match(mounted.page.data.errorText, /数据不完整/)
  })
})

test('核销岗位可读脱敏详情，但金额、计提与结算进度不进入 UI', () => {
  const mounted = loadPage('order')
  mounted.page.onLoad({ recordType: 'redemption', recordId: '31' })
  mounted.requests[0].success({
    code: 200,
    data: {
      recordKey: 'redemption:31',
      recordType: 'redemption',
      recordId: '31',
      fulfillmentState: 'ACTIVE',
      settlementAmount: null,
      settlementState: null,
      settlementRoute: null,
      displayState: null,
      publicSettlement: null,
      topicName: '夜游核销',
      occurredAt: '2026-08-25 10:00:00',
    },
  })

  assert.equal(mounted.page.data.loadState, 'ready')
  assert.equal(mounted.page.data.detail.canReadFinance, false)
  assert.equal(mounted.page.data.detail.amountDisplay, null)
  assert.equal(mounted.page.data.detail.amountFallback, '')
  assert.equal(mounted.page.data.detail.accrualRuleText, '')
  assert.equal(mounted.page.data.detail.stateText, '核销有效')
  assert.equal(mounted.page.data.detail.timeline.length, 0)
  const wxml = read(`${PAGES.order}.wxml`)
  assert.match(wxml, /fin-hero__lab[^>]*>\{\{detail\.canReadFinance \? detail\.title \+ ' · 我的收入' : detail\.title\}\}/)
  assert.match(wxml, /<block wx:if="\{\{detail\.canReadFinance\}\}">[\s\S]*?fin-hero__amt/)
  assert.match(wxml, /detail\.canReadFinance && detail\.settlementRoute === 'COOP_ORDER'/)
  assert.match(wxml, /detail\.canReadFinance && detail\.timeline\.length/)
})

test('结算批次 code=200 仍校验批次身份与资金字段完整性，空对象和半对象不得冒充 ready', () => {
  const invalidPayloads = [
    { batch: {}, earningEntries: [], adjustments: [] },
    { batch: { batchId: '8', periodYm: '2026-08' }, earningEntries: [], adjustments: [] },
    { batch: batchPayload({ batchId: '9' }), earningEntries: [], adjustments: [] },
    { batch: batchPayload({ holdState: undefined }), earningEntries: [], adjustments: [] },
    { batch: batchPayload(), earningEntries: {}, adjustments: [] },
    { batch: batchPayload(), earningEntries: [{}], adjustments: [] },
  ]
  invalidPayloads.forEach((data) => {
    const mounted = loadPage('batch')
    mounted.page.onLoad({ batchId: '8' })
    mounted.requests[0].success({ code: 200, data })
    assert.equal(mounted.page.data.loadState, 'error')
    assert.equal(mounted.page.data.detail, null)
    assert.match(mounted.page.data.errorText, /数据不完整/)
  })
})

function resolvedDetail(kind, payload) {
  const mounted = loadPage(kind)
  mounted.page.onLoad(kind === 'order'
    ? { recordType: 'redemption', recordId: '31' }
    : { batchId: '8' })
  const data = kind === 'order'
    ? orderPayload(payload)
    : Object.assign({}, payload, { batch: batchPayload(payload.batch) })
  mounted.requests[0].success({ code: 200, data })
  return mounted.page.data.detail
}

test('资金 null/unknown 保持待定，不拼成 ¥0.00 或 ¥null；真实零值仍按业务展示', () => {
  ;[null, 'UNKNOWN'].forEach((value) => {
    const order = resolvedDetail('order', {
      settlementAmount: value,
      displayState: 'PENDING_SETTLEMENT',
      settlementRoute: 'CHAPTER_OFFER',
      settlementState: 'PENDING',
    })
    assert.equal(order.amountText, null)
    assert.equal(order.amountDisplay, null)
    assert.equal(order.amountFallback, '待定')

    const batch = resolvedDetail('batch', {
      batch: { periodYm: '2026-08', amountTotal: value, netDirection: 'PLATFORM_PAYS_MERCHANT', paymentState: 'PENDING', invoiceState: 'NONE' },
      earningEntries: [{ entryKey: 'e-1', signedAmount: value, entryKind: 'EARNING', source: 'REDEMPTION_FEE' }],
      adjustments: [],
    })
    assert.equal(batch.batch.amountText, null)
    assert.equal(batch.batch.amountDisplay, null)
    assert.equal(batch.batch.amountFallback, '待定')
    assert.equal(batch.earningEntries[0].amountDisplay, '待定')
  })

  const zero = resolvedDetail('batch', {
    batch: { periodYm: '2026-08', amountTotal: '0.00', netDirection: 'ZERO', paymentState: 'PENDING', invoiceState: 'NONE' },
    earningEntries: [], adjustments: [],
  })
  assert.equal(zero.batch.amountDisplay, '¥0.00', '服务端确认的真实零值仍需保留')

  const adjustedZero = resolvedDetail('order', {
    settlementAmount: '0.00',
    displayState: 'ADJUSTED',
    settlementRoute: 'CHAPTER_OFFER',
    settlementState: 'ADJUSTED',
  })
  assert.equal(adjustedZero.amountText, '0.00', '已确认的调整后净额零不能伪装成未知')
  assert.equal(adjustedZero.amountDisplay, '¥0.00')

  const noCashZero = resolvedDetail('order', {
    settlementAmount: '0.00',
    displayState: 'NO_CASH_SETTLEMENT',
    settlementRoute: 'NO_CASH',
    settlementState: 'NOT_APPLICABLE',
    noCashReason: '本次不产生现金结算',
  })
  assert.equal(noCashZero.amountText, null, '只有服务端明确零现金语义才隐藏金额')
  assert.equal(noCashZero.amountFallback, '—')
})

test('计提规则只在单价与人头都是真实数值时展示，unknown 不得渲染为 ¥null', () => {
  const order = (unitFee, headCount) => resolvedDetail('order', {
    settlementAmount: '12.00',
    displayState: 'PENDING_SETTLEMENT',
    settlementRoute: 'CHAPTER_OFFER',
    settlementState: 'PENDING',
    unitFee,
    headCount,
  })

  assert.equal(order('UNKNOWN', 2).accrualRuleText, '')
  assert.equal(order('6.50', 'UNKNOWN').accrualRuleText, '')
  assert.equal(order('0.00', 0).accrualRuleText, '¥0.00/人 × 0', '真实零值不能被未知态吞掉')
})

function assertAccessibleDetailMarkup(orderWxml, batchWxml, wxss) {
  assert.match(orderWxml,
    /class="fin-kv ledger-detail-action"[^>]*aria-role="button"[^>]*aria-label="前往我的资产查看个人账户"[^>]*bindtap="goAssets"/,
    '去资产必须由整行按钮承接')
  assert.match(batchWxml,
    /class="fin-kv ledger-detail-action"[^>]*aria-role="button"[^>]*aria-label="复制打款凭证"[^>]*bindtap="copyVoucher"/,
    '复制凭证必须由整行按钮承接')
  assert.match(rule(wxss, '.ledger-detail-action'), /min-height:\s*88rpx\b/,
    '复制与跳转点击区不得小于 88rpx')
  ;[orderWxml, batchWxml].forEach((wxml) => {
    assert.match(wxml, /class="[^"]*\bfin-tl\b[^"]*"[^>]*aria-role="list"/, '资金进度必须暴露列表语义')
    assert.match(wxml, /class="[^"]*\bfin-tl__step\b[^"]*"[^>]*aria-role="listitem"/, '每个资金节点必须暴露列表项语义')
  })
}

test('复制、跳转与资金 timeline 满足可读名称和 88rpx 触控契约', () => {
  assertAccessibleDetailMarkup(
    read(`${PAGES.order}.wxml`),
    read(`${PAGES.batch}.wxml`),
    read(`${PAGES.order}.wxss`),
  )
})

test('负控：删除 single-flight、epoch 或错误终态后，行为契约确实变红', () => {
  ;['order', 'batch'].forEach((kind) => {
    const base = read(`${PAGES[kind]}.js`)
    const query = kind === 'order'
      ? { recordType: 'redemption', recordId: '31' }
      : { batchId: '8' }

    const noLock = base.replace('if (this._loading) {', 'if (false) {')
    assert.notEqual(noLock, base, `${kind} single-flight 负控锚点失效`)
    assert.throws(() => {
      const mounted = loadPage(kind, noLock)
      mounted.page.onLoad(query)
      mounted.page.load()
      assert.equal(mounted.requests.length, 1, '同步重入不得并发请求')
    }, /同步重入不得并发请求/)

    const noEpoch = base
      .replaceAll('if (epoch !== this._loadEpoch) return;', 'if (false) return;')
      .replaceAll('if (epoch !== page._loadEpoch) return false;', 'if (false) return false;')
    assert.notEqual(noEpoch, base, `${kind} epoch 负控锚点失效`)
    assert.throws(() => {
      const mounted = loadPage(kind, noEpoch)
      mounted.page.onLoad(query)
      mounted.requests[0].fail({ msg: 'first failure' })
      mounted.page.retryLoad()
      mounted.requests[0].success(successPayload(kind, 'late-old'))
      assert.equal(mounted.page.data.loadState, 'loading', '旧航班不得覆盖重试')
    }, /旧航班不得覆盖重试/)

    const failOpen = base.replaceAll(
      "loadState: hasDetail ? 'stale-error' : 'error',",
      "loadState: 'ready',",
    )
    assert.notEqual(failOpen, base, `${kind} 错误终态负控锚点失效`)
    assert.throws(() => {
      const mounted = loadPage(kind, failOpen)
      mounted.page.onLoad(query)
      mounted.requests[0].fail({ msg: '服务暂不可用' })
      assert.equal(mounted.page.data.loadState, 'error', '首载失败不得回退 ready')
    }, /首载失败不得回退 ready/)
  })

  const orderSource = read(`${PAGES.order}.js`)
  const permissiveShape = orderSource.replace(
    'if (!isRedemptionDetailPayload(res, this.data.recordType, this.data.recordId)) {',
    'if (!isFinanceObjectPayload(res)) {',
  )
  assert.notEqual(permissiveShape, orderSource, '核销 shape 负控锚点失效')
  assert.throws(() => {
    const mounted = loadPage('order', permissiveShape)
    mounted.page.onLoad({ recordType: 'redemption', recordId: '31' })
    mounted.requests[0].success({ code: 200, data: {} })
    assert.equal(mounted.page.data.loadState, 'error', 'code=200 空对象不得冒充 ready')
  }, /code=200 空对象不得冒充 ready/)

  const batchSource = read(`${PAGES.batch}.js`)
  const permissiveBatchShape = batchSource.replace(
    'if (!isBatchDetailPayload(res, this.data.batchId)) {',
    'if (!isFinanceObjectPayload(res) || !isRecord(res.data.batch)\n          || !isRecordList(res.data.earningEntries) || !isRecordList(res.data.adjustments)) {',
  )
  assert.notEqual(permissiveBatchShape, batchSource, '批次 shape 负控锚点失效')
  assert.throws(() => {
    const mounted = loadPage('batch', permissiveBatchShape)
    mounted.page.onLoad({ batchId: '8' })
    mounted.requests[0].success({ code: 200, data: { batch: {}, earningEntries: [], adjustments: [] } })
    assert.equal(mounted.page.data.loadState, 'error', 'code=200 空批次不得冒充 ready')
  }, /code=200 空批次不得冒充 ready/)

  const zeroHidingSource = orderSource.replace(
    "if (detail.displayState === 'NO_CASH_SETTLEMENT') return null;",
    "if (detail.displayState === 'NO_CASH_SETTLEMENT' || Number(money(detail.settlementAmount)) === 0) return null;",
  )
  assert.notEqual(zeroHidingSource, orderSource, '真实零值负控锚点失效')
  assert.throws(() => {
    const mounted = loadPage('order', zeroHidingSource)
    mounted.page.onLoad({ recordType: 'redemption', recordId: '31' })
    mounted.requests[0].success({ code: 200, data: orderPayload({
      settlementAmount: '0.00',
      settlementState: 'ADJUSTED',
      displayState: 'ADJUSTED',
    }) })
    assert.equal(mounted.page.data.detail.amountDisplay, '¥0.00', '真实零值不得被隐藏')
  }, /真实零值不得被隐藏/)
})

test('负控：缩小点击区或移除可读名称后，无障碍契约确实变红', () => {
  const orderWxml = read(`${PAGES.order}.wxml`)
  const batchWxml = read(`${PAGES.batch}.wxml`)
  const wxss = read(`${PAGES.order}.wxss`)
  const small = wxss.replace(/(\.ledger-detail-action\s*\{[^}]*?)min-height:\s*88rpx\b/s, '$1min-height: 64rpx')
  const unnamed = batchWxml.replace(' aria-role="button" aria-label="复制打款凭证"', '')
  assert.notEqual(small, wxss, '88rpx 负控锚点失效')
  assert.notEqual(unnamed, batchWxml, '复制按钮名称负控锚点失效')
  assert.throws(() => assertAccessibleDetailMarkup(orderWxml, batchWxml, small), /不得小于 88rpx/)
  assert.throws(() => assertAccessibleDetailMarkup(orderWxml, unnamed, wxss), /复制凭证必须由整行按钮承接/)
})
