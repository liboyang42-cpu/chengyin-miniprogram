'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const TARGETS = [
  'pages/merchant/index/index',
  'pages/merchant/decor/index',
  'pages/merchant/decor/coop-setting/index',
  'pages/merchant/decor/gallery/index',
  'pages/merchant/decor/perks/index',
  'pages/merchant/apply/index',
  'pages/merchant/marketing/index',
  'pages/merchant/marketing/ai-insight/index',
  'pages/merchant/ledger/order-detail/index',
  'pages/coop/invite/index',
  'pages/coop/list/index',
]

const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const visibleSource = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

function assertNoFakeIcons(base, source = read(`${base}.wxml`)) {
  const visible = visibleSource(source)
    // A multiplication sign between two numeric values is copy, not an icon.
    .replace(/(?:\d|\}\})\s*×\s*(?:\d|\{\{)/g, '')
  assert.doesNotMatch(visible, /[›‹×✕＋✓]/, `${base} 仍以文字字符充当图标`)
  assert.doesNotMatch(visible, />\s*\+\s*</, `${base} 仍以 ASCII + 充当添加图标`)

  if (/<cy-icon\b/.test(visible)) {
    const config = JSON.parse(read(`${base}.json`))
    assert.equal(
      config.usingComponents && config.usingComponents['cy-icon'],
      '/components/cy/icon/index',
      `${base} 使用 cy-icon 但未注册`,
    )
  }
}

function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `${selector} 缺少样式规则`)
  return match[1]
}

test('商家与 B2B 页面以统一真实图标表达箭头、关闭、勾选与添加', () => {
  TARGETS.forEach((base) => assertNoFakeIcons(base))
})

test('图标所在交互仍有可读名称、状态语义和至少 88rpx 命中区', () => {
  const applyView = read('pages/merchant/apply/index.wxml')
  const applyStyle = read('pages/merchant/apply/index.wxss')
  assert.match(applyView, /class="up-del"[^>]*aria-role="button"[^>]*aria-label="删除营业执照照片"/)
  assert.match(applyView, /class="img-del"[^>]*aria-role="button"[^>]*aria-label="删除品牌形象图/)
  assert.match(cssRule(applyStyle, '.up-del'), /min-(?:width|height):\s*88rpx/)
  assert.match(cssRule(applyStyle, '.img-del'), /min-(?:width|height):\s*88rpx/)

  const inviteView = read('pages/coop/invite/index.wxml')
  const inviteStyle = read('pages/coop/invite/index.wxss')
  assert.match(inviteView, /class="terms-option[^>]*aria-role="radio"[^>]*aria-checked=/)
  assert.match(inviteView, /class="target"[^>]*aria-role="checkbox"[^>]*aria-checked=/)
  assert.match(cssRule(inviteStyle, '.terms-option'), /min-height:\s*88rpx/)
  const targetHeight = /min-height:\s*(\d+)rpx/.exec(cssRule(inviteStyle, '.target'))
  assert.ok(targetHeight && Number(targetHeight[1]) >= 88, '邀请对象行点击区不得小于 88rpx')

  const indexView = read('pages/merchant/index/index.wxml')
  const indexStyle = read('pages/merchant/index/index.wxss')
  assert.match(indexView, /class="rv-more-item"[^>]*aria-role="button"[^>]*aria-label=/)
  assert.match(indexView, /class="chpick__item"[^>]*aria-role="button"[^>]*aria-label=/)
  assert.match(cssRule(indexStyle, '.rv-more-item'), /min-height:[^;]*88rpx/)
  assert.match(cssRule(indexStyle, '.chpick__item'), /min-height:\s*88rpx/)
})

test('负控：把任一真实箭头改回文字箭头时，图标契约必须判红', () => {
  const base = 'pages/merchant/marketing/index'
  const source = read(`${base}.wxml`)
  const mutated = source.replace(/<cy-icon\b[^>]*name="arrow-right"[^>]*\/>/, '<text>›</text>')
  assert.notEqual(mutated, source, '负控锚点失效：营销页缺少真实箭头')
  assert.throws(() => assertNoFakeIcons(base, mutated), /文字字符充当图标/)
})
