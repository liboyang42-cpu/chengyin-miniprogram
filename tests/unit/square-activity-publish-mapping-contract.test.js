// R10-09 发帖关联映射:真实 activity-picker emit → 真实 square/list 发布请求。
// 自玩完成必须发 data_type=2 + data_id=topicId;活动仍 1 + activityId;清除/失败/迟回不得退化直发。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const LIST_PAGE = '../../pages/square/list/index.js'
const PICKER = '../../pages/square/components/activity-picker/index.js'

let pageConfig
let pickerDef
let requests

function setByPath(target, rawPath, value) {
  const parts = rawPath.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

beforeEach(() => {
  pageConfig = null
  pickerDef = null
  requests = []
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, user_id: 1, features: {} },
    getUserID: () => 1,
    getAvatar: () => '',
    getUserRole: () => '',
    getUserType: () => 0,
    isDevEnv: () => false,
    sendRequest(opts) { requests.push(opts) },
    getUploadClient: () => ({
      uploadAll(paths, opts) {
        // 路线预览图上传:直接成功,让 picker 走真实 finish→emitSelect
        opts.onDone({ ok: true, results: ['https://img.example/route.png'] })
        return { abort() {}, destroy() {} }
      },
    }),
    tips() {},
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  })
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    hideTabBar() {},
    getWindowInfo: () => ({ statusBarHeight: 20, windowHeight: 800 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowHeight: 800 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32, bottom: 56 }),
    navigateTo() {},
    showToast() {},
    hideToast() {},
    showLoading() {},
    hideLoading() {},
    createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec() {} }) }), exec() {} }),
  }
  global.Page = (config) => { pageConfig = config }
  global.Component = (definition) => { pickerDef = definition }
})

function loadListPage() {
  delete require.cache[require.resolve(LIST_PAGE)]
  require(LIST_PAGE)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = function (patch, callback) {
    Object.keys(patch || {}).forEach((key) => setByPath(this.data, key, patch[key]))
    if (callback) callback()
  }
  return page
}

function loadPicker() {
  delete require.cache[require.resolve(PICKER)]
  require(PICKER)
  const vm = Object.assign({}, pickerDef.methods)
  vm.data = JSON.parse(JSON.stringify(pickerDef.data))
  vm.setData = function (patch, callback) {
    Object.keys(patch || {}).forEach((key) => setByPath(this.data, key, patch[key]))
    if (callback) callback()
  }
  vm._emitted = null
  vm.triggerEvent = function (name, detail) { if (name === 'select') vm._emitted = detail }
  return vm
}

const SELF_PLAY_ITEM = {
  activityId: null, topicId: 990062, dataType: 2, dataId: 990062,
  name: '自玩主题', cover: 'https://cdn/self.png', total: 2, doneCount: 2, completed: true,
}
const ACTIVITY_ITEM = {
  activityId: 501, topicId: 990063, dataType: 1, dataId: 501,
  name: '活动场次', cover: 'https://cdn/act.png', total: 3, doneCount: 3, completed: true,
}

/** 真实 picker:fetchList 成功 → onSelect → route-ready 截图上传 → 真实 emitSelect。 */
async function pickerEmitFor(item) {
  const vm = loadPicker()
  vm.fetchList()
  assert.equal(requests.length, 1, 'picker 必须请求 my-completed')
  requests[0].success({ code: '200', data: [item] })
  vm.selectComponent = () => ({ snapshotRoute: () => Promise.resolve('/tmp/route.png') })
  vm.onSelect({ currentTarget: { dataset: { index: 0 } } })
  vm.onRouteReady()
  await new Promise((resolve) => setImmediate(resolve))
  if (vm._timer) clearTimeout(vm._timer)
  assert.ok(vm._emitted, 'picker 必须真实 emit select')
  return vm._emitted
}

function primeSubmit(page) {
  page.data.valCont = '发一条测试帖'
  page.data.picList = []
  page.data.fileList = []
  page.data.address = ''
  page.data.longitude = ''
  page.data.latitude = ''
  page.data.switch1Checked = false
}

test('自玩完成:真实 picker emit 到发布请求必须是 data_type=2 + data_id=topicId', async () => {
  const page = loadListPage()
  const emitted = await pickerEmitFor(SELF_PLAY_ITEM)

  page.onActivitySelect({ detail: emitted })
  primeSubmit(page)
  page.submitFormData()

  assert.equal(requests.length, 2, 'picker 1 次 + 发布 1 次')
  const body = requests[1].data
  assert.equal(body.data_type, 2, '自玩发布必须是 2=主题')
  assert.equal(body.data_id, 990062, '自玩发布必须携带主题 ID,不得空值退化直发')
  assert.equal(body.route_preview_img, 'https://img.example/route.png')
})

test('正式活动:仍是 data_type=1 + data_id=activityId', () => {
  const page = loadListPage()
  page.onActivitySelect({ detail: { activity: ACTIVITY_ITEM, routePreviewImg: '' } })
  primeSubmit(page)
  page.submitFormData()

  const body = requests[0].data
  assert.equal(body.data_type, 1)
  assert.equal(body.data_id, 501)
})

test('清除选择:发布为无关联,不残留上一条 data_id', () => {
  const page = loadListPage()
  page.onActivitySelect({ detail: { activity: SELF_PLAY_ITEM, routePreviewImg: '' } })
  page.clearActivity()
  primeSubmit(page)
  page.submitFormData()

  const body = requests[0].data
  assert.equal(body.data_id, '')
  assert.equal(body.data_type, '')
  assert.equal(body.route_preview_img, '')
})

test('兼容旧结构(无 dataId):回退到 activityId,不丢活动关联', () => {
  const page = loadListPage()
  const legacy = { activityId: 601, topicId: 990064, dataType: 1, name: '旧活动' }
  page.onActivitySelect({ detail: { activity: legacy, routePreviewImg: '' } })
  primeSubmit(page)
  page.submitFormData()

  const body = requests[0].data
  assert.equal(body.data_id, 601)
  assert.equal(body.data_type, 1)
})

test('失败恢复:发布失败保留选择,重试仍带同一自玩关联', () => {
  const page = loadListPage()
  page.onActivitySelect({ detail: { activity: SELF_PLAY_ITEM, routePreviewImg: '' } })
  primeSubmit(page)
  page.submitFormData()
  assert.equal(requests.length, 1)

  requests[0].fail({ errMsg: 'network fail' })
  requests[0].complete()
  assert.equal(page.data.submitting, false)
  assert.equal(page.data.selectedActivity && page.data.selectedActivity.topicId, 990062, '失败不得丢选择')

  page.retrySubmit()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].data.data_id, 990062)
  assert.equal(requests[1].data.data_type, 2)
})

test('迟回/改动选择后重试:按重试当刻的选择发,不用旧值', () => {
  const page = loadListPage()
  page.onActivitySelect({ detail: { activity: SELF_PLAY_ITEM, routePreviewImg: '' } })
  primeSubmit(page)
  page.submitFormData()
  requests[0].fail({})
  requests[0].complete()

  // 用户在重试前改选正式活动
  page.onActivitySelect({ detail: { activity: ACTIVITY_ITEM, routePreviewImg: 'https://img.example/new.png' } })
  page.retrySubmit()

  const body = requests[1].data
  assert.equal(body.data_type, 1, '重试必须用当前选择,不得残留自玩关联')
  assert.equal(body.data_id, 501)
  assert.equal(body.route_preview_img, 'https://img.example/new.png')
})

test('发布在途防重复提交:第二次点击不发请求', () => {
  const page = loadListPage()
  page.onActivitySelect({ detail: { activity: SELF_PLAY_ITEM, routePreviewImg: '' } })
  primeSubmit(page)
  page.submitFormData()
  page.submitFormData()

  assert.equal(requests.length, 1, '在途不得重复发帖')
})
