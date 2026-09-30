'use strict'

// R9-40 v3 独立回归:凭证归属(当前 owner + 可见代际 + 券 id)与场景换码 seq 竞态。
// 用真实 Page/Component 定义 + 原始 request 桩(允许在 abort 后仍投递旧回调,复现真实传输竞态)。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// 真实 utils/toast.js 在沙箱外 require,依赖进程级 wx;给失败提示路径一个最小桩。
global.wx = global.wx || { showToast() {}, hideToast() {}, getStorageSync() { return '' } }

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

// 原始请求桩:记录 {opts, aborted},并可在 abort 后仍手工投递旧回调(证明不能只靠 abort)。
function mount(relativePath, kind, options = {}) {
  const requests = []
  const intervals = []
  const events = []
  const owner = options.owner || { value: 'A' }
  const clock = options.clock || { now: Date.parse('2026-09-14T10:00:00+08:00') }
  const app = {
    sendRequest(options) {
      const record = { opts: options, aborted: false }
      record.abort = () => { record.aborted = true }
      requests.push(record)
      return record
    },
    tips() {},
  }
  if (options.identityAvailable !== false) {
    app.getUserID = () => owner.value
    app.globalData = { user_id: owner.value }
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
  vm.runInNewContext(options.source || read(relativePath), sandbox, { filename: relativePath })

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
  if (kind === 'component' && definition.pageLifetimes) {
    Object.entries(definition.pageLifetimes).forEach(([name, fn]) => {
      instance['host_' + name] = fn.bind(instance)
    })
  }
  return { instance, requests, intervals, events, owner, clock }
}

const succeed = (request, data) => {
  request.opts.success({ code: 200, data })
  if (request.opts.complete) request.opts.complete()
}
const fail = (request, msg) => {
  request.opts.fail({ msg: msg || 'network fail' })
  if (request.opts.complete) request.opts.complete()
}
const tokenRequests = (h) => h.requests.filter((r) => r.opts.url.endsWith('/api/coupon/qr-token'))
const PAST = '2026-09-01T00:00:00+08:00'
const paidToken = (qr) => ({ useStatus: 0, qrcodeUrl: qr, expiresIn: 60, startTime: PAST })

// A. 独立页 owner P1:换账号 hide→show 必须先下旧码,失败不得保留旧账号凭证。
test('独立页 owner P1:换账号 hide→show 先下旧码,失败不得保留旧账号凭证', () => {
  const h = mount(QR_PAGE, 'page')
  h.instance.onLoad({ couponHistoryId: '88' })
  h.instance.onShow()
  succeed(h.requests[0], paidToken('ACCOUNT-A-SECRET-QR'))
  assert.equal(h.instance.data.qrState, 'ready')

  h.owner.value = 'B'
  h.instance.onHide()
  h.instance.onShow()
  assert.equal(h.requests.length, 2, 'onShow 必须发当前会话请求')
  assert.equal(h.instance.data.qrcodeUrl, '', '换账号后旧码必须立即下屏')
  assert.equal(h.instance.data.qrState, 'loading', '旧码下屏后进入 loading,而不是 ready')
  assert.ok(!JSON.stringify(h.instance.data).includes('ACCOUNT-A-SECRET-QR'))

  fail(h.requests[1])
  assert.equal(h.instance.data.qrcodeUrl, '', 'B 失败不得保留 A 的凭证')
  assert.notEqual(h.instance.data.qrState, 'ready', '失败不得显示"当前码仍可用"')
  assert.notEqual(h.instance.data.errMsg, '', '失败正文必须可见且可重试')
  assert.ok(!JSON.stringify(h.instance.data).includes('ACCOUNT-A-SECRET-QR'))
})

test('独立页 owner:账号在页存活期变化时在途回包必须丢弃,不写旧 owner 凭证', () => {
  const h = mount(QR_PAGE, 'page')
  h.instance.onLoad({ couponHistoryId: '88' })
  h.instance.onShow()
  const aRequest = h.requests[0]
  h.owner.value = 'B'
  succeed(aRequest, paidToken('ACCOUNT-A-SECRET-QR'))
  assert.equal(h.instance.data.qrcodeUrl, '', 'owner 已变的旧回包不得落屏')

  h.instance.onHide()
  h.instance.onShow()
  succeed(h.requests[1], paidToken('ACCOUNT-B-QR'))
  assert.equal(h.instance.data.qrcodeUrl, 'ACCOUNT-B-QR')
})

test('独立页 owner:同 owner 可见期后台刷新失败仍保留 TTL 内有效码', () => {
  const h = mount(QR_PAGE, 'page')
  h.instance.onLoad({ couponHistoryId: '88' })
  h.instance.onShow()
  succeed(h.requests[0], paidToken('SAME-OWNER-QR'))
  h.instance.data.countdown = 42

  h.instance.refreshToken()
  fail(h.requests[1])
  assert.equal(h.instance.data.qrState, 'ready', '同 owner 后台刷新失败保留有效码能力')
  assert.equal(h.instance.data.qrcodeUrl, 'SAME-OWNER-QR')
})

// E. 场景 retryNow 竞态:每次 refresh 独立 seq/control,旧回调不得覆盖/回退/清新锁。
test('场景 retryNow 竞态:新 seq 成功后旧 success/fail/complete 都不得翻盘', () => {
  const h = mount(QR_SCENE, 'component')
  h.instance.data.couponHistoryId = '71'
  h.instance.start('71')
  const oldRequest = h.requests[0]

  h.instance.retryNow()
  assert.equal(oldRequest.aborted, true)
  assert.equal(h.requests.length, 2, 'retryNow 必须发出新的独立请求')
  succeed(h.requests[1], paidToken('NEW-TOKEN'))
  assert.equal(h.instance.data.qr, 'NEW-TOKEN')

  // abort 不是回调不可达的证明:旧 success 仍被投递时不得覆盖新 token。
  succeed(oldRequest, paidToken('OLD-TOKEN'))
  assert.equal(h.instance.data.qr, 'NEW-TOKEN', '旧 seq 的 success 不得覆盖当前凭证')

  // 旧 fail 不得把已就绪的新码打回 error。
  fail(oldRequest)
  assert.equal(h.instance.data.qrState, 'ready')
  assert.equal(h.instance.data.qr, 'NEW-TOKEN')

  // 旧 complete 不得释放新请求的在途锁(否则可发重复请求)。
  h.instance.retryNow()
  const fresh = h.requests[h.requests.length - 1]
  oldRequest.opts.complete && oldRequest.opts.complete()
  assert.equal(h.instance._refreshingId, '71', '旧 complete 不得清掉新请求的锁')
  succeed(fresh, paidToken('THIRD-TOKEN'))
  assert.equal(h.instance.data.qr, 'THIRD-TOKEN')
})

test('场景 owner:宿主页 hide→show 换代,旧 owner 码下屏且旧回包丢弃', () => {
  const h = mount(QR_SCENE, 'component')
  h.instance.data.couponHistoryId = '71'
  h.instance.start('71')
  succeed(h.requests[0], paidToken('SCENE-A-SECRET-QR'))
  assert.equal(h.instance.data.qr, 'SCENE-A-SECRET-QR')

  h.owner.value = 'B'
  h.instance.host_hide()
  h.instance.host_show()
  assert.equal(h.instance.data.qr, '', '宿主页重见后旧 owner 码必须先下屏')
  assert.equal(h.instance.data.qrState, 'loading')
  const bRequest = h.requests[h.requests.length - 1]
  fail(bRequest)
  assert.ok(!JSON.stringify(h.instance.data).includes('SCENE-A-SECRET-QR'), 'B 失败不得保留 A 凭证')
  assert.notEqual(h.instance.data.qrState, 'ready')
})

// G. 钱包:未来等待→到点→过期/已核销 + 两账号切换,全程不触发核销/状态请求。
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
  return { instance, sandbox }
}

test('钱包:未来券等待→到点→失败恢复/过期/已核销,两账号切换不触发核销', () => {
  const h = loadWallet()
  h.instance.load()
  h.sandbox.requests[0].success({ code: 200, data: [
    { id: 1, couponName: 'A未来券', useStatus: 0, startTime: '2099-01-01', endTime: '2099-01-03' },
    { id: 2, couponName: 'A已过期', useStatus: 2, endTime: '2099-01-03' },
    { id: 3, couponName: 'A已核销', useStatus: 1, endTime: '2099-01-03' },
  ] })
  assert.equal(h.instance.data.all[0]._canView, true)
  assert.equal(h.instance.data.all[0]._isUsable, false)
  assert.equal(h.instance.data.all[1]._canView, false)
  assert.equal(h.instance.data.all[2]._canView, false)
  h.instance.openCode({ currentTarget: { dataset: { item: h.instance.data.all[0] } } })
  assert.deepEqual(h.sandbox.events.map((e) => e.name), ['open'], '未来券可进等待详情,不触发核销')

  // 两账号切换:第一次请求还在途时切到 B 并重新 load,旧 A 回包不得覆盖 B 列表。
  h.instance.load()
  h.instance.load()
  const staleA = h.sandbox.requests[1]
  const freshB = h.sandbox.requests[2]
  freshB.success({ code: 200, data: [{ id: 9, couponName: 'B券', useStatus: 0, startTime: '2020-01-01', endTime: '2099-01-03' }] })
  staleA.success({ code: 200, data: [{ id: 1, couponName: 'A未来券', useStatus: 0, startTime: '2099-01-01', endTime: '2099-01-03' }] })
  assert.deepEqual(h.instance.data.all.map((item) => item.couponName), ['B券'], '旧账号列表回包不得覆盖当前列表')
  assert.equal(h.instance.data.all[0]._isUsable, true, '到点券可出示')

  const urls = h.sandbox.requests.map((r) => r.url)
  assert.deepEqual([...new Set(urls)], ['/api/coupon/myrecvlist'], '钱包链路不触发核销/状态接口')
})

test('场景 owner:同 owner 手动重试失败仍保留 TTL 内有效码', () => {
  const h = mount(QR_SCENE, 'component')
  h.instance.data.couponHistoryId = '71'
  h.instance.start('71')
  succeed(h.requests[0], paidToken('SCENE-KEEP-QR'))
  assert.equal(h.instance.data.countdown, 60)

  h.instance.retryNow()
  fail(h.requests[1])
  assert.equal(h.instance.data.qrState, 'ready', '同 owner 有效码不得被一次刷新失败遮掉')
  assert.equal(h.instance.data.qr, 'SCENE-KEEP-QR')
})

test('钱包:加载失败可重试恢复', () => {
  const h = loadWallet()
  h.instance.load()
  h.sandbox.requests[0].fail({ msg: 'network' })
  assert.equal(h.instance.data.state, 'error')

  h.instance.retry()
  assert.equal(h.sandbox.requests.length, 2)
  h.sandbox.requests[1].success({ code: 200, data: [{ id: 5, couponName: '恢复券', useStatus: 0, startTime: '2020-01-01', endTime: '2099-01-03' }] })
  assert.equal(h.instance.data.state, 'ready')
  assert.deepEqual(h.instance.data.all.map((item) => item.couponName), ['恢复券'])
})

test('负控:独立页 stale 去掉 owner 校验时,旧 owner 在途回包必须能落屏', () => {
  const source = read(QR_PAGE)
  const mutated = source.replace('\n      || owner !== currentOwnerId();', ';')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 owner 校验')
  const h = mount(QR_PAGE, 'page', { source: mutated, owner: { value: 'A' } })
  h.instance.onLoad({ couponHistoryId: '88' })
  h.instance.onShow()
  const inFlight = h.requests[0]
  h.owner.value = 'B'
  succeed(inFlight, paidToken('ACCOUNT-A-SECRET-QR'))
  assert.throws(() => assert.equal(h.instance.data.qrcodeUrl, ''), assert.AssertionError)
})

test('负控:独立页 onShow 不清理已渲染旧码时必须判红', () => {
  const source = read(QR_PAGE)
  const mutated = source.replace('    if (!this._keepRenderedCredential()) this._clearRenderedCredential();\n    this.refreshToken();', '    this.refreshToken();')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 onShow 清理')
  const sandbox = { requests: [], events: [] }
  const app = { sendRequest: (options) => sandbox.requests.push({ opts: options }), getUserID: () => 'B' }
  let definition
  const context = {
    Date, console,
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    wx: { vibrateShort() {}, navigateBack() {}, reLaunch() {} },
    setInterval() { return 1 }, clearInterval() {},
    require(id) { return require(path.resolve(path.dirname(path.join(ROOT, QR_PAGE)), id)) },
    Page(options) { definition = options },
  }
  vm.runInNewContext(mutated, context, { filename: QR_PAGE })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  page.onLoad({ couponHistoryId: '88' })
  page.onShow()
  sandbox.requests[0].opts.success({ code: 200, data: paidToken('ACCOUNT-A-SECRET-QR') })
  sandbox.requests[0].opts.complete && sandbox.requests[0].opts.complete()
  page.onHide()
  page.onShow()
  assert.throws(() => assert.equal(page.data.qrcodeUrl, ''), assert.AssertionError)
})

test('负控:场景 refresh 不校验独立 seq 时旧回调必须能覆盖(证明门禁可红)', () => {
  const source = read(QR_SCENE)
  const mutated = source.replace(/seq === this\._refreshSeq/g, 'true')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 seq 校验')
  const sandbox = { requests: [], intervals: [] }
  const app = { getUserID: () => 'member-A', sendRequest(options) { const r = { opts: options, aborted: false, abort() { r.aborted = true } }; sandbox.requests.push(r); return r } }
  let definition
  const context = {
    Date, console,
    getApp: () => app,
    wx: { vibrateShort() {} },
    setInterval(fn) { sandbox.intervals.push(fn); return sandbox.intervals.length }, clearInterval() {},
    require(id) { return require(path.resolve(path.dirname(path.join(ROOT, QR_SCENE)), id)) },
    Component(options) { definition = options },
  }
  vm.runInNewContext(mutated, context, { filename: QR_SCENE })
  const instance = Object.assign({}, definition.methods, { data: JSON.parse(JSON.stringify(definition.data)) })
  instance.setData = (patch) => Object.entries(patch).forEach(([k, v]) => setByPath(instance.data, k, v))
  instance.triggerEvent = () => {}
  instance.data.couponHistoryId = '71'
  instance.start('71')
  const old = sandbox.requests[0]
  instance.retryNow()
  const fresh = sandbox.requests[1]
  const done = (r, qr) => { r.opts.success({ code: 200, data: paidToken(qr) }); r.opts.complete && r.opts.complete() }
  done(fresh, 'NEW-TOKEN')
  done(old, 'OLD-TOKEN')
  assert.throws(() => assert.equal(instance.data.qr, 'NEW-TOKEN'), assert.AssertionError)
})
