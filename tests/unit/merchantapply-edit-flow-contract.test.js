const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_PATH = path.join(ROOT, 'pages/topic/merchantapply/index.js')
const WXML_PATH = path.join(ROOT, 'pages/topic/merchantapply/index.wxml')
const JSON_PATH = path.join(ROOT, 'pages/topic/merchantapply/index.json')
const DETAIL_PAGE_PATH = path.join(ROOT, 'pages/topic/merchantinfo/merchantinfo.js')

let pageConfig
let requests
let tips
let aborts
let modals

global.getApp = () => ({
  globalData: {},
  sendRequest(options) {
    requests.push(options)
    return { abort() { aborts += 1 } }
  },
  getRequestErrorMessage(response, fallback) {
    return (response && (response.msg || response.message)) || fallback
  },
  tips(message) { tips.push(message) },
  chooseImage() {},
})

global.wx = {
  navigateBack() {},
  reLaunch() {},
  showLoading() {},
  hideLoading() {},
  showToast() {},
  showModal() { modals += 1 },
  setNavigationBarColor() {},
  setBackgroundColor() {},
}

global.Page = (config) => { pageConfig = config }

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
  delete require.cache[require.resolve(PAGE_PATH)]
  pageConfig = null
  requests = []
  tips = []
  aborts = 0
  modals = 0
  require(PAGE_PATH)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, done) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(page.data, key, value))
    if (typeof done === 'function') done()
  }
  // onLoad 现在还会拉一次 /api/merchant/info(2026-09-05 稿 133:310 的「你的门店」卡:
  // 店名/地址/营业时段,主办方靠它判断要不要选这一站)。它不参与本契约要保护的编辑流,
  // 而且失败也不影响填表 —— 包一层把它剔掉,免得下面所有 requests[N] 的下标跟着漂。
  // ⚠️ 剔的是**这一个 url**,不是「onLoad 之后的第二条请求」:后者会把真新增的请求也一起吞掉。
  const realOnLoad = page.onLoad
  page.onLoad = function (options) {
    const out = realOnLoad.call(this, options)
    const i = requests.findIndex((r) => r.url === '/api/merchant/info')
    if (i >= 0) requests.splice(i, 1)
    return out
  }
  return page
}

function detail(overrides = {}) {
  return {
    id: 900,
    topicId: 9,
    nodeId: 3,
    templateId: 4,
    status: 3,
    auditStatus: 2,
    address: '上海市黄浦区中山东一路 1 号',
    addressName: '外滩观景平台',
    longitude: '121.49',
    latitude: '31.24',
    startDate: '2098-12-01 00:00:00',
    endDate: '2098-12-31 00:00:00',
    cooperateDate: '10:00-18:00',
    limitNum: 12,
    activityDesc: '可提供补水与物料放置',
    picUrl: '/images/route_city_cover.png',
    topicStartDate: '2099-01-01 00:00:00',
    ...overrides,
  }
}

test('商家报名编辑：读 id 预填后必须走 update，驳回态保留为重提上下文', () => {
  const page = loadPage()
  page.onLoad({ mode: '1', id: '900' })

  assert.equal(page.data.registrationId, 900)
  assert.equal(page.data.loadState, 'loading')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/registration/merchant/info')
  assert.deepEqual(requests[0].data, { id: 900 })

  requests[0].success({ code: 200, data: detail() })
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.registrationWasRejected, true)
  assert.equal(page.data.addressName, '外滩观景平台')
  assert.deepEqual(page.data.availabilityRange, ['2098-12-01', '2098-12-31'])
  assert.equal(page.data.cooperateDate, '10:00-18:00')
  assert.equal(page.data.ruleInstructions, '可提供补水与物料放置')
  assert.equal(page.data.dirty, false)
  assert.equal(page.data.canSubmit, true)

  page.onSubmit()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].url, '/api/registration/merchant/update')
  const payload = JSON.parse(requests[1].data)
  assert.equal(payload.id, 900)
  assert.equal(payload.cooperateDate, '10:00-18:00')
  assert.equal(payload.startDate, '2098-12-01 00:00:00')
  assert.equal(payload.endDate, '2098-12-31 23:59:59')
  requests[1].success({ code: 200 })
  assert.equal(page.data.phase, 'success')
})

test('商家报名：可配合日期必须由 date range 半屏成对写入并参与校验', () => {
  const page = loadPage()
  page.onLoad({ topicId: '9', nodeId: '3', templateId: '4' })
  page.setData({ address: '外滩', cooperateDate: '10:00-18:00', ruleInstructions: '可接待', picUrl: '/a.png' })
  page.refreshSubmitState()
  assert.equal(page.data.canSubmit, false, '没有日期区间时不得提交')

  page.openAvailabilityPicker()
  assert.equal(page.data.availabilityPickerShow, true)
  page.confirmAvailabilityPicker({ detail: { value: ['2098-12-01', '2098-12-31'] } })
  assert.deepEqual(page.data.availabilityRange, ['2098-12-01', '2098-12-31'])
  assert.equal(page.data.canSubmit, true)

  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const json = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
  assert.match(wxml, /<cy-date-range-sheet[^>]*availabilityPickerShow/)
  assert.match(wxml, /可配合日期/)
  assert.match(wxml, /每日可接待时段/)
  assert.equal(json.usingComponents['cy-date-range-sheet'], '/pages/topic/components/cy/date-range-sheet/index')
})

test('商家报名编辑：HTTP 200 空对象不得渲染可保存空表单', () => {
  const page = loadPage()
  page.onLoad({ id: '900' })
  requests[0].success({ code: 200, data: {} })

  assert.equal(page.data.loadState, 'error')
  assert.equal(page.data.canSubmit, false)
  assert.match(page.data.loadError, /不完整|重试/)
})

test('商家报名编辑：已通过或主题已开始必须进入解释态，不得短暂露出可提交表单', () => {
  const approved = loadPage()
  approved.onLoad({ id: '900' })
  requests[0].success({ code: 200, data: detail({ status: 1, auditStatus: 1 }) })
  assert.equal(approved.data.loadState, 'permission')
  assert.equal(approved.data.canSubmit, false)
  assert.match(approved.data.loadError, /通过审核|不能再修改/)

  const started = loadPage()
  started.onLoad({ id: '900' })
  requests[0].success({ code: 200, data: detail({ topicStartDate: '2020-01-01 00:00:00' }) })
  assert.equal(started.data.loadState, 'permission')
  assert.equal(started.data.canSubmit, false)
  assert.match(started.data.loadError, /主题已开始|不能再修改/)
})

test('商家报名编辑：开始日必须按中国自然日判断，不受运行环境时区影响', () => {
  const originalNow = Date.now
  Date.now = () => Date.parse('2026-08-22T16:30:00Z') // 中国时间 2026-08-23 00:30
  try {
    const page = loadPage()
    page.onLoad({ id: '900' })
    requests[0].success({ code: 200, data: detail({ topicStartDate: '2026-08-23 00:00:00' }) })

    assert.equal(page.data.loadState, 'permission')
    assert.equal(page.data.canSubmit, false)
    assert.match(page.data.loadError, /主题已开始|不能再修改/)
  } finally {
    Date.now = originalNow
  }
})

test('商家报名编辑：未填写限定人数必须保持 null，不能把未知/不限偷换成 0', () => {
  const page = loadPage()
  page.onLoad({ id: '900' })
  requests[0].success({ code: 200, data: detail({ limitNum: null }) })
  page.onSubmit()

  assert.equal(JSON.parse(requests[1].data).limitNum, null)
})

test('商家报名编辑：提交中冻结关闭，卸载后取消请求且旧回调不得改写页面', () => {
  const page = loadPage()
  page.onLoad({ id: '900' })
  requests[0].success({ code: 200, data: detail() })
  page.onSubmit()

  assert.equal(page.data.submitting, true)
  page.onSheetRequestClose()
  assert.equal(modals, 0)

  page.onUnload()
  assert.equal(aborts, 1)
  requests[1].success({ code: 200 })
  assert.equal(page.data.phase, 'form')
})

test('商家报名编辑：提交失败必须留在表单并给页面内重试入口', () => {
  const page = loadPage()
  page.onLoad({ id: '900' })
  requests[0].success({ code: 200, data: detail() })
  page.onSubmit()
  assert.equal(requests[1].silentError, true)
  requests[1].success({ code: 500, msg: '主题状态已变化' })

  assert.equal(page.data.phase, 'form')
  assert.equal(page.data.submitError, '主题状态已变化')
  // 2026-09-10:提交失败 = 这份报名没交上去,走 error 档(红 ⚠)。
  // 原来是 data 档(蓝 ⓘ「这部分没更新成功」)—— 那是「某块没刷新」的语气,
  // 用户实拍指出结算页同款蓝条看着像提示,而它说的是钱没付成、票没出。
  assert.equal(page.data.submitErrorKind, 'error')
  assert.equal(tips.length, 0)

  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const json = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))
  assert.match(wxml, /<cy-inline-error[^>]*submitError/)
  assert.match(wxml, /bind:action="onSubmit"/)
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
})

test('商家报名编辑：保存成功通知来源页回读详情，返回后不得继续显示旧驳回态', () => {
  const page = loadPage()
  const events = []
  page.getOpenerEventChannel = () => ({ emit(name, payload) { events.push({ name, payload }) } })
  page.onLoad({ id: '900' })
  requests[0].success({ code: 200, data: detail() })
  page.onSubmit()
  requests[1].success({ code: 200 })

  assert.deepEqual(events.map((item) => item.name), ['registrationSaved'])
  assert.equal(events[0].payload.registrationId, 900)

  const detailSource = fs.readFileSync(DETAIL_PAGE_PATH, 'utf8')
  assert.match(detailSource, /registrationSaved\s*:\s*\(\)\s*=>\s*this\.loadDetail\(\)/)
})

test('商家报名编辑：首载、错误、表单和编辑成功回执互斥', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const json = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'))

  assert.match(wxml, /loadState === 'loading'[^>]*>[\s\S]*?<cy-skeleton/)
  assert.match(wxml, /<cy-skeleton type="form-section"/)
  assert.match(wxml, /loadState === 'error'[^>]*>[\s\S]*?<cy-error/)
  assert.match(wxml, /loadState === 'permission'[\s\S]*?<cy-error[^>]*auto-back custom-back/)
  assert.match(wxml, /loadState === 'ready'\s*&&\s*phase === 'form'/)
  assert.match(wxml, /registrationId\s*\?\s*'\u4fee\u6539\u5df2\u4fdd\u5b58'/)
  assert.equal(json.usingComponents['cy-skeleton'], '/components/cy/skeleton/index')
  assert.equal(json.usingComponents['cy-error'], '/components/cy/error/index')
  assert.equal(json.usingComponents['cy-empty'], '/components/cy/empty/index')
})
