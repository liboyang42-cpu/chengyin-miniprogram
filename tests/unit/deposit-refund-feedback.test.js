const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

function mount(relative, component) {
  const requests = []
  let definition
  global.getApp = () => ({ globalData: {}, getUserID: () => '9', sendRequest: request => requests.push(request) })
  global.wx = { showToast() {} }
  global.Page = global.Component = value => { definition = value }
  const file = path.resolve(__dirname, '../..', relative)
  delete require.cache[require.resolve(file)]
  require(file)
  const vm = { ...(component ? definition.methods : definition), data: structuredClone(definition.data),
    setData(patch) { Object.assign(this.data, patch) }, triggerEvent() {} }
  return { vm, requests }
}

test('解散阻断收到支付待确认200仍保留原事项并显示真实反馈', () => {
  const { vm, requests } = mount('components/cy/scene-club-edit/index.js', true)
  const item = { title: '保证金 #8', url: '/pages/club/dissolution-blockers/index?clubId=7&type=deposit&id=8' }
  vm.data.clubId = '7'
  vm.data.dissolutionBlockerItems = [item]
  vm.retryDissolutionDeposit('8', item)
  requests[0].success({ code: 200, msg: '保证金支付待确认，尚未发起退款', data: { depositStatus: 1, refundState: 'PAYMENT_PENDING' } })
  assert.deepEqual(vm.data.dissolutionBlockerItems, [item])
  assert.match(vm.data.dissolutionBlockerText, /支付待确认/)
  assert.doesNotMatch(vm.data.dissolutionBlockerText, /已受理|可以再次尝试解散/)
  assert.equal(requests.some(request => request.url === '/api/club/dissolve'), false)
})

test('合作列表使用未缴事实消息，不把所有200覆盖成已受理', () => {
  const { vm, requests } = mount('pages/coop/list/index.js', false)
  vm._beginAction = () => true
  let receipt, error, refreshes = 0
  vm._finishAction = (key, value, failure) => { receipt = value; error = failure }
  vm.load = () => { refreshes += 1 }
  vm.retryDepositRefund({ currentTarget: { dataset: { id: '8' } } })
  requests[0].success({ code: 200, msg: '保证金尚未缴纳，无需发起退款', data: { depositStatus: 5, refundState: 'UNPAID' } })
  assert.equal(receipt, '保证金尚未缴纳，无需发起退款')
  assert.equal(error, '')
  assert.equal(refreshes, 1)
})

test('两入口全部有事实的200沿用消息，解散阻断不按成功壳删除', () => {
  for (const [depositStatus, refundState, msg] of [
    [0, 'NOT_REQUIRED', '该合作无需保证金退款'],
    [1, 'PAYMENT_PENDING', '保证金支付待确认，尚未发起退款'],
    [3, 'DEDUCTED', '保证金已扣划，无法退款，请联系客服'],
    [2, 'DISPATCH_PENDING', '退款申请已登记，等待渠道处理'],
    [2, 'PROCESSING', '保证金退款处理中，请稍后核对'],
    [4, 'SUCCESS', '渠道已确认保证金退款成功'],
    [5, 'UNPAID', '保证金尚未缴纳，无需发起退款'],
  ]) {
    for (const component of [false, true]) {
      const { vm, requests } = mount(component ? 'components/cy/scene-club-edit/index.js' : 'pages/coop/list/index.js', component)
      const item = { id: 8 }
      vm.data.dissolutionBlockerItems = [item]
      let reload = 0
      vm.load = () => { reload += 1 }
      if (component) vm.retryDissolutionDeposit('8', item)
      else vm.retryDepositRefund({ currentTarget: { dataset: { id: '8' } } })
      requests[0].success({ code: 200, msg, data: { depositStatus, refundState, channelConfirmed: false } })
      if (component) {
        assert.deepEqual(vm.data.dissolutionBlockerItems, [item])
        assert.ok(vm.data.dissolutionBlockerText.includes(msg))
      } else {
        assert.equal(vm.data.actionReceipt, msg)
        assert.equal(reload, 1)
      }
      assert.equal(requests.length, 1, '不能自动再退款或自动解散')
    }
  }
})

test('拒权、冻结失败、畸形200与HTTP/网络未知均释放等待但不假完成或自动重试', () => {
  const failures = [
    ['success', { code: 403, msg: '仅合作双方可重试保证金退款' }, /仅合作双方/],
    ['success', { code: 500, msg: '保证金仍处于冻结状态，退款结果待核对，请联系客服', data: { depositStatus: 2, refundState: 'HELD' } }, /冻结状态/],
    ['success', { code: 200, msg: '操作成功', data: {} }, /无法确认/],
    ['success', null, /失败|无法确认/],
    ['fail', { errMsg: 'request:fail timeout' }, /无法确认/],
    ['successStatusAbnormal', { statusCode: 502 }, /无法确认/],
  ]
  for (const component of [false, true]) {
    for (const [callback, value, expected] of failures) {
      const { vm, requests } = mount(component ? 'components/cy/scene-club-edit/index.js' : 'pages/coop/list/index.js', component)
      const item = { id: 8 }
      vm.data.dissolutionBlockerItems = [item]
      vm.load = () => assert.fail('未知或失败不得刷新成成功流程')
      const submit = () => component ? vm.retryDissolutionDeposit('8', item)
        : vm.retryDepositRefund({ currentTarget: { dataset: { id: '8' } } })
      submit(); submit()
      assert.equal(requests.length, 1, '在途防重复')
      requests[0][callback](value)
      const message = component ? vm.data.dissolutionBlockerText : vm.data.actionError
      assert.match(message, expected)
      assert.doesNotMatch(message, /没有送出去|已受理|已到账|可以再次尝试解散/)
      if (component) { assert.equal(vm._blockerRetrying, false); assert.deepEqual(vm.data.dissolutionBlockerItems, [item]) }
      else { assert.equal(vm.data.actionPendingKey, ''); assert.equal(vm.data.actionReceipt, '') }
      assert.equal(requests.length, 1)
    }
  }
})


test('历史4入口明确只查原退款，缺事实仍留阻断且客服路由实际已注册', () => {
  const { vm, requests } = mount('components/cy/scene-club-edit/index.js', true)
  const item = { actionText: '核对退款结果', url: '/pages/club/dissolution-blockers/index?clubId=7&type=deposit&id=8' }
  vm.data.dissolutionBlockerItems = [item]
  vm.openDissolutionBlockerItem({ currentTarget: { dataset: { index: 0 } } })
  assert.match(vm.data.dissolutionBlockerText, /仅查询原退款单/)
  assert.doesNotMatch(vm.data.dissolutionBlockerText, /正在重试/)
  requests[0].success({ code: 500, msg: '历史退款记录尚无到账凭据，请联系客服核对', data: { refundState: 'LEGACY_UNCONFIRMED' } })
  assert.deepEqual(vm.data.dissolutionBlockerItems, [item])
  assert.equal(requests.length, 1)
  let destination
  global.wx.navigateTo = value => { destination = value.url }
  vm.data.dissolutionBlockerItems = [{ actionText: '联系平台核验', url: '/pages/shezhi/about/index' }]
  vm.openDissolutionBlockerItem({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(destination, '/pages/shezhi/about/index')
  const app = require('../../app.json')
  assert.ok((app.subPackages || app.subpackages).some(p => p.root === 'pages/shezhi' && p.pages.includes('about/index')))
})
