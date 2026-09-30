'use strict'

// R9-40 v2 独立回归(§NoGo-1/2/3):持券列表"可查看 vs 可核销"分离、到点换码失败受控恢复、
// 独立页生命周期废在途并允许 show 重发。用真实 Page/Component 定义 + 真实
// utils/transport/request-client.js(假 wx.request),不依赖被测模块内部的测试挂钩。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')
const { createRequestClient } = require('../../utils/transport/request-client.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const WALLET = 'components/cy/scene-game-coupon-wallet/index.js'
const QR_SCENE = 'components/cy/scene-qr-coupon/index.js'
const QR_PAGE = 'subpackageMember/coupon-qr/index.js'

function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

// mount(real Page/Component) with a request harness.
// mode 'client': 真实 request-client 包一层假 wx.request(可 abort)。
// mode 'plain' : 只记录 options 并返回 undefined(模拟不暴露 abort 的通道),用于代际负控。
function mount(relativePath, kind, options = {}) {
  const mode = options.mode || 'client'
  const requests = []
  const intervals = []
  const events = []
  const clock = options.clock || { now: Date.parse('2026-09-14T08:59:58+08:00') }
  let client = null
  const app = {
    getUserID: () => 'member-A', // 合法读取夹具明确当前账号；缺账号另有负控。
    sendRequest(options) {
      if (mode === 'plain') {
        requests.push(options)
        return undefined
      }
      return client.send(options)
    },
    tips() {},
  }
  if (mode === 'client') {
    client = createRequestClient({
      wxRequest(opts) {
        const record = { opts, aborted: false }
        record.task = { abort() { record.aborted = true } }
        requests.push(record)
        return record.task
      },
      getBaseUrl: () => 'https://example.test',
      getAuthorization: () => 'Bearer test',
      getErrorMessage: (res, fallback) => (res && res.msg) || fallback,
      shouldAutoToast: () => false,
      showToast() {},
      hideToast() {},
    })
  }

  let definition
  class TestDate extends Date { static now() { return clock.now } }
  const sandbox = {
    Date: TestDate,
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    wx: { vibrateShort() {}, navigateBack() {}, reLaunch() {}, showToast() {} },
    setInterval(callback) { intervals.push(callback); return intervals.length },
    clearInterval() {},
    require(id) {
      if (!id.startsWith('.')) return require(id)
      return require(path.resolve(path.dirname(path.join(ROOT, relativePath)), id))
    },
    Page(options) { definition = options },
    Component(options) { definition = options },
    console,
  }
  vm.runInNewContext(read(relativePath), sandbox, { filename: relativePath })

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback.call(this)
    },
    triggerEvent(name, detail) { events.push({ name, detail }) },
  }
  const methods = kind === 'component' ? definition.methods : definition
  Object.entries(methods).forEach(([name, fn]) => { if (typeof fn === 'function') instance[name] = fn.bind(instance) })
  return { instance, requests, intervals, events, clock }
}

function succeed(request, data) {
  const res = { statusCode: 200, data: { code: 200, data } }
  request.opts.success(res)
  if (request.opts.complete) request.opts.complete(res)
}
function fail(request, msg) {
  const res = { errMsg: msg || 'request:fail timeout' }
  request.opts.fail(res)
  if (request.opts.complete) request.opts.complete(res)
}

const CLOCK_BEFORE = Date.parse('2026-09-14T08:59:58+08:00')
const CLOCK_AFTER = Date.parse('2026-09-14T09:00:05+08:00')
const FUTURE_START = '2026-09-14T09:00:00+08:00'
const futureToken = { useStatus: 0, qrcodeUrl: 'future-qr', expiresIn: 1, startTime: FUTURE_START }
const startedToken = { useStatus: 0, qrcodeUrl: 'started-qr', expiresIn: 60, startTime: FUTURE_START, couponName: '未来券' }

function futureCouponRow(extra = {}) {
  return { id: 70, couponName: '未来券', couponDescription: '完整说明', useStatus: 0, startTime: '2099-01-01', endTime: '2099-01-02', ...extra }
}

function loadWallet(rows) {
  const sandbox = { requests: [], events: [] }
  global.getApp = () => ({ getUserID: () => 'member-A', sendRequest: (options) => sandbox.requests.push(options) })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {}
  delete require.cache[require.resolve(path.join(ROOT, WALLET))]
  require(path.join(ROOT, WALLET))
  const instance = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent(name, detail) { sandbox.events.push({ name, detail }) },
  })
  instance.data = JSON.parse(JSON.stringify(sandbox.def.data))
  instance.load()
  sandbox.requests[0].success({ code: 200, data: rows })
  return { instance, sandbox }
}

test('钱包 NoGo-1:未来券仍可打开等待详情(可查看),但不得被当成可核销亮码', () => {
  const { instance, sandbox } = loadWallet([
    futureCouponRow(),
    { id: 71, couponName: '已用券', useStatus: 1, endTime: '2099-01-02' },
    { id: 72, couponName: '过期券', useStatus: 2, endTime: '2099-01-02' },
  ])

  const future = instance.data.all[0]
  assert.equal(future._canView, true, '未来券必须保留查看入口')
  assert.equal(future._isUsable, false, '未来券不得标记为可核销/可亮码')

  instance.openCode({ currentTarget: { dataset: { item: future } } })
  assert.deepEqual(sandbox.events.map((e) => e.name), ['open'], '未来券点击必须能进入等待详情')

  instance.openCode({ currentTarget: { dataset: { item: instance.data.all[1] } } })
  instance.openCode({ currentTarget: { dataset: { item: instance.data.all[2] } } })
  assert.equal(sandbox.events.length, 1, '已用/过期券不承担开码入口')

  const wxml = read('components/cy/scene-game-coupon-wallet/index.wxml')
  assert.match(wxml, /item\._canView/, '卡片入口由可查看驱动')
  assert.match(wxml, /item\._isUsable \? '出示核销码'/, '只有可核销才显示出示核销码')
  assert.match(wxml, /查看可用时间/, '未来券入口文案需说明是查看而非亮码')
})

test('钱包负控:把可查看退回可核销判定时,未来券入口必须判红', () => {
  const source = read(WALLET)
  const mutated = source.replace('_canView: status === 0,', '_canView: status === 0 && started,')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 _canView')
  const sandbox = { requests: [], events: [] }
  global.getApp = () => ({ getUserID: () => 'member-A', sendRequest: (options) => sandbox.requests.push(options) })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {}
  vm.runInNewContext(mutated, {
    getApp: global.getApp,
    Component: global.Component,
    wx: global.wx,
    require(id) { return require(path.resolve(path.dirname(path.join(ROOT, WALLET)), id)) },
  })
  const instance = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent(name, detail) { sandbox.events.push({ name, detail }) },
  })
  instance.data = JSON.parse(JSON.stringify(sandbox.def.data))
  instance.load()
  sandbox.requests[0].success({ code: 200, data: [futureCouponRow()] })
  instance.openCode({ currentTarget: { dataset: { item: instance.data.all[0] } } })
  assert.throws(() => assert.deepEqual(sandbox.events.map((e) => e.name), ['open']), assert.AssertionError)
})

test('场景 NoGo-2:start 前换码失败后受控自动重试,取得新 token 才亮码;等待壳可重试', () => {
  const h = mount(QR_SCENE, 'component', { clock: { now: CLOCK_BEFORE } })
  h.instance.data.couponHistoryId = '71'
  h.instance.start('71')
  succeed(h.requests[0], futureToken)
  assert.equal(h.instance.data.notStarted, true)

  h.intervals[1]() // countdown 到点 → 换码
  assert.equal(h.requests.filter((r) => r.opts.url.endsWith('/api/coupon/qr-token')).length, 2)
  fail(h.requests[1])
  assert.equal(h.instance.data.qrState, 'error')
  assert.notEqual(h.instance.data.errorText, '', '失败正文必须可见')

  // 越过 start 后,受控重试必须再次真正请求 token(不能永久冻结在 error)
  h.clock.now = CLOCK_AFTER
  h.intervals[1]()
  assert.equal(h.requests.filter((r) => r.opts.url.endsWith('/api/coupon/qr-token')).length, 3,
    '到点失败后必须在下一个受控节拍重新请求 token')
  succeed(h.requests[2], startedToken)
  assert.equal(h.instance.data.notStarted, false)
  assert.equal(h.instance.data.qrState, 'ready')
  assert.equal(h.instance.data.qr, 'started-qr')
  assert.equal(h.instance.data.errorText, '', '恢复成功后不得复述旧失败正文')

  const wxml = read('components/cy/scene-qr-coupon/index.wxml')
  const waiting = wxml.match(/<cy-empty wx:elif="\{\{useStatus === 0 && notStarted\}\}"[^>]*>/)[0]
  assert.match(waiting, /bind:cta="retryNow"/, '等待壳必须提供可重试动作')
  assert.match(wxml, /bind:retry="retryNow"/, '码卡错误态重试也要清退避')
})

test('独立页 NoGo-2:start 前换码失败后受控自动重试,新 token 成功才亮码;等待壳可重试', () => {
  const h = mount(QR_PAGE, 'page', { clock: { now: CLOCK_BEFORE } })
  h.instance.onLoad({ couponHistoryId: '72' })
  h.instance.onShow()
  succeed(h.requests[0], futureToken)
  assert.equal(h.instance.data.notStarted, true)

  h.intervals[0]() // countdown 到点 → 换码
  assert.equal(h.requests.filter((r) => r.opts.url.endsWith('/api/coupon/qr-token')).length, 2)
  fail(h.requests[1])
  assert.equal(h.instance.data.qrState, 'error')
  assert.notEqual(h.instance.data.errMsg, '', '失败正文必须可见')

  h.clock.now = CLOCK_AFTER
  h.intervals[0]() // 受控重试
  assert.equal(h.requests.filter((r) => r.opts.url.endsWith('/api/coupon/qr-token')).length, 3,
    '到点失败后必须自动重发 token,而不是永久冻结')
  succeed(h.requests[2], startedToken)
  assert.equal(h.instance.data.notStarted, false)
  assert.equal(h.instance.data.qrState, 'ready')
  assert.equal(h.instance.data.qrcodeUrl, 'started-qr')
  assert.equal(h.instance.data.errMsg, '', '恢复成功后等待壳不得复述旧失败正文')

  const wxml = read('subpackageMember/coupon-qr/index.wxml')
  const waitingStart = wxml.lastIndexOf('<cy-state-shell', wxml.indexOf("entryState === 'ready' && useStatus == 0 && notStarted"))
  const waiting = wxml.slice(waitingStart, wxml.indexOf('/>', waitingStart) + 2)
  assert.match(waiting, /bind:primary="retryNow"/, '等待壳必须提供可重试动作')
  assert.match(wxml, /bind:retry="retryNow"/, '码卡错误态重试也要清退避')
})

test('独立页 NoGo-3:onHide/onUnload 废在途,onShow 能发当前请求,旧响应不落屏', () => {
  const h = mount(QR_PAGE, 'page', { clock: { now: Date.parse('2026-09-14T10:00:00+08:00') } })
  h.instance.onLoad({ couponHistoryId: 'account-a-coupon' })
  h.instance.onShow()
  assert.equal(h.requests.length, 1)
  const oldRequest = h.requests[0]

  h.instance.onHide()
  assert.equal(oldRequest.aborted, true, 'onHide 必须中止在途 token 请求')
  h.instance.onShow()
  assert.equal(h.requests.length, 2, 'onShow 必须能立即发当前请求,不被旧 _refreshing 挡住')

  succeed(oldRequest, { useStatus: 0, qrcodeUrl: 'account-a-qr', expiresIn: 60, startTime: FUTURE_START })
  assert.equal(h.instance.data.qrcodeUrl, '', '被中止/旧代际的响应不得落屏')

  succeed(h.requests[1], { useStatus: 0, qrcodeUrl: 'account-a-refreshed-qr', expiresIn: 60, startTime: '2026-09-14T09:00:00+08:00' })
  assert.equal(h.instance.data.qrcodeUrl, 'account-a-refreshed-qr')
  assert.equal(h.instance.data.qrState, 'ready')

  h.instance.onUnload()
  const beforeUnload = h.instance.data.qrcodeUrl
  succeed(h.requests[1], { useStatus: 0, qrcodeUrl: 'late-after-unload', expiresIn: 60, startTime: '2026-09-14T09:00:00+08:00' })
  assert.equal(h.instance.data.qrcodeUrl, beforeUnload, 'onUnload 后迟到响应不得再写页面')
})

test('独立页代际负控:通道不暴露 abort 时,旧响应仍必须被代际守卫丢弃', () => {
  const h = mount(QR_PAGE, 'page', { mode: 'plain', clock: { now: Date.parse('2026-09-14T10:00:00+08:00') } })
  h.instance.onLoad({ couponHistoryId: 'account-b-coupon' })
  h.instance.onShow()
  const oldOptions = h.requests[0]
  h.instance.onHide()
  h.instance.onShow()
  assert.equal(h.requests.length, 2)

  oldOptions.success({ code: 200, data: { useStatus: 0, qrcodeUrl: 'stale-qr', expiresIn: 60, startTime: FUTURE_START } })
  assert.equal(h.instance.data.qrcodeUrl, '', '没有 abort 通道时必须靠请求代际挡住旧回包')
  h.requests[1].success({ code: 200, data: { useStatus: 0, qrcodeUrl: 'fresh-qr', expiresIn: 60, startTime: FUTURE_START } })
  assert.equal(h.instance.data.qrcodeUrl, 'fresh-qr')
})
