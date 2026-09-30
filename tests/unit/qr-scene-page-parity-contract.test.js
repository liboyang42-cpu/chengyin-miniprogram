'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const CITY_PAGE = 'subpackageRoam/citynode-code/index.js'
const CITY_SCENE = 'components/cy/scene-qr-citynode/index.js'
const COUPON_PAGE = 'subpackageMember/coupon-qr/index.js'
const COUPON_SCENE = 'components/cy/scene-qr-coupon/index.js'
const GROUP_PAGE_WXML = 'pages/club/group-code/index.wxml'
const GROUP_SCENE = 'components/cy/scene-qr-group-code/index.js'
const GROUP_SCENE_WXML = 'components/cy/scene-qr-group-code/index.wxml'

function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function mount(source, kind, relativePath) {
  const requests = []
  const timers = []
  const vibrations = []
  // 券码页/场景出码与轮询都先核当前登录 owner(换账号不串码),桩需提供登录主体
  const app = { sendRequest(options) { requests.push(options) }, getUserID() { return 9001 } }
  const wx = { vibrateShort(options) { vibrations.push(options && options.type) } }
  let definition
  const sandbox = {
    getApp() { return app },
    getCurrentPages() { return [{}, {}] },
    wx,
    setInterval(callback) { timers.push(callback); return timers.length },
    clearInterval() {},
    require(id) {
      if (!id.startsWith('.')) return require(id)
      return require(path.resolve(path.dirname(path.join(ROOT, relativePath)), id))
    },
    Page(options) { definition = options },
    Component(options) { definition = options },
  }
  vm.runInNewContext(source, sandbox)
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback()
    },
    triggerEvent() {},
  }
  const methods = kind === 'component' ? definition.methods : definition
  Object.entries(methods).forEach(([name, method]) => {
    if (typeof method === 'function') instance[name] = method.bind(instance)
  })
  return { instance, requests, timers, vibrations }
}

function assertCityFailureParity(sceneSource) {
  const page = mount(read(CITY_PAGE), 'page', CITY_PAGE)
  const scene = mount(sceneSource, 'component', CITY_SCENE)
  page.instance.data.poiId = 'poi-1'

  page.instance.issue()
  scene.instance.issue('poi-1')
  const businessFailure = { code: 500, msg: 'permission denied: /api/verify/citynode/issue' }
  page.requests[0].success(businessFailure)
  scene.requests[0].success(businessFailure)

  assert.equal(scene.instance.data.state, page.instance.data.state)
  assert.equal(scene.instance.data.errorText, page.instance.data.errMsg)

  page.instance.issue()
  scene.instance.issue('poi-1')
  const transportFailure = { statusCode: 502, msg: '/api/verify/citynode/issue upstream timeout' }
  page.requests[1].successStatusAbnormal(transportFailure)
  scene.requests[1].successStatusAbnormal(transportFailure)

  assert.equal(scene.instance.data.state, page.instance.data.state)
  assert.equal(scene.instance.data.errorText, page.instance.data.errMsg)
}

test('qr-citynode 场景与页面同样把业务/HTTP 异常收敛为稳定错误态', () => {
  assertCityFailureParity(read(CITY_SCENE))
})

test('负控：qr-citynode 场景重新按技术 msg 猜错误类型时必须判红', () => {
  const source = read(CITY_SCENE)
  const mutated = source.replace(
    "successStatusAbnormal: () => { if (token === this._issueToken) this.setData({ state: 'error', errorText: ISSUE_ERROR_MESSAGE }) },",
    "successStatusAbnormal: (res) => { if (token === this._issueToken) this.setData({ state: 'error', errorText: /timeout/.test(String(res && res.msg || '')) ? '网络异常，请稍后重试' : ISSUE_ERROR_MESSAGE }) },",
  )
  assert.notEqual(mutated, source, '负控锚点失效：HTTP 异常稳定文案能力不存在')
  assert.throws(() => assertCityFailureParity(mutated), assert.AssertionError)
})

function runVerifiedPolling(source, kind) {
  const relativePath = kind === 'page' ? COUPON_PAGE : COUPON_SCENE
  const harness = mount(source, kind, relativePath)
  harness.instance.data.couponHistoryId = 'coupon-history-1'
  harness.instance.startPolling()
  assert.equal(harness.timers.length, 1)
  harness.timers[0]()
  assert.equal(harness.requests.length, 1)
  harness.requests[0].success({ code: 200, data: { useStatus: 1, useTime: '2026-08-08T12:30:00' } })
  return harness.vibrations
}

function assertCouponFeedbackParity(sceneSource) {
  const pageFeedback = runVerifiedPolling(read(COUPON_PAGE), 'page')
  const sceneFeedback = runVerifiedPolling(sceneSource, 'component')
  assert.deepEqual(sceneFeedback, pageFeedback)
}

test('qr-coupon 场景在轮询确认核销后保留页面的触觉反馈', () => {
  assertCouponFeedbackParity(read(COUPON_SCENE))
})

test('负控：qr-coupon 场景摘掉核销震动时必须判红', () => {
  const source = read(COUPON_SCENE)
  const mutated = source.replace("            if (status === 1 && wx.vibrateShort) wx.vibrateShort({ type: 'medium' })\n", '')
  assert.notEqual(mutated, source, '负控锚点失效：核销震动能力不存在')
  assert.throws(() => assertCouponFeedbackParity(mutated), assert.AssertionError)
})

function componentTag(source, name) {
  const match = source.match(new RegExp(`<${name}\\b[^>]*>`))
  assert.ok(match, `缺少 ${name}`)
  return Object.fromEntries([...match[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]))
}

function bindingName(value) {
  const match = String(value || '').match(/^\{\{\s*([A-Za-z][\w]*)\s*\}\}$/)
  assert.ok(match, '场景标题必须绑定选场态数据，不能退回静态占位')
  return match[1]
}

function assertGroupPickerTitleParity(sceneSource) {
  const harness = mount(sceneSource, 'component', GROUP_SCENE)
  harness.instance.data.topicId = 'topic-1'
  harness.instance.start('', 'topic-1')
  assert.equal(harness.requests.length, 1)
  harness.requests[0].success({
    code: 200,
    data: { activityList: [{ id: 11, name: '上午场' }, { id: 12, name: '下午场' }] },
  })
  assert.equal(harness.instance.data.state, 'selecting')

  const pageTitle = componentTag(read(GROUP_PAGE_WXML), 'cy-page-title')
  const sceneTitle = componentTag(read(GROUP_SCENE_WXML), 'cy-page-title')
  assert.equal(harness.instance.data[bindingName(sceneTitle.title)], pageTitle.title)
  assert.equal(harness.instance.data[bindingName(sceneTitle.subtitle)], pageTitle.subtitle)
  assert.equal(sceneTitle['safe-top'], pageTitle['safe-top'])
}

test('qr-group-code 场景选场态保留页面的标题与副标题语义', () => {
  assertGroupPickerTitleParity(read(GROUP_SCENE))
})

test('负控：qr-group-code 场景摘掉选场标题时必须判红', () => {
  const source = read(GROUP_SCENE)
  const mutated = source.replace(", pickerTitle: '选择场次', pickerSubtitle: '选择本次带队场次'", '')
  assert.notEqual(mutated, source, '负控锚点失效：选场态标题赋值不存在')
  assert.throws(() => assertGroupPickerTitleParity(mutated), assert.AssertionError)
})
