const { test } = require('node:test')
const assert = require('node:assert/strict')

const { createGameSessionClient } = require('../../utils/game-session-client.js')

function requestHarness() {
  const calls = []
  return {
    calls,
    sendRequest(options) {
      calls.push(options)
      return { abort() {} }
    },
  }
}

function commandInput(overrides) {
  return Object.assign({
    activityId: 71,
    nodeId: 8,
    requestId: 'req-merchant-71-ready',
    expectedRevision: 4,
    action: 'STATION_READY',
    payload: { capacity: 12 },
  }, overrides || {})
}

function clubRecap(overrides) {
  return Object.assign({
    schemaVersion: 'GAME_RECAP_V1',
    generatedAt: '2026-08-23 18:30:45',
    metrics: [
      { key: 'PAID_PLAYERS', label: '付费玩家', value: 24, unit: '人' },
      { key: 'NORMAL_COMPLETERS', label: '正常完成', value: 16, unit: '人' },
    ],
    funnel: {
      paidPlayers: 24, arrivedPlayers: 22, taskSubmitters: 20,
      normalCompleters: 16, fallbackCompleters: 2, finishedTeams: 6,
    },
    hints: { level1Uses: 5, level2Uses: 2, answerReveals: 1 },
    incidents: { merchantPauseEvents: 2, merchantFallbackCompletions: 2, playerRejectedSubmissions: 3 },
    collaboration: { eligibleTeams: 8, completedTeams: 6, ratePercent: 75 },
    takeovers: { count: 1 },
    stations: [{
      nodeId: 8, nodeName: '老码头补给站', arrivedPlayers: 18, submissionCount: 15,
      normalCompletedCount: 10, fallbackCompletedCount: 1, rejectedCount: 2, pauseEventCount: 2,
    }],
    exportAvailable: true,
  }, overrides || {})
}

test('loadProjection 只把活动与服务端视角投给统一 view 端点', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })

  const pending = client.loadProjection('merchant', 71)
  assert.equal(harness.calls.length, 1)
  assert.deepEqual({
    url: harness.calls[0].url,
    method: harness.calls[0].method,
    data: harness.calls[0].data,
  }, {
    url: '/api/game/session/view',
    method: 'GET',
    data: { activityId: 71, perspective: 'MERCHANT' },
  })

  harness.calls[0].success({
    code: 200,
    data: { sessionId: 91, activityId: 71, perspective: 'MERCHANT', status: 'RUNNING', revision: 4 },
  })
  assert.deepEqual(await pending, {
    status: 'ready',
    data: { sessionId: 91, activityId: 71, perspective: 'MERCHANT', status: 'RUNNING', revision: 4 },
  })
})

test('loadMerchantEntries 只读取服务端按当前登录商家派生的活动站点入口', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })

  const pending = client.loadMerchantEntries()
  assert.deepEqual({
    url: harness.calls[0].url,
    method: harness.calls[0].method,
    data: harness.calls[0].data,
  }, {
    url: '/api/game/session/merchant/entries',
    method: 'GET',
    data: undefined,
  })
  harness.calls[0].success({
    code: 200,
    data: [{
      activityId: 71, topicId: 88, activityName: '商圈谜案季',
      startAt: '2026-08-23 10:00:00', endAt: '2026-08-23 18:00:00', stationCount: 2,
      merchantMemberId: 3001, moduleConfigSnapshotJson: '不得透传',
    }],
  })

  assert.deepEqual(await pending, {
    status: 'ready',
    data: [{
      activityId: 71, topicId: 88, activityName: '商圈谜案季',
      startAt: '2026-08-23 10:00:00', endAt: '2026-08-23 18:00:00', stationCount: 2,
    }],
  })
})

test('loadMerchantEntries 对畸形行与网络失败 fail closed', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })
  const invalid = client.loadMerchantEntries()
  harness.calls[0].success({ code: 200, data: [{ activityId: 0, topicId: 88, stationCount: 1 }] })
  assert.equal((await invalid).status, 'business-error')

  const network = client.loadMerchantEntries()
  harness.calls[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal((await network).status, 'network-error')
})

test('loadClubRecapExport 只读取 owner 安全聚合导出并严格净化敏感字段', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })
  const pending = client.loadClubRecapExport(701)
  assert.deepEqual({
    url: harness.calls[0].url,
    method: harness.calls[0].method,
    data: harness.calls[0].data,
  }, {
    url: '/api/game/session/recap/export',
    method: 'GET',
    data: { activityId: 701 },
  })

  const rawRecap = clubRecap()
  rawRecap.phone = '13800000000'
  rawRecap.stations[0].memberId = 991
  rawRecap.stations[0].evidence = 'https://private.example/evidence.jpg'
  rawRecap.metrics[0].longitude = 121.5
  harness.calls[0].success({ code: 200, data: {
    schemaVersion: 'GAME_RECAP_EXPORT_V1',
    generatedAt: '2026-08-23 18:31:00',
    activityId: 701,
    sessionId: 9001,
    recap: rawRecap,
    memberName: '不得导出',
  } })
  const result = await pending
  assert.equal(result.status, 'ready')
  assert.equal(result.data.activityId, 701)
  assert.equal(result.data.recap.stations[0].nodeName, '老码头补给站')
  assert.doesNotMatch(JSON.stringify(result.data), /phone|longitude|latitude|evidence|photo|memberId|memberName/i)
})

test('loadClubRecapExport 对跨活动、错 schema、畸形 recap 和网络失败 fail closed', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })

  assert.equal((await client.loadClubRecapExport(0)).status, 'business-error')
  assert.equal(harness.calls.length, 0)

  const mismatched = client.loadClubRecapExport(701)
  harness.calls[0].success({ code: 200, data: {
    schemaVersion: 'GAME_RECAP_EXPORT_V1', generatedAt: '2026-08-23 18:31:00',
    activityId: 702, sessionId: 9001, recap: clubRecap(),
  } })
  assert.equal((await mismatched).status, 'business-error')

  const badSchema = client.loadClubRecapExport(701)
  harness.calls[1].success({ code: 200, data: {
    schemaVersion: 'GAME_RECAP_V1', generatedAt: '2026-08-23 18:31:00',
    activityId: 701, sessionId: 9001, recap: clubRecap(),
  } })
  assert.equal((await badSchema).status, 'business-error')

  const malformed = client.loadClubRecapExport(701)
  const badRecap = clubRecap()
  badRecap.collaboration.ratePercent = 101
  harness.calls[2].success({ code: 200, data: {
    schemaVersion: 'GAME_RECAP_EXPORT_V1', generatedAt: '2026-08-23 18:31:00',
    activityId: 701, sessionId: 9001, recap: badRecap,
  } })
  assert.equal((await malformed).status, 'business-error')

  const network = client.loadClubRecapExport(701)
  harness.calls[3].fail({ errMsg: 'request:fail timeout' })
  assert.equal((await network).status, 'network-error')
})

test('loadProjection 权威 sessionId 或 revision 缺失时 fail closed，不得把空值当 0', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })
  const withoutRevision = client.loadProjection('player', 71)
  harness.calls[0].success({
    code: 200, data: { sessionId: 91, activityId: 71, perspective: 'PLAYER', status: 'RUNNING' },
  })
  assert.equal((await withoutRevision).status, 'business-error')

  const withoutSession = client.loadProjection('merchant', 71)
  harness.calls[1].success({
    code: 200, data: { activityId: 71, perspective: 'MERCHANT', status: 'RUNNING', revision: 0 },
  })
  assert.equal((await withoutSession).status, 'business-error')
})

test('loadProjection 对非法视角与非法活动 fail closed，不能发无范围请求', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })

  assert.equal((await client.loadProjection('operator', 71)).status, 'business-error')
  assert.equal((await client.loadProjection('merchant', 0)).status, 'business-error')
  assert.equal(harness.calls.length, 0)
})

test('loadProjection 明确区分业务失败与网络失败，加载失败不冒充空态', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })

  const business = client.loadProjection('merchant', 71)
  harness.calls[0].success({
    code: 500,
    msg: '无权查看该站点',
    data: { reasonCode: 'GAME_FORBIDDEN_SCOPE', revision: 4 },
  })
  assert.deepEqual(await business, {
    status: 'business-error',
    message: '无权查看该站点',
    reasonCode: 'GAME_FORBIDDEN_SCOPE',
    revision: 4,
  })

  const network = client.loadProjection('merchant', 71)
  harness.calls[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal((await network).status, 'network-error')

  const http = client.loadProjection('merchant', 71)
  harness.calls[2].successStatusAbnormal({ msg: 'Bad Gateway' })
  assert.equal((await http).status, 'network-error')
})

test('submitAction 只发送服务端认可字段，客户端不得自报 actor/merchantId', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })
  const pending = client.submitAction('merchant', commandInput({
    actor: { memberId: 99 },
    merchantId: 300,
    clubId: 400,
    memberId: 99,
    extra: 'must-not-leak',
  }))

  assert.deepEqual({
    url: harness.calls[0].url,
    method: harness.calls[0].method,
    header: harness.calls[0].header,
    data: harness.calls[0].data,
  }, {
    url: '/api/game/session/command',
    method: 'POST',
    header: { 'content-type': 'application/json' },
    data: {
      activityId: 71,
      nodeId: 8,
      requestId: 'req-merchant-71-ready',
      expectedRevision: 4,
      action: 'STATION_READY',
      payload: { capacity: 12 },
    },
  })
  harness.calls[0].success({
    code: 200,
    data: {
      receiptId: 501, activityId: 71, requestId: 'req-merchant-71-ready',
      action: 'STATION_READY', outcome: 'APPLIED', revision: 5, replayed: false,
    },
  })
  assert.deepEqual(await pending, {
    status: 'success',
    requestId: 'req-merchant-71-ready',
    receipt: {
      receiptId: 501, activityId: 71, requestId: 'req-merchant-71-ready',
      action: 'STATION_READY', outcome: 'APPLIED', revision: 5, replayed: false,
    },
  })
})

test('submitAction 保留调用方 requestId，同一幂等键重试不生成第二 key', async () => {
  const harness = requestHarness()
  let generated = 0
  const client = createGameSessionClient({
    sendRequest: harness.sendRequest,
    makeRequestId() { generated += 1; return 'generated-' + generated },
  })
  const first = client.submitAction('merchant', commandInput())
  const second = client.submitAction('merchant', commandInput())
  assert.equal(harness.calls[0].data.requestId, 'req-merchant-71-ready')
  assert.equal(harness.calls[1].data.requestId, 'req-merchant-71-ready')
  assert.equal(generated, 0)
  harness.calls.forEach(call => call.fail({ errMsg: 'request:fail timeout' }))
  await Promise.all([first, second])
})

test('submitAction 空 revision 不得被 Number 冒充为 0', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })

  assert.equal((await client.submitAction('merchant', commandInput({ expectedRevision: null }))).status, 'business-error')
  assert.equal((await client.submitAction('merchant', commandInput({ expectedRevision: '' }))).status, 'business-error')
  assert.equal(harness.calls.length, 0)
})

test('submitAction 业务拒绝是确定失败；断网或不匹配回执必须进入 unknown', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })

  const forbidden = client.submitAction('merchant', commandInput())
  harness.calls[0].success({
    code: 500,
    msg: '无权操作该站点',
    data: { reasonCode: 'GAME_FORBIDDEN_SCOPE', revision: 7 },
  })
  assert.deepEqual(await forbidden, {
    status: 'business-error',
    requestId: 'req-merchant-71-ready',
    message: '无权操作该站点',
    reasonCode: 'GAME_FORBIDDEN_SCOPE',
    revision: 7,
  })

  const disconnected = client.submitAction('merchant', commandInput())
  harness.calls[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal((await disconnected).status, 'unknown')

  const mismatched = client.submitAction('merchant', commandInput())
  harness.calls[2].success({
    code: 200,
    data: { activityId: 71, requestId: 'another-request', outcome: 'APPLIED', revision: 5 },
  })
  assert.equal((await mismatched).status, 'unknown')

  const missingTerminalProof = client.submitAction('merchant', commandInput())
  harness.calls[3].success({
    code: 200,
    data: {
      activityId: 71, requestId: 'req-merchant-71-ready', action: 'STATION_READY',
      outcome: 'APPLIED', receiptId: null, revision: null,
    },
  })
  assert.equal((await missingTerminalProof).status, 'unknown')
})

test('readReceipt 只有 activityId/requestId 精确回显才算权威匹配', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })
  const matched = client.readReceipt(71, 'req-merchant-71-ready')
  assert.deepEqual({
    url: harness.calls[0].url,
    method: harness.calls[0].method,
    data: harness.calls[0].data,
  }, {
    url: '/api/game/session/receipt',
    method: 'GET',
    data: { activityId: 71, requestId: 'req-merchant-71-ready' },
  })
  harness.calls[0].success({
    code: 200,
    data: {
      receiptId: 501, activityId: 71, requestId: 'req-merchant-71-ready',
      action: 'STATION_READY', outcome: 'APPLIED', revision: 5,
    },
  })
  assert.equal((await matched).status, 'matched')

  const wrong = client.readReceipt(71, 'req-merchant-71-ready')
  harness.calls[1].success({
    code: 200,
    data: { activityId: 72, requestId: 'req-merchant-71-ready', outcome: 'APPLIED' },
  })
  assert.equal((await wrong).status, 'invalid-response')
})

test('readReceipt 未确认与读取失败都不能伪装成 matched', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })

  const pending = client.readReceipt(71, 'req-merchant-71-ready')
  harness.calls[0].success({
    code: 200,
    msg: '操作成功',
    data: {
      receiptId: null, activityId: 71, requestId: 'req-merchant-71-ready',
      action: null, outcome: 'PENDING', reasonCode: null, revision: null,
      replayed: false, result: null,
    },
  })
  assert.equal((await pending).status, 'pending')

  const incomplete = client.readReceipt(71, 'req-merchant-71-ready')
  harness.calls[1].success({
    code: 200,
    data: {
      receiptId: null, activityId: 71, requestId: 'req-merchant-71-ready',
      action: 'STATION_READY', outcome: 'APPLIED', revision: null,
    },
  })
  assert.equal((await incomplete).status, 'invalid-response')

  const network = client.readReceipt(71, 'req-merchant-71-ready')
  harness.calls[2].successStatusAbnormal({ msg: 'gateway timeout' })
  assert.equal((await network).status, 'network-error')
})

test('readReceipt 保留权威 FAILED 原因并归一为可解锁的 business-error', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })

  const pending = client.readReceipt(71, 'req-merchant-71-ready')
  const receipt = {
    receiptId: 501, activityId: 71, requestId: 'req-merchant-71-ready',
    action: 'STATION_READY', outcome: 'FAILED', reasonCode: 'GAME_STATE_CONFLICT',
    revision: 7, replayed: true, result: { reason: '客户端版本已过期，请刷新后重试' },
  }
  harness.calls[0].success({ code: 200, data: receipt })

  assert.deepEqual(await pending, {
    status: 'business-error',
    requestId: 'req-merchant-71-ready',
    message: '客户端版本已过期，请刷新后重试',
    reasonCode: 'GAME_STATE_CONFLICT',
    reason: '客户端版本已过期，请刷新后重试',
    revision: 7,
    receipt,
  })

  const longReason = '本场状态已由其他工作人员更新，' + '请刷新页面后核对最新站点状态再重试。'.repeat(4)
  const longPending = client.readReceipt(71, 'req-merchant-71-ready')
  const longReceipt = Object.assign({}, receipt, {
    receiptId: 502,
    result: { reason: longReason },
  })
  harness.calls[1].success({ code: 200, data: longReceipt })
  const longFailure = await longPending
  assert.equal(longFailure.reason, longReason)
  assert.equal(longFailure.message, longReason)
})

test('submitAction 用同一 requestId 重放读到 FAILED 时是确定业务失败而非 unknown', async () => {
  const harness = requestHarness()
  const client = createGameSessionClient({ sendRequest: harness.sendRequest })
  const pending = client.submitAction('merchant', commandInput())
  const receipt = {
    receiptId: 501, activityId: 71, requestId: 'req-merchant-71-ready',
    action: 'STATION_READY', outcome: 'FAILED', reasonCode: 'GAME_STATE_CONFLICT',
    revision: 7, replayed: true, result: { reason: '客户端版本已过期，请刷新后重试' },
  }
  harness.calls[0].success({ code: 200, data: receipt })

  assert.deepEqual(await pending, {
    status: 'business-error',
    requestId: 'req-merchant-71-ready',
    message: '客户端版本已过期，请刷新后重试',
    reasonCode: 'GAME_STATE_CONFLICT',
    reason: '客户端版本已过期，请刷新后重试',
    revision: 7,
    receipt,
  })
})
