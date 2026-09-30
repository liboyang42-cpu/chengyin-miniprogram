'use strict'

// R9-40 服务端使用期闸门的客户端一侧:持券列表展示可使用日期、start 前不出码。
// 服务端拒绝的权威证据在 Java 测试;这里只验前端不误把 start 前的券当可用/已过期。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { flattenComponentToPage } = require('../helpers/component-as-page.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const WALLET = 'components/cy/scene-game-coupon-wallet/index.js'
const QR_SCENE = 'components/cy/scene-qr-coupon/index.js'
const QR_PAGE = 'subpackageMember/coupon-qr/index.js'

const FUTURE = '2099-01-01 09:00:00'
const PAST = '2020-01-01 09:00:00'

function loadWallet(rows) {
  const sandbox = { requests: [], events: [] }
  global.getApp = () => ({ getUserID: () => 'member-A', sendRequest: (options) => sandbox.requests.push(options) })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {}
  delete require.cache[require.resolve(path.join(ROOT, WALLET))]
  require(path.join(ROOT, WALLET))
  const vmInstance = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent(name, detail) { sandbox.events.push({ name, detail }) },
  })
  vmInstance.data = JSON.parse(JSON.stringify(sandbox.def.data))
  vmInstance.load()
  sandbox.requests[0].success({ code: 200, data: rows })
  return { vm: vmInstance, sandbox }
}

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
  const app = { getUserID: () => 'member-A', sendRequest(options) { requests.push(options) } }
  let definition
  const sandbox = {
    getApp() { return app },
    getCurrentPages() { return [{}, {}] },
    wx: { vibrateShort(options) { vibrations.push(options && options.type) } },
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
  return { instance, requests }
}

test('持券列表:start 前展示可使用日期并可查看等待详情,但不亮码;start 后可出码', () => {
  const { vm, sandbox } = loadWallet([
    { id: 1, couponName: '未来券', useStatus: 0, startTime: FUTURE, endTime: '2099-01-03' },
    { id: 2, couponName: '已开始券', useStatus: 0, startTime: PAST, endTime: '2099-01-03' },
    { id: 3, couponName: '无开始时间历史券', useStatus: 0, endTime: '2099-01-03' },
  ])

  const future = vm.data.all[0]
  assert.equal(future._isUsable, false, 'start 前不得标记可核销')
  assert.equal(future._canView, true, 'start 前必须保留查看入口')
  assert.match(future._dateText, /2099\.01\.01 起可用/, 'start 前按日展示可用日期(全站 YYYY.MM.DD)')
  assert.doesNotMatch(future._dateText, /09:00/, '有效期展示不带时刻(2026-09-17 拍板)')
  assert.match(future._dateText, /有效期至 2099\.01\.03/)

  assert.equal(vm.data.all[1]._isUsable, true)
  assert.equal(vm.data.all[1]._dateText, '有效期至 2099.01.03', '已开始券沿用同日展示口径')

  assert.equal(vm.data.all[2]._isUsable, true, '无 start_time 的合法历史券必须兼容为可用')

  vm.openCode({ currentTarget: { dataset: { item: future } } })
  assert.deepEqual(sandbox.events.map((event) => event.name), ['open'],
    'start 前点卡片必须能进等待详情(可查看),只是不亮码')
  vm.openCode({ currentTarget: { dataset: { item: vm.data.all[1] } } })
  assert.deepEqual(sandbox.events.map((event) => event.name), ['open', 'open'])
})

test('负控:持券列表忽略 start_time 一律标记可用时必须判红', () => {
  const source = read(WALLET)
  const mutated = source.replace('_isUsable: status === 0 && started,', '_isUsable: status === 0,')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 start 闸门')
  const sandbox = { requests: [], events: [] }
  global.getApp = () => ({ getUserID: () => 'member-A', sendRequest: (options) => sandbox.requests.push(options) })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {}
  delete require.cache[require.resolve(path.join(ROOT, WALLET))]
  vm.runInNewContext(mutated, {
    require(id) { return require(path.resolve(path.dirname(path.join(ROOT, WALLET)), id)) },
    getApp: global.getApp,
    Component: global.Component,
    wx: global.wx,
    module: { exports: {} },
    exports: {},
  })
  const instance = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent() {},
  })
  instance.data = JSON.parse(JSON.stringify(sandbox.def.data))
  instance.load()
  sandbox.requests[0].success({ code: 200, data: [{ id: 1, useStatus: 0, startTime: FUTURE, endTime: '2099-01-03' }] })
  assert.throws(() => assert.equal(instance.data.all[0]._isUsable, false), assert.AssertionError)
})

test('场景出码:qr-token 带未来 start 时进入等待态,不亮码也不说已过期', () => {
  const { instance, requests } = mount(read(QR_SCENE), 'component', QR_SCENE)
  instance.start('7')
  requests[0].success({ code: 200, data: { useStatus: 0, qrcodeUrl: 'https://example.test/qr.png', expiresIn: 60, startTime: '2099-01-01T09:00:00.000+08:00', endTime: '2099-01-03T18:00:00.000+08:00' } })

  assert.equal(instance.data.notStarted, true, '判定仍用完整时间:09:00 还没到')
  assert.equal(instance.data.startText, '2099.01.01', '有效期展示只到日')
  assert.equal(instance.data.useStatus, 0)

  const wxml = read('components/cy/scene-qr-coupon/index.wxml')
  assert.match(wxml, /useStatus === 0 && notStarted/, '等待分支必须由 notStarted 驱动')
  assert.match(wxml, /还没到可用时间/)
  assert.match(wxml, /useStatus === 1 \|\| useStatus === 2 \|\| useStatus === 3/, '结果态只在已核销/已过期/已失效时出现')
})

test('页面出码:qr-token 带未来 start 时不出码,展示可用时间', () => {
  const { instance, requests } = mount(read(QR_PAGE), 'page', QR_PAGE)
  instance.onLoad({ couponHistoryId: 7 })
  instance.refreshToken()
  requests[0].success({ code: 200, data: { useStatus: 0, qrcodeUrl: 'https://example.test/qr.png', expiresIn: 60, startTime: '2099-01-01T09:00:00.000+08:00', endTime: '2099-01-03T18:00:00.000+08:00' } })

  assert.equal(instance.data.notStarted, true)
  assert.equal(instance.data.coupon.startTimeText, '2099.01.01', '有效期展示只到日')

  const wxml = read('subpackageMember/coupon-qr/index.wxml')
  assert.match(wxml, /useStatus == 0 && notStarted/, '等待壳必须由 notStarted 驱动')
  assert.match(wxml, /!notStarted/, '码凭证必须被 notStarted 阻断')
  assert.match(wxml, /起可使用/)
})

test('负控:出码页忽略 start 继续亮码时必须判红', () => {
  const source = read(QR_PAGE)
  const mutated = source.replace('patch.notStarted = that.notStartedAt(d.startTime);', 'patch.notStarted = false;')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 notStarted 计算')
  const { instance, requests } = mount(mutated, 'page', QR_PAGE)
  instance.onLoad({ couponHistoryId: 7 })
  instance.refreshToken()
  requests[0].success({ code: 200, data: { useStatus: 0, qrcodeUrl: 'https://example.test/qr.png', expiresIn: 60, startTime: '2099-01-01T09:00:00.000+08:00' } })
  assert.throws(() => assert.equal(instance.data.notStarted, true), assert.AssertionError)
})
