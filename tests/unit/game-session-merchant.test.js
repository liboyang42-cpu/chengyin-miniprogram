const { test } = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeMerchantProjection,
  summarizeMerchantProjection,
  buildStationAcceptCommand,
  buildStationDeclineCommand,
  buildStationReadyCommand,
  buildStationPauseCommand,
  buildStationResumeCommand,
  buildVerifySubmissionCommand,
  sanitizeMerchantCommandForRetry,
  merchantGameCardState,
  decorateMerchantActivityCards,
  attachMerchantGameEntries,
} = require('../../pages/merchant/utils/game-session-merchant.js')

function merchantView(overrides) {
  return Object.assign({
    sessionId: 90,
    activityId: 71,
    perspective: 'MERCHANT',
    status: 'RUNNING',
    revision: 4,
    currentChapterId: 3,
    availableActions: ['STATION_ACCEPT', 'STATION_DECLINE', 'STATION_READY', 'STATION_PAUSE', 'STATION_RESUME', 'VERIFY_SUBMISSION'],
    merchant: {
      fallbackOptions: [{
        sourceNodeId: 8,
        planCode: 'DOCK_TO_CLOCK',
        planVersion: 2,
        nodeId: 9,
        nodeName: '旧钟楼备用站',
        playerMessage: '请前往旧钟楼继续任务',
      }],
      stations: [{
        stationId: 6,
        nodeId: 8,
        nodeName: '老码头补给站',
        stationCode: 'DOCK-08',
        status: 'ACTIVE',
        revision: 4,
        preparationChecklist: [
          { code: 'STAFF', label: '工作人员已到位', checked: true },
          { code: 'PROP', label: '任务道具已备齐', checked: true },
        ],
        playerTask: {
          taskCode: 'DOCK_CODE', prompt: '扫描柜台上的本站任务码', inputType: 'SCAN',
          verificationRequired: true, expectedToken: '不能下发',
        },
        merchantInstruction: '只核对玩家出示的编号与现场任务完成情况',
        hiddenInfoReminder: '不要透露其他角色线索或后台答案',
        capacity: 12,
        serviceStartAt: '2026-08-23 10:00',
        serviceEndAt: '2026-08-23 18:00',
        serviceWindow: { start: '2026-08-23 10:00', end: '2026-08-23 18:00' },
        pauseReasonCode: null,
        pauseReason: null,
        resumeEta: null,
        fallbackNodeId: null,
        fallbackPlanCode: null,
        fallbackPlanVersion: null,
        pendingVerificationCount: 2,
        playable: true,
        recap: {
          arrivedPlayers: 18,
          submissionCount: 15,
          approvedCount: 10,
          rejectedCount: 2,
          recordedCount: 3,
          normalCompletedCount: 10,
          fallbackCompletedCount: 1,
          pauseEventCount: 2,
          authorizedContentCount: 0,
          contentPolicy: 'NO_PUBLIC_CONTENT',
          phone: '13800000000',
        },
        answer: '不能下发给页面',
      }],
    },
    player: { role: { secret: '不能透传' } },
  }, overrides || {})
}

test('商家投影只保留本站运行字段，并从服务端动作白名单派生按钮', () => {
  const projection = normalizeMerchantProjection(merchantView())
  assert.equal(projection.enabled, true)
  assert.equal(projection.stations.length, 1)
  assert.deepEqual(projection.fallbackOptions, [{
    sourceNodeId: 8,
    planCode: 'DOCK_TO_CLOCK',
    planVersion: 2,
    nodeId: 9,
    nodeName: '旧钟楼备用站',
    playerMessage: '请前往旧钟楼继续任务',
  }])
  assert.deepEqual(projection.stations[0], {
    stationId: 6,
    nodeId: 8,
    nodeName: '老码头补给站',
    stationCode: 'DOCK-08',
    status: 'ACTIVE',
    revision: 4,
    preparationChecklist: [
      { code: 'STAFF', label: '工作人员已到位', checked: true },
      { code: 'PROP', label: '任务道具已备齐', checked: true },
    ],
    playerTask: {
      taskCode: 'DOCK_CODE', prompt: '扫描柜台上的本站任务码', inputType: 'SCAN', verificationRequired: true,
    },
    merchantInstruction: '只核对玩家出示的编号与现场任务完成情况',
    hiddenInfoReminder: '不要透露其他角色线索或后台答案',
    capacity: 12,
    serviceStartAt: '2026-08-23 10:00',
    serviceEndAt: '2026-08-23 18:00',
    serviceWindow: { start: '2026-08-23 10:00', end: '2026-08-23 18:00' },
    pauseReasonCode: '',
    pauseReason: '',
    resumeEta: '',
    fallbackNodeId: null,
    fallbackPlanCode: '',
    fallbackPlanVersion: null,
    pendingVerificationCount: 2,
    recap: {
      arrivedPlayers: 18,
      submissionCount: 15,
      approvedCount: 10,
      rejectedCount: 2,
      recordedCount: 3,
      normalCompletedCount: 10,
      fallbackCompletedCount: 1,
      pauseEventCount: 2,
      authorizedContentCount: 0,
      contentPolicy: 'NO_PUBLIC_CONTENT',
    },
    playable: true,
    statusText: '运行中',
    canAccept: false,
    canDecline: false,
    canReady: false,
    canPause: true,
    canResume: false,
    canVerify: true,
  })
  assert.equal(projection.stations[0].answer, undefined)
  assert.equal(projection.stations[0].playerTask.expectedToken, undefined)
  assert.equal(projection.stations[0].recap.phone, undefined)
  assert.equal(projection.player, undefined)
})

test('PAUSED 站点即使脏数据 playable=true 也必须不可接待、不可核验', () => {
  const raw = merchantView()
  raw.merchant.stations[0].status = 'PAUSED'
  raw.merchant.stations[0].playable = true
  raw.merchant.stations[0].pauseReasonCode = 'CAPACITY'
  raw.merchant.stations[0].pauseReason = '现场满员'
  const station = normalizeMerchantProjection(raw).stations[0]

  assert.equal(station.playable, false)
  assert.equal(station.statusText, '已暂停')
  assert.equal(station.canPause, false)
  assert.equal(station.canVerify, false)
  assert.equal(station.canResume, true)
  assert.deepEqual(summarizeMerchantProjection(normalizeMerchantProjection(raw)), {
    state: 'paused',
    text: '本站已暂停',
    tone: 'paused',
    pendingVerificationCount: 2,
    stationCount: 1,
  })
})

test('ACTIVE 的容量或服务时间配置失效时也不能相信脏 playable=true', () => {
  const raw = merchantView()
  raw.merchant.stations[0].capacity = 0
  raw.merchant.stations[0].playable = true
  const station = normalizeMerchantProjection(raw).stations[0]
  assert.equal(station.playable, false)
  assert.equal(station.canVerify, false)
})

test('错视角、缺商家字段、未知站点状态都 fail closed，不能冒充空站点', () => {
  assert.deepEqual(normalizeMerchantProjection(null), { enabled: false, reason: 'EMPTY' })
  assert.equal(normalizeMerchantProjection(merchantView({ perspective: 'PLAYER' })).reason, 'FORBIDDEN_PROJECTION')
  assert.equal(normalizeMerchantProjection(merchantView({ merchant: null })).reason, 'INVALID_MERCHANT_VIEW')

  const missingRevision = merchantView()
  missingRevision.revision = null
  assert.equal(normalizeMerchantProjection(missingRevision).reason, 'INVALID_SESSION')

  const missingPendingCount = merchantView()
  missingPendingCount.merchant.stations[0].pendingVerificationCount = null
  assert.equal(normalizeMerchantProjection(missingPendingCount).reason, 'INVALID_STATION')

  const raw = merchantView()
  raw.merchant.stations[0].status = 'MYSTERY'
  assert.equal(normalizeMerchantProjection(raw).reason, 'INVALID_STATION')

  const badTask = merchantView()
  badTask.merchant.stations[0].playerTask.inputType = 'BUTTON_ONLY'
  assert.equal(normalizeMerchantProjection(badTask).reason, 'INVALID_STATION')

  const badFallback = merchantView()
  badFallback.merchant.fallbackOptions = [{
    sourceNodeId: 8, planCode: 'DOCK_TO_CLOCK', planVersion: 2,
    nodeId: 9, nodeName: '', playerMessage: '请前往旧钟楼',
  }]
  assert.equal(normalizeMerchantProjection(badFallback).reason, 'INVALID_FALLBACK_OPTIONS')
})

test('商家复盘缺失或畸形时仅标记待确认，不会补零或泄露敏感明细', () => {
  const missing = merchantView()
  delete missing.merchant.stations[0].recap
  assert.equal(normalizeMerchantProjection(missing).stations[0].recap, null)

  const malformed = merchantView()
  malformed.merchant.stations[0].recap.approvedCount = -1
  assert.equal(normalizeMerchantProjection(malformed).stations[0].recap, null)

  const wrongPolicy = merchantView()
  wrongPolicy.merchant.stations[0].recap.contentPolicy = 'PUBLIC_CONTENT'
  assert.equal(normalizeMerchantProjection(wrongPolicy).stations[0].recap, null)

  const contradictoryContent = merchantView()
  contradictoryContent.merchant.stations[0].recap.authorizedContentCount = 1
  assert.equal(normalizeMerchantProjection(contradictoryContent).stations[0].recap, null)
})

test('无 station 是服务端明确空态，和投影错误分开', () => {
  const projection = normalizeMerchantProjection(merchantView({ merchant: { stations: [] } }))
  assert.equal(projection.enabled, true)
  assert.deepEqual(summarizeMerchantProjection(projection), {
    state: 'empty', text: '暂无本站任务', tone: 'muted', pendingVerificationCount: 0, stationCount: 0,
  })
})

test('准备、暂停、恢复、核验命令只包含契约字段和当前 revision', () => {
  const invitedRaw = merchantView()
  invitedRaw.merchant.stations[0].status = 'ACCEPTED'
  invitedRaw.merchant.stations[0].playable = false
  const invited = normalizeMerchantProjection(invitedRaw)
  assert.deepEqual(buildStationReadyCommand(invited, invited.stations[0], {
    checklist: [{ code: 'STAFF', checked: true }, { code: 'PROP', checked: true }],
    capacity: 16,
    serviceStartAt: '2026-08-23 09:30',
    serviceEndAt: '2026-08-23 19:00',
    note: '已完成现场检查',
    actor: 99,
  }, 'merchant_ready_71_8'), {
    activityId: 71,
    nodeId: 8,
    requestId: 'merchant_ready_71_8',
    expectedRevision: 4,
    action: 'STATION_READY',
    payload: {
      checklist: [{ code: 'STAFF', checked: true }, { code: 'PROP', checked: true }],
      capacity: 16,
      serviceStartAt: '2026-08-23 09:30',
      serviceEndAt: '2026-08-23 19:00',
      note: '已完成现场检查',
    },
  })

  const active = normalizeMerchantProjection(merchantView())
  assert.deepEqual(buildStationPauseCommand(active, active.stations[0], {
    reasonCode: 'CAPACITY', reason: '现场满员', resumeEta: '2026-08-23 16:00',
    fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2,
  }, 'merchant_pause_71_8'), {
    activityId: 71,
    nodeId: 8,
    requestId: 'merchant_pause_71_8',
    expectedRevision: 4,
    action: 'STATION_PAUSE',
    payload: {
      reasonCode: 'CAPACITY', reason: '现场满员', resumeEta: '2026-08-23 16:00',
      fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2,
    },
  })
  // R9-38:备用方案选填。不带方案 = 只停本站;夹带的 fallbackNodeId 不得进 payload。
  assert.deepEqual(buildStationPauseCommand(active, active.stations[0], {
    reasonCode: 'CAPACITY', resumeEta: '2026-08-23 16:00', fallbackNodeId: 9,
  }, 'merchant_pause_71_no_fallback').payload, { reasonCode: 'CAPACITY', resumeEta: '2026-08-23 16:00' })
  // 带了方案的任一半就必须是服务端已审核的完整候选:半截、未审核、缺原因/恢复时间一律拒。
  ;[
    { fallbackPlanCode: 'DOCK_TO_CLOCK' },
    { fallbackPlanVersion: 2 },
    { fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 3 },
    { fallbackPlanCode: 'MADE_UP', fallbackPlanVersion: 2 },
  ].forEach((fallback) => assert.throws(() => buildStationPauseCommand(active, active.stations[0],
    Object.assign({ reasonCode: 'CAPACITY', resumeEta: '2026-08-23 16:00' }, fallback),
    'merchant_pause_71_bad_fallback'), /STATION_PAUSE_INPUT_INVALID/, JSON.stringify(fallback)))
  assert.throws(() => buildStationPauseCommand(active, active.stations[0], {
    reasonCode: 'CAPACITY',
  }, 'merchant_pause_71_no_eta'), /STATION_PAUSE_INPUT_INVALID/)
  assert.deepEqual(sanitizeMerchantCommandForRetry({
    activityId: 71, nodeId: 8, requestId: 'merchant_pause_71_8', expectedRevision: 4,
    action: 'STATION_PAUSE', payload: { reasonCode: 'CAPACITY', resumeEta: '2026-08-23 16:00' },
  }).payload, { reasonCode: 'CAPACITY', resumeEta: '2026-08-23 16:00' }, '无方案暂停的待确认写必须能恢复核对')
  assert.equal(sanitizeMerchantCommandForRetry({
    activityId: 71, nodeId: 8, requestId: 'merchant_pause_71_8', expectedRevision: 4,
    action: 'STATION_PAUSE', payload: { reasonCode: 'CAPACITY', resumeEta: '2026-08-23 16:00', fallbackPlanCode: 'DOCK_TO_CLOCK' },
  }), null, '半截方案不得重放')

  assert.equal(sanitizeMerchantCommandForRetry({
    activityId: 71, nodeId: 8, requestId: 'merchant_pause_71_8', expectedRevision: 4,
    action: 'STATION_PAUSE',
    payload: {
      reasonCode: 'CAPACITY', resumeEta: '2026-08-23 16:00',
      fallbackNodeId: 9, fallbackPlanCode: 'DOCK_TO_CLOCK', fallbackPlanVersion: 2,
    },
  }), null, '旧 fallbackNodeId 命令不得恢复或重放')

  const pausedRaw = merchantView()
  pausedRaw.merchant.stations[0].status = 'PAUSED'
  pausedRaw.merchant.stations[0].playable = false
  const paused = normalizeMerchantProjection(pausedRaw)
  assert.deepEqual(buildStationResumeCommand(paused, paused.stations[0], 'merchant_resume_71_8').payload, {})

  assert.deepEqual(buildVerifySubmissionCommand(active, active.stations[0], {
    submissionId: '300', decision: 'REJECT', reasonCode: 'ANSWER_MISMATCH', reason: '答案不匹配',
  }, 'merchant_verify_71_8'), {
    activityId: 71,
    nodeId: 8,
    requestId: 'merchant_verify_71_8',
    expectedRevision: 4,
    action: 'VERIFY_SUBMISSION',
    payload: {
      submissionId: '300', decision: 'REJECT', reasonCode: 'ANSWER_MISMATCH',
    },
  })
})

test('邀请必须先接受或拒绝，不能从 INVITED 跨过 ACCEPTED 直接 READY', () => {
  const raw = merchantView()
  raw.merchant.stations[0].status = 'INVITED'
  raw.merchant.stations[0].playable = false
  const projection = normalizeMerchantProjection(raw)
  const station = projection.stations[0]
  assert.equal(station.canAccept, true)
  assert.equal(station.canDecline, true)
  assert.equal(station.canReady, false)
  assert.deepEqual(buildStationAcceptCommand(projection, station, 'merchant_accept_71_8'), {
    activityId: 71, nodeId: 8, requestId: 'merchant_accept_71_8', expectedRevision: 4,
    action: 'STATION_ACCEPT', payload: {},
  })
  assert.deepEqual(buildStationDeclineCommand(projection, station, {
    reasonCode: 'SCHEDULE_CONFLICT', reason: '档期冲突',
  }, 'merchant_decline_71_8'), {
    activityId: 71, nodeId: 8, requestId: 'merchant_decline_71_8', expectedRevision: 4,
    action: 'STATION_DECLINE', payload: { reasonCode: 'SCHEDULE_CONFLICT', reason: '档期冲突' },
  })
  assert.throws(() => buildStationReadyCommand(projection, station, {
    checklist: [{ code: 'STAFF', checked: true }, { code: 'PROP', checked: true }],
    capacity: 10, serviceStartAt: '2026-08-23 09:00', serviceEndAt: '2026-08-23 18:00',
  }, 'merchant_ready_71_8'), /STATION_READY_NOT_ALLOWED/)
})

test('非法状态、未勾完清单、脏时段或无待核验都不得生成写命令', () => {
  const active = normalizeMerchantProjection(merchantView())
  assert.throws(() => buildStationReadyCommand(active, active.stations[0], {}, 'merchant_ready_71_8'), /STATION_READY_NOT_ALLOWED/)

  const invitedRaw = merchantView()
  invitedRaw.merchant.stations[0].status = 'ACCEPTED'
  invitedRaw.merchant.stations[0].playable = false
  const invited = normalizeMerchantProjection(invitedRaw)
  assert.throws(() => buildStationReadyCommand(invited, invited.stations[0], {
    checklist: [{ code: 'STAFF', checked: true }, { code: 'PROP', checked: false }],
    capacity: 10,
    serviceStartAt: '2026-08-23 18:00', serviceEndAt: '2026-08-23 09:00',
  }, 'merchant_ready_71_8'), /STATION_READY_INPUT_INVALID/)

  const noPendingRaw = merchantView()
  noPendingRaw.merchant.stations[0].pendingVerificationCount = 0
  const noPending = normalizeMerchantProjection(noPendingRaw)
  assert.throws(() => buildVerifySubmissionCommand(noPending, noPending.stations[0], {
    submissionId: '300', decision: 'APPROVE',
  }, 'merchant_verify_71_8'), /VERIFY_SUBMISSION_NOT_ALLOWED/)
  assert.throws(() => buildVerifySubmissionCommand(active, active.stations[0], {
    submissionId: 'submission-300', decision: 'APPROVE',
  }, 'merchant_verify_71_bad'), /VERIFY_SUBMISSION_INPUT_INVALID/)
})

test('商家项目卡只给活动接本站入口，加载/错误/空态不会互相冒充', () => {
  const cards = [
    { key: 'act-71', id: 71, bizType: 'activity', title: '商圈谜案季' },
    { key: 'host-9', id: 9, bizType: 'topic', title: '普通主题' },
  ]
  assert.deepEqual(decorateMerchantActivityCards(cards, {}), [
    {
      key: 'act-71', id: 71, bizType: 'activity', title: '商圈谜案季',
      gameActivityId: 0, gameState: 'loading', gameText: '本站状态加载中', gameTone: 'muted',
    },
    cards[1],
  ])

  const business = merchantGameCardState({
    status: 'business-error', reasonCode: 'GAME_SESSION_NOT_PREPARED', message: '活动尚未准备游戏会话',
  })
  assert.deepEqual(business, { state: 'business-error', text: '本站尚未配置', tone: 'pending', canEnter: false })
  assert.notEqual(business.state, 'empty')
  assert.deepEqual(merchantGameCardState({ status: 'network-error' }), {
    state: 'network-error', text: '本站状态待刷新', tone: 'muted', canEnter: false,
  })

  const empty = merchantView({ merchant: { stations: [] } })
  assert.deepEqual(merchantGameCardState({ status: 'ready', data: empty }), {
    state: 'empty', text: '暂无本站任务', tone: 'muted', canEnter: false,
  })

  const ready = merchantGameCardState({ status: 'ready', data: merchantView() })
  assert.equal(ready.canEnter, true)
  assert.equal(decorateMerchantActivityCards(cards, { 71: ready })[0].gameActivityId, 71)
})

test('承接商家入口只由服务端授权 entries 关联，且同主题多场不猜 activityId', () => {
  const cards = [
    { key: 'join-501', id: 501, role: 'join', ownerType: 1, ownerId: 88, title: '谜案主题' },
    { key: 'act-73', id: 73, role: 'host', bizType: 'activity', ownerType: 2, ownerId: 73, title: '主办场次' },
  ]
  const entries = [
    { activityId: 71, topicId: 88, activityName: '周六场', stationCount: 1 },
    { activityId: 72, topicId: 88, activityName: '周日场', stationCount: 2 },
    { activityId: 73, topicId: 90, activityName: '主办场次', stationCount: 1 },
  ]
  const loading = attachMerchantGameEntries(cards, entries, {})
  assert.deepEqual(loading[0].gameEntries.map(item => item.gameActivityId), [71, 72])
  assert.deepEqual(loading[0].gameEntries.map(item => item.activityName), ['周六场', '周日场'])
  assert.deepEqual(loading[1].gameEntries.map(item => item.gameActivityId), [73])

  const ready = merchantGameCardState({ status: 'ready', data: merchantView({ activityId: 71 }) })
  const decorated = attachMerchantGameEntries(cards, entries, { 71: ready })
  assert.equal(decorated[0].gameEntries[0].gameText, '本站可接待 · 待核验 2')
  assert.equal(decorated[0].gameEntries[1].gameText, '本站状态加载中')

  assert.deepEqual(attachMerchantGameEntries(cards, [], {})[0].gameEntries, [])
})

test('授权站点不在首页截断的两张报名卡里时仍生成同款活动卡入口', () => {
  const attached = attachMerchantGameEntries([], [{
    activityId: 99, topicId: 188, activityName: '夜场谜案', stationCount: 1,
    startAt: '2026-08-24 19:00:00', endAt: '2026-08-24 22:00:00',
  }], {})

  assert.equal(attached.length, 1)
  assert.deepEqual({
    key: attached[0].key,
    id: attached[0].id,
    bizType: attached[0].bizType,
    role: attached[0].role,
    title: attached[0].title,
    activityId: attached[0].gameEntries[0].gameActivityId,
  }, {
    key: 'game-station-99', id: 99, bizType: 'activity', role: 'join',
    title: '夜场谜案', activityId: 99,
  })
})
