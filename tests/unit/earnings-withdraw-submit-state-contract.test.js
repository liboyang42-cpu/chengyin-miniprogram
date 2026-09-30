'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const JS_PATH = 'subpackageA/pages/assetcenter/earnings/index.js'
const WXML_PATH = 'subpackageA/pages/assetcenter/earnings/index.wxml'
const JSON_PATH = 'subpackageA/pages/assetcenter/earnings/index.json'
const PREFLIGHT_PATH = 'subpackageA/utils/withdrawal-preflight.js'

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function setByPath(target, key, value) {
  const parts = key.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage(source = read(JS_PATH)) {
  const requests = []
  const toasts = []
  const tips = []
  const loadingCalls = []
  const modals = []
  let definition
  const absolutePath = path.join(ROOT, JS_PATH)
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getRequestErrorMessage: (res, fallback) => (res && (res.msg || res.errMsg)) || fallback,
    getUserID: () => 7,
    sendRequest: (options) => requests.push(options),
    tips: (message) => tips.push(message),
  }
  const wx = {
    showLoading: (options) => loadingCalls.push(['show', options]),
    hideLoading: () => loadingCalls.push(['hide']),
    showToast: (options) => toasts.push(options && options.title),
    showModal: (options) => modals.push(options),
  }
  vm.runInNewContext(source, {
    console,
    getApp: () => app,
    Page: (config) => { definition = config },
    require: createRequire(absolutePath),
    setTimeout() {},
    wx,
  }, { filename: absolutePath })

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (done) done.call(this)
    },
  })
  return { page, requests, toasts, tips, loadingCalls, modals }
}

function fillValidForm(page) {
  Object.assign(page.data, {
    txBalanceErr: false,
    txBalanceLoaded: true,
    txUserInfo: { balance: 100 },
    txWithdrawalAmount: '10.00',
    txRealname: '测试用户',
    txBankName: '测试银行',
    txBankAccount: '6222020000000000',
    txMobilephone: '13800138000',
    // #825 起提现要先落个保法单独同意才建单;不勾这个,onTxSave 会停在
    // recordTxConsentThenSave 而不发建单请求 —— 这不是防重复失效,是同意闸在起作用。
    txConsented: true,
  })
  page._txConsentReady = true
  page.refreshTxSubmitState()
}

/** ★负控:同意闸必须真的挡在建单之前,不能因为夹具方便就把它绕过去。 */
function fillValidFormWithoutConsent(page) {
  fillValidForm(page)
  page.setData({ txConsented: false })
  page._txConsentReady = false
  page.refreshTxSubmitState()
}

function assertRecoverySource(source, preflightSource) {
  const initialData = source.slice(source.indexOf('data:'), source.indexOf('onLoad('))
  const submit = source.slice(source.indexOf('onTxSave() {'), source.indexOf('loadTxBalance() {'))
  assert.match(initialData, /txSubmitting:\s*false/)
  assert.match(initialData, /txSubmitError:\s*''/)
  assert.match(submit, /withdrawalPreflight\.submitBankWithdrawal\(app, wx, data,/)
  assert.equal((preflightSource.match(/autoErrorToast:\s*false/g) || []).length, 4,
    'prepare/reject/confirm/create 四个请求都必须由页面错误态承接')
  assert.match(preflightSource, /const fail = \(error\) =>/)
  assert.doesNotMatch(submit, /silentError:\s*true/)
  assert.doesNotMatch(submit, /wx\.showLoading|wx\.hideLoading|app\.tips\(|wx\.showToast\(\{\s*title:\s*'网络错误/)
}

// 2026-09-16 截图冒烟:账户收益页在 /api/user/info 回 balance=null 时整页报「收益没加载出来,
// 网络可能不稳定」。库列可空 ⇒ null/空是「新用户还没收益」的正常数据,按 0.00 展示,不算网络错。
test('可提现余额为 null/空是正常数据,按 0.00 展示;坏值与非 200 才落失败态', () => {
  const missing = loadPage()
  missing.page.loadTxBalance()
  const missingReq = missing.requests.find((request) => request.url === '/api/user/info')
  assert.ok(missingReq, 'loadTxBalance 必须请求 /api/user/info')
  missingReq.success({ code: '200', data: { balance: null } })
  assert.equal(missing.page.data.txBalanceErr, false, '余额为空不是网络错')
  assert.equal(missing.page.data.txBalanceText, '0.00', '空余额按 0.00 展示')
  assert.equal(missing.page.data.txBalanceLoaded, true)

  const bad = loadPage()
  bad.page.loadTxBalance()
  bad.requests.find((request) => request.url === '/api/user/info').success({ code: '200', data: { balance: 'abc' } })
  assert.equal(bad.page.data.txBalanceErr, true, '坏值不能被当成 0')

  const failed = loadPage()
  failed.page.loadTxBalance()
  failed.requests.find((request) => request.url === '/api/user/info').success({ code: '500', msg: '服务异常' })
  assert.equal(failed.page.data.txBalanceErr, true, '真失败才落失败态')
})

test('★未勾单独同意时不得建单 —— 同意记录必须先于提现单落库', () => {
  const h = loadPage()
  fillValidFormWithoutConsent(h.page)

  h.page.onTxSave()

  assert.equal(h.requests.filter((r) => /withdrawal\/create/.test(r.url || '')).length, 0,
    '没有单独同意就建单 = 打了款却没有同意凭据,个保法上站不住')
})

test('提现 sheet 提交中可见、防重复，业务失败与断网均原位恢复并保留表单', () => {
  const h = loadPage()
  fillValidForm(h.page)

  h.page.onTxSave()
  h.page.onTxSave()
  assert.equal(h.requests.length, 1, '同步连点只能发起一次资金预检')
  assert.equal(h.page.data.txSubmitting, true)
  assert.equal(h.requests[0].hideLoading, true)
  assert.equal(h.requests[0].autoErrorToast, false)
  assert.deepEqual(h.loadingCalls, [], '提交进度必须留在 sheet 主按钮，不能覆盖成全局 loading')

  h.requests[0].success({ code: 200, data: {
    challengeId: 55,
    challengeToken: 'challenge-token',
    canProceed: true,
    question: '确认提现吗？',
  } })
  h.modals[0].success({ confirm: true })
  h.requests[1].success({ code: 200 })
  h.requests[2].success({ code: 500, msg: '收款信息需要重新核对' })
  h.requests[2].complete()
  assert.equal(h.page.data.txSubmitting, false)
  assert.equal(h.page.data.txSubmitErrorKind, 'data')
  assert.equal(h.page.data.txSubmitError, '收款信息需要重新核对')
  assert.equal(h.page.data.txBankAccount, '6222020000000000')
  assert.deepEqual(h.tips, [])
  assert.deepEqual(h.toasts, [])

  h.page.onTxSave()
  assert.equal(h.requests.length, 4)
  assert.equal(h.page.data.txSubmitError, '', '重试在途应清掉过期错误')
  h.requests[3].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.txSubmitting, false)
  assert.equal(h.page.data.txSubmitErrorKind, 'network')
  assert.match(h.page.data.txSubmitError, /网络/)
  assert.equal(h.page.data.txRealname, '测试用户')
  assert.deepEqual(h.toasts, [])
})

test('修改提现字段会清掉旧提交错误，页面用内联恢复组件和按钮 loading 呈现状态', () => {
  const h = loadPage()
  h.page.data.txSubmitError = '旧错误'
  h.page.onTxBankNameInput({ detail: { value: '新银行' } })
  assert.equal(h.page.data.txSubmitError, '')

  const wxml = read(WXML_PATH).replace(/<!--[\s\S]*?-->/g, '')
  const json = JSON.parse(read(JSON_PATH))
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{txSubmitError\}\}"[^>]*kind="\{\{txSubmitErrorKind\}\}"[^>]*action="重试"[^>]*bind:action="onTxSave"/s)
  assert.match(wxml, /<cy-btn\b[^>]*loading="\{\{txSubmitting\}\}"[^>]*disabled="\{\{!txCanSubmit \|\| txSubmitting\}\}"[^>]*aria-disabled="\{\{!txCanSubmit \|\| txSubmitting\}\}"/s)
})

test('负控：任一预检请求恢复通用错误 toast 或移除可观察提交状态时必须判红', () => {
  const source = read(JS_PATH)
  const preflightSource = read(PREFLIGHT_PATH)
  assertRecoverySource(source, preflightSource)

  const withGenericToast = preflightSource.replace(/\n\s*autoErrorToast:\s*false,/, '')
  assert.notEqual(withGenericToast, preflightSource, '负控锚点失效：未找到 autoErrorToast')
  assert.throws(() => assertRecoverySource(source, withGenericToast), assert.AssertionError)

  const withoutVisibleState = source.replace(/\n\s*txSubmitting:\s*false,/, '')
  assert.notEqual(withoutVisibleState, source, '负控锚点失效：未找到 txSubmitting')
  assert.throws(() => assertRecoverySource(withoutVisibleState, preflightSource), assert.AssertionError)
})
