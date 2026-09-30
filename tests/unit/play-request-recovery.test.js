const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PLAY_PAGE = '../../pages/play/index.js'
const ROAM_PAGE = '../../pages/roam/index.js'
const PLAY_WXML = fs.readFileSync(path.join(__dirname, '../../pages/play/index.wxml'), 'utf8')
const ROAM_WXML = fs.readFileSync(path.join(__dirname, '../../pages/roam/index.wxml'), 'utf8')
// F13「首写前 key 持久化」要求的 32 位十六进制会话关联(validRecovery 只认这个形状或精确 sid)。
// ⚠️ 这里刻意用重复段拼出低熵值:原来那个随机形状的 32 位 hex 被 gitleaks 的
// generic-api-key 规则按熵值判成疑似密钥(2026-09-16 在 master 上实测 leaks found: 1,
// 连带把 Deploy 挡成 skipped)。形状约束是「32 位十六进制」,与熵无关,所以降熵不削弱契约;
// 也不要改成写进 .gitleaksignore —— 那是让闸变瞎,不是把问题解决掉。
const F13_KEY = 'abcdef01'.repeat(4)

let pageConfig
let requests
let storage

global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  // F13 恢复链的所有权归属判据(_recoveryOwnerCurrent)依赖真实 getApp().getUserID(app.js 恒提供)。
  getUserID: () => '9',
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync: (key, value) => { storage[key] = JSON.parse(JSON.stringify(value)) },
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showLoading() {},
  hideLoading() {},
  showToast() {},
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  pageConfig = null
  requests = []
  storage = {}
  global.wx.showModal = ({ success }) => success && success({ confirm: true, content: '分享内容' })
})

function setByPath(target, path, value) {
  const parts = path.split('.')
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
    Object.entries(patch).forEach(([path, value]) => setByPath(page.data, path, value))
    if (callback) callback()
  }
  return page
}

test('游玩节点接口遇到携带 402 业务码的 HTTP 异常时仍进入失败恢复', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.activityId = 123

  page.loadData(true)
  assert.equal(requests.length, 1)
  assert.equal(typeof requests[0].successStatusAbnormal, 'function')

  requests[0].successStatusAbnormal({ code: 402, msg: 'bad gateway' })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(page.data.loading, false)
  assert.equal(page.data.emptyKind, 'error')
  assert.match(page.data.emptyTip, /bad gateway/)
})

test('游玩节点元素畸形时进入错误态，不在路线归一化中崩溃', async () => {
  const payloads = [
    { nodes: {} },
    { nodes: [null] },
  ]

  for (const payload of payloads) {
    requests = []
    const page = loadPage(PLAY_PAGE)
    page.data.activityId = 123
    page.loadData(true)
    requests[0].success({ code: 200, data: Object.assign({ registered: true }, payload) })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(page.data.loading, false)
    assert.equal(page.data.emptyKind, 'error')
  }
})

test('漫游结算接口遇到携带 200 业务码的 HTTP 异常时不能误报成功', async () => {
  const page = loadPage(ROAM_PAGE)
  page._pendingTiles = []
  page._foundRoamPois = {}
  page._roamSid = 88
  // F13: 首写前已有持久化的会话关联(页面正常生命周期由 _ensureRoamRecovery 落盘),
  // 缺它 _saveRoamRecovery 会失败并把请求挡在发送之前 —— 那是夹具缺前置,不是产品不恢复。
  page._clientSessionKey = F13_KEY

  const settling = page._postRoamFinish(1200)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/roam/finish')
  assert.equal(requests[0].data.sessionId, '88')
  assert.equal(typeof requests[0].successStatusAbnormal, 'function')

  requests[0].successStatusAbnormal({ code: 200, data: { totalXp: 999 }, msg: 'bad gateway' })

  assert.equal(await settling, false)
  assert.equal(page.data.finish.settleErr, 'unknown')
  assert.equal(page.data.finish.xpAwarded, undefined)
})

test('漫游报名卡和地图 POI 列表拒绝非数组及空元素', async () => {
  const page = loadPage(ROAM_PAGE)
  page._loadIntroTopics()
  requests[0].success({ code: '200', data: { rows: [null] } })
  assert.equal(page.data.introCards.some((card) => String(card.key).startsWith('reg-')), false)

  requests = []
  page._nearbyReady = Promise.resolve()
  page._pois = []
  page._seenSweepHistory = () => {}
  page._genIcons = () => Promise.resolve()
  page._syncGoal = () => {}
  page._resolveNearbyReady = () => {}
  page._fetchRoamPois({ lat: 31.2, lng: 121.4 })
  await new Promise((resolve) => setImmediate(resolve))
  requests[0].success({ code: '200', data: [null] })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.poiOffline, true)
  assert.deepEqual(page._pois, [])
})

test('漫游打卡 POST 收到 HTTP 异常时只提示核对，不留失败浮卡', async () => {
  const toasts = []
  global.wx.showToast = (value) => { toasts.push(value) }
  const page = loadPage(ROAM_PAGE)
  page._player = { lat: 31.2, lng: 121.4 }
  page._roamSid = 88

  const checking = page._sendCheckin({ regId: 33, name: '测试店' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/roam/shop/visit')
  requests[0].successStatusAbnormal({ code: 500, msg: 'gateway timeout' })

  assert.equal(await checking, false)
  assert.equal(page.data.visit.checkinOk, false)
  // 拍板 9-16「漫游打卡不存在失败态」:失败不保留卡,只收卡 + 一句提示(失败字段已删)。
  assert.equal(page.data.visit.active, false)
  assert.equal(page.data.visit.checkinErr, undefined)
  assert.equal(toasts.length, 1, '失败必须有一句可见提示,不许静默')
  assert.ok(String(toasts[0].title).length > 0)
})

test('一次性打卡码已用过时展示服务端文案，不塌成对不上这一站', async () => {
  const toasts = []
  global.wx.showToast = (value) => { toasts.push(value) }
  const page = loadPage(PLAY_PAGE)

  page.checkin(7, 'v1.77.play_checkin.1.2.sig')
  requests[0].success({ code: 500, msg: '这张码已用过' })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(toasts.length, 1)
  assert.equal(toasts[0].title, '这张码已用过')
  // 明确失败(服务端说得出原因)不该挂成「结果待核对」——那会把后续写全部拦死。
  assert.ok(!page._arrivalWriteUnknown, '明确失败不得进入待核对态')
})

test('5-3 注入③:/api/play/checkin 返回 500 时玩家看到明确错误', async () => {
  const toasts = []
  global.wx.showToast = (value) => { toasts.push(value) }
  const page = loadPage(PLAY_PAGE)

  page.checkin(7, 'SHOP-CODE')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/play/checkin')
  requests[0].successStatusAbnormal({ code: 500, msg: '核销服务暂不可用' })
  await new Promise((resolve) => setImmediate(resolve))

  // 2026-09-22 错误条随底部读数卡删除,可见性改由 toast 承担;盲重试的闸仍是 _arrivalWriteUnknown。
  assert.equal(toasts.length, 1, '500 不能只写日志或静默失败')
  assert.equal(page._arrivalWriteUnknown, true, 'HTTP 结果未知时必须禁止盲重试')
  assert.match(toasts[0].title, /核销服务暂不可用/)
  assert.match(toasts[0].title, /打卡结果待核对/)
})

test('答题 POST 遇到携带 200 业务码的 HTTP 异常时不完成也不开放盲重试', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.game = { nodeId: 7, vm: 1, feedback: '答案不对', reveal: '答案' }
  page.data.answerInput = '梧桐'
  page.data.wrongCount = 0
  let completed = false
  page.onComplete = () => { completed = true }

  page.submitGame()
  assert.equal(requests.length, 1)
  page.submitGame()
  assert.equal(requests.length, 1)
  requests[0].successStatusAbnormal({ code: 200, msg: 'upstream timeout' })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(completed, false)
  assert.equal(page.data.wrongCount, 0)
  assert.equal(page.data.gNetRetryable, false)
  assert.match(page.data.gNetErr, /upstream timeout/)

  page.submitGame()
  assert.equal(requests.length, 1)
})

test('偏好题整组提交在途防连点，并把服务端结果与待确认标签交给真实结果卡', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.topicId = 19
  page.data.game = { nodeId: 7, vm: 6 }
  page.data.preference = Object.assign({}, page.data.preference, {
    choices: { space: 'A' }, submitting: false,
  })

  page.submitPreference({ choices: page.data.preference.choices })
  page.submitPreference({ choices: page.data.preference.choices })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/play/preference/7/submit')
  assert.equal(requests[0].data.topicId, 19)
  assert.deepEqual(requests[0].data.choices, { space: 'A' })
  assert.match(requests[0].data.routeActionId, /^route-/)
  assert.equal(Number.isFinite(Number(requests[0].data.expectedRouteVersion)), true)

  requests[0].success({ code: 200, data: {
    evaluation: { resultCode: 'compact', title: '小空间先减负' },
    pendingTag: { id: 11, tagCode: 'space_constraints', tagValue: 'compact', status: 0 },
    progress: { firstTime: true },
  } })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(page.data.preference.submitting, false)
  assert.equal(page.data.preference.result.resultCode, 'compact')
  assert.equal(page.data.preference.pendingTag.status, 0)
  assert.equal(page.data.preference.progress.firstTime, true)
})

test('偏好题选项仅用内部 key 提交，不向玩家渲染内部代码', () => {
  assert.match(PLAY_WXML, /data-option="\{\{option\.key\}\}"/,
    '选项仍须绑定内部 key 供点击提交')
  assert.doesNotMatch(PLAY_WXML, />\s*\{\{option\.key\}\}\s*</,
    'compact/layered 等内部代码不得作为可见文本')
})

test('G4已确认标签可以在G5显式沿用；没有标签时仍保留现场替代题提交资格', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.activityId = 88
  page.data.game = { nodeId: 12, vm: 6 }
  page.data.preference = Object.assign({}, page.data.preference, {
    inheritedTags: [{ id: 9, tagCode: 'space_constraints', tagValue: 'compact', status: 1 }],
  })

  page.useInheritedPreference({ currentTarget: { dataset: { code: 'space_constraints' } } })
  assert.equal(requests[0].data.reuseTagCode, 'space_constraints')
  assert.deepEqual(requests[0].data.choices, {})

  requests[0].success({ code: 200, data: { evaluation: { resultCode: 'compact' } } })
  await new Promise((resolve) => setImmediate(resolve))
  requests = []
  page.setData({
    'preference.inheritedTags': [], 'preference.answerHere': true,
    'preference.result': null, 'preference.submitting': false,
    'preference.steps': [{ key: 'fallback', options: [{ key: 'A' }] }],
    'preference.stepIndex': 0, 'preference.choices': { fallback: 'A' },
  })
  page.nextPreferenceStep()
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].data.choices, { fallback: 'A' })
})

test('偏好题丢弃上一节点的迟到响应，不能覆盖当前节点', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.topicId = 19
  page.data.game = { nodeId: 7, vm: 6 }
  page.loadPreference({ nodeId: 7 })
  page.data.game = { nodeId: 8, vm: 6 }
  page.loadPreference({ nodeId: 8 })
  assert.equal(requests.length, 2)

  requests[0].success({ code: 200, data: { steps: [{ key: 'old' }] } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.preference.loading, true)
  assert.deepEqual(page.data.preference.steps, [])

  requests[1].success({ code: 200, data: { steps: [{ key: 'current' }] } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.preference.loading, false)
  assert.equal(page.data.preference.steps[0].key, 'current')
})

test('结果卡改错只提交服务端给出的标签档位并防重复写', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.preference = Object.assign({}, page.data.preference, {
    pendingTag: { id: 11, tagValue: 'compact', status: 0 },
    availableTagValues: ['compact', 'open'],
  })
  /* 2026-09-02:改错不再走 wx.showActionSheet(系统弹层已收编到 cy-option-sheet),
     所以断言改成「打开弹层 → 选第 2 项」这两步。防重复写那条闸(_preferenceTagWrite)
     仍然要在**选中**这一步生效 —— 连点两次只能发一次请求。 */
  page.correctPreferenceTag()
  assert.equal(page.data.tagSheetShow, true, '应当打开选项弹层而不是系统 ActionSheet')
  page.onTagSheetSelect({ detail: { index: 1 } })
  page.correctPreferenceTag()
  page.onTagSheetSelect({ detail: { index: 1 } })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/play/tag/11/correct')
  assert.deepEqual(requests[0].data, { tagValue: 'open' })

  requests[0].success({ code: 200, data: { id: 11, tagValue: 'open', status: 0 } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.preference.pendingTag.tagValue, 'open')
})

test('游玩页各写入口在途和 HTTP 结果未知时都不能重复 POST', async () => {
  const cases = [
    { name: '到达', invoke: (page) => page.arrive(7, 'arrive'), state: (page) => page._arrivalWriteUnknown },
    { name: '扫码', invoke: (page) => page.checkin(7, 'CODE', 'game'), state: (page) => page.data.gWriteUnknown },
    { name: '照片', invoke: (page) => page.submitPhoto(7, '/tmp/photo.jpg'), state: (page) => page.data.gWriteUnknown },
  ]

  for (const item of cases) {
    requests = []
    const page = loadPage(PLAY_PAGE)
    item.invoke(page)
    item.invoke(page)
    assert.equal(requests.length, 1, item.name + '在途时只能发一次')

    requests[0].successStatusAbnormal({ code: 500, msg: 'gateway timeout' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(item.state(page), true, item.name + '应进入待核对态')

    item.invoke(page)
    assert.equal(requests.length, 1, item.name + '待核对时不能重发')
  }
})

test('章节放行 HTTP 异常后先读回队伍进度，核对完成前不能再推进一章', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.activityId = 88
  page.data.lead = { exists: true, status: 2, isLeader: true, chapterName: '第一章' }
  page._startLeadPoll = () => {}

  page.loadTeamProgress()
  page.leadUnlock()
  page.leadUnlock()
  assert.equal(requests.length, 2)

  requests[1].successStatusAbnormal({ code: 500, msg: 'gateway timeout' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.leadUnlockChecking, true)
  assert.equal(requests.length, 3)
  assert.equal(requests[2].method, 'GET')

  requests[0].success({
    code: 200,
    data: { exists: true, status: 2, isLeader: true, chapterName: '第一章', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.leadUnlockChecking, true)

  page.leadUnlock()
  assert.equal(requests.length, 3)
  requests[2].success({
    code: 200,
    data: { exists: true, status: 2, isLeader: true, chapterName: '第二章', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.leadUnlockChecking, false)
  assert.equal(page.data.lead.chapterName, '第二章')
})

test('章节放行专用读回完成后忽略更早轮询的过期响应', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.activityId = 88
  page.data.lead = { exists: true, status: 2, isLeader: true, chapterName: '第一章' }
  page._startLeadPoll = () => {}

  page.loadTeamProgress()
  page.leadUnlock()
  requests[1].successStatusAbnormal({ code: 500, msg: 'gateway timeout' })
  await new Promise((resolve) => setImmediate(resolve))

  requests[2].success({
    code: 200,
    data: { exists: true, status: 2, isLeader: true, chapterName: '第二章', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))
  requests[0].success({
    code: 200,
    data: { exists: true, status: 2, isLeader: true, chapterName: '第一章', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(page.data.lead.chapterName, '第二章')
  assert.equal(page.data.leadUnlockChecking, false)
  page.leadUnlock()
  assert.equal(requests.length, 4, '核对后只能从第二章开始新的一次放行')
})

test('队伍轮询持续慢于轮询间隔时仍会落地尚未过期的响应', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.activityId = 88
  page.data.lead = { exists: true, status: 2, isLeader: true, chapterName: '第一章' }
  page._startLeadPoll = () => {}

  page.loadTeamProgress()
  page.loadTeamProgress()
  requests[0].success({
    code: 200,
    data: { exists: true, status: 2, isLeader: true, chapterName: '第二章', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.lead.chapterName, '第二章')

  page.loadTeamProgress()
  requests[1].success({
    code: 200,
    data: { exists: true, status: 2, isLeader: true, chapterName: '第三章', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.lead.chapterName, '第三章')

  requests[2].success({
    code: 200,
    data: { exists: true, status: 2, isLeader: true, chapterName: '第四章', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.lead.chapterName, '第四章')
})

test('F-39：首次权威轮询确认带领场时展示广播一次，同值轮询不重复', async () => {
  const page = loadPage(PLAY_PAGE)
  const messages = []
  page.data.activityId = 13
  page.data.lead = { exists: false }
  page._startLeadPoll = () => {}
  page.diegetic = (message) => messages.push(message)

  page.loadTeamProgress()
  requests[0].success({
    code: 200,
    data: { exists: true, status: 1, broadcast: '集合后准备出发', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(page.data.lead.exists, true)
  assert.deepEqual(messages, ['队长:集合后准备出发'])

  page.loadTeamProgress()
  requests[1].success({
    code: 200,
    data: { exists: true, status: 1, broadcast: '集合后准备出发', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(messages, ['队长:集合后准备出发'])
})

test('章节放行专用读回失败后可由重试读回解锁', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.activityId = 88
  page.data.lead = { exists: true, status: 2, isLeader: true, chapterName: '第一章' }
  page._startLeadPoll = () => {}

  page.leadUnlock()
  requests[0].successStatusAbnormal({ code: 500, msg: 'gateway timeout' })
  await new Promise((resolve) => setImmediate(resolve))
  requests[1].fail({ errMsg: 'network fail' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.leadUnlockChecking, true)

  page.retryLeadProgress()
  requests[2].success({
    code: 200,
    data: { exists: true, status: 2, isLeader: true, chapterName: '第二章', members: [] },
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(page.data.lead.chapterName, '第二章')
  assert.equal(page.data.leadUnlockChecking, false)
})

test('不相关节点的成功响应不能清除另一类待核对写锁', async () => {
  const page = loadPage(PLAY_PAGE)
  page.data.nodes = [
    { nodeId: 7, points: 12 },
    { nodeId: 8, points: 12 },
  ]
  page.data.game = { nodeId: 7, vm: 1, feedback: '答案不对', reveal: '答案' }
  page.data.answerInput = '梧桐'
  page.data.wrongCount = 0
  page.data.mode = 2
  page.data.nextNode = null
  page.stopNav = () => {}
  page.rebuild = () => {}
  page.buildJournal = () => {}

  page.submitGame()
  requests[0].successStatusAbnormal({ code: 500, msg: 'gateway timeout' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.gWriteUnknown, true)

  page.arrive(8, 'gps')
  requests[1].success({ code: 200, data: {} })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.data.gWriteUnknown, true)

  page.submitGame()
  assert.equal(requests.length, 2)
})

test('广场发帖 HTTP 异常后不能再次创建无幂等保护的公开帖子', async () => {
  const page = loadPage(ROAM_PAGE)
  page.data.share = { show: true, idx: 0 }
  page._roamSid = 9
  page._drawShareCard = () => Promise.resolve('/tmp/share.png')
  page._uploadOne = () => Promise.resolve('https://img.example/share.png')

  const posting = page._shareToSquare()
  await page._shareToSquare()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(requests.length, 1)
  requests[0].successStatusAbnormal({ code: 500, msg: 'gateway timeout' })
  assert.equal((await posting).ok, false)
  assert.equal(page.data.share.squarePostUnknown, true)

  await page._shareToSquare()
  assert.equal(requests.length, 1)
})

test('漫游地点确认在途时阻止快速双击并发', async () => {
  const page = loadPage(ROAM_PAGE)
  page._roamSid = 9
  page._player = { lat: 31.2, lng: 121.4 }
  page._pois = [{ id: 'poi-1', _roamId: 11, cat: 'landmark' }]

  page._discoverRoamPoiById('poi-1')
  page._discoverRoamPoiById('poi-1')
  assert.equal(requests.length, 1)

  requests[0].fail({ errMsg: 'network fail' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page._roamPoiDiscovering, false)
  assert.equal(page.data.paceCard.checkinRetryable, true)
  page._discoverRoamPoiById('poi-1')
  assert.equal(requests.length, 2)
})

test('漫游地点确认的 Promise reject 也会释放在途锁', async () => {
  const page = loadPage(ROAM_PAGE)
  page._roamSid = 9
  page._player = { lat: 31.2, lng: 121.4 }
  page._pois = [{ id: 'poi-1', _roamId: 11, cat: 'landmark' }]
  page._requestRoamPoiDiscover = () => Promise.reject(new Error('unexpected'))

  page._discoverRoamPoiById('poi-1')
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(page._roamPoiDiscovering, false)
  assert.equal(page.data.paceCard.checkinRetryable, true)
})

test('漫游地点确认在尚未建会话时不发请求且保留可重试状态', () => {
  const page = loadPage(ROAM_PAGE)
  page._roamSid = 0
  page._pois = [{ id: 'poi-1', _roamId: 11, cat: 'landmark' }]

  page._discoverRoamPoiById('poi-1')

  assert.equal(requests.length, 0)
  assert.equal(page.data.paceCard.checkinRetryable, true)
})

test('漫游首次建会话的揭雾结果未知时不能自动重放', async () => {
  const page = loadPage(ROAM_PAGE)
  page._pendingTiles = ['wtw3sjq']
  page._roamSid = 0
  // F13: 首次 reveal(sessionId=0)必须先有本机持久化的 clientSessionKey 才允许发;
  // 没有它产品会先走 _ensureRoamRecovery 生成 key(异步),这里直接给已落盘的 key 复现首写路径。
  page._clientSessionKey = F13_KEY

  page._flushReveal()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/roam/reveal')
  assert.equal(requests[0].data.sessionId, '0')
  assert.equal(requests[0].data.clientSessionKey, F13_KEY)
  requests[0].successStatusAbnormal({ code: 500, msg: 'gateway timeout' })
  await new Promise((resolve) => setImmediate(resolve))

  page._flushReveal()
  assert.equal(requests.length, 1)
  assert.equal(page.data.revealWriteUnknown, true)
})

test('漫游模板只在结果确定可重试时显示写请求重试入口', () => {
  assert.match(PLAY_WXML, /gWriteUnknown/)
  // 2026-09-22 到达写失败的重试条长在底部读数卡上,随地图层删除后改走全局 toast。
  // 这条断言换成钉死「失败仍然说得出话」——静默失败是本文件要防的第一件事。
  const playJs = fs.readFileSync(path.join(__dirname, '../../pages/play/index.js'), 'utf8')
  assert.match(playJs, /recordArrivalNetworkFailure\(message\)\s*\{[\s\S]{0,200}?cyToast\(message\)/,
    '到达/打卡写失败必须可见')
  assert.match(playJs, /recordArrivalHttpUnknown\(message\)\s*\{[\s\S]{0,400}?cyToast\(/,
    '结果未知必须可见:看不见它的人只会反复点')
  assert.doesNotMatch(playJs, /arrivalError/, '错误条已删,不得留下只写不读的错误态字段')
  assert.match(ROAM_WXML, /wx:if="\{\{paceCard\.checkinRetryable\}\}" bindtap="retryRoamPoiDiscover"/)
  // 拍板 9-16:探店打卡不存在失败态 —— 失败浮卡与重试入口已删除(人不在店内时按钮不可用只提示)。
  assert.doesNotMatch(ROAM_WXML, /visit\.checkinRetryable/)
  assert.doesNotMatch(ROAM_WXML, /retryCheckin/)
  // 结果未知/首写未知/恢复核对态:按钮文案与路由都必须是「核对结算结果」(retrySettle 只走权威回读);
  // 只有结果已确定(server/reveal 等)才允许露出写请求重发「重新结算」。
  assert.match(ROAM_WXML, /retry="\{\{finish\.settleErr === 'unknown' \|\| finish\.settleErr === 'bootstrap' \|\| finish\.settleErr === 'recovery' \? '核对结算结果' : '重新结算'\}\}"/)
  assert.match(ROAM_WXML, /retry="\{\{finish\.eventErr === 'unknown' \? '' : '重新上报'\}\}"/)
  assert.match(ROAM_WXML, /share\.squarePostUnknown/)
  assert.match(ROAM_WXML, /revealWriteUnknown/)
})

test('漫游结算重试按结果确定性路由:未知态只回读,确定失败才重发', () => {
  const page = loadPage(ROAM_PAGE)
  let recovered = 0
  let posted = 0
  page.recoverRoam = () => { recovered += 1; return Promise.resolve(false) }
  page._postRoamFinish = () => { posted += 1; return Promise.resolve(false) }

  for (const err of ['unknown', 'bootstrap', 'recovery']) {
    page._finishPromise = null
    page.data.finish = { settleErr: err }
    page.retrySettle()
    assert.equal(recovered, ['unknown', 'bootstrap', 'recovery'].indexOf(err) + 1, `${err} 必须走权威回读`)
    assert.equal(posted, 0, `${err} 不得走写请求重发`)
  }

  page._finishPromise = null
  page.data.finish = { settleErr: 'server' }
  page.retrySettle()
  assert.equal(posted, 1, '确定的失败才允许重新结算')
})
