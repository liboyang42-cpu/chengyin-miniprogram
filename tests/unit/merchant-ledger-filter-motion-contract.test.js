'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function assertSharedSlabContract(js, wxml, wxss) {
  assert.match(js, /sharedSlab:\s*\{\s*type:\s*Boolean,\s*value:\s*false\s*\}/,
    '共享选中块必须是默认关闭的公开属性')
  assert.match(js, /reduced-motion\.js/,
    '选中块必须复用系统减少动态效果偏好')
  assert.match(wxml, /variant === 'chip'\s*&&\s*sharedSlab/,
    '共享选中块只能由 chip 调用方显式开启')
  assert.match(wxml, /class="cy-tabs__slab"[^>]*aria-hidden="true"/,
    '纯装饰选中块不得进入无障碍树')
  assert.match(wxml, /variant === 'chip'\s*&&\s*sharedSlab[^>]*aria-role="tablist"/,
    '共享筛选容器必须向读屏声明 tablist')
  assert.match(wxml, /aria-role="tab"[\s\S]{0,120}?aria-selected="\{\{item\.key === active\}\}"/,
    '每个共享筛选项必须向读屏声明当前选中态')
  assert.match(wxss, /\.cy-tabs--shared-slab \.cy-tabs__slab\s*\{[^}]*transition:\s*transform var\(--cy-motion-standard\)[^;]*,\s*opacity var\(--cy-motion-standard\)/s,
    '选中块只用 transform/opacity，并统一读取 220ms standard token')
  assert.match(wxss, /\.cy-tabs--shared-slab\s*\{[^}]*height:\s*88rpx/s,
    '四段筛选必须保留 88rpx 触达高度')
  assert.match(wxss, /\.cy-tabs--reduced-motion \.cy-tabs__slab\s*\{[^}]*transition:\s*none/s,
    '减少动态效果时选中块必须静态跳转')
}

test('cy-tabs 以 opt-in 公开接口提供可降级的共享 selected slab', () => {
  assertSharedSlabContract(
    read('components/cy/tabs/index.js'),
    read('components/cy/tabs/index.wxml'),
    read('components/cy/tabs/index.wxss'),
  )
})

function renderSlabState(tabs, active) {
  let definition
  vm.runInNewContext(read('components/cy/tabs/index.js'), {
    Component: (value) => { definition = value },
    require: () => ({}),
  })
  const instance = {
    data: {},
    setData(patch) { Object.assign(this.data, patch) },
  }
  definition.observers['tabs, active'].call(instance, tabs, active)
  return instance.data
}

test('四段公开 active 值映射为等分 slab 位置，未知 active 隐藏装饰层', () => {
  const tabs = [
    { key: 'all' },
    { key: 'pending' },
    { key: 'handled' },
    { key: 'no_cash' },
  ]
  const handled = renderSlabState(tabs, 'handled')
  assert.equal(handled._slabWidth, 'calc(25% - 3rpx)')
  assert.equal(handled._slabOffset, 200)
  assert.equal(handled._slabOpacity, 1)

  const unknown = renderSlabState(tabs, 'unknown')
  assert.equal(unknown._slabOffset, 0)
  assert.equal(unknown._slabOpacity, 0)
})

function assertLedgerFilterShellContract(js, wxml) {
  assert.match(wxml,
    /<block wx:elif="\{\{view === 'redemptions'\}\}">[\s\S]*?<cy-tabs[^>]*variant="chip"[^>]*shared-slab[^>]*bind:change="onRedemptionFilter"/,
    '核销视图必须在首载分支外保留四段筛选 shell，并显式开启 shared slab')
  assert.match(wxml,
    /<view class="ledger-redemption-content"[^>]*>[\s\S]*?<cy-skeleton wx:if="\{\{loading && !hasLoaded\}\}" type="list"/,
    '筛选切换只替换内容区为列表骨架')
  assert.match(wxml,
    /<cy-error wx:elif="\{\{error && !hasLoaded\}\}"[\s\S]*?<cy-empty wx:elif="\{\{!loading && !error && !redemptionGroups\.length\}\}"/,
    '失败态必须先于业务空态且两者互斥')
  assert.match(js, /onRedemptionFilter\(event\)\s*\{[\s\S]*?_redemptionEpoch\s*=\s*\(this\._redemptionEpoch \|\| 0\) \+ 1/,
    '点击筛选必须立刻推进 epoch，不能等身份探针返回后才防迟到响应')
  assert.match(js, /revalidateCurrentView\(\)\s*\{[\s\S]*?_identityEpoch\s*=\s*\(this\._identityEpoch \|\| 0\) \+ 1;[\s\S]*?_verifyMerchantAccess/,
    '整页或筛选重验必须推进身份代次，旧拒绝响应不得清空新资金态')
  assert.match(js, /onRedemptionFilter\(event\)\s*\{[\s\S]*?this\.setData\(\{[\s\S]*?loading:\s*true,[\s\S]*?error:\s*false,[\s\S]*?redemptions:\s*\[\],[\s\S]*?redemptionGroups:\s*\[\],[\s\S]*?summary:\s*null/,
    '切换时必须原子进入加载态并清除上一筛选资金行')
}

test('账本四段筛选保留 shell，只在内容区显示 skeleton/error/empty', () => {
  assertLedgerFilterShellContract(
    read('pages/merchant/ledger/index.js'),
    read('pages/merchant/ledger/index.wxml'),
  )
})

function mountLedgerPage() {
  let definition
  const requests = []
  const navigations = []
  const sourcePath = path.join(ROOT, 'pages/merchant/ledger/index.js')
  const app = {
    globalData: { navBarHeight: 44 },
    getUserID: () => 'merchant-a',
    sendRequest: (options) => { requests.push(options) },
  }
  const dependencies = {
    '../../../utils/merchant-theme.js': { merchantPageShow() {}, merchantPageRestore() {} },
    '../../../utils/subscribe.js': { request: () => Promise.resolve({}) },
    '../utils/merchant-finance.js': require(path.join(ROOT, 'pages/merchant/utils/merchant-finance.js')),
    '../../../utils/merchant-access-policy.js': require(path.join(ROOT, 'utils/merchant-access-policy.js')),
    '../aftercare/detail/view-model.js': require(path.join(ROOT, 'pages/merchant/aftercare/detail/view-model.js')),
  }
  vm.runInNewContext(read('pages/merchant/ledger/index.js'), {
    getApp: () => app,
    Page: (value) => { definition = value },
    require: (request) => dependencies[request],
    wx: {
      getWindowInfo: () => ({ statusBarHeight: 20 }),
      getSystemInfoSync: () => ({ statusBarHeight: 20 }),
      navigateBack() {},
      navigateTo(options) { navigations.push(options && options.url || '') },
      reLaunch() {},
      showToast() {},
    },
    console,
  }, { filename: sourcePath })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return { page, requests, navigations }
}

function allowMerchant(request) {
  assert.equal(request.url, '/api/merchant/access/me')
  request.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_FINANCE',
      permissions: ['merchant:basic:read', 'merchant:verify:record:read', 'merchant:finance:read'],
    },
  })
}

function allowVerificationReader(request) {
  assert.equal(request.url, '/api/merchant/access/me')
  request.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_CHECKIN',
      permissions: ['merchant:basic:read', 'merchant:verify:record:read'],
    },
  })
}

test('all → pending → all 快速往返时，最早的 all 响应不能复活旧资金行', () => {
  const { page, requests } = mountLedgerPage()
  page.data.merchantAccess = { active: true, canReadFinance: true }
  page.loadRedemptions()
  const staleAllRequest = requests[0]

  page.onRedemptionFilter({ detail: { key: 'pending' } })
  page.onRedemptionFilter({ detail: { key: 'all' } })
  assert.equal(page.data.loading, true)
  assert.equal(page.data.error, false)
  assert.equal(page.data.redemptions.length, 0)
  assert.equal(page.data.redemptionGroups.length, 0)
  assert.equal(page.data.summary, null)

  staleAllRequest.success({
    code: 200,
    data: { rows: [{ recordKey: 'stale-all', displayState: 'SETTLED' }], total: 1 },
  })
  assert.equal(page.data.redemptions.length, 0, '同名旧筛选响应也必须被点击时推进的 epoch 拦下')

  allowMerchant(requests[2])
  requests[3].success({
    code: 200,
    data: { rows: [{ recordKey: 'fresh-all', displayState: 'SETTLED' }], total: 1 },
  })
  assert.equal(page.data.redemptions.map((item) => item.recordKey).join(','), 'fresh-all')
})

test('较新的筛选已完成后，较旧身份探针的拒绝响应不得清空最新资金态', () => {
  const { page, requests } = mountLedgerPage()
  page.data.merchantAccess = { active: true, canReadFinance: true }
  page.revalidateCurrentView()
  const staleIdentity = requests[0]

  page.onRedemptionFilter({ detail: { key: 'pending' } })
  const currentIdentity = requests[1]
  allowMerchant(currentIdentity)
  requests[2].success({
    code: 200,
    data: {
      rows: [{
        recordKey: 'fresh-pending',
        displayState: 'PENDING_SETTLEMENT',
        settlementAmount: 18,
      }],
      total: 1,
      summary: { count: 1, pendingAmount: 18, arrivedAmount: 0 },
    },
  })
  assert.equal(page.data.hasLoaded, true)
  assert.equal(page.data.redemptions[0].recordKey, 'fresh-pending')

  staleIdentity.success({ code: 403, msg: '旧探针拒绝' })
  assert.equal(page.data.hasLoaded, true, '旧身份响应不得执行 deny 清场')
  assert.equal(page.data.error, false)
  assert.equal(page.data.redemptions[0].recordKey, 'fresh-pending')
})

test('核销岗位只看履约事实：筛选、金额、结算态与金额汇总都在 UI 隐藏', () => {
  const { page, requests } = mountLedgerPage()
  page.data.redemptionFilter = 'settled'
  page.revalidateCurrentView()
  allowVerificationReader(requests[0])

  assert.equal(page.data.redemptionFilter, 'all', '无财务权限时必须收敛为全量核销，不能按结算态探测')
  assert.equal(requests[1].url, '/api/merchant/finance/redemptions')
  assert.match(requests[1].data, /"filter":"all"/)
  requests[1].success({
    code: 200,
    data: {
      rows: [{
        recordKey: 'redemption:7', recordType: 'redemption', recordId: '7',
        fulfillmentState: 'ACTIVE', occurredAt: '2026-08-25 10:00:00',
        settlementAmount: null, settlementState: null, settlementRoute: null, displayState: null,
      }],
      total: 1,
      summary: { count: 2, pendingAmount: null, arrivedAmount: null },
    },
  })

  assert.equal(page.data.summary.countText, '2 笔')
  assert.equal(page.data.summary.pendingDisplay, undefined)
  assert.equal(page.data.summary.arrivedDisplay, undefined)
  assert.equal(page.data.redemptions[0].amountDisplay, null)
  assert.equal(page.data.redemptions[0].stateText, '核销有效')
  const before = requests.length
  page.onRedemptionFilter({ detail: { key: 'pending' } })
  assert.equal(requests.length, before, '核销岗位点击隐藏筛选的伪事件也不得发请求')
  assert.equal(page.data.redemptionFilter, 'all')

  const wxml = read('pages/merchant/ledger/index.wxml')
  assert.match(wxml, /<cy-tabs[^>]*wx:if="\{\{merchantAccess\.canReadFinance\}\}"/)
  assert.match(wxml, /fin-summary__cell[^>]*wx:if="\{\{merchantAccess\.canReadFinance\}\}"/)
  assert.match(wxml, /fin-row__v[^>]*wx:if="\{\{merchantAccess\.canReadFinance\}\}"/)
})

test('负控：动效降级、epoch 或错误空态互斥任一回退都必须判红', () => {
  const tabsJs = read('components/cy/tabs/index.js')
  const tabsWxml = read('components/cy/tabs/index.wxml')
  const tabsWxss = read('components/cy/tabs/index.wxss')
  const ledgerJs = read('pages/merchant/ledger/index.js')
  const ledgerWxml = read('pages/merchant/ledger/index.wxml')

  const layoutAnimation = tabsWxss.replace(
    'transition: transform var(--cy-motion-standard) var(--cy-ease), opacity var(--cy-motion-standard) var(--cy-ease);',
    'transition: left var(--cy-motion-standard) var(--cy-ease);',
  )
  assert.notEqual(layoutAnimation, tabsWxss, 'transform/opacity 负控锚点失效')
  assert.throws(() => assertSharedSlabContract(tabsJs, tabsWxml, layoutAnimation), /transform\/opacity/)

  const announcedDecoration = tabsWxml.replace(' aria-hidden="true"', '')
  assert.notEqual(announcedDecoration, tabsWxml, 'aria-hidden 负控锚点失效')
  assert.throws(() => assertSharedSlabContract(tabsJs, announcedDecoration, tabsWxss), /无障碍树/)

  const missingTablist = tabsWxml.replace(' aria-role="tablist"', '')
  assert.notEqual(missingTablist, tabsWxml, 'tablist 负控锚点失效')
  assert.throws(() => assertSharedSlabContract(tabsJs, missingTablist, tabsWxss), /tablist/)

  const missingSelected = tabsWxml.replace('    aria-selected="{{item.key === active}}"\n', '')
  assert.notEqual(missingSelected, tabsWxml, 'aria-selected 负控锚点失效')
  assert.throws(() => assertSharedSlabContract(tabsJs, missingSelected, tabsWxss), /选中态/)

  const staleEpoch = ledgerJs.replace(
    '    this._redemptionEpoch = (this._redemptionEpoch || 0) + 1;\n    this.setData({\n      loading:',
    '    this.setData({\n      loading:',
  )
  assert.notEqual(staleEpoch, ledgerJs, 'epoch 负控锚点失效')
  assert.throws(() => assertLedgerFilterShellContract(staleEpoch, ledgerWxml), /推进 epoch/)

  const staleIdentity = ledgerJs.replace(
    '    this._identityEpoch = (this._identityEpoch || 0) + 1;\n    this._verifyMerchantAccess(() => this.loadCurrentView());',
    '    this._verifyMerchantAccess(() => this.loadCurrentView());',
  )
  assert.notEqual(staleIdentity, ledgerJs, '身份代次负控锚点失效')
  assert.throws(() => assertLedgerFilterShellContract(staleIdentity, ledgerWxml), /身份代次/)

  const overlappingEmpty = ledgerWxml.replace(
    '!loading && !error && !redemptionGroups.length',
    '!redemptionGroups.length',
  )
  assert.notEqual(overlappingEmpty, ledgerWxml, '错误/空态互斥负控锚点失效')
  assert.throws(() => assertLedgerFilterShellContract(ledgerJs, overlappingEmpty), /互斥/)
})

// ── UI-06(2026-09-18 用户走查):退款售后并进状态 tab ──

test('退款行映射成台账条目:标题/状态带退款前缀,仍路由售后详情', () => {
  const { page, navigations } = mountLedgerPage()
  const row = page.refundRow({
    refundId: 9, bucket: 'PENDING', titleText: '张三', activityTitleText: '夜游',
    statusText: '待回应', statusTone: 'warning', dateKey: '2026-09-18', timeText: '10:00',
    createTimeText: '2026-09-18 10:00', amountCents: 1200,
  }, true)
  assert.equal(row.recordType, 'aftercare')
  assert.equal(row.refundId, 9)
  assert.equal(row.recordKey, 'aftercare:9')
  assert.equal(row.title, '退款 · 张三')
  assert.equal(row.stateText, '退款 · 待回应')
  assert.equal(row.amountDisplay, '¥12.00')
  assert.equal(row.dayKey, '2026-09-18')
  assert.equal(row.sortKey, '2026-09-18 10:00')

  page.goRedemptionDetail({ currentTarget: { dataset: { item: row } } })
  assert.equal(navigations.length, 1, '退款条目必须执行跳转')
  assert.match(navigations.pop(), /pages\/merchant\/aftercare\/detail\/index\?refundId=9/)
})

test('退款按状态并入 tab:待处理含待回应+处理中,已处理只含已完成,不结现金不掺退款', () => {
  const { page } = mountLedgerPage()
  page.data.merchantAccess = { active: true, canReadFinance: true }
  page._redemptionRows = []
  page._refundRows = [
    { refundBucket: 'PENDING', recordKey: 'aftercare:1', sortKey: '2026-09-18 09:00' },
    { refundBucket: 'PROCESSING', recordKey: 'aftercare:2', sortKey: '2026-09-18 11:00' },
    { refundBucket: 'COMPLETED', recordKey: 'aftercare:3', sortKey: '2026-09-18 08:00' },
  ]

  page.data.redemptionFilter = 'pending'
  page._applyRedemptionView()
  assert.deepEqual(page.data.redemptions.map((item) => item.recordKey), ['aftercare:2', 'aftercare:1'],
    '待处理 tab 只含未完成的退款,且按时间倒序')

  page.data.redemptionFilter = 'handled'
  page._applyRedemptionView()
  assert.deepEqual(page.data.redemptions.map((item) => item.recordKey), ['aftercare:3'])

  page.data.redemptionFilter = 'no_cash'
  page._applyRedemptionView()
  assert.equal(page.data.redemptions.length, 0, '不结现金是核销口径,不掺退款')

  page.data.redemptionFilter = 'all'
  page._applyRedemptionView()
  assert.deepEqual(page.data.redemptions.map((item) => item.recordKey), ['aftercare:2', 'aftercare:1', 'aftercare:3'])
})
