'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

const targets = [
  ['pages/merchant/apply/index.wxml', 'pages/merchant/apply/index.wxss', '.up-del'],
  ['pages/merchant/apply/index.wxml', 'pages/merchant/apply/index.wxss', '.img-del'],
  ['pages/topic/merchantapply/index.wxml', 'pages/topic/merchantapply/index.wxss', '.ma-pgrid-del'],
  ['pages/publish/temp/index.wxml', 'pages/publish/temp/index.wxss', '.cg-cover-del'],
  ['pages/publish/temp/index.wxml', 'pages/publish/temp/index.wxss', '.cg-mod-del'],
  ['pages/publish/temp/index.wxml', 'pages/publish/temp/index.wxss', '.cg-choice-del'],
  ['pages/publish/temp/index.wxml', 'pages/publish/temp/index.wxss', '.cg-qmedia-x'],
]

function read(relativePath, overrides) {
  return overrides[relativePath] === undefined
    ? fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
    : overrides[relativePath]
}

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少 ${selector}`)
  return match[1]
}

function assertContract(overrides = {}) {
  for (const [wxmlPath, wxssPath, selector] of targets) {
    const className = selector.slice(1)
    const wxml = read(wxmlPath, overrides)
    const wxss = read(wxssPath, overrides)
    const tags = [...wxml.matchAll(new RegExp(`<view[^\\n]*class="[^"]*\\b${className}\\b[^"]*"[^\\n]*>`, 'g'))]
    assert.ok(tags.length > 0, `${selector} 没有生产节点`)
    for (const [tag] of tags) {
      assert.match(tag, /aria-role="button"/, `${selector} 缺按钮语义`)
      assert.match(tag, /aria-label="[^"]+"/, `${selector} 缺可读名称`)
    }
    const cssRule = rule(wxss, selector)
    assert.match(cssRule, /width:\s*var\(--cy-btn-h\)/, `${selector} 宽度不足 44px`)
    assert.match(cssRule, /height:\s*var\(--cy-btn-h\)/, `${selector} 高度不足 44px`)
  }
}

test('申请与玩法编辑器删除按钮 owner 均为 44px，视觉图形保持紧凑', () => {
  assertContract()
})

test('负控：任一删除 owner 退回 40rpx 会判红', () => {
  const wxssPath = 'pages/merchant/apply/index.wxss'
  const wxss = read(wxssPath, {}).replace(
    /(\.img-del\s*\{[^}]*?)width:\s*var\(--cy-btn-h\);\s*height:\s*var\(--cy-btn-h\);/s,
    '$1width:40rpx; height:40rpx;',
  )
  assert.throws(() => assertContract({ [wxssPath]: wxss }), /宽度不足/)
})

test('负控：动态图删除按钮丢失可读名称会判红', () => {
  const wxmlPath = 'pages/merchant/apply/index.wxml'
  const wxml = read(wxmlPath, {}).replace(' aria-label="删除品牌形象图 {{index + 1}}"', '')
  assert.throws(() => assertContract({ [wxmlPath]: wxml }), /缺可读名称/)
})
