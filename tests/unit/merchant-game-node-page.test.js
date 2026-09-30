const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE_PATH = path.resolve(__dirname, '../../pages/merchant/game-node/index.js')

function flush() {
  return new Promise(resolve => setImmediate(resolve))
}

function activeView(status = 'ACTIVE') {
  return {
    sessionId: 90,
    activityId: 71,
    perspective: 'MERCHANT',
    status: 'RUNNING',
    revision: 4,
    currentChapterId: 3,
    availableActions: ['STATION_READY', 'STATION_PAUSE', 'STATION_RESUME', 'VERIFY_SUBMISSION'],
    merchant: {
      fallbackOptions: [{
        sourceNodeId: 8, planCode: 'DOCK_TO_CLOCK', planVersion: 2,
        nodeId: 9, nodeName: '旧钟楼备用站', playerMessage: '请前往旧钟楼继续任务',
      }],
      stations: [{
        stationId: 6,
        nodeId: 8,
        nodeName: '老码头补给站',
        stationCode: 'DOCK-08',
        status,
        revision: 4,
        preparationChecklist: [{ code: 'STAFF', label: '工作人员已到位', checked: status !== 'INVITED' }],
        playerTask: { taskCode: 'DOCK_CODE', prompt: '扫描柜台任务码', inputType: 'SCAN', verificationRequired: true },
        merchantInstruction: '只核对公开任务与核验编号',
        hiddenInfoReminder: '不要透露答案或其他角色线索',
        capacity: 12,
        serviceStartAt: '2026-08-23 10:00',
        serviceEndAt: '2026-08-23 18:00',
        serviceWindow: { start: '2026-08-23 10:00', end: '2026-08-23 18:00' },
        pauseReasonCode: status === 'PAUSED' ? 'CAPACITY' : null,
        pauseReason: status === 'PAUSED' ? '现场满员' : null,
        resumeEta: status === 'PAUSED' ? '2026-08-23 16:00' : null,
        fallbackNodeId: null,
        fallbackPlanCode: null,
        fallbackPlanVersion: null,
        pendingVerificationCount: 2,
        playable: status === 'ACTIVE',
        recap: {
          arrivedPlayers: 18, submissionCount: 15, approvedCount: 10, rejectedCount: 2,
          recordedCount: 3, normalCompletedCount: 10, fallbackCompletedCount: 1,
          pauseEventCount: 2, authorizedContentCount: 0, contentPolicy: 'NO_PUBLIC_CONTENT',
        },
      }],
    },
  }
}

function createPage(storage = {}, options = {}) {
  const requests = []
  const toastCalls = []
  let definition
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => '9',
    sendRequest(options) { requests.push(options); return { abort() {} } },
  }
  const wxStub = {
    getSystemInfoSync() { return { statusBarHeight: 20 } },
    showToast(value) { toastCalls.push(value) },
    showModal(value) { this._modal = value },
    showLoading() {},
    hideLoading() {},
    scanCode(options) { this._scanOptions = options },
    getStorageSync(key) { return storage[key] },
    setStorageSync(key, value) {
      if (options.storageWriteError) throw new Error('storage unavailable')
      storage[key] = value
    },
    removeStorageSync(key) { delete storage[key] },
    setNavigationBarColor() {},
    setBackgroundColor() {},
  }
  const old = { Page: global.Page, getApp: global.getApp, wx: global.wx }
  global.getApp = () => app
  global.wx = wxStub
  global.Page = value => { definition = value }
  delete require.cache[PAGE_PATH]
  require(PAGE_PATH)
  global.Page = old.Page

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return { page, requests, wxStub, storage, toastCalls }
}

test('页面只凭 activityId 读取 MERCHANT 投影，不接受 merchantId 自报范围', async () => {
  const { page, requests } = createPage()
  page.onLoad({ activityId: '71', merchantId: '999' })
  assert.equal(page.data.viewState, 'loading')
  assert.deepEqual(requests[0].data, { activityId: 71, perspective: 'MERCHANT' })
  assert.equal(requests[0].data.merchantId, undefined)

  requests[0].success({ code: 200, data: activeView() })
  await flush()
  assert.equal(page.data.viewState, 'ready')
  assert.equal(page.data.station.nodeName, '老码头补给站')
  assert.equal(page.data.station.playable, true)
  assert.equal(page.data.station.playerTask.prompt, '扫描柜台任务码')
  assert.equal(page.data.station.merchantInstruction, '只核对公开任务与核验编号')
  assert.equal(page.data.station.hiddenInfoReminder, '不要透露答案或其他角色线索')
})

test('loading/empty/business-error/network-error 四态互斥，加载失败绝不冒充空态', async () => {
  const business = createPage()
  business.page.onLoad({ activityId: '71' })
  business.requests[0].success({
    code: 500, msg: '无权查看该站点', data: { reasonCode: 'GAME_FORBIDDEN_SCOPE' },
  })
  await flush()
  assert.equal(business.page.data.viewState, 'business-error')
  assert.equal(business.page._errorReasonCode, 'GAME_FORBIDDEN_SCOPE')

  const network = createPage()
  network.page.onLoad({ activityId: '71' })
  network.requests[0].fail({ errMsg: 'request:fail timeout' })
  await flush()
  assert.equal(network.page.data.viewState, 'network-error')

  const empty = createPage()
  empty.page.onLoad({ activityId: '71' })
  const view = activeView()
  view.merchant.stations = []
  empty.requests[0].success({ code: 200, data: view })
  await flush()
  assert.equal(empty.page.data.viewState, 'empty')
})

test('unknown 写只持久化回执索引；PENDING/错回执都不能解锁，精确 APPLIED 才清理', async () => {
  const storage = {}
  const { page, requests } = createPage(storage)
  page.onLoad({ activityId: '71' })
  requests[0].success({ code: 200, data: activeView() })
  await flush()

  page.openPauseSheet()
  page.setData({ pauseDraft: {
    reasonCode: 'CAPACITY', reasonLabel: '现场满员', resumeDate: '2026-08-23', resumeTime: '16:00',
    fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2, fallbackNodeName: '旧钟楼备用站',
  } })
  assert.equal(page.submitPause(), true)
  const command = requests[1]
  assert.equal(command.url, '/api/game/session/command')
  assert.deepEqual(command.data.payload, {
    reasonCode: 'CAPACITY', reason: '现场满员', resumeEta: '2026-08-23 16:00',
    fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2,
  })
  command.fail({ errMsg: 'request:fail timeout' })
  await flush()
  assert.equal(page.data.writeState, 'unknown')
  const requestId = command.data.requestId
  const saved = Object.values(storage)[0]
  assert.deepEqual(saved, {
    activityId: 71,
    requestId,
    action: 'STATION_PAUSE',
    nodeId: 8,
    expectedRevision: 4,
  })
  assert.doesNotMatch(JSON.stringify(saved), /payload|command|submissionId|CAPACITY|现场满员|playerMessage/i,
    '本地明文只能保存回执索引，不得保存命令正文、原因或玩家通知')

  assert.equal(page.submitPause(), false, 'unknown 未权威回读前不得再次 POST')
  assert.equal(requests.length, 2)

  const restored = createPage(storage)
  restored.page.onLoad({ activityId: '71' })
  assert.equal(restored.page.data.writeState, 'unknown')
  assert.equal(restored.page._pendingWrite.requestId, requestId)
  assert.equal(restored.page._pendingWrite.command, null, '重启后不得从 storage 重构原命令')
  assert.equal(restored.page.submitPause(), false)

  restored.page.confirmUnknownWrite()
  restored.requests[1].success({
    code: 500, msg: '请先重新登录', data: { reasonCode: 'GAME_LOGIN_REQUIRED' },
  })
  await flush()
  assert.equal(restored.page.data.writeState, 'unknown', '没有终态 receipt 的业务错误不能证明原写入失败')
  assert.equal(restored.page._pendingWrite.requestId, requestId)
  assert.equal(Object.values(storage)[0].requestId, requestId)

  restored.page.confirmUnknownWrite()
  assert.deepEqual(restored.requests[2].data, { activityId: 71, requestId })
  restored.requests[2].success({
    code: 200,
    data: { receiptId: null, activityId: 71, requestId, action: null, outcome: 'PENDING', revision: null, replayed: false, result: null },
  })
  await flush()
  assert.equal(restored.page.data.writeState, 'unknown')
  assert.equal(restored.page.submitPause(), false)

  restored.page.confirmUnknownWrite()
  restored.requests[3].success({
    code: 200,
    data: { receiptId: 501, activityId: 71, requestId, action: 'STATION_READY', outcome: 'APPLIED', revision: 5, replayed: true, result: {} },
  })
  await flush()
  assert.equal(restored.page.data.writeState, 'unknown', '同 requestId 但 action 错误仍不是本次权威回执')
  assert.equal(Object.values(storage)[0].requestId, requestId)

  restored.page.confirmUnknownWrite()
  restored.requests[4].success({
    code: 200,
    data: { activityId: 71, requestId, action: 'STATION_PAUSE', outcome: 'BROKEN' },
  })
  await flush()
  assert.equal(restored.page.data.writeState, 'unknown', '200 但回执结构异常不等于明确业务失败，不能解除锁')
  assert.equal(Object.values(storage)[0].requestId, requestId)

  restored.page.confirmUnknownWrite()
  restored.requests[5].success({
    code: 200,
    data: { receiptId: 502, activityId: 71, requestId, action: 'STATION_PAUSE', outcome: 'APPLIED', revision: 5, replayed: true, result: {} },
  })
  await flush()
  assert.equal(restored.page.data.writeState, 'idle')
  assert.equal(restored.page.data.recentReceipts[0].requestId, requestId)
  assert.equal(Object.keys(storage).length, 0)
  assert.equal(restored.requests[6].url, '/api/game/session/view', '确认后从服务端重新加载投影，不在本地猜状态')
})

test('内存态可用原命令精确重试；重进后只准按索引读回执，不重构 payload 或自动重发', async () => {
  const storage = {}
  const original = createPage(storage)
  original.page.onLoad({ activityId: '71' })
  original.requests[0].success({ code: 200, data: activeView() })
  await flush()
  original.page.openPauseSheet()
  original.page.setData({ pauseDraft: {
    reasonCode: 'CAPACITY', reasonLabel: '不会进入命令', resumeDate: '2026-08-23', resumeTime: '16:00',
    fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2, fallbackNodeName: '旧钟楼备用站',
  } })
  assert.equal(original.page.submitPause(), true)
  const originalCommand = JSON.parse(JSON.stringify(original.requests[1].data))
  original.requests[1].fail({ errMsg: 'request:fail timeout' })
  await flush()

  assert.deepEqual(original.page._pendingWrite.command, originalCommand)
  assert.equal(original.page.retryUnknownWrite(), true)
  assert.equal(original.requests[2].method, 'POST')
  assert.deepEqual(original.requests[2].data, originalCommand)
  original.requests[2].success({
    code: 200,
    data: { receiptId: null, activityId: 71, requestId: originalCommand.requestId, action: originalCommand.action, outcome: 'PENDING', revision: null, replayed: true, result: null },
  })
  await flush()
  assert.equal(original.page.data.writeState, 'unknown')
  assert.deepEqual(original.page._pendingWrite.command, originalCommand)

  const restored = createPage(storage)
  restored.page.onLoad({ activityId: '71' })
  assert.equal(restored.page.data.writeState, 'unknown')
  assert.equal(restored.page._pendingWrite.command, null)
  assert.equal(restored.page.retryUnknownWrite(), false, '重启后没有原命令内存态，禁止从索引伪造 POST')
  assert.equal(restored.requests.length, 1, '重进只允许页面投影读取，不能自动重发')

  assert.equal(restored.page.confirmUnknownWrite(), true)
  assert.equal(restored.requests[1].method, 'GET')
  assert.deepEqual(restored.requests[1].data, { activityId: 71, requestId: originalCommand.requestId })
  restored.requests[1].success({
    code: 200,
    data: { receiptId: 503, activityId: 71, requestId: originalCommand.requestId, action: originalCommand.action, outcome: 'APPLIED', revision: 5, replayed: true, result: {} },
  })
  await flush()
  assert.equal(restored.page.data.writeState, 'idle')
  assert.equal(restored.page._pendingWrite, null)
  assert.equal(Object.keys(storage).length, 0)
  assert.equal(restored.requests[2].url, '/api/game/session/view')
})

test('unknown 只有精确 FAILED 终态回执才能按失败解锁，错 action 继续保锁', async () => {
  const storage = {}
  const original = createPage(storage)
  original.page.onLoad({ activityId: '71' })
  original.requests[0].success({ code: 200, data: activeView() })
  await flush()
  original.page.openPauseSheet()
  original.page.setData({ pauseDraft: {
    reasonCode: 'CAPACITY', reasonLabel: '现场满员', resumeDate: '2026-08-23', resumeTime: '16:00',
    fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2, fallbackNodeName: '旧钟楼备用站',
  } })
  original.page.submitPause()
  const command = JSON.parse(JSON.stringify(original.requests[1].data))
  original.requests[1].fail({ errMsg: 'request:fail timeout' })
  await flush()

  const restored = createPage(storage)
  restored.page.onLoad({ activityId: '71' })
  restored.page.confirmUnknownWrite()
  restored.requests[1].success({ code: 200, data: {
    receiptId: 601, activityId: 71, requestId: command.requestId, action: 'STATION_READY',
    outcome: 'FAILED', reasonCode: 'GAME_STATE_CONFLICT', revision: 4, result: { reason: '状态已变化' },
  } })
  await flush()
  assert.equal(restored.page.data.writeState, 'unknown')
  assert.equal(restored.page._pendingWrite.command, null)
  assert.equal(restored.page._pendingWrite.receiptIndex.action, command.action)

  restored.page.confirmUnknownWrite()
  restored.requests[2].success({ code: 200, data: {
    receiptId: 602, activityId: 71, requestId: command.requestId, action: command.action,
    outcome: 'FAILED', reasonCode: 'GAME_STATE_CONFLICT', revision: 4, result: { reason: '状态已变化' },
  } })
  await flush()
  assert.equal(restored.page.data.writeState, 'idle')
  assert.equal(restored.page._pendingWrite, null)
  assert.equal(Object.keys(storage).length, 0)
})

test('初次提交也只有精确 FAILED 回执能按失败解锁，无回执业务错误继续保留原命令', async () => {
  const storage = {}
  const { page, requests } = createPage(storage)
  page.onLoad({ activityId: '71' })
  requests[0].success({ code: 200, data: activeView() })
  await flush()
  page.openPauseSheet()
  page.setData({ pauseDraft: {
    reasonCode: 'CAPACITY', reasonLabel: '现场满员', resumeDate: '2026-08-23', resumeTime: '16:00',
    fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2, fallbackNodeName: '旧钟楼备用站',
  } })
  page.submitPause()
  assert.equal(Object.keys(storage).length, 1)
  requests[1].success({
    code: 500, msg: '状态已变化，请刷新后重试', data: { reasonCode: 'GAME_STATE_CONFLICT', revision: 5 },
  })
  await flush()
  assert.equal(page.data.writeState, 'unknown')
  assert.equal(page._pendingWrite.requestId, requests[1].data.requestId)
  assert.deepEqual(page._pendingWrite.command, requests[1].data)
  assert.equal(Object.values(storage)[0].command, undefined)
  assert.doesNotMatch(JSON.stringify(Object.values(storage)[0]), /payload|CAPACITY|现场满员/i)

  const terminalStorage = {}
  const terminal = createPage(terminalStorage)
  terminal.page.onLoad({ activityId: '71' })
  terminal.requests[0].success({ code: 200, data: activeView() })
  await flush()
  terminal.page.openPauseSheet()
  terminal.page.setData({ pauseDraft: {
    reasonCode: 'CAPACITY', reasonLabel: '现场满员', resumeDate: '2026-08-23', resumeTime: '16:00',
    fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2, fallbackNodeName: '旧钟楼备用站',
  } })
  terminal.page.submitPause()
  const command = terminal.requests[1].data
  terminal.requests[1].success({ code: 200, data: {
    receiptId: 603, activityId: 71, requestId: command.requestId, action: command.action,
    outcome: 'FAILED', reasonCode: 'GAME_STATE_CONFLICT', revision: 4, result: { reason: '状态已变化' },
  } })
  await flush()
  assert.equal(terminal.page.data.writeState, 'idle')
  assert.equal(terminal.page._pendingWrite, null)
  assert.equal(Object.keys(terminalStorage).length, 0)
})

test('商家回执索引落盘失败时 fail closed，命令网络请求不得发出', async () => {
  const storage = {}
  const { page, requests, toastCalls } = createPage(storage, { storageWriteError: true })
  page.onLoad({ activityId: '71' })
  requests[0].success({ code: 200, data: activeView() })
  await flush()

  page.openPauseSheet()
  page.setData({ pauseDraft: {
    reasonCode: 'CAPACITY', reasonLabel: '现场满员', resumeDate: '2026-08-23', resumeTime: '16:00',
    fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2, fallbackNodeName: '旧钟楼备用站',
  } })
  assert.equal(page.submitPause(), false)

  assert.equal(requests.length, 1, '只允许既有投影 GET，不得发送命令 POST')
  assert.equal(page._pendingWrite, null)
  assert.equal(page.data.writeState, 'idle')
  assert.match(page.data.writeMessage, /无法安全保存/)
  assert.match(toastCalls[0].title, /无法安全保存/)
  assert.equal(Object.keys(storage).length, 0)
})

test('准备提交完整服务日期时间；扫码和手输共用正整数 submissionId 的 VERIFY_SUBMISSION', async () => {
  const ready = createPage()
  ready.page.onLoad({ activityId: '71' })
  ready.requests[0].success({ code: 200, data: activeView('ACCEPTED') })
  await flush()
  ready.page.setData({ readyDraft: {
    checklist: [{ code: 'STAFF', label: '工作人员已到位', checked: true }],
    capacity: '12', serviceDate: '2026-08-23', serviceStartTime: '10:00', serviceEndTime: '18:00', note: '',
  } })
  assert.equal(ready.page.submitReady(), true)
  assert.equal(ready.requests[1].data.payload.serviceStartAt, '2026-08-23 10:00')
  assert.equal(ready.requests[1].data.payload.serviceEndAt, '2026-08-23 18:00')
  ready.page.onUnload()

  const verify = createPage()
  verify.page.onLoad({ activityId: '71' })
  verify.requests[0].success({ code: 200, data: activeView() })
  await flush()
  verify.page.scanSubmission()
  verify.wxStub._scanOptions.success({ result: 'submission-300' })
  assert.equal(verify.page.data.verifySheetShow, false)
  verify.wxStub._scanOptions.success({ result: '300' })
  assert.equal(verify.page.data.verifySheetShow, true)
  assert.equal(verify.page.data.verifyDraft.submissionId, '300')
  assert.equal(verify.page.submitVerification(), true)
  assert.equal(verify.requests[1].data.action, 'VERIFY_SUBMISSION')
  assert.equal(verify.requests[1].data.payload.submissionId, '300')
  verify.page.onUnload()

  const manual = createPage()
  manual.page.onLoad({ activityId: '71' })
  manual.requests[0].success({ code: 200, data: activeView() })
  await flush()
  assert.equal(manual.page.openManualVerification(), true)
  manual.page.onSubmissionIdInput({ detail: { value: '301' } })
  assert.equal(manual.page.submitVerification(), true)
  assert.equal(manual.requests[1].data.action, 'VERIFY_SUBMISSION')
  assert.deepEqual(manual.requests[1].data.payload, { submissionId: '301', decision: 'APPROVE' })
  manual.page.onUnload()
})

test('暂停只能从服务端已审核方案中选择，不能提交或猜 nodeId', async () => {
  const { page, requests } = createPage()
  page.onLoad({ activityId: '71' })
  requests[0].success({ code: 200, data: activeView() })
  await flush()
  assert.deepEqual(page.data.fallbackOptions, [{
    sourceNodeId: 8, planCode: 'DOCK_TO_CLOCK', planVersion: 2,
    nodeId: 9, nodeName: '旧钟楼备用站', playerMessage: '请前往旧钟楼继续任务',
  }])
  page.openPauseSheet()
  page.onPauseReasonTap({ currentTarget: { dataset: { code: 'CAPACITY' } } })
  page.onResumeDateChange({ detail: { value: '2026-08-23' } })
  page.onResumeTimeChange({ detail: { value: '16:00' } })
  page.onFallbackChange({ detail: { value: '0' } })
  assert.equal(page.data.pauseDraft.fallbackPlanCode, 'DOCK_TO_CLOCK')
  assert.equal(page.data.pauseDraft.fallbackPlanVersion, 2)
  assert.equal(page.data.pauseDraft.fallbackNodeName, '旧钟楼备用站')
  assert.equal(page.submitPause(), true)
  assert.deepEqual(requests[1].data.payload, {
    reasonCode: 'CAPACITY', reason: '现场满员', resumeEta: '2026-08-23 16:00',
    fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2,
  })
  assert.equal(requests[1].data.payload.fallbackNodeId, undefined)
})

test('R9-38 没有已审核备用方案也能暂停：先确认，确认后才提交，且不夹带方案字段', async () => {
  const { page, requests, wxStub, toastCalls } = createPage()
  page.onLoad({ activityId: '71' })
  const view = activeView()
  view.merchant.fallbackOptions = []
  requests[0].success({ code: 200, data: view })
  await flush()
  assert.deepEqual(page.data.fallbackOptions, [])
  page.openPauseSheet()
  assert.equal(page.submitPause(), false, '缺原因/恢复时间仍 fail closed')
  assert.equal(requests.length, 1)
  assert.ok(toastCalls.length > 0)
  page.onPauseReasonTap({ currentTarget: { dataset: { code: 'STAFF' } } })
  page.onResumeDateChange({ detail: { value: '2026-08-23' } })
  page.onResumeTimeChange({ detail: { value: '16:00' } })
  assert.equal(page.submitPause(), true)
  assert.equal(requests.length, 1, '确认之前不得发请求')
  assert.match(wxStub._modal.content, /不会被引导到其他站点/)
  assert.match(wxStub._modal.content, /如需退款请联系平台客服/)
  wxStub._modal.success({ confirm: false, cancel: true })
  assert.equal(requests.length, 1, '取消不得发请求')
  page.submitPause()
  wxStub._modal.success({ confirm: true })
  assert.equal(requests.length, 2)
  assert.equal(requests[1].data.action, 'STATION_PAUSE')
  assert.deepEqual(requests[1].data.payload, {
    reasonCode: 'STAFF', reason: '人员暂时离岗', resumeEta: '2026-08-23 16:00',
  })
})

test('R9-38 暂停按钮只要求原因与恢复日期，不再要求备用方案', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/game-node/index.wxml'), 'utf8')
  const button = wxml.match(/<cy-btn[^>]*bindtap="submitPause"/)
  assert.ok(button, '确认暂停按钮必须存在')
  assert.doesNotMatch(button[0], /fallbackPlanCode/)
  assert.match(button[0], /pauseDraft\.reasonCode/)
  assert.match(button[0], /pauseDraft\.resumeDate/)
  assert.doesNotMatch(wxml, /请联系主办方后再暂停/)
})

test('本站复盘只展示服务端安全聚合，缺失或畸形明确待确认且不补 0', async () => {
  const ready = createPage()
  ready.page.onLoad({ activityId: '71' })
  ready.requests[0].success({ code: 200, data: activeView() })
  await flush()
  assert.equal(ready.page.data.recap.arrivedPlayers, 18)
  assert.equal(ready.page.data.recap.contentPolicy, 'NO_PUBLIC_CONTENT')
  assert.equal(ready.page.data.recap.memberId, undefined)

  const missing = createPage()
  missing.page.onLoad({ activityId: '71' })
  const missingView = activeView()
  delete missingView.merchant.stations[0].recap
  missing.requests[0].success({ code: 200, data: missingView })
  await flush()
  assert.equal(missing.page.data.recap, null)

  const malformed = createPage()
  malformed.page.onLoad({ activityId: '71' })
  const malformedView = activeView()
  malformedView.merchant.stations[0].recap.submissionCount = -1
  malformed.requests[0].success({ code: 200, data: malformedView })
  await flush()
  assert.equal(malformed.page.data.recap, null)
})

test('WXML 交付完整状态、准备、暂停、恢复、核验、回执与本站复盘入口', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/game-node/index.wxml'), 'utf8')
  const json = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/game-node/index.json'), 'utf8')
  ;[
    'viewState === \'loading\'',
    'viewState === \'empty\'',
    'viewState === \'business-error\'',
    'viewState === \'network-error\'',
    // 2026-09-07 对稿 469:1002:标题「本站执行卡」→「这一站怎么接待」(前者是内部叫法),
    // 三行顺序改成「你要做的 → 玩家会做什么 → 不能说的」,并补结尾那句「为什么不给你看剧情」。
    // 断言钉的性质没变:三段都在、且明确区分「我做什么 / 玩家做什么 / 不能说什么」。
    '这一站怎么接待', '你要做的', '玩家会做什么', '不能说的',
    '准备清单', '接待容量', '服务日期', '服务时段', '确认准备完成',
    '暂停接待', '预计恢复', '备用方案', '选择已审核的备用方案', '恢复接待',
    // R9-38(裁决 C):暂停期间不做自动免费退,退款去处必须在商家成功反馈里写明。
    '暂停期间如需退款请联系平台客服',
    '扫码核验', '输入核验编号', '出示打卡码', '最近操作', '本站复盘', '确认操作结果', '重试原操作',
  ].forEach(text => assert.match(wxml, new RegExp(text)))
  assert.ok(
    wxml.indexOf("writeState === 'unknown'") < wxml.indexOf("viewState === 'ready'"),
    '未知写回读入口必须独立于投影 ready 状态，加载失败时仍能确认回执',
  )
  assert.doesNotMatch(wxml, /[›✓]/, '箭头和勾选必须复用 cy-icon，不得用文本符号伪装')
  assert.doesNotMatch(wxml, /备用节点（选填）/, '暂停时必须显式指定备用节点')
  assert.doesNotMatch(wxml, /bindinput="onFallbackInput"/, '备用节点不得靠商家手填 nodeId')
  assert.match(wxml, /复盘数据待确认/)
  assert.match(wxml, /range="\{\{fallbackOptions\}\}"[^>]*range-key="nodeName"/)
  assert.match(wxml, /<cy-icon[^>]+name="arrow-right"/)
  assert.match(wxml, /<cy-icon[^>]+name="check"/)
  assert.match(json, /"cy-icon"\s*:\s*"\/components\/cy\/icon\/index"/)
  assert.match(json, /"cy-qr-voucher"\s*:\s*"\/components\/cy\/qr-voucher\/index"/)
})

test('ACTIVE 本站可出示一次性打卡码，倒计时结束前关闭会清定时器', async () => {
  const { page, requests } = createPage()
  page.onLoad({ activityId: '71' })
  requests[0].success({ code: 200, data: activeView() })
  await flush()

  assert.equal(page.showLiveCheckin(), true)
  assert.equal(page.data.checkinVisible, true)
  const issue = requests[1]
  assert.equal(issue.url, '/api/merchant/chapter-node/live-checkin-code')
  assert.equal(issue.method, 'POST')
  assert.deepEqual(issue.data, { nodeId: 8 })
  issue.success({
    code: 200,
    data: { code: 'v1.8.play_checkin.1.2.sig', qrcodeUrl: 'https://oss/live.png', ttlMs: 60000, nodeId: 8, nodeName: '老码头补给站' },
  })
  await flush()
  assert.equal(page.data.checkinQrState, 'ready')
  assert.equal(page.data.checkinQrUrl, 'https://oss/live.png')
  assert.equal(page.data.checkinCountdown, 60)
  page.closeLiveCheckin()
  assert.equal(page.data.checkinVisible, false)
  assert.equal(page._checkinTimer, null)
  page.onUnload()
})

test('未开放接待的站点不能出示打卡码', async () => {
  const { page, requests } = createPage()
  page.onLoad({ activityId: '71' })
  requests[0].success({ code: 200, data: activeView('INVITED') })
  await flush()
  assert.equal(page.showLiveCheckin(), false)
  assert.equal(page.data.checkinVisible, false)
  assert.equal(requests.length, 1)
})
