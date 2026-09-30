'use strict'

// CU-C-70 / CU-C-99 / CU-C-100 契约:定价页的「能不能确认终价」与面向主理人的文案。
//
// CU-C-70 走查实证:有人带时填带队成本 120、成团人数 4,地板价 35.30;把人数改成 0 再重算,
// 地板价与终价都变 0,「确认终价并开售」照样可点。根因是两侧都没有「成团人数 > 0」这道闸:
// 后端把 teamSize<=0 当「无人带」静默把带队成本摊成 0,前端又只拿 min>=floor 自校验
// (floor=0 时 0>=0 恒真)。
//
// CU-C-100:按钮承诺「并开售」,而后端确认只推进到 PRICING、开售要运营另行送审。
// CU-C-99:成本地板标题前的「乙-2」是内部条款编号,不该出现在给主理人看的界面上。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const WXML = 'pages/topic/pricing/index.wxml'

let pageConfig
let requests
function loadPage() {
  pageConfig = null
  requests = []
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: {} },
    getUserID: () => 1,
    sendRequest(options) { requests.push(options) },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  })
  global.Page = (config) => { pageConfig = config }
  global.getCurrentPages = () => [{}]
  global.wx = {
    showToast() {}, hideLoading() {}, showLoading() {},
    navigateBack() {}, redirectTo() {}, switchTab() {}, navigateTo() {},
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  }
  const absolute = path.resolve(ROOT, 'pages/topic/pricing/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = (patch, callback) => {
    Object.assign(page.data, patch)
    if (callback) callback()
  }
  return page
}

function previewWith(page, data) {
  page.setData({ topicId: 8 })
  page.preview()
  requests[requests.length - 1].success({ code: '200', data: data })
}

test('有人带:成团人数为空或 0 时不得确认终价,并当场说明理由', () => {
  const page = loadPage()
  page.setData({ topicId: 8, subType: 'guided', leadCost: '120', teamSize: '4' })
  previewWith(page, { priceMin: '35.30', canConfirm: true })
  assert.equal(page.data.floor, 35.3)
  assert.equal(page.data.canConfirmPrice, true, '4 人是有效成团人数')
  assert.equal(page.data.teamSizeError, '')

  // 走查原路:把人数改成 0 —— 不重算也不许点,重算更不许
  page.onTeamInput({ detail: { value: '0' } })
  assert.equal(page.data.canConfirmPrice, false, '人数 0 时按钮必须当场失效')
  assert.match(page.data.teamSizeError, /成团人数/)

  page.recalculate()
  requests[requests.length - 1].success({ code: '200', data: { priceMin: '0.00', canConfirm: true } })
  assert.equal(page.data.floor, 0)
  assert.equal(page.data.canConfirmPrice, false, 'floor=0 时 0>=0 恒真,必须由人数这道闸兜住')
})

test('有人带:人数缺失时同样不能确认(空值不是「已填 0 人」)', () => {
  const page = loadPage()
  page.setData({ topicId: 8, subType: 'guided', leadCost: '120', teamSize: '' })
  previewWith(page, { priceMin: '0.00', canConfirm: true })
  assert.equal(page.data.canConfirmPrice, false)
  assert.match(page.data.teamSizeError, /成团人数/)
})

test('无人带:不要求成团人数,原有可提交判定不受影响', () => {
  const page = loadPage()
  page.setData({ topicId: 8, subType: 'self', teamSize: '' })
  previewWith(page, { priceMin: '20.00', canConfirm: true })
  assert.equal(page.data.canConfirmPrice, true)
  assert.equal(page.data.teamSizeError, '')

  page.chooseType({ detail: { key: 'self' } })
  assert.equal(page.data.teamSizeError, '', '切到无人带要清掉上一档的成团人数提示')
})

test('滑块与灰按钮:改价不复活人数缺失的提交,灰按钮要说明为什么', () => {
  const page = loadPage()
  page.setData({ topicId: 8, subType: 'guided', teamSize: '' })
  previewWith(page, { priceMin: '0.00', canConfirm: true })
  page.onSliderChange({ detail: { value: 0 } })
  assert.equal(page.data.canConfirmPrice, false)

  page.onConfirmDisabledTap()
  assert.match(page.data.submitError, /成团人数/, '点灰按钮必须有回执,本仓不许留死交互')
})

test('确认失败就地返回回执,不发建单请求', () => {
  const page = loadPage()
  page.setData({ topicId: 8, subType: 'guided', leadCost: '120', teamSize: '0', canConfirmPrice: false })
  page.confirmPrice()
  assert.equal(requests.length, 0, '人数不合法时不允许发出确认请求')
})

/* ── 文案(用户裁决:去掉内部编号、按后端回执说清语义) ────────────────────── */

test('CU-C-99/100:成本地板不带内部编号,主按钮不承诺「并开售」', () => {
  const wxml = read(WXML)
  assert.doesNotMatch(wxml, /<text[^>]*>[^<]*乙-2/, '内部条款编号不得出现在用户可见标题里(注释里留说明可以)')
  assert.match(wxml, /<text class="pg-kicker">成本地板<\/text>/)
  assert.doesNotMatch(wxml, /确认终价并开售/, '按钮不能承诺点完就开卖')
  assert.match(wxml, /确认终价并提交开售审核/)
  assert.match(wxml, /bind:disabledtap="onConfirmDisabledTap"/, '禁用态要有解释出口')
})
