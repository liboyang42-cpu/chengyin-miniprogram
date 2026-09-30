const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const COMPONENT = '../../components/cy/scene-settings-deregister/index.js'
const FLOW = '../../utils/deregister-flow.js'
let componentConfig
let requests
let consentCalls
let consentResult
let callOrder
let toasts
let modals

global.getApp = () => ({
  recordConsent: (input) => {
    consentCalls.push(input)
    callOrder.push('consent')
    return consentResult()
  },
  sendRequest: (request) => {
    requests.push(request)
    if (request.url === '/api/user/deregister/apply') callOrder.push('apply')
  },
  getUserID: () => 7,
})

global.wx = {
  showToast: (options) => toasts.push(options),
  navigateTo() {},
  showModal: (options) => modals.push(options),
}

global.Component = (config) => { componentConfig = config }

beforeEach(() => {
  requests = []
  consentCalls = []
  consentResult = () => Promise.reject(new Error('同意记录失败'))
  callOrder = []
  toasts = []
  modals = []
  componentConfig = null
  delete require.cache[require.resolve(COMPONENT)]
  delete require.cache[require.resolve(FLOW)]
  require(COMPONENT)
})

function makePage() {
  const page = Object.assign({}, componentConfig.methods, { data: JSON.parse(JSON.stringify(componentConfig.data)) })
  page.setData = (patch) => Object.assign(page.data, patch)
  return page
}

test('同意记录失败时不提交注销申请', async () => {
  const page = makePage()
  page.data.confirmed = true
  page.data.smscode = '123456'

  page.apply()
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(requests.filter(request => request.url === '/api/user/deregister/apply').length, 0)
  assert.deepEqual(consentCalls, [{
    docType: 'account_cancellation_notice', scene: 'account_cancel', eventType: 'AGREE',
  }])
  assert.deepEqual(toasts, [])
  assert.equal(page.data.submitting, false)
  assert.match(page.data.applyError, /同意记录失败/)
})

test('同意记录成功后才提交注销申请', async () => {
  consentResult = () => Promise.resolve()
  const page = makePage()
  page.data.confirmed = true
  page.data.smscode = '123456'

  page.apply()
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(callOrder, ['consent', 'apply'])
  assert.equal(requests.filter(request => request.url === '/api/user/deregister/apply').length, 1)
})

test('未知注销状态失败关闭，不得掉进永久加载或伪造可注销态', () => {
  const page = makePage()
  page.loadStatus()
  requests[0].success({ code: 200, data: { status: 'MYSTERY' } })

  assert.equal(page.data.status, 'ERROR')
  assert.match(page.data.statusError, /状态/)
  assert.equal(requests.filter(request => request.url === '/api/user/deregister/precheck').length, 0)

  page.loadPrecheck()
  requests.at(-1).success({ code: 200, data: { status: 'UNKNOWN', blockers: [] } })
  assert.equal(page.data.status, 'ERROR')
})

test('短信发送全链路单飞，失败保留内联错误且不会误报已发送', () => {
  const page = makePage()
  page.sendSms()
  page.sendSms()
  assert.equal(requests.filter(request => request.url === '/api/user/info').length, 1)

  requests[0].success({ code: 200, data: { phone: '13800138000' } })
  const sms = requests.find(request => request.url === '/api/sms/send')
  assert.ok(sms)
  page.sendSms()
  assert.equal(requests.filter(request => request.url === '/api/sms/send').length, 1)
  sms.fail({ errMsg: 'request:fail' })

  assert.equal(page.data.smsSending, false)
  assert.equal(page.data.smsSent, false)
  assert.match(page.data.smsError, /网络|发送/)
  assert.equal(sms.silentError, true)
})

test('注销提交和撤销都保持单飞，失败状态留在当前正文', async () => {
  consentResult = () => Promise.resolve()
  const page = makePage()
  Object.assign(page.data, { confirmed: true, smscode: '123456', canApply: true, status: 'ELIGIBLE' })

  page.apply()
  page.apply()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(consentCalls.length, 1)
  const applyRequest = requests.find(request => request.url === '/api/user/deregister/apply')
  assert.ok(applyRequest)
  applyRequest.success({ code: 500, msg: '验证码输入有误' })
  assert.equal(page.data.submitting, false)
  assert.match(page.data.applyError, /验证码输入有误/)

  page.data.status = 'PENDING'
  page.cancel()
  page.cancel()
  assert.equal(modals.length, 1)
  modals[0].success({ confirm: true })
  const cancelRequest = requests.find(request => request.url === '/api/user/deregister/cancel')
  assert.ok(cancelRequest)
  cancelRequest.fail({ errMsg: 'request:fail' })
  assert.equal(page.data.canceling, false)
  assert.match(page.data.cancelError, /网络|撤销/)
  assert.equal(cancelRequest.silentError, true)
})
