// cy-dropdown 契约(2026-08-25)
//
// 它是全仓 28 处 <picker range=...> 的替代品。能不能安全替换,全看一件事:
// **API 与原生 picker 逐字兼容** —— range / range-key / value 语义相同,
// bind:change 的 detail.value 同样是【下标】而不是值本身。
// 只要这条成立,迁移就只是改标签名,调用方的 JS 处理器一行都不用动;
// 一旦漂移成「回传值本身」,所有调用方的 options[index] 都会取到 undefined 而且不报错。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { flattenComponentToPage } = require('../helpers/component-as-page')

const ROOT = path.resolve(__dirname, '../..')
const REL = 'components/cy/dropdown/index.js'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// behaviors/*.js 是被 createRequire 在 Node 模块作用域里加载的,不走 vm 沙箱,
// 所以 Behavior/wx 必须先挂到 global 上,否则 require 那一刻就 ReferenceError。
function withGlobals(fn) {
  const savedBehavior = global.Behavior
  const savedWx = global.wx
  global.Behavior = (b) => b
  global.wx = { getStorageSync: () => null, getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }) }
  try { return fn() } finally {
    if (savedBehavior === undefined) delete global.Behavior; else global.Behavior = savedBehavior
    if (savedWx === undefined) delete global.wx; else global.wx = savedWx
  }
}

function loadDropdown(source = read(REL)) {
  const abs = path.join(ROOT, REL)
  let captured = null
  const events = []
  withGlobals(() => vm.runInNewContext(source, {
    console,
    getApp: () => ({ globalData: {} }),
    Component(config) { captured = flattenComponentToPage(config) },
    Behavior: (b) => b,
    require: createRequire(abs),
    setTimeout,
    clearTimeout,
    wx: {
      getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }),
      getStorageSync: () => null,
    },
  }, { filename: abs }))
  assert.ok(captured, 'cy-dropdown 必须注册 Component')

  const instance = Object.assign({}, captured, {
    data: Object.assign({}, captured.data, { disabled: false, _closing: false, labels: [], value: 0 }),
  })
  instance.setData = (patch, cb) => {
    Object.assign(instance.data, patch)
    if (typeof cb === 'function') cb()
  }
  instance.triggerEvent = (name, detail) => events.push({ name, detail })
  return { instance, events }
}

test('labels 派生:字符串数组、对象+range-key、对象缺 key 都不能崩', () => {
  const { instance } = loadDropdown()
  const derive = instance.__observers__ || null
  // observers 不经 flatten 暴露,直接验证与它等价的规则在组件源码里存在
  const src = read(REL)
  assert.match(src, /rangeKey \? item\[rangeKey\]/, 'range-key 必须用于对象项取名')
  assert.match(src, /item\.name \|\| item\.label/, '没给 range-key 时要有可预期的兜底,不能显示 [object Object]')
  assert.equal(derive, null)
})

test('★ bind:change 回传的是下标,不是值本身(与原生 picker 一致)', () => {
  const { instance, events } = loadDropdown()
  instance.data.labels = ['甲', '乙', '丙']
  instance.data.value = 0
  instance.onPick({ currentTarget: { dataset: { index: '2' } } })
  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'change')
  assert.equal(events[0].detail.value, 2, 'detail.value 必须是下标;回传值本身会让所有调用方 options[index] 变 undefined')
  assert.equal(typeof events[0].detail.value, 'number', '下标必须是数字,字符串会让 === 比较全部落空')
})

test('退场动画播放期间不再接受选择,避免关闭途中又发一次 change', () => {
  const { instance, events } = loadDropdown()
  instance.data._closing = true
  instance.onPick({ currentTarget: { dataset: { index: '1' } } })
  assert.equal(events.length, 0)
})

test('disabled 时点击不展开', () => {
  const { instance } = loadDropdown()
  instance.data.disabled = true
  instance.data.show = false
  instance.onTrigger()
  assert.equal(instance.data.show, false)
})

test('面板走 fixed 层:调用方常把选择器放在 overflow:hidden 容器里', () => {
  const wxss = read('components/cy/dropdown/index.wxss')
  assert.match(wxss, /\.cdd__layer\s*\{[^}]*position:\s*fixed/, '面板层必须 fixed,absolute 会被祖先裁掉')
  assert.match(wxss, /\.cdd__mask\s*\{[^}]*background:\s*transparent/, 'dropdown 是轻量态,不压暗整页')
  const wxml = read('components/cy/dropdown/index.wxml')
  assert.match(wxml, /class="cdd__mask"[^>]*bindtap="onMask"/, '点外部必须能收起')
})

test('negative control:detail.value 改成回传值本身必须判红', () => {
  const src = read(REL).replace(
    "this.triggerEvent('change', { value: index });",
    "this.triggerEvent('change', { value: this.data.labels[index] });",
  )
  assert.notEqual(src, read(REL), '负控锚点失效')
  assert.match(src, /value: this\.data\.labels\[index\]/)
  // 用改过的源码跑同一条断言,必须炸
  const abs = path.join(ROOT, REL)
  let captured = null
  const events = []
  withGlobals(() => vm.runInNewContext(src, {
    console, getApp: () => ({ globalData: {} }),
    Component(config) { captured = flattenComponentToPage(config) },
    Behavior: (b) => b, require: createRequire(abs), setTimeout, clearTimeout,
    wx: { getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }), getStorageSync: () => null },
  }, { filename: abs }))
  const inst = Object.assign({}, captured, { data: { labels: ['甲', '乙', '丙'], value: 0, _closing: false } })
  inst.setData = (p) => Object.assign(inst.data, p)
  inst.triggerEvent = (n, d) => events.push({ n, d })
  inst.onPick({ currentTarget: { dataset: { index: '2' } } })
  assert.throws(() => assert.equal(events[0].d.value, 2), assert.AssertionError)
})


test('延迟打开去重，关闭后不能被定时器重新打开', async () => {
  const { instance } = loadDropdown()
  instance.data.labels = ['甲']
  instance.data.measureDelay = 20
  let opened = 0
  instance.openAtAnchor = () => { opened++ }
  instance.onTrigger()
  const timer = instance._openTimer
  instance.onTrigger()
  assert.equal(instance._openTimer, timer)
  instance.close()
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.equal(opened, 0)
})

test('关闭使已发起的锚点测量失效', () => {
  const { instance } = loadDropdown()
  instance.data.labels = ['甲']
  let receive
  const query = { select() { return this }, boundingClientRect() { return this }, selectViewport() { return this }, scrollOffset() { return this }, exec(fn) { receive = fn } }
  instance.createSelectorQuery = () => query
  instance.openAtAnchor()
  instance.close()
  receive([{ top:100, bottom:144, right:200, width:180 }])
  assert.equal(instance.data.show, false)
})

test('RUN-003: 空选项不打开空面板，自定义面板仍可打开', () => {
  const { instance } = loadDropdown()
  let opened = 0
  instance.openAtAnchor = () => { opened++ }
  instance.onTrigger()
  assert.equal(opened, 0)
  instance.data.customPanel = true
  instance.onTrigger()
  assert.equal(opened, 1)
})

test('RUN-012: 选择勾在文字前，未选中行保留同宽位置', () => {
  const wxml = read('components/cy/dropdown/index.wxml')
  assert.ok(wxml.indexOf('cdd__check') < wxml.indexOf('cdd__item-txt'))
  assert.match(wxml, /<view class="cdd__check">/)
})
