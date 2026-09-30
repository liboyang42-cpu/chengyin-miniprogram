/* 语义 token 对比度矩阵契约(2026-08-25)
 *
 * 仓里已有的 cy-state-visual-contrast-contract 只锁 cy-empty / cy-error 两个组件。
 * 这条把闸提到 **token 层**:凡是「正文类文字 token」× 「表面 token」的组合,在两套
 * 业务域主题下都必须过 WCAG AA 4.5:1 —— 一个组合不达标,所有用它的页面就都不达标,
 * 逐页去查是查不完的。
 *
 * ⚠️ 必须做 alpha 合成。`--cy-bg-subtle` 在暗色域是 `rgba(255,255,255,0.04)`,
 *    当成不透明白来算会得出「文字与底色 1.06:1」这种荒谬结论(实测踩过)。
 *
 * 不入矩阵的:
 *   · --cy-color-text-disabled:WCAG 明确豁免 disabled 控件,压低对比正是它的语义
 *   · 品牌/状态色:它们的用法是图标与强调块,不按正文正文对比度判
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const TOKENS = fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** 正文类文字 token —— 会承载可读正文,必须 4.5:1 */
const TEXT_TOKENS = [
  '--cy-color-text-primary',
  '--cy-color-text-secondary',
  '--cy-color-text-tertiary',
  '--cy-text-placeholder',
]
/** 这些文字可能落在的表面 */
const SURFACE_TOKENS = ['--cy-color-bg-page', '--cy-color-bg-card', '--cy-bg-subtle']
const AA = 4.5

test('下拉按压文字在两套主题及独立 portal 中均有颜色且达到 AA', () => {
  const source = fs.readFileSync(path.join(ROOT, 'components/cy/dropdown/index.wxss'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const body = (selector) => source.slice(source.indexOf(selector + ' {')).split('}')[0]
  const vars = (text) => Object.fromEntries([...text.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)].map(m => [m[1], m[2].trim()]))
  const portalDark = vars(body('.cdd__layer--portal'))
  const cases = { ...themes(), portalDark, portalLight: { ...portalDark, ...vars(body('.cdd__layer.theme-merchant')) } }
  const pressed = body('.cdd__item--press')
  const rawFg = pressed.match(/\bcolor:\s*([^;]+);/)[1]
  const rawBg = pressed.match(/\bbackground:\s*([^;]+);/)[1]
  for (const [name, tokens] of Object.entries(cases)) {
    const fg = parseColor(resolve(rawFg, tokens))
    const bg = parseColor(resolve(rawBg, tokens))
    assert.ok(fg && bg, `${name}: 按压颜色不得依赖 portal 外的变量`)
    const surface = parseColor(resolve(tokens['--cy-color-bg-elevated'], tokens))
    const backdrop = flatten(bg, surface)
    assert.ok(contrast(flatten(fg, backdrop), backdrop) >= AA, `${name}: 下拉按压文字对比度不足`)
  }
})

function blockVars(pattern) {
  const match = TOKENS.match(pattern)
  if (!match) return null
  const vars = {}
  for (const m of match[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) vars[m[1]] = m[2].trim()
  return vars
}

function themes() {
  const dark = blockVars(/^page\s*\{([\s\S]*?)^\}/m)
  const lightOverride = blockVars(/^page\.theme-light[^{]*\{([\s\S]*?)^\}/m)
  assert.ok(dark && lightOverride, '必须同时解析到玩家暗色与商家浅色两套 token')
  return { 玩家暗色: dark, 商家浅色: Object.assign({}, dark, lightOverride) }
}

function resolve(value, vars, depth = 0) {
  let current = String(value).trim()
  while (depth < 8) {
    const m = /^var\((--[a-z0-9-]+)(?:,\s*([^)]+))?\)$/.exec(current)
    if (!m) break
    current = (vars[m[1]] !== undefined ? vars[m[1]] : (m[2] || '')).trim()
    depth += 1
  }
  return current
}

/** 返回 [r,g,b,a];认 #rgb / #rrggbb / rgb() / rgba() */
function parseColor(value) {
  const text = String(value).trim()
  const hex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(text)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1]
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(text)
  if (fn) {
    const parts = fn[1].split(',').map((x) => x.trim())
    if (parts.length < 3) return null
    return [Number(parts[0]), Number(parts[1]), Number(parts[2]), parts.length > 3 ? Number(parts[3]) : 1]
  }
  return null
}

/** 半透明色压到底色上 —— 不做这一步会算出荒谬的比值 */
function flatten(color, base) {
  const [r, g, b, a] = color
  if (a >= 1) return [r, g, b]
  return [r, g, b].map((c, i) => Math.round(c * a + base[i] * (1 - a)))
}

function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function matrix(vars, overrides = {}) {
  const all = Object.assign({}, vars, overrides)
  const pageColor = parseColor(resolve(all['--cy-color-bg-page'], all))
  assert.ok(pageColor, '页面底色必须可解析')
  const page = flatten(pageColor, [0, 0, 0])
  const rows = []
  for (const textToken of TEXT_TOKENS) {
    if (all[textToken] === undefined) continue
    const rawText = parseColor(resolve(all[textToken], all))
    if (!rawText) continue
    for (const surfaceToken of SURFACE_TOKENS) {
      if (all[surfaceToken] === undefined) continue
      const rawSurface = parseColor(resolve(all[surfaceToken], all))
      if (!rawSurface) continue
      const surface = flatten(rawSurface, page)
      const text = flatten(rawText, surface)
      rows.push({ textToken, surfaceToken, ratio: contrast(text, surface) })
    }
  }
  return rows
}

test('两套业务域主题下，正文类文字 × 表面 的每个组合都过 AA 4.5:1', () => {
  for (const [themeName, vars] of Object.entries(themes())) {
    const rows = matrix(vars)
    assert.ok(rows.length >= 8, `${themeName} 的组合数异常，矩阵没铺开`)
    const failed = rows
      .filter((row) => row.ratio < AA)
      .map((row) => `${themeName} ${row.textToken} on ${row.surfaceToken} = ${row.ratio.toFixed(2)}`)
    assert.deepEqual(failed, [], '这些 token 组合不达标，用到它们的页面全都不达标')
  }
})

test('半透明表面必须做 alpha 合成，否则会算出荒谬比值', () => {
  // --cy-bg-subtle 在暗色域是 rgba(255,255,255,0.04):当成不透明白算，
  // 会得出「主文字与底色 1.06:1」这种不可能的结论。
  const dark = themes()['玩家暗色']
  const subtle = parseColor(resolve(dark['--cy-bg-subtle'], dark))
  assert.ok(subtle, '--cy-bg-subtle 必须可解析')
  assert.ok(subtle[3] < 1, '这条断言的前提是它确实半透明；若改成不透明请同步删除本用例')

  const naive = contrast(
    flatten(parseColor(resolve(dark['--cy-color-text-primary'], dark)), [0, 0, 0]),
    subtle.slice(0, 3),
  )
  const composed = matrix(dark).find((r) => r.textToken === '--cy-color-text-primary' && r.surfaceToken === '--cy-bg-subtle')
  assert.ok(naive < 2, '不做合成时确实会算出荒谬的低比值（这正是要防的）')
  assert.ok(composed.ratio > 10, '做了合成后主文字在微亮底上应当是高对比')
})

test('负控：把任一文字 token 调淡到不达标必须判红', () => {
  const light = themes()['商家浅色']
  const rows = matrix(light, { '--cy-color-text-tertiary': '#B9B9B9' })
  const failed = rows.filter((r) => r.textToken === '--cy-color-text-tertiary' && r.ratio < AA)
  assert.ok(failed.length > 0, '调淡后必须落到不达标名单里')
})

test('负控：把表面调到贴近文字色必须判红', () => {
  const dark = themes()['玩家暗色']
  const rows = matrix(dark, { '--cy-color-bg-card': '#B0B0B0' })
  const failed = rows.filter((r) => r.surfaceToken === '--cy-color-bg-card' && r.ratio < AA)
  assert.ok(failed.length > 0, '底色贴近文字色时必须被抓')
})

test('disabled 不进矩阵：压低对比正是它的语义（WCAG 明确豁免）', () => {
  assert.ok(!TEXT_TOKENS.includes('--cy-color-text-disabled'),
    'disabled 若被拉进矩阵，会逼着把它调深，反而丢掉「不可用」的视觉表达')
})
