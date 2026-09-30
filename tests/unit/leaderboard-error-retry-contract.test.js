const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const WXML = 'subpackageP3/pages/growthcenter/leaderboard/index.wxml'
const JSON_FILE = 'subpackageP3/pages/growthcenter/leaderboard/index.json'
const PAGE = '../../subpackageP3/pages/growthcenter/leaderboard/index.js'

/**
 * 2026-08-19 UI 全量复核批1 挖出的两条产品缺口:
 *  P1-1 榜单全空时整页只剩两排 Tab —— wxml 只有 errorMsg / loading 两个分支,
 *       wx:else 直接进榜单渲染,而榜单每一块又各自挂在 top3[i] / rest / me 上,
 *       全空 ⇒ 一片黑、零反馈。
 *  P1-2 错误态是裸 <view> 一行红字,没有重试入口 —— 全仓唯一例外
 *       (B64/D10/D24/D31/E02/F06 全是 cy-error + 重试)。
 *
 * HTTP/业务失败(含 404)统一走 cy-error 可重试错误态,不得再映射成「暂未开放」。
 */

let pageConfig
let requests
let switched

global.getApp = () => ({
  globalData: {},
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (req) => { requests.push(req) },
})

global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  stopPullDownRefresh() {},
  switchTab: (opt) => { switched.push(opt.url) },
  navigateBack() {},
  showToast() {},
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  pageConfig = null
  requests = []
  switched = []
})

function setByPath(target, p, value) {
  const parts = p.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = (patch, cb) => {
    Object.entries(patch).forEach(([k, v]) => setByPath(page.data, k, v))
    if (cb) cb()
  }
  return page
}



test('P1-2 结构:真失败走 cy-error 且带 retry,不再是裸 view 一行红字', () => {
  const wxml = read(WXML)
  assert.doesNotMatch(wxml, /class="gc-state \{\{boardState/, '裸 view 的错误分支必须被替换掉')
  const err = wxml.match(/<cy-error[\s\S]*?\/>/)
  assert.ok(err, '缺 cy-error')
  const tag = err[0]
  assert.match(tag, /wx:if="\{\{errorMsg\}\}"/, '失败态必须走 cy-error')
  // ⚠️ 别用 /retry="/ 当锚点:`bind:retry="onRetry"` 里也含这五个字符 ⇒ 把
  //    retry="重新加载" 整行删掉,这条断言照样绿(第一版负控 N4 就是这么假绿的)。
  //    锚定「前面是空白、不是 bind:」的那个独立属性。
  assert.match(tag, /\sretry="[^"]+"/, '错误态必须给重试入口(retry 属性本身,不是 bind:retry)')
  assert.match(tag, /bind:retry="/, '重试必须接住')
})

test('P1-2 结构:不得保留「暂未开放」notice 分支', () => {
  const wxml = read(WXML)
  assert.doesNotMatch(wxml, /gc-notice-board|暂未开放|还没开放/, 'HTTP 失败不得再落 notice 说明态')
})

test('P1-2 行为:点重试**真的重新发起一次请求**(截图证明不了这一条)', () => {
  const page = loadPage()
  page.onLoad({})
  requests[0].fail()
  requests[0].complete()
  assert.equal(page.data.errorMsg, '排行榜没有加载出来')

  const before = requests.length
  assert.equal(typeof page.onRetry, 'function', 'bind:retry 指向的方法必须存在')
  page.onRetry()
  assert.equal(requests.length, before + 1, '重试必须真的重新取数,不能只是清个文案')
  assert.equal(page.data.errorMsg, '', '重试要先清掉上一次的错误文案')
  assert.equal(page.data.loading, true, '重试要回到加载态')
})

test('P1-2 行为:HTTP 非 200(successStatusAbnormal)走可重试错误,不是暂未开放', () => {
  const page = loadPage()
  page.onLoad({})
  requests[0].successStatusAbnormal({ statusCode: 404, msg: 'not found' })
  requests[0].complete()
  assert.match(page.data.errorMsg, /not found|没有加载出来/)
  assert.doesNotMatch(page.data.errorMsg, /暂未开放/)
})

test('cy-error 已注册(否则 wxml 里那个标签会静默渲染成空)', () => {
  const json = JSON.parse(read(JSON_FILE))
  assert.ok(json.usingComponents['cy-error'], 'cy-error 未注册')
})
