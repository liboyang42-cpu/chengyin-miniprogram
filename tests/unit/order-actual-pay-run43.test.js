// RUN-43 契约:订单列表卡「实付款」只能出现金实付,不许再绑原价 totalAmount。
// 拍板口径(2026-09-18):实付款只写现金 —— 积分抵扣部分不算「实付款」。
// 现金属 NULL 的存量行按回落链 payableAmount → totalAmount 兜底,且 0 是合法现金值,
// 必须用 null 判断而不是 ||(否则微信实付 0.00 会被错误顶成 payable)。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const { resolveActualPaidAmount } = require('../../utils/order-actual-pay.js')

test('实付款只写现金:微信实付优先,积分抵扣不计入', () => {
  // reg 43 活样本:原价 15,积分抵 6,微信实付 0.01 ⇒ 卡片必须显示 0.01
  assert.equal(resolveActualPaidAmount({
    totalAmount: 15, pointPaymentAmount: 6, wechatPaymentAmount: 0.01, payableAmount: 9,
  }), 0.01)
})

test('现金 0 是合法实付,不能被 || 顶成 payable/total', () => {
  assert.equal(resolveActualPaidAmount({
    totalAmount: 15, wechatPaymentAmount: 0, payableAmount: 9,
  }), 0)
})

test('存量行无现金拆分时回落 payableAmount,再回落 totalAmount', () => {
  assert.equal(resolveActualPaidAmount({ totalAmount: 15, payableAmount: 9 }), 9)
  assert.equal(resolveActualPaidAmount({ totalAmount: 15 }), 15)
  assert.equal(resolveActualPaidAmount(null), null)
})

test('wxml:「实付款」行绑实付字段,全卡不再出现 item.totalAmount', () => {
  const wxml = read('components/cy/scene-member-order-history/index.wxml')
  const botLine = wxml.split('\n').filter((l) => l.includes('实付款') && !l.trim().startsWith('<!--'))
  assert.equal(botLine.length, 1, '「实付款」应当只有一处')
  assert.ok(botLine[0].includes('item.actualPaidAmount'), '实付款行必须绑 item.actualPaidAmount')
  assert.ok(!botLine[0].includes('item.totalAmount'), '实付款行禁止绑原价 totalAmount')
})

test('组件取数时给每行喂 actualPaidAmount(只有 wxml 绑定没有装配=假修)', () => {
  const js = read('components/cy/scene-member-order-history/index.js')
  assert.ok(js.includes('resolveActualPaidAmount'), '组件必须经 utils/order-actual-pay 装配')
  assert.ok(js.includes('actualPaidAmount'), '每行必须落 item.actualPaidAmount')
})
