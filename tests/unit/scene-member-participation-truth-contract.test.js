'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const MODULE = path.join(ROOT, 'subpackageMember/components/scene-member-participation-detail/index.js')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadComponent() {
  const requests = []
  const toasts = []
  let definition
  global.getApp = () => ({
    getRequestErrorMessage: (response, fallback) => (response && (response.msg || response.errMsg)) || fallback,
    sendRequest: (options) => requests.push(options),
  })
  global.Component = (config) => { definition = config }
  global.wx = {
    showToast: (options) => toasts.push(options && options.title),
  }
  delete require.cache[require.resolve(MODULE)]
  require(MODULE)
  const component = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch)
      if (done) done.call(this)
    },
    triggerEvent() {},
  })
  return { component, requests, toasts }
}

test('核销人数只接受有限非负 JSON number，unknown 与合法 0 分开', () => {
  const { component } = loadComponent()
  const zero = component.prepareDisplayData({ status: 1, totalOrderNum: 0, verifiedNum: 0 })
  assert.equal(zero.showOrderStats, true)
  assert.equal(zero.orderStatsKnown, true)
  assert.equal(zero.pendingOrderText, '0')
  assert.equal(zero.verifiedOrderText, '0')
  assert.equal(zero.totalOrderText, '0')

  for (const payload of [
    { totalOrderNum: '2', verifiedNum: 1 },
    { totalOrderNum: 2, verifiedNum: true },
    { totalOrderNum: 2, verifiedNum: 3 },
    { totalOrderNum: Number.NaN, verifiedNum: 0 },
  ]) {
    const unknown = component.prepareDisplayData({ status: 1, ...payload })
    assert.equal(unknown.orderStatsKnown, false)
    // UI-04(2026-09-18):订单数是数字统计,没取到显示 0
    assert.equal(unknown.pendingOrderText, '0')
    assert.equal(unknown.verifiedOrderText, '0')
    assert.equal(unknown.totalOrderText, '0')
  }
})

// B-02：8241de6e8 把取数换成 /api/registration/info 后没换字段映射,详情页整页空壳。
// 真源 = CmsRegistration + cmsTopic/cmsActivity;状态与列表页/订单页同读模型。
test('B-02:名称/日期/封面/状态读 cmsTopic|cmsActivity 真值,不按退役商家视图字段读', () => {
  const { component } = loadComponent()
  const ready = component.prepareDisplayData({
    ownerType: 2,
    registrationStatus: 2,
    paymentStatus: 2,
    cmsActivity: {
      name: '周六夜行',
      startDate: '2026-09-20',
      endDate: '2026-09-20',
      imgUrl: '/uploads/a.png',
      description: '提供补水',
    },
  })
  assert.equal(ready.topicName, '周六夜行')
  assert.match(ready.formatDateRange, /2026\.09\.20/)
  assert.equal(ready.picUrl, '/uploads/a.png')
  assert.equal(ready.activityDesc, '提供补水')
  assert.notEqual(ready.statusText, '状态待确认', '状态必须来自报名真值,不是占位')

  const topic = component.prepareDisplayData({
    ownerType: 1,
    registrationStatus: 2,
    purchaseKind: 3,
    cmsTopic: { name: '城市路线', startDate: '2026-09-20', endDate: '2026-09-22', imgArr: '/uploads/b.png,/uploads/c.png' },
  })
  assert.equal(topic.topicName, '城市路线')
  assert.equal(topic.modeText, '自由探索', '主题票种与列表页同一口径')
  assert.equal(topic.picUrl, '/uploads/b.png,/uploads/c.png', '多图字段交给 wxs img.first 取首图')

  const unknown = component.prepareDisplayData({})
  assert.equal(unknown.topicName, '未知主题')
  assert.equal(unknown.picUrl, '')
  assert.equal(unknown.statusText, '订单状态更新中')
  assert.equal(unknown.statusVariant, 'neutral')
  assert.equal(unknown.cooperateDateText, '接待时间待确认')
  assert.equal(unknown.hasCooperateDate, false, '没有真实接待时间时该行必须整行不渲染')
  assert.equal(unknown.hasNodeName, false)
})

test('需修改状态进入已上线的报名编辑器，不再用 toast 伪装按钮', () => {
  const { component, toasts } = loadComponent()
  let target = ''
  component.data.id = 900
  component._leave = (url) => { target = url }
  component.goModify()
  assert.equal(target, '/pages/topic/merchantapply/index?mode=1&id=900')
  assert.deepEqual(toasts, [])
})

test('详情失败使用页内三态，不叠全局 loading 或短暂 toast', () => {
  const h = loadComponent()
  h.component.data.id = 7
  h.component.getData()
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].hideLoading, true)
  assert.equal(h.requests[0].silentError, true)
  h.requests[0].fail({ msg: '参与详情暂时不可用' })
  assert.equal(h.component.data.loadState, 'error')
  assert.equal(h.component.data.loadErrorText, '参与详情暂时不可用')
  assert.deepEqual(h.toasts, [])
})

test('参与详情用计算后真值和图标库，不在 WXML 直减未知字段或画文字箭头', () => {
  const wxml = read('subpackageMember/components/scene-member-participation-detail/index.wxml')
  const json = JSON.parse(read('subpackageMember/components/scene-member-participation-detail/index.json'))
  assert.equal(json.usingComponents['cy-icon'], '/components/cy/icon/index')
  assert.match(wxml, /\{\{displayInfo\.pendingOrderText\}\}/)
  assert.match(wxml, /\{\{displayInfo\.verifiedOrderText\}\}\/\{\{displayInfo\.totalOrderText\}\}/)
  assert.match(wxml, /\{\{displayInfo\.cooperateDateText\}\}/)
  assert.doesNotMatch(wxml, /info\.totalOrderNum-info\.verifiedNum|10:00-22:00|>›</)
  assert.match(wxml, /<cy-icon name="arrow-right"/)
})

test('负控：把数字字符串重新当真实计数必须判红', () => {
  const source = read('subpackageMember/components/scene-member-participation-detail/index.js')
  assert.match(source, /typeof value !== 'number'/)
  const broken = source.replace("typeof value !== 'number'", "value == null")
  assert.notEqual(broken, source, '负控锚点失效')
  assert.doesNotMatch(broken, /typeof value !== 'number'/)
})

test('玩家参与详情读本人报名接口，并提供开始玩', () => {
  const h = loadComponent()
  h.component.data.id = 7
  h.component.getData()
  assert.equal(h.requests[0].url, '/api/registration/info')
  const wxml = read('subpackageMember/components/scene-member-participation-detail/index.wxml')
  assert.match(wxml, /bindtap="goPlay"/)

  let target = ''
  h.component.data.info = { id: 7, ownerType: 1, ownerId: 12, cmsTopic: { id: 12 } }
  h.component._leave = (url) => { target = url }
  h.component.goPlay()
  assert.equal(target, '/pages/play/index?topicId=12&registrationId=7')
})

test('玩家取消参与走本人接口，不打商家 cancel；已支付单走 cancel-refund', () => {
  const src = read('subpackageMember/components/scene-member-participation-detail/index.js')
  assert.match(src, /url:\s*paid\s*\?\s*'\/api\/registration\/cancel-refund'\s*:\s*'\/api\/registration\/cancel'/)
  assert.doesNotMatch(src, /\/api\/registration\/merchant\/cancel/)
})

// 1-24 R9-17 残留:取消按钮必须读后端实际可退状态(人工案件 / refundInfo / 核销),和订单详情同口径,不按「开始前 3 天」猜。
test('1-24:参与详情取消按钮与订单详情同口径,不按开始前 3 天判断', () => {
  const { component } = loadComponent()
  const future = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const paid = (extra, startDate) => component.prepareDisplayData(Object.assign({
    ownerType: 2, registrationStatus: 2, paymentStatus: 2,
    refundInfo: { refundable: true },
    cmsActivity: { name: 'x', startDate, endDate: startDate },
  }, extra))

  const manual = paid({ manualRefundCaseStatus: 'NO_REFUND', refundInfo: { refundable: false, reason: '人工评估结果：不予退款' } }, future)
  assert.equal(manual.canCancel, false, '人工案件单不能再给取消按钮')
  assert.equal(manual.showContactService, true)

  assert.equal(paid({ refundInfo: { refundable: false, reason: '已过退款截止' } }, future).canCancel, false,
    '后端说不可退就不给按钮')
  assert.equal(paid({ verificationStatus: 1 }, future).canCancel, false, '已核销不给按钮')

  const withinThreeDays = paid({}, soon)
  assert.equal(withinThreeDays.canCancel, true, '开场前 1–3 天后端可退时也要给按钮')
  assert.equal(withinThreeDays.showContactService, false)

  assert.equal(component.prepareDisplayData({ ownerType: 2, registrationStatus: 1, paymentStatus: 0,
    cmsActivity: { name: 'x', startDate: soon, endDate: soon } }).canCancel, true, '待支付单可取消订单')
})
