const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const JS = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.js'), 'utf8')
const WXML = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.wxml'), 'utf8')
const WXSS = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.wxss'), 'utf8')
const NEARBY_JS = fs.readFileSync(path.resolve(__dirname, '../../subpackageRoam/nearby/index.js'), 'utf8')

test('漫游 tab 默认进入真实地图浏览态且不会直接启动漫游', () => {
  assert.match(JS, /screen:\s*'entry-map'/)
  assert.match(WXML, /wx:if="\{\{screen=='entry-map'\}\}"/)
  assert.match(WXML, /<free-map[^>]+entryMap/s)
  assert.match(WXML, /bindtap="openEntryRoamSheet"/)
  assert.doesNotMatch(WXML.match(/wx:if="\{\{screen=='entry-map'\}\}"[\s\S]*?<\/view>\s*\n\s*<!--/)[0], /bindtap="goStart"/)
})

test('地图入口保留白色搜索、图层开关、活动抽屉与单独的开始漫游按钮', () => {
  assert.match(WXML, /entry-map__roam[^>]+bindtap="openEntryRoamSheet"/)
  assert.match(WXML, /cy-map-address-search[^>]+entry="\{\{true\}\}"/s)
  assert.match(WXML, /entry-map__layers[^>]+bindtap="openEntryLayers"/)
  assert.doesNotMatch(WXML, /entry-map__tools|entry-map__tool|entry-map__locate|openEntryRecords|locateEntryMap/)
})

test('附近活动只横滑且保持完整轮廓，失败空态留在抽屉内', () => {
  assert.match(WXML, /class="entry-peek"/)
  assert.match(WXML, /entry-peek__cards" scroll-x/)
  assert.doesNotMatch(WXML, /entryPeekExpanded|toggleEntryPeek|onEntryPeekTouch|entry-peek__cards"[^>]*scroll-y/)
  assert.doesNotMatch(JS, /entryPeekExpanded|toggleEntryPeek|onEntryPeekTouch/)
  assert.doesNotMatch(WXML, />查看全部</)
  assert.match(WXML, /entry-peek__state[^>]+wx:if="\{\{entryLoadError\}\}"[^>]+bindtap="retryEntryMap"/)
  assert.match(WXSS, /\.entry-peek\s*\{[^}]*bottom:0[^}]*z-index:223[^}]*height:var\(--entry-peek-h\)[^}]*background:[^}]*var\(--cy-comp-sheet-player-glass\)/s)
  assert.match(WXSS, /\.entry-peek__head\s*\{[^}]*font-size:var\(--cy-type-section-title\)/s)
  assert.match(WXSS, /\.entry-card\s*\{[^}]*height:340rpx/s)
  assert.match(WXSS, /\.entry-card__title\s*\{[^}]*font-size:var\(--cy-type-section-title\)/s)
})

test('活动详情使用紧凑摘要卡，不再使用整幅英雄图', () => {
  assert.match(WXML, /entry-activity__summary/)
  assert.doesNotMatch(WXML, /\? '活动详情' : '开始漫游'/)
  assert.doesNotMatch(WXML, /entry-activity__hero/)
})

test('地图入口保留标题和图文漫游按钮，并且不渲染底栏', () => {
  assert.match(WXML, /entry-map__title[^>]*>漫游</)
  assert.match(WXML, /entry-map__roam[^>]*>[\s\S]*?name="route"[\s\S]*?开始漫游/)
  assert.match(WXML, /<tabBar\s+wx:if="\{\{screen=='intro'\}\}"/)
})

test('报名按钮使用白色 token，入口弹层按内容定高并统一透明玻璃 token', () => {
  assert.match(WXML, /entry-sheet__primary[^>]+bindtap="openEntryActivityDetail"[^>]*>去报名</)
  assert.match(WXSS, /\.entry-sheet__primary\s*\{[^}]*background:\s*var\(--cy-comp-sheet-player-text\)/s)
  assert.match(WXML, /class="psheet \{\{entrySheetIn\?'is-in':''\}\} entry-sheet"/)
  assert.match(WXML, /class="pdim \{\{entrySheetIn\?'is-in':''\}\} entry-sheet__mask"/)
  assert.match(JS, /_showEntrySheet\(entrySheet, entryActivity\)[\s\S]*wx\.nextTick\([\s\S]*entrySheetIn:\s*true/)
  assert.match(WXSS, /\.entry-sheet\s*\{[^}]*background:var\(--cy-comp-sheet-player-glass\)[^}]*backdrop-filter:blur\(var\(--cy-comp-sheet-blur\)\)/s)
  assert.match(WXSS, /\.entry-sheet\s*\{[^}]*transform:translateY\(100%\)/s)
  assert.match(WXSS, /\.entry-sheet\.is-in\s*\{[^}]*translateY\(0\)/s)
  assert.doesNotMatch(WXML, /entrySheetExpanded|toggleEntrySheetHeight|onEntrySheetTouch/)
  assert.doesNotMatch(JS, /entrySheetExpanded|toggleEntrySheetHeight|onEntrySheetTouch/)
  assert.match(WXSS, /\.entry-sheet\s*\{[^}]*--cy-motion-slow[^}]*--cy-ease-spring/s)
  assert.doesNotMatch(WXML, /entry-sheet__eyebrow|entry-activity__status|城市定向\s*·\s*报名中|>先报名</)
})

test('队伍与规则在同一弹层内切换，现场动态直接显示图片', () => {
  assert.match(JS, /openEntryTeam\(e\)[\s\S]*entrySheetView:\s*'team'/)
  assert.match(JS, /openEntryRoamRules\(\)\s*\{\s*this\.setData\(\{\s*entrySheetView:\s*'rules'/)
  assert.doesNotMatch(JS, /openEntryPosts/)
  assert.match(WXML, /现场动态[\s\S]*entryActivity\.dynamicImages/)
  assert.match(WXML, /wx:if="\{\{entryActivity\.registered\}\}"[^>]*[\s\S]*?发起组队/)
  assert.match(WXML, /<\/view>\n      <\/view>\n      <view wx:if="\{\{entryActivity\.registered\}\}" class="entry-sheet__create-team"/,
    '已报名且暂无队伍时也必须能发起组队，入口不能嵌在 teams.length 区块内')
})

test('六个 Figma 状态都有真实落点', () => {
  assert.match(WXML, /entry-peek/)
  assert.match(WXML, /entrySheet=='activity'/)
  assert.match(JS, /pages\/topic\/index\/index\?id=/)
  assert.match(WXML, /entryActivity\.registered/)
  assert.match(WXML, /entrySheet=='layers'/)
  assert.match(WXML, /entrySheet=='roam'/)
})

test('活动、队伍同图展示，活动报名优先进入主题详情', () => {
  assert.match(JS, /\/api\/roam\/entry\/nearby/)
  assert.match(JS, /\/api\/team\/nearby/)
  assert.match(JS, /pages\/topic\/index\/index\?id=/)
  assert.match(WXML, /entryActivity\.teams/)
})

test('队伍入口复用附近队伍的持票申请链，定位失败在入口地图可见', () => {
  assert.match(JS, /\/subpackageRoam\/nearby\/index\?teamId=/)
  assert.match(NEARBY_JS, /_requestedTeamId/)
  assert.match(NEARBY_JS, /openTeam\(teamId\)/)
  assert.match(WXML, /entry-map__permission[^>]+wx:if="\{\{introError\}\}"/)
})
