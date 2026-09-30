/* CU-M-27:「我的」页区块头右侧动作链(「管理全部 →」「查看详情 →」)压在固定封面上的可读性。
 *
 * 为什么要有这条:本页封面是 `position: fixed` 的(.pc-hero-bg),向下滚动时每个分节都会
 * 穿过这条封面带 —— 不是「首屏那几行」要保证对比度,是整页的文字都要过这一关。
 * 09-24 那轮把商家首屏白纱抬到 .52~.60,只保证深色**主文字**在最暗照片上 ≥4.5:1;
 * 动作链当时还读 --cy-color-text-secondary(#404040),同一合成点只有 2.55:1。
 *
 * 算法不靠肉眼:从 wxss 里读纱色与最小 alpha,压在最坏底(纯黑照片)上,再解析该域真 token,
 * 逐档算 WCAG 比值。撤掉修复(把 .pc-merchant 那条删掉/改回 secondary)本条必红。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PROFILE_WXSS = fs.readFileSync(path.join(ROOT, 'components/cy/profile/index.wxss'), 'utf8')
const TOKENS = fs.readFileSync(path.join(ROOT, 'style/tokens.wxss'), 'utf8')

const CODE = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const AA = 4.5

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

function blockVars(text, pattern) {
  const match = text.match(pattern)
  if (!match) return null
  const vars = {}
  for (const m of match[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) vars[m[1]] = m[2].trim()
  return vars
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

/** 商家日间 token 真源(基础暗色 page{} + .theme-merchant 覆盖) */
function merchantVars() {
  const base = blockVars(CODE(TOKENS), /^page\s*\{([\s\S]*?)^\}/m)
  const day = blockVars(CODE(TOKENS), /^\.theme-merchant\s*\{([\s\S]*?)^\}/m)
  assert.ok(base && day, '必须同时解析到 page{} 与 .theme-merchant 两套 token')
  return Object.assign({}, base, day)
}

/** 从 .pc-merchant .pc-page-fade 的渐变里取**最薄**那一档白纱,压在最坏底(纯黑照片)上 */
function worstCaseHeroBackdrop() {
  const rule = /\.pc-merchant\s+\.pc-page-fade\s*\{([^}]*)\}/.exec(CODE(PROFILE_WXSS))
  assert.ok(rule, '商家态封面白纱(.pc-merchant .pc-page-fade)必须存在 —— 封面上的可读性全靠它')
  const stops = [...rule[1].matchAll(/rgba?\(([^)]+)\)/g)].map((m) => parseColor('rgba(' + m[1] + ')'))
  assert.ok(stops.length > 3, '白纱渐变至少要有多档 stop')
  const thinnest = stops.reduce((a, b) => (b[3] < a[3] ? b : a))
  return flatten(thinnest, [0, 0, 0])
}

function linkColorToken(selectorRe) {
  const rule = selectorRe.exec(CODE(PROFILE_WXSS))
  assert.ok(rule, '没找到区块头动作链的样式规则')
  const color = /color:\s*([^;]+)/.exec(rule[1])
  assert.ok(color, '动作链规则必须显式声明 color')
  return color[1].trim()
}

test('CU-M-27:商家态动作链在白纱压最暗照片上仍达 AA', () => {
  const vars = merchantVars()
  const backdrop = worstCaseHeroBackdrop()
  const fg = parseColor(resolve(linkColorToken(/\.pc-merchant\s+\.pc-sec-link\s*\{([^}]*)\}/), vars))
  assert.ok(fg, '动作链颜色必须解析到可计算的字面值')
  const ratio = contrast(fg, backdrop)
  assert.ok(ratio >= AA, `商家态「管理全部 →」压在深色封面上只有 ${ratio.toFixed(2)}:1,需 ≥${AA}:1`)
})

test('CU-M-27:负控 —— 修复前的 secondary 档在同一底上不达标', () => {
  const vars = merchantVars()
  const backdrop = worstCaseHeroBackdrop()
  const stale = parseColor(resolve(vars['--cy-color-text-secondary'], vars))
  const ratio = contrast(stale, backdrop)
  assert.ok(ratio < AA, `secondary 档在封面最坏底上竟达 ${ratio.toFixed(2)}:1 —— 本条负控的前提没了,需重新判定`)
})

test('CU-M-27:动作链颜色只走 token,不落字面色值', () => {
  for (const re of [/\.pc-sec-link\s*\{([^}]*)\}/, /\.pc-merchant\s+\.pc-sec-link\s*\{([^}]*)\}/]) {
    const value = linkColorToken(re)
    assert.match(value, /^var\(--cy-color-text-[a-z]+\)$/, `动作链颜色必须引用文字语义 token,实际是 ${value}`)
  }
})

test('CU-M-27:域作用域 —— 覆盖只挂在商家态根节点上,玩家暗色域不跟着变白字', () => {
  const code = CODE(PROFILE_WXSS)
  const merchantRules = [...code.matchAll(/\.pc-merchant\s+\.pc-sec-link/g)]
  assert.equal(merchantRules.length, 1, '商家态动作链覆盖只能有一处')
  const base = /\.pc-sec-link\s*\{([^}]*)\}/.exec(code)
  assert.match(base[1], /color:\s*var\(--cy-color-text-secondary\)/, '基础档保持 secondary,层级差靠字号承担')
})
