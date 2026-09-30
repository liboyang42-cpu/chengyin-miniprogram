// 核销详情 · 清退退款的资金合同。
//
// 2026-09-09 退款入口按用户裁决从报名名册行内挪到这一页底部。原来钉住这条链路的
// 那批合同写在 club-roster-recovery-contract 里、绑的是名册页的 refundReg ——
// 入口一搬,它们就集体失效,而这条链路上真金白银的判据一条都不该少。
// 这份合同接手那些**仍然成立**的判据(名册那边关于「多团重排 / 多笔 parked / 旧 index」
// 的几条不接:这一页一次只处理一单,那些情形在新形态下压根不存在)。
//
// 核心是一条:「回执未知 ≠ 失败」。失败可以直接让人重试,未知不行 —— 重试就是重复退款。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const PAGE = 'pages/club/checkin-detail/index.js'

function mount(identity) {
  const requests = []
  const modals = []
  const toasts = []
  let definition
  let currentIdentity = identity || { user_id: 7, role: 'club', user_type: 1 }
  const app = {
    globalData: currentIdentity,
    sendRequest(options) { requests.push(options) },
  }
  const sandbox = {
    getApp: () => app,
    Page(config) { definition = config },
    require(request) {
      if (request === '../utils/owner-action-guard.js') {
        return require(path.join(ROOT, 'pages/club/utils', path.basename(request)))
      }
      if (request === '../../../utils/cancellation-feedback.js'
          || request === '../../../utils/response-shape.js') {
        return require(path.join(ROOT, 'utils', path.basename(request)))
      }
      if (request === '../../../utils/toast.js') {
        return { success: (t) => toasts.push(t), error: (t) => toasts.push(t) }
      }
      if (request === '../../../utils/modal.js') {
        return { show: (o) => modals.push(o) }
      }
      throw new Error('unexpected require: ' + request)
    },
    wx: { navigateBack() {}, switchTab() {}, stopPullDownRefresh() {} },
    console,
  }
  // owner-action-guard 用到的 getApp 走的是宿主全局
  global.getApp = sandbox.getApp
  vm.runInNewContext(read(PAGE), sandbox, { filename: PAGE })
  const page = Object.assign({
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  }, definition)
  page.onLoad({ clubId: '1', registrationId: '9' })
  requests.length = 0   // 丢掉 onLoad 那次 detail 读取,后面的断言只看退款
  return { page, requests, modals, toasts, setIdentity(next) { app.globalData = next } }
}

function ready(page, extra) {
  page.setData({
    state: 'ready',
    detail: Object.assign({ registrationId: 9, canRefund: true, displayName: '陈屿' }, extra || {}),
  })
}

/** 走到「已经发出退款请求、正在等回执」那一刻,返回那次请求的 options */
function fireRefund(h) {
  h.page.refund()
  assert.equal(h.modals.length, 1, '退款必须先过危险确认弹窗')
  h.modals[h.modals.length - 1].success({ confirm: true })
  const req = h.requests.find((r) => r.url === '/api/registration/cancel-by-owner')
  assert.ok(req, '确认后必须真的发出清退请求')
  return req
}

test('退款必须过危险确认;没确认不发请求', () => {
  const h = mount()
  ready(h.page)
  h.page.refund()
  assert.equal(h.modals.length, 1)
  h.modals[0].success({ confirm: false })
  assert.equal(h.requests.length, 0, '取消确认不许发出任何写请求')
})

test('canRefund 由服务端说了算,前端不自己判', () => {
  const h = mount()
  ready(h.page, { canRefund: false })
  h.page.refund()
  assert.equal(h.modals.length, 0, 'canRefund=false 连确认弹窗都不该弹')
})

test('single-flight:在途期间再点不发第二笔', () => {
  const h = mount()
  ready(h.page)
  fireRefund(h)
  assert.equal(h.page.data.refunding, true)
  h.page.refund()
  assert.equal(h.requests.filter((r) => r.url === '/api/registration/cancel-by-owner').length, 1,
    '在途期间不许发出第二笔清退')
})

test('★回执未知(408/5xx/网络断)不算失败:锁住入口并去回读这单的状态', () => {
  for (const scenario of ['abnormal-500', 'abnormal-408', 'network-fail']) {
    const h = mount()
    ready(h.page)
    const req = fireRefund(h)
    if (scenario === 'abnormal-500') req.successStatusAbnormal({ msg: '网关错误' }, 500)
    else if (scenario === 'abnormal-408') req.successStatusAbnormal({ msg: '超时' }, 408)
    else req.fail()

    assert.equal(h.page.data.refundErrorUnknown, true, scenario + ': 必须判成结果未知')
    assert.match(h.page.data.refundErrorText, /未确认/, scenario + ': 文案要说清结果未确认')
    assert.ok(h.requests.some((r) => r.url === '/api/club/crm/checkin/detail'),
      scenario + ': 未知之后必须去回读对端事实,不能就地重试')

    // ★ 这一条是重复退款的闸:界面灰掉不够,bindtap 照样能触发
    const before = h.requests.filter((r) => r.url === '/api/registration/cancel-by-owner').length
    h.page.refund()
    assert.equal(h.requests.filter((r) => r.url === '/api/registration/cancel-by-owner').length, before,
      scenario + ': 结果未知时再点必须什么都不发 —— 重试就是重复退款')
  }
})

test('★回读到 REFUNDED 才算退成;读回来不是 REFUNDED 就继续挂着', () => {
  const h = mount()
  ready(h.page)
  fireRefund(h).fail()
  const readback = h.requests.filter((r) => r.url === '/api/club/crm/checkin/detail').pop()

  readback.success({ code: 200, data: { registrationId: 9, statusCode: 'PAID', railStep: 1 } })
  assert.equal(h.page.data.refundErrorUnknown, true, '还不是 REFUNDED,不许收口')
  assert.match(h.page.data.refundErrorText, /还不是已退款/)

  const again = h.requests.filter((r) => r.url === '/api/club/crm/checkin/detail').pop()
  h.page.retryRefundReadback()
  const third = h.requests.filter((r) => r.url === '/api/club/crm/checkin/detail').pop()
  assert.notEqual(third, again, '「重新查询」必须真的再读一次')
  third.success({ code: 200, data: { registrationId: 9, statusCode: 'REFUNDED', railStep: -1 } })
  assert.equal(h.page.data.refundErrorUnknown, false, '读到 REFUNDED 才收口')
  assert.equal(h.page.data.refundErrorText, '')
  assert.ok(h.toasts.includes('已退款'))
})

test('确定性业务失败可以直接重试,不冒充结果未知', () => {
  const h = mount()
  ready(h.page)
  fireRefund(h).success({ code: 500, msg: '这单已核销，退不了' })
  assert.equal(h.page.data.refundErrorUnknown, false, '确定失败不是未知')
  assert.equal(h.page.data.refundErrorText, '这单已核销，退不了')
  assert.equal(h.page.data.refunding, false)
  // 确定失败之后允许再点
  h.page.refund()
  assert.equal(h.modals.length, 2, '确定失败后必须还能重试')
})

test('HTTP 4xx 是确定失败,只有 408/5xx 进未知', () => {
  const h = mount()
  ready(h.page)
  fireRefund(h).successStatusAbnormal({ msg: '参数不合法' }, 400)
  assert.equal(h.page.data.refundErrorUnknown, false, '400 是确定失败')
  assert.equal(h.page.data.refundErrorText, '参数不合法')
})

test('403/无权限:整页落 denied,不留一个点了必被拒的退款钮', () => {
  for (const [value, status] of [[{ msg: '无权操作' }, 403], [{ code: 403, msg: '仅主理人可' }, 200]]) {
    const h = mount()
    ready(h.page)
    fireRefund(h).successStatusAbnormal(value, status)
    assert.equal(h.page.data.state, 'denied')
    assert.equal(h.page.data.refunding, false)
    assert.equal(h.page.data.refundErrorUnknown, false)
  }
})

test('确认弹窗期间换了人登录:回执不许算到新身份头上', () => {
  const h = mount()
  ready(h.page)
  h.page.refund()
  h.setIdentity({ user_id: 99, role: 'club', user_type: 1 })
  h.modals[0].success({ confirm: true })
  assert.equal(h.requests.filter((r) => r.url === '/api/registration/cancel-by-owner').length, 0,
    '身份变了就不该继续这笔退款')
})

test('负控:把未知闸从 refund 守卫里摘掉,重复退款必须被这份合同抓到', () => {
  const src = read(PAGE)
  const guard = /if \(!d \|\| !d\.canRefund \|\| this\.data\.refunding \|\| this\.data\.refundErrorUnknown\) return;/
  assert.match(src, guard, '前提:守卫现在挡着 refundErrorUnknown')
  const broken = src.replace(guard, 'if (!d || !d.canRefund || this.data.refunding) return;')
  assert.notEqual(broken, src, '负控必须真的改到了那一行')
  assert.doesNotMatch(broken, /refundErrorUnknown\) return;/,
    '负控前提:摘掉之后源码里就没有这道闸了')
})

test('WXML 上灰掉的按钮不算闸:aria-disabled 与逻辑守卫必须同时在', () => {
  const wxml = read('pages/club/checkin-detail/index.wxml')
  assert.match(wxml, /aria-disabled="\{\{refunding \|\| refundErrorUnknown\}\}"/)
  assert.match(read(PAGE), /this\.data\.refundErrorUnknown\) return;/,
    'WXML 的 is-disabled 只是灰一下,真正拦住重复退款的必须是 JS 守卫')
})
