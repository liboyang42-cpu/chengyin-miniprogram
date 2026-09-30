// 订单详情收尾 T3f(2026-09-15 总控裁决):
//   ① 加载失败原因只说原因,不再写「请…重新进入」(面板 2s 自动回列表,指令多余)
//   ② 「和队友一起出发」卡排在支付明细之后,不打断稿 578:2298 的顺序
//   ③ 支付信息卡里的微信交易单号是纯值,动作不进信息卡(与订单号行一致)
//   ④ 退款态的状态卡副文案 / 「退款与客服」卡说退款事实,不被 refundInfo 的可退政策
//      「可全额退款,原路退回(预计1-3个工作日)」顶掉
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ROOT = path.resolve(__dirname, '../..')
const JS = path.join(ROOT, 'components/cy/scene-member-order-detail/index.js')
const WXML = path.join(ROOT, 'components/cy/scene-member-order-detail/index.wxml')

let sandbox
beforeEach(() => {
  sandbox = { requests: [], toasts: [] }
  global.getApp = () => ({
    globalData: {},
    tips: m => sandbox.toasts.push(m),
    sendRequest: o => sandbox.requests.push(o),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  })
  global.Component = config => { sandbox.pageConfig = flattenComponentToPage(config) }
  global.wx = { showToast() {}, hideLoading() {}, showLoading() {}, navigateTo() {}, navigateBack() {} }
})

function loadVm() {
  delete require.cache[require.resolve(JS)]
  require(JS)
  const vm = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() },
  })
  vm.data = Object.assign({}, sandbox.pageConfig.data)
  return vm
}
const infoReq = () => sandbox.requests.filter(r => r.url === '/api/registration/info')[0]

test('T3f ① 网络失败 / 后端无原因的业务失败:原因只说原因,不带「重新进入」指令', () => {
  let vm = loadVm()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoReq().fail({ errMsg: 'request:fail timeout' })
  assert.match(vm.data.loadErrorText, /网络/)
  assert.doesNotMatch(vm.data.loadErrorText, /重新进入|请返回/)

  sandbox.requests = []
  vm = loadVm()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoReq().success({ code: '500' })
  assert.ok(vm.data.loadErrorText)
  assert.doesNotMatch(vm.data.loadErrorText, /重新进入|请返回/)
})

test('T3f ② 组队卡在支付明细之后', () => {
  const wxml = fs.readFileSync(WXML, 'utf8')
  const team = wxml.indexOf('team-order-card')
  const pay = wxml.indexOf('>支付明细<')
  assert.ok(team > 0 && pay > 0, '锚点失效')
  assert.ok(team > pay, '「和队友一起出发」必须排在支付明细之后')
})

test('T3f ③ 微信交易单号行是纯值:无 bindtap、无「复制」', () => {
  const wxml = fs.readFileSync(WXML, 'utf8')
  const row = wxml.match(/<view class="orow"[^>]*>\s*<text class="orow-k">微信交易单号<\/text>[\s\S]*?<\/view>/)
  assert.ok(row, '锚点失效:没找到微信交易单号行')
  assert.doesNotMatch(row[0], /bindtap|复制/)
  assert.doesNotMatch(fs.readFileSync(JS, 'utf8'), /copyTransactionId/, '行内复制删掉后处理函数不应成孤儿')
})

test('T3f ④ 退款态文案取退款事实,不被可退政策里的「预计1-3个工作日」顶掉', () => {
  const vm = loadVm()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoReq().success({ code: '200', data: {
    id: 1001, ownerType: 1, registrationStatus: 3, paymentStatus: 4,
    refundApplication: { status: 1, payoutStatus: 0, refundAmount: 69 },
    refundInfo: { refundable: true, reason: '可全额退款,原路退回(预计1-3个工作日)', deadline: '2026-09-20 10:00:00' },
  } })
  assert.equal(vm.data.loadState, 'ready')
  const fact = vm.data.info.refundDisplayText
  assert.ok(fact)
  assert.equal(vm.data.stateNotice.sub, fact, '状态卡副文案必须是退款事实')
  assert.ok(!vm.data.info.refundDeadlineDisplay || vm.data.info.refundDeadlineDisplay === fact,
    '「退款与客服」卡优先读 refundDeadlineDisplay,退款态下它不得是可退政策')
  assert.doesNotMatch(vm.data.stateNotice.sub, /1-3/)
})

test('T3f ⑤ 退款还在审核时,状态卡标题不说「已受理」', () => {
  const vm = loadVm()
  vm.data.orderId = '1001'
  vm.onLoad()
  infoReq().success({ code: '200', data: {
    id: 1001, ownerType: 1, registrationStatus: 2, paymentStatus: 2,
    refundApplication: { status: 0, payoutStatus: 5, refundAmount: 69 },
  } })
  assert.equal(vm.data.info.statusText, '退款审核中')
  assert.doesNotMatch(vm.data.stateNotice.title, /受理/)
})
