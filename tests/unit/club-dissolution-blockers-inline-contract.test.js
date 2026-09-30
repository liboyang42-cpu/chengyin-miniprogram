// 2026-09-06 孤儿页清理:pages/club/dissolution-blockers 删除后,后端 ApiClubController 仍给每条阻塞项写死
// 指向那页的 url(ApiClubLifecycleTest 也钉着这串)。scene-club-edit 的弹层必须就地承接,否则每一项点击都是死链。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const COMPONENT = path.resolve(__dirname, '../../components/cy/scene-club-edit/index.js')

function loadComponent() {
  const requests = [], navigations = []
  const prev = { Component: global.Component, Behavior: global.Behavior, getApp: global.getApp, wx: global.wx }
  let captured = null
  global.Component = (o) => { captured = o }
  global.Behavior = (o) => o
  global.getApp = () => ({ globalData: {}, sendRequest: (o) => requests.push(o), tips: () => {} })
  global.wx = { navigateTo: (o) => navigations.push(o.url), getStorageSync: () => '', setStorageSync: () => {} }
  try { delete require.cache[COMPONENT]; require(COMPONENT) } finally {
    global.Component = prev.Component; global.Behavior = prev.Behavior; global.getApp = prev.getApp
  }
  const vm = Object.assign({}, captured.methods, { data: Object.assign({}, captured.data), setData(p) { Object.assign(this.data, p) } })
  return { vm, requests, navigations }
}

const ITEMS = [
  { label: '保证金 #9 · 待退', url: '/pages/club/dissolution-blockers/index?clubId=7&type=deposit&id=9' },
  { label: '待付出去 · 结算 #3', url: '/pages/club/dissolution-blockers/index?clubId=7&type=settlement&id=3' },
  { label: '别的页', url: '/pages/club/customers/index?clubId=7' },
]

test('押金阻塞项:点击直接在弹层里重试原路退款,不跳已删除的页', () => {
  const { vm, requests, navigations } = loadComponent()
  vm.data.dissolutionBlockerItems = ITEMS.slice(); vm.data.showDissolutionBlockers = true
  vm.openDissolutionBlockerItem({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(navigations, [])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/coop/deposit/refund/retry')
  assert.deepEqual(JSON.parse(requests[0].data), { inviteId: '9' })
  vm.openDissolutionBlockerItem({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(requests.length, 1, '在途期间不许重复发退款重试')
  // d7593ff37 起:退款接口只报告保证金状态,未重新读取解散条件前不得移除阻断项;
  // 回包缺 refundState/msg 事实时不得说「已受理」
  requests[0].success({ code: '200' })
  assert.equal(vm.data.dissolutionBlockerItems.length, 3, '退款接口 200 不代表解散条件已满足,阻断项必须保留')
  assert.equal(vm.data.dissolutionBlockerText, '退款结果暂无法确认；未结事项仍保留，请核对后再操作')
})

test('押金阻塞项:回包带渠道事实时复述后端 msg,阻断项仍保留', () => {
  const { vm, requests } = loadComponent()
  vm.data.dissolutionBlockerItems = ITEMS.slice(); vm.data.showDissolutionBlockers = true
  vm.openDissolutionBlockerItem({ currentTarget: { dataset: { index: 0 } } })
  requests[0].success({ code: '200', msg: '保证金退款已受理', data: { refundState: 'PROCESSING' } })
  assert.equal(vm.data.dissolutionBlockerItems.length, 3)
  assert.equal(vm.data.dissolutionBlockerText, '保证金退款已受理；未结事项仍保留，请核对后再操作')
})

test('结算阻塞项:落到俱乐部结算页;非阻塞页 url 原样跳', () => {
  const { vm, navigations } = loadComponent()
  vm.data.dissolutionBlockerItems = ITEMS.slice()
  vm.openDissolutionBlockerItem({ currentTarget: { dataset: { index: 1 } } })
  vm.openDissolutionBlockerItem({ currentTarget: { dataset: { index: 2 } } })
  assert.deepEqual(navigations, ['/pages/club/settlement/index?clubId=7', '/pages/club/customers/index?clubId=7'])
  assert.doesNotMatch(navigations.join('\n'), /dissolution-blockers/, '不许再跳已删除的页')
})

test('退款重试失败:弹层留在原地并显示原因', () => {
  const { vm, requests } = loadComponent()
  vm.data.dissolutionBlockerItems = ITEMS.slice(); vm.data.showDissolutionBlockers = true
  vm.openDissolutionBlockerItem({ currentTarget: { dataset: { index: 0 } } })
  requests[0].success({ code: '500', msg: '退款通道关闭' })
  assert.equal(vm.data.showDissolutionBlockers, true)
  assert.equal(vm.data.dissolutionBlockerText, '退款通道关闭')
  assert.equal(vm.data.dissolutionBlockerItems.length, 3)
})
