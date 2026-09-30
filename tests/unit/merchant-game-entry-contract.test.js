const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const JS_PATH = path.resolve(__dirname, '../../pages/merchant/index/index.js')
const WXML_PATH = path.resolve(__dirname, '../../pages/merchant/index/index.wxml')

// 2026-09-23 用户裁决:工作台项目卡都是已确定接待的项目,「本站可接待」这类站点状态字没有信息量;
// 俱乐部要来时写「谁、哪天几点到店」。整卡仍进承接详情,不再为状态字逐场拉 projection,也不放本站直达入口。
test('商家工作台承接卡写俱乐部到店时间，不写站点状态，整卡进承接详情', () => {
  const js = fs.readFileSync(JS_PATH, 'utf8')
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')

  assert.match(js, /createGameSessionClient/)
  assert.match(js, /loadMerchantGameEntries\(\)/)
  assert.match(js, /loadMerchantEntries\(\)/)
  assert.match(js, /refreshGameStationSummaries\(projectCards\)/)
  assert.match(js, /attachMerchantGameEntries/)
  assert.match(js, /attachVisitTexts\(decorated, this\._upcomingRuns\)/)
  assert.match(js, /url: '\/api\/merchant\/upcoming-runs'/)
  assert.match(js, /openProjectCard\(e\)/)
  assert.match(js, /goJoinDetail\(e\)/)
  assert.match(js, /\/pages\/topic\/merchantinfo\/merchantinfo/)
  assert.doesNotMatch(js, /loadProjection\('merchant'/, '不再为站点状态字逐场拉 projection')
  assert.doesNotMatch(js, /openGameStation/)

  assert.match(wxml, /bindtap="openProjectCard"/)
  assert.match(wxml, /class="rv-project-visit" wx:if="\{\{item\.visitText\}\}"/)
  assert.doesNotMatch(wxml, /gameEntry\.gameText/, '卡上不写「本站可接待」等站点状态')
  assert.doesNotMatch(wxml, /本站准备与运行/)
})

test('普通主题卡不被误认成 activity；摘要失败态由纯投影保留而不是写成空态', () => {
  const js = fs.readFileSync(JS_PATH, 'utf8')
  const start = js.indexOf('refreshGameStationSummaries(projectCards)')
  const end = js.indexOf('resetGameStationSummaries()', start)
  const gameBlock = js.slice(start, end)
  assert.match(gameBlock, /this\._merchantGameEntries/)
  assert.doesNotMatch(gameBlock, /topicId\s*\|\|\s*activityId/)
  assert.doesNotMatch(gameBlock, /merchantId\s*:/)
  assert.doesNotMatch(gameBlock, /actor(?:Id|MemberId)?\s*:/)
  const merchant = require('../../pages/merchant/utils/game-session-merchant.js')
  const cards = [{ id: 71, bizType: 'activity', title: '普通活动' }]
  const unavailable = merchant.decorateMerchantActivityCards(cards, {
    71: merchant.merchantGameCardState({ status: 'business-error', reasonCode: 'GAME_SESSION_NOT_PREPARED' }),
  })
  assert.equal(unavailable[0].gameActivityId, 0, '没有真实 MERCHANT 投影的活动不得出现可点击入口')
})
test('到店时间按主题取最近一场俱乐部场次;没俱乐部或没人付款的不写', () => {
  const { attachVisitTexts } = require('../../utils/merchant-workbench.js')
  const cards = [
    { role: 'join', ownerId: 77 },
    { role: 'join', ownerId: 78 },
    { role: 'join', ownerId: 79 },
    { role: 'host', ownerId: 77 },
  ]
  const runs = [
    { topicId: 77, clubName: null, paidCount: 3, startTime: '2026-09-26 09:00:00' },
    { topicId: 77, clubName: '空场团', paidCount: 0, startTime: '2026-09-27 09:00:00' },
    { topicId: 77, clubName: '城瘾跑团', paidCount: 4, startTime: '2026-09-28 09:00:00', arrivalStart: '2026-09-28 10:30:00' },
    { topicId: 77, clubName: '别的团', paidCount: 2, startTime: '2026-10-05 09:00:00' },
    { topicId: 78, clubName: '夜跑团', paidCount: 1, startTime: '2026-09-27T01:00:00.000+00:00' },
  ]
  const out = attachVisitTexts(cards, runs)
  assert.equal(out[0].visitText, '城瘾跑团 · 9月28日 周一 10:30 到店', '跳过无俱乐部与零付款场次,取最近一场俱乐部场次')
  assert.equal(out[1].visitText, '夜跑团 · 9月27日 周日 09:00 到店', '带偏移的时间按上海日历显示')
  assert.equal(out[2].visitText, '', '没有俱乐部要来就不写')
  assert.equal(out[3].visitText, undefined, '主办卡不挂到店时间')
})
