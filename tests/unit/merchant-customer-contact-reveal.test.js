'use strict'

/* F15:客户列表的拨打/复制必须先向服务端换取明文号码。
   列表里下发的是脱敏号(138****0000),直接拨/复制等于把假号当号用;
   换取接口失败(越权/无同意/超限)时落失败半屏,而不是静默什么都不发生。 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
let pageConfig
let requests
let phoneCalls
let clipboardWrites

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44 },
  getUserID: () => 'merchant-a',
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  navigateTo() {},
  makePhoneCall: (options) => { phoneCalls.push(options) },
  setClipboardData: (options) => { clipboardWrites.push(options) },
  setNavigationBarColor() {},
  setBackgroundColor() {},
}

global.Page = (config) => { pageConfig = config }

function loadPage() {
  pageConfig = null
  requests = []
  phoneCalls = []
  clipboardWrites = []
  const absolute = path.join(ROOT, 'pages/merchant/customer/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

function tap(page, handler, memberId) {
  page[handler]({ currentTarget: { dataset: { memberid: String(memberId) } } })
}

test('拨打客户：先取明文号再拨号，绝不拿列表里的脱敏号当号码', () => {
  const page = loadPage()
  tap(page, 'callCustomer', 41)

  assert.equal(requests.length, 1, '点击拨号必须先发换取请求')
  assert.equal(requests[0].url, '/api/merchant/crm/customers/41/contact')
  assert.equal(requests[0].method, 'POST')
  assert.deepEqual(JSON.parse(requests[0].data), { purpose: 'call' })
  assert.equal(phoneCalls.length, 0, '响应回来之前不得拨号')

  requests[0].success({ code: 200, data: { phone: '13800138000' } })
  requests[0].complete()

  assert.equal(phoneCalls.length, 1)
  assert.equal(phoneCalls[0].phoneNumber, '13800138000', '拨的必须是服务端本次下发的明文号')
  assert.equal(page.data.resultSheet.show, false)
})

test('复制客户电话：先取明文号再写剪贴板', () => {
  const page = loadPage()
  tap(page, 'copyCustomerPhone', 42)
  assert.equal(requests[0].url, '/api/merchant/crm/customers/42/contact')
  assert.deepEqual(JSON.parse(requests[0].data), { purpose: 'copy' })

  requests[0].success({ code: 200, data: { phone: '13900000002' } })
  requests[0].complete()

  assert.equal(clipboardWrites.length, 1)
  assert.equal(clipboardWrites[0].data, '13900000002')
})

test('换取失败（无同意/越权/超限）落失败半屏并带上原因，不打不复制', () => {
  const page = loadPage()
  tap(page, 'callCustomer', 43)
  requests[0].success({ code: 403, msg: '客户未授权联系方式共享' })
  requests[0].complete()

  assert.equal(phoneCalls.length, 0)
  assert.equal(page.data.resultSheet.show, true)
  assert.equal(page.data.resultSheet.kind, 'fail')
  assert.equal(page.data.resultSheet.why, '客户未授权联系方式共享')
  assert.equal(page.data.resultSheet.duration, 2000)

  page.onResultSheetClose()
  assert.equal(page.data.resultSheet.show, false)
})

test('网络失败落失败半屏；畸形 200（无号码）同样 fail-closed', () => {
  const page = loadPage()
  tap(page, 'callCustomer', 44)
  requests[0].fail({})
  requests[0].complete()
  assert.equal(page.data.resultSheet.show, true)
  assert.match(page.data.resultSheet.why, /服务暂时不可用|网络/)

  const second = loadPage()
  tap(second, 'copyCustomerPhone', 45)
  requests[0].success({ code: 200, data: {} })
  requests[0].complete()
  assert.equal(clipboardWrites.length, 0, '没有号码就不能写剪贴板')
  assert.equal(second.data.resultSheet.show, true)
})

test('请求在途时重复点击只发一次，不重复消耗服务端次数与审计', () => {
  const page = loadPage()
  tap(page, 'callCustomer', 46)
  tap(page, 'callCustomer', 46)
  assert.equal(requests.length, 1)

  requests[0].success({ code: 200, data: { phone: '13800138000' } })
  requests[0].complete()
  assert.equal(phoneCalls.length, 1)
})
