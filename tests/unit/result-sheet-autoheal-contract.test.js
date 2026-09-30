/* cy-result-sheet 自愈契约(2026-09-05)
 *
 * 面板的全部逻辑就是「什么时候自己收」。这条锁住三件会静默出错的事:
 *   ① loading **不**自愈 —— 请求还在途时自己收掉,用户就失去了唯一的进度反馈;
 *   ② 终态按 duration 自愈,duration=0 表示交给调用方自己收;
 *   ③ 换态 / 关闭 / 卸载都要清掉上一枚定时器,否则旧计时会在新态上开一枪
 *      (把刚打开的 loading 面板收掉,看起来就是「面板闪一下没了」)。
 *
 * ⚠️ 这里跑的是组件真身(require 组件文件、接管 Component),不是抄一份逻辑来测。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const COMPONENT = path.resolve(__dirname, '../../components/cy/result-sheet/index.js')
const BEHAVIOR = path.resolve(__dirname, '../../behaviors/reduced-motion.js')

function loadComponent() {
  let definition = null
  global.Behavior = (config) => config
  global.Component = (config) => { definition = config }
  delete require.cache[require.resolve(COMPONENT)]
  delete require.cache[require.resolve(BEHAVIOR)]
  require(COMPONENT)
  delete global.Behavior
  delete global.Component
  return definition
}

/** 极小的组件宿主:只提供 data、observers 触发与 triggerEvent 记录 */
function mount(overrides = {}) {
  const definition = loadComponent()
  const defaults = {}
  for (const [key, spec] of Object.entries(definition.properties)) defaults[key] = spec.value
  const instance = {
    data: Object.assign(defaults, overrides),
    events: [],
    triggerEvent(name, detail) { this.events.push({ name, detail }) },
  }
  Object.assign(instance, definition.methods)
  instance._detached = definition.lifetimes.detached
  // 唯一的 observer 就是 'show, kind, duration'
  instance._sync = definition.observers['show, kind, duration, primaryText'].bind(instance)
  return instance
}

/** 让 setTimeout 可控:返回 {advance, pending} */
function fakeTimers(t) {
  let queue = []
  let seq = 0
  t.mock.method(global, 'setTimeout', (fn, ms) => { queue.push({ id: ++seq, fn, ms }); return seq })
  t.mock.method(global, 'clearTimeout', (id) => { queue = queue.filter((item) => item.id !== id) })
  return {
    pending: () => queue.slice(),
    fireAll: () => { const due = queue; queue = []; due.forEach((item) => item.fn()) },
  }
}

test('① loading 不自愈 —— 在途状态没有终点,自己收掉就抹掉了唯一的进度反馈', (t) => {
  const timers = fakeTimers(t)
  const c = mount({ show: true, kind: 'loading', duration: 2000 })
  c._sync()
  assert.deepEqual(timers.pending(), [], 'loading 态不该排任何自愈定时器')
  timers.fireAll()
  assert.deepEqual(c.events, [], 'loading 态不该自己发 close')
})

test('② 终态按 duration 自愈,收的时候发 close 让调用方清状态', (t) => {
  const timers = fakeTimers(t)
  for (const kind of ['success', 'fail']) {
    const c = mount({ show: true, kind, duration: 2000 })
    c._sync()
    const scheduled = timers.pending()
    assert.equal(scheduled.length, 1, `${kind} 必须排一枚自愈定时器`)
    assert.equal(scheduled[0].ms, 2000, '停留时长必须取 duration,不是写死的常数')
    timers.fireAll()
    assert.deepEqual(c.events, [{ name: 'close', detail: { reason: 'timeout' } }])
  }
})

test('③ duration=0 表示交给调用方自己收,不排定时器', (t) => {
  const timers = fakeTimers(t)
  const c = mount({ show: true, kind: 'success', duration: 0 })
  c._sync()
  assert.deepEqual(timers.pending(), [], 'duration=0 不该排定时器')
})

test('④ show=false 时不排定时器', (t) => {
  const timers = fakeTimers(t)
  const c = mount({ show: false, kind: 'success', duration: 2000 })
  c._sync()
  assert.deepEqual(timers.pending(), [])
})

test('⑤ 换态必须清掉上一枚定时器 —— 否则旧计时会把新开的 loading 面板收掉', (t) => {
  const timers = fakeTimers(t)
  const c = mount({ show: true, kind: 'fail', duration: 2000 })
  c._sync()
  assert.equal(timers.pending().length, 1)
  c.data.kind = 'loading'
  c._sync()
  assert.deepEqual(timers.pending(), [], '切到 loading 后旧定时器必须已被清掉')
  timers.fireAll()
  assert.deepEqual(c.events, [], '旧计时不该在新态上开枪')
})

test('⑥ 遮罩关闭与卸载都要清定时器,不留悬空回调', (t) => {
  const timers = fakeTimers(t)
  const closed = mount({ show: true, kind: 'success', duration: 2000 })
  closed._sync()
  closed.onSheetClose({ detail: { reason: 'mask' } })
  assert.deepEqual(timers.pending(), [], '遮罩关闭后不该还留着自愈定时器')
  assert.deepEqual(closed.events, [{ name: 'close', detail: { reason: 'mask' } }])

  const detached = mount({ show: true, kind: 'success', duration: 2000 })
  detached._sync()
  assert.equal(timers.pending().length, 1)
  detached._detached.call(detached)
  assert.deepEqual(timers.pending(), [], '卸载后不该还留着自愈定时器')
})

test('⑦ 面板上有按钮就不自愈 —— 它正等人做选择,倒计时收走就是抢答', (t) => {
  const timers = fakeTimers(t)
  const c = mount({ show: true, kind: 'success', duration: 2000, primaryText: '叫上队友' })
  c._sync()
  assert.deepEqual(timers.pending(), [], '有 primaryText 时不该排自愈定时器')
  timers.fireAll()
  assert.deepEqual(c.events, [], '有按钮时不该自己发 close')
})

test('⑧ 点按钮要先清掉自愈定时器,再把选择上报给调用方', (t) => {
  const timers = fakeTimers(t)
  const c = mount({ show: true, kind: 'success', duration: 2000 })
  c._sync()
  assert.equal(timers.pending().length, 1, '没按钮时本来有自愈定时器')
  c.onPrimary()
  assert.deepEqual(timers.pending(), [], '点了按钮就不该再有定时器对着已处理的面板开枪')
  assert.deepEqual(c.events, [{ name: 'primary', detail: undefined }])
  c.onSecondary()
  assert.deepEqual(c.events[1], { name: 'secondary', detail: undefined })
})

test('负控:把「有按钮不自愈」那条拿掉,⑦必须判红', (t) => {
  const timers = fakeTimers(t)
  const c = mount({ show: true, kind: 'success', duration: 2000, primaryText: '叫上队友' })
  c._schedule = function () {
    this._clear()
    if (!this.data.show) return
    if (this.data.kind === 'loading') return
    if (!(this.data.duration > 0)) return
    this._timer = setTimeout(() => this.triggerEvent('close', { reason: 'timeout' }), this.data.duration)
  }
  c._schedule()
  assert.equal(timers.pending().length, 1, '负控变异注入失败')
  assert.throws(() => assert.deepEqual(timers.pending(), []), /Expected values/)
})

test('负控:把 loading 的跳过分支拿掉,①必须判红', (t) => {
  const timers = fakeTimers(t)
  const c = mount({ show: true, kind: 'loading', duration: 2000 })
  // 变异:模拟「忘了跳过 loading」的实现
  c._schedule = function () {
    this._clear()
    if (!this.data.show) return
    if (!(this.data.duration > 0)) return
    this._timer = setTimeout(() => this.triggerEvent('close', { reason: 'timeout' }), this.data.duration)
  }
  c._schedule()
  assert.equal(timers.pending().length, 1, '负控变异注入失败')
  assert.throws(() => assert.deepEqual(timers.pending(), []), /Expected values/)
})

/* ── loading 弧的颜色必须在每一档都真的是紫 ───────────────────────────────
 * 2026-09-05 实测教训:第一版写的是 var(--cy-color-brand),名字看着像「强调色」,
 * 但它在玩家域解析成 text-primary(白)、商家域解析成中性灰 —— 稿子要的紫在**任何一档**
 * 都不会出现,等于把这个设计决定悄悄删掉了,而且门禁全绿、也查不到字面色。
 * 所以这条钉的不是「读了哪个 token 名」,是「代进每个作用域后算出来仍是那个紫」。 */
const TOKENS = fs.readFileSync(path.resolve(__dirname, '../../style/tokens.wxss'), 'utf8')
const DARK = fs.readFileSync(path.resolve(__dirname, '../../style/dark-mode.wxss'), 'utf8')
const MERCHANT = fs.readFileSync(path.resolve(__dirname, '../../style/merchant-light.wxss'), 'utf8')
const SHEET_WXSS = fs.readFileSync(path.resolve(__dirname, '../../components/cy/result-sheet/index.wxss'), 'utf8')

/** 某个 token 在这些文件里被声明了几次(注释已剥) */
function declarationsOf(name, sources) {
  const out = []
  for (const src of sources) {
    const clean = src.replace(/\/\*[\s\S]*?\*\//g, '')
    const re = new RegExp('^\\s*' + name + '\\s*:\\s*([^;]+);', 'gm')
    let m
    while ((m = re.exec(clean))) out.push(m[1].trim())
  }
  return out
}

test('⑨ loading 弧读自己的 comp 钩子,不是「本主题强调色」', () => {
  assert.match(SHEET_WXSS, /border-top-color:\s*var\(--cy-comp-result-spinner\)/)
  assert.doesNotMatch(SHEET_WXSS, /border-top-color:\s*var\(--cy-color-brand\)/,
    '--cy-color-brand 玩家域=白、商家域=灰,拿它当品牌紫等于这个颜色从没出现过')
})

test('⑩ 该钩子只声明一次且指向品牌紫 —— 任何一档都不许覆盖成别的颜色', () => {
  assert.deepEqual(declarationsOf('--cy-comp-result-spinner', [TOKENS, DARK, MERCHANT]),
    ['var(--cy-ref-violet-500)'],
    '只该在 page{} 声明一次(稿子两档同一个紫);多一处声明 = 某一档会变色')
  assert.deepEqual(declarationsOf('--cy-ref-violet-500', [TOKENS, DARK, MERCHANT]), ['#7A5CFF'],
    '品牌紫本身也只能有一个真源')
})

test('负控:改回 --cy-color-brand 或在深色档覆盖它,都必须判红', () => {
  const mutated = SHEET_WXSS.replace('var(--cy-comp-result-spinner)', 'var(--cy-color-brand)')
  assert.notEqual(mutated, SHEET_WXSS, '负控变异注入失败')
  assert.throws(() => assert.match(mutated, /border-top-color:\s*var\(--cy-comp-result-spinner\)/))

  const overridden = DARK.replace(/@media \(prefers-color-scheme: dark\) \{/,
    '@media (prefers-color-scheme: dark) {\n    --cy-comp-result-spinner: #FFFFFF;')
  const decls = declarationsOf('--cy-comp-result-spinner', [TOKENS, overridden, MERCHANT])
  assert.equal(decls.length, 2, '负控变异注入失败')
  assert.throws(() => assert.deepEqual(decls, ['var(--cy-ref-violet-500)']))
})


/* 2026-09-06 用户裁决:「支付过程中的弹窗高度和支付成功/失败的高度需要是一样的」。
   loading → success/fail 是同一张面板换内容,面板跟着内容改高就跳一下。
   地板一旦被谁顺手删掉,跳变会静默回来(截图定格帧看不出来,只有连着播才看得见)。 */
test('★ .rs 必须有高度地板,否则 loading → fail 会跳一下', () => {
  const wxss = fs.readFileSync(
    path.resolve(__dirname, '../../components/cy/result-sheet/index.wxss'), 'utf8')
  const block = wxss.match(/\n\.rs \{([\s\S]*?)\n\}/)
  assert.ok(block, '切不到 .rs 规则块')
  const floor = block[1].match(/min-height:\s*(\d+)rpx/)
  assert.ok(floor, '.rs 必须有 min-height —— 没有地板三态高度就不一样')
  assert.ok(Number(floor[1]) >= 444,
    '地板不能低于失败态实测高度 444rpx(含原因卡),低了就挡不住那一跳')
  assert.doesNotMatch(block[1], /(^|[^-])\bheight:\s*\d/,
    '只能是 min-height:写死 height 会把长内容(两行原因 / meta / pill)截掉')
})
