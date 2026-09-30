const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'subpackageP3/pages/growthcenter/leaderboard/index.js')

function loadPage() {
  const sandbox = { requests: [] }
  global.getApp = () => ({
    sendRequest: (options) => sandbox.requests.push(options),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  })
  global.wx = { stopPullDownRefresh() {}, switchTab() {}, navigateBack() {} }
  global.Page = (config) => { sandbox.def = config }
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const page = Object.assign({}, sandbox.def, {
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback() },
  })
  page.data = JSON.parse(JSON.stringify(sandbox.def.data))
  return { page, sandbox }
}

function board(score, memberId = 1) {
  return { list: [{ rank: 1, memberId, nickname: `玩家${memberId}`, score }], me: null }
}

test('切换榜单时只允许最新 metric/period 响应与 complete 写入', () => {
  const { page, sandbox } = loadPage()
  page.onLoad({})
  assert.deepEqual(sandbox.requests[0].data, { metric: 'point', period: 'total', limit: 50 })

  page.switchMetric('exp')
  assert.deepEqual(sandbox.requests[1].data, { metric: 'exp', period: 'total', limit: 50 })

  sandbox.requests[0].success({ code: 200, data: board(100, 1) })
  sandbox.requests[0].complete()
  assert.equal(page.data.loading, true, '旧 complete 不得提前关掉新请求 loading')
  assert.equal(page.data.top3.length, 0, '旧 point 响应不得覆盖 exp 页')

  sandbox.requests[1].success({ code: 200, data: board(200, 2) })
  sandbox.requests[1].complete()
  assert.equal(page.data.loading, false)
  assert.equal(page.data.unit, 'EXP')
  assert.equal(page.data.top3[0].memberId, 2)
})

test('最新请求失败后，旧成功/失败都不能复活或覆盖终态', () => {
  const { page, sandbox } = loadPage()
  page.onLoad({})
  page.switchPeriod('week')

  sandbox.requests[1].fail({ errMsg: 'offline' })
  sandbox.requests[1].complete()
  assert.equal(page.data.errorMsg, '排行榜没有加载出来')
  assert.equal(page.data.loading, false)

  sandbox.requests[0].success({ code: 200, data: board(99) })
  sandbox.requests[0].complete()
  assert.equal(page.data.errorMsg, '排行榜没有加载出来')
  assert.equal(page.data.top3.length, 0)
})

test('榜首标记使用项目图标资产，不用文字皇冠', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'subpackageP3/pages/growthcenter/leaderboard/index.wxml'), 'utf8')
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'subpackageP3/pages/growthcenter/leaderboard/index.json'), 'utf8'))
  assert.match(wxml, /<cy-icon[^>]*class="gc-crown"[^>]*name="star"/)
  assert.doesNotMatch(wxml, /♔|👑/)
  assert.equal(json.usingComponents['cy-icon'], '/components/cy/icon/index')
})

test('negative control:请求必须捕获 metric/period 与序号，不能在 success 读取当前 tab', () => {
  const source = fs.readFileSync(MODULE, 'utf8')
  assert.match(source, /const metric = this\.data\.metric/)
  assert.match(source, /const period = this\.data\.period/)
  assert.match(source, /_boardRequestId/)
  assert.match(source, /buildBoard\(res\.data \|\| \{\}, metric\)/)
})
