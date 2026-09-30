'use strict'

// CU-C-101 契约:编辑远期活动时,原定日期必须落在时间面板的可选表内并被预选。
//
// 走查实证:隔离活动 #31 原定 10-24 09:00–15:00,编辑页点「活动时间」面板从 9-23 09:00 起
// 显示,可选范围到 10-23 —— 原日期既没被预选、也根本选不回来。
// 根因:可选表恒为「今天起 31 天」,而 resolveTimePickerDraft 的 findIndex 未命中就
// 静默保留 fallback(今天),没有任何提示。

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')

let pageConfig
function loadPage() {
  pageConfig = null
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: {} },
    getUserID: () => 1,
    getPageSize: () => 10,
    sendRequest() {},
    tips() {},
    setUserRole() {},
  })
  global.Page = (config) => { pageConfig = config }
  global.getCurrentPages = () => [{}]
  global.wx = {
    showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
    navigateTo() {}, navigateBack() {}, switchTab() {}, redirectTo() {},
    stopPullDownRefresh() {}, setNavigationBarTitle() {},
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 667, screenHeight: 667, pixelRatio: 2 }),
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 667, screenHeight: 667, pixelRatio: 2 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, right: 363, width: 87, height: 32 }),
    createSelectorQuery: () => ({
      in: () => ({ select: () => ({ fields: () => ({ exec() {} }), boundingClientRect: () => ({ exec() {} }) }) }),
      select: () => ({ boundingClientRect: () => ({ exec() {} }) }),
      exec() {},
    }),
  }
  const absolute = path.resolve(ROOT, 'pages/publish/activity/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.')
      let cursor = page.data
      parts.slice(0, -1).forEach((part) => {
        if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
        cursor = cursor[part]
      })
      cursor[parts[parts.length - 1]] = value
    })
    if (callback) callback()
  }
  return page
}

function ymd(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dayOffset(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date
}

test('新建活动:可选表仍是「今天起 31 天」,行为不变', () => {
  const page = loadPage()
  page.setData({ 'formData.startDate': '', 'formData.endDate': '' })
  page.generateDateList()
  assert.equal(page.data.dateList.length, 31)
  assert.equal(page.data.dateList[0].date, ymd(new Date()), '新建仍从今天起算')
})

test('编辑远期活动:原定日期进可选表并被预选,不再静默退回今天', () => {
  const page = loadPage()
  const originalStart = dayOffset(40)   // 原定日期在「今天起 31 天」之外
  const originalEnd = dayOffset(40)
  const startValue = `${ymd(originalStart)} 09:00:00`
  const endValue = `${ymd(originalEnd)} 15:00:00`
  page.setData({ 'formData.startDate': startValue, 'formData.endDate': endValue })
  page.generateDateList()

  const dates = page.data.dateList.map((item) => item.date)
  assert.ok(dates.includes(ymd(originalStart)),
    `原定日期 ${ymd(originalStart)} 必须在可选表内,否则面板定位不过去也选不回来`)

  const draft = page.resolveTimePickerDraft(startValue, [0], [9, 0])
  assert.equal(page.data.dateList[draft.dateIndex[0]].date, ymd(originalStart),
    '起止草稿必须预选原定日期')
  assert.equal(draft.dateIndex[0], 40, '第 41 项就是原定日,不能停在 fallback 的下标 0')
  assert.equal(draft.preview, `${dayOffset(40).getMonth() + 1}月${dayOffset(40).getDate()}日 09:00`)
})

test('编辑已有活动:回包落进 formData 后按新日期重建可选表', () => {
  const page = loadPage()
  page.editingActivityId = 31
  page.refreshPrimaryActionState = function () {}
  page.resumeAtFirstIncompleteStep = function () {}
  const originalStart = dayOffset(45)
  const startValue = `${ymd(originalStart)} 09:00:00`
  const endValue = `${ymd(originalStart)} 15:00:00`

  page.applyExistingActivity({
    id: 31, name: '远期活动', sysCategoryList: [], categoryIds: '',
    startDate: startValue, endDate: endValue, omsTicketList: [],
  })

  const dates = page.data.dateList.map((item) => item.date)
  assert.ok(dates.includes(ymd(originalStart)),
    '回包里的原定日期必须被并入可选表(面板每次打开都从 formData 重建草稿)')
  const draft = page.resolveTimePickerDraft(page.data.formData.startDate, [0], [9, 0])
  assert.equal(page.data.dateList[draft.dateIndex[0]].date, ymd(originalStart))
})

test('负控:可选表退回「今天起 31 天」,远期原日期必须判红', () => {
  const page = loadPage()
  page.generateDateList = function () {
    const list = []
    const today = new Date()
    for (let i = 0; i < 31; i++) {
      const date = new Date(today)
      date.setDate(today.getDate() + i)
      list.push({ date: ymd(date) })
    }
    this.setData({ dateList: list })
  }
  const originalStart = dayOffset(40)
  page.setData({ 'formData.startDate': `${ymd(originalStart)} 09:00:00`, 'formData.endDate': '' })
  page.generateDateList()
  assert.equal(page.data.dateList.some((item) => item.date === ymd(originalStart)), false,
    '旧实现里原定日期确实不在表内 —— 这正是面板停到今天的成因')
})
