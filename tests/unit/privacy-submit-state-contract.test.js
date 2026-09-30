const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'pages/privacy/index.js')

function loadPage(recordConsent) {
  const sandbox = { records: [], resolutions: [], toasts: [], backs: 0 }
  global.getApp = () => ({
    hasPendingPrivacyAuthorization: () => true,
    recordConsent: (payload) => { sandbox.records.push(payload); return recordConsent(payload) },
    resolvePrivacyAuthorization: (payload) => sandbox.resolutions.push(payload),
  })
  global.wx = {
    showToast: (options) => sandbox.toasts.push(options.title),
    navigateBack: () => { sandbox.backs += 1 },
    stopLocationUpdate() {},
  }
  global.Page = (config) => { sandbox.def = config }
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const page = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  })
  page.data = JSON.parse(JSON.stringify(sandbox.def.data))
  return { page, sandbox }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

test('同意记录失败保留持久错误与重试上下文，不用易逝 toast', async () => {
  let shouldFail = true
  const { page, sandbox } = loadPage(() => shouldFail ? Promise.reject(new Error('offline')) : Promise.resolve())
  page.agreePrivacy({ detail: { buttonId: 'agree-button' } })
  await settle()
  assert.equal(page.data.submitting, false)
  assert.equal(page.data.failedAction, 'agree')
  assert.match(page.data.submitError, /同意记录失败/)
  assert.equal(sandbox.toasts.length, 0)
  assert.equal(sandbox.backs, 0)

  shouldFail = false
  page.retrySubmit()
  await settle()
  assert.equal(sandbox.records.length, 2)
  assert.deepEqual(sandbox.resolutions, [{ event: 'agree', buttonId: 'agree-button' }])
  assert.equal(sandbox.backs, 1)
})

test('撤回记录失败保持页面与错误，重试成功后清除错误', async () => {
  let shouldFail = true
  const { page, sandbox } = loadPage(() => shouldFail ? Promise.reject(new Error('offline')) : Promise.resolve())
  page.withdrawRoamLocationConsent()
  await settle()
  assert.equal(page.data.failedAction, 'revoke')
  assert.match(page.data.submitError, /撤回记录失败/)
  assert.equal(sandbox.toasts.length, 0)

  shouldFail = false
  page.retrySubmit()
  await settle()
  assert.equal(page.data.submitError, '')
  assert.equal(page.data.failedAction, '')
  assert.deepEqual(sandbox.records.map((item) => item.eventType), ['REVOKE', 'REVOKE'])
  assert.deepEqual(sandbox.toasts, ['已撤回漫游定位同意'])
})

test('WXML 提供持久 inline error 与真实重试，按钮暴露 busy/disabled', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/privacy/index.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/privacy/index.json'), 'utf8'))
  assert.match(wxml, /<cy-inline-error[^>]*wx:if="\{\{submitError\}\}"[^>]*action="重试"[^>]*bind:action="retrySubmit"/)
  assert.match(wxml, /aria-disabled="\{\{submitting\}\}"/)
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
})

test('negative control:失败分支必须写 submitError/failedAction，不能只 showToast', () => {
  const source = fs.readFileSync(MODULE, 'utf8')
  assert.match(source, /failedAction:\s*'agree'/)
  assert.match(source, /failedAction:\s*'revoke'/)
  assert.match(source, /retrySubmit\(\)/)
})
