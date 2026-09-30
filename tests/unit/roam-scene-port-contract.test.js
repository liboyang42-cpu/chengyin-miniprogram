'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const PATHS = {
  historySceneJs: 'components/cy/scene-roam-history/index.js',
  historySceneWxml: 'components/cy/scene-roam-history/index.wxml',
  historySceneWxss: 'components/cy/scene-roam-history/index.wxss',
  historyPageJs: 'subpackageRoam/history/index.js',
  historyPageWxml: 'subpackageRoam/history/index.wxml',
  historyPageJson: 'subpackageRoam/history/index.json',
  sessionSceneJs: 'components/cy/scene-roam-session/index.js',
  sessionSceneWxml: 'components/cy/scene-roam-session/index.wxml',
  sessionSceneWxss: 'components/cy/scene-roam-session/index.wxss',
  sessionPageWxml: 'subpackageRoam/session/index.wxml',
  sessionPageJson: 'subpackageRoam/session/index.json',
  sessionPageJs: 'subpackageRoam/session/index.js',
  sessionPageWxss: 'subpackageRoam/session/index.wxss',
}

function sources() {
  return Object.fromEntries(Object.entries(PATHS).map(([key, relativePath]) => [key, read(relativePath)]))
}

function methodSource(source, name, nextName) {
  const start = source.indexOf(`${name}(`)
  assert.notEqual(start, -1, `找不到 ${name}()`)
  const end = nextName ? source.indexOf(`${nextName}(`, start + name.length + 1) : source.length
  return source.slice(start, end === -1 ? source.length : end)
}

function assertPortContract(files) {
  assert.match(files.historySceneWxml, /class="hs-sum"[^>]*wx:if="\{\{summary\.trips\}\}"/, '漫游历史弹窗必须展示汇总行')
  assert.match(files.historySceneWxml, /class="rc"[^>]*wx:for="\{\{list\}\}"/, '漫游历史弹窗必须使用 #600 RunCard 流')
  assert.match(files.historySceneWxml, /class="rc__stats"/, 'RunCard 必须保留距离、探店、用时三格')
  assert.match(files.historySceneWxml, /class="rc__badges"/, 'RunCard 必须保留勋章/邮票行')
  assert.doesNotMatch(files.historySceneWxml, /hs-filter|hs-card/, '旧筛选票根弹窗必须删除')
  assert.doesNotMatch(files.historySceneWxml, /<cy-nav-bar|<cy-page-title/, '弹窗正文不得复制宿主标题栏')
  assert.match(files.historySceneWxss, /\.hs\s*\{[^}]*height:\s*100%\s*;/s, '弹窗高度必须是 100%，不能沿用页面 100vh')
  assert.doesNotMatch(files.historySceneWxss, /height:\s*100vh/, '组件 WXSS 不得保留页面视口高度')

  assert.match(files.historySceneJs, /triggerEvent\('open', \{ id: 'roam-session', params: \{ ts:/, 'RunCard 点击必须压入 roam-session 子场景')
  assert.match(files.historySceneJs, /triggerEvent\('close'\)/, '空态 CTA 必须关闭弹窗回到漫游宿主')
  assert.doesNotMatch(files.historySceneJs, /wx\.(?:navigateTo|switchTab)/, '弹窗内部不得直接导航页面')

  const historyPageJson = JSON.parse(files.historyPageJson)
  assert.equal(historyPageJson.usingComponents['cy-scene-roam-history'], '/components/cy/scene-roam-history/index')
  assert.match(files.historyPageWxml, /<cy-nav-bar\b/)
  assert.match(files.historyPageWxml, /<cy-page-title[^>]*title="漫游历史"/)
  assert.match(files.historyPageWxml, /<cy-scene-roam-history\b/)
  assert.doesNotMatch(files.historyPageWxml, /wx:for|class="rc|class="hs-sum/, '深链页不得复制 RunCard 正文')
  assert.doesNotMatch(files.historyPageJs, /roam_sessions/, '漫游历史深链页不得复制列表取数与整形')

  assert.match(files.sessionSceneWxml, /class="kv"/, '本次漫游弹窗必须使用 #600 键值汇总')
  assert.match(files.sessionSceneWxml, /class="route-replay"/, '本次漫游必须展示真实轨迹回放总览')
  assert.match(files.sessionSceneWxml, /bindtap="startReplay"/, '路线总览必须可重新回放')
  assert.match(files.sessionSceneWxml, /bindtap="skipReplay"/, '回放必须提供跳过出口')
  assert.match(files.sessionSceneWxml, />解锁奖励</)
  assert.match(files.sessionSceneWxml, />点亮地点</)
  assert.match(files.sessionSceneWxml, /class="rw__hex rw__hex--gold"/, '奖励必须保留金色六边形语义')
  assert.doesNotMatch(files.sessionSceneWxml, /session-hero|session-stats|session-route-card|session-photos/, '旧本次漫游弹窗正文必须删除')
  assert.doesNotMatch(files.sessionSceneWxml, /<cy-nav-bar|<cy-page-title/, '本次漫游弹窗不得复制宿主标题栏')
  assert.match(files.sessionSceneWxss, /\.ss\s*\{[^}]*height:\s*100%\s*;/s, '本次漫游弹窗高度必须是 100%')
  assert.doesNotMatch(files.sessionSceneWxss, /height:\s*100vh/, '本次漫游组件不得使用页面视口高度')
  assert.match(files.sessionSceneJs, /triggerEvent\('share'/, '分享仍由五宿主现有契约承接')
  assert.match(files.sessionSceneJs, /buildRouteGeometry/, '路线回放必须由真实 track\/pois 构建')
  assert.match(files.sessionSceneJs, /reducedMotion/, '路线回放必须尊重减动效偏好')

  const sessionPageJson = JSON.parse(files.sessionPageJson)
  assert.equal(sessionPageJson.usingComponents['cy-scene-roam-session'], '/components/cy/scene-roam-session/index')
  assert.match(files.sessionPageWxml, /<cy-nav-bar\b/)
  assert.match(files.sessionPageWxml, /<cy-page-title[^>]*title="本次漫游"/)
  assert.match(files.sessionPageWxml, /<cy-scene-roam-session[^>]*ts="\{\{ts\}\}"/)
  assert.doesNotMatch(files.sessionPageWxml, /class="kv"|class="rw__/, '本次漫游深链页不得复制 #600 正文')
  assert.match(files.sessionPageJs, /route:\s*'#4B46F5'/, '足迹卡 Canvas 路线必须沿用 Figma 紫色路径')
  assert.doesNotMatch(files.sessionPageJs, /bgStart:\s*'#171717'|bgEnd:\s*'#0B0B0B'/, '足迹卡 Canvas 不得回退黑色舞台')
  assert.match(files.sessionPageWxss, /\.ss-card-map\s*\{[^}]*var\(--cy-color-play-story-surface\)/s, '足迹卡预览使用 Figma 浅色地图面')
}

function loadComponent(relativePath) {
  const absolutePath = path.join(ROOT, relativePath)
  const previous = global.Component
  const previousBehavior = global.Behavior
  let definition
  global.Component = (config) => { definition = config }
  global.Behavior = (config) => config
  try {
    delete require.cache[require.resolve(absolutePath)]
    require(absolutePath)
  } finally {
    global.Component = previous
    global.Behavior = previousBehavior
  }
  return definition
}

function assertHistoryOpenBehavior(method) {
  const timestamp = 1786200000123
  let emitted
  method.call({
    triggerEvent(name, detail) { emitted = { name, detail } },
  }, { currentTarget: { dataset: { ts: timestamp } } })
  assert.deepEqual(emitted, {
    name: 'open',
    detail: { id: 'roam-session', params: { ts: timestamp } },
  }, 'RunCard 必须把原始毫秒 ts 完整压入 roam-session 子场景')
}

test('#600 漫游历史/本次漫游正文只有 scene 组件一份，页面退为深链壳', () => {
  assertPortContract(sources())
})

test('漫游历史保留毫秒时间戳，历史与本次漫游都把无效日期渲染为“日期不可用”', () => {
  const historyDefinition = loadComponent(PATHS.historySceneJs)
  const historyVm = Object.assign({}, historyDefinition.methods, {
    data: { sessionKey: 'roam_sessions', sort: 'new' },
    _sessions: [{ ts: 'not-a-date', zone: '这片街区', distance: '1.2', shops: 1 }],
  })
  const invalidHistory = historyVm._sorted('new')[0]
  assert.equal(invalidHistory.dateFull, '日期不可用')
  assert.equal(invalidHistory.dateShort, '日期不可用')

  const sessionDefinition = loadComponent(PATHS.sessionSceneJs)
  const invalidSession = sessionDefinition.methods._normalize({ ts: 'not-a-date', pois: [null, { name: '有效地点' }] })
  assert.equal(invalidSession.dateFull, '日期不可用')
  assert.deepEqual(invalidSession.pois.map((poi) => poi.name), ['有效地点'])

  const milliseconds = new Date(2026, 7, 8, 12, 0, 0).getTime()
  assert.equal(historyVm._timestamp(milliseconds), milliseconds, 'Date.now() 毫秒值不得再乘 1000')
})

test('RunCard 点击发出完整的 roam-session open 事件，不丢毫秒 ts', () => {
  const definition = loadComponent(PATHS.historySceneJs)
  assertHistoryOpenBehavior(definition.methods.openSession)
})

test('negative control：摘掉 RunCard 汇总必须判红', () => {
  const current = sources()
  const missingSummary = {
    ...current,
    historySceneWxml: current.historySceneWxml.replace('class="hs-sum"', 'class="hs-summary-removed"'),
  }
  assert.notEqual(missingSummary.historySceneWxml, current.historySceneWxml, '汇总行变异锚点失效')
  assert.throws(() => assertPortContract(missingSummary), /汇总行/)

  const missingTimestamp = function missingTimestamp() {
    this.triggerEvent('open', { id: 'roam-session', params: { ts: undefined } })
  }
  assert.throws(() => assertHistoryOpenBehavior(missingTimestamp), /原始毫秒 ts/)
})
