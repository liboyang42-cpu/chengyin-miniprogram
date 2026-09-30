'use strict'

// 面层分离门禁:同一个主题里,「页底 / 白卡 / 凹槽」三层必须彼此看得出层次。
//
// 这不是 WCAG 文字对比度(那管的是「字读不读得清」),而是「这块面在不在」——
// 一个和页底同色的卡片/输入框,在视觉上等于不存在,但所有文字对比度断言都照过。
//
// ⚠️ 为什么加这条(2026-08-10 实证):
//   #677 把日间域页底从 #F9F9F9 改到 #F3F4F4,没动 --cy-color-bg-surface-subtle(#F4F4F4)。
//   改之前两者对比 1.045:1(弱但还在),改之后 **1.002:1** —— 整个商家域的输入框、搜索框、
//   状态 chip 等于没有底色。同一天 .theme-topic-editor 也塌到 1.025:1。
//   当时全部配色契约都只算「文字 vs 底」,**没有任何一条在看「底 vs 底」**,
//   所以这个缺陷零告警地活着,靠人眼在截图里也看不出 2/255 的差别。
//
// 阈值 1.04 的来历:GitHub Primer 的 canvas.subtle vs canvas.default = 1.065,
// iOS grouped 的页底 vs 白卡 = 1.116。1.04 取在它们下方,只拦「事实上同色」,
// 不对设计品味做主张。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

// [前景层, 背景层, 最低对比] —— 前者必须能从后者上分辨出来
const SEPARATION = [
  ['--cy-color-bg-surface', '--cy-color-bg-page', 1.04],
  ['--cy-color-bg-surface-subtle', '--cy-color-bg-page', 1.04],
]

const srgb = (c) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : (((c / 255) + 0.055) / 1.055) ** 2.4)
function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255)
}
function contrast(a, b) {
  const [la, lb] = [luminance(a), luminance(b)]
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 把一个 wxss 文件切成 {选择器 → {token: 字面色}},只收字面 hex(var() 链条不在本门禁范围) */
function themeBlocks(relPath) {
  const css = fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ')
    const decls = {}
    for (const d of m[2].matchAll(/(--cy-color-bg-[a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) decls[d[1]] = d[2]
    if (decls['--cy-color-bg-page']) out.push({ where: `${relPath} { ${selector.slice(0, 60)} }`, decls })
  }
  return out
}

const ALL = [...themeBlocks('style/tokens.wxss'), ...themeBlocks('style/merchant-light.wxss')]

test('扫描口径没坏:至少找到 3 个定义了 bg-page 的主题块', () => {
  assert.ok(ALL.length >= 3, `只找到 ${ALL.length} 个主题块 —— 正则或文件结构变了,本门禁形同虚设`)
})

test('每个主题里,白卡与凹槽都必须能从页底上分辨出来', () => {
  let checked = 0
  for (const { where, decls } of ALL) {
    for (const [fg, bg, min] of SEPARATION) {
      if (!decls[fg]) continue // 该块没重声明这一层,继承上层,不在此处判
      const ratio = contrast(decls[fg], decls[bg])
      assert.ok(ratio !== null, `${where}: ${fg}/${bg} 不是字面 hex,无法计算`)
      checked += 1
      assert.ok(
        ratio >= min,
        `${where}: ${fg}(${decls[fg]}) 压在 ${bg}(${decls[bg]}) 上只有 ${ratio.toFixed(3)}:1，` +
        `低于 ${min}:1 —— 这一层在视觉上不存在。文字对比度断言拦不住这种缺陷。`
      )
    }
  }
  assert.ok(checked >= 4, `只实际比对了 ${checked} 对,太少,门禁可能在空跑`)
})
