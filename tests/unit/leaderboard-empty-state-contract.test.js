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



test('P1-1 行为:接口成功返回空榜 ⇒ 页面落到「可判定的空」而不是留在榜单分支', () => {
  const page = loadPage()
  page.onLoad({})
  assert.equal(requests.length, 1, 'onLoad 应发一次请求')
  requests[0].success({ code: 200, data: { list: [], me: null } })
  requests[0].complete()

  assert.equal(page.data.errorMsg, '', '空榜不是错误')
  assert.equal(page.data.loading, false)
  // 这三条同时为空 = 榜单分支渲染出来什么都没有,必须有空态接住
  assert.ok(!page.data.top3[0], 'top3[0] 应为空')
  assert.equal(page.data.rest.length, 0)
  assert.equal(page.data.me, null)
})

test('P1-1 结构:wxml 必须有一条只在「不加载 + 无错 + 三处皆空」时命中的空态分支', () => {
  const wxml = read(WXML)
  const branch = wxml.match(/<cy-empty[^>]*class="gc-empty-board"[\s\S]*?\/>/)
  assert.ok(branch, '空榜分支缺失:找不到 class="gc-empty-board" 的 cy-empty')
  const tag = branch[0]
  assert.match(tag, /wx:elif="\{\{!loading && !top3\[0\] && !rest\.length && !me\}\}"/,
    '空态的门必须同时排除 loading 与三处数据,否则加载中会闪空态、或有数据时误判空')
  assert.match(tag, /kind="empty"/, '照抄同域 growthcenter/index 的写法,不自创')
  assert.match(tag, /cta="/, '空态要给「能做什么」的出口,不是一句暂无数据')
  assert.match(tag, /bind:cta="/, 'CTA 必须接住,否则是假按钮')
})

test('P1-1 文案:空态要说清「为什么空」与「能做什么」,不是「暂无数据」', () => {
  const wxml = read(WXML)
  const branch = wxml.match(/<cy-empty[^>]*class="gc-empty-board"[\s\S]*?\/>/)[0]
  assert.doesNotMatch(branch, /暂无数据/, '禁止「暂无数据」这类零信息文案')
  const sub = branch.match(/sub="([^"]+)"/)
  assert.ok(sub && sub[1].length >= 12, '副文案要解释为什么空 / 怎么才能上榜')
})

test('P1-1 行为:空态 CTA 点下去真的跳出去(不是死按钮)', () => {
  const page = loadPage()
  assert.equal(typeof page.goExplore, 'function', 'bind:cta 指向的方法必须存在')
  page.goExplore()
  assert.deepEqual(switched, ['/pages/index/index'], 'CTA 必须真的切到首页')
})

test('cy-empty 已注册(否则那个标签会静默渲染成空)', () => {
  const json = JSON.parse(read(JSON_FILE))
  assert.ok(json.usingComponents['cy-empty'], 'cy-empty 未注册')
})
