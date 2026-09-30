// cy-sheet · handle 拖拽契约(2026-09-01)
//
// 背景:手册 Motion·Overlay choreography 的 Sheet P1 一栏一直写着「handle 可拖」,
// 而组件里 touch 零命中 —— 一根长得像「拖我」的横条,拖了没反应。属于「声称存在、
// 实际不生效」这一类,不是缺功能。补齐后由本契约钉住。
//
// 钉的不是"有没有写 touch 绑定",而是**真调 onDragStart/Move/End 之后关没关**:
//   · 阈值是「位移 > 面板高 1/3」**或**「速度 > .55 px/ms」,二选一。
//     只看位移 ⇒ 快速小甩关不掉;只看速度 ⇒ 慢慢拖到底关不掉。两个用例各钉一条闸。
//   · dirty 时走和点遮罩同一条闸:只发 requestclose,不发 close。
//   · 没过阈值必须弹回(_dragStyle 清空 + 不发关闭事件)。
//
// 负控用改源码重载的方式做:把某一条闸的常数改掉,对应用例必须判红。
// 断言"它能红"比断言"它是绿的"值钱 —— 恒真断言在本仓踩过不止一次。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Module = require('node:module')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SHEET_JS = path.join(ROOT, 'components/cy/sheet/index.js')
const SHEET_WXML = path.join(ROOT, 'components/cy/sheet/index.wxml')

// 把 cy-sheet 的 Component 定义取出来。可传 mutate 改源码做负控。
function loadSheet(mutate) {
  let src = fs.readFileSync(SHEET_JS, 'utf8')
  if (mutate) {
    const next = mutate(src)
    assert.notEqual(next, src, '负控没有真的改到源码 —— 注入点写错了,这条负控是恒真的')
    src = next
  }
  let captured = null
  const fn = vm.compileFunction(src, ['require', 'module', 'exports', 'Component', 'getApp', 'wx'], {
    filename: SHEET_JS,
  })
  const localRequire = Module.createRequire(SHEET_JS)
  const mod = { exports: {} }
  // 三个 behaviors 是用小程序全局 Behavior() 定义的,Node 里没有这个全局。
  // 只在加载期间补上,加载完立刻还原,免得污染同批跑的其它测试文件。
  const prevBehavior = global.Behavior
  const prevWx = global.wx
  global.Behavior = (o) => o
  global.wx = global.wx || { getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }) }
  try {
    fn(localRequire, mod, mod.exports, (o) => { captured = o }, () => ({ globalData: {} }), {
      getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    })
  } finally {
    global.Behavior = prevBehavior
    global.wx = prevWx
  }
  assert.ok(captured && captured.methods, 'cy-sheet 必须是一个 Component 定义')
  return captured
}

// 最小假实例:只提供组件真正用到的那几个宿主能力。
function makeInstance(def, { dirty = false, panelHeight = 600 } = {}) {
  const events = []
  /* ⚠️ properties 的默认值也要铺进 data —— 小程序运行时就是这么合并的。
     漏了这一步,组件里读 this.data.maskClosable 会拿到 undefined,任何
     `!this.data.xxx` 形式的闸都会变成恒真,把本来该过的用例全判红
     (2026-09-01 自审加 maskClosable 闸时实测踩到)。 */
  const propDefaults = {}
  for (const [k, v] of Object.entries(def.properties || {})) propDefaults[k] = v && v.value
  const inst = {
    data: Object.assign({}, propDefaults, def.data, { _closing: false, dirty, handle: true, variant: 'bottom' }),
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent(name, detail) { events.push({ name, detail }) },
    createSelectorQuery() {
      return {
        select() { return this },
        // 同步回调:真实环境是异步的,但本契约要断的是"量到高度之后怎么判",
        // 量不到高度的降级路径由 h=0 那个用例单独覆盖。
        boundingClientRect(cb) { this._cb = cb; return this },
        exec() { if (this._cb) this._cb({ height: panelHeight }) },
      }
    },
    events,
  }
  for (const [k, v] of Object.entries(def.methods)) inst[k] = v.bind(inst)
  return inst
}

// 按给定的 (位移, 每步耗时) 序列驱动一次完整手势。
function drag(inst, { steps, stepMs }) {
  const realNow = Date.now
  let t = 1_000_000
  global.Date.now = () => t
  try {
    inst.onDragStart({ touches: [{ clientY: 0 }] })
    let y = 0
    for (const dy of steps) {
      y += dy
      t += stepMs
      inst.onDragMove({ touches: [{ clientY: y }] })
    }
    inst.onDragEnd()
  } finally {
    global.Date.now = realNow
  }
  return inst.events
}

const closed = (events) => events.some((e) => e.name === 'close')
const requested = (events) => events.some((e) => e.name === 'requestclose')

test('慢慢拖过面板高度的 1/3 ⇒ 关闭(位移闸)', () => {
  const inst = makeInstance(loadSheet(), { panelHeight: 600 })
  // 每步 20px / 100ms ⇒ 速度 0.2 px/ms,远低于 .55,只可能靠位移闸关
  const events = drag(inst, { steps: Array(15).fill(20), stepMs: 100 })
  assert.ok(closed(events), '慢拖 300px(> 600 的 1/3)必须关闭')
})

test('慢慢拖但没到 1/3 ⇒ 不关,弹回', () => {
  const inst = makeInstance(loadSheet(), { panelHeight: 600 })
  const events = drag(inst, { steps: Array(5).fill(20), stepMs: 100 })   // 100px < 200px
  assert.equal(closed(events), false, '没过阈值不能关')
  assert.equal(requested(events), false, '没过阈值也不该发 requestclose')
  assert.equal(inst.data._dragStyle, '', '弹回时必须把行内 transform 清掉,否则面板停在半路')
  assert.equal(inst.data._snapping, true, '没过阈值必须进吸附态')
})

test('位移很小但甩得快 ⇒ 关闭(速度闸)', () => {
  const inst = makeInstance(loadSheet(), { panelHeight: 600 })
  // 总位移 60px(远小于 200px),但末段 30px/16ms ≈ 1.9 px/ms
  const events = drag(inst, { steps: [30, 30], stepMs: 16 })
  assert.ok(closed(events), '快甩必须关闭 —— 这条挂的是速度闸,不是位移闸')
})

test('dirty 时过阈值只发 requestclose,不发 close', () => {
  const inst = makeInstance(loadSheet(), { dirty: true, panelHeight: 600 })
  const events = drag(inst, { steps: Array(15).fill(20), stepMs: 100 })
  assert.ok(requested(events), '脏输入时必须上报 requestclose,交给父页面决定')
  assert.equal(closed(events), false, '脏输入时不能直接 close —— 和点遮罩同一条闸')
})

test('往上拖有阻尼且不会触发关闭', () => {
  const inst = makeInstance(loadSheet(), { panelHeight: 600 })
  const events = drag(inst, { steps: Array(10).fill(-20), stepMs: 100 })
  assert.equal(closed(events), false, '向上拖不该关闭')
  // 最后一帧 _dragStyle 已被 onDragEnd 清空,所以阻尼要在 move 阶段断:重跑到 move 为止
  const inst2 = makeInstance(loadSheet(), { panelHeight: 600 })
  const realNow = Date.now
  let t = 1_000_000
  global.Date.now = () => t
  try {
    inst2.onDragStart({ touches: [{ clientY: 0 }] })
    t += 100
    inst2.onDragMove({ touches: [{ clientY: -30 }] })
  } finally { global.Date.now = realNow }
  const up = /--sh-drag-y:\s*(-?[\d.]+)px/.exec(inst2.data._dragStyle)
  assert.ok(up, '向上拖也要输出 --sh-drag-y')
  assert.ok(Number(up[1]) > -30, `向上必须有阻尼,不能 1:1(实际 ${up[1]}px)`)
})

test('量不到面板高度时降级成只看速度,慢拖不会误关', () => {
  const def = loadSheet()
  const inst = makeInstance(def, { panelHeight: 0 })
  const events = drag(inst, { steps: Array(30).fill(20), stepMs: 100 })
  assert.equal(closed(events), false, 'h=0 时位移闸必须失效,不能拿 0 当阈值把面板一拖就关')
})

test('wxml:抓手挂了完整的四个触摸事件,且用 catch 不冒泡', () => {
  const wxml = fs.readFileSync(SHEET_WXML, 'utf8')
  const grip = /<view class="sh__grip"[\s\S]*?>/.exec(wxml)
  assert.ok(grip, '抓手必须是 .sh__grip(热区容器),不是直接把触摸挂在 8rpx 高的横条上')
  for (const ev of ['catchtouchstart', 'catchtouchmove', 'catchtouchend', 'catchtouchcancel']) {
    assert.match(grip[0], new RegExp(ev), `抓手缺 ${ev} —— 少 cancel 会让来电/手势打断后卡在拖拽态`)
  }
  // 位移必须挂在根节点的 CSS 变量上,不能写进 .sh__panel 的行内 style ——
  // 那个 style 表达式被 sheet-morph-contract 逐字锁着,叠上去会顶掉 morph 进出场。
  // ⚠️ 2026-09-25 CU-M-163:根节点的 style 后来还要承载 full 变体的面板顶(fullMaxH),
  //   所以判据从「整段等于 {{_dragStyle}}」收成「以 {{_dragStyle}} 开头」——
  //   位移仍在根、仍第一顺位,被挪到 .sh__panel 上照样红(下面那条 panel 逐字锁负责)。
  assert.match(wxml, /class="sh sh--\{\{variant\}\}[^"]*"[^>]*style="\{\{_dragStyle\}\}/,
    '根节点必须承载 _dragStyle(--sh-drag-y),拖拽才跟手')
  assert.match(wxml, /class="sh__panel[^"]*"[^>]*style="\{\{\(_morphOpen && !_closing\) \? '' : _morphStyle\}\}"/,
    '.sh__panel 的行内 style 必须保持 morph 契约的原样,不许被拖拽叠一层')
})

/* ——— 负控:两条闸各拆一次,对应用例必须判红 ——— */

test('负控:拆掉速度闸后,快甩用例必须判红', () => {
  const def = loadSheet((src) => src.replace('const DRAG_VELOCITY = 0.55;', 'const DRAG_VELOCITY = 1e9;'))
  const inst = makeInstance(def, { panelHeight: 600 })
  const events = drag(inst, { steps: [30, 30], stepMs: 16 })
  assert.equal(closed(events), false, '速度闸被拆掉后快甩还能关 ⇒ 说明它根本不是靠速度闸关的,断言是假的')
})

test('负控:拆掉位移闸后,慢拖用例必须判红', () => {
  const def = loadSheet((src) => src.replace('const DRAG_RATIO = 1 / 3;', 'const DRAG_RATIO = 1e9;'))
  const inst = makeInstance(def, { panelHeight: 600 })
  const events = drag(inst, { steps: Array(15).fill(20), stepMs: 100 })
  assert.equal(closed(events), false, '位移闸被拆掉后慢拖还能关 ⇒ 慢拖那条断言是假的')
})

// 2026-09-01 自审补:maskClosable=false 是调用方「不许随手关」的显式表态
// (club/detail 的编辑动态就是这么写的)。点遮罩查了这条闸,拖拽当时没查 ——
// 等于我给守卫开了个后门。现在两条路径同闸,并用负控钉住。
test('maskClosable=false 时,过阈值的拖拽也不许关闭(与点遮罩同闸)', () => {
  const inst = makeInstance(loadSheet(), { panelHeight: 600 })
  inst.data.maskClosable = false
  const events = drag(inst, { steps: Array(15).fill(20), stepMs: 100 })
  assert.equal(closed(events), false, 'maskClosable=false 却被拖关了 —— 守卫被绕过')
  assert.equal(inst.data._snapping, true, '不许关的面板必须弹回,不能停在半路')
})

test('负控:拖拽不查 maskClosable 时必须判红', () => {
  // 注入点随 2026-09-01 重构改过:闸从内联 if 抽成了 blocked 变量,这里去掉 maskClosable 那一半
  const def = loadSheet((src) => src.replace(
    'const blocked = !this.data.maskClosable || this.data.dirty;',
    'const blocked = this.data.dirty;'))
  const inst = makeInstance(def, { panelHeight: 600 })
  inst.data.maskClosable = false
  const events = drag(inst, { steps: Array(15).fill(20), stepMs: 100 })
  assert.equal(closed(events), true, '把闸拆掉后居然还是关不掉 ⇒ 上一条断言不是靠这条闸成立的')
})

/* 2026-09-01 自审补:原来「dirty 时只发 requestclose」那条只断言了事件,没断言面板去哪。
   实测 dirty + 过阈值走的是关闭分支,_snapping 被置 false ⇒ .sh--snap 的 transform
   规则不再命中,面板直接跳回 0(瞬移)而不是弹回。断言只查事件就会放过这类缺陷。 */
test('dirty 时过阈值:关不掉,但面板必须弹回而不是瞬移', () => {
  const inst = makeInstance(loadSheet(), { dirty: true, panelHeight: 600 })
  const events = drag(inst, { steps: Array(15).fill(20), stepMs: 100 })
  assert.ok(requested(events), '仍要上报 requestclose,让父页面决定')
  assert.equal(closed(events), false, '脏输入不能直接关')
  assert.equal(inst.data._snapping, true, '关不掉的面板必须进吸附态,否则是瞬移回位')
  assert.equal(inst.data._dragStyle, '', '行内位移要清掉,否则停在半路')
})

test('负控:把 dirty 从「不许关」里拿掉时,上面那条必须判红', () => {
  const def = loadSheet((src) =>
    src.replace('const blocked = !this.data.maskClosable || this.data.dirty;',
                'const blocked = !this.data.maskClosable;'))
  const inst = makeInstance(def, { dirty: true, panelHeight: 600 })
  drag(inst, { steps: Array(15).fill(20), stepMs: 100 })
  assert.equal(inst.data._snapping, false,
    'dirty 不再走吸附分支后 _snapping 仍为 true ⇒ 上面那条断言不是靠这条闸成立的')
})
