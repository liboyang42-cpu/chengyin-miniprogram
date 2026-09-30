'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function mount(relativePath, appOverrides, wxOverrides) {
  const requests = []
  const timers = []
  const vibrations = []
  const app = Object.assign({
    sendRequest(options) { requests.push(options) },
    getPageSize() { return 20 },
    getUserID() { return 7 },
  }, appOverrides || {})
  const wx = Object.assign({
    vibrateShort(options) { vibrations.push(options && options.type) },
    showToast() {},
  }, wxOverrides || {})
  let definition
  const absolutePath = path.join(ROOT, relativePath)
  const sandbox = {
    Date,
    Math,
    Promise,
    String,
    Number,
    Array,
    Object,
    JSON,
    getApp() { return app },
    wx,
    setInterval(callback) { timers.push(callback); return timers.length },
    clearInterval() {},
    require(id) {
      if (!id.startsWith('.')) return require(id)
      return require(path.resolve(path.dirname(absolutePath), id))
    },
    Component(options) { definition = options },
  }
  // behaviors/*.js 靠小程序的全局 Behavior() 注册,Node 里没有这个全局。
  // 沿用仓内既有写法(roam-scene-port-contract):临时挂上再还原。
  const previousBehavior = global.Behavior
  global.Behavior = (config) => config
  try {
    vm.runInNewContext(read(relativePath), sandbox, { filename: absolutePath })
  } finally {
    global.Behavior = previousBehavior
  }
  // behavior 提供的 properties 默认值与 methods 同样要进实例,否则组件调用它们会炸。
  const behaviors = Array.isArray(definition.behaviors) ? definition.behaviors : []
  const behaviorData = {}
  const behaviorMethods = {}
  behaviors.forEach((behavior) => {
    if (!behavior || typeof behavior !== 'object') return
    Object.entries(behavior.properties || {}).forEach(([key, spec]) => {
      behaviorData[key] = spec && typeof spec === 'object' ? spec.value : undefined
    })
    Object.assign(behaviorMethods, behavior.methods || {})
  })
  const instance = {
    data: JSON.parse(JSON.stringify(Object.assign({}, behaviorData, definition.data || {}))),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback()
    },
    triggerEvent() {},
  }
  Object.entries(Object.assign({}, behaviorMethods, definition.methods || {})).forEach(([name, method]) => {
    instance[name] = method.bind(instance)
  })
  return { instance, requests, timers, vibrations }
}

test('券码切换记录时立即请求新券，旧响应不得覆盖当前券', () => {
  const relativePath = 'components/cy/scene-qr-coupon/index.js'
  const harness = mount(relativePath)

  harness.instance.data.couponHistoryId = 'old-1'
  harness.instance.start('old-1')
  assert.equal(harness.requests.length, 1)

  harness.instance.data.couponHistoryId = 'new-2'
  harness.instance.start('new-2')
  assert.equal(harness.requests.length, 2, '切换券记录不能被上一张券的刷新锁挡住')

  harness.requests[1].success({
    code: 200,
    data: { qrcodeUrl: 'new-qr', couponName: '新券', expiresIn: 45, useStatus: 0 },
  })
  harness.requests[0].success({
    code: 200,
    data: { qrcodeUrl: 'old-qr', couponName: '旧券', expiresIn: 45, useStatus: 0 },
  })

  assert.equal(harness.instance.data.qr, 'new-qr')
  assert.equal(harness.instance.data.couponName, '新券')
  assert.equal(harness.instance.data.qrState, 'ready')
})

test('券码只接受明确的未使用/已核销/已过期状态，未知状态和无效倒计时不得伪装终态', () => {
  const relativePath = 'components/cy/scene-qr-coupon/index.js'

  const unknown = mount(relativePath)
  unknown.instance.data.couponHistoryId = 'coupon-1'
  unknown.instance.start('coupon-1')
  unknown.requests[0].success({
    code: 200,
    data: { qrcodeUrl: 'qr', couponName: '未确认券', expiresIn: 60, useStatus: 'mystery' },
  })
  assert.equal(unknown.instance.data.qrState, 'error')
  assert.equal(unknown.instance.data.useStatus, null)

  const noTtl = mount(relativePath)
  noTtl.instance.data.couponHistoryId = 'coupon-2'
  noTtl.instance.start('coupon-2')
  noTtl.requests[0].success({
    code: 200,
    data: { qrcodeUrl: 'qr', couponName: '倒计时未知券', expiresIn: 0, useStatus: 0 },
  })
  assert.equal(noTtl.instance.data.qrState, 'error')
  assert.equal(noTtl.instance.data.countdown, 0)

  const wxml = read('components/cy/scene-qr-coupon/index.wxml')
  assert.match(wxml, /useStatus === 1 \|\| useStatus === 2/)
  assert.doesNotMatch(wxml, /\? '已核销' : '该券已过期'/)
})

test('券码轮询失败保留有效二维码，且终态不得被迟到的出码响应回滚', () => {
  const relativePath = 'components/cy/scene-qr-coupon/index.js'
  const resilient = mount(relativePath)
  resilient.instance.data.couponHistoryId = 'coupon-ready'
  resilient.instance.start('coupon-ready')
  resilient.requests[0].success({
    code: 200,
    data: { qrcodeUrl: 'ready-qr', couponName: '可用券', expiresIn: 60, useStatus: 0 },
  })
  resilient.timers[0]()
  resilient.requests[1].successStatusAbnormal({ msg: 'upstream 502' })
  assert.equal(resilient.instance.data.qrState, 'ready')
  assert.equal(resilient.instance.data.qr, 'ready-qr')
  assert.match(resilient.instance.data.pollError, /网络|核销状态/)

  const terminal = mount(relativePath)
  terminal.instance.data.couponHistoryId = 'coupon-terminal'
  terminal.instance.start('coupon-terminal')
  terminal.timers[0]()
  terminal.requests[1].success({ code: 200, data: { useStatus: 1, useTime: '2026-08-23 10:00:00' } })
  terminal.requests[0].success({
    code: 200,
    data: { qrcodeUrl: 'late-qr', couponName: '迟到券', expiresIn: 60, useStatus: 0 },
  })
  assert.equal(terminal.instance.data.useStatus, 1)
  assert.equal(terminal.instance.data.resultText, '已核销')

  const wxml = read('components/cy/scene-qr-coupon/index.wxml')
  assert.match(wxml, /<cy-inline-error[^>]*pollError/)
})

test('据点核销码切换据点后忽略上一据点的迟到响应', () => {
  const relativePath = 'components/cy/scene-qr-citynode/index.js'
  const harness = mount(relativePath)

  harness.instance.data.poiId = '21'
  harness.instance.issue('21')
  harness.instance.data.poiId = '22'
  harness.instance.issue('22')
  assert.equal(harness.requests.length, 2)

  harness.requests[1].success({ code: 200, data: { qrcodeUrl: 'new-qr', code: 'NEW', ttlMs: 60000 } })
  harness.requests[0].success({ code: 200, data: { qrcodeUrl: 'old-qr', code: 'OLD', ttlMs: 60000 } })

  assert.equal(harness.instance.data.qr, 'new-qr')
  assert.equal(harness.instance.data.code, 'NEW')
})

test('据点核销码和团码缺少真实 TTL 时进入错误态，不默认续成五分钟', () => {
  const city = mount('components/cy/scene-qr-citynode/index.js')
  city.instance.data.poiId = 'poi-1'
  city.instance.issue('poi-1')
  city.requests[0].success({ code: 200, data: { qrcodeUrl: 'city-qr', code: 'CITY' } })
  assert.equal(city.instance.data.state, 'error')
  assert.equal(city.instance.data.countdown, 0)

  const group = mount('components/cy/scene-qr-group-code/index.js')
  group.instance.data.currentActivityId = '22'
  group.instance.issue()
  group.requests[0].success({ code: 200, data: { qrcodeUrl: 'group-qr', code: 'GROUP', ttlMs: 0 } })
  assert.equal(group.instance.data.state, 'error')
  assert.equal(group.instance.data.countdown, 0)

  assert.doesNotMatch(read('components/cy/scene-qr-citynode/index.js'), /ttlMs \|\| 300000/)
  assert.doesNotMatch(read('components/cy/scene-qr-group-code/index.js'), /ttlMs \|\| 300000/)
})

test('团码选场切换路线后忽略旧路线响应，并给失败态真实重试入口', () => {
  const relativePath = 'components/cy/scene-qr-group-code/index.js'
  const harness = mount(relativePath)

  harness.instance.data.topicId = 'topic-old'
  harness.instance.start('', 'topic-old')
  harness.instance.data.topicId = 'topic-new'
  harness.instance.start('', 'topic-new')
  assert.equal(harness.requests.length, 2)

  harness.requests[1].success({ code: 200, data: { activityList: [{ id: 22, name: '新路线场次甲' }, { id: 23, name: '新路线场次乙' }] } })
  harness.requests[0].success({ code: 200, data: { activityList: [{ id: 11, name: '旧路线场次甲' }, { id: 12, name: '旧路线场次乙' }] } })
  assert.deepEqual(harness.instance.data.options.map((item) => item.id), [22, 23])

  const wxml = read('components/cy/scene-qr-group-code/index.wxml')
  assert.match(wxml, /<cy-error[^>]*state === 'error'[^>]*bind:retry="retry"/)
  assert.match(wxml, /<cy-icon[^>]*name="arrow-right"/)
  assert.doesNotMatch(wxml, />›</)
})

test('入场码缺少真实过期时间时保持错误态，不虚构五分钟有效期', () => {
  const relativePath = 'components/cy/scene-qr-ticket/index.js'
  const harness = mount(relativePath)
  harness.instance.data.registrationId = 'registration-1'
  harness.instance.load()
  assert.equal(harness.requests[0].hideLoading, true)
  assert.equal(harness.requests[0].silentError, true)
  harness.requests[0].success({ code: 200, data: { qrcodeUrl: 'qr', code: 'CODE', expiresAt: 'not-a-timestamp' } })
  assert.equal(harness.instance.data.state, 'error')
  assert.match(harness.instance.data.errorText, /有效期/)

  const wxml = read('components/cy/scene-qr-ticket/index.wxml')
  assert.doesNotMatch(wxml, /5 分钟内有效/)
})

test('漫游发现页忽略旧搜索响应，刷新失败保留已有商家且未知营业状态不冒充营业中', () => {
  const relativePath = 'components/cy/scene-roam-discover/index.js'
  const harness = mount(relativePath)
  harness.instance.data.list = [{ id: 7, name: '已有商家', status: 'open' }]

  harness.instance.data.keyword = '旧词'
  harness.instance.load()
  harness.instance.data.keyword = '新词'
  harness.instance.load()
  assert.equal(harness.requests.length, 2)

  harness.requests[1].success({ code: 200, data: { rows: [{ id: 2, name: '新结果', businessStatus: null }] } })
  harness.requests[0].success({ code: 200, data: { rows: [{ id: 1, name: '旧结果', businessStatus: 1 }] } })
  assert.equal(harness.instance.data.list[0].name, '新结果')
  assert.equal(harness.instance.data.list[0].status, 'none')

  harness.instance.load()
  harness.requests[2].fail({ errMsg: 'request:fail' })
  assert.equal(harness.instance.data.state, 'stale')
  assert.equal(harness.instance.data.list[0].name, '新结果')

  const wxml = read('components/cy/scene-roam-discover/index.wxml')
  assert.match(wxml, /state === 'stale'/)
  assert.match(wxml, /status="\{\{item\.status\}\}"/)
})

test('漫游任务列表忽略旧聚合响应，失败保留上次快照且未知数值显示待确认', () => {
  const relativePath = 'components/cy/scene-roam-task-list/index.js'
  const harness = mount(relativePath)

  harness.instance.load()
  harness.instance.load()
  assert.equal(harness.requests.length, 4)
  harness.requests[2].success({ code: 200, data: [{ id: 2, title: '新活动', status: 99, participants: null, collective: { enabled: true, pct: '80' } }] })
  harness.requests[3].success({ code: 200, data: [] })
  harness.requests[0].success({ code: 200, data: [{ id: 1, title: '旧活动', status: 2, participants: 10 }] })
  harness.requests[1].success({ code: 200, data: [] })

  assert.equal(harness.instance.data.all[0].title, '新活动')
  assert.equal(harness.instance.data.all[0]._statusText, '状态待确认')
  assert.equal(harness.instance.data.all[0]._participantsText, '人数待确认')
  assert.equal(harness.instance.data.all[0]._pct, -1)

  harness.instance.load()
  harness.requests[4].fail({ errMsg: 'request:fail' })
  harness.requests[5].success({ code: 200, data: [] })
  assert.equal(harness.instance.data.state, 'stale')
  assert.equal(harness.instance.data.all[0].title, '新活动')

  const wxml = read('components/cy/scene-roam-task-list/index.wxml')
  assert.match(wxml, /state === 'stale'/)
  assert.match(wxml, /item\._participantsText/)
  assert.doesNotMatch(wxml, /item\.participants \|\| 0/)
})

test('漫游历史区分本地读取失败与真实空记录，并移除文字伪图标', () => {
  const relativePath = 'components/cy/scene-roam-history/index.js'
  const broken = mount(relativePath, {}, { getStorageSync() { throw new Error('storage unavailable') } })
  broken.instance._load()
  assert.equal(broken.instance.data.state, 'error')

  const empty = mount(relativePath, {}, { getStorageSync() { return [] } })
  empty.instance._load()
  assert.equal(empty.instance.data.state, 'ready')
  assert.deepEqual(empty.instance.data.list, [])

  const wxml = read('components/cy/scene-roam-history/index.wxml')
  assert.match(wxml, /state === 'error'/)
  assert.match(wxml, /bind:retry="retry"/)
  assert.doesNotMatch(wxml, /✦/)
})

test('单次漫游详情保留合法零值，并把未知统计显示为待确认而不是伪造零', () => {
  const relativePath = 'components/cy/scene-roam-session/index.js'
  const unknown = mount(relativePath, {}, {
    getStorageSync() {
      return [{ ts: 100, distance: 'bad', shops: '3', explorePct: null, durSec: 'bad', pois: [] }]
    },
  })
  unknown.instance.data.ts = '100'
  unknown.instance._load()
  assert.equal(unknown.instance.data.state, 'ready')
  // UI-04(2026-09-18):数字统计没取到显示 0;时长是文本,保留「—」。
  assert.equal(unknown.instance.data.session.distanceText, '0')
  assert.equal(unknown.instance.data.session.shopsText, '0')
  assert.equal(unknown.instance.data.session.explorePctText, '0')
  assert.equal(unknown.instance.data.session.time, '—')

  const zero = mount(relativePath, {}, {
    getStorageSync() {
      return [{ ts: 200, distance: 0, shops: 0, explorePct: 0, durSec: 0, pois: [] }]
    },
  })
  zero.instance.data.ts = '200'
  zero.instance._load()
  assert.equal(zero.instance.data.session.distanceText, '0')
  assert.equal(zero.instance.data.session.shopsText, '0')
  assert.equal(zero.instance.data.session.explorePctText, '0')
  assert.equal(zero.instance.data.session.time, '00:00')

  const wxml = read('components/cy/scene-roam-session/index.wxml')
  assert.match(wxml, /session\.shopsText/)
  assert.match(wxml, /session\.explorePctText/)
  assert.doesNotMatch(wxml, /session\.shops \|\| 0/)
})

test('城市集邮册拒绝未知总数和缺图邮票，并用真实图标承载拍摄入口', () => {
  const relativePath = 'components/cy/scene-roam-stamp-album/index.js'
  const invalidTotal = mount(relativePath)
  invalidTotal.instance._cellW = 80
  invalidTotal.instance._cellH = 100
  invalidTotal.instance.load()
  invalidTotal.requests[0].success({ code: 200, data: { list: [], total: null } })
  assert.equal(invalidTotal.instance.data.error, true)
  assert.equal(invalidTotal.instance.data.loaded, false)

  const invalidStamp = mount(relativePath)
  invalidStamp.instance._cellW = 80
  invalidStamp.instance._cellH = 100
  invalidStamp.instance.load()
  invalidStamp.requests[0].success({ code: 200, data: { list: [{ id: 1 }], total: 1 } })
  assert.equal(invalidStamp.instance.data.error, true)
  assert.deepEqual(invalidStamp.instance.data.items, [])

  const empty = mount(relativePath)
  empty.instance._cellW = 80
  empty.instance._cellH = 100
  empty.instance.load()
  empty.requests[0].success({ code: 200, data: { list: [], total: 0 } })
  assert.equal(empty.instance.data.error, false)
  assert.equal(empty.instance.data.loaded, true)
  assert.equal(empty.instance.data.total, 0)

  const wxml = read('components/cy/scene-roam-stamp-album/index.wxml')
  const json = JSON.parse(read('components/cy/scene-roam-stamp-album/index.json'))
  assert.match(wxml, /<cy-icon[^>]*name="plus"/)
  assert.doesNotMatch(wxml, />＋</)
  assert.equal(json.usingComponents['cy-icon'], '/components/cy/icon/index')
})

test('据点详情切换时忽略旧响应，未知核验方式不得静默降级成定位打卡', () => {
  const relativePath = 'components/cy/scene-roam-poi-detail/index.js'
  const harness = mount(relativePath)
  harness.instance.data.poiId = '21'
  harness.instance._load()
  harness.instance.data.poiId = '22'
  harness.instance._load()
  assert.equal(harness.requests.length, 2)

  harness.requests[1].success({ code: 200, data: { id: '22', name: '新据点', validationMethod: 99 } })
  harness.requests[0].success({ code: 200, data: { id: '21', name: '旧据点', validationMethod: 5 } })
  assert.equal(harness.instance.data.node.name, '新据点')
  assert.equal(harness.instance.data.node.vmLabel, '核验方式待确认')
  assert.equal(harness.instance.data.node.canInteract, false)

  harness.instance.startInteract()
  assert.equal(harness.requests.length, 2, '未知核验方式不得发起完成请求')
})

test('据点商家未知收费和营业状态如实显示，缺图时不再注入虚构商家图', () => {
  const relativePath = 'components/cy/scene-roam-poi-detail/index.js'
  const harness = mount(relativePath)
  harness.instance.data.poiId = ''
  harness.instance.data.merchantId = '7'
  harness.instance._load()
  harness.requests[0].success({ code: 200, data: { id: 7, name: '城瘾小店', chargeType: null, businessStatus: null } })
  assert.equal(harness.instance.data.state, 'ready')
  assert.equal(harness.instance.data.merchant.chargeText, '收费方式待确认')
  assert.equal(harness.instance.data.merchant.businessStatusText, '营业状态待确认')

  const wxml = read('components/cy/scene-roam-poi-detail/index.wxml')
  assert.match(wxml, /merchant\.businessStatusText/)
  assert.match(wxml, /<cy-avatar[^>]*merchant\.logo/)
  assert.doesNotMatch(wxml, /\/images\/mer1\.jpg/)
  assert.doesNotMatch(wxml, /businessStatus == 0 \? '已打烊' : '营业中'/)
})

test('据点打卡业务拒绝给回输入机会，只有传输失败才按原答案续跑', () => {
  const relativePath = 'components/cy/scene-roam-poi-detail/index.js'
  /* CU-M-52:业务拒绝后重试要重开输入框(走 modal),这里替掉外层 wx 的 showModal。 */
  const modalCalls = []
  const previousWx = global.wx
  global.wx = { showModal(options) { modalCalls.push(options) } }
  try {
    const harness = mount(relativePath, {}, {
      getLocation(options) { options.success({ latitude: 31.2, longitude: 121.5 }) },
    })
    harness.instance.data.poiId = 'poi-1'
    harness.instance.data.node = { poiId: 21, status: 1, name: '测试据点', validationMethod: 1 }

    harness.instance.completeNode('保留的暗号')
    harness.instance.completeNode('重复提交')
    assert.equal(harness.requests.length, 1, '提交中再次触发不得并发请求')
    assert.equal(harness.requests[0].silentError, true)

    // 业务拒绝 = 服务端说「这次就是没成」(答案错):重试不能拿同一个答案再撞一次
    harness.requests[0].success({ code: 500, msg: '答案不正确' })
    assert.equal(harness.instance.data.completing, false)
    assert.equal(harness.instance.data.interactionState, 'retry')
    assert.match(harness.instance.data.interactionText, /答案不正确/)
    assert.equal(harness.instance.data.interactionActionText, '重新作答')
    harness.instance.recoverInteraction()
    assert.equal(harness.requests.length, 1, '业务拒绝不得重放旧答案')
    assert.equal(modalCalls.length, 1, '业务拒绝的重试必须重新打开输入框')

    // 传输失败才是「原输入已保留」那句话说的那一档:仍按原答案续跑
    const offline = mount(relativePath, {}, {
      getLocation(options) { options.success({ latitude: 31.2, longitude: 121.5 }) },
    })
    offline.instance.data.poiId = 'poi-1'
    offline.instance.data.node = { poiId: 21, status: 1, name: '测试据点', validationMethod: 1 }
    offline.instance.completeNode('保留的暗号')
    offline.requests[0].fail({ errMsg: 'request:fail timeout' })
    assert.match(offline.instance.data.interactionText, /原输入已保留/)
    assert.equal(offline.instance.data.interactionActionText, '重试')
    offline.instance.recoverInteraction()
    assert.equal(offline.requests.length, 2)
    assert.equal(offline.requests[1].data.answer, '保留的暗号')
  } finally {
    if (previousWx === undefined) delete global.wx
    else global.wx = previousWx
  }
})

test('活动详情不虚构主理人和统计零值，合法零仍原样呈现', () => {
  const relativePath = 'components/cy/scene-play-activity-detail/index.js'
  const unknown = mount(relativePath)
  unknown.instance.data.activityId = 'activity-1'
  unknown.instance.load('activity-1')
  unknown.requests[0].success({
    code: 200,
    data: { id: 1, name: '真实活动', registrationCount: null, averageRating: null, commentCount: null },
  })
  assert.equal(unknown.instance.data.state, 'ready')
  assert.equal(unknown.instance.data.hostName, '')
  // UI-04(2026-09-18):人数/条数没取到显示 0;评分没取到仍留「—」(0 分是具体的差评事实)。
  assert.equal(unknown.instance.data.registrationCountText, '0')
  assert.equal(unknown.instance.data.averageRatingText, '—')
  assert.equal(unknown.instance.data.commentCountText, '0')

  const zero = mount(relativePath)
  zero.instance.data.activityId = 'activity-2'
  zero.instance.load('activity-2')
  zero.requests[0].success({
    code: 200,
    data: { id: 2, name: '零报名活动', registrationCount: 0, averageRating: 0, commentCount: 0 },
  })
  assert.equal(zero.instance.data.registrationCountText, '0')
  assert.equal(zero.instance.data.averageRatingText, '0')
  assert.equal(zero.instance.data.commentCountText, '0')

  const wxml = read('components/cy/scene-play-activity-detail/index.wxml')
  assert.match(wxml, /registrationCountText/)
  assert.match(wxml, /averageRatingText/)
  assert.doesNotMatch(wxml, /info\.registrationCount \|\| 0/)
  assert.doesNotMatch(wxml, /\/images\/route_city_cover\.png/)
})

/* 2026-09-19 审查 F-PA-1:remaining_inventory 在库里可空(商家没填 ≠ 卖完了)。
   原来 normalizeTicket 把 null 算成 _available=false ⇒ 卡面写「余票待确认」、
   点下去却 toast「该票种已售罄」并硬拦 —— 一个字段两种口径,而且拦的是能报的票。 */
test('活动票种:库存未知可选，只有确证的 0 才算售罄', () => {
  const relativePath = 'components/cy/scene-play-activity-detail/index.js'
  const harness = mount(relativePath)
  harness.instance.data.activityId = 'activity-1'
  harness.instance.load('activity-1')
  harness.requests[0].success({
    code: 200,
    data: {
      id: 1, name: '有票待确认的活动', isSignUp: 0,
      omsTicketList: [
        { id: 11, name: '未填库存', price: 50, remainingInventory: null },
        { id: 12, name: '真售罄', price: 50, remainingInventory: 0 },
        { id: 13, name: '有余票', price: 50, remainingInventory: 3 },
      ],
    },
  })
  const tickets = harness.instance.data.tickets
  assert.deepEqual(tickets.map((t) => t._available), [true, false, true])
  assert.deepEqual(tickets.map((t) => t._inventoryText), ['余票待确认', '已售罄', '剩余 3 张'])

  harness.instance.selectTicket({ currentTarget: { dataset: { id: '11' } } })
  assert.equal(harness.instance.data.selectedTicketId, '11', '库存未知的票必须可选 —— 售罄由服务端判')
  // utils/toast.js 走宿主全局 wx(组件依赖不在上面的 sandbox 里),所以这里只临时挂它。
  const shown = []
  const prevWx = global.wx
  global.wx = { showToast: (o) => shown.push(o && o.title) }
  try {
    harness.instance.selectTicket({ currentTarget: { dataset: { id: '12' } } })
  } finally {
    global.wx = prevWx
  }
  assert.equal(harness.instance.data.selectedTicketId, '11', '确证售罄仍要拦在门外')
  assert.deepEqual(shown, ['该票种已售罄'])
})

test('活动评价提交单飞，失败后保留评分文案与正文内重试状态', () => {
  const relativePath = 'components/cy/scene-play-activity-detail/index.js'
  const harness = mount(relativePath, { tips() {} })
  Object.assign(harness.instance.data, {
    activityId: 'activity-1', canSubmitComment: true, answer: 4,
    plnr: '保留这段真实评价', uploadImages: ['https://img.example/1.jpg'],
  })

  harness.instance.submitComment()
  harness.instance.submitComment()
  assert.equal(harness.requests.length, 1, '评价提交中不得并发重复请求')
  assert.equal(harness.requests[0].silentError, true)
  harness.requests[0].success({ code: 500, msg: '评价暂时无法发布' })
  assert.equal(harness.instance.data.commentSubmitting, false)
  assert.match(harness.instance.data.commentError, /评价暂时无法发布/)
  assert.equal(harness.instance.data.plnr, '保留这段真实评价')
  assert.equal(harness.instance.data.answer, 4)

  const wxml = read('components/cy/scene-play-activity-detail/index.wxml')
  assert.match(wxml, /commentError/)
  assert.match(wxml, /loading="\{\{commentSubmitting\}\}"/)
})

test('通用场景列表拒绝畸形 rows，不能把协议错误渲染成空白 ready', () => {
  const relativePath = 'components/cy/scene-route-content/index.js'
  const harness = mount(relativePath)
  harness.instance.data.sceneId = 'settings-likes'
  harness.instance.loadScene()
  harness.requests[0].success({ code: 200, data: { rows: 'not-an-array' } })
  assert.equal(harness.instance.data.state, 'error')
  assert.match(harness.instance.data.errorText, /数据|读取/)
})

test('商家入驻场景只把显式 NONE 当首次申请，403 与异常仍保持错误态', () => {
  const relativePath = 'components/cy/scene-route-content/index.js'
  const empty = mount(relativePath)
  empty.instance.data.sceneId = 'merchant-apply'
  empty.instance.loadScene()
  empty.requests[0].success({ code: 200, applicationState: 'NONE' })
  assert.equal(empty.instance.data.state, 'ready')
  assert.equal(empty.instance.data.formType, 'merchant-apply')
  assert.equal(empty.instance.data.form.name, '')

  const forbidden = mount(relativePath)
  forbidden.instance.data.sceneId = 'merchant-apply'
  forbidden.instance.loadScene()
  forbidden.requests[0].success({ code: 403, msg: '真实权限不足' })
  assert.equal(forbidden.instance.data.state, 'error')
  assert.match(forbidden.instance.data.errorText, /权限不足/)

  const malformed = mount(relativePath)
  malformed.instance.data.sceneId = 'merchant-apply'
  malformed.instance.loadScene()
  malformed.requests[0].success({ code: 200 })
  assert.equal(malformed.instance.data.state, 'error', '缺少 NONE 的空 data 不能误当首次申请')

  for (const data of [{}, [], true]) {
    const dirty = mount(relativePath)
    dirty.instance.data.sceneId = 'merchant-apply'
    dirty.instance.loadScene()
    dirty.requests[0].success({ code: 200, data })
    assert.equal(dirty.instance.data.state, 'error', '畸形申请 data 不能生成空白 ready 表单')
  }
})

test('通用场景表单失败时保留内容、内联错误与重试能力', () => {
  const relativePath = 'components/cy/scene-route-content/index.js'
  const harness = mount(relativePath)
  Object.assign(harness.instance.data, {
    sceneId: 'settings-feedback',
    form: { topicId: 'registration-1', reason: '保留这段问题描述' },
  })
  harness.instance.submitForm()
  harness.instance.submitForm()
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.requests[0].autoErrorToast, false)
  assert.equal(harness.requests[0].silentError, undefined)
  harness.requests[0].success({ code: 500, msg: '暂时无法提交反馈' })
  assert.equal(harness.instance.data.submitting, false)
  assert.match(harness.instance.data.submitError, /暂时无法提交反馈/)
  assert.equal(harness.instance.data.form.reason, '保留这段问题描述')

  const wxml = read('components/cy/scene-route-content/index.wxml')
  assert.match(wxml, /submitError/)
  assert.match(wxml, /正在提交/)
  assert.match(wxml, /bind:retry="submitForm"/)
})

test('设置页不再挂声音与触感占位入口', () => {
  const settingsWxml = read('pages/shezhi/shezhi.wxml')
  const settingsJs = read('pages/shezhi/shezhi.js')
  assert.doesNotMatch(settingsWxml, /声音与触感|暂未接入/)
  assert.doesNotMatch(settingsJs, /goSoundHaptics|settings-sound/)
})

test('账户收益拒绝负余额，并忽略晚到的旧刷新结果', () => {
  const relativePath = 'components/cy/scene-asset-earnings/index.js'
  const negative = mount(relativePath, { globalData: { userInfo: { balance: -1 } } })
  negative.instance.load(false)
  assert.equal(negative.requests.length, 1)
  negative.requests[0].success({ code: 200, data: { balance: -1 } })
  assert.equal(negative.instance.data.state, 'error')
  assert.equal(negative.instance.data.balance, '')

  const harness = mount(relativePath, { globalData: { userInfo: {} } })
  harness.instance.load(true)
  harness.instance.load(true)
  assert.equal(harness.requests.length, 2)
  harness.requests[1].success({ code: 200, data: { balance: 0 } })
  harness.requests[0].success({ code: 200, data: { balance: 8 } })
  assert.equal(harness.instance.data.state, 'ready')
  assert.equal(harness.instance.data.balance, '0.00')
  assert.equal(harness.requests[0].silentError, true)
})
