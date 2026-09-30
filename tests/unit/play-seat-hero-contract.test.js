// 自由探索(mode2)点卡 → 页内 hero 展开层 的契约。
//
// 2026-09-05 拍板(参考 cibby · shelf):点商家卡不再直接 navigateTo 商家页,
// 而是卡片从格子原位放大到屏幕上部、背景换成这家的模糊图、文字依次上滑;
// 「进店」CTA 才跳商家页办扫码/凭证/核销。商家页本身不动。
//
// 锁四件事:
//   1. onSeatTap 不再直接跳页(否则 hero 层是死代码,门禁看不见);跳页只在 heroEnter 里。
//   2. 锁定/暂停节点仍先过 _lockedTip —— hero 不许绕开节点级前置解锁。
//   3. JS 的 HERO_DUR 与 WXSS 卡片过渡时长同步(同 play-pack-timing-lock 的理由:注释拦不住漏改)。
//   4. reducedMotion 不播动画;物理返回由 page-container 守卫消费而不是退出 play 页。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const JS = fs.readFileSync(path.join(ROOT, 'pages/play/index.js'), 'utf8')
const WXML = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxml'), 'utf8')
const WXSS = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxss'), 'utf8')

function method(name) {
  const m = JS.match(new RegExp('^  ' + name + '\\([^)]*\\) \\{[\\s\\S]*?^  \\},', 'm'))
  assert.ok(m, `index.js 里找不到方法 ${name}(锚点失效,不是代码没问题)`)
  return m[0]
}
function toMs(raw) {
  const m = String(raw).match(/^([0-9.]+)(ms|s)$/)
  assert.ok(m, `解析不了时长:${raw}`)
  return m[2] === 'ms' ? Number(m[1]) : Math.round(Number(m[1]) * 1000)
}
function ruleBody(selector) {
  const i = WXSS.indexOf(selector + '{')
  assert.ok(i >= 0, `WXSS 里找不到选择器 ${selector}(锚点失效)`)
  return WXSS.slice(i, WXSS.indexOf('}', i) + 1)
}

test('1. 点卡进 hero 层,不直接跳商家页;跳页只在 heroEnter', () => {
  const tap = method('onSeatTap')
  assert.doesNotMatch(tap, /navigateTo/, 'onSeatTap 里不许再直接 navigateTo')
  assert.match(tap, /_openHero\(/, 'onSeatTap 必须走 _openHero')
  const enter = method('heroEnter')
  assert.match(enter, /navigateTo\(\{ url: '\/pages\/play\/merchant\/index\?nodeId='/, 'heroEnter 必须跳现有商家页')
})

test('2. 锁定/暂停节点先过 _lockedTip,过不了就不开 hero', () => {
  const tap = method('onSeatTap')
  const lock = tap.indexOf('_lockedTip(')
  const open = tap.indexOf('_openHero(')
  assert.ok(lock >= 0 && open > lock, '_lockedTip 必须在 _openHero 之前')
})

test('3. HERO_DUR 与 .fx-hero__card 的 transform 过渡时长同步', () => {
  const c = JS.match(/^const HERO_DUR\s*=\s*([0-9.]+)\s*;/m)
  assert.ok(c, 'index.js 缺 HERO_DUR 常量')
  const m = ruleBody('.fx-hero__card').match(/transition:transform\s+([0-9.]+m?s)/)
  assert.ok(m, '.fx-hero__card 里没抓到 transform 过渡时长')
  assert.equal(toMs(m[1]), Number(c[1]))
})

test('4a. reducedMotion:卡片 / 背景 / 文字三层过渡全关', () => {
  const body = ruleBody('.play--reduced-motion .fx-hero__card, .play--reduced-motion .fx-hero__bg, .play--reduced-motion .fx-hero__in')
  assert.match(body, /transition:\s*none/)
})

test('4b. 物理返回由 page-container 守卫消费(0 尺寸、无遮罩、afterleave 收 hero)', () => {
  const pc = WXML.match(/<page-container[^>]*show="\{\{hero\.show\}\}"[^>]*\/>/)
  assert.ok(pc, 'page-container 必须绑 hero.show')
  assert.match(pc[0], /overlay="\{\{false\}\}"/)
  assert.match(pc[0], /duration="\{\{0\}\}"/)
  assert.match(pc[0], /bind:afterleave="onHeroNativeBack"/)
  assert.match(method('onHeroNativeBack'), /closeHero\(/)
})

test('5. hero 层结构:背景模糊图 + 卡片克隆 + 正文 + 进店 CTA,且瓦片带 data-idx 供量矩形', () => {
  assert.match(WXML, /class="fx-tile[^"]*"[^>]*data-idx="\{\{index\}\}"/, '瓦片要带 data-idx,_openHero 按下标取 boundingClientRect')
  assert.match(WXML, /class="fx-hero \{\{hero\.open \? 'is-open' : ''\}\}"/)
  for (const cls of ['fx-hero__bg', 'fx-hero__card', 'fx-hero__body', 'fx-hero__cta']) {
    assert.ok(WXML.includes('class="' + cls), `hero 层缺 ${cls}`)
  }
  assert.match(WXML, /<cy-btn[^>]*bindtap="heroEnter"/, 'CTA 必须用 cy-btn,不自造按钮')
})
