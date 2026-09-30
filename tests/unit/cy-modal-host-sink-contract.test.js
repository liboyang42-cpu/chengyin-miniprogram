// 2026-09-06 原生弹层全删:utils/modal.js 与 cy-modal-host 必须与 wx.showModal 同形——
// 参数照传、success 收到 {confirm, cancel, content};无宿主回落原生;后弹顶掉前弹时前一个按 cancel 结算不悬挂。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const MODAL = path.resolve(__dirname, '../../utils/modal.js')
const HOST = path.resolve(__dirname, '../../components/cy/modal-host/index.js')
function fresh(mod) { delete require.cache[mod]; return require(mod) }
function withGlobals(globals, fn) {
  const prev = {}
  for (const k of Object.keys(globals)) { prev[k] = global[k]; global[k] = globals[k] }
  try { return fn() } finally { for (const k of Object.keys(globals)) { if (prev[k] === undefined) delete global[k]; else global[k] = prev[k] } }
}
function loadHost() {
  let captured = null
  withGlobals({ Component: (o) => { captured = o }, Behavior: (o) => o, getApp: () => ({ globalData: {} }), wx: {} }, () => fresh(HOST))
  return Object.assign({}, captured.methods, { data: Object.assign({}, captured.data), setData(p) { Object.assign(this.data, p) } })
}

test('modal.show:有宿主走 host.open(同形参数),无宿主回落 wx.showModal(唯一出口)', () => {
  const opened = [], native = []
  const host = { open: (o) => opened.push(o) }
  withGlobals({ wx: { showModal: (o) => native.push(o) }, getCurrentPages: () => [{ selectComponent: (id) => (id === '#cy-modal-host' ? host : null) }] }, () => {
    fresh(MODAL).show({ title: 't', content: 'c', success() {} })
  })
  assert.equal(opened.length, 1); assert.equal(opened[0].title, 't'); assert.deepEqual(native, [])
  withGlobals({ wx: { showModal: (o) => native.push(o) }, getCurrentPages: () => [{ route: 'x' }] }, () => {
    fresh(MODAL).show({ title: 't2' })
  })
  assert.equal(native.length, 1); assert.equal(native[0].title, 't2')
})

test('cy-modal-host:confirm/cancel 回调同形;editable 把输入带回 content;后弹顶掉前弹时前弹按 cancel 结算', () => {
  const host = loadHost()
  const results = []
  host.open({ title: '确认删除', content: '不可恢复', success: (r) => results.push(['a', r.confirm, r.cancel]) })
  assert.deepEqual([host.data.show, host.data.title, host.data.showCancel], [true, '确认删除', true])
  host.onConfirm()
  assert.deepEqual(results, [['a', true, false]]); assert.equal(host.data.show, false)
  host.open({ title: '填原因', editable: true, placeholderText: '原因', success: (r) => results.push(['b', r.confirm, r.content]) })
  host.onInput({ detail: { value: '违规' } })
  host.onConfirm()
  assert.deepEqual(results[1], ['b', true, '违规'])
  host.open({ title: 'A', success: (r) => results.push(['A', r.confirm, r.cancel]) })
  host.open({ title: 'B', success: (r) => results.push(['B', r.confirm, r.cancel]) })
  assert.deepEqual(results[2], ['A', false, true], '前弹被顶掉必须结算为 cancel,不能悬挂')
  host.onCancel()
  assert.deepEqual(results[3], ['B', false, true])
  assert.equal(host.data.show, false)
})

test('cy-modal-host:showCancel:false 只留确认;complete 与 success 都被调用一次', () => {
  const host = loadHost(); let s = 0, c = 0
  host.open({ title: '知道了', showCancel: false, success: () => { s += 1 }, complete: () => { c += 1 } })
  assert.equal(host.data.showCancel, false)
  host.onConfirm()
  assert.deepEqual([s, c], [1, 1])
})

test('dangerKey:有宿主时走 cy-danger-confirm 三段式(后果清单),确认/取消回调形状不变;无宿主回落带真文案', () => {
  const host = loadHost()
  const dcCalls = []
  const dc = { open: (key, params) => { dcCalls.push([key, params]); return true }, close: () => dcCalls.push(['close']) }
  host.selectComponent = (id) => (id === '#dc' ? dc : null)
  const results = []
  host.open({ dangerKey: 'order.cancel-refund', dangerParams: { name: 'x' }, success: (r) => results.push([r.confirm, r.cancel]) })
  assert.deepEqual(dcCalls.filter((c) => c[0] !== 'close')[0], ['order.cancel-refund', { name: 'x' }])
  assert.equal(host.data.show, false, '危险写不走普通 cy-modal')
  host.onDcConfirm()
  assert.deepEqual(results, [[true, false]])
  host.open({ dangerKey: 'order.cancel', success: (r) => results.push([r.confirm, r.cancel]) })
  host.onDcCancel()
  assert.deepEqual(results[1], [false, true])
  // 危险层开着时来了普通弹窗:危险层必须先收掉,它的确认键不能结算到新回调上
  host.open({ dangerKey: 'order.cancel', success: (r) => results.push(['danger', r.confirm]) })
  dcCalls.length = 0
  host.open({ title: '普通', success: (r) => results.push(['plain', r.confirm]) })
  assert.deepEqual(dcCalls, [['close']], '普通 open 必须先 dc.close()')
  assert.deepEqual(results[2], ['danger', false], '被顶掉的危险确认按 cancel 结算')
  const native = []
  withGlobals({ wx: { showModal: (o) => native.push(o) }, getCurrentPages: () => [{ route: 'x' }] }, () => {
    fresh(MODAL).show({ dangerKey: 'order.cancel-refund', success() {} })
  })
  assert.equal(native.length, 1)
  assert.equal(native[0].title, '取消报名?')
  assert.match(native[0].content, /此操作不可撤销/)
  assert.match(native[0].content, /实际支付记录/)
  assert.doesNotMatch(native[0].content, /积分同步返还|预计.*工作日/)
  assert.equal(native[0].confirmText, '取消并退款')
})
