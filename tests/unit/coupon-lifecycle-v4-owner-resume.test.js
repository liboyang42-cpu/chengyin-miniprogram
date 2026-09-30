'use strict'

// R9-40 v4 独立回归(独立审查 v3 剩余 NoGo):
//  1) 钱包列表绑定 owner:静默换号后在途回包不得落屏,已落屏的上一账号私有券必须清理;
//  2) 同 owner + 同券 + 后端 TTL 内:hide/show 不得先清码,刷新失败仍保留有效凭证;
//  3) TTL 过期或换 owner / 无法证明归属:必须先下屏。
// 真实 Page/Component + 请求桩,时间可控。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const WALLET = 'components/cy/scene-game-coupon-wallet/index.js'
const QR_SCENE = 'components/cy/scene-qr-coupon/index.js'
const QR_PAGE = 'subpackageMember/coupon-qr/index.js'

global.wx = global.wx || { showToast() {}, hideToast() {}, getStorageSync() { return '' }, setStorageSync() {} }

function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function mount(relativePath, kind, options = {}) {
  const requests = []
  const intervals = []
  const owner = options.owner || { value: 'member-A' }
  const clock = options.clock || { now: Date.parse('2026-09-14T10:00:00+08:00') }
  const app = {
    sendRequest(options) {
      const record = { opts: options, aborted: false }
      record.abort = () => { record.aborted = true }
      requests.push(record)
      return record
    },
    getUserID: () => owner.value,
    getPageSize: () => 10,
    tips() {},
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  }
  let definition
  class TestDate extends Date { static now() { return clock.now } }
  const sandbox = {
    Date: TestDate,
    getApp: () => app,
    getCurrentPages: () => [{}, {}],
    wx: global.wx,
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
    triggerEvent() {},
  }
  const methods = kind === 'component' ? definition.methods : definition
  Object.entries(methods).forEach(([name, fn]) => { if (typeof fn === 'function') instance[name] = fn.bind(instance) })
  if (kind === 'component' && definition.pageLifetimes) {
    Object.entries(definition.pageLifetimes).forEach(([name, fn]) => { instance['host_' + name] = fn.bind(instance) })
  }
  return { instance, requests, intervals, events: [], owner, clock, definition }
}

const succeed = (request, data) => {
  request.opts.success({ code: 200, data })
  if (request.opts.complete) request.opts.complete()
}
const fail = (request, msg) => {
  request.opts.fail({ msg: msg || 'network fail' })
  if (request.opts.complete) request.opts.complete()
}
const token = (qr) => ({ useStatus: 0, qrcodeUrl: qr, expiresIn: 60, startTime: '2026-09-01T00:00:00+08:00' })

// ---------------------------------------------------------------- 钱包 owner 隔离

test('钱包:在途加载切号后,上一账号回包不得落屏', () => {
  const h = mount(WALLET, 'component', { owner: { value: 'member-A' } })
  h.instance.load()
  assert.equal(h.requests.length, 1)

  h.owner.value = 'member-B'
  succeed(h.requests[0], [{ id: 991, couponName: 'A账号私有券', useStatus: 0 }])

  const names = Array.from(h.instance.data.all, (item) => item._name)
  assert.deepEqual(names, [], '切号后 A 的私有券不得落屏')
  assert.equal(h.instance.data.state, 'loading')
})

test('钱包:已落屏列表遇静默换号,宿主 show 必须清掉并重载当前账号', () => {
  const h = mount(WALLET, 'component', { owner: { value: 'member-A' } })
  h.instance.load()
  succeed(h.requests[0], [{ id: 992, couponName: 'A已落屏私有券', useStatus: 0 }])
  assert.deepEqual(Array.from(h.instance.data.all, (i) => i._name), ['A已落屏私有券'])

  h.owner.value = 'member-B'
  assert.equal(typeof h.instance.host_show, 'function', '钱包必须挂宿主 pageLifetimes')
  assert.equal(typeof h.instance.host_hide, 'function')

  h.instance.host_show()
  assert.deepEqual(Array.from(h.instance.data.all, (i) => i._name), [], '换号后上一账号私有券必须立即下屏')
  assert.equal(h.requests.length, 2, '换号后必须重载当前账号列表')
  succeed(h.requests[1], [{ id: 993, couponName: 'B账号券', useStatus: 0 }])
  assert.deepEqual(Array.from(h.instance.data.all, (i) => i._name), ['B账号券'])
})

test('钱包:同 owner show 保留列表不闪不重载', () => {
  const h = mount(WALLET, 'component', { owner: { value: 'member-A' } })
  h.instance.load()
  succeed(h.requests[0], [{ id: 994, couponName: 'A券', useStatus: 0 }])

  h.instance.host_hide()
  h.instance.host_show()
  assert.equal(h.requests.length, 1, '同 owner 不得重复请求')
  assert.deepEqual(Array.from(h.instance.data.all, (i) => i._name), ['A券'])
})

// ---------------------------------------------------------------- 同 owner hide/show 保留

test('独立页:同 owner 同券 TTL 内 hide/show 保留有效码,刷新失败仍可用', () => {
  const h = mount(QR_PAGE, 'page', { owner: { value: 'member-1' } })
  h.instance.onLoad({ couponHistoryId: '91' })
  h.instance.onShow()
  succeed(h.requests[0], token('VALID-SAME-OWNER'))
  assert.equal(h.instance.data.qrState, 'ready')

  h.instance.onHide()
  h.instance.onShow()
  assert.equal(h.instance.data.qrcodeUrl, 'VALID-SAME-OWNER', '同 owner+券+TTL 内不得先清码')
  assert.equal(h.instance.data.qrState, 'ready')

  fail(h.requests[1])
  assert.equal(h.instance.data.qrcodeUrl, 'VALID-SAME-OWNER', '刷新失败不得丢掉仍有效的码')
  assert.equal(h.instance.data.qrState, 'ready')
})

test('独立页:同 owner 但凭证超出 TTL 时 show 必须先下屏', () => {
  const h = mount(QR_PAGE, 'page', { owner: { value: 'member-1' } })
  h.instance.onLoad({ couponHistoryId: '91' })
  h.instance.onShow()
  succeed(h.requests[0], token('EXPIRING-QR'))

  h.clock.now += 120 * 1000
  h.instance.onHide()
  h.instance.onShow()
  assert.equal(h.instance.data.qrcodeUrl, '', '超出后端 TTL 的码必须下屏重取')
  assert.equal(h.instance.data.qrState, 'loading')
})

test('独立页:换 owner 后 show 必须下屏(不能靠旧 owner 凭证)', () => {
  const h = mount(QR_PAGE, 'page', { owner: { value: 'member-1' } })
  h.instance.onLoad({ couponHistoryId: '91' })
  h.instance.onShow()
  succeed(h.requests[0], token('OWNER-1-QR'))
  assert.equal(h.instance.data.qrState, 'ready')

  h.owner.value = 'member-2'
  h.instance.onHide()
  h.instance.onShow()
  assert.equal(h.instance.data.qrcodeUrl, '', '换 owner 必须下屏')
  assert.ok(!JSON.stringify(h.instance.data).includes('OWNER-1-QR'))
})

test('场景:同 owner 同券 TTL 内宿主 hide/show 保留有效码,刷新失败仍可用', () => {
  const h = mount(QR_SCENE, 'component', { owner: { value: 'member-1' } })
  h.instance.data.couponHistoryId = '71'
  h.instance.start('71')
  succeed(h.requests[0], token('VALID-SCENE-SAME-OWNER'))
  assert.equal(h.instance.data.qr, 'VALID-SCENE-SAME-OWNER')
  assert.equal(h.instance.data.countdown, 60)

  h.instance.host_hide()
  h.instance.host_show()
  assert.equal(h.instance.data.qr, 'VALID-SCENE-SAME-OWNER', '同 owner+券+TTL 内不得清码')
  assert.equal(h.instance.data.qrState, 'ready')

  fail(h.requests[1])
  assert.equal(h.instance.data.qr, 'VALID-SCENE-SAME-OWNER', '刷新失败必须保留有效码')
  assert.equal(h.instance.data.qrState, 'ready')
})

test('场景:换 owner 宿主 show 必须下屏并丢弃旧 owner 凭证', () => {
  const h = mount(QR_SCENE, 'component', { owner: { value: 'member-1' } })
  h.instance.data.couponHistoryId = '71'
  h.instance.start('71')
  succeed(h.requests[0], token('SCENE-OWNER1-QR'))

  h.owner.value = 'member-2'
  h.instance.host_hide()
  h.instance.host_show()
  assert.equal(h.instance.data.qr, '', '换 owner 必须下屏')
  assert.ok(!JSON.stringify(h.instance.data).includes('SCENE-OWNER1-QR'))
})

// ---------------------------------------------------------------- 负控

test('负控:钱包在途回包去掉 owner 校验时必须判红', () => {
  const source = read(WALLET)
  const mutated = source.replace('if (!owner || seq !== this._loadSeq || owner !== currentOwnerId()) return', 'if (seq !== this._loadSeq) return')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 owner 校验')
  const h = mount(WALLET, 'component', { owner: { value: 'member-A' }, source: mutated })
  h.instance.load()
  h.owner.value = 'member-B'
  succeed(h.requests[0], [{ id: 991, couponName: 'A账号私有券', useStatus: 0 }])
  assert.throws(() => assert.deepEqual(Array.from(h.instance.data.all, (i) => i._name), []), assert.AssertionError)
})

test('负控:独立页 show 无条件下码时必须判红', () => {
  const source = read(QR_PAGE)
  const mutated = source.replace('if (!this._keepRenderedCredential()) this._clearRenderedCredential();', 'this._clearRenderedCredential();')
  assert.notEqual(mutated, source, '负控锚点失效:未找到保留判断')
  const h = mount(QR_PAGE, 'page', { owner: { value: 'member-1' }, source: mutated })
  h.instance.onLoad({ couponHistoryId: '91' })
  h.instance.onShow()
  succeed(h.requests[0], token('KEEP-ME'))
  h.instance.onHide()
  h.instance.onShow()
  assert.throws(() => assert.equal(h.instance.data.qrcodeUrl, 'KEEP-ME'), assert.AssertionError)
})

test('负控:场景宿主 show 无条件 start 时必须判红', () => {
  const source = read(QR_SCENE)
  const mutated = source.replace('if (this._keepQrValid()) this._resume(id)\n      else this.start(id)', 'this.start(id)')
  assert.notEqual(mutated, source, '负控锚点失效:未找到保留分支')
  const h = mount(QR_SCENE, 'component', { owner: { value: 'member-1' }, source: mutated })
  h.instance.data.couponHistoryId = '71'
  h.instance.start('71')
  succeed(h.requests[0], token('KEEP-SCENE'))
  h.instance.host_hide()
  h.instance.host_show()
  assert.throws(() => assert.equal(h.instance.data.qr, 'KEEP-SCENE'), assert.AssertionError)
})

// ---------------------------------------------------------------- P3-3 刷新节拍上的精确 TTL

const PAST_START = '2026-09-01T00:00:00+08:00'
const lastTickToken = (qr) => ({ useStatus: 0, qrcodeUrl: qr, expiresIn: 1, startTime: PAST_START })

test('独立页:倒计时末点失败但仍在后端 TTL 内必须保留有效码', () => {
  const h = mount(QR_PAGE, 'page', { owner: { value: 'member-1' } })
  h.instance.onLoad({ couponHistoryId: '91' })
  h.instance.onShow()
  succeed(h.requests[0], lastTickToken('LAST-TICK-QR'))
  assert.equal(h.instance.data.countdown, 1)

  h.clock.now += 5 * 1000
  h.instance.refreshToken()
  fail(h.requests[1])

  assert.equal(h.instance.data.qrcodeUrl, 'LAST-TICK-QR', '倒计时 0/1 不等于 token 失效,不得下屏')
  assert.equal(h.instance.data.qrState, 'ready')
})

test('独立页:倒计时显示未走完但已超后端 TTL 必须下屏', () => {
  const h = mount(QR_PAGE, 'page', { owner: { value: 'member-1' } })
  h.instance.onLoad({ couponHistoryId: '91' })
  h.instance.onShow()
  succeed(h.requests[0], token('STALE-TTL-QR'))
  assert.equal(h.instance.data.countdown, 60)

  h.clock.now += 120 * 1000
  h.instance.refreshToken()
  fail(h.requests[1])

  assert.equal(h.instance.data.qrcodeUrl, '', 'TTL 已过必须下屏')
  assert.equal(h.instance.data.qrState, 'error')
})

test('场景:倒计时末点失败但仍在后端 TTL 内必须保留有效码;TTL 过则下屏', () => {
  const keep = mount(QR_SCENE, 'component', { owner: { value: 'member-1' } })
  keep.instance.data.couponHistoryId = '71'
  keep.instance.start('71')
  succeed(keep.requests[0], lastTickToken('SCENE-LAST-TICK'))
  assert.equal(keep.instance.data.countdown, 1)
  keep.clock.now += 5 * 1000
  keep.instance.retryNow()
  fail(keep.requests[1])
  assert.equal(keep.instance.data.qr, 'SCENE-LAST-TICK', '倒计时末点≠TTL过期')
  assert.equal(keep.instance.data.qrState, 'ready')

  const stale = mount(QR_SCENE, 'component', { owner: { value: 'member-1' } })
  stale.instance.data.couponHistoryId = '72'
  stale.instance.start('72')
  succeed(stale.requests[0], token('SCENE-STALE-TTL'))
  stale.clock.now += 120 * 1000
  stale.instance.retryNow()
  fail(stale.requests[1])
  assert.equal(stale.instance.data.qr, '', 'TTL 已过必须下屏')
  assert.equal(stale.instance.data.qrState, 'error')
})

test('负控:把精确 TTL 判定退回倒计时近似时,末点有效码必须判红', () => {
  const source = read(QR_PAGE)
  const mutated = source.replace(
    'return !!issuedAt && !!ttl && (issuedAt + ttl) - Date.now() > 1000;',
    'if (false) return true; return this.data.countdown > 1;')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 TTL 判定')
  const h = mount(QR_PAGE, 'page', { owner: { value: 'member-1' }, source: mutated })
  h.instance.onLoad({ couponHistoryId: '91' })
  h.instance.onShow()
  succeed(h.requests[0], lastTickToken('MUTATED-QR'))
  h.clock.now += 5 * 1000
  h.instance.refreshToken()
  fail(h.requests[1])
  assert.throws(() => assert.equal(h.instance.data.qrcodeUrl, 'MUTATED-QR'), assert.AssertionError)
})

for (const nextOwner of ['member-A', 'member-B']) {
  test(`独立页终态后切换新券/${nextOwner}，新凭证可恢复且旧轮询不能污染`, () => {
    const h = mount(QR_PAGE, 'page')
    h.instance.onLoad({ id: 'old-history' })
    h.instance.onShow()
    const firstToken = h.requests.find(r => r.opts.url.endsWith('/qr-token'))
    h.intervals[1]()
    const oldPoll = h.requests.find(r => r.opts.url.endsWith('/status'))
    succeed(firstToken, { ...token('OLD'), useStatus: 1 })
    h.instance.onHide()
    h.owner.value = nextOwner
    h.instance.setData({ couponHistoryId: 'new-history' })
    h.instance.onShow()
    const newToken = h.requests.filter(r => r.opts.url.endsWith('/qr-token')).at(-1)
    succeed(newToken, token('NEW'))
    assert.equal(h.instance.data.useStatus, 0)
    assert.equal(h.instance.data.qrcodeUrl, 'NEW')
    succeed(oldPoll, { useStatus: 1 })
    assert.equal(h.instance.data.useStatus, 0)
  })
}

for (const [kind, file] of [['page', QR_PAGE], ['component', QR_SCENE]]) {
  for (const endpoint of ['token', 'status']) {
    test(`${kind}/${endpoint}:服务端明确410立即撤下凭证、保留券信息和原因，重试可恢复`, () => {
      const h = mount(file, kind)
      if (kind === 'page') { h.instance.onLoad({ id: 'history-1' }); h.instance.onShow() }
      else { h.instance.setData({ couponHistoryId: 'history-1' }); h.instance.start('history-1') }
      succeed(h.requests.find(r => r.opts.url.endsWith('/qr-token')), { ...token('VALID'), couponName: '本人优惠券' })
      let refused
      if (endpoint === 'token') {
        h.instance.retryNow()
        refused = h.requests.filter(r => r.opts.url.endsWith('/qr-token')).at(-1)
      } else {
        h.instance.startPolling()
        h.intervals.at(-1)()
        refused = h.requests.filter(r => r.opts.url.endsWith('/status')).at(-1)
      }
      refused.opts.success({ code: 410, msg: '优惠券已撤销或不存在' })
      if (refused.opts.complete) refused.opts.complete()
      assert.equal(kind === 'page' ? h.instance.data.qrcodeUrl : h.instance.data.qr, '')
      assert.equal(h.instance.data.useStatus, null)
      assert.match(kind === 'page' ? h.instance.data.errMsg : h.instance.data.errorText, /撤销|不存在/)
      assert.equal(kind === 'page' ? h.instance.data.coupon.couponName : h.instance.data.couponName, '本人优惠券')
      h.instance.retryNow()
      succeed(h.requests.filter(r => r.opts.url.endsWith('/qr-token')).at(-1), token('RECOVERED'))
      assert.equal(h.instance.data.useStatus, 0)
      assert.equal(kind === 'page' ? h.instance.data.qrcodeUrl : h.instance.data.qr, 'RECOVERED')
    })
  }
}

for (const [kind, file] of [['page', QR_PAGE], ['component', QR_SCENE]]) {
  test(`${kind}:慢响应不能把请求时已签发的90秒凭证延长到回包后90秒`, () => {
    const h = mount(file, kind)
    if (kind === 'page') { h.instance.onLoad({ id: 'history-1' }); h.instance.onShow() }
    else { h.instance.setData({ couponHistoryId: 'history-1' }); h.instance.start('history-1') }
    h.clock.now += 80000
    succeed(h.requests.find(r => r.opts.url.endsWith('/qr-token')), token('EARLY-ISSUED'))
    h.clock.now += 11000
    h.instance.retryNow()
    fail(h.requests.filter(r => r.opts.url.endsWith('/qr-token')).at(-1))
    assert.equal(kind === 'page' ? h.instance.data.qrcodeUrl : h.instance.data.qr, '')
    assert.equal(h.instance.data.qrState, 'error')
  })
}

for (const [kind, file] of [['page', QR_PAGE], ['component', QR_SCENE]]) {
  test(`${kind}:换码在途超过TTL时旧码立即下屏，90秒后旧响应不能重新亮码`, () => {
    const h = mount(file, kind)
    if (kind === 'page') { h.instance.onLoad({ id: 'history-1' }); h.instance.onShow() }
    else { h.instance.setData({ couponHistoryId: 'history-1' }); h.instance.start('history-1') }
    succeed(h.requests.find(r => r.opts.url.endsWith('/qr-token')), token('OLD'))
    h.instance.retryNow()
    const pending = h.requests.filter(r => r.opts.url.endsWith('/qr-token')).at(-1)
    h.clock.now += 91000
    h.intervals[h.instance._countTimer - 1]()
    assert.equal(kind === 'page' ? h.instance.data.qrcodeUrl : h.instance.data.qr, '')
    succeed(pending, token('TOO-LATE'))
    assert.equal(kind === 'page' ? h.instance.data.qrcodeUrl : h.instance.data.qr, '')
    assert.equal(h.instance.data.qrState, 'error')
  })
}


for (const kind of ['wallet', 'page', 'scene']) {
  test(`v5 ${kind}:缺owner不读取私产，身份恢复后可加载`, () => {
    const h = kind === 'wallet' ? mount(WALLET, 'component', { owner: { value: '' } })
      : mount(kind === 'page' ? QR_PAGE : QR_SCENE, kind === 'page' ? 'page' : 'component', { owner: { value: '' } })
    const load = () => { if (kind === 'wallet') h.instance.load(); else if (kind === 'page') { h.instance.onLoad({couponHistoryId:'9'}); h.instance.onShow() } else h.instance.start('9') }
    load()
    assert.equal(h.requests.length, 0, '缺归属不得发起带旧认证上下文的私有读取')
    h.owner.value = 'member-B'; load()
    assert.equal(h.requests.length, 1)
    succeed(h.requests[0], kind === 'wallet' ? [{id:9,couponName:'B的券',useStatus:0}] : token('B-QR'))
    assert.equal(kind === 'wallet' ? h.instance.data.all[0]._name : kind === 'page' ? h.instance.data.qrcodeUrl : h.instance.data.qr, kind === 'wallet' ? 'B的券' : 'B-QR')
  })
}
for (const kind of ['page', 'scene']) {
  test(`v5 ${kind}:账号消失后迟回与节拍不得保留私有券名和码`, () => {
    const h=mount(kind==='page'?QR_PAGE:QR_SCENE,kind==='page'?'page':'component')
    if(kind==='page'){h.instance.onLoad({couponHistoryId:'9'});h.instance.onShow()}else h.instance.start('9')
    succeed(h.requests[0], {...token('A-QR'), couponName:'PRIVATE-A', description:'PRIVATE-D'})
    h.owner.value='';h.intervals.forEach(fn=>fn())
    assert.equal(kind==='page'?h.instance.data.qrcodeUrl:h.instance.data.qr,'')
    assert.equal(kind==='page'?h.instance.data.coupon.couponName:h.instance.data.couponName,kind==='page'?undefined:'')
    assert.equal(h.requests.length,1)
  })
  test(`v5 ${kind}:畸形状态、QR和TTL不假ready；正常终态及恢复保留`, () => {
    for(const malformed of [{useStatus:'0'},{qrcodeUrl:{}},{qrcodeUrl:'  '},{expiresIn:-5},{expiresIn:0.5},{expiresIn:Infinity},{expiresIn:'60'}]) {
      const h=mount(kind==='page'?QR_PAGE:QR_SCENE,kind==='page'?'page':'component')
      if(kind==='page'){h.instance.onLoad({couponHistoryId:'9'});h.instance.onShow()}else h.instance.start('9')
      succeed(h.requests[0], {...token('A-QR'),...malformed})
      assert.notEqual(h.instance.data.qrState,'ready',JSON.stringify(malformed))
      assert.equal(kind==='page'?h.instance.data.qrcodeUrl:h.instance.data.qr,'')
      if(kind==='page')h.instance.refreshToken();else h.instance.refresh()
      succeed(h.requests.at(-1),token('RECOVERED'))
      assert.equal(h.instance.data.qrState,'ready')
    }
  })
}
