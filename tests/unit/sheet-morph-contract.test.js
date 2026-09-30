'use strict'

/* 弹窗 morph 进出场契约(2026-08-26)
 *
 * morph = 传了 anchor-selector 时,面板从触发它的那个元素的位置长出来、关闭时缩回去。
 * 实现收在 behaviors/morph-entrance.js,cy-sheet 与 cy-publish-sheet 共用。
 *
 * ⚠️ 这个门禁前后被发现假过三次,每次的教训都固化成了下面的断言,别往回退:
 *   ① 判据方向错:只检查「含 morph 字样的规则」的逗号分支,而真实回归形态是
 *      `.sh__panel { ... }` —— 不含 morph 字样,检测器根本看不见。
 *   ② 负控没鉴别力:用例取 32/640=0.05,正好等于当时的缩放下限,把下限调回 0.05
 *      照样绿。负控必须**明显**偏离阈值。
 *   ③ 指纹随代码演进而失效:指纹写的是 scale(.92,.12) / transform-origin: bottom center,
 *      返工后现码里这两个字符串都不存在了,门禁对新的泄漏形态完全瞎。
 *      ⇒ 所以现在**逻辑部分直接 require behavior 真跑**(格式怎么改都不影响),
 *        静态部分只盯「全局选择器不许带起点态特征」这种与实现细节无关的不变量。
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// ── 把 behavior 真正加载进来(不是正则抠源码)────────────────────────────
global.Behavior = (definition) => definition
const morphEntrance = require(path.join(ROOT, 'behaviors/morph-entrance.js'))

/** 造一个最小宿主,把 behavior 的 observers/methods 绑上去,记录所有 setData */
function host(opts = { shellSelector: '.shell' }, initial = {}) {
  const def = morphEntrance(opts)
  const h = {
    data: Object.assign({ anchorSelector: '#anchor', reducedMotion: false }, def.data, initial),
    patches: [],
    callbacks: [],
    setData(patch, cb) {
      Object.assign(this.data, patch)
      this.patches.push(patch)
      if (cb) this.callbacks.push(cb)
    },
  }
  for (const [k, fn] of Object.entries(def.methods)) h[k] = fn.bind(h)
  h.show = def.observers.show.bind(h)
  h.onRender = def.observers._render.bind(h)
  h.def = def
  return h
}

// ════════════════════ 逻辑:FLIP 换算 ════════════════════

test('_flipStyle:按 触发元素 ÷ 承载元素 的真实比例缩,不是写死的 .92', () => {
  const flip = host().def.methods._flipStyle
  const out = flip({ left: 300, top: 40, width: 60, height: 60 },
                   { left: 0, top: 600, width: 375, height: 200 })
  const sc = out.match(/scale\(([\d.]+), ([\d.]+)\)/)
  assert.ok(sc, '起点必须含 scale')
  assert.ok(Math.abs(Number(sc[1]) - 60 / 375) < 1e-3,
    `x 必须缩到 按钮宽/面板宽 = ${(60 / 375).toFixed(4)},实际 ${sc[1]}。` +
    '写死 .92 就是第一版那个 bug —— 起点变成占满屏宽的扁条,看着不像从按钮长出来')
  assert.ok(Math.abs(Number(sc[2]) - 60 / 200) < 1e-3, 'y 必须缩到 按钮高/面板高')

  const tr = out.match(/translate3d\((-?\d+)px, (-?\d+)px, 0\)/)
  assert.ok(tr, '位移必须用 translate3d(2D translate 提合成层不稳,抄自 vaul)')
  assert.equal(Number(tr[1]), Math.round((300 + 30) - (0 + 187.5)), 'dx 必须是两个中心点之差')
  assert.equal(Number(tr[2]), Math.round((40 + 30) - (600 + 100)), 'dy 必须是两个中心点之差')

  const r = out.match(/border-radius:\s*(\d+)px/)
  assert.ok(r, 'radius:true 时起点必须给圆角')
  assert.equal(Number(r[1]), Math.min(999, Math.round((60 / 2) / (60 / 200))), '圆角必须除以 sy 反向补偿')
})

test('_flipStyle:小按钮配大面板不能被缩放下限夹住', () => {
  // ⚠️ 用例必须**明显低于**下限才有鉴别力:曾用 32/640=0.05 正好等于当时的下限,
  //   把下限调回 0.05 这条照样绿 —— 负控没能变红,等于白写。
  const flip = host().def.methods._flipStyle
  const out = flip({ left: 300, top: 40, width: 56, height: 28 },
                   { left: 0, top: 100, width: 375, height: 700 })
  const sy = Number(out.match(/scale\([\d.]+, ([\d.]+)\)/)[1])
  assert.ok(Math.abs(sy - 28 / 700) < 1e-3,
    `y 该是 ${(28 / 700).toFixed(4)},实际 ${sy} —— 缩放下限设太大,把常见的小按钮夹住了`)
})

test('_flipStyle:量不到时仍给出能播的起点,不能返回空(否则面板原地闪现)', () => {
  const flip = host().def.methods._flipStyle
  for (const [a, s] of [[null, { width: 375, height: 200 }],
                        [{ width: 60, height: 60 }, null],
                        [{ width: 60, height: 60 }, { width: 0, height: 0 }]]) {
    const out = flip(a, s)
    assert.match(out, /scale\(/, '降级也必须是个能播的起点')
    assert.match(out, /translate3d\(/, '降级同样用 translate3d')
  }
})

test('_flipStyle:radius:false 时不输出圆角 —— 承载元素没背景,画不出来只是白重绘', () => {
  const withR = host({ shellSelector: '.a', radius: true }).def.methods._flipStyle
  const noR = host({ shellSelector: '.a', radius: false }).def.methods._flipStyle
  const args = [{ left: 0, top: 0, width: 60, height: 60 }, { left: 0, top: 0, width: 375, height: 200 }]
  assert.match(withR(...args), /border-radius/)
  assert.doesNotMatch(noR(...args), /border-radius/,
    'radius:false 必须完全不输出圆角(cy-publish-sheet 的变换在无背景的外壳上)')
})

test('_flipStyle:圆角反补偿有上限,不产出会被浏览器钳掉的天文数字', () => {
  const flip = host().def.methods._flipStyle
  const out = flip({ left: 0, top: 0, width: 56, height: 28 },
                   { left: 0, top: 0, width: 375, height: 4000 })
  assert.ok(Number(out.match(/border-radius:\s*(\d+)px/)[1]) <= 999, '圆角补偿必须有上限')
})

// ════════════════════ 逻辑:状态机 ════════════════════

test('不传 anchor-selector:一个 setData 都不发(既有调用零影响)', () => {
  const h = host({ shellSelector: '.shell' }, { anchorSelector: '' })
  h.show(true); h.show(false); h.onRender(false)
  assert.deepEqual(h.patches, [], '没传锚点时 behavior 不该改任何状态')
})

test('打开必须在 setData 回调里量 —— 同步量会拿到还没上屏的面板', () => {
  /* 2026-08-26 实测:exit-motion 的 setData({_render:true}) 与量测在同一 tick 同步发出,
   * 首次打开侥幸量对了,**第二次打开量到的是触发元素自己的 rect**(选择器没命中,
   * 返回了上一个结果),算出 scale≈1 = 完全没有动画。 */
  const h = host()
  h.show(true)
  assert.equal(h.callbacks.length, 1,
    '打开时必须发一个**带回调**的 setData,在回调(= 渲染完成)里才量')
  assert.deepEqual(h.patches[0], { _morphOpen: false }, '量测前必须先落回起点态')
})

test('退场期间保住末态类 —— 摘早了动画根本不播,只剩干等', () => {
  /* 用户报的「收回时停一下」就是这个:_morphOpen 与 exit-motion 的 _closing 是两次
   * 不同的 setData,_morphOpen 先落地就会把末态类摘掉,面板掉回基础规则
   * (transition:none + opacity:0)⇒ 瞬间消失,然后干等一个退场时长才卸载。 */
  const h = host({ shellSelector: '.shell' }, { _morphOpen: true, _morphStyle: 'transform: scale(.1,.1);' })
  h.show(false)
  assert.equal(h.data._morphOpen, true, '退场期间 _morphOpen 必须保持 true')
  assert.deepEqual(h.patches, [], '退场分支不该发 setData 改末态')
})

test('卸载时必须把 _morphOpen 和 _morphStyle 一起清干净', () => {
  // _morphStyle 不清的话,下次(尤其减动效那条不量测的路径)会按**上一次的锚点**画起点
  const h = host({ shellSelector: '.shell' }, { _morphOpen: true, _morphStyle: 'transform: scale(.1,.1);' })
  h.onRender(false)
  assert.equal(h.data._morphOpen, false)
  assert.equal(h.data._morphStyle, '', '_morphStyle 必须一并清空,否则会复用旧锚点的起点')
})

test('减动效:直接落末态、不量测,且必须清掉上一次的起点', () => {
  const h = host({ shellSelector: '.shell' },
    { reducedMotion: true, _morphStyle: 'transform: scale(.5,.5);' })
  h.show(true)
  assert.equal(h.data._morphOpen, true, '减动效必须直接到位')
  assert.equal(h.data._morphStyle, '', '减动效不量测,留着旧值会按上一次的锚点画一帧')
  assert.equal(h.callbacks.length, 0, '减动效不该走量测回调,那要多等一个异步回合')
})

test('退场没播完就重开:直接长回去,不重走量测', () => {
  const h = host({ shellSelector: '.shell' }, { _morphOpen: true, _morphStyle: 'transform: scale(.1,.1);' })
  h.show(false)                       // 退场中
  h.show(true)                        // 立刻重开
  assert.equal(h.data._morphOpen, true)
  assert.equal(h.callbacks.length, 0, '锚点没变,不必重量(重量要等一个异步回合,会先跳回全缩)')
})

// ════════════════════ 静态:样式作用域 ════════════════════

/** 拆成 (selector, body),剥注释 —— 注释里的类名不是规则 */
function rules(wxss) {
  const css = wxss.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = m[1].trim()
    if (!selector || selector.startsWith('@')) continue
    out.push({ selector, body: m[2] })
  }
  return out
}

/* 判据与实现细节解耦:不再列举「morph 现在长什么样」的指纹(那会随代码演进失效,
 * 已经栽过一次),而是盯一个**不变量**:面板本体这些「所有调用都吃到」的裸选择器,
 * 规则体里永远不许出现起点态特征。morph 怎么改都不影响这条。 */
const GLOBAL_RULES = [
  { wxss: 'components/cy/sheet/index.wxss', selector: '.sh__panel' },
  { wxss: 'components/cy/publish-sheet/index.wxss', selector: '.ps__panel' },
]
const START_STATE = [
  { re: /opacity:\s*0\b/, what: 'opacity: 0(面板会整个看不见)' },
  { re: /transition:\s*none/, what: 'transition: none(所有弹窗都没了过渡)' },
  { re: /transform:\s*(?!none)\S/, what: 'transform 起点(所有弹窗被压扁/位移)' },
]
const leaks = (wxss, selector) =>
  rules(wxss).filter((r) => r.selector.trim() === selector)
    .flatMap(({ body }) => START_STATE.filter((s) => s.re.test(body)).map((s) => s.what))

test('面板本体的裸规则不许带起点态特征 —— 带了就是全站弹窗一起遭殃', () => {
  for (const { wxss, selector } of GLOBAL_RULES) {
    assert.deepEqual(leaks(read(wxss), selector), [], `${wxss} 的 ${selector} 泄漏了起点态`)
  }
})

test('负控:把起点态泄漏到面板本体,两个组件都必须判红', () => {
  for (const { wxss, selector } of GLOBAL_RULES) {
    const leaked = read(wxss) + `\n${selector} { transform: scale(.92, .12); opacity: 0; transition: none; }\n`
    assert.equal(leaks(leaked, selector).length, START_STATE.length,
      `${selector}:三种起点态特征都必须被抓出来`)
  }
})

test('morph 类由 anchor-selector 直接推导,末态清空行内 style、退场再挂回去', () => {
  for (const [wxml, clsList] of [
    ['components/cy/sheet/index.wxml', ['sh--morph', 'sh__panel--morph']],
  ]) {
    const src = read(wxml)
    for (const cls of clsList) {
      const m = src.match(new RegExp("\\{\\{\\s*([A-Za-z_$][\\w$]*)\\s*\\?\\s*'" + cls + "'"))
      assert.ok(m, `${wxml}: 找不到 ${cls} 的条件表达式`)
      assert.equal(m[1], 'anchorSelector',
        `${cls} 必须直接由 anchorSelector 推导(现在读的是 ${m[1]});` +
        '读量测结果的话,面板会先按默认动画渲染一帧再切成 morph')
    }
    assert.match(src, /style="\{\{\(_morphOpen && !_closing\) \? '' : _morphStyle\}\}"/,
      `${wxml}: 末态清空行内起点变换(否则它优先级最高、过渡不回原位),` +
      '但退场时必须挂回去 —— 否则收回时无处可去,面板直接消失')
  }
})

test('起点态必须显式关掉过渡,并常驻 will-change', () => {
  for (const [wxss, sel] of [
    ['components/cy/sheet/index.wxss', '.sh.sh--morph .sh__panel--morph'],
  ]) {
    const rule = rules(read(wxss)).find((r) => r.selector.trim() === sel)
    assert.ok(rule, `${wxss}: 找不到 ${sel}`)
    assert.match(rule.body, /transition:\s*none/,
      `${sel} 必须显式关掉过渡:它会从基础规则继承 transition,带着过渡设起点会先播一段反向动画`)
    assert.match(rule.body, /opacity:\s*0/, `${sel} 未量完时必须先藏住,否则按原尺寸露一帧`)
    assert.match(rule.body, /will-change:\s*transform/,
      `${sel} 必须常驻 will-change: transform —— 层若等动画开始那刻才建,第一帧必卡(vaul 同款)`)
  }
})

test('通用 sheet 挂齐 morph 的三件依赖', () => {
  for (const js of ['components/cy/sheet/index.js']) {
    const src = read(js)
    assert.match(src, /morphEntrance\(\{/, `${js}: 必须走共享 behavior,别再各写一份`)
    assert.match(src, /reducedMotionBehavior/, `${js}: morph 的减动效分支依赖 reducedMotion`)
    assert.match(src, /exitMotion\(\d+\)/, `${js}: morph 的退场依赖 exit-motion 的 _render/_closing`)
  }
})

test('morph 退场时长与 exitMotion(<ms>) 不许漂移 —— 既有退场契约只看 animation,这里是它的盲区', () => {
  for (const [wxss, js, closingSel] of [
    ['components/cy/sheet/index.wxss', 'components/cy/sheet/index.js', 'sh--closing'],
    ['components/cy/publish-sheet/index.wxss', 'components/cy/publish-sheet/index.js', 'ps--closing'],
  ]) {
    const closing = rules(read(wxss)).find(({ selector, body }) =>
      selector.includes(closingSel) && (selector.includes('morph') || selector.includes('ps__quick')) && /transition:\s*transform/.test(body))
    assert.ok(closing, `${wxss}: 找不到 morph 的退场规则`)
    const token = closing.body.match(/transition:\s*transform\s+var\(--cy-motion-([a-z-]+)\)/)
    assert.ok(token, '退场时长必须读 --cy-motion-* token,不许写死数值')
    const ms = Number(read('style/tokens.wxss').match(new RegExp('--cy-motion-' + token[1] + ':\\s*(\\d+)ms'))[1])
    const wired = Number(read(js).match(/exitMotion\((\d+)\)/)[1])
    assert.equal(ms, wired,
      `${wxss}: 退场 ${ms}ms 与 exitMotion(${wired}) 漂移了:大了动画没播完就卸载,小了播完还多等一拍`)
    assert.ok(ms < 350, '退场必须快于进场 350ms(DS 文档3 §B.1 进场慢、退场快)')
  }
})

test('内容错峰用 sheet 自己的 token,不借按压触觉档', () => {
  const wxss = read('components/cy/sheet/index.wxss')
  for (const { selector, body } of rules(wxss).filter((r) => /transition-delay:\s*var\(/.test(r.body))) {
    assert.doesNotMatch(body, /transition-delay:\s*var\(--cy-motion-press\)/,
      `${selector} 借用了 --cy-motion-press(「按钮按压回弹,触觉级,勿加长」):语义外挪`)
  }
  assert.match(read('style/tokens.wxss'), /--cy-comp-sheet-morph-delay:\s*\d+ms/, '必须有自己的 token')
})

test('cy-publish-sheet:悬浮菜单整体缩放与行上浮分层，完全替换白色半屏', () => {
  const wxml = read('components/cy/publish-sheet/index.wxml')
  assert.match(wxml, /class="ps__quick"/)
  const wxss = read('components/cy/publish-sheet/index.wxss')
  assert.match(wxss, /\.ps\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*z-index:/)
  assert.match(wxss, /\.ps__mask\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;/)
  assert.match(wxss, /\.ps--closing\s*\{[^}]*pointer-events:\s*none/)
  assert.match(wxml, /merchant \? 'theme-merchant ps--merchant' : 'theme-dark'/)
  assert.match(wxml, /ps__quick-action/)
  assert.doesNotMatch(wxml, /ps__panel|ps__morph|theme-topic-editor|<swiper/)
})

test('cy-publish-sheet:接了 exit-motion —— 它此前是瞬间消失,连退场都没有', () => {
  const wxml = read('components/cy/publish-sheet/index.wxml')
  assert.match(wxml, /wx:if="\{\{_render\}\}"/, '根节点必须由内部 _render 控制卸载')
  assert.doesNotMatch(wxml, /wx:if="\{\{show\}\}"/, '不能再直接用外部 show 卸载(会瞬间消失)')
  assert.ok(wxml.includes("_closing ? 'ps--closing'"), '根节点必须绑定 ps--closing')
})
