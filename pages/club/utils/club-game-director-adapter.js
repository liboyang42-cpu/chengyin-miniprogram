'use strict'

const {
  normalizeClubRecap,
  normalizeClubRecapExport,
} = require('../../../utils/game-session-client.js')

const CLUB_ROLE = 'club'

function directorError(code, message, cause) {
  const error = new Error(message || code)
  error.code = code
  if (cause) error.cause = cause
  return error
}

function asArray(value) {
  return Array.isArray(value) ? value.slice() : []
}

function stationPriority(station) {
  const status = String((station && station.status) || '').toUpperCase()
  if (status === 'PAUSED' || status === 'BLOCKED' || status === 'ERROR') return 0
  if (station && (station.issue || station.blockedReason || station.exception)) return 1
  if (status && status !== 'READY' && status !== 'ACTIVE' && status !== 'CLOSED') return 2
  return 3
}

function teamPriority(team) {
  const status = String((team && team.status) || '').toUpperCase()
  if (status === 'BLOCKED' || status === 'PAUSED' || status === 'ERROR') return 0
  if (team && (team.blocked || team.blockedReason || team.issue)) return 1
  return 2
}

function stablePrioritySort(list, priorityOf) {
  return list.map(function (item, index) { return { item: item, index: index } })
    .sort(function (left, right) {
      return priorityOf(left.item) - priorityOf(right.item) || left.index - right.index
    })
    .map(function (row) { return row.item })
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeText(value, maxLength) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return ''
  return text
}

function normalizeClubTeam(team) {
  const item = team && typeof team === 'object' && !Array.isArray(team) ? team : {}
  const normalized = Object.assign({}, item)
  const stuck = item.currentStuckNode
  const nodeId = numberOrNull(stuck && stuck.nodeId)
  const nodeName = safeText(stuck && stuck.nodeName, 120)
  if (nodeId !== null && nodeId > 0 && nodeName) {
    normalized.currentStuckNode = {
      nodeId: nodeId,
      nodeName: nodeName,
      stationStatus: safeText(stuck.stationStatus, 40).toUpperCase(),
      submissionStatus: safeText(stuck.submissionStatus, 40).toUpperCase(),
    }
  } else {
    delete normalized.currentStuckNode
  }

  const hintLevel = numberOrNull(item.hintLevel)
  if (!Number.isSafeInteger(hintLevel) || hintLevel < 1 || hintLevel > 2) {
    delete normalized.hintLevel
  }

  const recent = item.recentEvent
  const action = safeText(recent && recent.action, 64).toUpperCase()
  const outcome = safeText(recent && recent.outcome, 40).toUpperCase()
  if (action && outcome) {
    normalized.recentEvent = {
      action: action,
      outcome: outcome,
      occurredAt: safeText(recent.occurredAt, 64),
    }
  } else {
    delete normalized.recentEvent
  }
  return normalized
}

function readinessBlockers(readiness, requiredStations, readyStations, teamsReady) {
  const explicit = asArray(readiness && readiness.blockers)
  if (explicit.length > 0) return explicit
  const blockers = []
  if (requiredStations === 0) blockers.push('尚未配置可运行站点')
  if (requiredStations !== null && readyStations !== null && readyStations < requiredStations) {
    blockers.push((requiredStations - readyStations) + ' 个站点未 READY')
  }
  if (teamsReady === false) blockers.push('仍有队员未分配角色')
  return blockers
}

function unwrapProjectionEnvelope(result) {
  if (result && result.status === 'ready' && result.data) return result.data
  const status = String((result && result.status) || 'business-error')
  const code = (result && result.reasonCode)
    || (status === 'network-error' ? 'NETWORK_ERROR' : 'BUSINESS_ERROR')
  const error = directorError(code, (result && result.message) || '活动导演数据读取失败')
  error.kind = status
  if (status === 'network-error') error.network = true
  throw error
}

function normalizeClubProjection(raw) {
  if (!raw || String(raw.perspective || '').toUpperCase() !== 'CLUB') {
    throw directorError('OWNER_REQUIRED', '仅活动所属俱乐部主理人可进入导演台')
  }

  const availableActions = asArray(raw.availableActions).map(function (action) { return String(action) })
  const mayPrepareWithoutSession = !raw.club
    && String(raw.status || '').toUpperCase() === 'NOT_PREPARED'
    && raw.revision === 0
    && availableActions.indexOf('PREPARE') >= 0
  if (!raw.club && !mayPrepareWithoutSession) {
    throw directorError('OWNER_REQUIRED', '仅活动所属俱乐部主理人可进入导演台')
  }

  const club = raw.club || {}
  const sourceReadiness = club.readiness || {}
  const requiredStations = numberOrNull(sourceReadiness.requiredStations)
  const readyStations = numberOrNull(sourceReadiness.readyStations)
  const teamsReady = typeof sourceReadiness.teamsReady === 'boolean' ? sourceReadiness.teamsReady : null
  const roles = asArray(club.roles)
  const teams = asArray(club.teams)
  const canStart = String(raw.status || '').toUpperCase() === 'READY'
    && requiredStations !== null
    && requiredStations > 0
    && readyStations === requiredStations
    && teamsReady === true
    && availableActions.indexOf('START') >= 0

  return {
    sessionId: raw.sessionId == null ? null : raw.sessionId,
    activityId: raw.activityId == null ? null : raw.activityId,
    status: raw.status || '',
    revision: raw.revision == null ? null : raw.revision,
    currentChapterId: raw.currentChapterId == null ? null : raw.currentChapterId,
    chapterOptions: asArray(club.chapterOptions).filter(function (item) {
      if (!item || numberOrNull(item.chapterId) === null || item.chapterId <= 0) return false
      if (item.unlocked === true || item.unlockable === false) return false
      return true
    }),
    availableActions: availableActions,
    readiness: {
      requiredStations: requiredStations,
      readyStations: readyStations,
      teamsReady: teamsReady,
      blockers: readinessBlockers(sourceReadiness, requiredStations, readyStations, teamsReady),
      canStart: canStart,
    },
    stations: stablePrioritySort(asArray(club.stations), stationPriority),
    teams: stablePrioritySort(teams, teamPriority).map(normalizeClubTeam),
    broadcasts: asArray(club.broadcasts),
    // CU-C-76:「不能发广播」有两种原因,由后端按判据给码(NOT_RUNNING / NO_RECIPIENT)。
    // 前端自己看 teams 空不空判断等于再写一份送达判据,迟早和 insertBroadcastDeliveries 分叉。
    broadcastBlocker: typeof club.broadcastBlocker === 'string' ? club.broadcastBlocker : '',
    roles: roles,
    roleOptions: asArray(club.roleOptions),
    leaderboard: typeof club.leaderboardVisible === 'boolean'
      ? { visible: club.leaderboardVisible }
      : (club.leaderboard || null),
    // D8 现场事件:待核验与已驳回的提交。后端刻意不下发 evidence_json ——
    // 俱乐部看不到玩家提交的内容,只能打回重交。
    submissions: asArray(club.submissions),
    recap: normalizeClubRecap(club.recap),
  }
}

function resolveClient(explicitClient) {
  if (explicitClient) return explicitClient
  // 共享 client 由游戏运行时模块提供；这里保持唯一注入点，避免页面自行拼 API。
  return require('../../../utils/game-session-client.js')
}

function requireClientMethod(client, name) {
  if (!client || typeof client[name] !== 'function') {
    throw directorError('CLIENT_UNAVAILABLE', '游戏运行时暂不可用')
  }
  return client[name]
}

function resultStatus(result) {
  if (!result) return ''
  const outerStatus = String(result.status || result.state || '').toUpperCase()
  if (outerStatus) return outerStatus
  const receipt = result.receipt || result
  return String(receipt.status || receipt.receiptStatus || receipt.state || receipt.outcome || '').toUpperCase()
}

function matchingTerminalReceipt(result, command, expectedOutcome) {
  if (!result || !command || typeof command !== 'object') return null
  const receipt = result.receipt
  const receiptId = Number(receipt && receipt.receiptId)
  const revision = Number(receipt && receipt.revision)
  const requestId = String(command.requestId || '')
  const action = String(command.action || '')
  if (!receipt || !Number.isSafeInteger(receiptId) || receiptId <= 0
    || receipt.activityId == null || command.activityId == null
    || String(receipt.activityId) !== String(command.activityId)
    || !requestId || receipt.requestId !== requestId
    || !action || receipt.action !== action
    || String(receipt.outcome || '').toUpperCase() !== expectedOutcome
    || receipt.revision == null || receipt.revision === ''
    || !Number.isSafeInteger(revision) || revision < 0) return null
  if (result.requestId != null && result.requestId !== requestId) return null
  return receipt
}

function normalizeSubmitResult(result, command) {
  if (result && result.state === 'unknown-write') return result
  const status = resultStatus(result)
  const requestId = command && command.requestId
  if (status === 'SUCCESS' && matchingTerminalReceipt(result, command, 'APPLIED')) {
    return { state: 'confirmed', requestId: requestId, raw: result }
  }
  if ((status === 'BUSINESS-ERROR' || status === 'BUSINESS_ERROR')
    && matchingTerminalReceipt(result, command, 'FAILED')) {
    return { state: 'rejected', requestId: requestId, raw: result }
  }
  return { state: 'unknown-write', requestId: requestId, raw: result }
}

function normalizeReceiptResult(result, command) {
  const status = resultStatus(result)
  const requestId = command && command.requestId
  if (status === 'MATCHED' && matchingTerminalReceipt(result, command, 'APPLIED')) {
    return { state: 'confirmed', requestId: requestId, raw: result }
  }
  if ((status === 'BUSINESS-ERROR' || status === 'BUSINESS_ERROR')
    && matchingTerminalReceipt(result, command, 'FAILED')) {
    return { state: 'rejected', requestId: requestId, raw: result }
  }
  return { state: 'pending', requestId: requestId, raw: result }
}

function isUnknownError(error) {
  const code = String((error && error.code) || '').toUpperCase()
  return !!(error && error.unknown) || code === 'RESULT_UNKNOWN' || code === 'WRITE_UNKNOWN'
}

function createClubGameDirectorAdapter(explicitClient) {
  const getClient = function () { return resolveClient(explicitClient) }
  const authorizedActivities = new Map()
  const activityKey = function (activityId) { return String(activityId == null ? '' : activityId) }
  const requireAuthorized = function (activityId) {
    if (!authorizedActivities.has(activityKey(activityId))) {
      return directorError('OWNER_REQUIRED', '仅活动所属俱乐部主理人可执行导演操作')
    }
    return null
  }
  return {
    load(activityId) {
      authorizedActivities.delete(activityKey(activityId))
      const client = getClient()
      return Promise.resolve(requireClientMethod(client, 'loadProjection').call(client, CLUB_ROLE, activityId))
        .then(unwrapProjectionEnvelope)
        .then(normalizeClubProjection)
        .then(function (projection) {
          if (activityKey(projection.activityId) !== activityKey(activityId)) {
            throw directorError('PROJECTION_MISMATCH', '活动导演数据与当前活动不匹配')
          }
          authorizedActivities.set(activityKey(activityId), projection)
          return projection
        })
    },
    exportRecap(activityId) {
      const denied = requireAuthorized(activityId)
      if (denied) return Promise.reject(denied)
      const projection = authorizedActivities.get(activityKey(activityId))
      if (!projection || !projection.recap || projection.recap.exportAvailable !== true) {
        return Promise.reject(directorError('RECAP_EXPORT_UNAVAILABLE', '复盘还没生成，稍后再导出'))
      }
      const client = getClient()
      return Promise.resolve(requireClientMethod(client, 'loadClubRecapExport').call(client, activityId))
        .then(function (result) {
          if (!result || result.status !== 'ready') {
            const code = result && result.reasonCode
              ? String(result.reasonCode) : (result && result.status === 'network-error' ? 'NETWORK_ERROR' : 'RECAP_EXPORT_FAILED')
            const error = directorError(code, (result && result.message) || '复盘导出失败')
            if (result && result.status === 'network-error') error.network = true
            throw error
          }
          const normalized = normalizeClubRecapExport(result.data, activityId)
          if (!normalized) throw directorError('INVALID_RECAP_EXPORT', '复盘导出数据无效')
          return normalized
        })
    },
    submit(input) {
      const denied = requireAuthorized(input && input.activityId)
      if (denied) return Promise.reject(denied)
      const client = getClient()
      return Promise.resolve(requireClientMethod(client, 'submitAction').call(client, CLUB_ROLE, input))
        .then(function (result) { return normalizeSubmitResult(result, input) })
        .catch(function (error) {
          if (isUnknownError(error)) {
            return { state: 'unknown-write', requestId: input && input.requestId, raw: error }
          }
          throw error
        })
    },
    readReceipt(activityId, requestId, command) {
      const denied = requireAuthorized(activityId)
      if (denied) return Promise.reject(denied)
      const client = getClient()
      return Promise.resolve(requireClientMethod(client, 'readReceipt').call(client, activityId, requestId))
        .then(function (result) {
          const expected = command && String(command.activityId) === String(activityId)
            && command.requestId === requestId ? command : null
          return normalizeReceiptResult(result, expected)
        })
    },
  }
}

module.exports = {
  CLUB_ROLE,
  createClubGameDirectorAdapter,
  directorError,
  normalizeClubProjection,
  matchingTerminalReceipt,
  normalizeReceiptResult,
  normalizeSubmitResult,
  unwrapProjectionEnvelope,
}
