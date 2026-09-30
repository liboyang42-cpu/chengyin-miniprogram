'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const SEARCH_MODULE = path.join(ROOT, 'pages/search2/index.js')
const CROP_MODULE = path.join(ROOT, 'pages/crop/index.js')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadSearch() {
  const requests = []
  let definition
  global.getApp = () => ({
    getRequestErrorMessage: (response, fallback) => (response && (response.msg || response.errMsg)) || fallback,
    sendRequest: (options) => requests.push(options),
  })
  global.Page = (config) => { definition = config }
  global.wx = {
    getStorageSync: () => [],
    setStorageSync() {},
    removeStorageSync() {},
  }
  delete require.cache[require.resolve(SEARCH_MODULE)]
  require(SEARCH_MODULE)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch)
      if (done) done.call(this)
    },
  })
  return { page, requests }
}

function loadCrop() {
  const imageRequests = []
  let definition
  global.Page = (config) => { definition = config }
  global.wx = {
    getImageInfo: (options) => imageRequests.push(options),
    navigateBack() {},
    reLaunch() {},
    createSelectorQuery: () => ({
      in() { return this },
      select() { return this },
      fields() { return this },
      exec(callback) { callback([{}]) },
    }),
  }
  delete require.cache[require.resolve(CROP_MODULE)]
  require(CROP_MODULE)
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch)
      if (done) done.call(this)
    },
    queue: ['/tmp/input.jpg'],
    results: [],
    idx: 0,
    ratioLiteral: '1:1',
    natural: { w: 100, h: 100 },
  })
  return { page, imageRequests }
}

test('搜索类别只把合法数组当成功，畸形 200 显示可重试错误', () => {
  const h = loadSearch()
  h.page.getCategoryList()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].hideLoading, true)
  assert.equal(h.requests[0].silentError, true)
  h.requests[0].success({ code: 200, data: {} })
  assert.equal(h.page.data.categoryLoading, false)
  assert.notEqual(h.page.data.categoryError, '')
  assert.deepEqual(h.page.data.categoryList, [])
})

test('类别请求只接受最新响应，迟到 complete 不能提前结束新请求', () => {
  const h = loadSearch()
  h.page.getCategoryList()
  h.page.getCategoryList()
  h.requests[0].success({ code: 200, data: [{ id: 1, categoryName: '旧' }] })
  assert.equal(h.page.data.categoryLoading, true)
  h.requests[1].success({ code: 200, data: [] })
  assert.equal(h.page.data.categoryLoading, false)
  assert.deepEqual(h.page.data.categoryList, [])
})

test('裁剪读图失败不静默冒充选取成功，保留重试与显式使用原图出口', () => {
  const h = loadCrop()
  h.page.startAt(0)
  h.imageRequests[0].fail({ errMsg: 'image info fail' })
  assert.equal(h.page.data.sourceState, 'error')
  assert.notEqual(h.page.data.sourceError, '')
  assert.deepEqual(h.page.results, [])
  assert.equal(h.page.done, undefined)
})

test('裁剪导出节点不可用时保留当前裁剪，不自动返回原图', () => {
  const h = loadCrop()
  Object.assign(h.page.data, {
    ready: true,
    sourceState: 'ready',
    frameW: 100,
    frameH: 100,
    scale: 1.2,
    tx: 0,
    ty: 0,
  })
  h.page.onConfirm()
  assert.equal(h.page.data.busy, false)
  assert.notEqual(h.page.data.exportError, '')
  assert.deepEqual(h.page.results, [])
})

test('裁剪等待、读图错误和导出错误都使用现有状态组件', () => {
  const wxml = read('pages/crop/index.wxml')
  const json = JSON.parse(read('pages/crop/index.json'))
  assert.equal(json.usingComponents['cy-error'], '/components/cy/error/index')
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.match(wxml, /sourceState === 'waiting'[\s\S]*<cy-empty[^>]*kind="loading"/)
  assert.match(wxml, /sourceState === 'error'[\s\S]*<cy-error/)
  assert.match(wxml, /exportError[\s\S]*<cy-inline-error/)
  assert.match(wxml, /bindtap="onUseOriginal"/)
  assert.doesNotMatch(wxml, /crop__waiting-text/)
})

test('负控：裁剪失败退回 acceptRaw 会被契约判红', () => {
  const source = read('pages/crop/index.js')
  const anchor = "fail: () => this.showSourceError('这张图片暂时无法读取，请重试或使用原图')"
  assert.ok(source.includes(anchor))
  const broken = source.replace(anchor, "fail: () => this.acceptRaw()")
  assert.notEqual(broken, source, '负控锚点失效')
  assert.equal(broken.includes(anchor), false)
})
