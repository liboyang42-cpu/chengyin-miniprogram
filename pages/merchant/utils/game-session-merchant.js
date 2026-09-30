'use strict'

const SESSION_STATES = new Set(['PREPARING', 'READY', 'RUNNING', 'FINISHED', 'CANCELLED'])
const STATION_STATES = new Set(['INVITED', 'ACCEPTED', 'READY', 'ACTIVE', 'PAUSED', 'CLOSED'])
const PLAYABLE_SESSION_STATES = new Set(['READY', 'RUNNING'])
const MERCHANT_COMMAND_ACTIONS = new Set([
  'STATION_ACCEPT', 'STATION_DECLINE', 'STATION_READY',
  'STATION_PAUSE', 'STATION_RESUME', 'VERIFY_SUBMISSION',
])

function positiveId(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function nullablePositiveId(value) {
  if (value === null || value === undefined || value === '') return null
  return positiveId(value) || null
}

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function safeText(value, maxLength) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength || 500)
}

function normalizeActions(value) {
  if (!Array.isArray(value)) return null
  return value
    .map((item) => safeText(item, 64).toUpperCase())
    .filter((item) => /^[A-Z][A-Z0-9_]{2,63}$/.test(item))
}

function normalizeChecklist(value) {
  if (!Array.isArray(value)) return null
  const rows = value.map((item) => ({
    code: safeText(item && item.code, 64),
    label: safeText(item && item.label, 120),
    checked: item && item.checked === true,
  }))
  if (rows.some((item) => !item.code || !item.label)) return null
  if (new Set(rows.map((item) => item.code)).size !== rows.length) return null
  return rows
}

function normalizeMerchantTask(value) {
  if (value === null || value === undefined) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const taskCode = safeText(value.taskCode, 64)
  const prompt = safeText(value.prompt, 500)
  const inputType = safeText(value.inputType, 16).toUpperCase()
  if (!taskCode || !prompt || !['TEXT', 'SCAN', 'PHOTO'].includes(inputType)) return false
  return {
    taskCode,
    prompt,
    inputType,
    verificationRequired: value.verificationRequired === true,
  }
}

const MERCHANT_RECAP_COUNT_FIELDS = [
  'arrivedPlayers',
  'submissionCount',
  'approvedCount',
  'rejectedCount',
  'recordedCount',
  'normalCompletedCount',
  'fallbackCompletedCount',
  'pauseEventCount',
  'authorizedContentCount',
]

function normalizeStationRecap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.contentPolicy !== 'NO_PUBLIC_CONTENT') return null
  const recap = { contentPolicy: 'NO_PUBLIC_CONTENT' }
  for (const field of MERCHANT_RECAP_COUNT_FIELDS) {
    const count = nonNegativeInteger(value[field])
    if (count === null) return null
    recap[field] = count
  }
  if (recap.authorizedContentCount !== 0) return null
  return {
    arrivedPlayers: recap.arrivedPlayers,
    submissionCount: recap.submissionCount,
    approvedCount: recap.approvedCount,
    rejectedCount: recap.rejectedCount,
    recordedCount: recap.recordedCount,
    normalCompletedCount: recap.normalCompletedCount,
    fallbackCompletedCount: recap.fallbackCompletedCount,
    pauseEventCount: recap.pauseEventCount,
    authorizedContentCount: recap.authorizedContentCount,
    contentPolicy: recap.contentPolicy,
  }
}

function normalizeFallbackOptions(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) return null
  const rows = value.map((item) => ({
    sourceNodeId: positiveId(item && item.sourceNodeId),
    planCode: safeText(item && item.planCode, 64).toUpperCase(),
    planVersion: positiveId(item && item.planVersion),
    nodeId: positiveId(item && item.nodeId),
    nodeName: safeText(item && item.nodeName, 120),
    playerMessage: safeText(item && item.playerMessage, 500),
  }))
  if (rows.some((item) => !item.sourceNodeId || !/^[A-Z][A-Z0-9_]{1,63}$/.test(item.planCode)
    || !item.planVersion || !item.nodeId || item.nodeId === item.sourceNodeId
    || !item.nodeName || !item.playerMessage)) return null
  if (new Set(rows.map((item) => [item.sourceNodeId, item.planCode, item.planVersion].join(':'))).size !== rows.length) return null
  return rows
}

function stationStatusText(status) {
  return {
    INVITED: '待接受邀请',
    ACCEPTED: '已接受 · 待准备',
    READY: '准备完成',
    ACTIVE: '运行中',
    PAUSED: '已暂停',
    CLOSED: '已结束',
  }[status] || '状态异常'
}

function normalizeStation(raw, projection) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const stationId = positiveId(raw.stationId)
  const nodeId = positiveId(raw.nodeId)
  const status = safeText(raw.status, 32).toUpperCase()
  const revision = nonNegativeInteger(raw.revision)
  const checklist = normalizeChecklist(raw.preparationChecklist)
  const playerTask = normalizeMerchantTask(raw.playerTask)
  const pendingVerificationCount = nonNegativeInteger(raw.pendingVerificationCount)
  if (!stationId || !nodeId || !STATION_STATES.has(status) || revision === null
    || checklist === null || playerTask === false || pendingVerificationCount === null) return null

  const capacity = raw.capacity === null || raw.capacity === undefined || raw.capacity === ''
    ? null
    : nonNegativeInteger(raw.capacity)
  if (capacity === null && raw.capacity !== null && raw.capacity !== undefined && raw.capacity !== '') return null
  const compatibilityWindow = raw.serviceWindow && typeof raw.serviceWindow === 'object'
    ? raw.serviceWindow
    : {}
  const serviceStartAt = safeText(raw.serviceStartAt, 32) || safeText(compatibilityWindow.start, 32)
  const serviceEndAt = safeText(raw.serviceEndAt, 32) || safeText(compatibilityWindow.end, 32)
  const serviceWindow = { start: serviceStartAt, end: serviceEndAt }
  const actionSet = new Set(projection.availableActions)
  const stationConfigured = capacity !== null && capacity > 0
    && checklist.length > 0 && checklist.every((item) => item.checked)
    && validDateTime(serviceStartAt) && validDateTime(serviceEndAt)
    && dateTimeKey(serviceStartAt) < dateTimeKey(serviceEndAt)
  const playable = raw.playable === true && stationConfigured
    && (status === 'READY' || status === 'ACTIVE')
    && PLAYABLE_SESSION_STATES.has(projection.status)

  return {
    stationId,
    nodeId,
    nodeName: safeText(raw.nodeName, 120),
    stationCode: safeText(raw.stationCode, 64),
    status,
    revision,
    preparationChecklist: checklist,
    playerTask,
    merchantInstruction: safeText(raw.merchantInstruction, 500),
    hiddenInfoReminder: safeText(raw.hiddenInfoReminder, 500),
    capacity,
    serviceStartAt,
    serviceEndAt,
    serviceWindow,
    pauseReasonCode: safeText(raw.pauseReasonCode, 64),
    pauseReason: safeText(raw.pauseReason, 200),
    resumeEta: safeText(raw.resumeEta, 64),
    fallbackNodeId: nullablePositiveId(raw.fallbackNodeId),
    fallbackPlanCode: safeText(raw.fallbackPlanCode, 64).toUpperCase(),
    fallbackPlanVersion: nullablePositiveId(raw.fallbackPlanVersion),
    pendingVerificationCount,
    recap: normalizeStationRecap(raw.recap),
    playable,
    statusText: stationStatusText(status),
    canAccept: status === 'INVITED' && actionSet.has('STATION_ACCEPT')
      && projection.status !== 'FINISHED' && projection.status !== 'CANCELLED',
    canDecline: status === 'INVITED' && actionSet.has('STATION_DECLINE')
      && projection.status !== 'FINISHED' && projection.status !== 'CANCELLED',
    canReady: status === 'ACCEPTED' && actionSet.has('STATION_READY')
      && projection.status !== 'FINISHED' && projection.status !== 'CANCELLED',
    canPause: (status === 'READY' || status === 'ACTIVE') && actionSet.has('STATION_PAUSE')
      && projection.status !== 'FINISHED' && projection.status !== 'CANCELLED',
    canResume: status === 'PAUSED' && actionSet.has('STATION_RESUME')
      && projection.status !== 'FINISHED' && projection.status !== 'CANCELLED',
    canVerify: status === 'ACTIVE' && playable && pendingVerificationCount > 0
      && actionSet.has('VERIFY_SUBMISSION'),
  }
}

function normalizeMerchantProjection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled: false, reason: 'EMPTY' }
  if (String(raw.perspective || '').toUpperCase() !== 'MERCHANT') {
    return { enabled: false, reason: 'FORBIDDEN_PROJECTION' }
  }
  if (!raw.merchant || typeof raw.merchant !== 'object' || Array.isArray(raw.merchant)
    || !Array.isArray(raw.merchant.stations)) {
    return { enabled: false, reason: 'INVALID_MERCHANT_VIEW' }
  }
  const sessionId = positiveId(raw.sessionId)
  const activityId = positiveId(raw.activityId)
  const revision = nonNegativeInteger(raw.revision)
  const status = safeText(raw.status, 32).toUpperCase()
  const availableActions = normalizeActions(raw.availableActions)
  const fallbackOptions = normalizeFallbackOptions(raw.merchant.fallbackOptions)
  if (!sessionId || !activityId || revision === null || !SESSION_STATES.has(status) || availableActions === null) {
    return { enabled: false, reason: 'INVALID_SESSION' }
  }
  if (fallbackOptions === null) return { enabled: false, reason: 'INVALID_FALLBACK_OPTIONS' }

  const base = {
    enabled: true,
    sessionId,
    activityId,
    status,
    revision,
    currentChapterId: nullablePositiveId(raw.currentChapterId),
    availableActions,
  }
  const stations = raw.merchant.stations.map((station) => normalizeStation(station, base))
  if (stations.some((station) => !station)) return { enabled: false, reason: 'INVALID_STATION' }
  return Object.assign(base, { stations, fallbackOptions })
}

function summarizeMerchantProjection(projection) {
  if (!projection || projection.enabled !== true || !Array.isArray(projection.stations)) {
    return { state: 'error', text: '本站状态不可用', tone: 'error', pendingVerificationCount: 0, stationCount: 0 }
  }
  const stations = projection.stations
  const pending = stations.reduce((sum, item) => sum + item.pendingVerificationCount, 0)
  if (!stations.length) {
    return { state: 'empty', text: '暂无本站任务', tone: 'muted', pendingVerificationCount: 0, stationCount: 0 }
  }
  if (stations.some((item) => item.playable)) {
    return {
      state: 'playable',
      text: pending > 0 ? '本站可接待 · 待核验 ' + pending : '本站可接待',
      tone: 'ready', pendingVerificationCount: pending, stationCount: stations.length,
    }
  }
  if (stations.every((item) => item.status === 'CLOSED')) {
    return { state: 'closed', text: '本站已结束', tone: 'muted', pendingVerificationCount: pending, stationCount: stations.length }
  }
  if (stations.some((item) => item.status === 'INVITED')) {
    return { state: 'invited', text: '待处理站点邀请', tone: 'pending', pendingVerificationCount: pending, stationCount: stations.length }
  }
  if (stations.some((item) => item.status === 'PAUSED')) {
    return { state: 'paused', text: '本站已暂停', tone: 'paused', pendingVerificationCount: pending, stationCount: stations.length }
  }
  return { state: 'setup', text: '本站待准备', tone: 'pending', pendingVerificationCount: pending, stationCount: stations.length }
}

function merchantGameCardState(result) {
  const source = result || {}
  if (source.status === 'ready') {
    const projection = normalizeMerchantProjection(source.data)
    if (!projection.enabled) {
      return { state: 'business-error', text: '本站状态不可用', tone: 'muted', canEnter: false }
    }
    const summary = summarizeMerchantProjection(projection)
    return { state: summary.state, text: summary.text, tone: summary.tone, canEnter: summary.stationCount > 0 }
  }
  if (source.status === 'business-error') {
    const textByReason = {
      GAME_SESSION_NOT_PREPARED: '本站尚未配置',
      GAME_ACTIVITY_CANCELLED: '游戏已取消',
      GAME_FORBIDDEN_SCOPE: '本站不可查看',
    }
    return {
      state: 'business-error',
      text: textByReason[source.reasonCode] || '本站状态不可用',
      tone: source.reasonCode === 'GAME_SESSION_NOT_PREPARED' ? 'pending' : 'muted',
      canEnter: false,
    }
  }
  if (source.status === 'network-error') {
    return { state: 'network-error', text: '本站状态待刷新', tone: 'muted', canEnter: false }
  }
  return { state: 'loading', text: '本站状态加载中', tone: 'muted', canEnter: false }
}

function decorateMerchantActivityCards(cards, stateByActivity) {
  const stateMap = stateByActivity || {}
  return (Array.isArray(cards) ? cards : []).map((card) => {
    if (!card || card.bizType !== 'activity' || !positiveId(card.id)) return card
    const state = stateMap[String(card.id)] || merchantGameCardState(null)
    return Object.assign({}, card, {
      gameActivityId: state.canEnter === true ? positiveId(card.id) : 0,
      gameState: state.state,
      gameText: state.text,
      gameTone: state.tone,
    })
  })
}

function attachMerchantGameEntries(cards, entries, stateByActivity) {
  const sourceCards = Array.isArray(cards) ? cards : []
  const stateMap = stateByActivity || {}
  const authorizedEntries = (Array.isArray(entries) ? entries : []).map((entry) => ({
    activityId: positiveId(entry && entry.activityId),
    topicId: positiveId(entry && entry.topicId),
    activityName: safeText(entry && entry.activityName, 120),
    stationCount: positiveId(entry && entry.stationCount),
    startAt: safeText(entry && entry.startAt, 32),
    endAt: safeText(entry && entry.endAt, 32),
  })).filter((entry) => entry.activityId && entry.topicId && entry.activityName && entry.stationCount)
  const exactActivityIds = new Set(sourceCards
    .filter((card) => card && card.bizType === 'activity' && positiveId(card.id))
    .map((card) => positiveId(card.id)))

  function decorateEntry(entry) {
    const state = stateMap[String(entry.activityId)] || merchantGameCardState(null)
    return Object.assign({}, entry, {
      // activityId 来自服务端按当前登录商家过滤的入口清单；页面详情仍会再次做本站归属校验。
      gameActivityId: entry.activityId,
      gameState: state.state,
      gameText: state.text,
      gameTone: state.tone,
    })
  }

  const attachedActivityIds = new Set()
  const decoratedCards = sourceCards.map((card) => {
    if (!card) return card
    let matched = []
    if (card.bizType === 'activity' && positiveId(card.id)) {
      matched = authorizedEntries.filter((entry) => entry.activityId === positiveId(card.id))
    } else if (card.role === 'join' && positiveId(card.ownerId)) {
      matched = authorizedEntries.filter((entry) => entry.topicId === positiveId(card.ownerId)
        && !exactActivityIds.has(entry.activityId))
    }
    matched.forEach((entry) => attachedActivityIds.add(entry.activityId))
    const gameEntries = matched.map(decorateEntry)
    return Object.assign({}, card, { gameEntries })
  })
  const missingCards = authorizedEntries
    .filter((entry) => !attachedActivityIds.has(entry.activityId))
    .map((entry) => ({
      key: 'game-station-' + entry.activityId,
      role: 'join',
      roleName: '承接',
      roleLabel: '我承接的',
      title: entry.activityName,
      meta: entry.startAt || '',
      statusLabel: '',
      catLabel: '活动',
      thumb: '',
      id: entry.activityId,
      bizType: 'activity',
      ownerType: 2,
      ownerId: entry.activityId,
      counts: {},
      todoCount: 0,
      todoChips: [],
      todoText: '',
      msgCount: 0,
      gameEntries: [decorateEntry(entry)],
    }))
  return decoratedCards.concat(missingCards)
}

function hasStation(projection, station) {
  return projection && projection.enabled === true && station
    && projection.stations.some((item) => item.stationId === station.stationId && item.nodeId === station.nodeId)
}

function baseCommand(projection, station, requestId, action, allowed) {
  if (!hasStation(projection, station) || allowed !== true) throw new Error(action + '_NOT_ALLOWED')
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(requestId || ''))) throw new Error(action + '_INPUT_INVALID')
  return {
    activityId: projection.activityId,
    nodeId: station.nodeId,
    requestId: String(requestId),
    expectedRevision: projection.revision,
    action,
  }
}

// R9-37:服务端服务时段返回 'YYYY-MM-DD HH:mm:ss';商家端自己填的是 'YYYY-MM-DD HH:mm'。
// 两种都要收,否则 ACTIVE 站点会被判 stationConfigured=false、playable=false,亮码入口消失。
function validDateTime(value) {
  const text = String(value || '')
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2}) (?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3])
}

// 比先后时先把精度拉平到分钟:两种合法格式混用时,尾部 ':ss' 只影响字典序、不改变时刻。
function dateTimeKey(value) {
  return String(value || '').slice(0, 16)
}

function buildStationAcceptCommand(projection, station, requestId) {
  const command = baseCommand(projection, station, requestId, 'STATION_ACCEPT', station && station.canAccept)
  return Object.assign(command, { payload: {} })
}

function buildStationDeclineCommand(projection, station, draft, requestId) {
  const command = baseCommand(projection, station, requestId, 'STATION_DECLINE', station && station.canDecline)
  const source = draft || {}
  const reasonCode = safeText(source.reasonCode, 64).toUpperCase()
  const reason = safeText(source.reason, 200)
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(reasonCode) || !reason) {
    throw new Error('STATION_DECLINE_INPUT_INVALID')
  }
  return Object.assign(command, { payload: { reasonCode, reason } })
}

function buildStationReadyCommand(projection, station, draft, requestId) {
  const command = baseCommand(projection, station, requestId, 'STATION_READY', station && station.canReady)
  const source = draft || {}
  const inputChecklist = Array.isArray(source.checklist) ? source.checklist : []
  const checkedByCode = {}
  inputChecklist.forEach((item) => {
    const code = safeText(item && item.code, 64)
    if (code) checkedByCode[code] = item && item.checked === true
  })
  const checklist = station.preparationChecklist.map((item) => ({ code: item.code, checked: checkedByCode[item.code] === true }))
  const capacity = positiveId(source.capacity)
  const start = safeText(source.serviceStartAt, 32)
  const end = safeText(source.serviceEndAt, 32)
  const note = safeText(source.note, 200)
  if (!checklist.length || checklist.some((item) => !item.checked) || !capacity
    || !validDateTime(start) || !validDateTime(end) || dateTimeKey(start) >= dateTimeKey(end)) {
    throw new Error('STATION_READY_INPUT_INVALID')
  }
  return Object.assign(command, {
    payload: { checklist, capacity, serviceStartAt: start, serviceEndAt: end, note },
  })
}

function buildStationPauseCommand(projection, station, draft, requestId) {
  const command = baseCommand(projection, station, requestId, 'STATION_PAUSE', station && station.canPause)
  const source = draft || {}
  const reasonCode = safeText(source.reasonCode, 64).toUpperCase()
  const reason = safeText(source.reason, 200)
  const resumeEta = safeText(source.resumeEta, 64)
  const fallbackPlanCode = safeText(source.fallbackPlanCode, 64).toUpperCase()
  const fallbackPlanVersion = positiveId(source.fallbackPlanVersion)
  // R9-38:备用方案选填(后端 resolvePauseFallback 无方案就不绑兜底)。
  // 但只要带了方案的任一半,就必须是服务端下发的已审核候选,不许半截或猜。
  const withFallback = !!fallbackPlanCode || source.fallbackPlanVersion != null
  const approved = Array.isArray(projection && projection.fallbackOptions)
    && projection.fallbackOptions.some((item) => item.sourceNodeId === station.nodeId
      && item.planCode === fallbackPlanCode && item.planVersion === fallbackPlanVersion)
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(reasonCode) || !resumeEta
    || (withFallback && (!/^[A-Z][A-Z0-9_]{1,63}$/.test(fallbackPlanCode) || !fallbackPlanVersion || !approved))) {
    throw new Error('STATION_PAUSE_INPUT_INVALID')
  }
  const payload = withFallback
    ? { reasonCode, resumeEta, fallbackPlanCode, fallbackPlanVersion }
    : { reasonCode, resumeEta }
  if (reason) payload.reason = reason
  return Object.assign(command, { payload })
}

function buildStationResumeCommand(projection, station, requestId) {
  const command = baseCommand(projection, station, requestId, 'STATION_RESUME', station && station.canResume)
  return Object.assign(command, { payload: {} })
}

function buildVerifySubmissionCommand(projection, station, draft, requestId) {
  const command = baseCommand(projection, station, requestId, 'VERIFY_SUBMISSION', station && station.canVerify)
  const source = draft || {}
  const submissionId = safeText(source.submissionId, 64)
  const decision = safeText(source.decision, 16).toUpperCase()
  const reasonCode = safeText(source.reasonCode, 64).toUpperCase()
  if (!/^[1-9]\d{0,18}$/.test(submissionId) || (decision !== 'APPROVE' && decision !== 'REJECT')
    || (decision === 'REJECT' && !reasonCode)) {
    throw new Error('VERIFY_SUBMISSION_INPUT_INVALID')
  }
  const payload = { submissionId, decision }
  if (reasonCode) payload.reasonCode = reasonCode
  return Object.assign(command, { payload })
}

function sanitizeMerchantCommandForRetry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || !raw.payload || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) return null
  const activityId = positiveId(raw.activityId)
  const nodeId = positiveId(raw.nodeId)
  const requestId = safeText(raw.requestId, 64)
  const expectedRevision = nonNegativeInteger(raw.expectedRevision)
  const action = safeText(raw.action, 64).toUpperCase()
  if (!activityId || !nodeId || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)
    || expectedRevision === null || !MERCHANT_COMMAND_ACTIONS.has(action)) return null

  let payload
  if (action === 'STATION_ACCEPT' || action === 'STATION_RESUME') {
    payload = {}
  } else if (action === 'STATION_DECLINE') {
    const reasonCode = safeText(raw.payload.reasonCode, 64).toUpperCase()
    const reason = safeText(raw.payload.reason, 200)
    if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(reasonCode) || !reason) return null
    payload = { reasonCode, reason }
  } else if (action === 'STATION_READY') {
    if (!Array.isArray(raw.payload.checklist)) return null
    const checklist = raw.payload.checklist.map((item) => ({
      code: safeText(item && item.code, 64), checked: item && item.checked === true,
    }))
    const capacity = positiveId(raw.payload.capacity)
    const serviceStartAt = safeText(raw.payload.serviceStartAt, 32)
    const serviceEndAt = safeText(raw.payload.serviceEndAt, 32)
    const note = safeText(raw.payload.note, 200)
    if (!checklist.length || checklist.some((item) => !item.code || !item.checked)
      || new Set(checklist.map((item) => item.code)).size !== checklist.length
      || !capacity || !validDateTime(serviceStartAt) || !validDateTime(serviceEndAt)
      || dateTimeKey(serviceStartAt) >= dateTimeKey(serviceEndAt)) return null
    payload = { checklist, capacity, serviceStartAt, serviceEndAt, note }
  } else if (action === 'STATION_PAUSE') {
    const reasonCode = safeText(raw.payload.reasonCode, 64).toUpperCase()
    const reason = safeText(raw.payload.reason, 200)
    const resumeEta = safeText(raw.payload.resumeEta, 64)
    const fallbackPlanCode = safeText(raw.payload.fallbackPlanCode, 64).toUpperCase()
    const fallbackPlanVersion = positiveId(raw.payload.fallbackPlanVersion)
    const withFallback = !!fallbackPlanCode || raw.payload.fallbackPlanVersion != null
    if (Object.prototype.hasOwnProperty.call(raw.payload, 'fallbackNodeId')
      || !/^[A-Z][A-Z0-9_]{1,63}$/.test(reasonCode) || !resumeEta
      || (withFallback && (!/^[A-Z][A-Z0-9_]{1,63}$/.test(fallbackPlanCode) || !fallbackPlanVersion))) return null
    payload = withFallback
      ? { reasonCode, resumeEta, fallbackPlanCode, fallbackPlanVersion }
      : { reasonCode, resumeEta }
    if (reason) payload.reason = reason
  } else {
    const submissionId = safeText(raw.payload.submissionId, 64)
    const decision = safeText(raw.payload.decision, 16).toUpperCase()
    const reasonCode = safeText(raw.payload.reasonCode, 64).toUpperCase()
    if (!/^[1-9]\d{0,18}$/.test(submissionId) || (decision !== 'APPROVE' && decision !== 'REJECT')
      || (decision === 'REJECT' && !/^[A-Z][A-Z0-9_]{1,63}$/.test(reasonCode))) return null
    payload = { submissionId, decision }
    if (reasonCode) payload.reasonCode = reasonCode
  }

  return { activityId, nodeId, requestId, expectedRevision, action, payload }
}

module.exports = {
  normalizeMerchantProjection,
  summarizeMerchantProjection,
  merchantGameCardState,
  decorateMerchantActivityCards,
  attachMerchantGameEntries,
  buildStationAcceptCommand,
  buildStationDeclineCommand,
  buildStationReadyCommand,
  buildStationPauseCommand,
  buildStationResumeCommand,
  buildVerifySubmissionCommand,
  normalizeStationRecap,
  sanitizeMerchantCommandForRetry,
}
