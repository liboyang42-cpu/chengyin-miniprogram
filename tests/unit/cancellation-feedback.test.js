const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const root = path.resolve(__dirname, '../..')
const entries = [
  ['详情', 'components/cy/scene-member-order-detail/index.js'],
  ['列表', 'components/cy/scene-member-order-history/index.js'],
  ['清退', 'pages/club/checkin-detail/index.js'],
]

function mount(file) {
  const requests = [], messages = [], dialogs = []
  const app = { globalData: { user_id: 7, role: 'club', user_type: 1 }, sendRequest: r => requests.push(r) }
  global.getApp = () => app
  let definition
  const localRequire = createRequire(path.join(root, file))
  const toast = text => messages.push(text)
  toast.success = toast
  toast.error = toast
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    getApp: () => app, Component: c => { definition = c }, Page: c => { definition = c },
    require(name) {
      if (name.endsWith('/toast.js')) return toast
      if (name.endsWith('/modal.js')) return { show: options => dialogs.push(options) }
      if (name.endsWith('/loading.js')) return { show() {}, hide() {} }
      return localRequire(name)
    },
    wx: {}, console, setTimeout, clearTimeout,
  }, { filename: file })
  let refreshes = 0
  const page = Object.assign({}, definition.methods || definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
    // 组件真实 API：详情取消成功后 triggerEvent('orderchanged')(c08953103，由 order-detail-parent-refresh 单测覆盖)
    triggerEvent() {},
    getData() { refreshes++ }, getList() { refreshes++ }, load() { refreshes++ },
  })
  page.data.id = 9
  page._orderId = 9 // 详情组件的订单 id 在实例态(死数据字段门禁 A2)
  page.data.info = { id: 9, paymentStatus: 2, canRequestRefund: true }
  page.data.detail = { registrationId: 9, canRefund: true }
  if (file.includes('order-history')) page.cancelOrderRequest(9, 0, 2)
  else {
    if (file.includes('order-detail')) page.cancelRegistration()
    else page.refund()
    dialogs[0].success({ confirm: true })
  }
  return { request: requests[0], messages, refreshes: () => refreshes }
}

const reports = [
  { msg: '报名已取消；本单无现金退款，未使用积分。', cancellationStatus: 'CANCELLED', cashRefundStatus: 'NOT_NEEDED' },
  { msg: '报名已取消；无现金退款，已返还20积分。', cancellationStatus: 'CANCELLED', cashRefundStatus: 'NOT_NEEDED' },
  { msg: '报名已取消；现金退款正在渠道处理中。', cancellationStatus: 'CANCELLED', cashRefundStatus: 'PROCESSING' },
  { msg: '报名已取消；现金退款已由渠道确认成功。', cancellationStatus: 'CANCELLED', cashRefundStatus: 'SUCCESS' },
  { msg: '取消操作已提交，结果暂未确认，请刷新订单查看。', cancellationStatus: 'UNCONFIRMED', cashRefundStatus: 'UNCONFIRMED' },
]
for (const [label, file] of entries) {
  for (const report of reports) {
    test(`F07 ${label} 显示后端回读事实：${report.msg}`, () => {
      const h = mount(file)
      h.request.success({ code: 200, msg: report.msg, data: report })
      assert.deepEqual(h.messages, [report.msg])
      assert.equal(h.refreshes(), 1, '反馈后仍回读订单状态')
    })
  }
  test(`F07 ${label} 旧响应缺少事实时不复述固定到账承诺`, () => {
    const h = mount(file)
    h.request.success({ code: 200, msg: '现金已原路退款，积分已返还' })
    assert.deepEqual(h.messages, ['取消请求已受理，请刷新订单查看结果'])
  })
}
