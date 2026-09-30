const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// 商家资质上传框(pages/merchant/apply)的可点性**只**由那个 + 号传达:
//   .up-box  border: none + background:var(--cy-color-bg-surface)  #FFFFFF
//   .up-row  background:var(--cy-color-bg-surface-subtle)          #F4F4F4
// 两者对比度 1.10:1 —— 边界在视觉上不存在。所以 + 号的对比度就是这个控件的
// 可感知下限,必须达到 WCAG 1.4.11 非文本对比度 3:1。
//
// 2026-08-08 修复前它是字面色 rgba(120,120,128,.7),合成到白底是 #A0A0A6 = 2.60:1,不达标。
//
// ★ 判据是**算出来的对比度**,不是「等于某个 token 名」也不是「等于某个色值字符串」——
//   钉字面量的断言只能证明「这行没被改过」,换个同样不达标的 token 照样绿(见
//   feedback-false-green-test-patterns 第 5 种)。这里把 token 一路解析到十六进制再算。

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const WCAG_NON_TEXT_MIN = 3.0

function relativeLuminance(hex) {
  const h = hex.replace('#', '')
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(a, b) {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// 把 rgba(r,g,b,a) 按 alpha 合成到给定底色,得到实际呈现的十六进制
function compositeOver(rgbaLiteral, backdropHex) {
  const m = rgbaLiteral.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/)
  assert.ok(m, `无法解析 rgba 字面值:${rgbaLiteral}`)
  const alpha = m[4] === undefined ? 1 : Number(m[4])
  const back = backdropHex.replace('#', '')
  const backChannels = [0, 2, 4].map((i) => parseInt(back.slice(i, i + 2), 16))
  const out = [1, 2, 3].map((i) => Math.round(Number(m[i]) * alpha + backChannels[i - 1] * (1 - alpha)))
  return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// 在一份 wxss 里查某个 CSS 变量的定义值,支持 `--a: var(--b)` 的一层层跳转
function resolveToken(name, sources, depth = 0) {
  assert.ok(depth < 8, `token ${name} 解析层数过深,可能有环`)
  for (const src of sources) {
    const re = new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`)
    const hit = src.match(re)
    if (!hit) continue
    const value = hit[1].trim()
    const nested = value.match(/^var\(\s*(--[\w-]+)\s*\)$/)
    if (nested) return resolveToken(nested[1], sources, depth + 1)
    return value
  }
  assert.fail(`token ${name} 在给定主题文件里没有定义`)
}

// 取某个类选择器块里的某条属性值
function declarationOf(wxss, selector, property) {
  const re = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`)
  const block = wxss.match(re)
  assert.ok(block, `${selector} 选择器不存在`)
  const decl = block[1].match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`))
  assert.ok(decl, `${selector} 没有声明 ${property}`)
  return decl[1].trim()
}

test('商家资质上传框的 + 号对比度必须达到 WCAG 非文本 3:1', () => {
  const applyWxss = read('pages/merchant/apply/index.wxss')
  // 商家侧走 theme-merchant → merchant-light.wxss;tokens.wxss 作为兜底真源
  const themeSources = [read('style/merchant-light.wxss'), read('style/tokens.wxss')]

  // 前提断言:这个控件确实是「无边框」的,+ 号才是唯一可点提示。
  // 如果哪天给 .up-box 补了达标边框,这条前提会红 —— 那时该重写本契约,而不是删掉它。
  const boxBorder = declarationOf(applyWxss, '.up-box', 'border')
  assert.equal(boxBorder, 'none', '.up-box 已经不是无边框了,本契约的前提变了,请重新评估可感知边界从哪来')

  const surface = resolveToken('--cy-color-bg-surface', themeSources)
  const plusColor = declarationOf(applyWxss, '.up-plus', 'color')

  const nested = plusColor.match(/^var\(\s*(--[\w-]+)\s*\)$/)
  const resolved = nested ? resolveToken(nested[1], themeSources) : plusColor
  const effective = resolved.startsWith('rgb') ? compositeOver(resolved, surface) : resolved

  const ratio = contrastRatio(effective, surface)
  assert.ok(
    ratio >= WCAG_NON_TEXT_MIN,
    `.up-plus 实际呈现 ${effective} 落在 ${surface} 上,对比度 ${ratio.toFixed(2)}:1,` +
      `低于 WCAG 1.4.11 非文本门槛 ${WCAG_NON_TEXT_MIN}:1。` +
      `这是这个上传框唯一的「可以点」提示(.up-box 无边框、与容器只差 1.10:1)。`
  )
})

test('上传框与其容器的边界确实低于门槛 —— 本契约的立论前提', () => {
  // 这条不是在「要求」低对比度,而是把立论钉住:一旦哪天 surface/surface-subtle
  // 拉开到 3:1 以上,边界自己就够用了,上面那条对 + 号的严格要求可以放宽。
  // 前提变了要被人看见,而不是让上面那条继续以过时理由卡着别人。
  const themeSources = [read('style/merchant-light.wxss'), read('style/tokens.wxss')]
  const surface = resolveToken('--cy-color-bg-surface', themeSources)
  const subtle = resolveToken('--cy-color-bg-surface-subtle', themeSources)
  const ratio = contrastRatio(surface, subtle)
  assert.ok(
    ratio < WCAG_NON_TEXT_MIN,
    `surface(${surface})与 surface-subtle(${subtle})现在有 ${ratio.toFixed(2)}:1,` +
      `边界已可独立感知 —— 请回头放宽 .up-plus 那条契约,别让它以过时理由继续卡着。`
  )
})
