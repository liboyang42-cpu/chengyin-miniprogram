/* 弹层顶部安全区契约(2026-09-02)
 *
 * 弹层面板的顶边**不许越过微信右上角胶囊**。这条本仓踩过两次:
 *   · components/cy/sheet 里那条 70vh 的注释白纸黑字记着「原来 86vh 几乎贴着胶囊按钮」;
 *   · 后来加 variant="full" 时又写了 96vh,比 86 更狠。
 *
 * 根因不是「值选大了」,是**写死 vh 与安全区无关**:安全区随机型变
 * (刘海 47pt / 灵动岛 59pt / 无刘海 20pt),同一个 vh 落到不同位置。实测:
 *     92vh  iPhone 14 顶 67.5pt vs 胶囊底 91pt · 14 Pro 68.2 vs 103 · SE 53.4 vs 64  —— 三台全压
 *     88vh  iPhone 14 ok  ·  14 Pro 102.2 vs 103  —— 仍压
 * 所以换一个更小的 vh 治不了本,必须**从安全区反算**:
 *     --cy-comp-sheet-max-height = calc(100vh - var(--cy-safe-top) - var(--cy-comp-sheet-top-gap))
 * 其中 --cy-safe-top = env(safe-area-inset-top) + 88rpx = 胶囊行底边,再减 8px 视觉余量。
 *
 * 判据是**白名单式**的:浮层组件里凡是限制面板高度的声明,只认引用该 token 的写法;
 * 写字面 vh 一律判红(≤70vh 的浅档除外,它离胶囊还有 30vh 富余,是设计上的独立档位)。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/* 浮层组件:面板是盖在页面之上的,顶边会撞胶囊。
 * 整页组件(profile/starfield/empty/error)不在此列 —— 它们的 100vh 是页面高度,在顶栏之下滚动。 */
const OVERLAY_WXSS = [
  'components/cy/sheet/index.wxss',
  'components/cy/scene-sheet/index.wxss',
  'pages/play/components/advanced-game/index.wxss',
  'components/cy/modal/index.wxss',
]

const SAFE = '--cy-comp-sheet-max-height'
/* 低于这个档的字面 vh 不判罚:70vh 顶边在 30vh 处,离胶囊还有很大富余,
 * 是「T1 底部弹窗」的独立设计档位,不是想全屏没写对。 */
const SAFE_VH_CEILING = 70

/** 找出限制面板高度、却写了超过安全档字面 vh 的声明 */
function findUnsafeHeights(files) {
  const bad = []
  for (const [rel, src] of files) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')   // 注释里会引用 96vh 讲教训,先剥掉
    for (const m of code.matchAll(/(^|[;{]|\s)(max-height|height)\s*:\s*([^;}]+)/g)) {
      const prop = m[2]
      const value = m[3].trim()
      if (value.includes(SAFE)) continue                // 引用安全 token,放行
      for (const v of value.matchAll(/(\d+(?:\.\d+)?)vh/g)) {
        if (Number(v[1]) > SAFE_VH_CEILING) bad.push(`${rel}: ${prop}: ${value}`)
      }
    }
  }
  return bad
}

/** 找出用绝对像素钉死面板高度的声明 —— 那是从画板量出来的死数,小屏大屏占比天差地别 */
function findAbsolutePanelHeights(files) {
  const bad = []
  for (const [rel, src] of files) {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of code.matchAll(/(^|[;{]|\s)(max-height|height)\s*:\s*(\d+(?:\.\d+)?)px\s*[;}]/g)) {
      bad.push(`${rel}: ${m[2]}: ${m[3]}px`)
    }
  }
  return bad
}

const overlayFiles = () => OVERLAY_WXSS
  .filter((p) => fs.existsSync(path.join(ROOT, p)))
  .map((p) => [p, read(p)])

test('① 安全上限从安全区反算,不是写死的 vh', () => {
  const tokens = read('style/tokens.wxss')
  const m = new RegExp(`${SAFE}:\\s*([^;]+);`).exec(tokens)
  assert.ok(m, `tokens.wxss 必须定义 ${SAFE}`)
  const expr = m[1]
  assert.match(expr, /100vh/, '上限应从满屏减起')
  assert.match(expr, /var\(--cy-safe-top\)/,
    '必须减 --cy-safe-top(= env(safe-area-inset-top) + 88rpx = 胶囊行底边)—— 只有它随机型变')
  assert.match(expr, /var\(--cy-comp-sheet-top-gap\)/, '必须再减视觉余量 token')
  assert.match(tokens, /--cy-comp-sheet-top-gap:\s*16rpx;/,
    '视觉余量 8px = 16rpx(2026-09-02 用户定);要改先跟用户确认')
})

test('② 浮层组件里没有超过 70vh 的字面高度', () => {
  const bad = findUnsafeHeights(overlayFiles())
  assert.deepEqual(bad, [],
    `这些声明写死了 vh,会在某些机型上盖过微信胶囊 —— 改用 var(${SAFE}):\n${bad.join('\n')}`)
})

test('③ 浮层面板不许用绝对像素钉死高度', () => {
  const bad = findAbsolutePanelHeights(overlayFiles())
  assert.deepEqual(bad, [],
    `这些是从 Figma 画板量出来的死数(如 579.135px:小屏占 87%、大屏只占 62%,等于没有约束):\n${bad.join('\n')}`)
})

test('④ 三个曾经打架的口径都已收编到同一个 token', () => {
  assert.match(read('components/cy/sheet/index.wxss'),
    new RegExp(`\\.sh--full \\.sh__panel \\{[\\s\\S]*?height:\\s*var\\(${SAFE}\\)`),
    'cy-sheet 的 full 变体(原 96vh)必须走安全上限')
  const scene = read('components/cy/scene-sheet/index.wxss')
  assert.match(scene, new RegExp(`\\.ss__panel \\{[\\s\\S]*?max-height:\\s*var\\(${SAFE}\\)`),
    'scene-sheet 面板通用上限(原 100vh)必须走安全上限')
  assert.match(read('style/tokens.wxss'),
    new RegExp(`--cy-comp-sheet-full-height:\\s*var\\(${SAFE}\\)`),
    'scene-sheet 的 full 档(原写死 579.135px)必须走安全上限')
})

/* ---------- 负控:三条闸各自都要能变红 ---------- */

test('负控:浮层里写回 96vh 必须判红', () => {
  const real = overlayFiles()
  assert.deepEqual(findUnsafeHeights(real), [], '干净输入不该报')
  const mutated = real.map(([p, s]) => p.endsWith('sheet/index.wxss')
    ? [p, s.replace(`height: var(${SAFE});`, 'height: 96vh;')] : [p, s])
  assert.notEqual(JSON.stringify(mutated), JSON.stringify(real), '负控变异注入失败')
  const bad = findUnsafeHeights(mutated)
  assert.ok(bad.length > 0 && bad.some((b) => b.includes('96vh')), `没抓到注入的 96vh:${bad.join()}`)
})

test('负控:70vh 的 T1 档不该被误伤', () => {
  assert.deepEqual(findUnsafeHeights([['x.wxss', '.a { max-height: 70vh; }']]), [],
    'T1 的 70vh 是独立设计档位,离胶囊还有 30vh 富余,不该判罚')
  assert.deepEqual(findUnsafeHeights([['x.wxss', '.a { max-height: 71vh; }']]).length, 1,
    '刚过档就该报 —— 证明阈值真的在起作用,不是恒不报')
})

test('负控:写回画板量出来的绝对像素必须判红', () => {
  assert.deepEqual(findAbsolutePanelHeights([['x.wxss', '.a { height: 579.135px; }']]),
    ['x.wxss: height: 579.135px'])
  assert.deepEqual(findAbsolutePanelHeights([['x.wxss', `.a { height: var(${SAFE}); }`]]), [],
    '走 token 的不该被判罚')
})

test('负控:注释里引用 96vh 讲教训不算违规', () => {
  assert.deepEqual(
    findUnsafeHeights([['x.wxss', `/* 原来是 96vh,压胶囊 */\n.a { height: var(${SAFE}); }`]]), [],
    '判据要看代码不看注解 —— 这一条本轮已被撞红四次')
})

/* ---------- ⑤ 覆盖 --cy-comp-sheet-max-h / --cy-psheet-max-h 的地方,减去那一截必须来自胶囊实测 ----------
 *
 * 用户 2026-09-03:「全屏弹窗就是要低于微信胶囊一点点,并不是全屏的。记住这个,或者加到闸里面。」
 * —— 加到闸里。
 *
 * ①–④ 只管 wxss 里的字面 vh。但全屏弹层的高度还有第二条路:调用方在 wxml 内联 / JS 拼串里
 * 覆盖 --cy-comp-sheet-max-h。这条路 ①–④ 完全看不见,而它恰恰是最容易写错的那条:
 * 本仓 2026-09-03 实证,cy-post-compose 第一版在这里自己重写了一套胶囊算法(bottom + 8),
 * 既是第三份重复实现,间距也和全站统一的 5px 对不上。
 *
 * 判据是白名单式的,只认两种写法:
 *   (a) 值引用 --cy-comp-sheet-max-height —— CSS 侧那条从安全区反算的安全上限;
 *   (b) 值是 calc(100vh - <运行时值>px),且该文件(或同名 .js)走 utils/nav-safe-area.js
 *       的 resolveMenuChrome() —— 全站唯一的胶囊几何真源。
 * 其余一律判红:裸 100vh、减一个字面数(从画板量的死数)、自己另算一套胶囊。
 */
const SAFE_H = '--cy-comp-sheet-max-h'
// 2026-09-18 顶边复查:.psheet(proto-sheet)另开了一条宿主通道 --cy-psheet-max-h ——
// 不复用 max-h 是因为 play/roam 页面根一旦设了它,会把页内所有 cy-sheet 底档从 70vh 抬到近全屏。
// 同一条「必须来自胶囊实测」的判据对它同样生效,所以一起纳入扫描。
const SAFE_H_ALT = '--cy-psheet-max-h'
const CHROME_UTIL = 'nav-safe-area'

function collectSheetTopOverrides() {
  const hits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'miniprogram_npm', 'tests', 'scripts', 'docs', '.git'].includes(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!/\.(wxml|js|wxss)$/.test(e.name)) continue
      const src = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const rel = path.relative(ROOT, full)
      for (const m of src.matchAll(new RegExp(`(?:${SAFE_H}|${SAFE_H_ALT})\\s*:\\s*([^;'\\"}]+)`, 'g'))) {
        hits.push({ rel, dir: path.dirname(full), value: m[1].trim() })
      }
    }
  }
  walk(path.join(ROOT, 'components'))
  walk(path.join(ROOT, 'pages'))
  return hits
}

/** 这个覆盖点是不是「从胶囊实测算出来的」 */
function derivesFromCapsule(hit) {
  const v = hit.value
  if (v.includes('--cy-comp-sheet-max-height')) return true   // (a) 走 CSS 安全上限
  // ⚠️ 不能要求 calc(...) 配平右括号:JS 里这值是字符串拼出来的
  //    ('... calc(100vh - ' + top + 'px);'),扫到的片段天然没有右括号。
  //    只判两件事:有没有减法、减的是不是字面数。
  if (!/100vh\s*-/.test(v)) return false                      // 没减法 ⇒ 就是满屏,会压胶囊
  if (/100vh\s*-\s*[\d.]+px/.test(v)) return false            // 减字面数 ⇒ 从画板量的死数
  // (b) 同目录里必须有人**真的调用**共用胶囊工具。
  // ⚠️ 必须先剥注释、且认函数调用而不是模块名:本文件的注释里就写着
  //    「仓库已有 utils/nav-safe-area.js 的 resolveMenuChrome()」——
  //    只查模块名的话,把 require 删掉、注释留着,闸照样绿(2026-09-03 负控实测漏过一次)。
  for (const f of fs.readdirSync(hit.dir)) {
    if (!f.endsWith('.js')) continue
    const js = fs.readFileSync(path.join(hit.dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (js.includes(CHROME_UTIL) && /resolveMenuChrome\s*\(/.test(js)) return true
  }
  return false
}

test('⑤ 覆盖面板上限的地方,减去那一截必须来自胶囊实测', () => {
  const hits = collectSheetTopOverrides()
  assert.ok(hits.length >= 4, `扫描分母异常:只找到 ${hits.length} 处 ${SAFE_H} 覆盖点`)
  const bad = hits.filter((h) => !derivesFromCapsule(h))
    .map((h) => `${h.rel}: ${SAFE_H}: ${h.value}`)
  assert.deepEqual(bad, [],
    '全屏弹层的顶必须低于微信胶囊一点点,不是「满屏」。这些覆盖点既没引用 '
      + `var(--cy-comp-sheet-max-height),也没走 utils/${CHROME_UTIL} 的 resolveMenuChrome():\n`
      + bad.join('\n'))
})

test('负控:⑤ 三种错法都要能红', () => {
  const base = { rel: 'x/index.wxml', dir: path.join(ROOT, 'pages/square/components/cy/post-compose') }
  assert.equal(derivesFromCapsule({ ...base, value: 'var(--cy-comp-sheet-max-height)' }), true, '安全 token 应放行')
  assert.equal(derivesFromCapsule({ ...base, value: 'calc(100vh - {{chrome.sheetTop}}px)' }), true,
    '走共用胶囊工具的运行时值应放行')
  assert.equal(derivesFromCapsule({ ...base, value: '100vh' }), false, '裸 100vh 必须红:那就是满屏,会压住胶囊')
  assert.equal(derivesFromCapsule({ ...base, value: 'calc(100vh - 88px)' }), false,
    '减一个字面数必须红:那是从画板量的死数,不随机型变')
  const noUtil = { rel: 'y/index.wxml', dir: path.join(ROOT, 'pages/square/components/cy/popover') }
  assert.equal(derivesFromCapsule({ ...noUtil, value: 'calc(100vh - {{whatever}}px)' }), false,
    '同目录没人走共用胶囊工具 ⇒ 等于自己另算一套,必须红')
})


/* ⑥ clamp 面板 + 安全区内距 = 必须 border-box(2026-09-19 圆角批,merchantinfo .pop-topic2 实拍实证):
 * content-box 下 max-height 只管内容盒,padding-bottom: env(safe-area-inset-bottom) 那 ~34px
 * 会**加在 clamp 之外**,面板实际顶边比胶囊线高出整段安全区 —— 标题和✕被微信胶囊压住。
 * 判据:凡 max-height/height 引用了 clamp 变量(--cy-comp-sheet-max-h / --cy-psheet-max-h /
 * --cy-comp-sheet-max-height)的 wxss 块,若同块写了含 env( 的 padding,必须同块声明 box-sizing:border-box。 */
const CLAMP_REFS = ['--cy-comp-sheet-max-h', '--cy-psheet-max-h', '--cy-comp-sheet-max-height']

function collectClampPaddingBlocks() {
  const bad = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'miniprogram_npm', 'tests', 'scripts', 'docs', '.git'].includes(e.name)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!e.name.endsWith('.wxss')) continue
      const src = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const rel = path.relative(ROOT, full)
      for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const body = m.group ? m.group(2) : m[2]
        const sel = m[1].trim().split('\n').pop().trim()
        if (!CLAMP_REFS.some((t) => new RegExp(`(max-height|height)\\s*:[^;}]*${t.replace(/-/g, '\\-')}`).test(body))) continue
        const pad = body.match(/padding(-bottom)?\s*:[^;]*env\(/)
        if (!pad) continue
        if (!/box-sizing\s*:\s*border-box/.test(body)) bad.push(`${rel} [${sel}]`)
      }
    }
  }
  for (const d of ['components', 'pages', 'style', 'subpackageP1', 'subpackageP2', 'subpackageP3', 'subpackageRoam', 'subpackageA', 'subpackageMember']) {
    const abs = path.join(ROOT, d)
    if (fs.existsSync(abs)) walk(abs)
  }
  return bad
}

test('⑥ clamp 面板带安全区内距的必须 border-box', () => {
  const bad = collectClampPaddingBlocks()
  assert.deepEqual(bad, [],
    '这些面板把 clamp 写在 content-box 上,padding-bottom(env 安全区)会加在 clamp 之外,顶边越过胶囊线:\n'
      + bad.join('\n'))
})

test('负控:⑥ content-box + env 内距必须红,border-box 与无内距放行', () => {
  const src = (block) => {
    const m = block.match(/([^{}]+)\{([^{}]*)\}/)
    const body = m[2]
    const clamped = CLAMP_REFS.some((t) => new RegExp(`(max-height|height)\\s*:[^;}]*${t.replace(/-/g, '\\-')}`).test(body))
    const padded = /padding(-bottom)?\s*:[^;]*env\(/.test(body)
    return clamped && padded && !/box-sizing\s*:\s*border-box/.test(body)
  }
  assert.equal(src('.a{ max-height: var(--cy-comp-sheet-max-h, var(--cy-comp-sheet-max-height)); padding-bottom: env(safe-area-inset-bottom); }'), true,
    'content-box + clamp + env 内距 = 2026-09-19 实拍炸过的那种,必须红')
  assert.equal(src('.a{ box-sizing: border-box; max-height: var(--cy-comp-sheet-max-h); padding: 0 40rpx calc(56rpx + env(safe-area-inset-bottom)); }'), false,
    'border-box 应放行')
  assert.equal(src('.a{ max-height: var(--cy-comp-sheet-max-h); padding: 0 40rpx; }'), false,
    '内距不含 env(随机量)应放行')
})


/* ═══ ⑦ variant="full" 的顶边必须自己按胶囊实测收进来(CU-M-163,2026-09-25)═══════
 *
 * ①–⑥ 管的是「谁覆盖 --cy-comp-sheet-max-h」,但 full 变体一直没走这条通道:
 * 它只吃 ① 那条从 env(safe-area-inset-top) 反算的 token。而 env() 在模拟器和无刘海真机上
 * 解析为 0 ⇒ 面板顶边落进胶囊行 —— 走查实拍「白色弹层从微信右上角胶囊所在高度开始,
 * 背景板铺到胶囊下方」就是这么来的。
 *
 * 更糟的是它当时躲胶囊的手法:组件自己在 .sh__nav 上写 padding-right:navRight
 * (navRight = 屏宽 - 胶囊左缘 + 12,375 屏约 100px),把 ✕ 往左推一整颗胶囊。
 * 于是右上角关闭停在面板中部偏右,和 bottom 档贴在弹层右缘的 .sh__close 长得不一样 ——
 * 用户 2026-09-24 的统一规则正好点名这条:「关闭 X 放在右上角且各类型一致」。
 *
 * 判据三件,少一件都会以另一种方式复现:
 *   (a) 面板顶来自 resolveMenuChrome() 的胶囊实测值,不是只靠 env() 的 token;
 *   (b) 顶边让开之后,.sh__nav 不许再自造 padding-right 让位 —— ✕ 必须贴弹层右缘;
 *   (c) 实测值只在 full 档生效:bottom 档的 70vh 是 ② 认可的独立档位,不能顺手抬成近全屏。
 */
const SHEET_JS = 'components/cy/sheet/index.js'
const SHEET_WXML = 'components/cy/sheet/index.wxml'
const SHEET_WXSS = 'components/cy/sheet/index.wxss'
const MAX_H_DECL = /--cy-comp-sheet-max-h:\s*calc\(100vh\s*-\s*\$\{[\w.]+\}px/

function assertFullVariantGeometry(overrides = {}) {
  const src = (file) => overrides[file] === undefined ? read(file) : overrides[file]
  const js = src(SHEET_JS)
  const wxml = src(SHEET_WXML)
  const wxss = src(SHEET_WXSS)

  assert.match(js, /resolveMenuChrome\s*\(/,
    `(a) ${SHEET_JS} 必须走 utils/${CHROME_UTIL} 的 resolveMenuChrome() 拿胶囊实测几何`)
  assert.match(js, MAX_H_DECL,
    `(a) full 变体的面板顶必须由胶囊实测值算出 calc(100vh - <实测>px),只留 env() 的 token 在模拟器上会压进胶囊行`)

  assert.doesNotMatch(wxml, /class="sh__nav"[^>]*padding-right/,
    '(b) ✕ 不许再用 padding-right 往左躲胶囊 —— 那会让右上角关闭停在面板中部偏右,和 bottom 档不一致')
  assert.doesNotMatch(wxml, /class="sh__nav"[^>]*padding-top/,
    '(b) 顶边让开以后 .sh__nav 也不再吃状态栏 padding-top,否则整行白往下掉一截')
  assert.match(wxml, /style="\{\{_dragStyle\}\}\{\{variant === 'full' \? fullMaxH : ''\}\}"/,
    '(c) 面板顶只在 full 档下发:bottom 档的 70vh 是独立设计档位,不能被顺手抬成近全屏')
  assert.match(wxss, new RegExp(`\\.sh--full \\.sh__panel \\{[\\s\\S]*?height:\\s*var\\(${SAFE_H},\\s*var\\(${SAFE}\\)\\)`),
    `(c) wxss 必须「实测通道优先、${SAFE} 兜底」,拿不到胶囊信息时仍退回安全区 token`)
}

test('⑦ full 变体:面板顶走胶囊实测,✕ 贴弹层右缘不再往左躲', () => {
  assertFullVariantGeometry()
})

test('负控:⑦ 把 ✕ 改成「往左躲胶囊」的旧手法必须判红', () => {
  const wxml = read(SHEET_WXML)
  const mutated = wxml.replace('<view class="sh__nav" wx:if="{{variant === \'full\'}}">',
    '<view class="sh__nav" wx:if="{{variant === \'full\'}}" style="padding-top:{{navTop}}px;padding-right:{{navRight}}px;">')
  assert.notEqual(mutated, wxml, '负控变异注入失败:.sh__nav 锚点要先同步')
  assert.throws(() => assertFullVariantGeometry({ [SHEET_WXML]: mutated }), /padding-right/)
})

test('负控:⑦ 面板顶退回 env() 算不出来的字面数必须判红', () => {
  const js = read(SHEET_JS)
  const mutated = js.replace(/calc\(100vh - \$\{[\w.]+\}px/, 'calc(100vh - 88px')
  assert.notEqual(mutated, js, '负控变异注入失败:fullMaxH 锚点要先同步')
  assert.throws(() => assertFullVariantGeometry({ [SHEET_JS]: mutated }), /\(a\) full 变体的面板顶/)
})

test('负控:⑦ 顶边通道整条摘掉(退回只吃 token)必须判红', () => {
  const wxss = read(SHEET_WXSS)
  const mutated = wxss.replace(`height: var(${SAFE_H}, var(${SAFE}));`, `height: var(${SAFE});`)
  assert.notEqual(mutated, wxss, '负控变异注入失败:面板高度锚点要先同步')
  assert.throws(() => assertFullVariantGeometry({ [SHEET_WXSS]: mutated }), /\(c\) wxss/)
})
