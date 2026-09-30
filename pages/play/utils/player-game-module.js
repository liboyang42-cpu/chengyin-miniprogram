const SESSION_STATES = new Set(['PREPARING', 'READY', 'RUNNING', 'FINISHED', 'CANCELLED'])
const NODE_STATES = new Set([
  'LOCKED', 'AVAILABLE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_VERIFICATION',
  'COMPLETED', 'FALLBACK_COMPLETED', 'INVITED', 'ACCEPTED', 'READY', 'ACTIVE',
  'PAUSED', 'CLOSED',
])

function positiveId(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function safeRevision(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function strictRevision(value) {
  const number = Number(value)
  return value !== null && value !== undefined && value !== ''
    && Number.isSafeInteger(number) && number >= 0 ? number : null
}

function safeText(value, maxLength) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength || 500)
}

function safeSnapshotAt(value) {
  if (typeof value !== 'string') return ''
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59) return ''
  return value
}

function normalizeChoices(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    id: safeText(item && item.id, 64),
    label: safeText(item && item.label, 160),
  })).filter((item) => item.id && item.label)
}

function normalizeEncodedEvidence(value, maxDecodedLength) {
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch (error) {
    throw new Error('PLAYER_SUBMIT_INPUT_INVALID')
  }
  if (!decoded.trim() || decoded.length > maxDecodedLength || /[\u0000-\u001f\u007f]/.test(decoded)
    || encodeURIComponent(decoded) !== value) {
    throw new Error('PLAYER_SUBMIT_INPUT_INVALID')
  }
  return value
}

function normalizeEvidenceUrls(value) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new Error('PLAYER_SUBMIT_INPUT_INVALID')
  }
  return value.map((item) => {
    if (typeof item !== 'string') throw new Error('PLAYER_SUBMIT_INPUT_INVALID')
    const evidence = item.trim()
    if (!evidence || evidence.length > 512 || /[\u0000-\u001f\u007f]/.test(evidence)) {
      throw new Error('PLAYER_SUBMIT_INPUT_INVALID')
    }
    if (evidence.indexOf('text:') === 0) {
      return 'text:' + normalizeEncodedEvidence(evidence.slice(5), 300)
    }
    if (evidence.indexOf('scan:') === 0) {
      return 'scan:' + normalizeEncodedEvidence(evidence.slice(5), 256)
    }
    const photo = /^https:\/\/([^/?#\s]+)(\/[^?#\s]*)?(?:\?[^#\s]*)?$/i.exec(evidence)
    const authority = photo && photo[1]
    const path = photo && (photo[2] || '')
    if (!photo || authority.indexOf('@') >= 0
      || !/^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(?::\d{1,5})?$/.test(authority)
      || !/\.(?:jpe?g|png|webp)$/i.test(path)) {
      throw new Error('PLAYER_SUBMIT_INPUT_INVALID')
    }
    return evidence
  })
}

function normalizePlayerTask(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const taskCode = safeText(value.taskCode, 64)
  const prompt = safeText(value.prompt, 500)
  if (!taskCode || !prompt) return null
  const task = { taskCode, prompt, verificationRequired: value.verificationRequired === true }
  const inputType = safeText(value.inputType, 16).toUpperCase()
  if (inputType === 'TEXT' || inputType === 'SCAN' || inputType === 'PHOTO') task.inputType = inputType
  if (inputType === 'PHOTO' && safeText(value.completionPolicy, 32).toUpperCase() === 'EVIDENCE_ONLY') {
    task.completionPolicy = 'EVIDENCE_ONLY'
  }
  return task
}

function normalizeHint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const rawLevel = Number(value.currentLevel)
  const currentLevel = Number.isSafeInteger(rawLevel) && rawLevel >= 0 && rawLevel <= 2 ? rawLevel : 0
  const seenLevels = new Set()
  const revealedTexts = (Array.isArray(value.revealedTexts) ? value.revealedTexts : [])
    .map((item) => ({
      level: Number(item && item.level),
      text: safeText(item && item.text, 1200),
    }))
    .filter((item) => Number.isSafeInteger(item.level) && item.level >= 1
      && item.level <= currentLevel && item.text && !seenLevels.has(item.level)
      && seenLevels.add(item.level))
    .sort((a, b) => a.level - b.level)
  const rawNextLevel = Number(value.nextLevel)
  const nextImpactLabel = safeText(value.nextImpactLabel, 160)
  const nextLevel = Number.isSafeInteger(rawNextLevel) && rawNextLevel >= 1 && rawNextLevel <= 2
    && rawNextLevel === currentLevel + 1 && nextImpactLabel ? rawNextLevel : null
  const revealImpactLabel = safeText(value.revealImpactLabel, 200)
  const revealAvailable = value.revealAvailable === true && !!revealImpactLabel
  return {
    currentLevel,
    revealedTexts,
    nextLevel,
    nextImpactLabel: nextLevel ? nextImpactLabel : '',
    revealAvailable,
    revealImpactLabel: revealAvailable ? revealImpactLabel : '',
  }
}

function normalizeFallback(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const planCode = safeText(value.planCode, 64).toUpperCase()
  const planVersion = positiveId(value.planVersion)
  const targetNodeId = positiveId(value.targetNodeId)
  const targetNodeName = safeText(value.targetNodeName, 120)
  const playerMessage = safeText(value.playerMessage, 200)
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(planCode) || !planVersion || !targetNodeId
    || !targetNodeName || !playerMessage) return null
  return { planCode, planVersion, targetNodeId, targetNodeName, playerMessage }
}

/* R9-38:暂停的对外安排(原因/预计恢复)与有没有兜底路线无关。全空就不带,
   免得前端渲染一个「原因:」后面什么都没有的空壳。 */
function normalizePause(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const reasonCode = safeText(value.reasonCode, 40).toUpperCase()
  const reason = safeText(value.reason, 200)
  const resumeEta = safeText(value.resumeEta, 64)
  if (!reason && !resumeEta) return null
  return { reasonCode, reason, resumeEta }
}

function normalizeNodes(value) {
  if (!Array.isArray(value)) return []
  return value.map((node) => {
    const status = safeText(node && node.personalState, 40).toUpperCase()
    const normalized = {
      nodeId: positiveId(node && node.nodeId),
      status: NODE_STATES.has(status) ? status : 'LOCKED',
      stationStatus: safeText(node && node.stationStatus, 40).toUpperCase(),
      clue: safeText(node && node.clue, 1200),
      playerTask: normalizePlayerTask(node && node.playerTask),
      hint: normalizeHint(node && node.hint),
      choices: normalizeChoices(node && node.allowedChoices),
    }
    if (normalized.status === 'PAUSED') {
      const pause = normalizePause(node && node.pause)
      if (pause) normalized.pause = pause
      const fallback = normalizeFallback(node && node.fallback)
      if (fallback) normalized.fallback = fallback
    }
    const completedAt = safeText(node && node.completedAt, 64)
    if (normalized.status === 'COMPLETED' || normalized.status === 'FALLBACK_COMPLETED') {
      if (completedAt) normalized.completedAt = completedAt
      const completionOrder = positiveId(node && node.completionOrder)
      if (completionOrder) normalized.completionOrder = completionOrder
      const completionStatus = safeText(node && node.completionStatus, 40).toUpperCase()
      if (completionStatus === 'COMPLETED' || completionStatus === 'FALLBACK_COMPLETED') {
        normalized.completionStatus = completionStatus
        const completionSource = safeText(node && node.completionSource, 64).toUpperCase()
        if (completionSource) normalized.completionSource = completionSource
      }
    }
    return normalized
  }).filter((node) => node.nodeId > 0)
}

function normalizeMySubmissions(value) {
  if (!Array.isArray(value)) return []
  const allowed = new Set(['PENDING', 'APPROVED', 'REJECTED', 'RECORDED'])
  const labels = {
    PENDING: '待商家核验', APPROVED: '本站已通过', REJECTED: '商家已驳回，可重新提交',
    RECORDED: '证据已记录',
  }
  return value.map((item) => {
    const status = safeText(item && item.status, 32).toUpperCase()
    const normalized = {
      submissionId: positiveId(item && item.submissionId),
      nodeId: positiveId(item && item.nodeId),
      taskCode: safeText(item && item.taskCode, 64),
      status: allowed.has(status) ? status : '',
      statusLabel: labels[status] || '',
    }
    if (status === 'REJECTED') {
      normalized.decisionReasonCode = safeText(
        item && (item.reasonCode || item.decisionReasonCode), 64
      )
      normalized.decisionReason = safeText(
        item && (item.reason || item.decisionReason), 300
      )
    }
    return normalized
  }).filter((item) => item.submissionId && item.nodeId && item.taskCode && item.status)
}

function normalizeVisibleVariables(value) {
  const rows = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).map((code) => ({ code, value: value[code] }))
      : [])
  return rows.map((item) => ({
    code: safeText(item && item.code, 64),
    value: typeof (item && item.value) === 'boolean' || typeof (item && item.value) === 'number'
      ? item.value
      : safeText(item && item.value, 160),
  })).filter((item) => item.code)
}

function normalizeTeamActions(value) {
  if (!Array.isArray(value)) return []
  const allowedStatuses = new Set(['JOINED', 'ASSIGNED', 'CONFIRMED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'FALLBACK_COMPLETED'])
  const labels = {
    JOINED: '待分配', ASSIGNED: '待确认身份', CONFIRMED: '身份已确认', IN_PROGRESS: '行动中',
    SUBMITTED: '等待核验', COMPLETED: '已完成', FALLBACK_COMPLETED: '已通过兜底完成',
  }
  return value.map((item) => {
    const status = safeText(item && item.status, 40).toUpperCase()
    return {
      memberId: positiveId(item && item.memberId),
      displayName: safeText(item && item.displayName, 80),
      roleCode: safeText(item && item.roleCode, 64),
      status: allowedStatuses.has(status) ? status : 'ASSIGNED',
      statusLabel: labels[allowedStatuses.has(status) ? status : 'ASSIGNED'],
    }
  }).filter((item) => item.memberId > 0)
}

function normalizeLeaderboard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.visible !== true) return null
  const entries = Array.isArray(value.entries) ? value.entries.map((item) => {
    const rank = Number(item && item.rank)
    const teamId = positiveId(item && item.teamId)
    const score = Number(item && item.score)
    if (!Number.isSafeInteger(rank) || rank < 1 || !teamId || !Number.isSafeInteger(score) || score < 0) return null
    return {
      rank,
      teamId,
      displayName: safeText(item && item.displayName, 80),
      score,
    }
  }).filter(Boolean) : []
  return { visible: true, entries }
}

function normalizePlayerPendingReceiptIndex(value, activityId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const normalizedActivityId = positiveId(activityId)
  const storedActivityId = positiveId(value.activityId)
  const requestId = safeText(value.requestId, 64)
  const action = safeText(value.action, 64).toUpperCase()
  const allowedActions = new Set(['CONFIRM_ROLE', 'PLAYER_CHOICE', 'PLAYER_SUBMIT', 'PLAYER_HINT', 'PLAYER_REVEAL'])
  const revision = strictRevision(value.expectedRevision)
  const nodeId = value.nodeId == null ? null : positiveId(value.nodeId)
  if (!normalizedActivityId || storedActivityId !== normalizedActivityId
    || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)
    || !allowedActions.has(action) || revision === null
    || (action === 'CONFIRM_ROLE' ? nodeId !== null : !nodeId)) return null
  return {
    activityId: normalizedActivityId,
    nodeId,
    requestId,
    expectedRevision: revision,
    action,
  }
}

function normalizePlayerPendingWrite(value, activityId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const requestId = safeText(value.requestId, 64)
  const action = safeText(value.action, 64).toUpperCase()
  const command = value.command
  const allowedActions = new Set(['CONFIRM_ROLE', 'PLAYER_CHOICE', 'PLAYER_SUBMIT', 'PLAYER_HINT', 'PLAYER_REVEAL'])
  const normalizedActivityId = positiveId(activityId)
  if (!normalizedActivityId || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)
    || !allowedActions.has(action) || !command || typeof command !== 'object' || Array.isArray(command)
    || positiveId(command.activityId) !== normalizedActivityId
    || command.requestId !== requestId || safeText(command.action, 64).toUpperCase() !== action) return null
  const revision = strictRevision(command.expectedRevision)
  if (revision === null) return null
  const nodeId = command.nodeId == null ? null : positiveId(command.nodeId)
  let payload
  if (action === 'CONFIRM_ROLE') {
    if (nodeId !== null) return null
    payload = {}
  } else if (action === 'PLAYER_CHOICE') {
    const choiceId = safeText(command.payload && command.payload.choiceId, 64)
    if (!nodeId || !choiceId) return null
    payload = { choiceId }
  } else if (action === 'PLAYER_HINT') {
    const level = Number(command.payload && command.payload.level)
    if (!nodeId || !Number.isSafeInteger(level) || level < 1 || level > 2) return null
    payload = { level }
  } else if (action === 'PLAYER_REVEAL') {
    if (!nodeId) return null
    payload = {}
  } else {
    const taskCode = safeText(command.payload && command.payload.taskCode, 64)
    if (!nodeId || !taskCode) return null
    try {
      payload = { taskCode, evidenceUrls: normalizeEvidenceUrls(command.payload && command.payload.evidenceUrls) }
    } catch (error) {
      return null
    }
  }
  return {
    requestId,
    action,
    command: {
      activityId: normalizedActivityId,
      nodeId,
      requestId,
      expectedRevision: revision,
      action,
      payload,
    },
  }
}

function normalizePlayerProjection(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { enabled: false, reason: 'EMPTY' }
  if (String(raw.perspective || '').toUpperCase() !== 'PLAYER' || !raw.player || typeof raw.player !== 'object') {
    return { enabled: false, reason: 'FORBIDDEN_PROJECTION' }
  }
  const sessionId = positiveId(raw.sessionId)
  if (!sessionId) return { enabled: false, reason: 'INVALID_SESSION' }
  const activityId = positiveId(raw.activityId)
  if (!activityId) return { enabled: false, reason: 'INVALID_ACTIVITY' }
  const revision = strictRevision(raw.revision)
  if (revision === null) return { enabled: false, reason: 'INVALID_REVISION' }
  const status = safeText(raw.status, 40).toUpperCase()
  if (!SESSION_STATES.has(status)) return { enabled: false, reason: 'INVALID_STATUS' }

  const player = raw.player
  const role = player.role && typeof player.role === 'object' ? player.role : {}
  const story = player.story && typeof player.story === 'object' ? player.story : {}
  const mySubmissions = normalizeMySubmissions(player.mySubmissions)
  const availableActions = Array.isArray(raw.availableActions)
    ? raw.availableActions.map((item) => safeText(item, 64)).filter(Boolean)
    : []
  const nodes = normalizeNodes(player.nodes).map((node) => Object.assign({}, node, {
    submission: mySubmissions.find((item) => item.nodeId === node.nodeId) || null,
  }))
  return {
    enabled: true,
    sessionId,
    activityId,
    status,
    revision,
    snapshotAt: safeSnapshotAt(raw.snapshotAt),
    availableActions,
    canSubmitTask: availableActions.includes('PLAYER_SUBMIT'),
    teamId: positiveId(player.teamId),
    role: {
      code: safeText(role.code, 64),
      name: safeText(role.name, 80),
      confirmed: role.confirmed === true || safeText(role.status, 32).toUpperCase() === 'CONFIRMED',
      publicBrief: safeText(role.publicBrief, 500),
    },
    nodes,
    mySubmissions,
    teamActions: normalizeTeamActions(player.teamActions),
    leaderboard: normalizeLeaderboard(player.leaderboard),
    story: {
      visibleVariables: normalizeVisibleVariables(story.visibleVariables),
      ending: story.ending && typeof story.ending === 'object'
        ? {
          code: safeText(story.ending.code, 64),
          title: safeText(story.ending.title, 160),
          summary: safeText(story.ending.summary, 1200) || safeText(story.ending.text, 1200),
        }
        : null,
    },
    write: { status: 'idle', requestId: '' },
  }
}

function buildPlayerChoiceInput(projection, choiceId, requestId) {
  const source = projection || {}
  const activityId = positiveId(source.activityId)
  const nodeId = positiveId(source.nodeId)
  const choice = safeText(choiceId, 64)
  const stableRequestId = safeText(requestId, 64)
  const revision = strictRevision(source.revision)
  if (!activityId || !nodeId || !choice || !stableRequestId || revision === null) throw new Error('PLAYER_CHOICE_INPUT_INVALID')
  return {
    activityId,
    nodeId,
    requestId: stableRequestId,
    expectedRevision: revision,
    action: 'PLAYER_CHOICE',
    payload: { choiceId: choice },
  }
}

function buildPlayerRoleConfirmInput(projection, requestId) {
  const source = projection || {}
  const activityId = positiveId(source.activityId)
  const stableRequestId = safeText(requestId, 64)
  const revision = strictRevision(source.revision)
  if (!activityId || !stableRequestId || revision === null) throw new Error('CONFIRM_ROLE_INPUT_INVALID')
  return {
    activityId,
    nodeId: null,
    requestId: stableRequestId,
    expectedRevision: revision,
    action: 'CONFIRM_ROLE',
    payload: {},
  }
}

function buildPlayerHintInput(projection, level, requestId) {
  const source = projection || {}
  const activityId = positiveId(source.activityId)
  const nodeId = positiveId(source.nodeId)
  const hintLevel = Number(level)
  const stableRequestId = safeText(requestId, 64)
  const revision = strictRevision(source.revision)
  if (!activityId || !nodeId || !Number.isSafeInteger(hintLevel)
    || hintLevel < 1 || hintLevel > 2 || !stableRequestId || revision === null) {
    throw new Error('PLAYER_HINT_INPUT_INVALID')
  }
  return {
    activityId,
    nodeId,
    requestId: stableRequestId,
    expectedRevision: revision,
    action: 'PLAYER_HINT',
    payload: { level: hintLevel },
  }
}

function buildPlayerRevealInput(projection, requestId) {
  const source = projection || {}
  const activityId = positiveId(source.activityId)
  const nodeId = positiveId(source.nodeId)
  const stableRequestId = safeText(requestId, 64)
  const revision = strictRevision(source.revision)
  if (!activityId || !nodeId || !stableRequestId || revision === null) {
    throw new Error('PLAYER_REVEAL_INPUT_INVALID')
  }
  return {
    activityId,
    nodeId,
    requestId: stableRequestId,
    expectedRevision: revision,
    action: 'PLAYER_REVEAL',
    payload: {},
  }
}

function buildPlayerSubmissionInput(projection, taskCode, requestId, evidenceUrls) {
  const source = projection || {}
  const activityId = positiveId(source.activityId)
  const nodeId = positiveId(source.nodeId)
  const code = safeText(taskCode, 64)
  const stableRequestId = safeText(requestId, 64)
  const revision = strictRevision(source.revision)
  if (!activityId || !nodeId || !code || !stableRequestId || revision === null) throw new Error('PLAYER_SUBMIT_INPUT_INVALID')
  const evidence = normalizeEvidenceUrls(evidenceUrls)
  return {
    activityId,
    nodeId,
    requestId: stableRequestId,
    expectedRevision: revision,
    action: 'PLAYER_SUBMIT',
    payload: { taskCode: code, evidenceUrls: evidence },
  }
}

function mergeConfirmedReceipt(projection, receipt) {
  if (!projection || !projection.write || projection.write.status !== 'unknown') return projection
  if (!receipt || receipt.requestId !== projection.write.requestId) return projection
  if (receipt.outcome !== 'APPLIED' && receipt.outcome !== 'COMMITTED') return projection
  return Object.assign({}, projection, {
    revision: safeRevision(receipt.revision),
    write: {
      status: 'confirmed',
      requestId: projection.write.requestId,
      action: safeText(receipt.action, 64),
    },
  })
}

function completedRouteSegment(nodes, completedNodeId) {
  const list = Array.isArray(nodes) ? nodes : []
  const current = list.find((node) => node && node.done
    && String(node.nodeId) === String(completedNodeId)
    && (positiveId(node.completionOrder) || Number(node.doneAt) > 0)
    && Number.isFinite(Number(node.lng))
    && Number.isFinite(Number(node.lat)))
  if (!current) return []
  const candidates = list.filter((node) => node && node.done
    && String(node.nodeId) !== String(current.nodeId)
    && Number.isFinite(Number(node.lng))
    && Number.isFinite(Number(node.lat)))
  const currentOrder = positiveId(current.completionOrder)
  let previous = null
  if (currentOrder) {
    previous = candidates.filter((node) => {
      const order = positiveId(node.completionOrder)
      return order > 0 && order < currentOrder
    }).sort((a, b) => positiveId(b.completionOrder) - positiveId(a.completionOrder)
      || Number(b.doneAt) - Number(a.doneAt))[0] || null
  }
  if (!previous && Number(current.doneAt) > 0) {
    const fallbackCandidates = currentOrder
      ? candidates.filter((node) => !positiveId(node.completionOrder))
      : candidates
    previous = fallbackCandidates.filter((node) => Number(node.doneAt) > 0
      && Number(node.doneAt) < Number(current.doneAt))
      .sort((a, b) => Number(b.doneAt) - Number(a.doneAt))[0] || null
  }
  if (!previous) return []
  return [
    { lng: Number(previous.lng), lat: Number(previous.lat) },
    { lng: Number(current.lng), lat: Number(current.lat) },
  ]
}

module.exports = {
  normalizePlayerProjection,
  buildPlayerChoiceInput,
  buildPlayerSubmissionInput,
  buildPlayerRoleConfirmInput,
  buildPlayerHintInput,
  buildPlayerRevealInput,
  mergeConfirmedReceipt,
  completedRouteSegment,
  normalizePlayerPendingWrite,
  normalizePlayerPendingReceiptIndex,
}
