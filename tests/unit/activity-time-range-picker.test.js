const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_PATH = path.join(ROOT, 'pages/publish/activity/index.js')
const WXML_PATH = path.join(ROOT, 'pages/publish/activity/index.wxml')

let pageConfig
let toasts

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44, userInfo: {} },
  getUserID: () => 1,
  getUserRole: () => 'club',
  getPageSize: () => 10,
  getTotalPage: (total, size) => Math.ceil(total / size),
  sendRequest() {},
  tips() {},
  setUserRole() {},
})
global.Page = (config) => { pageConfig = config }
global.wx = {
  showLoading() {}, hideLoading() {}, showModal() {},
  navigateTo() {}, navigateBack() {}, switchTab() {}, redirectTo() {},
  stopPullDownRefresh() {}, setNavigationBarTitle() {},
  showToast(options) { toasts.push(options && options.title) },
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

function setByPath(target, key, value) {
  const parts = key.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  pageConfig = null
  toasts = []
  delete require.cache[require.resolve(PAGE_PATH)]
  require(PAGE_PATH)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(page.data, key, value))
    if (callback) callback()
  }
  page.refreshPrimaryActionState = () => {}
  page.setData({
    dateList: [
      { date: '2026-08-21', display: '8月21日' },
      { date: '2026-08-22', display: '8月22日' },
    ],
  })
  return page
}

function pick(page, field, dateIndex, hourIndex, minuteIndex) {
  page.selectTimePickerPoint({ currentTarget: { dataset: { field } } })
  page.onTimePickerDateChange({ detail: { value: [dateIndex] } })
  page.onTimePickerTimeChange({ detail: { value: [hourIndex, minuteIndex] } })
}

function assertStartStepKeepsDraft(page) {
  page.showStartTimePicker()
  page.selectTimePickerPoint({ currentTarget: { dataset: { field: 'end' } } })
  assert.equal(page.data.timePicker.active, 'start', '结束步骤在点击“下一步”前不可绕过')
  pick(page, 'start', 0, 9, 5)
  page.submitTimePickerStep()
  assert.equal(page.data.timePicker.active, 'end')
  assert.equal(page.data.timePicker.endUnlocked, true)
  assert.equal(page.data.formData.startDate, '', '进入结束时间步骤前不得把开始时间写入正式表单')
  assert.equal(page.data.formData.endDate, '', '进入结束时间步骤前不得污染结束时间')
}

test('活动起止时间在同一个面板内编辑，只有最终完成才整组提交', () => {
  const page = loadPage()

  assertStartStepKeepsDraft(page)
  pick(page, 'end', 0, 11, 20)
  const committed = page.confirmTimePicker()

  assert.equal(committed, true)
  assert.equal(page.data.timePicker.show, false)
  assert.equal(page.data.formData.startDate, '2026-08-21 09:05:00')
  assert.equal(page.data.formData.endDate, '2026-08-21 11:20:00')
  // 2026-08-25 补零收口:预览文案原来只补分不补时(「9:05」),与同 App 另两处口径冲突。
  // API 值一直是 09:05:00,所以对齐成两位是让展示跟真值一致,不是改语义。
  assert.equal(page.data.startdate, '8月21日 09:05')
  assert.equal(page.data.enddate, '8月21日 11:20')
})

test('取消丢弃草稿，正式起止时间保持原值', () => {
  const page = loadPage()
  page.setData({
    startdate: '8月21日 8:00',
    enddate: '8月21日 10:00',
    'formData.startDate': '2026-08-21 08:00:00',
    'formData.endDate': '2026-08-21 10:00:00',
  })

  page.showStartTimePicker()
  pick(page, 'start', 1, 12, 30)
  page.cancelTimePicker()

  assert.equal(page.data.timePicker.show, false)
  assert.equal(page.data.dirty, false, '只打开并取消时间面板不能制造未保存草稿')
  assert.equal(page.data.formData.startDate, '2026-08-21 08:00:00')
  assert.equal(page.data.formData.endDate, '2026-08-21 10:00:00')
})

test('空表单取消后再次打开，草稿回到默认时间而不是上次未提交位置', () => {
  const page = loadPage()

  page.showStartTimePicker()
  pick(page, 'start', 1, 12, 30)
  pick(page, 'end', 1, 14, 45)
  page.cancelTimePicker()
  page.showStartTimePicker()

  assert.deepEqual(page.data.startDateIndex, [0])
  assert.deepEqual(page.data.startTimeIndex, [9, 0])
  assert.deepEqual(page.data.endDateIndex, [0])
  assert.deepEqual(page.data.endTimeIndex, [18, 0])
})

test('开始时间晚于结束草稿时，进入结束步骤会给出晚一小时的有效建议', () => {
  const page = loadPage()

  page.showStartTimePicker()
  pick(page, 'start', 1, 20, 30)
  page.submitTimePickerStep()

  assert.deepEqual(page.data.endDateIndex, [1])
  assert.deepEqual(page.data.endTimeIndex, [21, 30])
  assert.equal(page.data.timePickerEndPreview, '8月22日 21:30')
})

test('结束时间不晚于开始时间时拒绝整组提交并保留面板', () => {
  const page = loadPage()
  page.showStartTimePicker()
  pick(page, 'start', 0, 18, 0)
  page.submitTimePickerStep()
  pick(page, 'end', 0, 17, 59)

  const committed = page.confirmTimePicker()

  assert.equal(committed, false)
  assert.equal(page.data.timePicker.show, true)
  assert.equal(page.data.timePicker.active, 'end')
  assert.equal(page.data.formData.startDate, '')
  assert.equal(page.data.formData.endDate, '')
  assert.deepEqual(toasts, ['结束时间必须晚于开始时间'])
})

function assertUnifiedPickerMarkup(source) {
  const block = source.match(/<!-- activity-time-picker:start -->([\s\S]*?)<!-- activity-time-picker:end -->/)
  assert.ok(block, '活动时间面板必须保留可审计区段')
  assert.match(block[1], /show="\{\{timePicker\.show\}\}"/)
  assert.match(block[1], />设置活动时间</)
  assert.match(block[1], />\{\{timePicker\.active === 'start' \? '下一步' : '完成'\}\}</)
  assert.match(block[1], /aria-label="编辑开始时间，当前\{\{timePickerStartPreview\}\}"/)
  assert.match(block[1], /结束时间，请先完成开始时间/)
  assert.match(block[1], /编辑结束时间，当前/)
  assert.match(block[1], /aria-disabled="\{\{!timePicker\.endUnlocked\}\}"/)
  assert.doesNotMatch(block[1], /startTimePicker\.show|endTimePicker\.show/)
  assert.doesNotMatch(block[1], /<image[\s\S]*?bindtap="(?:advance|confirm)TimePicker"/)
}

test('WXML 使用一个有明确取消/下一步/完成语义的起止时间面板', () => {
  assertUnifiedPickerMarkup(fs.readFileSync(WXML_PATH, 'utf8'))
})

test('负控：若开始步骤提前提交或移除开始时间可访问名称，契约必须判红', () => {
  const page = loadPage()
  page.advanceTimePicker = function brokenAdvance() {
    this.setData({
      'formData.startDate': '2026-08-21 09:05:00',
      'timePicker.active': 'end',
      'timePicker.endUnlocked': true,
    })
  }
  assert.throws(() => assertStartStepKeepsDraft(page), /不得把开始时间写入正式表单/)

  const source = fs.readFileSync(WXML_PATH, 'utf8')
  assert.throws(
    () => assertUnifiedPickerMarkup(source.replace(/aria-label="编辑开始时间，当前\{\{timePickerStartPreview\}\}"/, '')),
    /aria-label/,
  )
})
