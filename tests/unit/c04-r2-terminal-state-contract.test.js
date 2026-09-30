const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const COMPLAINT_JS = path.join(ROOT, 'subpackageMember/complaint/index.js')
const MYCANYU_JS = path.join(ROOT, 'subpackageMember/mycanyu/mycanyu.js')

function loadComplaintPage() {
  const sandbox = { requests: [] }
  global.getApp = () => ({
    getRequestErrorMessage: (response, fallback) => (response && response.msg) || fallback,
    sendRequest: request => sandbox.requests.push(request),
  })
  global.Page = config => { sandbox.pageConfig = config }
  global.wx = { showToast() {}, navigateBack() {} }
  delete require.cache[require.resolve(COMPLAINT_JS)]
  require(COMPLAINT_JS)
  const page = Object.assign({}, sandbox.pageConfig, {
    setData(patch) { Object.assign(this.data, patch) },
  })
  page.data = Object.assign({}, sandbox.pageConfig.data)
  return { page, sandbox }
}

function loadMyCanyuPage() {
  const sandbox = { requests: [] }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getRequestErrorMessage: (response, fallback) => (response && response.msg) || fallback,
    sendRequest: request => sandbox.requests.push(request),
  })
  global.Page = config => { sandbox.pageConfig = config }
  global.wx = { navigateBack() {}, switchTab() {}, navigateTo() {}, stopPullDownRefresh() {} }
  delete require.cache[require.resolve(MYCANYU_JS)]
  require(MYCANYU_JS)
  const page = Object.assign({}, sandbox.pageConfig, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  })
  page.data = Object.assign({}, sandbox.pageConfig.data)
  return { page, sandbox }
}

function assertComplaintTerminalHandler(source) {
  assert.match(source, /const finishLoadError = \(res, fallback\) => \{[\s\S]*loading:\s*false[\s\S]*errorMsg:\s*app\.getRequestErrorMessage\(res, fallback\)/)
  assert.match(source, /successStatusAbnormal\(res\)\s*\{\s*finishLoadError\(res, '登录状态已失效，请重新进入'\);\s*\}/)
  assert.match(source, /fail\(res\)\s*\{\s*finishLoadError\(res, '网络异常，请重试'\);\s*\}/)
  assert.match(source, /silentError:\s*true/)
}

function assertMyCanyuTerminalHandler(source) {
  assert.match(source, /const finishLoadError = \(res, fallback\) => \{\s*const message = app\.getRequestErrorMessage\(res, fallback\);/)
  // 2026-08-26 刷新失败横幅退役:有旧快照时静默降级(不写 errorMsg,旧列表留在屏上),
  // 只有无快照的首载失败才落 errorMsg 走整页错误。
  assert.match(source, /if \(hasSnapshot\) \{[\s\S]*firstLoading:\s*false[\s\S]*errorMsg:\s*''/)
  assert.match(source, /\} else \{[\s\S]*firstLoading:\s*false[\s\S]*errorMsg:\s*message/)
  assert.match(source, /successStatusAbnormal\(res\)\s*\{\s*finishLoadError\(res, '服务暂时不可用，请稍后再试'\);\s*\}/)
  assert.match(source, /fail\(res\)\s*\{\s*finishLoadError\(res, '网络异常，请重试'\);\s*\}/)
  assert.match(source, /silentError:\s*true/)
}

test('投诉页：认证终态不会把用户永久留在加载态，重试仍可成功进入表单', () => {
  const { page, sandbox } = loadComplaintPage()
  page.onLoad()
  assert.equal(sandbox.requests.length, 1)
  sandbox.requests[0].successStatusAbnormal({ code: 401, msg: '登录已过期，请重新进入' })
  assert.equal(page.data.loading, false)
  assert.equal(page.data.errorMsg, '登录已过期，请重新进入')

  page.onRetry()
  assert.equal(page.data.loading, true)
  assert.equal(sandbox.requests.length, 2)
  sandbox.requests[1].success({ code: '200', data: [] })
  assert.equal(page.data.loading, false)
  assert.equal(page.data.errorMsg, '')
})

test('我的参与：认证终态不会把用户永久留在骨架态，重试可返回空态', () => {
  const { page, sandbox } = loadMyCanyuPage()
  page.onLoad()
  assert.equal(sandbox.requests.length, 1)
  sandbox.requests[0].successStatusAbnormal({ code: 401, msg: '登录已过期，请重新进入' })
  assert.equal(page.data.firstLoading, false)
  assert.equal(page.data.errorMsg, '登录已过期，请重新进入')

  page.onRetry()
  assert.equal(page.data.firstLoading, true)
  assert.equal(sandbox.requests.length, 2)
  sandbox.requests[1].success({ code: '200', data: [] })
  assert.equal(page.data.firstLoading, false)
  assert.equal(page.data.errorMsg, '')
  assert.deepEqual(page.data.list, [])
})

test('首次 401 重登失败走 fail 时，投诉与我的参与同样落入可重试错误态', () => {
  let ctx = loadComplaintPage()
  ctx.page.onLoad()
  ctx.sandbox.requests[0].fail({ code: 401, msg: '登录已过期，请重新进入' })
  assert.equal(ctx.page.data.loading, false)
  assert.equal(ctx.page.data.errorMsg, '登录已过期，请重新进入')

  ctx = loadMyCanyuPage()
  ctx.page.onLoad()
  ctx.sandbox.requests[0].fail({ code: 401, msg: '登录已过期，请重新进入' })
  assert.equal(ctx.page.data.firstLoading, false)
  assert.equal(ctx.page.data.errorMsg, '登录已过期，请重新进入')
})

test('负控：投诉页移除 HTTP 非正常回调时，认证终态闸必须判红', () => {
  const source = read('subpackageMember/complaint/index.js')
  const mutated = source.replace('successStatusAbnormal(res)', 'statusAbnormal(res)')
  assert.notEqual(mutated, source, '变异锚点失效：未找到投诉页 HTTP 非正常回调')
  assert.throws(() => assertComplaintTerminalHandler(mutated), assert.AssertionError)
})

test('负控：我的参与页移除 HTTP 非正常回调时，认证终态闸必须判红', () => {
  const source = read('subpackageMember/mycanyu/mycanyu.js')
  const mutated = source.replace('successStatusAbnormal(res)', 'statusAbnormal(res)')
  assert.notEqual(mutated, source, '变异锚点失效：未找到我的参与页 HTTP 非正常回调')
  assert.throws(() => assertMyCanyuTerminalHandler(mutated), assert.AssertionError)
})

test('负控：移除首次认证失败的 fail 终态时，两个页面闸必须判红', () => {
  const complaint = read('subpackageMember/complaint/index.js').replace('fail(res)', 'requestFail(res)')
  const mycanyu = read('subpackageMember/mycanyu/mycanyu.js').replace('fail(res)', 'requestFail(res)')
  assert.throws(() => assertComplaintTerminalHandler(complaint), assert.AssertionError)
  assert.throws(() => assertMyCanyuTerminalHandler(mycanyu), assert.AssertionError)
})

test('投诉与我的参与均显式声明 HTTP 非正常终态处理', () => {
  assertComplaintTerminalHandler(read('subpackageMember/complaint/index.js'))
  assertMyCanyuTerminalHandler(read('subpackageMember/mycanyu/mycanyu.js'))
})
