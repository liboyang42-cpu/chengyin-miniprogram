// H09 迁移的核心约束:订单列表 + 支付 + 取消/退款 只有一份实现。
//
// subpackageMember/order/order 已退化成深链薄壳,渲染 components/cy/scene-member-order-history。
// 最危险的回潮是"为了让页面独立跑,把资金逻辑抄一份回页面" —— 两份钱的代码必然漂移,
// 而漂移的那一刻不会有任何报错。这里把"壳里不许有资金逻辑"写死。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const SHELL_JS = 'subpackageMember/order/order.js'
const SHELL_WXML = 'subpackageMember/order/order.wxml'
const COMPONENT_JS = 'components/cy/scene-member-order-history/index.js'

// 只要出现其中任何一个,就说明资金/列表逻辑被抄回了壳
const MONEY_MARKERS = [
  '/api/registration/pay',
  '/api/registration/cancel',
  '/api/registration/cancel-refund',
  '/api/registration/list',
  'requestPayment',
  'createCheckoutWorkflow',
  'summarizeOrderState',
]

test('深链壳里没有任何订单/资金逻辑', () => {
  const shell = read(SHELL_JS)
  const leaked = MONEY_MARKERS.filter((m) => shell.includes(m))
  assert.deepEqual(leaked, [], `资金/列表逻辑漏回页面壳:${leaked.join(', ')}`)
})

test('这些逻辑确实存在于组件里(否则上一条是空断言)', () => {
  const component = read(COMPONENT_JS)
  for (const marker of MONEY_MARKERS) {
    assert.ok(component.includes(marker), `组件里应当有 ${marker},否则"壳里没有"毫无意义`)
  }
})

test('壳渲染的就是那个组件,而不是自己画一套', () => {
  const wxml = read(SHELL_WXML)
  assert.match(wxml, /<cy-scene-member-order-history\b/, '壳必须渲染场景内容组件')
  assert.doesNotMatch(wxml, /class="orderbox_li"/, '壳不得自己再画一份订单卡')
  const json = JSON.parse(read('subpackageMember/order/order.json'))
  assert.equal(
    json.usingComponents['cy-scene-member-order-history'],
    '/components/cy/scene-member-order-history/index'
  )
})

test('订单页把上拉加载转给组件,并自己承载「订单详情」这一三级场景', () => {
  // 层级规则(用户 2026-08-04 定):我的订单是二级大功能 ⇒ 正常页面;
  // 从它点开的订单详情是「查看状态」⇒ 三级弹窗,由本页做宿主,不再压新页面栈。
  const shell = read(SHELL_JS)
  assert.match(shell, /onReachBottom\(\)[\s\S]*selectComponent\('#orderHistory'\)[\s\S]*loadMore/)
  assert.match(shell, /openScene\(e\)[\s\S]*getScene\(detail\.id/)
  assert.doesNotMatch(shell, /navigateTo/, '详情不得再 navigateTo 压页面栈')
  const wxml = read(SHELL_WXML)
  assert.match(wxml, /sceneCurrent\.id === 'member-order-detail'/, '订单页必须挂详情场景')
  assert.match(wxml, /<cy-scene-sheet\b/)
})

test('组件里打开详情走 open 事件,不在弹窗内 navigateTo 压新页', () => {
  const component = read(COMPONENT_JS)
  assert.match(component, /triggerEvent\('open', \{ id: 'member-order-detail'/)
  // 先剥注释:注释里写「原来整卡是 <navigator>」是说明,不是真节点。
  const wxml = read('components/cy/scene-member-order-history/index.wxml').replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(wxml, /<navigator\b/, '弹窗正文里不得有 navigator(会压出新页面栈)')
})
