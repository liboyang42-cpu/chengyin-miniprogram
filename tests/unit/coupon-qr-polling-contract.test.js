const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const source = () => fs.readFileSync(path.join(ROOT, 'subpackageMember/coupon-qr/index.js'), 'utf8')
const wxml = () => fs.readFileSync(path.join(ROOT, 'subpackageMember/coupon-qr/index.wxml'), 'utf8')
const wxss = () => fs.readFileSync(path.join(ROOT, 'subpackageMember/coupon-qr/index.wxss'), 'utf8')

function loadPage(js = source()) {
  const sandbox = { nav: [], requests: [], intervals: [] }
  const context = {
    getApp: () => ({
      getUserID: () => 'member-A',
      sendRequest(options) { sandbox.requests.push(options) },
      tips() {},
    }),
    getCurrentPages: () => [{ route: 'subpackageMember/coupon-qr/index' }],
    Page(config) { sandbox.config = config },
    setInterval(callback) {
      sandbox.intervals.push(callback)
      return sandbox.intervals.length
    },
    clearInterval() {},
    wx: {
      navigateBack(options) { sandbox.nav.push({ api: 'navigateBack', options: Object.assign({}, options) }) },
      reLaunch(options) { sandbox.nav.push({ api: 'reLaunch', options: Object.assign({}, options) }) },
      showToast() {},
      vibrateShort() {},
    },
    // 页面会 require utils/motion-preference 读「减少动态效果」偏好,沙箱得给它 require
    require(id) { return require(require('node:path').resolve(__dirname, '../../', id.replace(/^(\.\.\/)+/, ''))) },
    console,
  }
  vm.createContext(context)
  vm.runInContext(js, context, { filename: 'subpackageMember/coupon-qr/index.js' })

  const page = Object.assign({}, sandbox.config)
  page.data = JSON.parse(JSON.stringify(sandbox.config.data))
  page.setData = patch => Object.assign(page.data, patch)
  return { page, sandbox }
}

test('优惠券深链缺少 id 时进入 missing-param，并提供真实退出动作', () => {
  const { page, sandbox } = loadPage()

  page.onLoad({})

  assert.equal(page.data.entryState, 'missing-param')
  assert.match(wxml(), /<cy-state-shell\b[^>]*kind="missing-param"[^>]*primary="返回"[^>]*bind:primary="onClose"/s)
  page.onClose()
  assert.deepEqual(sandbox.nav, [{
    api: 'reLaunch',
    options: { url: '/pages/member/index/index' },
  }])
})

test('TTL 内已有 ready 二维码时，核销轮询 502 只显示非阻断提示', () => {
  const { page, sandbox } = loadPage()
  page.setData({
    couponHistoryId: 7,
    qrcodeUrl: 'https://example.test/qr.png',
    qrState: 'ready',
    countdown: 42,
    useStatus: 0,
  })

  page.startPolling()
  sandbox.intervals[0]()
  sandbox.requests[0].successStatusAbnormal({ msg: 'Bad Gateway 502' })

  assert.equal(page.data.qrState, 'ready')
  assert.equal(page.data.qrcodeUrl, 'https://example.test/qr.png')
  assert.match(page.data.pollError, /网络|核销状态/)
  assert.match(wxml(), /<cy-inline-error\b[^>]*qrState === 'ready' && pollError[^>]*sub="\{\{pollError\}\}"/s)
  assert.match(wxss(), /\.cq-poll-error\s*\{[^}]*pointer-events:\s*none/s,
    '非阻断提示即使覆盖凭证边缘，也不能吞掉底层刷新动作')
})

test('刷新倒计时剩 1 秒时二维码仍在服务端 TTL 内，轮询失败不能提前遮码', () => {
  const { page, sandbox } = loadPage()
  page.setData({
    couponHistoryId: 7,
    qrcodeUrl: 'https://example.test/qr.png',
    qrState: 'ready',
    countdown: 1,
    useStatus: 0,
  })

  page.startPolling()
  sandbox.intervals[0]()
  sandbox.requests[0].successStatusAbnormal({ msg: 'Bad Gateway 502' })

  assert.equal(page.data.qrState, 'ready')
  assert.match(page.data.pollError, /网络|核销状态/)
})

test('核销轮询恢复成功后清除非阻断提示', () => {
  const { page, sandbox } = loadPage()
  page.setData({
    couponHistoryId: 7,
    qrcodeUrl: 'https://example.test/qr.png',
    qrState: 'ready',
    countdown: 36,
    useStatus: 0,
    pollError: '网络异常，请稍后重试',
  })

  page.startPolling()
  sandbox.intervals[0]()
  sandbox.requests[0].success({ code: 200, data: { useStatus: 0 } })

  assert.equal(page.data.pollError, '')
  assert.equal(page.data.qrState, 'ready')
})

test('没有可用二维码时，核销轮询失败才进入阻断 error', () => {
  const { page, sandbox } = loadPage()
  page.setData({ couponHistoryId: 7, qrcodeUrl: '', qrState: 'loading', useStatus: 0 })

  page.startPolling()
  sandbox.intervals[0]()
  sandbox.requests[0].successStatusAbnormal({ msg: 'Bad Gateway 502' })

  assert.equal(page.data.qrState, 'error')
  assert.match(page.data.errMsg, /网络|核销状态/)
  assert.equal(page.data.pollError, '')
})

test('负控：轮询异常退回无条件阻断时，ready 二维码保护必须判红', () => {
  const original = source()
  const mutated = original.replace(
    "that.onPollFail(that.friendlyQrError(res && res.msg, '核销状态暂不可用，请稍后重试'));",
    "that.setData({ qrState: 'error' });",
  )
  assert.notEqual(mutated, original, '变异锚点失效：未找到轮询异常分级入口')

  const { page, sandbox } = loadPage(mutated)
  page.setData({
    couponHistoryId: 7,
    qrcodeUrl: 'https://example.test/qr.png',
    qrState: 'ready',
    countdown: 42,
    useStatus: 0,
  })
  page.startPolling()
  sandbox.intervals[0]()
  sandbox.requests[0].successStatusAbnormal({ msg: 'Bad Gateway 502' })

  assert.throws(() => assert.equal(page.data.qrState, 'ready'), assert.AssertionError)
})

test('负控：移除轮询 silentError 必须判红', () => {
  const mutated = source().replace("url: '/api/coupon/status',\n        method: 'POST',\n        // 轮询失败由本页状态机承接，禁止把原始接口路径弹成灰色 toast 覆盖凭证卡。\n        silentError: true,", "url: '/api/coupon/status',\n        method: 'POST',")
  assert.throws(() => {
    const polling = mutated.match(/url: '\/api\/coupon\/status'[\s\S]*?\n      \}\);/)
    assert.match(polling[0], /silentError:\s*true/)
  })
})

test('过期状态 2 到达后必须停止轮询,不得继续空转', () => {
  const { page, sandbox } = loadPage()
  page.setData({ couponHistoryId: 7, qrcodeUrl: 'https://example.test/qr.png', qrState: 'ready', countdown: 30, useStatus: 0 })

  page.startPolling()
  sandbox.intervals[0]()
  sandbox.requests[0].success({ code: 200, data: { useStatus: 2 } })
  assert.equal(page.data.useStatus, 2)

  sandbox.intervals[0]()
  assert.equal(sandbox.requests.length, 1, '过期后不得再发核销状态轮询')
})

for (const terminal of [1, 2]) {
  test(`终态 ${terminal} 已到达后，较早轮询的未使用回包不能复活凭证`, () => {
    const { page, sandbox } = loadPage()
    page.setData({ couponHistoryId: 7, qrcodeUrl: 'same-owner-code', qrState: 'ready', useStatus: 0 })
    page.startPolling()
    sandbox.intervals[0]()
    sandbox.intervals[0]()
    sandbox.requests[1].success({ code: 200, data: { useStatus: terminal } })
    sandbox.requests[0].success({ code: 200, data: { useStatus: 0 } })
    assert.equal(page.data.useStatus, terminal)
  })
}
