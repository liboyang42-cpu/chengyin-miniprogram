// 6-12 订单列表「申请退款」弹窗的截止规则必须以后端返回的 refundInfo 为准。
//
// 病:弹窗把截止话术写死成「已核销或已过开始时间不可退」,而后端真实规则是
// 场次票「集合前 24 小时可退」(RefundPolicy.SESSION_REFUND_WINDOW_MS)。集合前 20 小时的
// 单还能退,弹窗却告诉用户不能退 —— 前端自己算出来的规则与后端不一致。
//
// 合同:① 能退时说的话术来自后端(可退 + deadline → 可免费取消至 …);
//       ② 不能退时原样用后端给的 reason,不自己编;
//       ③ 后端没给 refundInfo 时用中性话术,不得再出现写死的规则句。
'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ROOT = path.resolve(__dirname, '../..')
const JS = path.join(ROOT, 'components/cy/scene-member-order-history/index.js')

function mount() {
  const modals = []
  global.getApp = () => ({
    getPageSize: () => 10,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: () => {},
    getUserID: () => 7,
  })
  let def = null
  global.Component = (config) => { def = flattenComponentToPage(config) }
  global.wx = { showModal() {}, showLoading() {}, hideLoading() {}, showToast() {}, switchTab() {} }

  const modalPath = require.resolve(path.join(ROOT, 'utils/modal.js'))
  delete require.cache[modalPath]
  require.cache[modalPath] = { id: modalPath, filename: modalPath, loaded: true,
    exports: { show: (o) => { modals.push(o); return true } } }
  delete require.cache[JS]
  require(JS)
  delete require.cache[modalPath]

  const vm = Object.assign({}, def, {
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent() {},
  })
  return { vm, modals }
}

function openCancelDialog(row) {
  const { vm, modals } = mount()
  vm.data.list = [row]
  vm.cancelOrder({ currentTarget: { dataset: { index: 0, id: 1, status: 2 } } })
  assert.equal(modals.length, 1, '应弹出危险确认')
  assert.equal(modals[0].dangerKey, 'order.cancel-refund')
  return modals[0]
}

test('可退单:弹窗截止话术来自后端 deadline,不写死规则', () => {
  const dialog = openCancelDialog({
    id: 1, registrationStatus: 2, paymentStatus: 2,
    refundInfo: { refundable: true, deadline: '2026-08-01T18:00:00+08:00', reason: '可全额退款' },
  })
  assert.match(String(dialog.dangerParams.deadline), /^可免费取消至 2026-08-01 18:00$/)
  assert.doesNotMatch(JSON.stringify(dialog.dangerParams), /已核销或已过开始时间不可退/)
})

test('不可退单:原样用后端 reason,前端不自己编', () => {
  const dialog = openCancelDialog({
    id: 1, registrationStatus: 2, paymentStatus: 2,
    refundInfo: { refundable: false, reason: '已错过集合前24小时,不可退款' },
  })
  assert.equal(dialog.dangerParams.deadline, '已错过集合前24小时,不可退款')
})

test('后端没给 refundInfo:中性话术,不出现写死的不可退规则', () => {
  const dialog = openCancelDialog({ id: 1, registrationStatus: 2, paymentStatus: 2 })
  assert.equal(dialog.dangerParams.deadline, '退款规则以提交后的平台判定为准')
})

test('负控锚点:组件源码里不得再有写死的截止规则', () => {
  const source = fs.readFileSync(JS, 'utf8')
  assert.doesNotMatch(source, /已核销或已过开始时间不可退/, '写死的规则句是这次的病根,不许回潮')
  assert.match(source, /refundInfo/, '必须真的读后端 refundInfo')
})
