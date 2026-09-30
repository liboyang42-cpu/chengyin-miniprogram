'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_PATH = path.join(ROOT, 'subpackageP3/pages/stamp-camera/index/index.js')
const WXML_PATH = path.join(ROOT, 'subpackageP3/pages/stamp-camera/index/index.wxml')
const JSON_PATH = path.join(ROOT, 'subpackageP3/pages/stamp-camera/index/index.json')
const PENDING_KEY = 'cy_stamp_pending_create:7'

function harness() {
  const requests = []
  const stored = {}
  const toasts = []
  let uploadDone
  let definition
  const operation = () => ({
    aborted: false,
    attach(control) { this.control = control; return this },
    finish() { this.control = null },
    abort() { this.aborted = true },
    isAborted() { return this.aborted },
  })
  global.getApp = () => ({
    getUserID: () => 7,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    createPageBoundOperation: operation,
    getUploadClient: () => ({
      uploadAll(_files, options) {
        uploadDone = options.onDone
        return { abort() {} }
      },
    }),
    sendRequest(options) { requests.push(options); return { abort() {} } },
  })
  global.Page = (config) => { definition = config }
  global.wx = {
    getStorageSync: (key) => stored[key],
    setStorageSync: (key, value) => { stored[key] = value },
    removeStorageSync: (key) => { delete stored[key] },
    showToast: (options) => toasts.push(options && options.title),
  }
  delete require.cache[require.resolve(PAGE_PATH)]
  require(PAGE_PATH)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch)
      if (done) done.call(this)
    },
  })
  return { page, requests, stored, toasts, get uploadDone() { return uploadDone } }
}

test('上传失败留在取景页原位恢复，保留照片并允许重试', () => {
  const h = harness()
  h.page.data.shot = '/tmp/stamp.jpg'
  h.page._idemKey = 'st-fixed'
  h.page.onSave()
  assert.equal(h.page.data.saving, true)
  h.uploadDone({ results: [] })

  assert.equal(h.page.data.saving, false)
  assert.equal(h.page.data.shot, '/tmp/stamp.jpg')
  assert.equal(h.page.data.saveErrorKind, 'network')
  assert.match(h.page.data.saveError, /上传/)
  assert.deepEqual(h.toasts, [], '上传失败不应只靠瞬时 toast')

  h.page.onSave()
  assert.equal(h.page.data.saveError, '')
  assert.equal(h.page.data.saving, true)
})

test('写入结果未知时保留幂等 pending，页内提示后用同一键重试对账', () => {
  const h = harness()
  h.stored[PENDING_KEY] = { picUrl: 'https://img.example/stamp.jpg', idempotencyKey: 'st-fixed', memberId: '7' }
  h.page.data.shot = '/tmp/stamp.jpg'
  h.page.onSave()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].silentError, true)
  h.requests[0].fail({ errMsg: 'request:fail timeout' })
  h.requests[0].complete()

  assert.equal(h.page.data.saving, false)
  assert.equal(h.page.data.saveErrorKind, 'network')
  assert.match(h.page.data.saveError, /待确认/)
  assert.equal(h.stored[PENDING_KEY].idempotencyKey, 'st-fixed')
  assert.deepEqual(h.toasts, [])

  h.page.onSave()
  assert.equal(h.requests.length, 2)
  assert.equal(h.requests[1].data.idempotencyKey, 'st-fixed')
})

test('业务拒绝使用统一错误文案，清掉明确未入册的 pending 但保留照片', () => {
  const h = harness()
  h.stored[PENDING_KEY] = { picUrl: 'https://img.example/stamp.jpg', idempotencyKey: 'st-fixed', memberId: '7' }
  h.page.data.shot = '/tmp/stamp.jpg'
  h.page.onSave()
  h.requests[0].success({ code: 500, msg: '今日集邮次数已用完' })
  h.requests[0].complete()

  assert.equal(h.stored[PENDING_KEY], undefined)
  assert.equal(h.page.data.shot, '/tmp/stamp.jpg')
  assert.equal(h.page.data.saveErrorKind, 'data')
  assert.equal(h.page.data.saveError, '今日集邮次数已用完')
  assert.deepEqual(h.toasts, [])
})

test('保存错误显示在 LCD 内并提供重试，保存按钮暴露忙碌语义', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const json = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{shot && saveError\}\}"[^>]*kind="\{\{saveErrorKind\}\}"[^>]*action="重试"[^>]*bind:action="onSave"/s)
  assert.match(wxml, /class="sc-physical-action sc-physical-action-primary[^>]*aria-role="button"[^>]*aria-disabled="\{\{saving\}\}"[^>]*aria-label="\{\{saving \? '正在存入集邮册' : '存入集邮册'\}\}"/s)
})

test('负控：移除页内错误状态时保存恢复契约必须判红', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
  assert.match(source, /saveError:\s*''/)
  const mutated = source.replace(/\n\s*saveError:\s*'',/, '')
  assert.notEqual(mutated, source, '负控锚点失效：未找到 saveError')
  assert.throws(() => assert.match(mutated.slice(mutated.indexOf('data:'), mutated.indexOf('onLoad(')), /saveError:\s*''/), assert.AssertionError)
})
