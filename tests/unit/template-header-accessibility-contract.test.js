'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function rule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  assert.ok(match, `缺少 ${selector} 样式`)
  return match[1]
}

function assertContract(overrides = {}) {
  const source = (file) => overrides[file] === undefined ? read(file) : overrides[file]
  const wxml = source('pages/template/index.wxml')
  const wxss = source('pages/template/index.wxss')
  const js = source('pages/template/index.js')
  assert.match(wxml, /class="titBar"[^>]*padding-right:\s*\{\{\s*headerRightInset\s*\}\}px/,
    '顶栏右侧动作必须给微信胶囊留出动态安全区')
  assert.match(js, /headerRightInset:\s*0/)
  assert.match(js, /windowWidth\s*-\s*capsuleLeft\s*\+\s*8/,
    '胶囊右侧安全距必须由运行时 windowWidth/menuButton.left 计算')
  // 2026-09-19 用户拍板:模板页左上角头像商家态与玩家态都撤掉,顶栏不得再出现头像节点
  assert.doesNotMatch(wxml, /tpl-avatar/, '模板页顶栏不得再有头像入口(已撤)')
  assert.match(wxml, /class="tpl-bell"[^>]*bindtap="goInbox"[^>]*aria-role="button"[^>]*aria-label="消息"/)
  assert.match(rule(wxss, '.tpl-bell'), /width:\s*44rpx;\s*height:\s*44rpx;/)
  assert.match(rule(wxss, '.tpl-bell'), /padding:\s*22rpx/,
    '44rpx 铃铛必须用 22rpx 透明边补足 88rpx 热区')
}

test('模板页顶栏无头像,消息入口保持视觉尺寸并具有 44px 触达区', () => {
  assertContract()
})

test('负控：铃铛透明热区被移除会判红', () => {
  const file = 'pages/template/index.wxss'
  const broken = read(file).replace('padding: 22rpx', 'padding: 0')
  assert.throws(() => assertContract({ [file]: broken }), /22rpx 透明边/)
})

test('负控：头像入口回流顶栏会判红', () => {
  const file = 'pages/template/index.wxml'
  const broken = read(file).replace('<view class="tpl-hd-space"></view>',
    '<image class="tpl-avatar" src="{{ avatar }}" bindtap="goMine"/>\n      <view class="tpl-hd-space"></view>')
  assert.throws(() => assertContract({ [file]: broken }), /不得再有头像/)
})

test('负控：顶栏移除胶囊右侧安全区会判红', () => {
  const file = 'pages/template/index.wxml'
  const broken = read(file).replace(' padding-right: {{ headerRightInset }}px;', '')
  assert.throws(() => assertContract({ [file]: broken }), /胶囊留出动态安全区/)
})
