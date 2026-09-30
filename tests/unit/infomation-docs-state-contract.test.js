const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'subpackageA/pages/infomation/infomation.js')

function loadPage() {
  const sandbox = { requests: [] }
  global.getApp = () => ({
    globalData: {},
    getPageSize: () => 10,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: (options) => sandbox.requests.push(options),
    isDevEnv: () => false,
  })
  global.wx = {}
  global.Page = (config) => { sandbox.def = config }
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const page = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  })
  page.data = JSON.parse(JSON.stringify(sandbox.def.data))
  return { page, sandbox }
}

function docsRequest(page, sandbox) {
  page.getList()
  return sandbox.requests.find((request) => request.url === '/api/common/infomation_list')
}

test('玩法文档业务/网络/HTTP 失败进入 error，不伪装成“暂无玩法说明”', () => {
  for (const settle of [
    (request) => request.success({ code: 500, msg: '服务异常' }),
    (request) => request.fail({ errMsg: 'offline' }),
    (request) => request.successStatusAbnormal({ statusCode: 502 }),
    (request) => request.success({ code: 200, data: {} }),
  ]) {
    const { page, sandbox } = loadPage()
    const request = docsRequest(page, sandbox)
    settle(request)
    assert.equal(page.data.docsState, 'error')
    assert.equal(page.data.nodata, false)
    assert.ok(page.data.docsError)
  }
})

test('空数组是真空态；有效数组进入 ready', () => {
  let ctx = loadPage()
  docsRequest(ctx.page, ctx.sandbox).success({ code: '200', data: [] })
  assert.equal(ctx.page.data.docsState, 'empty')
  assert.equal(ctx.page.data.nodata, true)

  ctx = loadPage()
  docsRequest(ctx.page, ctx.sandbox).success({ code: 200, data: [{ id: 1, title: '新手指南', contents: '<p>正文</p>' }] })
  assert.equal(ctx.page.data.docsState, 'ready')
  assert.equal(ctx.page.data.nodata, false)
  assert.equal(ctx.page.data.list.length, 1)
})

test('WXML 文档区 loading/error/empty/ready 互斥，错误有真实重试', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackageA/pages/infomation/infomation.wxml'), 'utf8')
  assert.match(wxml, /docsState === 'loading'/)
  assert.match(wxml, /docsState === 'error'/)
  assert.match(wxml, /bind:retry="getList"/)
  assert.match(wxml, /docsState === 'ready'/)
  assert.match(wxml, /docsState === 'empty'/)
})

test('negative control:必须有 fail 与 successStatusAbnormal，且先校验 data 是数组', () => {
  const source = fs.readFileSync(MODULE, 'utf8')
  assert.match(source, /Array\.isArray\(res\.data\)/)
  assert.match(source, /fail\(res\)/)
  assert.match(source, /successStatusAbnormal/)
})
