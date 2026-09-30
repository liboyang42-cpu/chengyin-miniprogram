/*
 * DS 规范真源门禁 —— 判据是 vault `04-未开始/小程序UI规范真源_20260805.md`。
 *
 * 分两类:
 *   **禁死** —— 当前已经零违规的规则,再出现一处就红
 *   **棘轮** —— 有存量的规则,锁住当前数量,只能减不能增
 *
 * 为什么要棘轮而不是一次禁死:硬编码颜色 302 处、描边+填充并存 59 处,一次全禁
 * 会让 CI 长期红着没人能合任何东西,门禁就形同虚设。棘轮保证「不再变坏」,
 * 存量由后续迁移批次逐步啃掉,每啃一批就把基线调低。
 *
 * ⚠️ 本文件自带负控(每条规则一个「注入违规必须红」的用例)。
 * 改这里的规则时,负控也要跟着改 —— 没有负控的门禁一律当没写(规范真源 §12)。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, ext, out)
    else if (e.name.endsWith(ext)) out.push(p)
  }
  return out
}
const pageFiles = (ext) => ['pages', 'subpackageA', 'subpackageB', 'subpackageP3']
  .filter((d) => fs.existsSync(path.join(ROOT, d)))
  .flatMap((d) => walk(path.join(ROOT, d), ext))
const rel = (p) => path.relative(ROOT, p)

// ── 规则实现:每条都是「输入一段源码 → 输出违规列表」，好让负控能直接喂假源码 ──

// §2.1 accent 变体已废止(紫色渐变)。旧 alias kind="blue" 由 observer 映射到
// primary，本身不违规，所以只禁 variant="accent"。
const findAccent = (src) => [...src.matchAll(/variant="accent"/g)].map((m) => m.index)

// §3.3 开关一律走 cy-switch。原生 <switch> 的 color 属性只吃字面量、不认 CSS var,
// 各页自己传色必然漂移(改前实测:紫 #7A5CFF / 墨蓝 #151B23 / iOS绿 #34c759 三种混用)。
const findRawSwitch = (src) => [...src.matchAll(/<switch[\s>]/g)].map((m) => m.index)

// §0.3 + §1.2 中性 = 饱和度 ≤5%。19% 的紫单看色卡不明显,大面积铺开就是可见的紫。
function saturation(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const l = (max + min) / 2
  return ((l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min))) * 100
}
const GRAY_TOKENS = ['--cy-color-bg-page', '--cy-color-bg-surface', '--cy-color-bg-surface-subtle', '--cy-color-bg-elevated']
function findSaturatedGrays(tokensSrc) {
  const bad = []
  for (const name of GRAY_TOKENS) {
    for (const m of tokensSrc.matchAll(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})\\s*;`, 'g'))) {
      const s = saturation(m[1])
      if (s > 5) bad.push(`${name}: ${m[1]} 饱和度 ${s.toFixed(1)}%`)
    }
  }
  return bad
}

// §2.2 / §5 只有填充,没有描边
function findBorderAndFill(src) {
  const bad = []
  for (const m of src.matchAll(/\.[\w-]*(?:btn|card|cta)[\w-]*\s*\{([^}]*)\}/g)) {
    const body = m[1]
    if (/border\s*:\s*[^;]*solid/.test(body) && /background(?:-color)?\s*:/.test(body) && !body.includes('transparent')) {
      bad.push(m[0].slice(0, 40))
    }
  }
  return bad
}

// §0.3 颜色必须走 token。跳过 token 定义行本身和显式标了 ds-ok 的例外。
function findHardcodedColors(src) {
  const bad = []
  src.split('\n').forEach((line, i) => {
    if (line.includes('--cy-') || line.includes('ds-ok')) return
    if (/(?:color|background(?:-color)?)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\()/.test(line)) bad.push(i + 1)
  })
  return bad
}

// ── 禁死类 ──

test('§2.1 accent 变体已废止,不许再出现', () => {
  const hits = pageFiles('.wxml').flatMap((f) => (findAccent(fs.readFileSync(f, 'utf8')).length ? [rel(f)] : []))
  assert.deepEqual(hits, [], `这些文件用了已废止的 variant="accent"(紫色渐变),改用 variant="primary"`)
})

test('§3.3 开关一律走 cy-switch,不许用原生 <switch>', () => {
  const hits = pageFiles('.wxml').flatMap((f) => (findRawSwitch(fs.readFileSync(f, 'utf8')).length ? [rel(f)] : []))
  assert.deepEqual(hits, [], '原生 <switch> 的 color 只吃字面量、不认 CSS var,必然漂移;用 <cy-switch>')
})

test('§1.2 玩家深色灰阶必须中性(饱和度 ≤5%)', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8')
  assert.deepEqual(findSaturatedGrays(tokens), [], '灰阶带色相,大面积铺开会被看成泛紫/泛蓝')
})

// §4 状态色只能来自 --cy-color-status-* 四件套,不许硬编码 rgba,也不许借用品牌色。
// 改前 cy-tag 的 blue 用的是 --cy-accent(品牌色),红/蓝/灰的软底全是手写 rgba。
function findTagColorViolations(tagWxss) {
  const bad = []
  for (const m of tagWxss.matchAll(/\.tag--(\w+)[^{]*\{([^}]*)\}/g)) {
    const [, name, body] = m
    if (/border\s*:\s*[^;]*solid/.test(body)) bad.push(`.tag--${name} 有外描边(§5)`)
    if (/rgba?\([\d\s.,]+\)/.test(body)) bad.push(`.tag--${name} 硬编码 rgba(§4)`)
    if (/var\(--cy-accent\)/.test(body)) bad.push(`.tag--${name} 借用品牌色当状态色(§4)`)
  }
  return bad
}

// §5 卡片也不许有外描边。inset box-shadow 是起层不是描边,不在禁列。
// ⚠️ 必须先剥注释再匹配 —— 第一版没剥,结果把「去掉 border: 1rpx solid」这句
// **注释文字**当成了违规,自己红自己。规则扫源码时,注释里的示例代码是噪声。
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
function findCardBorder(cardWxss) {
  const bad = []
  for (const m of stripComments(cardWxss).matchAll(/\.cy-card[^{]*\{([^}]*)\}/g)) {
    if (/\bborder\s*:\s*[^;]*solid/.test(m[1])) bad.push(m[0].slice(0, 40))
  }
  return bad
}

test('§5 cy-card 无外描边(inset 高光不算)', () => {
  const cardWxss = fs.readFileSync(path.join(ROOT, 'components/cy/card/index.wxss'), 'utf8')
  assert.deepEqual(findCardBorder(cardWxss), [])
})

test('§4/§5 cy-tag 的状态色走 token、无描边', () => {
  const tagWxss = fs.readFileSync(path.join(ROOT, 'components/cy/tag/index.wxss'), 'utf8')
  assert.deepEqual(findTagColorViolations(tagWxss), [])
})

// json 里的 backgroundColor / navigationBarBackgroundColor 是**下拉回弹和原生导航栏**
// 的底色，CSS 管不到、只能写字面量 —— 这是纯 wxss 扫描的结构性盲区。改 token 时它们
// 不会跟着走，2026-08-05 实测有 51 处，其中 10 处还停在去紫相之前的 #020104。
// 判据：这些字面量必须是当前 tokens 里真实存在的某个背景值(大小写不敏感)。
function findStaleJsonColors(tokensSrc, jsonFiles) {
  const live = new Set()
  for (const m of tokensSrc.matchAll(/--cy-color-bg-[\w-]+\s*:\s*(#[0-9A-Fa-f]{6})\s*;/g)) live.add(m[1].toUpperCase())
  const bad = []
  for (const { file, src } of jsonFiles) {
    for (const m of src.matchAll(/"(?:backgroundColor|navigationBarBackgroundColor)"\s*:\s*"(#[0-9A-Fa-f]{3,8})"/g)) {
      const v = m[1].toUpperCase()
      if (v === '#FFFFFF' || v === '#FFF') continue // 纯白是合法常量，不在 bg 阶梯里
      if (!live.has(v)) bad.push(`${file}: ${m[1]}`)
    }
  }
  return bad
}

test('§1 json 里的原生底色必须跟 tokens 同步', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8')
  const jsons = pageFiles('.json').concat([path.join(ROOT, 'app.json')])
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ file: rel(f), src: fs.readFileSync(f, 'utf8') }))
  assert.deepEqual(findStaleJsonColors(tokens, jsons), [],
    'json 的 backgroundColor 停在旧值 —— 改 token 时它不会自动跟着走(CSS 管不到原生回弹底)')
})

// <map> 的颜色只能在 JS 里设、吃不到 CSS var，所以路线色板在 tokens 和
// pages/publish/fabu/index.js 各存一份。两份必须同步 —— 这类「双真源」是最容易
// 悄悄漂开的地方，token 改了 JS 不会跟着走。
function findRouteColorDrift(tokensSrc, fabuSrc) {
  const fromTokens = []
  for (let i = 1; i <= 5; i += 1) {
    const m = new RegExp(`--cy-route${i === 1 ? '' : '-' + i}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokensSrc)
    if (m) fromTokens.push(m[1].toUpperCase())
  }
  const arr = /const ROUTE_COLORS = \[([^\]]+)\]/.exec(fabuSrc)
  if (!arr) return ['fabu 的 ROUTE_COLORS 找不到了']
  const fromJs = [...arr[1].matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1].toUpperCase())
  const bad = []
  fromTokens.forEach((c, i) => {
    if (fromJs[i] && fromJs[i] !== c) bad.push(`route[${i}] tokens=${c} 但 fabu JS=${fromJs[i]}`)
  })
  return bad
}

test('§0.3 路线色板的 tokens 与 fabu JS 两份真源必须同步', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8')
  const fabu = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.js'), 'utf8')
  assert.deepEqual(findRouteColorDrift(tokens, fabu), [],
    '<map> 颜色只能在 JS 设,这份字面量是必要的;但它和 tokens 漂开就会两套配色')
})

// 原生组件的 color/active-color 属性只吃字面量、不认 CSS var —— 这是 wxss 扫描的
// 另一个结构性盲区(<switch color=> / <radio color=> / <checkbox color=> /
// swiper 的 indicator-active-color 都是)。这里只禁**带色相**的值:中性灰阶
// (#fff / #111111 这种)本来就没法用 token 表达,禁了没意义;真正会漂的是彩色。
// decor 的营业开关是唯一合法彩色例外(浅色页必须手动传浅端绿),由
// activity-switch-selection-contract 单独盯着它和 tokens 同步。
function findAttrColorViolations(files) {
  const bad = []
  for (const { file, src } of files) {
    for (const m of src.matchAll(/\b(?:color|active-color|indicator-active-color|selected-color)="(#[0-9A-Fa-f]{3,8})"/g)) {
      let hex = m[1].slice(1)
      if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
      const mx = Math.max(r, g, b); const mn = Math.min(r, g, b)
      if (mx - mn <= 12) continue // 中性灰阶，放行
      if (/merchant\/decor/.test(file)) continue // 已有专门契约盯着
      // 2026-09-04:同一行标了 ds-ok 的固有色放行 —— wxss 那条早就认 ds-ok,
      // 本条(原生组件属性)一直不认,于是「刮刮卡涂层色」这种物件固有色没有出路。
      // 病例:playkit-dailysign 的 cover-color="#D8D2C4" 是要被刮掉的那层涂层,
      // 不是主题色,跟着 token 变反而是错的。色差 20 刚过中性阈值 12,被误判。
      // ⚠️ wxml 里注释不能插在未闭合标签中间(那是非法结构),所以 ds-ok 只能写在
      //    属性行**上方**。这里连同前一行一起看,别只看命中所在行。
      const srcLines = src.split('\n')
      const hitIdx = srcLines.findIndex((l) => l.includes(m[0]))
      const scope = [srcLines[hitIdx - 1] || '', srcLines[hitIdx] || ''].join(' ')
      if (scope.includes('ds-ok')) continue
      bad.push(`${file}: ${m[1]}`)
    }
  }
  return bad
}

test('§0.3 原生组件属性传色不许带色相(中性灰阶除外)', () => {
  const files = pageFiles('.wxml').map((f) => ({ file: rel(f), src: fs.readFileSync(f, 'utf8') }))
  assert.deepEqual(findAttrColorViolations(files), [],
    '原生组件 color 属性吃不到 CSS var,写死彩色必然和 token 漂开')
})

// WebGL 的 clearColor 是**归一化浮点数**(0-1),连 hex 扫描都搜不到 —— 本轮挖到的
// 最深一层盲区:badge-wall 的 wxss 和 json 都改了,画面主色仍是旧值,因为整屏是
// canvas 画的。它必须和 --cy-color-bg-page 对齐。
function findClearColorDrift(tokensSrc, engineSrc) {
  const m = /--cy-color-bg-page:\s*(#[0-9A-Fa-f]{6})\s*;/.exec(tokensSrc)
  if (!m) return ['tokens 里取不到 --cy-color-bg-page']
  const want = [1, 3, 5].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  const c = /gl\.clearColor\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(engineSrc)
  if (!c) return ['engine.js 里找不到 gl.clearColor']
  const got = [1, 2, 3].map((i) => Math.round(parseFloat(c[i]) * 255))
  const drift = got.some((v, i) => Math.abs(v - want[i]) > 1)
  return drift ? [`clearColor=(${got}) 但 --cy-color-bg-page=${m[1]}=(${want})`] : []
}

test('§1.2 badge-wall 的 WebGL clearColor 必须跟页面底色一致', () => {
  const tokens = fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8')
  const engine = fs.readFileSync(path.join(ROOT, 'subpackageP3/pages/badge-wall/index/engine.js'), 'utf8')
  assert.deepEqual(findClearColorDrift(tokens, engine), [],
    'clearColor 是归一化浮点数、hex 扫描搜不到;整屏 canvas 时它就是画面主色')
})

// cy-tabs 的 variant(布局形态)和 wide(选中条宽度)是**正交**的两件事。
// 2026-08-05 之前 wide 只能写进 variant 字符串，于是「横滑等宽布局 + 全宽选中条」
// 这个组合无法表达 —— topic 页迁移时正是卡在这里(worker 没硬塞，指认了缺口)。
// 拆成独立属性后，三个布局分支都必须能挂上 wide，否则又退回单值。
function findTabsWideSupport(wxmlSrc, jsSrc) {
  const bad = []
  if (!/wide:\s*\{\s*type:\s*Boolean/.test(jsSrc)) bad.push('cy-tabs 缺少独立的 wide 布尔属性')
  const branches = wxmlSrc.split('\n').filter((l) => /class="cy-tabs\b/.test(l))
  if (branches.length < 3) bad.push(`cy-tabs 布局分支只找到 ${branches.length} 个`)
  branches.forEach((l, i) => {
    if (!/cy-tabs--wide/.test(l)) bad.push(`第 ${i + 1} 个布局分支没挂 wide`)
  })
  return bad
}

test('§9 cy-tabs 的 variant 与 wide 保持正交', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/tabs/index.wxml'), 'utf8')
  const js = fs.readFileSync(path.join(ROOT, 'components/cy/tabs/index.js'), 'utf8')
  assert.deepEqual(findTabsWideSupport(wxml, js), [],
    'variant 管布局、wide 管选中条宽度,两者必须能同时表达')
})

// §9 tab 一律走 cy-tabs。2026-08-05 收敛完成:全仓手写 tab 清零(最后一处是
// topic/pricing 的 .pg-tabs)。判据是「带 tap 的 tab 容器里必须有 cy-tabs」——
// ⚠️ 检测必须跨行:属性分行写时 grep -A2 看不到组件标签，我用那种判法误报过
// gc-tabs / id-tabs 两处(它们其实早就在用组件了)。
function findHandwrittenTabs(files) {
  const bad = []
  for (const { file, src } of files) {
    for (const m of src.matchAll(/<view class="([a-z0-9-]*tabs?)"[^>]*>([\s\S]{0,400}?)<\/view>/g)) {
      const [, cls, body] = m
      if (/cy-tabs/.test(body)) continue      // 外层包裹壳，里面是组件
      if (/tabcont/.test(cls)) continue        // tab 的内容面板，不是 tab 条
      if (!/bindtap|catchtap/.test(body)) continue // 没有点击行为 = 布局壳
      bad.push(`${file}: .${cls}`)
    }
  }
  return bad
}

test('§9 tab 一律走 cy-tabs,不许手写', () => {
  const files = pageFiles('.wxml').map((f) => ({ file: rel(f), src: fs.readFileSync(f, 'utf8') }))
  assert.deepEqual(findHandwrittenTabs(files), [],
    '手写 tab 各写各的吸顶/横滑/选中态,收敛后不许再冒出来')
})

// ── 棘轮类:锁住存量,只能减不能增 ──
// 啃掉一批就把这里的数字调低(调低是正常维护,调高必须在 PR 里说明理由)。
const RATCHET = {
  borderAndFill: 59,   // 2026-08-05 基线
  hardcodedColor: 282, // 2026-08-05:302→290(square/list 去暖色)→284(square/detail + badge-wall)→282(卡片迁移副产物)
}

test('§2.2/§5 描边+填充并存的存量只能减不能增', () => {
  const n = pageFiles('.wxss').reduce((a, f) => a + findBorderAndFill(fs.readFileSync(f, 'utf8')).length, 0)
  assert.ok(n <= RATCHET.borderAndFill,
    `描边+填充并存 ${n} 处,超过基线 ${RATCHET.borderAndFill} —— 新代码不许再这么写(规范真源 §2.2/§5)`)
  if (n < RATCHET.borderAndFill) {
    console.log(`  ↓ 描边+填充并存已降到 ${n}(基线 ${RATCHET.borderAndFill}),记得把 RATCHET 调低锁住成果`)
  }
})

test('§0.3 硬编码颜色的存量只能减不能增', () => {
  const n = pageFiles('.wxss').reduce((a, f) => a + findHardcodedColors(fs.readFileSync(f, 'utf8')).length, 0)
  assert.ok(n <= RATCHET.hardcodedColor,
    `硬编码颜色 ${n} 处,超过基线 ${RATCHET.hardcodedColor} —— 颜色走 token,真例外标 ds-ok 并写明理由`)
  if (n < RATCHET.hardcodedColor) {
    console.log(`  ↓ 硬编码颜色已降到 ${n}(基线 ${RATCHET.hardcodedColor}),记得把 RATCHET 调低锁住成果`)
  }
})

// ── 负控:证明上面每条都能变红,而不是恒真的橡皮图章 ──

test('negative control:每条规则注入违规都必须判红', () => {
  assert.equal(findAccent('<cy-btn variant="accent">买</cy-btn>').length, 1, 'accent 检测失效')
  assert.equal(findAccent('<cy-btn variant="primary">买</cy-btn>').length, 0, 'accent 检测误报')

  assert.equal(findRawSwitch('<switch checked="{{a}}" />').length, 1, '原生 switch 检测失效')
  assert.equal(findRawSwitch('<cy-switch checked="{{a}}" />').length, 0, 'cy-switch 被误判成原生')

  // 改回去紫相之前的值必须红;当前中性值必须绿
  assert.equal(findSaturatedGrays('--cy-color-bg-elevated: #18151F;').length, 1, '饱和灰检测失效')
  assert.equal(findSaturatedGrays('--cy-color-bg-elevated: #1C1C1E;').length, 0, '中性灰被误判')

  assert.equal(findBorderAndFill('.foo-btn { background: #fff; border: 1rpx solid #000; }').length, 1, '描边+填充检测失效')
  assert.equal(findBorderAndFill('.foo-btn { background: #fff; }').length, 0, '纯填充被误判')
  // transparent 底 + 描边是「描边式按钮」，本规则不重复报（它由存量清理覆盖）
  assert.equal(findBorderAndFill('.foo-btn { background: transparent; border: 1rpx solid #000; }').length, 0,
    'transparent 底不该被本规则捕获')

  assert.equal(findHardcodedColors('  color: #ff0000;').length, 1, '硬编码颜色检测失效')
  assert.equal(findHardcodedColors('  color: var(--cy-color-text-primary);').length, 0, 'token 写法被误判')
  assert.equal(findHardcodedColors('  color: #ff0000; /* ds-ok 品牌插画固有色 */').length, 0, 'ds-ok 豁免失效')

  assert.equal(findTagColorViolations('.tag--blue { color: var(--cy-accent); }').length, 1, '借品牌色检测失效')
  assert.equal(findTagColorViolations('.tag--blue { background: rgba(0,82,244,0.18); }').length, 1, '硬编码 rgba 检测失效')
  assert.equal(findTagColorViolations('.tag--blue { border: 1rpx solid #000; }').length, 1, 'tag 描边检测失效')
  assert.equal(findTagColorViolations('.tag--blue { color: var(--cy-color-status-info); background: var(--cy-color-status-info-soft); }').length, 0,
    '合规写法被误判')

  assert.equal(findCardBorder('.cy-card { border: 1rpx solid #000; }').length, 1, 'card 描边检测失效')
  assert.equal(findCardBorder('.cy-card { box-shadow: inset 0 1rpx 0 0 #fff; }').length, 0, 'inset 起层被误判成描边')
  assert.equal(findCardBorder('.cy-card--flat { border: none; }').length, 0, 'border:none 被误判')

  const fakeTokens = '--cy-color-bg-page: #000000;\n--cy-color-bg-elevated: #1C1C1E;'
  assert.equal(findStaleJsonColors(fakeTokens, [{ file: 'x.json', src: '"backgroundColor": "#020104"' }]).length, 1,
    '旧 json 色检测失效')
  assert.equal(findStaleJsonColors(fakeTokens, [{ file: 'x.json', src: '"backgroundColor": "#000000"' }]).length, 0,
    '同步过的 json 色被误判')
  assert.equal(findStaleJsonColors(fakeTokens, [{ file: 'x.json', src: '"backgroundColor": "#ffffff"' }]).length, 0,
    '纯白豁免失效')

  const tk = '--cy-route:    #1A1A1A;\n--cy-route-2:  #155DFC;'
  assert.equal(findRouteColorDrift(tk, "const ROUTE_COLORS = ['#1A1A1A', '#155DFC'];").length, 0, '同步的色板被误判')
  assert.equal(findRouteColorDrift(tk, "const ROUTE_COLORS = ['#7A5CFF', '#155DFC'];").length, 1, '色板漂移检测失效')

  assert.equal(findAttrColorViolations([{ file: 'x.wxml', src: '<radio color="#7A5CFF" />' }]).length, 1, '属性彩色检测失效')
  assert.equal(findAttrColorViolations([{ file: 'x.wxml', src: '<radio color="#111111" />' }]).length, 0, '中性灰被误判')
  assert.equal(findAttrColorViolations([{ file: 'x.wxml', src: '<swiper indicator-active-color="#fff" />' }]).length, 0, '#fff 缩写被误判')
  assert.equal(findAttrColorViolations([{ file: 'pages/merchant/decor/index.wxml', src: '<cy-switch color="#0B7A57" />' }]).length, 0,
    'decor 例外失效')

  const tkBlack = '--cy-color-bg-page:           #000000;'
  assert.equal(findClearColorDrift(tkBlack, 'gl.clearColor(0, 0, 0, 1);').length, 0, '对齐的 clearColor 被误判')
  assert.equal(findClearColorDrift(tkBlack, 'gl.clearColor(0.0196, 0.0196, 0.0235, 1);').length, 1, 'clearColor 漂移检测失效')

  const okWxml = ['<view class="cy-tabs cy-tabs--chip {{wide ? \'cy-tabs--wide\' : \'\'}}">',
    '<view class="cy-tabs cy-tabs--fill {{wide ? \'cy-tabs--wide\' : \'\'}}">',
    '<view class="cy-tabs {{wide ? \'cy-tabs--wide\' : \'\'}}">'].join('\n')
  const okJs = 'wide: { type: Boolean, value: false },'
  assert.equal(findTabsWideSupport(okWxml, okJs).length, 0, '合规的 tabs 实现被误判')
  assert.ok(findTabsWideSupport(okWxml, 'variant: { type: String },').length >= 1, '缺 wide 属性检测失效')
  assert.ok(findTabsWideSupport('<view class="cy-tabs cy-tabs--chip">', okJs).length >= 1, '分支没挂 wide 检测失效')

  assert.equal(findHandwrittenTabs([{ file: 'x.wxml', src: '<view class="pg-tabs"><view bindtap="t">A</view></view>' }]).length, 1,
    '手写 tab 检测失效')
  assert.equal(findHandwrittenTabs([{ file: 'x.wxml', src: '<view class="td-tabs">\n<cy-tabs\n  tabs="{{t}}" />\n</view>' }]).length, 0,
    '跨行写的组件被误判成手写(这个坑我踩过)')
  assert.equal(findHandwrittenTabs([{ file: 'x.wxml', src: '<view class="tablist"><view>内容</view></view>' }]).length, 0,
    '没有 tap 的布局壳被误判')
})
