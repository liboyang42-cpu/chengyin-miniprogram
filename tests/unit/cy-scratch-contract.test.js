'use strict'

/* cy-scratch · 擦开 / 刮开(2026-08-27)
 *
 * 来源:Figma「玩法游戏UI·动效稿」UX 借鉴板三块讲的同一件事 ——
 * 🏆 ADA C「过程即满足」(PowerWash Simulator)/ 🗺 Fog of World / ✋ Google Pay Scratch:
 * **锁定内容不是点开的,是玩家手指「擦亮」的**,爽感从「拿到奖励」前移到动作本身。
 *
 * ⚠️ 这条契约里**最重要的不是擦得爽不爽,是三条无障碍边界**:
 *   ① 开了「减少动态效果」→ 整层不挂、内容直接可见。
 *      「擦」是一个**运动能力要求**;把内容藏在一个人做不到的手势后面 = 把它变成不可达内容。
 *      注意这里不是「擦得快一点」,是**不要求擦**。
 *   ② 内容始终在 DOM 里,只是被盖住 —— 不做「擦完才渲染」,否则读屏在擦开前读不到任何东西。
 *   ③ 没开那个开关、但一时擦不动的人也要有出路:可见按钮直接揭开,且 aria 里说得出来。
 *
 * ⚠️ 性能边界:进度判定不能塞进 touchmove。getImageData 很贵,60fps 调它会掉帧 ——
 * 必须是「采样网格 + 节流」。
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const JS = read('pages/play/components/scratch/index.js')
const WXML = read('pages/play/components/scratch/index.wxml')
const { sampledAlphaProgress, CLEARED_ALPHA } = require('../../pages/play/utils/scratch-progress.js')

/** 载入组件定义,拿到 methods(不把实现复制一份到测试里) */
function load() {
  const abs = path.join(ROOT, 'pages/play/components/scratch/index.js')
  const prevC = global.Component
  const prevB = global.Behavior
  let captured = null
  global.Component = (o) => { captured = o }
  global.Behavior = (config) => config
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally { global.Component = prevC; global.Behavior = prevB }
  assert.ok(captured)
  return captured
}

test('★减少动态效果时整层不挂 —— 不是擦得快一点,是不要求擦', () => {
  const c = load()
  const observer = c.observers['revealed, reducedMotion']
  assert.ok(observer, '必须由 observer 决定挂不挂,不能只在 attached 里判一次')

  const page = { data: { _masked: true }, _done: false, setData(p) { Object.assign(this.data, p) },
    _prepare() { this._prepared = true } }
  observer.call(page, false, true)
  assert.equal(page.data._masked, false, '开了减少动态效果却还盖着刮层 —— 内容对这些用户不可达')
  assert.notEqual(page._prepared, true, '不挂就不该去初始化画布')
})

test('未揭开且没开减动效时才盖刮层', () => {
  const c = load()
  const observer = c.observers['revealed, reducedMotion']
  const page = { data: { _masked: false }, _done: false, setData(p) { Object.assign(this.data, p) },
    _prepare() { this._prepared = true } }
  observer.call(page, false, false)
  assert.equal(page.data._masked, true)
  assert.equal(page._prepared, true)
})

test('已揭开过的内容不再盖第二层 —— 昨天擦过今天重开还要再擦是折磨', () => {
  const c = load()
  const observer = c.observers['revealed, reducedMotion']
  const page = { data: { _masked: true }, _done: false, setData(p) { Object.assign(this.data, p) }, _prepare() {} }
  observer.call(page, true, false)
  assert.equal(page.data._masked, false)
})

test('★内容始终在 DOM 里,只是被盖住 —— 不做「擦完才渲染」', () => {
  assert.match(WXML, /<view class="scr__content"><slot \/><\/view>/,
    'slot 必须无条件渲染;套 wx:if 会让读屏在擦开前读不到任何东西')
  const slotAt = WXML.indexOf('<slot />')
  const maskAt = WXML.indexOf('wx:if="{{_masked}}"')
  assert.ok(slotAt > -1 && maskAt > slotAt, '遮罩要盖在内容之上,不能替代内容')
})

test('★擦不动的人要有出路:可见按钮直接揭开,并且 aria 说得出来', () => {
  assert.match(WXML, /class="scr__direct" bindtap="onDirectReveal"/,
    '兜底出口必须可见、可点击，不能藏在长按手势里')
  assert.match(WXML, /aria-label="直接揭示\{\{label \? '：' \+ label : ''\}\}"/,
    '读屏要听到「直接揭示」及内容标签，不是一块无名的灰色')
  const c = load()
  // 兜底出口走的是和「擦完」同一条路径,所以把 _finish 一并挂上再调 —— 桩掉它就等于没测到那条路
  const page = Object.assign({}, c.methods, {
    data: { reducedMotion: false },
    _done: false,
    setData(p) { Object.assign(this.data, p) },
    triggerEvent(name) { this._ev = name },
  })
  c.methods.onDirectReveal.call(page)
  assert.equal(page._done, true, '「已擦完」记在实例上,不进 data —— wxml 不引用它')
  assert.equal(page._ev, 'reveal', '兜底出口也要抛 reveal,和擦完走同一条路')
})

test('★进度判定不在 touchmove 里做 —— getImageData 每帧调会掉帧', () => {
  const move = /onTouchMove\(e\)\s*\{[\s\S]*?\n    \},/.exec(JS)
  assert.ok(move, '找不到 onTouchMove')
  assert.doesNotMatch(move[0], /getImageData/, 'touchmove 里直接读像素 = 每帧一次昂贵采样')
  assert.match(move[0], /now - this\._lastMeasure >= THROTTLE_MS/, '必须节流')
  assert.match(JS, /const SAMPLE = \d+/, '必须是采样网格,不是逐像素')
})

test('每擦一下轻震要节流 —— 每次 move 都震会变成持续嗡鸣', () => {
  const move = /onTouchMove\(e\)\s*\{[\s\S]*?\n    \},/.exec(JS)[0]
  assert.match(move, /this\._moves % HAPTIC_EVERY === 0/)
  assert.match(move, /motion\.haptic\(\{ reducedMotion: this\.data\.reducedMotion \}\)/,
    '触感必须走 motion.haptic 并传 reducedMotion(同 playkit 那条门禁)')
})

test('擦除比例:低于统一的 alpha 容差才算已擦掉', () => {
  const ratio = sampledAlphaProgress
  assert.equal(ratio([255, 255, 255, 255]), 0)
  assert.equal(ratio([0, 0, 0, 0]), 1)
  assert.equal(ratio([0, 0, 255, 255]), 0.5)
  assert.equal(ratio([]), 0, '一个采样点都没有时算 0 —— 不能算成 1 然后自动揭开')
  assert.equal(ratio(null), 0)
  assert.equal(ratio([CLEARED_ALPHA - 1, CLEARED_ALPHA]), 0.5,
    '恰好达到统一容差时仍算没擦掉，生产与纯函数不能各用一套阈值')
})

test('揭开只发生一次 —— 重复 _finish 不该抛第二次 reveal', () => {
  const c = load()
  let count = 0
  const page = { data: { reducedMotion: false }, _done: false, setData(p) { Object.assign(this.data, p) },
    triggerEvent() { count += 1 } }
  c.methods._finish.call(page)
  c.methods._finish.call(page)
  assert.equal(count, 1, '节流采样会在同一帧多次命中阈值,不去重就会重复上报')
})

test('★调用方:今日城市签把签文盖在刮层下,并透传显隐状态', () => {
  const wxml = read('pages/play/components/playkit-dailysign/index.wxml')
  assert.match(wxml, /<cy-scratch[^>]*revealed="\{\{revealed\}\}"/)
  assert.match(wxml, /<cy-scratch[\s\S]*?ds__poem[\s\S]*?<\/cy-scratch>/,
    '签文必须在 cy-scratch 里面 —— 在外面就是没盖住')
  assert.match(read('pages/play/components/playkit-dailysign/index.json'), /"cy-scratch"/, '组件没注册会静默不渲染')
  assert.match(read('pages/play/components/playkit/index.wxml'), /revealed="\{\{kit\.revealed\}\}"/,
    '分发器必须透传视图层算出的显隐状态，首次领取与重新进入不能混成同一状态')
})

test('★负控:把 slot 套上 wx:if(擦完才渲染),契约必须判红', () => {
  const broken = WXML.replace('<view class="scr__content"><slot /></view>',
    '<view class="scr__content" wx:if="{{_masked === false}}"><slot /></view>')
  assert.notEqual(broken, WXML, '负控必须真的改动了输入')
  assert.doesNotMatch(broken, /<view class="scr__content"><slot \/><\/view>/,
    '坏版本里 slot 被条件挡住了 —— 上面那条断言会因此判红')
})
