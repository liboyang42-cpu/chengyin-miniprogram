const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ROOT = path.resolve(__dirname, '../..')
const HISTORY = path.join(ROOT, 'components/cy/scene-member-order-history/index.js')
const DETAIL = path.join(ROOT, 'components/cy/scene-member-order-detail/index.js')

function historyVm() {
  const sandbox = { requests: [], modals: [], toasts: [] }
  global.getApp = () => ({
    getPageSize: () => 10,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: (options) => sandbox.requests.push(options),
  })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {
    showModal: (options) => sandbox.modals.push(options),
    showLoading() {}, hideLoading() {},
    showToast: (options) => sandbox.toasts.push(options.title),
    switchTab() {},
  }
  delete require.cache[require.resolve(HISTORY)]
  require(HISTORY)
  const vm = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent() {},
  })
  vm.data = JSON.parse(JSON.stringify(sandbox.def.data))
  return { vm, sandbox }
}

function detailVm() {
  const sandbox = { requests: [], modals: [], toasts: [] }
  global.getApp = () => ({
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: (options) => sandbox.requests.push(options),
  })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {
    showModal: (options) => sandbox.modals.push(options),
    showLoading() {}, hideLoading() {},
    showToast: (options) => sandbox.toasts.push(options.title),
  }
  delete require.cache[require.resolve(DETAIL)]
  require(DETAIL)
  const vm = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent() {},
  })
  vm.data = JSON.parse(JSON.stringify(sandbox.def.data))
  return { vm, sandbox }
}

test('订单列表 200 畸形 rows 进入错误态，保留已确认列表且不抛异常', () => {
  for (const rows of [null, {}, 'not-array', true]) {
    const { vm, sandbox } = historyVm()
    vm.data.list = [{ id: 9, registrationNo: 'confirmed' }]
    vm.data.hasOrders = true
    vm.getList(false, true)
    assert.doesNotThrow(() => sandbox.requests[0].success({ code: 200, data: { rows } }))
    sandbox.requests[0].complete()
    assert.equal(vm.data.list[0].id, 9)
    assert.match(vm.data.errorMsg, /订单/)
    assert.equal(vm.data.nodata, false)
  }
})

test('订单列表刷新失败使用非阻断错误，成功重试后再替换旧列表', () => {
  const { vm, sandbox } = historyVm()
  vm.data.list = [{ id: 9, registrationNo: 'old' }]
  vm.data.hasOrders = true
  vm.getList(false, true)
  sandbox.requests[0].fail({ msg: '刷新失败' })
  sandbox.requests[0].complete()
  assert.deepEqual(vm.data.list.map((item) => item.id), [9])
  assert.equal(vm.data.errorMsg, '刷新失败')

  vm.retryList()
  sandbox.requests[1].success({ code: 200, data: { rows: [{ id: 10, registrationStatus: 1 }] } })
  sandbox.requests[1].complete()
  assert.deepEqual(vm.data.list.map((item) => item.id), [10])
  assert.equal(vm.data.errorMsg, '')
})

test('列表取消/退款从确认弹窗到请求全链路 single-flight', () => {
  const { vm, sandbox } = historyVm()
  const event = { currentTarget: { dataset: { id: 8, index: 0, status: 2 } } }
  vm.cancelOrder(event)
  vm.cancelOrder(event)
  assert.equal(sandbox.modals.length, 1, '连点只允许一个确认弹窗')

  sandbox.modals[0].success({ confirm: true })
  vm.cancelOrderRequest(8, 0, 2)
  vm.cancelOrder(event)
  assert.equal(sandbox.requests.length, 1, '确认后到请求完成前只允许一个退款请求')
  assert.equal(vm.data.cancellingId, 8)

  sandbox.requests[0].complete()
  vm.cancelOrder(event)
  assert.equal(sandbox.modals.length, 2, '请求完成后才恢复动作')
})

test('订单详情取消/退款确认弹窗与写请求 single-flight', () => {
  const { vm, sandbox } = detailVm()
  vm._orderId = 8
  vm.data.info = { id: 8, paymentStatus: 2, registrationStatus: 2, canRequestRefund: true }
  vm.cancelRegistration()
  vm.cancelRegistration()
  assert.equal(sandbox.modals.length, 1)

  sandbox.modals[0].success({ confirm: true })
  vm.cancelRegistration()
  assert.equal(sandbox.requests.length, 1)
  assert.equal(vm.data.cancelling, true)

  sandbox.requests[0].complete()
  vm.cancelRegistration()
  assert.equal(sandbox.modals.length, 2)
})

test('订单部分错误与动作 busy 状态在 WXML 中可见且可访问', () => {
  const history = fs.readFileSync(path.join(ROOT, 'components/cy/scene-member-order-history/index.wxml'), 'utf8')
  const detail = fs.readFileSync(path.join(ROOT, 'components/cy/scene-member-order-detail/index.wxml'), 'utf8')
  assert.match(history, /errorMsg && list\.length>0/)
  assert.match(history, /bind:retry="retryList"/)
  assert.match(history, /aria-disabled="\{\{cancellingId[^}]*\}\}"/)
  assert.match(detail, /aria-disabled="\{\{cancelling\}\}"/)
  assert.doesNotMatch(detail, />\s*›\s*</, '文字箭头必须替换成项目图标资产')
})

test('negative control: rows.map 前无数组验证、取消链路无 prompt guard 都会判红', () => {
  const history = fs.readFileSync(HISTORY, 'utf8')
  const detail = fs.readFileSync(DETAIL, 'utf8')
  assert.match(history, /Array\.isArray\(rows\)/)
  assert.match(history, /_cancelPromptOpen/)
  assert.match(history, /_cancelRequestInFlight/)
  assert.match(detail, /_cancelPromptOpen/)
})
