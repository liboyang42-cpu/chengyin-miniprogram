const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE = path.resolve(__dirname, '../../pages/club/event-ops/index.js')
const WXML = path.resolve(__dirname, '../../pages/club/event-ops/index.wxml')
let sandbox

beforeEach(() => {
  sandbox = { requests: [], modals: [], toasts: [], config: null }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { sandbox.requests.push(options) },
  })
  global.getCurrentPages = () => [{}, {}]
  global.wx = {
    showModal(options) { sandbox.modals.push(options) },
    showToast(options) { sandbox.toasts.push(options) },
    stopPullDownRefresh() {},
    navigateBack() {},
    switchTab() {},
  }
  global.Page = config => { sandbox.config = config }
})

function page(data) {
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const vm = Object.assign({}, sandbox.config)
  vm.data = Object.assign({}, sandbox.config.data, data || {})
  vm.setData = function (patch, callback) {
    Object.assign(this.data, patch)
    if (callback) callback()
  }
  return vm
}

test('二次确认弹层是没有顶栏/无 ✕ 的居中 T2，只能靠按钮关闭', () => {
  const wxml = fs.readFileSync(WXML, 'utf8')
  assert.match(wxml,
    /<cy-modal\b[^>]*compact\b[^>]*show="\{\{cancelConfirmShow\}\}"[^>]*bind:confirm="confirmCancelOccurrence"[^>]*bind:cancel="dismissCancelConfirm"/)
  assert.doesNotMatch(wxml, /<cy-modal\b[^>]*compact\b[^>]*maskClosable/i,
    'T2 只能点按钮关闭，不许打开遮罩点击关闭')
})

test('真实 activityId 且具 ACTIVITY_MANAGE 才显示取消本场入口，并要求填写原因', () => {
  const wxml = fs.readFileSync(WXML, 'utf8')
  assert.match(wxml, /canManage\s*&&\s*activityId[\s\S]*?bindtap="cancelCurrentOccurrence"/)

  const vm = page({ clubId: 21, activityId: 71, canManage: true })
  vm.cancelCurrentOccurrence()

  assert.equal(sandbox.modals.length, 1)
  assert.equal(sandbox.modals[0].editable, true)
  assert.match(sandbox.modals[0].placeholderText, /取消原因/)
})

test('原因合法后先弹出 T2 居中二次确认，不直接发请求；确认后才发起取消', () => {
  const vm = page({ clubId: 21, activityId: 71, canManage: true })
  vm.cancelCurrentOccurrence()
  sandbox.modals[0].success({ confirm: true, content: '场地临时关闭' })

  assert.equal(vm.data.cancelConfirmShow, true)
  assert.equal(sandbox.requests.length, 0)

  vm.confirmCancelOccurrence()

  assert.equal(vm.data.cancelConfirmShow, false)
  assert.equal(sandbox.requests.length, 1)
})

test('二次确认点“再想想”不会发起取消请求，且不留下待提交的原因', () => {
  const vm = page({ clubId: 21, activityId: 71, canManage: true })
  vm.cancelCurrentOccurrence()
  sandbox.modals[0].success({ confirm: true, content: '场地临时关闭' })
  assert.equal(vm.data.cancelConfirmShow, true)

  vm.dismissCancelConfirm()

  assert.equal(vm.data.cancelConfirmShow, false)
  assert.equal(sandbox.requests.length, 0)

  vm.confirmCancelOccurrence()
  assert.equal(sandbox.requests.length, 0, '再想想之后没有待提交原因，误触确认也不该发请求')
})

test('取消响应不能乐观显示成功，必须独立回读 occurrence 状态后才确认', () => {
  const vm = page({ clubId: 21, activityId: 71, canManage: true })
  vm.cancelCurrentOccurrence()
  sandbox.modals[0].success({ confirm: true, content: '场地临时关闭' })
  vm.confirmCancelOccurrence()

  assert.equal(sandbox.requests.length, 1)
  assert.equal(sandbox.requests[0].url, '/api/club/event-ops/cancel')
  const payload = JSON.parse(sandbox.requests[0].data)
  assert.deepEqual({ clubId: payload.clubId, activityId: payload.activityId, reason: payload.reason }, {
    clubId: 21, activityId: 71, reason: '场地临时关闭',
  })
  assert.match(payload.requestId, /^event-cancel-/)

  sandbox.requests[0].success({
    code: 200,
    data: {
      activityId: 71,
      refundStatus: 'REFUND_REQUESTED',
      registeredNotificationStatus: 'QUEUED',
      waitlistNotificationStatus: 'QUEUED',
    },
  })
  assert.equal(sandbox.toasts.some(item => item.icon === 'success'), false,
    '写接口回执不是对面状态，不能先显示成功')
  assert.equal(sandbox.requests.length, 2)
  assert.equal(sandbox.requests[1].url, '/api/club/event-ops/occurrence/status')

  sandbox.requests[1].success({
    code: 200,
    data: { activityId: 71, occurrenceStatus: 'CANCELLED', activityCancelled: true, publishStatus: 0 },
  })
  assert.equal(vm.data.cancellationState, 'cancelled')
  assert.equal(sandbox.toasts.at(-1).icon, 'success')
  assert.match(vm.data.cancellationSummary, /退款.*受理|无需退款/)
  assert.match(vm.data.cancellationSummary, /通知.*队列|无需通知/)
})

test('回读异常或状态未取消时 fail-closed，不把本场显示成已取消', () => {
  const vm = page({ clubId: 21, activityId: 71, canManage: true })
  vm.submitOccurrenceCancellation('场地临时关闭')
  sandbox.requests[0].success({
    code: 200,
    data: { activityId: 71, refundStatus: 'ACCEPTED' },
  })
  sandbox.requests[1].success({
    code: 200,
    data: { activityId: 71, occurrenceStatus: 'ACTIVE', activityCancelled: false, publishStatus: 1 },
  })

  assert.equal(vm.data.cancellationState, 'readback-error')
  assert.match(vm.data.cancellationError, /回读/)
  assert.equal(sandbox.toasts.some(item => item.icon === 'success'), false)
})

test('ACTIVE 回读必须同时证明活动未取消且仍发布，矛盾状态 fail-closed', () => {
  const vm = page({ clubId: 21, activityId: 71, canManage: true })
  vm.loadCancellationState()
  sandbox.requests[0].success({
    code: 200,
    data: { activityId: 71, occurrenceStatus: 'ACTIVE', activityCancelled: true, publishStatus: 0 },
  })

  assert.equal(vm.data.cancellationState, 'readback-error')
  assert.match(vm.data.cancellationError, /回读/)
})

test('网络结果未知时保留同一 requestId，同原因重试不会重复退款或建通知', () => {
  const vm = page({ clubId: 21, activityId: 71, canManage: true })
  vm.submitOccurrenceCancellation('场地临时关闭')
  const first = JSON.parse(sandbox.requests[0].data)
  sandbox.requests[0].fail()
  sandbox.requests[0].complete()

  vm.submitOccurrenceCancellation('场地临时关闭')
  const second = JSON.parse(sandbox.requests[1].data)
  assert.equal(second.requestId, first.requestId)

  sandbox.requests[1].fail()
  sandbox.requests[1].complete()
  vm.submitOccurrenceCancellation('改为极端天气')
  const changed = JSON.parse(sandbox.requests[2].data)
  assert.notEqual(changed.requestId, first.requestId,
    '不同原因不能复用旧幂等键，否则服务端只能冲突')
})

test('EVENT-only 角色没有 ACTIVITY_MANAGE 时前端不发取消请求', () => {
  const vm = page({ clubId: 21, activityId: 71, canManage: false })
  vm.cancelCurrentOccurrence()
  assert.equal(sandbox.modals.length, 0)
  assert.equal(sandbox.requests.length, 0)
})
