'use strict'

// 第二轮拍板 22:游戏进度跨设备续玩。
// 原症状:暂停快照只在本机(utils/play-run-session.js),换手机登录同账号进同一场 = idle 从头来。
// 现在:离页/暂停双写服务端 /api/play/run-session;本机没有或服务端更新时用服务端那份;
// 结束/通关/服务端判终态时本机与服务端一起清(否则另一台设备会把已结束的局恢复回来)。
const test = require('node:test')
const assert = require('node:assert/strict')
const runSession = require('../../pages/play/utils/play-run-session.js')

const PLAY_PAGE = '../../pages/play/index.js'
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

const realSetInterval = global.setInterval
const realClearInterval = global.clearInterval
const realDateNow = Date.now
global.setInterval = () => 1
global.clearInterval = () => {}
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
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(page.data, key, value))
    if (callback) callback()
  }
  return page
}

const flush = () => new Promise((resolve) => setImmediate(resolve))
const NODES = [{ nodeId: 1, name: '第一站', latitude: 31.21, longitude: 121.46, done: false }]
const find = (url, method) => requests.filter((r) => r.url === url && (!method || r.method === method))

async function loadNodes(page, data) {
  page.loadData(true)
  find('/api/play/nodes').pop().success({
    code: 200, data: Object.assign({ registered: true, topicId: 31, mode: 1 }, data),
  })
  await flush()
}

function answerServerRun(data) {
  const read = find('/api/play/run-session', 'GET').pop()
  assert.ok(read, '重进必须向服务端要一次进行中的会话')
  read.success({ code: 200, data })
  return flush()
}

test.beforeEach(() => {
  pageConfig = null
  requests = []
  storage = {}
  nowMs = 0
})

test('拍板22 换手机(本机没有快照)进同一场:从服务端恢复暂停态与已用时', async () => {
  const page = loadPage()
  page.data.activityId = '27'
  page.data.topicId = '31'
  await loadNodes(page, { nodes: NODES })
  assert.equal(page.data.runState, 'idle', '服务端还没回来之前不伪造恢复')
  assert.deepEqual(find('/api/play/run-session', 'GET').pop().data, { activityId: '27' })

  await answerServerRun({ activityId: 27, topicId: 31, runState: 'PAUSED', elapsedSeconds: 600, savedAt: 5000 })
  assert.equal(page.data.runState, 'paused', '换设备必须能接着上次暂停的那一局')
  assert.equal(page._sessionClock.elapsedSeconds(), 600)
  assert.equal(page._sessionClock.isPaused(), true, '恢复出来不偷跑')
  assert.deepEqual(storage['play_paused_run_v2:m9:a27'], { state: 'paused', elapsedSeconds: 600, savedAt: 5000 },
    '服务端那份落回本机,之后断网重进也能恢复')
})

test('拍板22 两台设备各有一份:取较晚落盘的那份', async () => {
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 1000 }
  const stale = loadPage()
  stale.data.topicId = '31'
  await loadNodes(stale, { nodes: NODES })
  assert.equal(stale._sessionClock.elapsedSeconds(), 42, '本机快照先同步恢复,不等网络')
  await answerServerRun({ runState: 'PAUSED', elapsedSeconds: 1200, savedAt: 9000 })
  assert.equal(stale._sessionClock.elapsedSeconds(), 1200, '另一台设备后来又玩了 20 分钟,不能被本机旧快照盖掉')

  requests = []
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 300, savedAt: 9999 }
  const fresh = loadPage()
  fresh.data.topicId = '31'
  await loadNodes(fresh, { nodes: NODES })
  await answerServerRun({ runState: 'PAUSED', elapsedSeconds: 60, savedAt: 10 })
  assert.equal(fresh._sessionClock.elapsedSeconds(), 300, '服务端那份更旧时保留本机的')
})

test('拍板22 等服务端期间玩家已自己开了新局:不拿旧计时覆盖', async () => {
  const page = loadPage()
  page.data.topicId = '31'
  page.requestPlayLocation = () => {}
  await loadNodes(page, { nodes: NODES })
  page.onRunToggle()
  assert.equal(page.data.runState, 'running')
  await answerServerRun({ runState: 'PAUSED', elapsedSeconds: 600, savedAt: 5000 })
  assert.equal(page.data.runState, 'running')
  assert.notEqual(page._sessionClock.elapsedSeconds(), 600)
})

test('拍板22 服务端读失败(断网)不影响本机恢复,也不伪造', async () => {
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 1 }
  const page = loadPage()
  page.data.topicId = '31'
  await loadNodes(page, { nodes: NODES })
  find('/api/play/run-session', 'GET').pop().fail()
  await flush()
  assert.equal(page._sessionClock.elapsedSeconds(), 42)
})

test('拍板22 离页/暂停把已用时双写服务端(活动场次按 activityId)', async () => {
  const page = loadPage()
  page.data.activityId = '27'
  page.data.topicId = '31'
  page.data.total = 1
  page._runStarted = true
  page._ensureSessionClock()
  page._sessionClock.start()
  nowMs = 42000
  page.onUnload()
  await flush()
  const save = find('/api/play/run-session/save', 'POST').pop()
  assert.ok(save, '离页必须把会话写到服务端,否则换手机续不了')
  assert.deepEqual(save.data, { activityId: '27', elapsedSeconds: 42, savedAt: 42000 })
  assert.equal(storage['play_paused_run_v2:m9:a27'].elapsedSeconds, 42, '本机那份照写')
})

test('拍板22 结束/服务端判终态:服务端会话一起作废,另一台设备不能还魂', async () => {
  const page = loadPage()
  page.data.topicId = '31'
  page.data.total = 1
  page._runStarted = true
  page._ensureSessionClock()
  page._sessionClock.start()
  page.openFinish = () => {}
  nowMs = 7000
  page._finishRun()
  await flush()
  assert.deepEqual(find('/api/play/run-session/clear', 'POST').pop().data, { topicId: '31', savedAt: 7000 },
    '服务端留带结束时刻的墓碑')

  requests = []
  const ended = loadPage()
  ended.data.topicId = '31'
  await loadNodes(ended, { playable: false, timeNote: '本场已结束', nodes: NODES })
  await flush()
  assert.ok(find('/api/play/run-session/clear', 'POST').length, '时间窗关闭:服务端那份也要清')
  assert.equal(find('/api/play/run-session', 'GET').length, 0, '已结束的场不再去服务端找会话恢复')
  assert.equal(ended.data.runState, 'idle')
})

test('拍板22 负控:服务端没有会话(或读失败)时,新设备只能是 idle —— 服务端是跨设备的唯一来源', async () => {
  const page = loadPage()
  page.data.topicId = '31'
  await loadNodes(page, { nodes: NODES })
  await answerServerRun(null)
  assert.equal(page.data.runState, 'idle')
})

test('拍板22 另一台设备已结束(墓碑晚于本机快照):本机快照作废不还魂;墓碑更旧则保留本机', async () => {
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 1000 }
  const page = loadPage()
  page.data.topicId = '31'
  await loadNodes(page, { nodes: NODES })
  assert.equal(page.data.runState, 'paused')
  await answerServerRun({ runState: 'ENDED', elapsedSeconds: 0, savedAt: 2000 })
  assert.equal(page.data.runState, 'idle', '别的设备已经结束这一局,这台不能再停在暂停态')
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined)

  requests = []
  storage['play_paused_run_v2:m9:t31'] = { state: 'paused', elapsedSeconds: 42, savedAt: 3000 }
  const newer = loadPage()
  newer.data.topicId = '31'
  await loadNodes(newer, { nodes: NODES })
  await answerServerRun({ runState: 'ENDED', elapsedSeconds: 0, savedAt: 2000 })
  assert.equal(newer.data.runState, 'paused', '墓碑之后本机又开了新局并暂停,以本机为准')
})

test('拍板22 恢复读在途时本局被结束:迟到的旧会话不能把它拉回暂停', async () => {
  const page = loadPage()
  page.data.topicId = '31'
  page.data.total = 1
  page.openFinish = () => {}
  await loadNodes(page, { nodes: NODES })
  const read = find('/api/play/run-session', 'GET').pop()
  page._applyServerRunSessionEnd()
  read.success({ code: 200, data: { runState: 'PAUSED', elapsedSeconds: 600, savedAt: 5000 } })
  await flush()
  assert.equal(page.data.runState, 'idle')
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined, '旧会话不能写回本机')

  requests = []
  const gone = loadPage()
  gone.data.topicId = '31'
  await loadNodes(gone, { nodes: NODES })
  const late = find('/api/play/run-session', 'GET').pop()
  gone.onUnload()
  late.success({ code: 200, data: { runState: 'PAUSED', elapsedSeconds: 600, savedAt: 5000 } })
  await flush()
  assert.equal(storage['play_paused_run_v2:m9:t31'], undefined, '页面卸载后迟到的恢复不回写')
})

test('拍板22 同一页先暂停再结束:clear 等 save 回来才发,不会被迟到的 save 写回', async () => {
  const page = loadPage()
  page.data.topicId = '31'
  page.data.total = 1
  page._runStarted = true
  page._ensureSessionClock()
  page._sessionClock.start()
  page.openFinish = () => {}
  nowMs = 5000
  page.onHide()
  page._finishRun()
  await flush()
  assert.equal(find('/api/play/run-session/save', 'POST').length, 1)
  assert.equal(find('/api/play/run-session/clear', 'POST').length, 0, 'save 未回之前 clear 不发')
  find('/api/play/run-session/save', 'POST').pop().success({ code: 200 })
  await flush()
  assert.equal(find('/api/play/run-session/clear', 'POST').length, 1)
})

test('拍板22 服务端回包畸形不当成可恢复会话', async () => {
  const request = () => Promise.resolve({ code: 200, data: { runState: 'RUNNING', elapsedSeconds: 9, savedAt: 1 } })
  assert.deepEqual(await runSession.readServerPausedRun(request, { topicId: '31' }), { ok: true, endedAt: 0, record: null })
  const huge = () => Promise.resolve({ code: 200, data: { runState: 'PAUSED', elapsedSeconds: runSession.MAX_PAUSED_SECONDS + 1, savedAt: 1 } })
  assert.equal((await runSession.readServerPausedRun(huge, { topicId: '31' })).record, null)
  const failing = () => Promise.resolve({ code: 500, msg: 'x' })
  assert.deepEqual(await runSession.readServerPausedRun(failing, { topicId: '31' }), { ok: false, record: null })
  assert.equal(await runSession.saveServerPausedRun(() => Promise.resolve({ code: 200 }), {}, 1, 1), false, '没有作用域不发请求')
  assert.deepEqual(runSession.runSessionRequestScope({ activityId: '27', topicId: '31' }), { activityId: '27' })
  assert.equal(runSession.newerPausedRun(null, null), null)
})
