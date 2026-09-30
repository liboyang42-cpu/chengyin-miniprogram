'use strict'
// 阶段1 1-31 残留:T30 订单卡按钮文案与落点一致;T32 0 积分用户开积分抵扣给真实原因;
// T36 templatedetail 返回兜底不能 redirectTo 到 tabBar 页。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')

test('T30:已报名订单卡的按钮打开订单详情,文案不能写「查看票夹」', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/scene-member-order-history/index.wxml'), 'utf8')
  const btn = wxml.split('\n').find(line => line.includes('catchtap="openDetail"') && line.includes('manual_refund'))
  assert.ok(btn, '找不到已报名订单卡的 openDetail 按钮')
  assert.doesNotMatch(btn, /查看票夹/, 'openDetail 打开的是订单详情,不是票夹')
})

function loadPage(relPath, wxOverrides, appOverrides) {
  let config
  const toasts = []
  global.getApp = () => Object.assign({
    globalData: { user_id: 9, features: {} }, getUserID: () => 9, isDevEnv: () => false,
    getImgUrl: n => n, sendRequest() {},
  }, appOverrides)
  global.getCurrentPages = () => [{}]
  global.Page = v => { config = v }
  global.wx = Object.assign({
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }), getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showToast(o) { toasts.push(o && o.title) }, showLoading() {}, hideLoading() {},
  }, wxOverrides)
  const abs = path.join(ROOT, relPath)
  delete require.cache[require.resolve(abs)]
  require(abs)
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data || {})) })
  page.setData = function (patch, cb) {
    Object.keys(patch).forEach(k => { this.data[k] = patch[k] })
    if (cb) cb.call(this)
  }
  return { page, toasts }
}

test('T32:0 积分用户打开积分抵扣,提示没有可用积分,不是「该票不支持积分抵扣」', () => {
  let quoteSuccess
  const { page, toasts } = loadPage('pages/activity/baoming/baoming.js', {}, {
    sendRequest(o) { if (o.url === '/api/registration/quote') quoteSuccess = o.success },
  })
  page.checkPaymentReadiness = () => {}
  page.refreshPaymentState = () => {}
  Object.assign(page.data, { selectedTicket: { id: 1 }, activityId: 5, useDiscount: true, userInfo: { point: 0 } })
  page.refreshQuote()
  quoteSuccess({ code: 200, data: { payAmount: 10, pointsDeductYuan: 0 } })
  assert.equal(page.data.useDiscount, false)
  assert.ok(toasts.includes('暂无可用积分'), '实际 toast: ' + JSON.stringify(toasts))

  toasts.length = 0
  Object.assign(page.data, { useDiscount: true, userInfo: { point: 500 } })
  page.refreshQuote()
  quoteSuccess({ code: 200, data: { payAmount: 10, pointsDeductYuan: 0 } })
  assert.ok(toasts.includes('该票不支持积分抵扣'), '有积分但服务端不抵扣时文案不变')
})

test('T36:templatedetail 返回兜底到 tabBar 页走 switchTab', () => {
  const calls = []
  const { page } = loadPage('pages/templatedetail/templatedetail.js', {
    navigateBack(o) { o.fail && o.fail() },
    redirectTo(o) { calls.push(['redirectTo', o.url]) },
    switchTab(o) { calls.push(['switchTab', o.url]) },
  })
  page.data.isMyScope = false
  page.goBack()
  assert.deepEqual(calls, [['switchTab', '/pages/template/index']])

  calls.length = 0
  page.data.isMyScope = true
  page.goBack()
  assert.deepEqual(calls, [['redirectTo', '/subpackageMember/mytemplate/mytemplate']], '非 tabBar 页仍 redirectTo')
})
