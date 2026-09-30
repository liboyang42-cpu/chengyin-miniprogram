const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE_MODULE = '../../pages/roam/index.js'
const WXML = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.wxml'), 'utf8')

let definition
let requests
let opened
let tracked

function loadPage() {
  delete require.cache[require.resolve(PAGE_MODULE)]
  require(PAGE_MODULE)
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
  page.setData = function (patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.')
      let target = this.data
      while (parts.length > 1) {
        const part = parts.shift()
        target[part] = target[part] || {}
        target = target[part]
      }
      target[parts[0]] = value
    }
  }
  page._player = { lat: 31.230416, lng: 121.473701 }
  page.openScene = (id, params) => opened.push({ id, params })
  return page
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve))
}

function muteRoamEffects(page) {
  // ★ 不再顶掉 _sendCheckin:漫游到访上报与「导流卡该不该出」现在是同一条请求
  //   (曾经是 play/arrive + roam/shop/visit 两条并行,完成态取前者、入账取后者)。
  //   顶掉它就等于顶掉被测的那条线,这个用例会变成恒绿。
  page._triggerCelebration = () => {}
  page._syncGoal = () => {}
  page._syncMarkers = () => {}
  page._syncSparkCircles = () => {}
  page._syncStats = () => {}
  page._clearFootprintHintForPriority = () => {}
  page._shopBadgeThreshold = () => 99
}

beforeEach(() => {
  definition = null
  requests = []
  opened = []
  tracked = []
  require('../../utils/analytics.js').track = (eventName, payload) => tracked.push({ eventName, payload })
  global.Page = config => { definition = config }
  global.getCurrentPages = () => []
  global.getApp = () => ({
    globalData: {},
    sendRequest: request => { requests.push(request) },
  })
  global.wx = {
    getStorageSync: () => undefined,
    showToast: () => {},
    vibrateShort: () => {},
    showLoading: () => {},
    hideLoading: () => {},
  }
})

test('只有shop visit recorded=true才请求候选并渲染第三项', async () => {
  const page = loadPage()
  const reward = { show: true, poi: { name: '店' } }

  await page._attachExploreDayCandidate(false, reward)
  assert.equal(requests.length, 0, 'recorded=false 不得请求或渲染候选')

  const pending = page._attachExploreDayCandidate(true, reward)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/roam/nearby-exploreday')
  assert.deepEqual(Object.keys(requests[0].data).sort(), ['lat', 'lng'])
  requests[0].success({ code: 200, data: { activityId: 71, title: '周末探店日', distanceM: 800 } })
  const candidate = await pending

  assert.equal(candidate.activityId, 71)
  assert.equal(page.data.discoverReward.exploreDay.activityId, 71)
  assert.deepEqual(tracked.map(item => item.eventName), ['roam_exploreday_reco_shown'])
  assert.match(WXML, /wx:if="\{\{discoverReward\.exploreDay\}\}"/)
  assert.match(WXML, /bindtap="onDiscoverExploreDay"/)
})

test('shop visit只有服务端明确recorded=true才返回可导流事实', async () => {
  const page = loadPage()
  page._roamSid = 19
  const poi = { regId: 33 }

  let pending = page._apiShopVisit(poi)
  requests[0].success({ code: 200, data: { recorded: false } })
  assert.deepEqual(await pending, { ok: false, reason: 'server', msg: undefined })

  requests = []
  pending = page._apiShopVisit(poi)
  requests[0].success({ code: 200, data: { recorded: true } })
  assert.deepEqual(await pending, { ok: true })

  // 没有可上报来源(既非 roam 据点也非报名商家)时压根不发请求,并如实报 nolocal
  requests = []
  assert.deepEqual(await page._apiShopVisit({}), { ok: false, reason: 'nolocal' })
  assert.equal(requests.length, 0)
})

test('真实startVisit到finish接线只把recorded=true接到候选第三项', async () => {
  const page = loadPage()
  muteRoamEffects(page)
  page._roamSid = 19
  page._pois = [{ id: 'shop-1', regId: 33, cat: 'merchant', first: true, state: 'near', name: '店' }]

  page.startVisit('shop-1')
  assert.equal(requests[0].url, '/api/roam/shop/visit')
  requests[0].success({ code: 200, data: { recorded: true } })
  page._finishVisit()
  // 用 setImmediate 冲干净整条微任务链,不去数 then 的跳数:
  // 上报 → _sendCheckin 的 then → _finishVisit 的 then,数错一跳这条断言就恒空。
  await flushMicrotasks()
  assert.equal(requests[1].url, '/api/roam/nearby-exploreday')
  requests[1].success({ code: 200, data: { activityId: 74, title: '真实接线活动' } })
  await flushMicrotasks()
  assert.equal(page.data.discoverReward.exploreDay.activityId, 74)

  requests = []
  const duplicatePage = loadPage()
  muteRoamEffects(duplicatePage)
  duplicatePage._roamSid = 20
  duplicatePage._pois = [{ id: 'shop-2', regId: 34, cat: 'merchant', first: true, state: 'near', name: '店二' }]
  duplicatePage.startVisit('shop-2')
  requests[0].success({ code: 200, data: { recorded: false } })
  duplicatePage._finishVisit()
  await flushMicrotasks()
  assert.equal(requests.length, 1, '重复到店 recorded=false 不得请求候选')
  assert.equal(duplicatePage.data.discoverReward.exploreDay, undefined)
})

test('空候选_超距_开关关都由服务端返回空且前端不占位', async () => {
  for (const reason of ['empty', 'outside-1500m', 'switch-off']) {
    requests = []
    const page = loadPage()
    const pending = page._attachExploreDayCandidate(true, { show: true, poi: { name: reason } })
    requests[0].success({ code: 200, data: null })
    assert.equal(await pending, null)
    assert.equal(page.data.discoverReward.exploreDay, undefined)
  }
  assert.doesNotMatch(WXML, /暂无.*探店日|全城.*推荐/)
})

test('关闭CTA不阻断漫游且伪造data不能打开活动_点击只用服务端返回activity shell', async () => {
  const page = loadPage()
  page.data.screen = 'map'
  page.data.discoverReward = { show: true, exploreDay: { activityId: 999 } }
  page.onDiscoverExploreDay()
  assert.equal(opened.length, 0, '没有服务端本轮候选标记时客户端伪造 data 必须无效')

  const pending = page._attachExploreDayCandidate(true, { show: true, poi: { name: '店' } })
  requests[0].success({ code: 200, data: { activityId: 72, title: '服务端活动壳' } })
  await pending
  page.onDiscoverExploreDay()
  assert.deepEqual(opened, [{ id: 'play-activity-detail', params: { id: 72 } }])
  assert.deepEqual(tracked.map(item => item.eventName), [
    'roam_exploreday_reco_shown',
    'roam_exploreday_reco_click',
  ])

  page.data.discoverReward.show = true
  page.closeDiscoverReward()
  assert.equal(page.data.discoverReward.show, false)
  assert.equal(page.data.screen, 'map', '关闭导流卡不改变漫游 screen')

  requests = []
  tracked = []
  const closingPage = loadPage()
  closingPage.data.screen = 'map'
  const closing = closingPage._attachExploreDayCandidate(true, { show: true, poi: { name: '店' } })
  closingPage.closeDiscoverReward()
  requests[0].success({ code: 200, data: { activityId: 73, title: '迟到响应' } })
  assert.equal(await closing, null, '关闭后迟到响应不得把第三项重新弹出')
  assert.equal(tracked.length, 0)
  assert.equal(closingPage.data.discoverReward.show, false)
  assert.equal(closingPage.data.screen, 'map')
})
