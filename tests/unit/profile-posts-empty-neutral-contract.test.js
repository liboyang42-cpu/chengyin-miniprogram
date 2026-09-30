// CR-309 / 产品拍板 2026-09-15 第 29 问:工作台发帖器/店帖「不做」,去掉误导空态提示。
//
// components/cy/profile 的「推文」tab 对本人空态写的是「发布第一条城市推文吧」,
// 但商家主页/工作台里没有任何发帖入口(全仓零 creativesquare/post 创建入口)。
// 用户裁决:不新增发帖功能,只把这条催发帖文案换成中性陈述,他方文案保存量。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const WXML = fs.readFileSync(path.join(ROOT, 'components/cy/profile/index.wxml'), 'utf8')

test('RED 锚点:推文 tab 空态不得再催本人发帖(没有入口的 CTA 是误导)', () => {
  assert.doesNotMatch(WXML, /发布第一条城市推文/, '空态仍在催发帖,但页面上没有发帖入口')
})

test('空态改为中性陈述,他方文案保持不变', () => {
  assert.match(WXML, /还没有推文/)
  assert.match(WXML, /你还没有发布过推文/, '本人空态应为中性陈述')
  assert.match(WXML, /TA 还没有发布推文/, '他方空态文案不该被顺手改掉')
})

test('不为此新增发帖入口或 handler(拍板:不做发帖器/店帖)', () => {
  assert.doesNotMatch(WXML, /去发帖|立即发帖|goPost|createPost|onCreatePost/)
  const js = fs.readFileSync(path.join(ROOT, 'components/cy/profile/index.js'), 'utf8')
  assert.doesNotMatch(js, /goPost|createPost|onCreatePost/, '不得新增发帖方法')
})
