'use strict'

// P3-2:商家用个人主页扫券,重复核销必须走「重复核销」口径(非成功图标),
// 与 pages/merchant/index 的 resolveVerificationResult 一致;首次成功仍是成功回执。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const PROFILE = 'components/cy/profile/index.js'
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function mountProfile(options = {}) {
  const requests = []
  const toasts = []
  let definition = null
  const wx = {
    showToast(opts) { toasts.push(opts || {}) },
    hideToast() {},
    showLoading() {},
    hideLoading() {},
    showModal(opts) { if (opts && opts.success) opts.success({ confirm: false }) },
    getStorageSync() { return '' },
    setStorageSync() {},
    removeStorageSync() {},
    scanCode(opts) { if (opts && opts.success) opts.success({ result: options.scanResult || '' }) },
    setNavigationBarColor() {},
    setBackgroundColor() {},
    hideTabBar() {},
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, safeArea: { top: 20, bottom: 647 } }),
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, safeArea: { top: 20, bottom: 647 } }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 278, right: 365 }),
    navigateTo() {}, navigateBack() {}, reLaunch() {}, switchTab() {},
  }
  const app = {
    globalData: {},
    getUserID: () => '9002',
    getUserRole: () => 'merchant',
    getUserType: () => 2,
    isDevEnv: () => false,
    sendRequest(request) { requests.push(request) },
    tips() {},
    getRequestErrorMessage: (res, fallback) => (res && (res.msg || res.errMsg)) || fallback,
  }
  global.getApp = () => app
  global.wx = wx
  global.Component = (def) => { definition = def }
  const sandbox = {
    getApp: () => app,
    getCurrentPages: () => [{}],
    wx,
    Component: (def) => { definition = def },
    require: (id) => require(path.resolve(path.dirname(path.join(ROOT, PROFILE)), id)),
    console, Date, JSON, Object, Array, Number, String, Math, Promise, isFinite, isNaN,
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  }
  vm.runInNewContext(options.source || read(PROFILE), sandbox, { filename: PROFILE })

  const component = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
  })
  Object.keys(definition.properties || {}).forEach((key) => {
    const prop = definition.properties[key]
    component.data[key] = prop && prop.value
  })
  component.setData = (patch) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.')
      let cursor = component.data
      parts.slice(0, -1).forEach((part) => { cursor = cursor[part] || (cursor[part] = {}) })
      cursor[parts[parts.length - 1]] = value
    })
  }
  component.requests = requests
  component.toasts = toasts
  return component
}

const COUPON_SCAN = JSON.stringify({ type: 'coupon', code: 'COU-PROFILE-1' })

test('P3-2 个人主页扫码:重复核销走「重复核销」口径,不再弹成功图标', () => {
  const profile = mountProfile({ scanResult: COUPON_SCAN })
  profile.goScanQR()

  assert.equal(profile.requests.length, 1, '应发起核销请求')
  profile.requests[0].success({ code: '200', msg: '该优惠券已核销', data: { alreadyUsed: true } })

  const last = profile.toasts[profile.toasts.length - 1]
  assert.ok(last, '必须有可见回执')
  assert.notEqual(last.icon, 'success', '重复核销不得用成功图标')
  assert.match(String(last.title || ''), /重复核销/, '口径必须是重复核销')
})

test('P3-2 个人主页扫码:首次核销仍走成功回执', () => {
  const profile = mountProfile({ scanResult: COUPON_SCAN })
  profile.goScanQR()
  profile.requests[0].success({ code: '200', msg: '核销成功', data: {} })

  const last = profile.toasts[profile.toasts.length - 1]
  assert.equal(last.icon, 'success')
  assert.match(String(last.title || ''), /核销成功/)
})

test('负控:重复核销只判 code==200 弹成功时必须判红', () => {
  const source = read(PROFILE)
  const mutated = source.replace(
    "              var verdict = resolveVerificationResult(r, scan.successTitle || '核销');\n              if (verdict.state === 'duplicate') {\n                cyToast(verdict.title + '：' + verdict.message, { icon: 'none' });\n                return;\n              }\n",
    '')
  assert.notEqual(mutated, source, '负控锚点失效:未找到重复核销分支')
  const profile = mountProfile({ scanResult: COUPON_SCAN, source: mutated })
  profile.goScanQR()
  profile.requests[0].success({ code: '200', msg: '该优惠券已核销', data: { alreadyUsed: true } })
  assert.throws(() => assert.notEqual(profile.toasts[profile.toasts.length - 1].icon, 'success'), assert.AssertionError)
})
