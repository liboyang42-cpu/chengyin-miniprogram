'use strict'

// R9-21:游玩暂停后离开页面,重进必须恢复暂停会话(用时、暂停态),不能重开成 idle。
// 服务端没有玩家暂停/计时的真值(只有节点打卡与商家侧站点暂停),所以暂停态走本地兜底;
// 页面用服务端权威态(时间窗 / 路线状态 / 通关)把门 —— 服务端说结束就不恢复,并清掉兜底快照。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const runSession = require('../../pages/play/utils/play-run-session.js')

const PLAY_PAGE = '../../pages/play/index.js'
const read = (relative) => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8')

let pageConfig
let requests
let storage
let nowMs

global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  getUserID: () => '9',
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getStorageSync: (key) => (key in storage ? storage[key] : ''),
  setStorageSync: (key, value) => { storage[key] = JSON.parse(JSON.stringify(value)) },
  removeStorageSync: (key) => { delete storage[key] },
  showToast() {},
  showModal() {},
  nextTick: (callback) => callback(),
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  offLocationChange() {},
  stopLocationUpdate() {},
}

global.Page = (config) => { pageConfig = config }

// 时钟 ticker 的 setInterval 会带着测试进程不退出(断言提前失败时更明显),一律换成假句柄。
const realSetInterval = global.setInterval
const realClearInterval = global.clearInterval
const realDateNow = Date.now
global.setInterval = () => 1
global.clearInterval = () => {}
// 页面时钟自己拿 Date.now(生产路径),把 now 换成可控值才能在测试里走完 42 秒。
Date.now = () => nowMs
test.after(() => {
  global.setInterval = realSetInterval
  global.clearInterval = realClearInterval
  Date.now = realDateNow
})

function setByPath(target, key, value) {
  const parts = key.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  delete require.cache[require.resolve(PLAY_PAGE)]
  require(PLAY_PAGE)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(page.data, key, value))
    if (callback) callback()
  }
  return page
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function loadNodes(page, data) {
  page.loadData(true)
  const request = requests[requests.length - 1]
  request.success({
    code: 200,
    data: Object.assign({ registered: true, topicId: 31, mode: 1 }, data),
  })
  return flush()
}

const NODES = [{ nodeId: 1, name: '第一站', latitude: 31.21, longitude: 121.46, done: false }]

// 第一程的公共起手:走页面自己的时钟创建路径(_ensureSessionClock 内部取 Date.now = 测试假 now)。
function startRun(page, topicId) {
  page.data.topicId = topicId
  page.data.total = 1
  page._runStarted = true
  page._ensureSessionClock()
  page._sessionClock.start()
  return page
}

test.beforeEach(() => {
  pageConfig = null
  requests = []
  storage = {}
  nowMs = 0
})

test('R9-21 暂停后离开页面,重进恢复暂停态与已走用时,而不是重开', async () => {
  // ① 第一程:开始 → 42 秒 → 暂停,离开页面(onUnload)
  const first = startRun(loadPage(), '31')
  nowMs = 42000
  first.onPlayHudToggle()
  first._syncRunState()
  assert.equal(first.data.runState, 'paused', '点暂停后底部运行栈必须是 paused')
  first.onUnload()

  // ② 重新进入同一主题:恢复 paused + 42 秒,而不是 idle/重新计时
  const second = loadPage()
  second.data.topicId = '31'
  await loadNodes(second, { nodes: NODES })
  assert.equal(second.data.runState, 'paused', '重进页面必须恢复暂停态,不能回到「开始」')
  assert.equal(second._sessionClock.elapsedSeconds(), 42, '重进必须恢复已走用时')
  assert.equal(second._sessionClock.isPaused(), true, '恢复的时钟必须停在暂停上(不偷跑)')

  // ③ 点「继续」:从 42 秒接着走,不是清零重来
  nowMs = 100000
  second.onRunToggle()
  assert.equal(second.data.runState, 'running', '点继续必须进入 running')
  nowMs = 103000
  assert.equal(second._sessionClock.elapsedSeconds(), 45, '继续后必须从恢复的用时接着算')
})

test('R9-21 没点过暂停、直接离开页面(返回/断网丢页)也要保住未结束会话', async () => {
  const first = startRun(loadPage(), '31')
  nowMs = 9000
  first.onUnload()   // 返回键离页:时钟还在跑,不是主动结束

  const second = loadPage()
  second.data.topicId = '31'
  await loadNodes(second, { nodes: NODES })
  assert.equal(second.data.runState, 'paused')
  assert.equal(second._sessionClock.elapsedSeconds(), 9)
})

test('R9-21 长按结束(通关/主动收尾)必须作废暂停快照,重进不能再还魂', async () => {
  const first = startRun(loadPage(), '31')
  nowMs = 42000
  first.onPlayHudToggle()
  first._syncRunState()
  first.openFinish = () => {}   // 通关卡的渲染不是本契约:只看会话本身有没有收尾
  first._finishRun()   // 长按 3 秒走的就是它
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined, '结束后快照必须清掉')

  const second = loadPage()
  second.data.topicId = '31'
  await loadNodes(second, { nodes: NODES })
  assert.equal(second.data.runState, 'idle', '已结束的会话重进不能恢复成暂停态')
})

test('R9-21 服务端说这场已经结束(时间窗关闭 / 路线终态)时不恢复,并清掉兜底快照', async () => {
  const seeded = { state: 'paused', elapsedSeconds: 42, savedAt: 1 }

  storage['play_paused_run_v2:m9:t31'] = Object.assign({}, seeded)
  const expired = loadPage()
  expired.data.topicId = '31'
  await loadNodes(expired, { playable: false, timeNote: '本场已结束', nodes: NODES })
  assert.equal(expired.data.runState, 'idle', '时间窗关闭了就不能把玩家拉回暂停中的计时')
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined, '不恢复时必须清掉兜底快照')

  storage['play_paused_run_v2:m9:t31'] = Object.assign({}, seeded)
  const withdrawn = loadPage()
  withdrawn.data.topicId = '31'
  await loadNodes(withdrawn, {
    routeState: { routeMode: 'BRANCH_GRAPH', status: 'ENDED' },
    nodes: NODES,
  })
  assert.equal(withdrawn.data.runState, 'idle', '路线终态是服务端权威,优先于本地暂停快照')
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined)
})

test('R9-21 全部节点已完成时不再恢复暂停会话', async () => {
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 1 }

  const page = loadPage()
  page.data.topicId = '31'
  await loadNodes(page, { nodes: [{ nodeId: 1, name: '第一站', latitude: 31.21, longitude: 121.46, done: true }] })
  assert.equal(page.data.runState, 'idle')
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined)
})

test('R9-21 断网加载失败不算主动离场:快照保留,下次加载成功仍能恢复', async () => {
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 1 }

  const offline = loadPage()
  offline.data.topicId = '31'
  offline.loadData(true)
  requests[requests.length - 1].fail()
  await flush()
  assert.equal(offline.data.emptyKind, 'error')
  assert.equal(storage['play_paused_run_v2:m9:t31'].elapsedSeconds, 42, '断网不能把暂停快照当成离场清掉')

  const retry = loadPage()
  retry.data.topicId = '31'
  await loadNodes(retry, { nodes: NODES })
  assert.equal(retry.data.runState, 'paused')
  assert.equal(retry._sessionClock.elapsedSeconds(), 42)
})

test('R9-21 重新按「开始」起新局时,旧暂停快照作废', () => {
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 999, savedAt: 1 }

  const page = loadPage()
  page.data.topicId = '31'
  page.data.total = 1
  page.requestPlayLocation = () => {}   // 定位弹窗不是本契约
  page.onRunToggle()
  assert.equal(page.data.runState, 'running')
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined, '新局的用时从 0 起,旧快照不能留下')
})

test('R9-21 服务端游戏会话已结束(FINISHED/CANCELLED)时,撤掉恢复出来的暂停局', async () => {
  const gameSessionPath = require.resolve('../../utils/game-session-client.js')
  const realExports = require.cache[gameSessionPath].exports
  let projection = null
  require.cache[gameSessionPath].exports = {
    loadProjection: () => Promise.resolve(projection),
    submitAction: () => Promise.resolve({ status: 'business-error' }),
    readReceipt: () => Promise.resolve({ status: 'business-error' }),
  }
  try {
    const page = loadPage()
    page.data.activityId = '27'
    page.data.topicId = '31'
    page.data.total = 1
    storage['play_paused_run_v2:m9:a27'] = { state: 'paused', elapsedSeconds: 42, savedAt: 1 }
    assert.equal(page._restoreRunSession({}, {}, NODES), true)
    assert.equal(page.data.runState, 'paused')

    projection = {
      status: 'ready',
      data: {
        perspective: 'PLAYER', sessionId: 1, activityId: 27, revision: 1,
        status: 'FINISHED', player: { role: {}, nodes: [] }, availableActions: [],
      },
    }
    page._loadPlayerGameModule()
    await flush()
    assert.equal(page.data.runState, 'idle', '服务端说本局已结束,不能再停在恢复出来的暂停态')
    assert.equal(storage['play_paused_run_v2:m9:a27'], undefined, '服务端权威态下本地快照必须作废')
  } finally {
    require.cache[gameSessionPath].exports = realExports
  }
})

test('R9-21 快照 key 同时按账号和场次隔离:活动场次优先 activityId,自玩用 topicId', () => {
  assert.equal(runSession.pausedRunStorageKey({ memberId: '9', activityId: '27', topicId: '31' }), 'play_paused_run_v2:m9:a27')
  assert.equal(runSession.pausedRunStorageKey({ memberId: '9', activityId: '', topicId: '31' }), 'play_paused_run_v2:m9:t31')
  assert.equal(runSession.pausedRunStorageKey({ activityId: '27', topicId: '31' }), '', '身份未确定时不得读写个人进度')
  assert.equal(runSession.pausedRunStorageKey({ activityId: '0', topicId: 'x' }), '')
  assert.equal(runSession.pausedRunStorageKey(null), '')
})

test('F20 账号切换不得恢复上一账号快照，旧无账号 key 要安全删除', () => {
  storage['play_paused_run_v1:t31'] = { state: 'paused', elapsedSeconds: 88, savedAt: 1 }
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 2 }
  assert.equal(runSession.readPausedRun(wx, { memberId: '10', topicId: '31' }), null)
  assert.equal(storage['play_paused_run_v1:t31'], undefined, '旧无账号快照不得迁给任何新账号')
  assert.deepEqual(runSession.readPausedRun(wx, { memberId: '9', topicId: '31' }), {
    state: 'paused', elapsedSeconds: 42, savedAt: 2,
  })
})

test('R9-21 畸形快照一律不当成可恢复会话', () => {
  const rejected = [
    null, [], 'paused', 42,
    { state: 'running', elapsedSeconds: 42 },
    { state: 'paused', elapsedSeconds: -1 },
    { state: 'paused', elapsedSeconds: '42' },
    { state: 'paused', elapsedSeconds: 4.2 },
    { state: 'paused', elapsedSeconds: runSession.MAX_PAUSED_SECONDS + 1 },
  ]
  rejected.forEach((raw) => {
    assert.equal(runSession.normalizePausedRun(raw), null, JSON.stringify(raw) + ' 不该被接受')
  })
  assert.deepEqual(
    runSession.normalizePausedRun({ state: 'paused', elapsedSeconds: 42, savedAt: 7 }),
    { state: 'paused', elapsedSeconds: 42, savedAt: 7 }
  )
})

test('R9-21 存储读写异常(容量满/被清空)不能让页面崩,也不能伪造恢复', () => {
  const throwing = {
    getStorageSync() { throw new Error('storage broken') },
    setStorageSync() { throw new Error('storage full') },
    removeStorageSync() { throw new Error('storage broken') },
  }
  assert.equal(runSession.readPausedRun(throwing, { topicId: '31' }), null)
  assert.equal(runSession.writePausedRun(throwing, { topicId: '31' }, 42, 1), false)
  assert.equal(runSession.clearRunSession(throwing, { topicId: '31' }), false)
  assert.equal(runSession.readPausedRun(null, { topicId: '31' }), null)
})

// ===== R1(审查C P1):通关/结束后的行程不能再被当成「暂停」恢复 =====
// 现码 openFinish 清了快照却没把 _runStarted 置 false ⇒ 随后的 onHide/onUnload 又把它写回;
// 且服务端 BRANCH_GRAPH 通关返回的 routeState.status=COMPLETED 不在 _serverRunSessionEnded 的终态列表里。
/** 通关卡的网络/绘制不是本契约,只留会话收尾那一半。 */
function stubFinishPanel(page) {
  page.loadEnding = () => {}
  page.loadNewLifeOS = () => {}
  page.paintRouteThumb = () => {}
  page.buildReview = () => {}
  page.loadMilestone = () => {}
  page.loadFinishRouteRecommendation = () => {}
  return page
}

test('R1 通关(openFinish)当场作废暂停快照,之后 onHide/onUnload 不能再写回', async () => {
  const first = startRun(loadPage(), '31')
  nowMs = 42000
  first.onPlayHudToggle()          // 暂停 → 快照落盘
  first._syncRunState()
  assert.equal(first.data.runState, 'paused', '前提:暂停后确实处于 paused')
  assert.ok(storage['play_paused_run_v2:m9:t31'], '前提:暂停时确实落了快照')

  stubFinishPanel(first).openFinish()   // 末站完成走的就是 openFinish
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined, '通关那一刻暂停快照就必须作废')
  assert.equal(first.data.runState, 'idle', '通关后底部运行栈必须回 idle,不能再显示一局没结束的行程')
  assert.equal(first._runStarted, false, '通关即会话终点,不能还挂着「行程已开始」')

  first.onHide()                   // 通关后切后台/被盖住
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined, '通关后 onHide 不能再写回暂停快照')
  first.onUnload()                 // 通关后按返回/离开页面
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined, '通关后 onUnload 不能再写回暂停快照')

  const second = loadPage()
  second.data.topicId = '31'
  await loadNodes(second, { nodes: NODES })
  assert.equal(second.data.runState, 'idle', '已通关的行程重进不能恢复成暂停态')
})

test('R1 服务端路线态 COMPLETED 是结束事实:重进不恢复暂停会话并清快照', async () => {
  // 支线终局(TERMINAL):到终点就 COMPLETED,没走到的支线仍是 DISCOVERED_LOCKED ⇒ 本地 allDone 判断不成立,
  // 只有服务端 routeState.status=COMPLETED 能拦住恢复。
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 1 }

  const page = loadPage()
  page.data.topicId = '31'
  await loadNodes(page, {
    routeState: {
      routeMode: 'BRANCH_GRAPH',
      status: 'COMPLETED',
      nodeStates: { 1: 'COMPLETED', 2: 'DISCOVERED_LOCKED' },
    },
    nodes: [
      { nodeId: 1, name: '第一站', latitude: 31.21, longitude: 121.46, done: false },
      { nodeId: 2, name: '第二站', latitude: 31.22, longitude: 121.47, done: false },
    ],
  })
  assert.equal(page.data.nodes.filter((n) => !n.done).length, 1, '前提:还有没走完的可见节点,allDone 不成立')
  assert.equal(page.data.runState, 'idle', '路线已 COMPLETED 时不能再把暂停快照恢复成进行中的行程')
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined, '不恢复时必须清掉兜底快照')
})

// ===== 负控:把 R1 的两条修复摘掉,上面的判据必须真的判红 =====
test('R1 负控:通关不收尾(复刻修复前 openFinish),离页必须把已结束行程写回成暂停', () => {
  const first = startRun(loadPage(), '31')
  nowMs = 42000
  first.onPlayHudToggle()
  stubFinishPanel(first)
  first._endRunSession = () => {}   // 复刻修复前:openFinish 只清快照,不碰 _runStarted/时钟/运行栈
  first.openFinish()
  first.onUnload()                  // 修复前 _runStarted 仍为 true ⇒ 快照被写回
  assert.equal((storage['play_paused_run_v2:m9:t31'] || {}).state, 'paused', '负控:收尾摘掉后必须真的能复现写回')
})

test('R1 负控:终态列表退回修复前(漏 COMPLETED),重进必须把通关行程恢复成 paused', async () => {
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 1 }

  const page = loadPage()
  page.data.topicId = '31'
  page._serverRunSessionEnded = (d, routeState) => {   // 复刻修复前的终态列表
    if (d && d.playable === false) return true
    const status = String((routeState && routeState.status) || '').toUpperCase()
    return ['ENDED', 'CANCELLED', 'EXPIRED', 'UNAVAILABLE', 'WITHDRAWN', 'CONFIG_WITHDRAWN'].indexOf(status) >= 0
  }
  await loadNodes(page, {
    routeState: {
      routeMode: 'BRANCH_GRAPH',
      status: 'COMPLETED',
      nodeStates: { 1: 'COMPLETED', 2: 'DISCOVERED_LOCKED' },
    },
    nodes: [
      { nodeId: 1, name: '第一站', latitude: 31.21, longitude: 121.46, done: false },
      { nodeId: 2, name: '第二站', latitude: 31.22, longitude: 121.47, done: false },
    ],
  })
  assert.equal(page.data.runState, 'paused', '负控:守卫摘掉后必须真的能复现 R1 症状')
})

// ===== 负控:把修复摘掉,上面这些判据必须真的判红 =====
test('R9-21 负控:摘掉恢复入口,重进必须复现原症状(idle)', async () => {
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 1 }

  const page = loadPage()
  page.data.topicId = '31'
  page._restoreRunSession = () => false   // 复刻修复前的行为
  await loadNodes(page, { nodes: NODES })
  assert.equal(page.data.runState, 'idle', '判据必须挂在恢复入口上,不然是假绿')
})

test('R9-21 负控:离页不落盘,重进就恢复不了(落盘是恢复的唯一来源)', async () => {
  const first = startRun(loadPage(), '31')
  nowMs = 9000
  first._persistRunSession = () => false
  first.onUnload()

  const second = loadPage()
  second.data.topicId = '31'
  await loadNodes(second, { nodes: NODES })
  assert.equal(second.data.runState, 'idle', '判据必须依赖真实落盘,不能靠页面内存幸存')
})
