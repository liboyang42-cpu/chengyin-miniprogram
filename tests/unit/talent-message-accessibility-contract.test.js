'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertContract(overrides = {}) {
  const source = (file) => overrides[file] === undefined ? read(file) : overrides[file]
  const wxml = source('pages/talent/list/index.wxml')
  const wxss = source('pages/talent/list/index.wxss')
  const binding = /<view class="nav-icon nav-msg"[^>]*bindtap="onMsgTap"[^>]*>/.exec(wxml)
  assert.ok(binding, '站内消息入口必须存在')
  assert.match(binding[0], /aria-role="button"/)
  assert.match(binding[0], /aria-label="站内消息"/)
  const rule = /\.nav-icon\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(rule, '消息入口热区样式必须存在')
  assert.match(rule[1], /width:\s*88rpx/)
  assert.match(rule[1], /height:\s*88rpx/)
  assert.match(wxss, /\.nav-icon image\s*\{[^}]*width:\s*44rpx;[^}]*height:\s*44rpx;/s,
    '扩大热区不能放大消息图标')
}

test('人才列表消息入口具有 44px 热区和可访问按钮语义', () => {
  assertContract()
})

test('负控：消息入口热区退回 24px 会判红', () => {
  const file = 'pages/talent/list/index.wxss'
  const broken = read(file).replace('width: 88rpx;\n  height: 88rpx;', 'width: 48rpx;\n  height: 48rpx;')
  assert.throws(() => assertContract({ [file]: broken }), /88rpx/)
})

test('负控：消息入口删除按钮语义会判红', () => {
  const file = 'pages/talent/list/index.wxml'
  const broken = read(file).replace(' aria-role="button" aria-label="站内消息"', '')
  assert.throws(() => assertContract({ [file]: broken }), /aria-role="button"/)
})
