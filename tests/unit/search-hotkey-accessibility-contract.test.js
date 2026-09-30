'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertContract(overrides = {}) {
  const source = (file) => overrides[file] === undefined ? read(file) : overrides[file]
  const wxml = source('pages/search2/index.wxml')
  const wxss = source('pages/search2/index.wxss')
  const hotkeyRule = /\.search2\s+\.hot-keys\s+\.cont\s+\.li\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(hotkeyRule, '缺少搜索热词样式')
  assert.match(hotkeyRule[1], /min-height:\s*88rpx/,
    '搜索热词触达高度必须至少 44px（88rpx@375）')
  assert.doesNotMatch(hotkeyRule[1], /(?:^|;)\s*height:\s*46rpx/,
    '搜索热词不得锁回 23px 高度')

  const hotkeyBindings = wxml.match(/<view[\s\S]*?bindtap="onHotKeyClick"[\s\S]*?>/g) || []
  assert.equal(hotkeyBindings.length, 2, '历史词和运营热词都必须保留点击入口')
  hotkeyBindings.forEach((binding) => {
    assert.match(binding, /aria-role="button"/)
    assert.match(binding, /aria-label="搜索\{\{item\}\}"/)
  })

  const categoryBinding = /<view[\s\S]*?bindtap="onCategoryClick"[\s\S]*?>/.exec(wxml)
  assert.ok(categoryBinding, '类别点击入口必须存在')
  assert.match(categoryBinding[0], /aria-role="button"/)
  assert.match(categoryBinding[0], /aria-label="搜索类别\{\{item\.categoryName\}\}"/)
}

test('搜索热词与类别入口具有 44px 热区和可访问按钮语义', () => {
  assertContract()
})

test('负控：搜索热词退回 23px 高度会判红', () => {
  const file = 'pages/search2/index.wxss'
  const broken = read(file).replace('min-height: 88rpx', 'height: 46rpx')
  assert.throws(() => assertContract({ [file]: broken }), /触达高度必须至少 44px/)
})

test('负控：搜索热词删除按钮语义会判红', () => {
  const file = 'pages/search2/index.wxml'
  const broken = read(file).replace('aria-role="button" aria-label="搜索{{item}}"', '')
  assert.throws(() => assertContract({ [file]: broken }), /aria-role="button"/)
})
