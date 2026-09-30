'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { submitBankWithdrawal } = require('../../subpackageA/utils/withdrawal-preflight.js')

function requestBody(request) {
  return typeof request.data === 'string' ? JSON.parse(request.data) : request.data
}

function harness() {
  const requests = []
  const modals = []
  const events = []
  const app = { sendRequest(options) { requests.push(options) } }
  const wx = { showModal(options) { modals.push(options) } }
  const handlers = {
    success(result) { events.push(['success', result]) },
    fail(result) { events.push(['fail', result]) },
    successStatusAbnormal(result) { events.push(['abnormal', result]) },
    cancel() { events.push(['cancel']) },
    complete() { events.push(['complete']) },
  }
  return { app, wx, handlers, requests, modals, events }
}

const DATA = {
  requestId: 'wd-contract-1',
  withdrawalAmount: 25,
  realname: '张三',
  bankName: '城瘾银行',
  bankAccount: '6222020000001234',
  mobilephone: '18800000001',
}

test('确认问题通过后才确认凭证并提交绑定 challengeId 的提现', () => {
  const h = harness()
  submitBankWithdrawal(h.app, h.wx, DATA, h.handlers)

  assert.equal(h.requests[0].url, '/api/fund/preflight/bank-withdrawal')
  assert.equal(h.requests[0].autoErrorToast, false)
  assert.deepEqual(requestBody(h.requests[0]), {
    requestId: DATA.requestId,
    amount: 25,
    realname: DATA.realname,
    bankName: DATA.bankName,
    bankAccount: DATA.bankAccount,
    mobilephone: DATA.mobilephone,
  })
  h.requests[0].success({ code: 200, data: {
    challengeId: 55,
    challengeToken: 'secret-token',
    canProceed: true,
    question: '确认提现吗？',
    consequence: '提交后将扣减余额。',
    safetyMessages: ['陌生账户请拒绝。'],
  } })
  assert.equal(h.modals.length, 1)
  assert.match(h.modals[0].content, /扣减余额/)

  h.modals[0].success({ confirm: true })
  assert.equal(h.requests[1].url, '/api/fund/preflight/55/confirm')
  assert.equal(h.requests[1].autoErrorToast, false)
  assert.deepEqual(requestBody(h.requests[1]), { challengeToken: 'secret-token' })
  h.requests[1].success({ code: 200, data: { state: 'CONFIRMED' } })

  assert.equal(h.requests[2].url, '/api/withdrawal/create')
  assert.equal(h.requests[2].autoErrorToast, false)
  assert.equal(requestBody(h.requests[2]).challengeId, 55)
  assert.equal(requestBody(h.requests[2]).requestId, DATA.requestId)
  h.requests[2].success({ code: 200, data: 91 })
  h.requests[2].complete()
  assert.deepEqual(h.events, [
    ['success', { code: 200, data: 91 }],
    ['complete'],
  ])
})

test('用户拒绝时关闭预检且绝不创建提现', () => {
  const h = harness()
  submitBankWithdrawal(h.app, h.wx, DATA, h.handlers)
  h.requests[0].success({ code: 200, data: {
    challengeId: 55,
    challengeToken: 'secret-token',
    canProceed: true,
    question: '确认提现吗？',
  } })

  h.modals[0].success({ confirm: false })

  assert.equal(h.requests[1].url, '/api/fund/preflight/55/reject')
  assert.equal(h.requests[1].autoErrorToast, false)
  assert.equal(h.requests.some((item) => item.url === '/api/withdrawal/create'), false)
  assert.deepEqual(h.events, [['cancel'], ['complete']])
})

test('预检拒绝和网络失败沿用页面原有错误通道', () => {
  const denied = harness()
  submitBankWithdrawal(denied.app, denied.wx, DATA, denied.handlers)
  denied.requests[0].success({ code: 409, msg: '确认状态异常' })
  assert.deepEqual(denied.events, [
    ['success', { code: 409, msg: '确认状态异常' }],
    ['complete'],
  ])

  const failed = harness()
  submitBankWithdrawal(failed.app, failed.wx, DATA, failed.handlers)
  failed.requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.deepEqual(failed.events, [
    ['fail', { errMsg: 'request:fail timeout' }],
    ['complete'],
  ])
})

test('自定义异常状态回调贯穿预检、确认和最终建单', () => {
  const prepare = harness()
  submitBankWithdrawal(prepare.app, prepare.wx, DATA, prepare.handlers)
  prepare.requests[0].successStatusAbnormal({ code: 503, msg: '预检繁忙' })
  assert.deepEqual(prepare.events, [
    ['abnormal', { code: 503, msg: '预检繁忙' }],
    ['complete'],
  ])

  const create = harness()
  submitBankWithdrawal(create.app, create.wx, DATA, create.handlers)
  create.requests[0].success({ code: 200, data: {
    challengeId: 55,
    challengeToken: 'secret-token',
    canProceed: true,
  } })
  create.modals[0].success({ confirm: true })
  create.requests[1].success({ code: 200 })
  create.requests[2].successStatusAbnormal({ code: 409, msg: '挑战已失效' })
  assert.deepEqual(create.events, [
    ['abnormal', { code: 409, msg: '挑战已失效' }],
    ['complete'],
  ])
})

test('取消时 reject 同步抛错仍只回调 cancel', () => {
  const h = harness()
  h.app.sendRequest = function sendRequest(options) {
    h.requests.push(options)
    if (options.url.endsWith('/reject')) throw new Error('reject unavailable')
  }
  submitBankWithdrawal(h.app, h.wx, DATA, h.handlers)
  h.requests[0].success({ code: 200, data: {
    challengeId: 55,
    challengeToken: 'secret-token',
    canProceed: true,
  } })

  h.modals[0].success({ confirm: false })

  assert.deepEqual(h.events, [['cancel'], ['complete']])
})
