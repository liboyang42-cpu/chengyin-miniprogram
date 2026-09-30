'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const WXML_PATH = path.join(ROOT, 'subpackageMember/coupon/coupon.wxml')

function readView() {
  return fs.readFileSync(WXML_PATH, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
}

function assertDetailTruth(wxml) {
  const dialog = wxml.slice(wxml.indexOf('<cy-sheet'))
  assert.doesNotMatch(dialog, /d_qrcode|qrcode|二维码/i, '商家发布记录不得显示固定图片冒充用户核销二维码')
  assert.match(dialog, /<cy-icon\b[^>]*name="coupon"[^>]*size="56"/)
  assert.match(dialog, /发布批次券码/)
  assert.match(dialog, /用户领取后会生成个人核销凭证/)
  assert.match(dialog, /剩余\s*\{\{currentCoupon\.remainCount\}\}/)
}

test('商家优惠券详情展示真实批次字段，不用固定二维码冒充核销凭证', () => {
  assertDetailTruth(readView())
})

test('优惠券详情是可关闭的语义对话框，遮罩和关闭按钮都有退出路径', () => {
  const wxml = readView()
  assert.match(wxml, /<cy-sheet[^>]*show="\{\{tpShow\}\}"[^>]*title="优惠券详情"[^>]*bind:close="tpClose"/)
  assert.match(wxml, /currentCoupon.name/)
  assert.match(wxml, /loadState === 'ready' && !tpShow/)

})

test('负控：商家详情重新塞入固定二维码图时真实性契约必须判红', () => {
  const source = readView()
  assertDetailTruth(source)
  const mutated = source.replace(
    /<cy-icon\b[^>]*name="coupon"[^>]*\/>/,
    '<image src="/subpackageMember/images/d_qrcode.png" />',
  )
  assert.notEqual(mutated, source, '负控锚点失效：未找到 coupon 图标')
  assert.throws(() => assertDetailTruth(mutated), assert.AssertionError)
})
