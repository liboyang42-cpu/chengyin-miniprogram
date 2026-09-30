/* 俱乐部端动效规格契约(2026-09-02)
 *
 * 真源 = Figma「俱乐部端重做」s7SEFaoJ3GQUIxJhdqcFUb 的三个节点,逐字抄在下面的 SPEC 里:
 *   · 40:3  「动效 token · 全部有出处」—— 场景 / 规格 / 缓动·时长 / 出处 四列表
 *   · 41:116「上滑中:sheet 位移与蒙层透明度同步插值,ease-out(0,0,.2,1),全程 300ms。」
 *   · 41:117「完成:…… 关闭走 250ms ease-in,比打开短。」
 *   · 42:168「展开中:height 与内容不透明度同步插值,内容自 -4px 归位。chevron 同曲线转到 90°。」
 *   · 42:169「完成。收起走反向 200ms accelerate —— 比展开短,M3 的 exit 规则。」
 *
 * 为什么要有这条:这些数字此前**只存在于稿里**。cy-sheet 实际跑的是 350ms 进 / 220ms 出
 * (借的是 --cy-motion-slow / -standard 两个通用档),club/detail 的折叠曲线虽然数值对,
 * 却是四处写死的字面 cubic-bezier —— 调一次动效要全仓找字面量,而且没有任何东西会在
 * 有人改回去的时候判红。
 *
 * 锁三件事:
 *   ① 稿裁决的六个时长 + 三条 M3 缓动,在 tokens.wxss 里有档且值与稿一致;
 *   ② 用到这些手势的地方**读档**,不写字面 cubic-bezier / ms;
 *   ③ 进/出成对,且出必须短于进(M3 exit 规则;40:3 三行都写了)。
 *
 * ⚠️ 断言锚点一律钉**结构**(行首选择器 / 属性名 / var() 形状),不钉解释性注释的字面文本 ——
 *    注释会被后来的人改写,钉字面量的断言会自己撞红。
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 稿 40:3 逐行抄下来的时长档。改这里之前先回去改稿,别反过来。 */
const DURATION_SPEC = {
  'sheet-in': 300,    // 半屏 sheet 打开 · Peloton Class Filter Sheet
  'sheet-out': 250,   // 半屏 sheet 关闭 · Clubhouse「leave quietly」
  'expand': 300,      // 行内展开 · M3 emphasized-decelerate
  'collapse': 200,    // 行内收起 · M3 exit/collapse 用更短时长
  'crossfade': 150,   // chip 选中 cross-fade · M3 duration-short-4
  'check-fill': 120,  // 勾选框方框填充 · Hevy「Set check」
}

/** 稿 40:3 的缓动列。M3 官方 easing token。 */
const EASE_SPEC = {
  'decelerate': 'cubic-bezier(0, 0, .2, 1)',
  'accelerate': 'cubic-bezier(.4, 0, 1, 1)',
  'emphasized-decelerate': 'cubic-bezier(.05, .7, .1, 1)',
}

/** 把 cubic-bezier 归一成四个数,免得空格/前导零的写法差异误判 */
function normalizeCurve(text) {
  const m = text.match(/cubic-bezier\(([^)]*)\)/)
  assert.ok(m, `不是一条 cubic-bezier:${text}`)
  return m[1].split(',').map((n) => String(Number(n.trim()))).join(',')
}

function durationOf(tokens, name) {
  const m = tokens.match(new RegExp('--cy-motion-' + name + ':\\s*(\\d+)ms'))
  assert.ok(m, `tokens.wxss 里找不到 --cy-motion-${name}`)
  return Number(m[1])
}

// ---------------------------------------------------------------- ①

function assertTokensMatchSpec(tokens) {
  for (const [name, ms] of Object.entries(DURATION_SPEC)) {
    assert.equal(durationOf(tokens, name), ms,
      `--cy-motion-${name} 与稿 40:3 漂移了(稿 ${ms}ms)`)
  }
  for (const [name, curve] of Object.entries(EASE_SPEC)) {
    const m = tokens.match(new RegExp('--cy-ease-' + name + ':\\s*(cubic-bezier\\([^)]*\\))'))
    assert.ok(m, `tokens.wxss 里找不到 --cy-ease-${name}`)
    assert.equal(normalizeCurve(m[1]), normalizeCurve(curve),
      `--cy-ease-${name} 与稿 40:3 漂移了(稿 ${curve})`)
  }
}

/* ③ 进/出成对:出必须短于进。40:3 的「半屏 sheet 关闭」「行内收起」两行都写了这条。
 * 单独成函数而不是并进 assertTokensMatchSpec:后者逐档比对稿值,任何变异都会先撞上它,
 * 负控就永远走不到这条分支 —— 那样的负控是「抛在别的地方也算过」的自欺。 */
function assertExitShorterThanEnter(tokens) {
  assert.ok(durationOf(tokens, 'sheet-out') < durationOf(tokens, 'sheet-in'),
    'M3 exit 规则:sheet 关闭必须短于打开(稿 41:117「比打开短」)')
  assert.ok(durationOf(tokens, 'collapse') < durationOf(tokens, 'expand'),
    'M3 exit 规则:行内收起必须短于展开(稿 42:169「比展开短」)')
}

test('动效 token 与稿 40:3 逐条一致', () => {
  assertTokensMatchSpec(read('style/tokens.wxss'))
})

test('进/出成对,且出必须短于进(M3 exit 规则)', () => {
  assertExitShorterThanEnter(read('style/tokens.wxss'))
})

test('负控:任一时长档与稿漂移必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace(/(--cy-motion-sheet-in:\s*)\d+ms/, '$1350ms')
  assert.notEqual(mutated, tokens, '负控锚点失效:没找到 --cy-motion-sheet-in 的定义')
  assert.match(mutated, /--cy-motion-sheet-in:\s*350ms/, '负控锚点失效:变异没写进去')
  assert.throws(() => assertTokensMatchSpec(mutated), assert.AssertionError)
})

test('负控:缓动曲线被换成别的必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace(
    /(--cy-ease-emphasized-decelerate:\s*)cubic-bezier\([^)]*\)/,
    '$1cubic-bezier(.4, 0, .2, 1)')
  assert.notEqual(mutated, tokens, '负控锚点失效:没找到 --cy-ease-emphasized-decelerate 的定义')
  assert.throws(() => assertTokensMatchSpec(mutated), assert.AssertionError)
})

test('负控:出比进长(违反 M3 exit 规则)必须判红', () => {
  const tokens = read('style/tokens.wxss')
  const mutated = tokens.replace(/(--cy-motion-collapse:\s*)\d+ms/, '$1400ms')
  assert.notEqual(mutated, tokens, '负控锚点失效:没找到 --cy-motion-collapse 的定义')
  assert.throws(() => assertExitShorterThanEnter(mutated), /exit 规则/)
})

// ---------------------------------------------------------------- ②

/** 注释里的 transition/animation 是说明不是声明 —— 抹掉但保留行数 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
}

/** 取出所有 animation / transition 声明体(已剥注释) */
function motionDeclarations(wxss) {
  return stripComments(wxss).match(/(?:animation|transition)\s*:[^;}]+/g) || []
}

function assertNoLiteralMotion(wxss, what) {
  for (const decl of motionDeclarations(wxss)) {
    assert.doesNotMatch(decl, /cubic-bezier/,
      `${what} 里还有字面 cubic-bezier,必须读 --cy-ease-* 档:${decl.trim()}`)
    assert.doesNotMatch(decl, /(?:^|[\s(,])\d+(?:\.\d+)?m?s\b/,
      `${what} 里还有字面时长,必须读 --cy-motion-* 档:${decl.trim()}`)
  }
}

test('cy-sheet:进出场都读档,不写字面 cubic-bezier / ms', () => {
  assertNoLiteralMotion(read('components/cy/sheet/index.wxss'), 'components/cy/sheet/index.wxss')
})

test('负控:往 cy-sheet 塞回一条字面曲线必须判红', () => {
  const wxss = read('components/cy/sheet/index.wxss')
  const mutated = wxss.replace(
    /(animation:\s*sh-up\s+)var\(--cy-motion-[a-z-]+\)\s+var\(--cy-ease-[a-z-]+\)/,
    '$1350ms cubic-bezier(.22,.61,.36,1)')
  assert.notEqual(mutated, wxss, '负控锚点失效:找不到 sh-up 的进场声明')
  assert.match(mutated, /animation:\s*sh-up\s+350ms/, '负控锚点失效:变异没写进去')
  assert.throws(() => assertNoLiteralMotion(mutated, 'mutated'), assert.AssertionError)
})

/** cy-sheet 的进场/退场:时长仍是稿裁的 sheet-in / sheet-out 档,
 *  曲线按 2026-09-06 用户裁决统一走 --cy-ease-standard(慢快慢)。
 *  ⚠️ 此前这里钉的是稿 40:3 / 41:116 的 decelerate + accelerate。用户看过实机后
 *  明确要求「弹起来和落下都要慢快慢」,以用户为准 —— 那两条稿裁不再是判据。
 *  仍然钉住「必须读 token 档、不许写字面曲线」,只是把期望值换成 standard。 */
function assertSheetGestureTokens(wxss) {
  const enter = stripComments(wxss).match(/animation:\s*sh-up\s+var\(--cy-motion-([a-z-]+)\)\s+var\(--cy-ease-([a-z-]+)\)/)
  assert.ok(enter, 'cy-sheet 的进场 sh-up 必须同时读 --cy-motion-* 与 --cy-ease-* 档')
  assert.equal(enter[1], 'sheet-in', '稿 40:3:半屏 sheet 打开走 sheet-in(300ms),不是通用的 slow')
  assert.equal(enter[2], 'standard', '2026-09-06 用户裁决:升起走慢快慢 = --cy-ease-standard')

  const exit = stripComments(wxss).match(/animation:\s*sh-down\s+var\(--cy-motion-([a-z-]+)\)\s+var\(--cy-ease-([a-z-]+)\)/)
  assert.ok(exit, 'cy-sheet 的退场 sh-down 必须同时读 --cy-motion-* 与 --cy-ease-* 档')
  assert.equal(exit[1], 'sheet-out', '稿 41:117:关闭走 250ms = --cy-motion-sheet-out')
  assert.equal(exit[2], 'standard', '2026-09-06 用户裁决:落下同样走慢快慢 = --cy-ease-standard')
}

test('cy-sheet 的进出场读的是稿裁决的 sheet-in / sheet-out,不是通用 slow / standard', () => {
  assertSheetGestureTokens(read('components/cy/sheet/index.wxss'))
})

/* 负控:光断言「读了某个 --cy-ease-* 档」是恒真的 —— 换成别的档一样匹配正则。
   必须证明换回改版前那两条(decelerate / accelerate)会判红,这条断言才有价值。 */
test('负控:sheet 曲线退回 decelerate / accelerate 必须判红', () => {
  const wxss = read('components/cy/sheet/index.wxss')
  for (const [name, from, to] of [
    ['进场', /(animation:\s*sh-up\s+var\(--cy-motion-[a-z-]+\)\s+var\()--cy-ease-standard/, '$1--cy-ease-decelerate'],
    ['退场', /(animation:\s*sh-down\s+var\(--cy-motion-[a-z-]+\)\s+var\()--cy-ease-standard/, '$1--cy-ease-accelerate'],
  ]) {
    const mutated = wxss.replace(from, to)
    assert.notEqual(mutated, wxss, '负控锚点失效:找不到' + name + '的 standard 曲线')
    assert.throws(() => assertSheetGestureTokens(mutated), assert.AssertionError,
      name + '退回旧档竟然没判红 —— 这条断言是恒真的')
  }
})

test('负控:sheet 进场退回 --cy-motion-slow 必须判红', () => {
  const wxss = read('components/cy/sheet/index.wxss')
  const mutated = wxss.replace(
    /(animation:\s*sh-up\s+)var\(--cy-motion-[a-z-]+\)/, '$1var(--cy-motion-slow)')
  assert.notEqual(mutated, wxss, '负控锚点失效:找不到 sh-up 的进场时长')
  assert.match(mutated, /animation:\s*sh-up\s+var\(--cy-motion-slow\)/, '负控锚点失效:变异没写进去')
  assert.throws(() => assertSheetGestureTokens(mutated), /sheet-in/)
})

// ---------------------------------------------------------------- 行内折叠

/** club/detail 的两处折叠:chevron 转向 + 面板内容进场,都必须读档 */
function assertFoldMotion(wxss) {
  const src = stripComments(wxss)
  for (const cls of ['manage-fold-chevron', 'cset-chevron']) {
    const collapsed = src.match(new RegExp('\\.' + cls + '\\s*\\{[^}]*transition:\\s*transform\\s+var\\(--cy-motion-([a-z-]+)\\)\\s+var\\(--cy-ease-([a-z-]+)\\)'))
    assert.ok(collapsed, `.${cls} 的收起态必须读 --cy-motion-* / --cy-ease-* 档`)
    assert.equal(collapsed[1], 'collapse', `稿 42:169:.${cls} 收起走 200ms collapse`)
    assert.equal(collapsed[2], 'accelerate', `稿 42:169:.${cls} 收起走 accelerate`)

    const opened = src.match(new RegExp('\\.' + cls + '\\.open\\s*\\{[^}]*transition:\\s*transform\\s+var\\(--cy-motion-([a-z-]+)\\)\\s+var\\(--cy-ease-([a-z-]+)\\)'))
    assert.ok(opened, `.${cls}.open 必须读 --cy-motion-* / --cy-ease-* 档`)
    assert.equal(opened[1], 'expand', `稿 42:168:.${cls} 展开走 300ms expand`)
    assert.equal(opened[2], 'emphasized-decelerate', `稿 42:168:chevron 同曲线转到 90°`)
    assert.match(src, new RegExp('\\.' + cls + '\\.open\\s*\\{[^}]*transform:\\s*rotate\\(90deg\\)'),
      `稿 42:168:.${cls} 展开态必须转到 90°`)
  }

  // 内容进场:两处折叠面板共用一组 keyframes(稿 42:168「内容自 -4px 归位」)
  assert.match(src, /@keyframes cy-fold-in\b/, '缺行内展开的内容进场 keyframes cy-fold-in')
  const kf = src.match(/@keyframes cy-fold-in\s*\{[\s\S]*?\n\}/)
  assert.ok(kf, 'cy-fold-in 的 keyframes 体读不出来')
  assert.match(kf[0], /from\s*\{[^}]*opacity:\s*0/, '稿 40:3:内容 opacity 0 → 1')
  assert.match(kf[0], /from\s*\{[^}]*translateY\(-4px\)/, '稿 42:168:内容自 -4px 归位')
  for (const panel of ['manage-fold-panel', 'cset-panel']) {
    assert.match(src, new RegExp('\\.' + panel + '\\s*\\{[^}]*animation:\\s*cy-fold-in\\s+var\\(--cy-motion-expand\\)\\s+var\\(--cy-ease-emphasized-decelerate\\)'),
      `.${panel} 必须按 expand + emphasized-decelerate 播 cy-fold-in`)
  }
}

test('club/detail 两处折叠:chevron 与面板内容都按稿的档走', () => {
  assertFoldMotion(read('pages/club/detail/index.wxss'))
})

test('负控:折叠 chevron 写回字面 cubic-bezier 必须判红', () => {
  const wxss = read('pages/club/detail/index.wxss')
  const mutated = wxss.replace(
    /(\.cset-chevron\s*\{[^}]*transition:\s*transform\s+)var\(--cy-motion-[a-z-]+\)\s+var\(--cy-ease-[a-z-]+\)/,
    '$1200ms cubic-bezier(0.4, 0, 1, 1)')
  assert.notEqual(mutated, wxss, '负控锚点失效:找不到 .cset-chevron 的收起态声明')
  assert.match(mutated, /\.cset-chevron\s*\{[^}]*200ms cubic-bezier/, '负控锚点失效:变异没写进去')
  assert.throws(() => assertFoldMotion(mutated), assert.AssertionError)
  // 同一处变异也必须被「禁字面量」那条抓到 —— 两条断言各自独立,不许互相顶替
  assert.throws(() => assertNoLiteralMotion(mutated, 'mutated'), assert.AssertionError)
})

test('负控:把内容进场的起始位移抹掉(退回纯淡入)必须判红', () => {
  const wxss = read('pages/club/detail/index.wxss')
  const mutated = wxss.replace(
    /(@keyframes cy-fold-in\s*\{[\s\S]*?from\s*\{[^}]*)\s*transform:\s*translateY\(-4px\);/,
    '$1')
  assert.notEqual(mutated, wxss, '负控锚点失效:找不到 cy-fold-in 的起始位移')
  assert.doesNotMatch(mutated, /translateY\(-4px\)/, '负控锚点失效:位移没被抹掉')
  assert.throws(() => assertFoldMotion(mutated), /-4px/)
})

test('负控:折叠面板不挂进场动画必须判红', () => {
  const wxss = read('pages/club/detail/index.wxss')
  const mutated = wxss.replace(
    /(\.manage-fold-panel\s*\{[^}]*)\n\s*animation:\s*cy-fold-in[^;]*;/, '$1')
  assert.notEqual(mutated, wxss, '负控锚点失效:找不到 .manage-fold-panel 的 animation 声明')
  assert.throws(() => assertFoldMotion(mutated), /cy-fold-in/)
})

// ------------------------------------------------ 减少动态效果兜底(稿 40:3 末行)

/* 稿 40:3 最后一行:「★ 减少动态效果兜底 / 全部改成 150ms 纯淡入淡出;不缩放、不位移」。
 * ⚠️ 只写 .cy-motion-reduced 规则不算落地:那是个后代选择器,页面根节点不挂这个类,
 *    规则一辈子匹配不到 —— 门禁只读 wxss 就会 fail-open 地判绿。所以这条一次断三段:
 *    ① wxss 里有兜底规则;② wxml 根节点按 reducedMotion 挂类;③ js 真的去读了偏好。
 *    锚点钉结构(选择器 / 属性名 / 调用形状),不钉注释文本。 */
function assertReducedMotionWired({ wxss, wxml, js }) {
  const src = stripComments(wxss)
  const rule = src.match(/\.cy-motion-reduced\s+\.manage-fold-panel[\s\S]{0,120}?\{([^}]*)\}/)
  assert.ok(rule, '缺 .cy-motion-reduced 下折叠面板的兜底规则')
  assert.match(rule[1], /animation-name:\s*cy-fade-in/, '稿 40:3:兜底要换成纯淡入,不是 animation:none')
  assert.match(rule[1], /animation-duration:\s*var\(--cy-motion-crossfade\)/, '稿 40:3:兜底统一 150ms crossfade 档')

  assert.match(wxml.split('\n')[0], /reducedMotion\s*\?\s*'cy-motion-reduced'/,
    '页面根节点没按 reducedMotion 挂 .cy-motion-reduced —— 兜底规则匹配不到,等于没写')
  assert.match(js, /readReducedMotion\s*\(\s*\)/,
    'index.js 只 import 了 readReducedMotion 却没调用,reducedMotion 永远是 false')
  assert.match(js, /reducedMotion:\s*false/, 'data 里要有 reducedMotion 初值')
}

test('club/detail 的减动效兜底真的接上了(wxss + wxml 根类 + js 读偏好)', () => {
  assertReducedMotionWired({
    wxss: read('pages/club/detail/index.wxss'),
    wxml: read('pages/club/detail/index.wxml'),
    js: read('pages/club/detail/index.js'),
  })
})

test('负控:只留 wxss 规则、根节点不挂类必须判红(这正是接线前的原状)', () => {
  const wxml = read('pages/club/detail/index.wxml')
  const mutated = wxml.replace(/\s*\{\{reducedMotion \? 'cy-motion-reduced' : ''\}\}/, '')
  assert.notEqual(mutated, wxml, '负控锚点失效:找不到根节点的 reducedMotion 绑定')
  assert.doesNotMatch(mutated.split('\n')[0], /cy-motion-reduced/, '负控锚点失效:绑定没被摘掉')
  assert.throws(() => assertReducedMotionWired({
    wxss: read('pages/club/detail/index.wxss'), wxml: mutated, js: read('pages/club/detail/index.js'),
  }), /匹配不到/)
})

test('负控:js 不调用 readReducedMotion 必须判红', () => {
  const js = read('pages/club/detail/index.js')
  const mutated = js.replace(/const reducedMotion = readReducedMotion\(\);/, 'const reducedMotion = false;')
  assert.notEqual(mutated, js, '负控锚点失效:找不到 readReducedMotion 的调用')
  assert.doesNotMatch(mutated, /readReducedMotion\s*\(\s*\)/, '负控锚点失效:调用没被摘掉')
  assert.throws(() => assertReducedMotionWired({
    wxss: read('pages/club/detail/index.wxss'), wxml: read('pages/club/detail/index.wxml'), js: mutated,
  }), /永远是 false/)
})
