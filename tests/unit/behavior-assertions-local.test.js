const test = require('node:test')
const assert = require('node:assert/strict')

function applyPatch(target, patch) {
  Object.keys(patch).forEach((key) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (cursor[parts[i]] == null || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {}
      cursor = cursor[parts[i]]
    }
    cursor[parts.at(-1)] = patch[key]
  })
}

function loadPage(modulePath, app) {
  let config
  global.getApp = () => app
  global.Page = (value) => { config = value }
  global.wx = {
    showToast() {}, redirectTo() {}, navigateBack() {}, switchTab() {},
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    setNavigationBarColor() {},
  }
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = (patch, callback) => {
    applyPatch(page.data, patch)
    if (callback) callback()
  }
  return page
}

test('A1/A3 投诉活动读回完整候选，选中后仍须五字理由才可提交', () => {
  let request
  const page = loadPage('../../subpackageMember/complaint/index.js', {
    sendRequest(options) { request = options },
    getRequestErrorMessage: () => '加载失败，请重试',
  })

  page.loadTopics()
  request.success({ code: 200, data: [
    { topicId: 11, topicName: '超过七天的旧活动' },
    { topicId: 12, topicName: '本周活动' },
    { topicId: null, topicName: '无归属脏数据' },
  ] })
  assert.deepEqual(page.data.topics, [
    { id: 11, name: '超过七天的旧活动' },
    { id: 12, name: '本周活动' },
  ])

  page.selectPickerOption({ currentTarget: { dataset: { picker: 'topic', index: 0 } } })
  assert.equal(page.data.canSubmit, false)
  page.onReasonInput({ detail: { value: '只有四字' } })
  assert.equal(page.data.canSubmit, false)
  page.onReasonInput({ detail: { value: '至少五个汉字' } })
  assert.equal(page.data.canSubmit, true)
})

// A5(品牌故事子页双接口保存)随 2026-09-19 审查 #30 退役:那一页没进 app.json、
// 全仓零入口,品牌故事实际走装修首页的内联弹层。编号不复用,免得对账文档里的历史行错位。

test('A6 承接设置保存保留同接口其它字段，并在 complete 统一解锁', () => {
  let request
  const page = loadPage('../../pages/merchant/decor/coop-setting/index.js', {
    globalData: { navBarHeight: 44 },
    sendRequest(options) { request = options },
  })
  page.data.loadState = 'ok'
  page.onNavBack = () => {}
  page.data.form = { capacity: '18', availableTime: '周末', chargeType: 1, demand: '提前预约' }
  page.data.keep = { suitActivityTypes: '亲子,城市探索', coopOpen: 1 }

  page.onSave()
  assert.equal(page.data.saving, true)
  assert.deepEqual(JSON.parse(request.data), {
    capacity: 18,
    availableTime: '周末',
    suitActivityTypes: '亲子,城市探索',
    chargeType: 1,
    demand: '提前预约',
    coopOpen: 1,
  })
  request.success({ code: 200 })
  request.complete()
  assert.equal(page.data.saving, false)
  assert.equal(page.data.keep.suitActivityTypes, '亲子,城市探索')
})

test('B4 招商申请只有待审核 status=0 可撤回', () => {
  const page = loadPage('../../pages/topic/merchantinfo/merchantinfo.js', {
    globalData: { navBarHeight: 44 },
    getUserID: () => 1,
    sendRequest() {}, tips() {},
  })
  page.data.myChapterApplications = [
    { id: 1, status: 0 },
    { id: 2, status: 1 },
    { id: 3, status: 2 },
  ]
  page.refreshMyChapterApplications()
  assert.deepEqual(page.data.myChapterApplications.map((row) => row.canWithdraw), [true, false, false])
})
