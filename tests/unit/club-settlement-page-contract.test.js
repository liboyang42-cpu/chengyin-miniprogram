const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const PAGE = path.join(root, 'pages/club/settlement/index.js')
const withdrawCs = require(path.join(root, 'utils/withdraw-cs.js'))

function mount() {
  let config
  const requests = []
  global.getApp = () => ({ globalData: {}, sendRequest(options) { requests.push(options) } })
  global.Page = value => { config = value }
  global.getCurrentPages = () => [{}, {}]
  global.wx = {
    showToast() {}, stopPullDownRefresh() {}, navigateBack() {}, switchTab() {}, navigateTo() {},
    showModal() {},
  }
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const vm = Object.assign({}, config, {
    data: Object.assign({}, config.data),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return { vm, requests }
}

const VALID_SUMMARY = {
  settledAmountText: '¥128.00',
  settledAmountStatus: 'verified',
  unverifiedSettledCount: 0,
  pendingAdjustment: {
    amountText: '¥486.50',
    executedText: '−¥0.00',
    topicName: '外滩夜行 · 霓虹拾光',
    note: '结束退款，已分润给商家的部分从本俱乐部结算中扣除。',
  },
  topics: [
    { id: 31, topicId: 9001, name: '外滩夜行', amountText: '¥128.00', amountStatus: 'verified', originalAmountText: '¥130.00', executedAdjustmentText: '¥-2.00', netAmountText: '¥128.00', arrivedText: '已入账', paidText: '已打款', status: 'settled' },
  ],
}

// E-02(2026-09-16):「俱乐部分润 → 结算详情」双重坏链之参数错配。
// 病:列表传的是结算行 id,明细页 source=finance 按 topicId 在 /api/coop/finance 里找 ⇒ 恒 missing-record。
// 治:后端 summary 补 topicId;列表传 item.topicId。负控:任一侧退回 id 都必须判红。
// 第二轮拍板第 9 条(2026-09-17):「调整待处理/已执行调整」卡先删。
// 后端 ApiClubSettlementController.summary 恒下发 pendingAdjustment=null(字段不动),
// 卡片从未显示过;资金新模型落地后再做。页面不再读这个字段,也不留渲染位。
test('拍板9:调整待处理卡已删,服务端就算带 pendingAdjustment 也不读不渲染', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/club/settlement/index.wxml'), 'utf8')
  const js = fs.readFileSync(PAGE, 'utf8')
  assert.doesNotMatch(wxml, /pendingAdjustment|调整待处理|adjust-card/)
  assert.doesNotMatch(js, /pendingAdjustment/)
  const { vm, requests } = mount()
  vm.onLoad({ clubId: '21' })
  requests[0].success({ code: 200, data: VALID_SUMMARY })
  assert.equal(vm.data.state, 'ready')
  assert.equal('pendingAdjustment' in vm.data.summary, false)
})

// CU-C-41(用户裁决 A):俱乐部结算行走**俱乐部视角**明细页。
// 病:列表原来传 source=finance,而 finance 线路只在「我发起 且 我是该主题发布者」的
// /api/coop/finance 列表里找行 —— 俱乐部作为受益方收款时主题发布者是别人 ⇒ 恒落 missing-record。
// 治:带 source=club&clubId,明细页按 topicId 从 /api/club/settlement/summary 命中。
// 负控:退回 source=finance(或漏带 clubId),本用例即红。
test('结算明细链接走俱乐部视角:带 source=club、topicId 与 clubId', () => {
  const { vm, requests } = mount()
  vm.onLoad({ clubId: '21' })
  requests[0].success({ code: 200, data: VALID_SUMMARY })
  assert.equal(vm.data.state, 'ready')
  assert.equal(vm.data.summary.topics[0].topicId, 9001)

  const navs = []
  const realNavigate = wx.navigateTo
  wx.navigateTo = (o) => navs.push(o.url)
  try { vm.goTopicSettlement({ currentTarget: { dataset: { topicId: vm.data.summary.topics[0].topicId } } }) }
  finally { wx.navigateTo = realNavigate }
  assert.equal(navs.length, 1)
  assert.ok(navs[0].includes('source=club&topicId=9001'), '必须走俱乐部视角:finance 线路在受益方为俱乐部时恒落 missing-record')
  assert.ok(navs[0].includes('clubId=21'), '俱乐部视角必须带 clubId —— 后端按它做范围校验')

  // wxml 是真正喂 dataset 的一侧:它若退回 item.id,上面这条就白测
  const wxml = fs.readFileSync(path.join(root, 'pages/club/settlement/index.wxml'), 'utf8')
  assert.match(wxml, /data-topic-id="\{\{item\.topicId\}\}"/)
  assert.doesNotMatch(wxml, /data-topic-id="\{\{item\.id\}\}"/)
})

test('作废保留账本金额，缺流水已结算显示未知且不展示部分合计', () => {
  const data = JSON.parse(JSON.stringify(VALID_SUMMARY))
  data.topics.push({ ...data.topics[0], id: 32, status: 'void', amountText: '¥9.99', paidText: '已作废，不再打款' })
  data.topics.push({ ...data.topics[0], id: 33, amountText: null, amountStatus: 'unverified' })
  data.settledAmountText = null
  data.settledAmountStatus = 'unverified'
  data.unverifiedSettledCount = 1
  const { vm, requests } = mount()
  vm.onLoad({ clubId: '21' })
  requests[0].success({ code: 200, data })
  assert.equal(vm.data.state, 'ready')
  assert.equal(vm.data.summary.settledAmountText, null)
  assert.equal(vm.data.summary.topics[1].status, 'void')
  assert.equal(vm.data.summary.topics[1].amountText, '¥9.99')
  assert.equal(vm.data.summary.topics[2].amountText, null)
  assert.equal(vm.data.summary.unverifiedSettledCount, 1)
})

test('缺失数量、未知金额标记及历史金额字段不一致时拒绝展示', () => {
  for (const mutate of [
    data => { data.unverifiedSettledCount = 1 },
    data => { data.settledAmountText = null },
    data => { data.topics[0].amountStatus = 'unverified' },
    data => { delete data.topics[0].netAmountText },
    data => { data.topics.push({ ...data.topics[0] }) },
  ]) {
    const data = JSON.parse(JSON.stringify(VALID_SUMMARY)); mutate(data)
    const { vm, requests } = mount(); vm.onLoad({ clubId: '21' })
    requests[0].success({ code: 200, data })
    assert.equal(vm.data.state, 'error')
  }
})

test('结算页金额字段一律来自服务端已格式化字符串，前端不做金额运算', () => {
  const js = fs.readFileSync(PAGE, 'utf8')
  // 负向锚定：文件里不出现 toFixed / Math. 这类金额运算，只出现 xxxText 字段透传。
  assert.doesNotMatch(js, /toFixed|Math\.(round|floor|ceil)\(/)
  assert.match(js, /settledAmountText/)
  assert.match(js, /amountText/)
})

test('结算数据形状不完整时 fail-closed，绝不用 0 兜底渲染金额', () => {
  const { vm, requests } = mount()
  vm.onLoad({ clubId: '21' })

  requests[0].success({ code: 200, data: VALID_SUMMARY })
  assert.equal(vm.data.state, 'ready')
  assert.equal(vm.data.summary.settledAmountText, '¥128.00')

  const { vm: broken, requests: brokenRequests } = mount()
  broken.onLoad({ clubId: '21' })
  const mutated = JSON.parse(JSON.stringify(VALID_SUMMARY))
  delete mutated.topics[0].amountText // 负控：删掉一个必需的金额字段
  brokenRequests[0].success({ code: 200, data: mutated })

  assert.equal(broken.data.state, 'error', '缺字段必须判失败，不能把 undefined 渲染成金额')
  assert.equal(broken.data.summary, null)
})

test('提现改弹平台客服微信:不跳银行卡表单、不自己发提现请求', () => {
  // ⚠️ 2026-09-15 收款模型定稿 §3:平台不打款。本页不再跳 pages/coop/withdraw,
  //    也不自己打 /api/club/settlement/withdraw,一律弹平台客服微信线下处理。
  const { vm, requests } = mount()
  vm.onLoad({ clubId: '21' })
  requests[0].success({ code: 200, data: VALID_SUMMARY })

  const before = requests.length
  const navs = []
  const modals = []
  const realNavigate = wx.navigateTo
  const realShowModal = wx.showModal
  wx.navigateTo = (o) => navs.push(o.url)
  wx.showModal = (o) => modals.push(o)
  // CU-C-92:提现入口现在要先知道可提现余额 —— 余额由 cy-funds-stages 抛上来
  vm.onStages({ detail: { known: true, positive: true } })
  try { vm.goWithdraw() } finally {
    wx.navigateTo = realNavigate
    wx.showModal = realShowModal
  }

  assert.equal(requests.length, before, '本页不该自己发提现请求')
  assert.equal(navs.length, 0, '不得再跳银行卡表单页')
  assert.equal(modals.length, 1, '必须弹客服微信确认层(单测里以 wx.showModal 回落呈现)')
  assert.equal(modals[0].title, '联系平台客服提现')
  assert.ok(modals[0].content.includes(withdrawCs.WITHDRAW_CS_WECHAT_ID), '弹窗正文必须显示客服微信号')
  assert.ok(modals[0].content.includes(withdrawCs.WITHDRAW_CS_TIP), '弹窗正文必须带线下处理说明')
})

test('负控:本页若自己打 /withdraw,合同必须判红', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../../pages/club/settlement/index.js'), 'utf8')
  const code = src.replace(/^\s*\/\/.*$/gm, '')   // 剥注释:说明里提到路径不算调用
  assert.ok(!/url:\s*'\/api\/club\/settlement\/withdraw'/.test(code),
    '本页又自己发提现请求了 —— 绕开了 withdrawal-preflight 的四要素校验')
  // 判据不是瞎的:summary 那条只读调用照样认得出来
  assert.ok(/url:\s*'\/api\/club\/settlement\/summary'/.test(code), '判据认不出同形状的调用')
})

// CU-C-92(用户裁决 A):可提现为 0 时禁用提现主按钮并写明可提现条件。
// 病:按钮只判 submitting,顶部写着「可提现 ¥0.00」,主按钮仍是「联系平台客服提现」
//     —— 零余额下把「提现」当主行动会误导主理人。
// 负控:撤掉 withdrawState 闸(disabled/守卫/提示任一)本用例即红。
test('CU-C-92:可提现为 0 或余额未取到时禁用提现主按钮并说明条件', () => {
  const { vm, requests } = mount()
  vm.onLoad({ clubId: '21' })
  requests[0].success({ code: 200, data: VALID_SUMMARY })
  const modals = []
  const realShowModal = wx.showModal
  wx.showModal = (o) => modals.push(o)
  try {
    assert.equal(vm.data.withdrawState, 'unknown', '余额还没取到前不得假定可提现')
    vm.goWithdraw()
    assert.equal(modals.length, 0, '余额未知时不得发起提现')

    vm.onStages({ detail: { known: true, positive: false } })
    assert.equal(vm.data.withdrawState, 'zero')
    vm.goWithdraw()
    assert.equal(modals.length, 0, '可提现为 0 时不得发起提现')

    vm.onStages({ detail: { known: false, positive: false } })
    assert.equal(vm.data.withdrawState, 'unknown', 'amountsKnown=false 是「算不出」,不是 0')
    vm.goWithdraw()
    assert.equal(modals.length, 0)

    vm.onStages({ detail: { known: true, positive: true } })
    assert.equal(vm.data.withdrawState, 'positive')
    vm.goWithdraw()
    assert.equal(modals.length, 1, '有可提现余额时入口照旧可用')
  } finally { wx.showModal = realShowModal }

  // wxml 是真正决定按钮可不可点的一侧:禁用与提示文案都必须落在模板上
  const wxml = fs.readFileSync(path.join(root, 'pages/club/settlement/index.wxml'), 'utf8')
  assert.match(wxml, /disabled="\{\{withdrawing \|\| withdrawState !== 'positive'\}\}"/)
  assert.match(wxml, /wx:if="\{\{withdrawState === 'zero'\}\}"[^>]*>可提现为 0/)
  assert.match(wxml, /<cy-funds-stages[^>]*bind:stages="onStages"/, '余额事件必须真接到页面')
})

// CU-C-93:同一状态被 chip 与 meta 行各写一遍(pending 两处都是「待入账」,
// settled+已核验两处都是「已入账」),同一张卡上紧邻重复、用户读不出差别。
// 负控:把 paidText 行改回无条件渲染,本用例即红。
test('CU-C-93:chip 已经说清的状态不再在 meta 行重复一次', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/club/settlement/index.wxml'), 'utf8')
  const paidLine = wxml.match(/<text class="topic-row-meta-line"[^>]*>\{\{item\.paidText\}\}<\/text>/)
  assert.ok(paidLine, 'paidText 行还在(作废细节仍要说)')
  assert.match(paidLine[0], /wx:if="\{\{item\.status === 'void' \|\| item\.amountStatus !== 'verified'\}\}"/,
    'pending/已入账 两档与 chip 同词,不得再渲染一次')
})
