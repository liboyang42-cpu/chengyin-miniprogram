const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PLAY_PAGE = path.join(ROOT, 'pages/play/index.js')
const ROAM_PAGE = path.join(ROOT, 'pages/roam/index.js')
const CELEBRATE_COMPONENT = path.join(ROOT, 'components/cy/celebrate/index.js')
const REDUCED_MOTION_BEHAVIOR = path.join(ROOT, 'behaviors/reduced-motion.js')

let pageConfig
let requests
let storage

global.getApp = () => ({
  getUserID: () => '9',
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  // 漫游结算先落本机恢复记录(8b0871d2e),存储须可读回,与 roam-finish-write-order 同口径
  getStorageSync: key => (key in storage ? storage[key] : ''),
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  getLocation: ({ success }) => success({ latitude: 31.2, longitude: 121.4, accuracy: 12 }),
  showLoading() {},
  hideLoading() {},
  showToast() {},
  vibrateShort() {},
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  pageConfig = null
  requests = []
  storage = {}
})

function setByPath(target, dataPath, value) {
  const parts = dataPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage(modulePath) {
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([dataPath, value]) => setByPath(page.data, dataPath, value))
    if (callback) callback()
  }
  return page
}

function loadCelebrationComponent() {
  const previousComponent = global.Component
  const previousBehavior = global.Behavior
  let definition = null
  global.Behavior = (config) => config
  global.Component = (config) => { definition = config }
  delete require.cache[require.resolve(REDUCED_MOTION_BEHAVIOR)]
  delete require.cache[require.resolve(CELEBRATE_COMPONENT)]
  require(CELEBRATE_COMPONENT)
  global.Component = previousComponent
  global.Behavior = previousBehavior
  return definition
}

function renderCelebration(eventKey, reducedMotion = false) {
  const definition = loadCelebrationComponent()
  const instance = {
    data: { eventKey: '', reducedMotion, pieces: [] },
    setData(patch) { Object.assign(this.data, patch) },
  }
  definition.properties.eventKey.observer.call(instance, eventKey)
  return instance.data.pieces
}

function assertCelebrates(page, moment) {
  assert.match(page.data.celebrationEvent, new RegExp('^' + moment + ':\\d+$'))
  assert.ok(renderCelebration(page.data.celebrationEvent).length > 0,
    moment + ' 必须穿过共享组件接口产生彩旗粒子')
}

function preparePlayCompletion(page, node = { nodeId: 7, points: 12 }) {
  page.data.nodes = [node]
  page.data.mode = 1
  page.data.nextNode = null
  page.data.showJournal = false
  page.clearArrivalError = () => {}
  page.clearGameNetworkError = () => {}
  page.stopNav = () => {}
  page.rebuild = () => {}
  page.markJustWrote = () => {}
}

function preparePlayFinish(page, mode) {
  page.data.mode = mode
  page.data.nodes = []
  page.data.total = 0
  page.loadEnding = () => {}
  page.paintRouteThumb = () => {}
  page.buildReview = () => {}
  page.loadMilestone = () => {}
  page.loadFinishRouteRecommendation = () => {}
}

test('任务完成处理器会触发共享彩旗反馈', () => {
  const page = loadPage(PLAY_PAGE)
  preparePlayCompletion(page)

  page.onComplete(7, {})

  assertCelebrates(page, 'task-complete')
})

test('城市定向与自由探索结束分别触发共享彩旗反馈', () => {
  for (const [mode, moment] of [[1, 'classic-finish'], [2, 'free-finish']]) {
    const page = loadPage(PLAY_PAGE)
    preparePlayFinish(page, mode)

    page.openFinish()

    assertCelebrates(page, moment)
  }
})

test('F-38：自由探索终章没有可见内容时保留完成面板，不打开空故事层', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.mode = 2
  page.data.allDone = true
  page.data.nodes = Array.from({ length: 8 }, (_, index) => ({
    nodeId: index + 1,
    name: `第 ${index + 1} 站`,
    done: true,
  }))
  page.data.total = 8
  page._endRunSession = () => {}
  page.loadNewLifeOS = () => {}
  page.paintRouteThumb = () => {}
  page.buildReview = () => {}
  page.loadMilestone = () => {}
  page.loadFinishRouteRecommendation = () => {}
  page._buildBranchPath = () => []
  page._pickFinishBadge = () => null
  page._triggerCelebration = () => {}

  page.openFinish()
  assert.equal(page.data.showFinish, true)
  assert.equal(page.data.finishStamps.length, 8)
  assert.equal(requests[0].url, '/api/play/ending')

  requests[0].success({ code: 200, data: { opener: '', fragments: [] } })
  await Promise.resolve()

  assert.equal(page.data.showFinish, true)
  assert.equal(page.data.ending.show, false, '空终章不得遮住完成面板')
})

test('漫游结束处理器会触发共享彩旗反馈', () => {
  const page = loadPage(ROAM_PAGE)
  page.data.visit = { active: false }
  // 读数真值 2026-09-10 从 data.stats 挪到实例字段 this._stats:它一行都不进 wxml,
  // 留在 data 会被 U4「死数据字段」判成 A2。断言的行为没变,喂法换了。
  page._stats = { explorePct: 20, time: '00:10:00' }
  page._pois = []
  page._foundRoamPois = {}
  page._sessionPhotos = []
  page._stopClock = () => {}
  page._stopReal = () => {}
  page._saveSession = () => {}
  page._postRoamFinish = () => Promise.resolve(true)

  page._arrive()

  assert.equal(page.data.screen, 'arrive')
  assertCelebrates(page, 'roam-finish')
})

test('游玩模板徽章、成长徽章与漫游徽章都触发共享彩旗反馈', () => {
  // 模板名次奖牌自 2026-09-16(C-21)起只认「真夺到名次」:后端回执带 medalRank 才弹。
  const templateMedal = loadPage(PLAY_PAGE)
  preparePlayCompletion(templateMedal, { nodeId: 7, points: 12, medalName: '街角观察家' })
  templateMedal.onComplete(7, { medalRank: 1 })
  assertCelebrates(templateMedal, 'medal-earned')

  const growthBadge = loadPage(PLAY_PAGE)
  preparePlayCompletion(growthBadge)
  growthBadge.onComplete(7, { newBadges: [{ name: '第一步' }] })
  assertCelebrates(growthBadge, 'medal-earned')

  const roamMedal = loadPage(ROAM_PAGE)
  roamMedal._shopBadgeCfg = { name: '三店连亮' }
  roamMedal._popMedal()
  assertCelebrates(roamMedal, 'medal-earned')
})

test('负控:节点配了奖牌名但没中签(无 medalRank),不得再弹「专属徽章」', () => {
  const page = loadPage(PLAY_PAGE)
  preparePlayCompletion(page, { nodeId: 7, points: 12, medalName: '街角观察家' })

  page.onComplete(7, {})

  assert.doesNotMatch(page.data.celebrationEvent, /^medal-earned/,
    '第 4 名起弹的「专属徽章」是假奖:勋章墙里根本没有')
})

test('漫游结算后端确认的新徽章也触发共享彩旗反馈', async () => {
  const page = loadPage(ROAM_PAGE)
  page._foundRoamPois = {}
  page._roamSid = 88
  page._flushReveal = () => {}
  page.data.finish = {}

  const settling = page._postRoamFinish(1200)
  requests[0].success({ code: 200, data: { totalXp: 0, medal: '漫游新章', shopMedal: { name: '三店连亮' } } })

  assert.equal(await settling, true)
  assertCelebrates(page, 'medal-earned')
})

test('打卡成功处理器会触发共享彩旗反馈', async () => {
  const page = loadPage(ROAM_PAGE)
  page._player = { lat: 31.2, lng: 121.4 }
  page._roamSid = 88

  // 成功判据是漫游自己那条账的 recorded,不再是 play 域的 200
  const checking = page._sendCheckin({ regId: 33 })
  assert.equal(requests[0].url, '/api/roam/shop/visit')
  requests[0].success({ code: 200, data: { recorded: true } })

  assert.equal(await checking, true)
  assert.equal(page.data.visit.checkinOk, true)
  assertCelebrates(page, 'checkin-success')
})

test('官方任务只有服务端确认完成时才触发共享彩旗反馈', async () => {
  const page = loadPage(ROAM_PAGE)
  page._realOn = true
  page._roamSid = 88
  page.data.eventOverlay = {
    id: 5,
    signed: true,
    paused: false,
    status: 3,
    missions: [{ missionCode: 'ARRIVE', canVerifyArrival: true, complete: false }],
  }

  page.verifyEventArrival({ currentTarget: { dataset: { mission: 'ARRIVE' } } })
  requests[0].success({ code: 200, data: { accepted: true, completed: true } })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(page.data.eventOverlay.missions[0].complete, true)
  assertCelebrates(page, 'task-complete')

  requests = []
  const acceptedOnly = loadPage(ROAM_PAGE)
  acceptedOnly._realOn = true
  acceptedOnly._roamSid = 88
  acceptedOnly.data.eventOverlay = {
    id: 5,
    signed: true,
    paused: false,
    status: 3,
    missions: [{ missionCode: 'ARRIVE', canVerifyArrival: true, complete: false }],
  }
  acceptedOnly.verifyEventArrival({ currentTarget: { dataset: { mission: 'ARRIVE' } } })
  requests[0].success({ code: 200, data: { accepted: true, completed: false } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(acceptedOnly.data.celebrationEvent, '', '仅写入证据但任务未完成时不能提前庆祝')
})

test('共享组件在减少动效时不生成彩旗，完成内容仍由宿主页即时呈现', () => {
  const definition = loadCelebrationComponent()
  assert.equal(definition.behaviors.length, 1)
  assert.equal(definition.behaviors[0].properties.reducedMotion.type, Boolean)
  assert.match(definition.behaviors[0].pageLifetimes.show.toString(), /_syncReducedMotionPreference/)
  const pieces = renderCelebration('task-complete:1', true)
  assert.deepEqual(pieces, [])

  const wxss = fs.readFileSync(path.join(ROOT, 'components/cy/celebrate/index.wxss'), 'utf8')
  assert.match(wxss, /animation:\s*cy-celebrate-fall\s+var\(--cy-motion-celebrate\)/)
  assert.doesNotMatch(wxss, /animation(?:-duration)?:[^;}]*\b\d+(?:\.\d+)?m?s\b/)
})

test('play 与 roam 都把同一个共享组件接到事件和减少动效状态', () => {
  for (const page of ['play', 'roam']) {
    const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages', page, 'index.json'), 'utf8'))
    const wxml = fs.readFileSync(path.join(ROOT, 'pages', page, 'index.wxml'), 'utf8')
    assert.equal(json.usingComponents['cy-celebrate'], '/components/cy/celebrate/index')
    assert.match(wxml, /<cy-celebrate\s+event-key="\{\{celebrationEvent\}\}"\s+reduced-motion="\{\{reducedMotion\}\}"\s*\/>/)
  }
})
