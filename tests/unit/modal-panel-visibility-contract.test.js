'use strict'

/* T2 居中弹窗(危险确认)的面板必须有自己的一档,不能跟着页底走。
 *
 * 病:cy-modal 的面板一直读 --cy-bg-card = --cy-color-bg-surface = #0A0A0B,
 * 而玩家域页底是 #000000 —— 两者 ΔL* 不到 1,面板压上去几乎等于隐形。
 * Brand Handbook 410-121 §⑥「P3 / P4 两处看不见」记的就是这件事,
 * 样张里 T2 这一型明显比 T1/T3 浅(#4D4D4D),T1/T3 仍走 §③ 的深调。
 *
 * ⚠️ 这条契约存在的直接理由:2026-09-03 做负控时发现,把 cy-modal 的
 * background 从 --cy-comp-modal-panel 改回 --cy-bg-card,**当时全仓没有任何门禁会红**
 * (undefined-token 只查 var() 有没有定义,ds-hardcode 只查硬编码色值,
 *  两条都管不到「读对了变量名但读错了那一档」)。没有这条,这个修复随时会被悄悄改回去。
 *
 * 负控:把接线改回 --cy-bg-card、或把暗端的 --cy-comp-modal-panel 调回页底档,本文件必须红。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ')

/* 取某个选择器块里某个 token 的字面值(块内最后一次声明胜出,跟 CSS 一致) */
function tokenIn(css, selector, name) {
  const src = strip(css)
  const at = src.indexOf(selector)
  if (at < 0) return null
  const end = src.indexOf('\n}', at)
  const block = src.slice(at, end < 0 ? undefined : end)
  const all = [...block.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, 'g'))]
  return all.length ? all[all.length - 1][1].trim() : null
}

const hex = (v) => /^#[0-9A-Fa-f]{6}$/.test(v) ? v.toUpperCase() : null
const lum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16)

test('cy-modal 的面板读专用档,不是页面卡片档', () => {
  const wxss = strip(read('components/cy/modal/index.wxss'))
  const panel = wxss.match(/\.mo__panel\s*\{[^}]*\}/) || wxss.match(/width:\s*640rpx;[\s\S]{0,300}?\}/)
  assert.ok(panel, '找不到 cy-modal 的面板样式块')
  assert.match(panel[0], /background:\s*var\(--cy-comp-modal-panel\)/,
    'T2 面板必须读 --cy-comp-modal-panel;读 --cy-bg-card 会退回页底档,压在黑页上隐形')
})

test('暗端的 T2 面板必须比页底亮出一档', () => {
  const tokens = read('style/tokens.wxss')
  const panel = hex(tokenIn(tokens, 'page {', 'cy-comp-modal-panel'))
  const page = hex(tokenIn(tokens, 'page {', 'cy-color-bg-page'))
  assert.ok(panel && page, `page{} 里读不到 modal 面板或页底的字面值(panel=${panel} page=${page})`)
  // 隐形的原始形态是 #0A0A0B 压 #000000,三通道合计只差 21/765。给一个有余量的下限。
  assert.ok(lum(panel) - lum(page) > 120,
    `T2 面板 ${panel} 与页底 ${page} 太接近(合计亮度差 ${lum(panel) - lum(page)}),会看不见`)
})

test('浅色域不跟着提亮 —— 那边的居中弹窗仍是白卡', () => {
  const tokens = read('style/tokens.wxss')
  for (const scope of ['.theme-merchant {', '.theme-topic-editor {']) {
    const v = tokenIn(tokens, scope, 'cy-comp-modal-panel')
    assert.ok(v, `${scope} 缺 --cy-comp-modal-panel 镜像`)
    assert.match(v, /var\(--cy-color-bg-surface\)/,
      `${scope} 的居中弹窗应继续用白卡,别把暗端那档 #4D4D4D 漏过来`)
  }
})

test('另外两处暗端作用域也要有,不然会继承成隐形', () => {
  assert.ok(tokenIn(read('style/tokens.wxss'), '.theme-dark {', 'cy-comp-modal-panel'),
    '.theme-dark 缺 --cy-comp-modal-panel')
  assert.ok(tokenIn(read('style/dark-mode.wxss'), '@media', 'cy-comp-modal-panel')
    || /--cy-comp-modal-panel/.test(read('style/dark-mode.wxss')),
    'dark-mode.wxss 缺 --cy-comp-modal-panel 镜像')
})
