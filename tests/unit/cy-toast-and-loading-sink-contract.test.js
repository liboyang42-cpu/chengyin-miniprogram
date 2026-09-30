// 2026-09-06 原生弹层全删:utils/toast.js / utils/loading.js 是全仓唯一出口。
// 断言:①有宿主组件时走组件、不碰 wx;②没有宿主时回落到原生(单测沙箱与历史页靠这个);
// ③文案过 safeUserMessage(后端 Java 异常/URL 不直出);④loading 计数式 show/hide 不会被内层 hide 提前关掉。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const TOAST = path.resolve(__dirname, '../../utils/toast.js')
const LOADING = path.resolve(__dirname, '../../utils/loading.js')
const TOAST_COMP = path.resolve(__dirname, '../../components/cy/toast/index.js')
const MASK_COMP = path.resolve(__dirname, '../../components/cy/loading-mask/index.js')

function fresh(mod) { delete require.cache[mod]; return require(mod) }
function withGlobals(globals, fn) {
  const prev = {}
  for (const k of Object.keys(globals)) { prev[k] = global[k]; global[k] = globals[k] }
  try { return fn() } finally { for (const k of Object.keys(globals)) { if (prev[k] === undefined) delete global[k]; else global[k] = prev[k] } }
}
function loadComponent(file) {
  let captured = null
  withGlobals({ Component: (o) => { captured = o }, Behavior: (o) => o, getApp: () => ({ globalData: {} }), wx: {} }, () => fresh(file))
  const vm = Object.assign({}, captured.methods, { data: Object.assign({ reducedMotion: true }, captured.data), setData(p) { Object.assign(this.data, p) } })
  return vm
}

test('toast:有宿主 cy-toast 时走组件 show,不碰 wx.showToast', () => {
  const shown = [], native = []
  const host = { show: (o) => shown.push(o) }
  withGlobals({ wx: { showToast: (o) => native.push(o) }, getCurrentPages: () => [{ selectComponent: (id) => (id === '#cy-toast' ? host : null) }] }, () => {
    const toast = fresh(TOAST)
    toast('已保存'); toast.success('已复制'); toast('x', { icon: 'success' })
  })
  assert.deepEqual(shown.map((o) => [o.title, o.kind]), [['已保存', 'info'], ['已复制', 'success'], ['x', 'success']])
  assert.deepEqual(native, [])
})

test('toast:没有宿主时回落到 wx.showToast(唯一原生出口),icon 只会是 success/none', () => {
  const native = []
  withGlobals({ wx: { showToast: (o) => native.push(o) }, getCurrentPages: () => [{ route: 'pages/x' }] }, () => {
    const toast = fresh(TOAST)
    toast('网络没连上'); toast.success('已复制', { duration: 3000 }); toast('e', { icon: 'error' })
  })
  assert.deepEqual(native.map((o) => [o.title, o.icon, o.duration]), [['网络没连上', 'none', 2000], ['已复制', 'success', 3000], ['e', 'none', 2000]])
})

test('toast:后端异常文本不直出(走 safeUserMessage),空文案不弹', () => {
  const native = []
  withGlobals({ wx: { showToast: (o) => native.push(o) } }, () => {
    const toast = fresh(TOAST)
    toast('java.lang.NullPointerException at com.x.Y'); toast(''); toast(null)
  })
  assert.equal(native.length, 1)
  assert.doesNotMatch(native[0].title, /NullPointer|java\./)
})

test('loading:计数式,内层 hide 不会关掉外层;无宿主回落原生同样计数', () => {
  const host = loadComponent(MASK_COMP)
  host.show({ title: 'A' }); host.show({ title: 'B' }); host.hide()
  assert.equal(host.data.visible, true, '还剩一层没 hide,遮罩不该消失')
  host.hide(); assert.equal(host.data.visible, false)
  const calls = []
  withGlobals({ wx: { showLoading: (o) => calls.push('show:' + o.title), hideLoading: () => calls.push('hide') } }, () => {
    const loading = fresh(LOADING)
    loading.show('提交中'); loading.show('支付中'); loading.hide(); loading.hide(); loading.hide()
  })
  assert.deepEqual(calls, ['show:提交中', 'show:支付中', 'hide'], '两次 show 只在第二次 hide 时真正 hideLoading;多余的 hide 不再重复调原生')
})

test('cy-toast:连续 show 换文案并重置计时;hide 在减动效下直接消失', () => {
  const vm = loadComponent(TOAST_COMP)
  vm.show({ title: '一', kind: 'success', duration: 1000 })
  assert.deepEqual([vm.data.visible, vm.data.title, vm.data.kind, vm.data.glyph], [true, '一', 'success', 'check'])
  vm.show({ title: '二' })
  assert.deepEqual([vm.data.title, vm.data.kind, vm.data.glyph], ['二', 'info', ''])
  vm.hide(); assert.equal(vm.data.visible, false)
  vm._clearTimers()
})
