const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const JS_PATH = 'subpackageMember/complaint/index.js'
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const stripComments = (source) => source.replace(/<!--[\s\S]*?-->/g, '')

function loadPage(mutate) {
  let source = read(JS_PATH)
  if (mutate) {
    const changed = mutate(source)
    assert.notEqual(changed, source, '负控锚点失效')
    source = changed
  }

  const requests = []
  const toasts = []
  let definition
  const sandbox = {
    getApp: () => ({
      sendRequest: (options) => requests.push(options),
      getRequestErrorMessage: (res, fallback) => (res && (res.msg || res.errMsg)) || fallback,
    }),
    Page: (value) => { definition = value },
    getCurrentPages: () => [{ route: JS_PATH.replace(/\.js$/, '') }],
    wx: {
      showToast: (options) => toasts.push(options && options.title),
      navigateBack() {},
      switchTab() {},
    },
    setTimeout() {},
  }
  vm.runInNewContext(source, sandbox, { filename: JS_PATH })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch)
      if (done) done.call(this)
    },
  })
  return { page, requests, toasts }
}

function assertSubmitRecoverySource(source) {
  const submitBlock = source.slice(source.indexOf('submit() {'))
  assert.match(submitBlock, /silentError:\s*true/, '提交请求必须关闭 request-client 自动 toast，避免与页内状态重复报错')
  assert.match(source, /submitError:\s*''/, '页面必须持有可观察的提交失败状态')
  assert.match(source, /submitErrorKind:\s*'data'/, '提交失败必须区分业务与网络语义')
  assert.doesNotMatch(
    submitBlock,
    /showToast\(\{\s*title:\s*(?:res\.msg\s*\|\||'网络请求失败)/,
    '接口失败必须留在表单内联展示，不能用瞬时 toast 覆盖',
  )
}

test('投诉页首载使用同构表单骨架，图标、表单与恢复动作均有真实语义', () => {
  const json = JSON.parse(read('subpackageMember/complaint/index.json'))
  const wxml = stripComments(read('subpackageMember/complaint/index.wxml'))
  const wxss = read('subpackageMember/complaint/index.wxss')

  assert.equal(json.usingComponents['cy-skeleton'], '/components/cy/skeleton/index')
  assert.equal(json.usingComponents['cy-icon'], '/components/cy/icon/index')
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.match(wxml, /<cy-skeleton\b[^>]*wx:if="\{\{loading\}\}"[^>]*type="form-section"[^>]*count="4"[^>]*loading-label="正在加载可投诉的活动"/)
  assert.doesNotMatch(wxml, /<cy-empty\b[^>]*kind="loading"/, '表单首载不能用通用空态占位')
  assert.equal((wxml.match(/<cy-icon\b[^>]*name="arrow-right"/g) || []).length, 2, '两个选择器都应使用图标库箭头')
  assert.doesNotMatch(wxml, />\s*›\s*</, '不得用文字字形伪造选择器箭头')
  assert.match(wxml, /class="cp-picker[^\"]*"[^>]*aria-role="button"[^>]*aria-label=/)
  assert.match(wxml, /<textarea\b[^>]*aria-label="投诉内容"/)
  assert.match(wxml, /<input\b[^>]*aria-label="联系方式"/)
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{submitError\}\}"[^>]*kind="\{\{submitErrorKind\}\}"[^>]*sub="\{\{submitError\}\}"[^>]*action="重试"[^>]*bind:action="submit"/)
  assert.match(wxss, /\.cp-submit-error\s*\{[^}]*margin-bottom:/s, '内联失败提示与主按钮之间必须保留节奏')
})

test('投诉提交业务失败与断网均原位恢复，保留草稿且同步防重复', () => {
  const h = loadPage()
  Object.assign(h.page.data, {
    topics: [{ id: 17, name: '城市路线' }],
    topicIndex: 0,
    typeIndex: 1,
    reason: '活动现场服务未履约',
    contact: '13800138000',
    canSubmit: true,
  })

  h.page.submit()
  h.page.submit()
  assert.equal(h.requests.length, 1, '提交中的同步连点只能发起一次请求')
  assert.equal(h.requests[0].silentError, true)
  h.requests[0].success({ code: 500, msg: '活动状态已变化，请核对后重试' })
  assert.equal(h.page.data.submitting, false)
  assert.equal(h.page.data.submitErrorKind, 'data')
  assert.equal(h.page.data.submitError, '活动状态已变化，请核对后重试')
  assert.equal(h.page.data.reason, '活动现场服务未履约')
  assert.equal(h.page.data.contact, '13800138000')
  assert.deepEqual(h.toasts, [], '接口失败不应再弹瞬时 toast')

  h.page.submit()
  assert.equal(h.requests.length, 2)
  assert.equal(h.page.data.submitError, '', '重试在途必须清掉旧错误')
  h.requests[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal(h.page.data.submitting, false)
  assert.equal(h.page.data.submitErrorKind, 'network')
  assert.match(h.page.data.submitError, /网络/)
  assert.equal(h.page.data.reason, '活动现场服务未履约')
  assert.deepEqual(h.toasts, [])
})

test('修改投诉草稿或选择项后清除旧提交错误，避免过期错误继续占位', () => {
  const h = loadPage()
  Object.assign(h.page.data, {
    topics: [{ id: 17, name: '城市路线' }],
    submitError: '旧错误',
  })
  h.page.selectPickerOption({ currentTarget: { dataset: { picker: 'topic', index: 0 } } })
  assert.equal(h.page.data.submitError, '')
  h.page.data.submitError = '旧错误'
  h.page.onReasonInput({ detail: { value: '新的投诉内容' } })
  assert.equal(h.page.data.submitError, '')
  h.page.data.submitError = '旧错误'
  h.page.onContactInput({ detail: { value: '新的联系方式' } })
  assert.equal(h.page.data.submitError, '')
})

test('提交失败降级回 toast 或移除 silentError 时，恢复契约必须判红', () => {
  const source = read(JS_PATH)
  assertSubmitRecoverySource(source)

  const withoutSilent = source.replace(
    /hideLoading:\s*true,\n\s*silentError:\s*true,\n\s*url:\s*'\/api\/coop\/complaint\/report'/,
    "hideLoading: true,\n      url: '/api/coop/complaint/report'",
  )
  assert.notEqual(withoutSilent, source, '负控锚点失效：未找到 silentError')
  assert.throws(() => assertSubmitRecoverySource(withoutSilent), assert.AssertionError)

  const withToast = source.replace(
    /that\.setData\(\{ submitting: false, submitError: res\.msg \|\| '提交失败，请重试', submitErrorKind: 'data' \}\);/,
    "that.setData({ submitting: false }); wx.showToast({ title: res.msg || '提交失败，请重试', icon: 'none' });",
  )
  assert.notEqual(withToast, source, '负控锚点失效：未找到业务失败内联状态')
  assert.throws(() => assertSubmitRecoverySource(withToast), assert.AssertionError)
})
