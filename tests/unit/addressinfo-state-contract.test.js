'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

function applyPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.split('.')
    let cursor = target
    for (let index = 0; index < parts.length - 1; index += 1) cursor = cursor[parts[index]]
    cursor[parts.at(-1)] = value
  })
}

function loadPage() {
  let definition
  const requests = []
  const timers = []
  const app = {
    globalData: {},
    getRequestErrorMessage: (_res, fallback) => fallback,
    sendRequest(options) { requests.push(options); return { abort() {} } },
  }
  vm.runInNewContext(read('pages/addressinfo/addressinfo.js'), {
    getApp: () => app,
    Page(value) { definition = value },
    require(request) {
      if (request === '../../utils/form-state.js') return require('../../utils/form-state.js')
      throw new Error(`unexpected require: ${request}`)
    },
    wx: {
      showToast() {},
      navigateBack() {},
      redirectTo() {},
      reLaunch() {},
    },
    Date,
    Math,
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length },
    clearTimeout() {},
    console,
  }, { filename: 'pages/addressinfo/addressinfo.js' })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch, callback) {
    applyPatch(this.data, patch)
    if (callback) callback()
  }
  return { page, requests, timers }
}

function assertAddressStateContract(wxml, jsonText) {
  const json = JSON.parse(jsonText)
  const components = json.usingComponents || {}
  for (const name of ['cy-skeleton', 'cy-state-shell', 'cy-inline-error', 'cy-progress-status']) {
    assert.ok(components[name], `参与人表单必须注册 ${name}`)
  }
  assert.match(wxml, /<cy-skeleton\b[^>]*wx:if="\{\{bootstrapping\}\}"[^>]*type="form-section"/,
    '编辑态预填时必须用表单同构骨架')
  assert.match(wxml, /<cy-state-shell\b[^>]*wx:elif="\{\{bootstrapError\}\}"[^>]*bind:primary="retryBootstrap"/,
    '预填失败不能落成空白新增表单')
  assert.match(wxml, /<view class="add" wx:else>/,
    '只有新建态或预填成功后才显示可编辑表单')
  assert.match(wxml, /<cy-progress-status\b[^>]*wx:if="\{\{saving \|\| saveSucceeded\}\}"/,
    '保存中和成功需要可读状态/回执')
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{saveError\}\}"[^>]*bind:action="saveAddress"/,
    '保存失败必须保留表单并提供局部重试')
  assert.match(wxml, /<cy-footer-bar\b[^>]*wx:if="\{\{!bootstrapping && !bootstrapError\}\}"/,
    '预填失败时不能保留保存 CTA')
}

test('参与人编辑预填、保存失败与成功回执采用统一状态组件', () => {
  assertAddressStateContract(
    read('pages/addressinfo/addressinfo.wxml'),
    read('pages/addressinfo/addressinfo.json'),
  )
})

test('编辑预填失败不会伪装成空白新增表单，并可原地重试', () => {
  const h = loadPage()
  h.page.onLoad({ id: '7' })
  assert.equal(h.page.data.bootstrapping, true)
  h.page.retryBootstrap()
  assert.equal(h.requests.length, 1)
  h.requests[0].fail()
  assert.equal(h.page.data.bootstrapping, false)
  assert.equal(h.page.data.bootstrapErrorKind, 'network')
  assert.match(h.page.data.bootstrapError, /网络|参与人/)
  h.page.retryBootstrap()
  assert.equal(h.requests.length, 2)
  h.requests[1].success({
    code: 200,
    data: { fullName: '玩家甲', mobilePhone: '13800138000', province: '', detailAddress: '' },
  })
  assert.equal(h.page.data.bootstrapping, false)
  assert.equal(h.page.data.form.fullName, '玩家甲')
  assert.equal(h.page.data.bootstrapError, '')
})

test('保存失败保留草稿与稳定 requestId，成功后显示回执并锁定', () => {
  const h = loadPage()
  h.page.data.form.fullName = '玩家甲'
  h.page.data.form.mobilePhone = '13800138000'
  h.page.data.canSubmit = true
  h.page.saveAddress()
  const requestId = h.requests[0].data.requestId
  h.requests[0].fail()
  h.requests[0].complete()
  assert.equal(h.page.data.saving, false)
  assert.match(h.page.data.saveError, /网络/)
  assert.equal(h.page.data.form.fullName, '玩家甲')

  h.page.saveAddress()
  assert.equal(h.requests[1].data.requestId, requestId)
  h.requests[1].success({ code: 200, data: { id: 9 } })
  h.requests[1].complete()
  assert.equal(h.page.data.saveSucceeded, true)
  assert.equal(h.page.data.saving, false)
  h.page.saveAddress()
  assert.equal(h.requests.length, 2)
})

test('负控:去掉预填骨架或错误态时必须判红', () => {
  const source = read('pages/addressinfo/addressinfo.wxml')
  const json = read('pages/addressinfo/addressinfo.json')
  const noSkeleton = source.replace(/<cy-skeleton\b[^>]*\/>/, '<view wx:if="{{bootstrapping}}">加载中</view>')
  assert.ok(noSkeleton !== source, '预填骨架负控锚点失效')
  assert.throws(() => assertAddressStateContract(noSkeleton, json), /同构骨架/)

  const noError = source.replace(/<cy-state-shell\b[^>]*\/>/, '')
  assert.ok(noError !== source, '预填错误负控锚点失效')
  assert.throws(() => assertAddressStateContract(noError, json), /预填失败/)
})
