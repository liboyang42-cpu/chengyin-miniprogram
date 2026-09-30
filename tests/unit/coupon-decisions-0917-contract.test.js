'use strict'

// 2026-09-17 用户拍板(券):①删「满X可用」门槛展示 ②商家可停发自己的券(已领照常可用)
// ③候选池婉拒报名退役(见 coop-list-received-regs-contract) ④有效期全站只显示到日
// ⑤平台手动失效券在钱包/出码口显示「已失效」且不再被当作可用。
// 每条都带负控:把修复改回去,对应判据必须真红。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const COUPON_PAGE = 'subpackageMember/coupon/coupon.js'
const WALLET = 'components/cy/scene-game-coupon-wallet/index.js'
const QR_SCENE = 'components/cy/scene-qr-coupon/index.js'
const QR_PAGE = 'subpackageMember/coupon-qr/index.js'
const CREDENTIAL = 'utils/coupon-credential.js'

function mutated(source, from, to) {
  assert.ok(source.includes(from), '负控锚点失效: ' + from)
  return source.replace(from, to)
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

// ---------------- 1. 「满X可用」门槛:展示与投影清零 ----------------

test('券票面:「满X可用」门槛展示已删,副标直接是券名,截止日期只到日', () => {
  const js = read('pages/play/index.js')
  assert.doesNotMatch(js, /minPoint/, 'play 页不得再读/展示 minPoint(门槛由商家写在说明里)')
  assert.match(js, /small: c\.name \|\| '优惠券'/)
  assert.match(js, /expires: endDay \? \('截止日期：' \+ endDay\) : '有效期见券包'/)
  assert.match(js, /const endDay = formatDayDots\(c\.endTime\)/)

  // 负控:把旧展示改回去,「不得出现 minPoint」判据必须真红
  const reverted = mutated(js,
    "small: c.name || '优惠券',",
    "small: c.minPoint > 0 ? '满' + String(c.minPoint).replace(/\\.0+$/, '') + '可用' : (c.name || '优惠券'),")
  assert.throws(() => assert.doesNotMatch(reverted, /minPoint/))
})

// ---------------- 2. 商家停发自己的券 ----------------

function loadCouponPage(source) {
  const requests = []
  const modals = []
  const toasts = []
  let definition
  vm.runInNewContext(source || read(COUPON_PAGE), {
    getApp: () => ({ sendRequest: (options) => requests.push(options) }),
    Page: (value) => { definition = value },
    require: (id) => {
      if (/coupon-form\.js$/.test(id)) return require(path.join(ROOT, 'utils/coupon-form.js'))
      if (/datetime\.js$/.test(id)) return require(path.join(ROOT, 'utils/datetime.js'))
      if (/\/modal\.js$/.test(id)) return { show: (opts) => modals.push(opts) }
      if (/\/toast\.js$/.test(id)) {
        return Object.assign((text) => toasts.push(text), {
          success: (text) => toasts.push(text),
          error: (text) => toasts.push(text),
        })
      }
      return { merchantPageShow() {}, merchantPageRestore() {} }
    },
  }, { filename: COUPON_PAGE })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  page.getList()
  requests[0].success({
    code: 200,
    data: [
      { id: 1, name: '进行中券', status: 1, startTime: '2026-09-01 00:00:00', endTime: '2026-10-31 23:59:59', publishCount: 10, receiveCount: 1 },
      { id: 2, name: '商家已停发券', status: 4, startTime: '2026-09-01 00:00:00', endTime: '2026-10-31 23:59:59', publishCount: 10, receiveCount: 3 },
      { id: 3, name: '平台已失效券', status: 3, startTime: '2026-09-01 00:00:00', endTime: '2026-10-31 23:59:59', publishCount: 10, receiveCount: 3 },
      { id: 4, name: '已结束券', status: 2, startTime: '2026-08-01 00:00:00', endTime: '2026-08-31 23:59:59', publishCount: 10, receiveCount: 3 },
    ],
  })
  return { page, requests, modals, toasts }
}

test('商家券列表:状态签区分已失效/已停发,只有进行中/未开始的券给停发入口', () => {
  const { page } = loadCouponPage()
  const [active, stopped, invalidated, ended] = page.data.list
  assert.equal(active.statusText, '进行中')
  assert.equal(active.canStop, true)
  assert.equal(stopped.statusText, '已停发')
  assert.equal(stopped.statusTone, 'danger')
  assert.equal(stopped.canStop, false, '已停发的券不得再出现停发入口')
  assert.equal(invalidated.statusText, '已失效')
  assert.equal(invalidated.statusTone, 'danger')
  assert.equal(invalidated.canStop, false)
  assert.equal(ended.statusText, '已结束')
  assert.equal(ended.canStop, false)

  const wxml = read('subpackageMember/coupon/coupon.wxml')
  assert.match(wxml, /wx:if="\{\{currentCoupon\.canStop\}\}"[\s\S]{0,200}catchtap="stopCoupon"/)
  assert.match(wxml, /停发后不能再被领取、发放；已领到的券照常可用、可核销。/)
})

test('停发走已登记危险确认:确认后 POST /api/coupon/stop 并回读列表;取消则不发请求', () => {
  const { page, requests, modals, toasts } = loadCouponPage()
  const active = page.data.list[0]

  page.stopCoupon({ currentTarget: { dataset: { item: active } } })
  assert.equal(modals.length, 1)
  assert.equal(modals[0].dangerKey, 'merchant.coupon.stop', '必须走已登记的危险动作确认,不能裸执行')
  assert.equal(JSON.stringify(modals[0].dangerParams), JSON.stringify({ name: '进行中券' }))

  // 取消 = 不发请求
  modals[0].success({ confirm: false })
  assert.equal(requests.filter((r) => r.url === '/api/coupon/stop').length, 0)

  page.stopCoupon({ currentTarget: { dataset: { item: active } } })
  modals[1].success({ confirm: true })
  const writes = requests.filter((r) => r.url === '/api/coupon/stop')
  assert.equal(writes.length, 1)
  assert.equal(JSON.stringify(writes[0].data), JSON.stringify({ couponId: 1 }))

  const readsBefore = requests.filter((r) => r.url === '/api/coupon/mypublishlist').length
  writes[0].success({ code: 200 })
  assert.equal(toasts[toasts.length - 1], '已停发「进行中券」')
  assert.equal(page.data.tpShow, false, '停发成功后详情弹窗关闭')
  assert.equal(requests.filter((r) => r.url === '/api/coupon/mypublishlist').length, readsBefore + 1,
    '停发成功必须回读列表,让状态签变「已停发」')
})

test('停发带商家 scope:scope=MERCHANT 时请求必须带上,服务端按 owner 落权', () => {
  const { page, requests, modals } = loadCouponPage()
  page.setData({ operationScope: 'MERCHANT' })
  page.stopCoupon({ currentTarget: { dataset: { item: page.data.list[0] } } })
  modals[0].success({ confirm: true })
  const write = requests.find((r) => r.url === '/api/coupon/stop')
  assert.equal(JSON.stringify(write.data), JSON.stringify({ couponId: 1, scope: 'MERCHANT' }))
})

test('停发负控:拿掉 canStop 守卫,已停发的券也会被发出停发请求(判据真红)', () => {
  const source = mutated(read(COUPON_PAGE),
    'if (!item || !item.id || !item.canStop) return;',
    'if (!item || !item.id) return;')
  const { page, requests, modals } = loadCouponPage(source)
  page.stopCoupon({ currentTarget: { dataset: { item: page.data.list[1] } } })
  modals[0].success({ confirm: true })
  assert.equal(requests.filter((r) => r.url === '/api/coupon/stop').length, 1,
    '负控必须复现「已停发也能再发一次」;正控那条 0 次会因此判红')
})

test('停发确认文案已登记且写明不可撤销与已领不受影响', () => {
  const actions = require(path.join(ROOT, 'utils/danger-actions.js')).DANGER_ACTIONS
  const action = actions['merchant.coupon.stop']
  assert.ok(action, 'merchant.coupon.stop 必须登记在危险动作文案表')
  assert.equal(action.irreversible, true)
  assert.match(action.title, /\{name\}/)
  assert.ok(action.consequences.some((item) => item.text.includes('已领')), '必须说明已领的照常可用')
  assert.ok(action.consequences.some((item) => item.text.includes('此操作不可撤销')))
})

// ---------------- 3. 平台手动失效(3):钱包与出码口都当不可用 ----------------

test('钱包:手动失效(3)显示「已失效」且不给查看/出码入口', () => {
  const { flattenComponentToPage } = require('../helpers/component-as-page.js')
  const sandbox = { requests: [], events: [] }
  global.getApp = () => ({ getUserID: () => 'member-A', sendRequest: (options) => sandbox.requests.push(options) })
  global.Component = (config) => { sandbox.def = flattenComponentToPage(config) }
  global.wx = {}
  delete require.cache[require.resolve(path.join(ROOT, WALLET))]
  require(path.join(ROOT, WALLET))
  const instance = Object.assign({}, sandbox.def, {
    data: JSON.parse(JSON.stringify(sandbox.def.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
    triggerEvent(name, detail) { sandbox.events.push({ name, detail }) },
  })
  instance.load()
  sandbox.requests[0].success({ code: 200, data: [
    { id: 1, couponName: '已失效券', useStatus: 3, startTime: '2020-01-01', endTime: '2099-01-03' },
  ] })

  const row = instance.data.all[0]
  assert.equal(row._statusText, '已失效')
  assert.equal(row._statusVariant, 'danger')
  assert.equal(row._canView, false, '已失效券不再提供查看/出码入口')
  assert.equal(row._isUsable, false)
  assert.match(row._dateText, /该券已被平台手动失效/)

  instance.openCode({ currentTarget: { dataset: { item: row } } })
  assert.deepEqual(sandbox.events, [], '已失效券点卡片不得再打开展示入口')
})

test('出码页:qr-token 回 useStatus=3 即终态「已失效」,不亮码不停表', () => {
  const requests = []
  const timers = []
  let definition
  const app = { getUserID: () => 'member-A', sendRequest: (options) => requests.push(options) }
  vm.runInNewContext(read(QR_PAGE), {
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    wx: {},
    setInterval(callback) { timers.push(callback); return timers.length },
    clearInterval() {},
    require(id) { return require(path.resolve(path.dirname(path.join(ROOT, QR_PAGE)), id)) },
    Page(options) { definition = options },
  })
  const instance = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value)) },
  })
  instance.onLoad({ couponHistoryId: 7 })
  instance.refreshToken()
  requests[0].success({ code: 200, data: { useStatus: 3, couponName: '已失效券', endTime: '2026-10-31T23:59:59.000+08:00' } })

  assert.equal(instance.data.useStatus, 3)
  assert.equal(instance.data.qrcodeUrl, '', '已失效不得留码')
  assert.equal(timers.length, 0, '终态不启轮询/倒计时')
  const wxml = read('subpackageMember/coupon-qr/index.wxml')
  assert.match(wxml, /useStatus==1 \|\| useStatus==2 \|\| useStatus==3/)
  assert.match(wxml, /该券已失效/)
})

test('场景出码组件:qr-token 回 useStatus=3 时结果态为「该券已失效」', () => {
  const requests = []
  const timers = []
  let definition
  const app = { getUserID: () => 'member-A', sendRequest: (options) => requests.push(options) }
  vm.runInNewContext(read(QR_SCENE), {
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    wx: {},
    setInterval(callback) { timers.push(callback); return timers.length },
    clearInterval() {},
    require(id) { return require(path.resolve(path.dirname(path.join(ROOT, QR_SCENE)), id)) },
    Component(options) { definition = options },
  })
  const instance = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
    triggerEvent() {},
  })
  instance.start('7')
  requests[0].success({ code: 200, data: { useStatus: 3, couponName: '已失效券' } })

  assert.equal(instance.data.useStatus, 3)
  assert.equal(instance.data.resultText, '该券已失效')
  assert.equal(instance.data.qr, '')
  assert.equal(instance._pollTimer, null, '终态必须停轮询')
  assert.equal(instance._countTimer, null, '终态必须停倒计时')
})

test('负控:客户端把 useStatus=3 当未知态(退回 0..2)时必须真红', () => {
  const source = mutated(read(CREDENTIAL), 'value >= 0 && value <= 3', 'value >= 0 && value <= 2')
  const module = { exports: {} }
  vm.runInNewContext(source, { module, exports: module.exports }, { filename: CREDENTIAL })
  assert.equal(module.exports.couponStatus(3), null,
    '负控必须复现「3 被当未知态」;正控那条 === 3 会因此判红')
})
