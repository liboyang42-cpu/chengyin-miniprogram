/* 活动导演台的状态机与处理器。
 *
 * 2026-09-03:`pages/club/game-director` 那一整页**已删除**——它的十张卡按 Figma
 * 新的全流程稿收编进本页(活动详情),渲染改用 cy-club-director-* 八个组件。
 * 但页面里这 600 行不是 UI,是**状态机与写入安全**:executeAction 的
 * 「回执未知」落盘、onReconcileUnknownWrite 对账、retryUnknownWrite 重试——
 * 这些一行都不能重写,所以整段原样搬过来,只做两处改动:
 *   · onLoad(options) → initDirector(activityId):宿主页决定何时进入
 *   · goBack 留给宿主页(活动详情有自己的返回语义)
 * 网络层仍是 utils/club-game-director-adapter.js,未动。
 */
const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
'use strict'

const { createClubGameDirectorAdapter } = require('../utils/club-game-director-adapter.js')
let requestSequence = 0

function numeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readinessText(readiness) {
  const ready = numeric(readiness && readiness.readyStations)
  const required = numeric(readiness && readiness.requiredStations)
  if (ready === null || required === null) return '站点准备数据待确认'
  return ready + '/' + required + ' 站 READY'
}

function statusText(status) {
  const labels = {
    NOT_PREPARED: '未准备',
    DRAFT: '草稿',
    PREPARING: '准备中',
    READY: '待开局',
    RUNNING: '进行中',
    FINISHED: '已结束',
    CANCELLED: '已取消',
  }
  return labels[String(status || '').toUpperCase()] || '状态待确认'
}

function stationView(station) {
  const item = station || {}
  return Object.assign({}, item, {
    nameText: item.name || item.stationName || item.nodeName || '未命名节点',
    statusText: item.status || 'UNKNOWN',
    issueText: item.issue || item.blockedReason || item.pauseReason || item.exception || '',
  })
}

function teamView(team) {
  const item = team || {}
  const completed = numeric(item.completedNodes)
  const total = numeric(item.totalNodes)
  const status = String(item.status || '').toUpperCase()
  const stuckNode = item.currentStuckNode && typeof item.currentStuckNode === 'object'
    ? item.currentStuckNode : null
  const hintLevel = numeric(item.hintLevel)
  const recentEvent = item.recentEvent && typeof item.recentEvent === 'object'
    ? item.recentEvent : null
  const eventActions = {
    CONFIRM_ROLE: '身份确认',
    PLAYER_CHOICE: '剧情选择',
    PLAYER_SUBMIT: '任务提交',
    PLAYER_HINT: '玩家提示',
    PLAYER_REVEAL: '答案揭示',
  }
  const eventOutcomes = { APPLIED: '已生效', FAILED: '未生效' }
  const actionText = eventActions[String((recentEvent && recentEvent.action) || '').toUpperCase()]
  const outcomeText = eventOutcomes[String((recentEvent && recentEvent.outcome) || '').toUpperCase()]
  const occurredAt = typeof (recentEvent && recentEvent.occurredAt) === 'string'
    ? recentEvent.occurredAt.trim() : ''
  return Object.assign({}, item, {
    nameText: item.name || item.teamName || '未命名队伍',
    statusText: item.status || 'UNKNOWN',
    progressText: completed !== null && total !== null ? completed + '/' + total + ' 节点' : '进度待确认',
    issueText: item.blockedReason || item.issue || '',
    isAbnormal: status === 'BLOCKED' || status === 'PAUSED' || status === 'ERROR'
      || !!(item.blocked || item.blockedReason || item.issue),
    stuckNodeText: stuckNode && typeof stuckNode.nodeName === 'string' && stuckNode.nodeName.trim()
      ? stuckNode.nodeName.trim() : '待确认',
    hintLevelText: hintLevel === 1 ? '一级提示' : (hintLevel === 2 ? '二级提示' : '待确认'),
    recentEventText: actionText && outcomeText
      ? [actionText, outcomeText, occurredAt].filter(Boolean).join(' · ')
      : '待确认',
  })
}

function roleOptionView(option) {
  const item = option || {}
  const roleCode = item.roleCode || item.code || item.key || ''
  return {
    roleCode: roleCode,
    label: item.roleName || item.name || item.label || roleCode || '未命名角色',
  }
}

function roleView(role) {
  const item = role || {}
  const status = String(item.confirmationStatus || item.status || '').toUpperCase()
  const labels = { CONFIRMED: '已确认', PENDING: '待确认', REJECTED: '未接受' }
  labels.ASSIGNED = '待确认'
  return Object.assign({}, item, {
    memberNameText: item.memberName || item.name || (item.memberId == null ? '成员待同步' : '成员 #' + item.memberId),
    roleNameText: item.roleName || item.roleLabel || item.roleCode || '角色待分配',
    confirmationStatus: status,
    confirmationText: !item.roleCode ? '待分配' : (labels[status] || '确认状态待同步'),
  })
}

// E-04(2026-09-16):D6 弹层的「选择成员」原来喂的是 teams(队伍行)—— 行点击没有 teamId+memberId,
// 落不到 openRoleAssignment 的定位。改成 roles 的行投影,入口与行点选共用同一份数据。
// id = "teamId:memberId";弹层只列当前队伍成员。
function roleMemberRows(roles, selectedTeamId, selectedMemberId) {
  return (Array.isArray(roles) ? roles : [])
    .filter(function (item) {
      return item && item.memberId != null && item.teamId != null
        && (selectedTeamId == null || String(item.teamId) === String(selectedTeamId))
    })
    .map(function (item) {
      return {
        id: String(item.teamId) + ':' + String(item.memberId),
        teamId: item.teamId,
        memberId: item.memberId,
        title: item.memberNameText,
        subtitle: item.roleCode ? item.roleNameText : '待分配',
        value: item.roleNameText,
        valueTone: item.roleCode ? 'default' : 'muted',
        disabled: selectedMemberId != null && String(item.memberId) === String(selectedMemberId),
      }
    })
}

function broadcastView(broadcast) {
  const item = broadcast || {}
  const targetType = String(item.targetType || item.scope || '').toUpperCase()
  const targetLabels = { ALL: '全部玩家', TEAM: '定向队伍', ROLE: '定向角色' }
  const status = String(item.receiptStatus || item.status || '').toUpperCase()
  const statusLabels = {
    CONFIRMED: '已确认送达',
    APPLIED: '已确认送达',
    SUCCESS: '已确认送达',
    REJECTED: '发送未生效',
    FAILED: '发送未生效',
    PENDING: '发送状态待确认',
    SENDING: '发送中',
    SENT: '已送达',
    PARTIAL: '部分送达',
  }
  return Object.assign({}, item, {
    contentText: item.content || '广播内容待同步',
    targetText: item.targetName || item.roleName || targetLabels[targetType] || '范围待确认',
    receiptText: statusLabels[status] || '发送状态待同步',
  })
}

function broadcastTargets(targetType, teams, roleOptions) {
  if (targetType === 'TEAM') {
    return (teams || []).filter(function (item) { return item.teamId != null }).map(function (item) {
      return { id: item.teamId, label: item.nameText, memberCount: numeric(item.memberCount) }
    })
  }
  if (targetType === 'ROLE') {
    return (roleOptions || []).map(function (item) { return { id: item.roleCode, label: item.label } })
  }
  return [{ id: '', label: '全部在场玩家' }]
}

function roleRecipientCount(roleCode, roles) {
  const rows = roles || []
  if (rows.length === 0) return null
  const completeAggregates = rows.every(function (item) {
    return !!item.roleCode && numeric(item.memberCount) !== null
  })
  if (completeAggregates) {
    return rows.reduce(function (sum, item) {
      return sum + (item.roleCode === roleCode ? item.memberCount : 0)
    }, 0)
  }
  const completeAssignments = rows.every(function (item) { return !!item.roleCode && item.memberId != null })
  if (!completeAssignments) return null
  const members = {}
  rows.forEach(function (item) {
    if (item.roleCode === roleCode) members[String(item.memberId)] = true
  })
  return Object.keys(members).length
}

function broadcastRecipientCount(targetType, selectedTarget, teams, roles) {
  if (!selectedTarget) return null
  if (targetType === 'TEAM') return numeric(selectedTarget.memberCount)
  if (targetType === 'ROLE') return roleRecipientCount(selectedTarget.id, roles)
  const rows = teams || []
  if (rows.length === 0 || rows.some(function (item) { return numeric(item.memberCount) === null })) return null
  return rows.reduce(function (sum, item) { return sum + item.memberCount }, 0)
}

function recapMetricView(metric) {
  const item = metric || {}
  const label = item.label || item.name || item.key || ''
  const value = item.value
  if (!label || value == null) return null
  return { label: label, valueText: String(value), unit: item.unit || '' }
}

function normalizedPositiveId(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function isConfirmedRoleSource(item) {
  const source = item || {}
  return !!source.roleCode
    && String(source.confirmationStatus || source.status || '').toUpperCase() === 'CONFIRMED'
}

function takeoverPayload(roles, draft) {
  const source = draft || {}
  const teamId = normalizedPositiveId(source.teamId)
  const sourceMemberId = normalizedPositiveId(source.sourceMemberId)
  const targetMemberId = normalizedPositiveId(source.targetMemberId)
  const reason = String(source.reason || '').trim()
  if (!teamId || !sourceMemberId || !targetMemberId || sourceMemberId === targetMemberId
    || !reason || reason.length > 200) return null
  const rows = Array.isArray(roles) ? roles : []
  const sourceRow = rows.find(function (item) {
    return String(item.teamId) === String(teamId) && String(item.memberId) === String(sourceMemberId)
  })
  const targetRow = rows.find(function (item) {
    return String(item.teamId) === String(teamId) && String(item.memberId) === String(targetMemberId)
  })
  if (!isConfirmedRoleSource(sourceRow) || !targetRow || targetRow.roleCode) return null
  return { teamId, sourceMemberId, targetMemberId, reason }
}

// 5-04:D7 的范围 chip 选项。通用 chip 组件要 {id,label},原来喂的是字符串数组 → 标签空白、
// 点击也切不动;这里在宿主页投影,组件协议不动。
const BROADCAST_SCOPE_OPTIONS = [
  { id: 'ALL', label: '全部玩家' },
  { id: 'TEAM', label: '按队伍' },
  { id: 'ROLE', label: '按角色' },
]

function hasAction(actions, action) {
  return Array.isArray(actions) && actions.indexOf(action) >= 0
}

// CU-C-76(2026-09-24 走查):「不能发」有两种,以前说出来的只有一种。
// 后端投影按判据给原因码(场次没跑起来 / 跑起来了但没人可送达),这里只负责把码念成人话。
// NO_RECIPIENT 的句子必须带下一步 —— 走查抱怨的是「只说不能,不说怎样才能」。
const BROADCAST_BLOCKER_TEXT = {
  NO_RECIPIENT: '本场还没有可送达的玩家。等玩家报名进场后,这里才能发送。',
}

function broadcastBlockerText(blocker, sessionStatusText) {
  const specific = BROADCAST_BLOCKER_TEXT[String(blocker || '').toUpperCase()]
  if (specific) return specific
  return '只有本场进行中才能发送' + (sessionStatusText ? '（当前 ' + sessionStatusText + '）' : '') + '。'
}

// 发送被后端驳回时的原因码 → 文案。GAME_BROADCAST_NO_RECIPIENT 是投影算完到点发送之间的
// 时间窗里没人进场,光说「操作未生效」等于让人再点一次。认不出的原因交 null,由调用方留原话。
const BROADCAST_REJECTED_TEXT = {
  GAME_BROADCAST_NO_RECIPIENT: '刚刚没有可送达的玩家了，广播没有发出。等玩家报名进场后再发。',
}

function rejectedActionText(action, result) {
  const code = String((result && result.reasonCode) || '').toUpperCase()
  if (action === 'BROADCAST' && BROADCAST_REJECTED_TEXT[code]) return BROADCAST_REJECTED_TEXT[code]
  return null
}

function classifyLoadError(error) {
  const code = String((error && error.code) || '').toUpperCase()
  if (code === 'SESSION_NOT_FOUND' || code === 'NOT_FOUND') return 'empty'
  if (error && (error.network === true || error.kind === 'network-error' || code === 'NETWORK_ERROR')) {
    return 'network-error'
  }
  return 'business-error'
}

function nextRequestId(activityId) {
  requestSequence += 1
  return 'gd-' + activityId + '-' + Date.now() + '-' + requestSequence
}

function pendingWriteKey(activityId) {
  let memberId = ''
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    memberId = app && app.getUserID ? app.getUserID() : ''
  } catch (_) {}
  return memberId === null || memberId === undefined || memberId === '' || !activityId
    ? '' : 'cy.gameDirector.pendingWrite.m' + memberId + '.a' + String(activityId)
}

function legacyPendingWriteKey(activityId) {
  return 'cy.gameDirector.pendingWrite.' + String(activityId || '')
}

function normalizePendingReceiptIndex(value, activityId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const allowedKeys = ['activityId', 'requestId', 'action', 'nodeId', 'expectedRevision']
  if (Object.keys(value).some(function (key) { return allowedKeys.indexOf(key) < 0 })) return null
  const requestId = String(value.requestId || '')
  const action = String(value.action || '')
  const revision = Number(value.expectedRevision)
  const nodeId = value.nodeId == null ? null : Number(value.nodeId)
  if (String(value.activityId) !== String(activityId)
    || !/^[A-Za-z0-9_-]{8,64}$/.test(requestId) || !action
    || !Number.isSafeInteger(revision) || revision < 0
    || (nodeId !== null && (!Number.isSafeInteger(nodeId) || nodeId <= 0))) return null
  return {
    activityId: String(activityId),
    nodeId: nodeId,
    requestId: requestId,
    expectedRevision: revision,
    action: action,
  }
}

function readPendingWrite(activityId) {
  const key = pendingWriteKey(activityId)
  try {
    wx.removeStorageSync(legacyPendingWriteKey(activityId))
    const value = key ? wx.getStorageSync(key) : null
    const receiptIndex = normalizePendingReceiptIndex(value, activityId)
    if (receiptIndex) return receiptIndex
    if (value) wx.removeStorageSync(key)
  } catch (_) {}
  return null
}

function savePendingWrite(activityId, command) {
  const key = pendingWriteKey(activityId)
  if (!key) return false
  try {
    wx.setStorageSync(key, {
      activityId: String(activityId),
      nodeId: command.nodeId == null ? null : command.nodeId,
      requestId: command.requestId,
      expectedRevision: command.expectedRevision,
      action: command.action,
    })
    return true
  } catch (_) {
    return false
  }
}

function clearPendingWrite(activityId) {
  try {
    const key = pendingWriteKey(activityId)
    if (key) wx.removeStorageSync(key)
    const legacyKey = legacyPendingWriteKey(activityId)
    if (wx.getStorageSync(legacyKey)) wx.removeStorageSync(legacyKey)
  } catch (_) {}
}


// 导演台自己的 data 默认值。宿主页把它并进自己的 data —— 键名保持原样,
// 组件与合同都按这些名字对。
// 预计恢复时间:后端强制必填,不接受「暂停到不知道什么时候」。
function resumeEtaIn(minutes) {
  const d = new Date(Date.now() + minutes * 60 * 1000)
  const pad = function (n) { return n < 10 ? '0' + n : String(n) }
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00'
}

// Figma D8「现场事件」的事件清单。三类都从已有投影推出:
//   商家暂停   = 站点 status=PAUSED(带原因、预计恢复、兜底方案绑没绑)
//   待核验积压 = 站点 pendingVerificationCount > 0
//   提交       = submissions 里 PENDING(可打回)/ REJECTED(已打回,只读)
// ⚠️ 俱乐部拿不到 evidence_json,所以只出「驳回重交」,不出「通过」。
function incidentRows(stations, submissions) {
  const rows = []
  const list = Array.isArray(stations) ? stations : []
  for (let i = 0; i < list.length; i++) {
    const st = list[i]
    if (!st || st.nodeId == null) continue
    if (st.status === 'PAUSED') {
      rows.push({
        key: 'pause:' + st.nodeId,
        kind: 'PAUSED',
        nodeId: st.nodeId,
        label: '商家暂停',
        text: (st.nodeName || '未命名站点') + ' · ' + (st.pauseReason || st.pauseReasonCode || '未填原因')
          + (st.resumeEta ? ('，预计 ' + st.resumeEta + ' 恢复') : ''),
        // 绑了兜底方案的,玩家走到兜底站点会自动记「兜底完成」—— 不是这里点出来的
        sub: st.fallbackPlanCode ? ('已绑兜底方案 ' + st.fallbackPlanCode) : '未绑兜底方案',
        planOptions: Array.isArray(st.fallbackPlanOptions) ? st.fallbackPlanOptions : [],
      })
    } else if (Number(st.pendingVerificationCount) > 0) {
      rows.push({
        key: 'backlog:' + st.nodeId,
        kind: 'BACKLOG',
        nodeId: st.nodeId,
        label: '待核验积压',
        text: (st.nodeName || '未命名站点') + ' · ' + st.pendingVerificationCount + ' 条待商家核验',
        sub: '',
        planOptions: Array.isArray(st.fallbackPlanOptions) ? st.fallbackPlanOptions : [],
      })
    }
  }
  const subs = Array.isArray(submissions) ? submissions : []
  for (let i = 0; i < subs.length; i++) {
    const sm = subs[i]
    if (!sm || sm.submissionId == null) continue
    const rejected = sm.status === 'REJECTED'
    rows.push({
      key: 'sub:' + sm.submissionId,
      kind: rejected ? 'REJECTED' : 'PENDING_SUBMIT',
      submissionId: sm.submissionId,
      label: rejected ? '任务驳回' : '待核验提交',
      text: (sm.teamId ? ('队 ' + sm.teamId + ' · ') : '') + (sm.nodeName || '未命名站点')
        + (rejected ? ' 已驳回待重交' : ' 提交待核验'),
      sub: rejected ? (sm.decisionReason || '') : '',
      planOptions: [],
    })
  }
  return rows
}

// 5-01:通用行组件 cy-club-director-row-list 只认 {id,title,subtitle} 并把点击回传成
// {id}(组件协议不改,别的页面也在用)。事件行的内部字段名是 key/label/text,
// 在喂给组件之前统一投影 —— 少这一层,整列空白、点不中。
function incidentRowList(stations, submissions) {
  return incidentRows(stations, submissions).map(function (row) {
    return Object.assign({}, row, { id: row.key, title: row.label, subtitle: row.text })
  })
}

// 选中一条事件后,处理方式只出**这条事件真能做**的那些。
// 已驳回是终态,没有可执行动作 —— 「没有动作」本身就是一种状态,不给假选项。
function incidentModesFor(row) {
  if (!row) return []
  if (row.kind === 'PAUSED') return [{ id: 'resume', label: '恢复本站' }]
  if (row.kind === 'BACKLOG') return [{ id: 'pause', label: '暂停本站' }]
  if (row.kind === 'PENDING_SUBMIT') return [{ id: 'reject', label: '驳回重交' }]
  return []
}

const DIRECTOR_DATA = {
    // 导航高度由宿主页(活动详情)提供,这里不重复取 —— 顺带让本模块不依赖
    // getApp(),可以被单测直接 require 进来跑状态机。
    loadState: 'loading',
    errorText: '',
    sessionStatusText: '状态待确认',
    revision: null,
    chapterOptions: [],
    chapterOptionLabels: [],
    readiness: { requiredStations: null, readyStations: null, teamsReady: null, canStart: false },
    readinessText: '站点准备数据待确认',
    canPrepare: false,
    blockers: [],
    incidentRows: [],
    incidentSelectedKey: '',
    incidentModes: [],
    incidentMode: '',
    stations: [],
    teams: [],
    roles: [],
    // E-04:D6 弹层成员行(roles 的可定位投影,id="teamId:memberId")
    roleMemberRows: [],
    roleOptionLabels: [],
    // 5-02:D6 角色 chip 的选项({id:roleCode,label});原来直接喂 roles 行 → 整排空白
    roleOptions: [],
    canAssignRoles: false,
    roleSheetVisible: false,
    roleDraft: { teamId: null, memberId: null, memberName: '', roleIndex: 0, roleCode: '' },
    canTakeoverRoles: false,
    takeoverSheetVisible: false,
    takeoverTargetLabels: [],
    takeoverDraft: {
      teamId: null, sourceMemberId: null, sourceMemberName: '', targetIndex: 0, targetMemberId: null, reason: '',
    },
    broadcasts: [],
    canBroadcast: false,
    // CU-C-76:不可发送的原因码与那句解释都由投影算好放这里,置灰行直接念
    broadcastBlocker: '',
    broadcastDisabledText: '',
    broadcastSheetVisible: false,
    // 5-04:D7 范围 chip 是 {id,label};目标行是 {id,title} 投影(组件读 detail.id 回传)
    broadcastScopeOptions: BROADCAST_SCOPE_OPTIONS,
    broadcastTargetRows: [],
    broadcastPreviewReady: false,
    broadcastPreviewText: '广播范围人数待确认',
    broadcastDraft: { targetType: 'ALL', targetIndex: 0, content: '' },
    canUnlockChapter: false,
    unlockSheetVisible: false,
    unlockChapterIndex: 0,
    unlockReason: '',
    leaderboard: null,
    leaderboardVisibleKnown: false,
    canToggleLeaderboard: false,
    recap: null,
    recapMetrics: [],
    canExportRecap: false,
    exportState: 'idle',
    canFinish: false,
    writeState: 'idle',
    writeMessage: '',
    writeLocked: false,
    canRetryUnknownWrite: false,
}

const DIRECTOR_METHODS = {
  /* ——— Figma D8 现场事件的三个处理动作 ———
   * 组件(club-director-incident-sheet)只负责展示与抛事件,写入在这里。
   * 三个动作走 CLUB_ 前缀的俱乐部专用 action —— 不复用商家那三个词:
   * 那些词的实现写死了「站点属于当前商家」,俱乐部走进去必然被拒。
   */
  onIncidentSelect(e) {
    // 组件回传 {id}(= incidentRowList 投影出来的 row.id);detail.key 只为老测试夹具兼容。
    const key = String((e.detail && (e.detail.id || e.detail.key)) || '')
    const row = (this.data.incidentRows || []).find(function (x) { return String(x.id) === key })
    const modes = incidentModesFor(row)
    this.setData({
      incidentSelectedKey: key,
      incidentModes: modes,
      // 只有一个可选动作时直接选中,省一次点击;没有可选动作时清空
      incidentMode: modes.length === 1 ? modes[0].id : '',
    })
  },

  onIncidentModeChange(e) {
    this.setData({ incidentMode: (e.detail && (e.detail.value || e.detail.id)) || '' })
  },

  submitIncident() {
    if (this.data.writeLocked) return
    const row = (this.data.incidentRows || []).find(
      (x) => String(x.id) === String(this.data.incidentSelectedKey))
    if (!row) { toast('先选一条要处理的事件'); return }
    const mode = this.data.incidentMode
    if (!mode) { toast('先选处理方式'); return }
    const that = this

    if (mode === 'resume') {
      this.setData({ incidentSheetVisible: false })
      this.executeAction('CLUB_STATION_RESUME', {}, row.nodeId)
      return
    }

    if (mode === 'reject') {
      modal.show({
        danger: true,
        title: '驳回重交',
        content: '',
        editable: true,
        placeholderText: '驳回原因（至少 2 个字，玩家会看到）',
        confirmText: '确认驳回',
        cancelText: '再想想',
        success(r) {
          if (!r.confirm) return
          const reason = (r.content || '').trim()
          // 和商家驳回同一条:驳回必须给原因,否则玩家不知道要改什么
          if (reason.length < 2) { toast('请填写驳回原因'); return }
          that.setData({ incidentSheetVisible: false })
          that.executeAction('CLUB_REJECT_SUBMISSION', {
            submissionId: row.submissionId, reasonCode: 'ONSITE_REJECT', reason: reason,
          })
        },
      })
      return
    }

    // 暂停本站:后端要原因 + 预计恢复时间;备用方案 R9-38 起选填(clubStationPause 无方案不绑兜底)。
    // 方案不是这里挑的:没有 → 只停本站;恰好一个 → 带上;多个 → 不替主理人挑也不丢,去后台指定。
    const plans = row.planOptions || []
    if (plans.length > 1) {
      toast('有多个备用方案，请到后台指定')
      return
    }
    const plan = plans[0]
    modal.show({
      danger: true,
      title: '暂停本站',
      content: plan
        ? '暂停只影响本站，不改变已发放的权益与已完成的提交。'
        : '这一站没有已批准的备用方案：玩家会看到本站暂停和预计恢复时间，不会被引导到其他站点。',
      editable: true,
      placeholderText: '暂停原因（至少 2 个字，会同步给商家与玩家）',
      confirmText: '确认暂停',
      cancelText: '再想想',
      success(r) {
        if (!r.confirm) return
        const reason = (r.content || '').trim()
        if (reason.length < 2) { toast('请填写暂停原因'); return }
        that.setData({ incidentSheetVisible: false })
        const payload = { reasonCode: 'ONSITE', reason: reason, resumeEta: resumeEtaIn(30) }
        if (plan) {
          payload.fallbackPlanCode = plan.planCode
          payload.fallbackPlanVersion = plan.version
        }
        that.executeAction('CLUB_STATION_PAUSE', payload, row.nodeId)
      },
    })
  },


  _getAdapter() {
    if (!this._directorAdapter) this._directorAdapter = createClubGameDirectorAdapter()
    return this._directorAdapter
  },

  // 原 game-director 页的 onLoad。那一页已删,逻辑一行未改地搬到这里,
  // 由宿主页(活动详情)在自己的 onLoad 里按需调用 —— 只有拿得到 activityId
  // 且当前身份能管活动时才进导演台那套状态机。
  initDirector(activityId) {
    this._activityId = activityId || null
    const pendingWrite = activityId ? readPendingWrite(activityId) : null
    this._pendingCommand = null
    this._pendingReceiptIndex = pendingWrite
    this._unknownRequestId = pendingWrite ? pendingWrite.requestId : ''
    this._autoReceiptStarted = false
    this.setData({
      writeState: pendingWrite ? 'unknown-write' : 'idle',
      writeMessage: pendingWrite ? '检测到上次未确认的操作，正在准备核对' : '',
      writeLocked: !!pendingWrite,
      canRetryUnknownWrite: false,
    })
    if (!activityId) {
      this.setData({ loadState: 'empty', errorText: '缺少活动标识' })
      return
    }
    this.loadProjection()
  },

  loadProjection() {
    const that = this
    if (!this._activityId) return
    this.setData({ loadState: 'loading', errorText: '' })
    this._getAdapter().load(this._activityId).then(function (projection) {
      that.applyProjection(projection)
    }).catch(function (error) {
      that.setData({
        loadState: classifyLoadError(error),
        errorText: (error && error.message) || '活动导演台暂时无法打开',
      })
    })
  },

  applyProjection(projection) {
    const that = this
    const readiness = projection.readiness || {}
    const availableActions = projection.availableActions || []
    const roleOptions = (projection.roleOptions || []).map(roleOptionView).filter(function (item) { return !!item.roleCode })
    const leaderboard = projection.leaderboard || null
    const leaderboardVisibleKnown = !!leaderboard && typeof leaderboard.visible === 'boolean'
    const recap = projection.recap || null
    this._roleOptions = roleOptions
    this._takeoverTargetOptions = []
    this._broadcastTargetOptions = []
    const chapterOptions = (projection.chapterOptions || []).filter(function (item) {
      return item && numeric(item.chapterId) !== null && item.chapterId > 0
        && (projection.currentChapterId == null || String(item.chapterId) !== String(projection.currentChapterId))
    }).map(function (item) {
      // 5-04(D4):行组件按 id 找行、回传 {id};缺 id 的章节行点哪一行都落回第 0 项。
      return { id: item.chapterId, chapterId: item.chapterId, title: item.title || '章节 #' + item.chapterId }
    })
    // 宿主页(index.js)提供 applyProjectionStatus:场次状态 → 页面六态。director 与宿主是同一个 Page 作用域。
    // 契约测试用裸 host 装载 director,没有这个方法;真页面(index.js)一定有
    if (typeof this.applyProjectionStatus === 'function') this.applyProjectionStatus(projection.status)
    this.setData({
      loadState: 'ready',
      errorText: '',
      sessionStatusText: statusText(projection.status),
      revision: projection.revision,
      chapterOptions: chapterOptions,
      chapterOptionLabels: chapterOptions.map(function (item) { return item.title }),
      readiness: readiness,
      readinessText: readinessText(readiness),
      canPrepare: hasAction(availableActions, 'PREPARE'),
      blockers: Array.isArray(readiness.blockers) ? readiness.blockers : [],
      // D8 现场事件:全部由已有投影推出,不新造事实。
      // 站点暂停 / 待核验积压来自 stations,待核验与已驳回的提交来自 submissions。
      incidentRows: incidentRowList(projection.stations, projection.submissions),
      stations: (projection.stations || []).map(stationView),
      teams: (projection.teams || []).map(teamView),
      roles: (projection.roles || []).map(roleView),
      // E-04:D6 弹层的成员行(带 teamId+memberId 的可定位 id)
      roleMemberRows: roleMemberRows((projection.roles || []).map(roleView), (projection.teams || []).map(teamView)),
      roleOptions: roleOptions.map(function (item) { return { id: item.roleCode, label: item.label } }),
      roleOptionLabels: roleOptions.map(function (item) { return item.label }),
      canAssignRoles: hasAction(availableActions, 'ASSIGN_ROLES') && roleOptions.length > 0,
      canTakeoverRoles: hasAction(availableActions, 'TAKEOVER_ROLE'),
      broadcasts: (projection.broadcasts || []).map(broadcastView),
      // CU-C-76:BROADCAST 在 availableActions 里只代表「本场允许有这个动作」,
      // 真正发得出去与否看后端另给的 broadcastBlocker(零成员的场子不能让人点进去才发现)。
      broadcastBlocker: projection.broadcastBlocker || '',
      broadcastDisabledText: broadcastBlockerText(projection.broadcastBlocker, statusText(projection.status)),
      canBroadcast: hasAction(availableActions, 'BROADCAST') && !projection.broadcastBlocker,
      canUnlockChapter: hasAction(availableActions, 'UNLOCK_CHAPTER') && chapterOptions.length > 0,
      leaderboard: leaderboard,
      leaderboardVisibleKnown: leaderboardVisibleKnown,
      canToggleLeaderboard: leaderboardVisibleKnown && hasAction(availableActions, 'SET_LEADERBOARD_VISIBILITY'),
      recap: recap,
      recapMetrics: recap && Array.isArray(recap.metrics)
        ? recap.metrics.map(recapMetricView).filter(function (item) { return !!item })
        : [],
      canExportRecap: !!(recap && recap.exportAvailable === true),
      canFinish: hasAction(availableActions, 'FINISH'),
    }, function () {
      if (that.data.writeLocked && that._unknownRequestId && !that._autoReceiptStarted) {
        that._autoReceiptStarted = true
        that.onReconcileUnknownWrite()
      }
    })
    // 角色/接管权限刚落地,立刻重算接管候选(守卫在宿主页,见 index.js)
    if (typeof this.refreshTakeoverCandidates === 'function') this.refreshTakeoverCandidates()
    if (typeof this.refreshTeamRows === 'function') this.refreshTeamRows()
  },

  openRoleAssignment(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {}
    this.openRoleRow(dataset.teamId, dataset.memberId)
  },

  // E-04(2026-09-16):统一入口。原来只有「从某行带 teamId+memberId 点进来」一条路,
  // 而页面上根本没有任何行会带这两个值 —— 弹层因此永远打不开。
  // 现在「现场工具 → 角色分配」与弹层内选成员都走这里。
  openRoleRow(teamId, memberId) {
    if (this.data.writeLocked) return
    if (!this.data.canAssignRoles) {
      toast('当前不能调整角色')
      return
    }
    const row = (this.data.roles || []).find(function (item) {
      return String(item.teamId) === String(teamId) && String(item.memberId) === String(memberId)
    })
    if (!row || row.teamId == null || row.memberId == null) {
      toast('成员信息待同步')
      return
    }
    const roleOptions = this._roleOptions || []
    let roleIndex = roleOptions.findIndex(function (item) { return item.roleCode === row.roleCode })
    if (roleIndex < 0) roleIndex = 0
    const selected = roleOptions[roleIndex]
    this.setData({
      roleSheetVisible: true,
      roleMemberRows: roleMemberRows(this.data.roles, row.teamId, row.memberId),
      roleDraft: {
        teamId: row.teamId,
        memberId: row.memberId,
        memberName: row.memberNameText,
        roleIndex: roleIndex,
        roleCode: selected ? selected.roleCode : '',
      },
    })
  },

  // 现场工具入口:先开弹层,成员从 roleMemberRows 里选(选中后按 id 回落到 openRoleRow)
  openRoleSheet() {
    if (this.data.writeLocked) return
    if (!this.data.canAssignRoles) {
      toast('当前不能调整角色')
      return
    }
    if (!(this.data.roleMemberRows || []).length) {
      toast('还没有可分角色的成员')
      return
    }
    this.setData({ roleSheetVisible: true })
  },

  onRoleMemberPick(e) {
    const id = String((e && e.detail && e.detail.id) || '')
    const parts = id.split(':')
    if (parts.length !== 2) return
    this.openRoleRow(parts[0], parts[1])
  },

  onRoleOptionChange(e) {
    // chip 组件回传 {id: roleCode}(旧写法读 detail.value 恒为 NaN → 永远选不中)
    const picked = String((e && e.detail && e.detail.id) || '')
    const index = (this._roleOptions || []).findIndex(function (item) { return String(item.roleCode) === picked })
    const option = index >= 0 ? this._roleOptions[index] : null
    if (!option) return
    this.setData({ roleDraft: Object.assign({}, this.data.roleDraft, { roleIndex: index, roleCode: option.roleCode }) })
  },

  closeRoleAssignment() {
    if (this.data.writeLocked) return
    this.setData({ roleSheetVisible: false })
  },

  confirmRoleAssignment() {
    if (this.data.writeLocked) return
    const draft = this.data.roleDraft || {}
    if (!this.data.canAssignRoles || draft.teamId == null || draft.memberId == null || !draft.roleCode) {
      toast('请先选择有效角色')
      return
    }
    this.setData({ roleSheetVisible: false })
    this.executeAction('ASSIGN_ROLES', {
      teamId: draft.teamId,
      assignments: [{ memberId: draft.memberId, roleCode: draft.roleCode }],
    })
  },

  openTakeoverRole(e) {
    if (this.data.writeLocked) return
    if (!this.data.canTakeoverRoles) {
      toast('当前不能接管角色')
      return
    }
    // 5-03:行组件只回传 {id}(= "teamId:memberId"),没有 currentTarget.dataset ——
    // 旧写法读 dataset 恒为空,点哪一行都提示「来源角色待确认」。
    const picked = String((e && e.detail && e.detail.id) || '')
    const parts = picked.split(':')
    const source = parts.length === 2 ? this.data.roles.find(function (item) {
      return String(item.teamId) === parts[0] && String(item.memberId) === parts[1]
    }) : null
    if (!source || !isConfirmedRoleSource(source) || source.teamId == null || source.memberId == null) {
      toast('来源角色待确认')
      return
    }
    const targets = this.data.roles.filter(function (item) {
      return String(item.teamId) === String(source.teamId)
        && String(item.memberId) !== String(source.memberId)
        && item.memberId != null && !item.roleCode
    })
    if (!targets.length) {
      toast('同队没有待分配成员')
      return
    }
    this._takeoverTargetOptions = targets
    this.setData({
      takeoverSheetVisible: true,
      takeoverTargetLabels: targets.map(function (item) { return item.memberNameText }),
      takeoverDraft: {
        teamId: source.teamId,
        sourceMemberId: source.memberId,
        sourceMemberName: source.memberNameText,
        targetIndex: 0,
        targetMemberId: targets[0].memberId,
        reason: '',
      },
    })
  },

  onTakeoverTargetChange(e) {
    const index = Number(e && e.detail && e.detail.value)
    const target = (this._takeoverTargetOptions || [])[index]
    if (!target) return
    this.setData({ takeoverDraft: Object.assign({}, this.data.takeoverDraft, {
      targetIndex: index, targetMemberId: target.memberId,
    }) })
  },

  onTakeoverReasonInput(e) {
    this.setData({ takeoverDraft: Object.assign({}, this.data.takeoverDraft, {
      reason: String((e && e.detail && e.detail.value) || ''),
    }) })
  },

  closeTakeoverRole() {
    if (this.data.writeLocked) return
    this.setData({ takeoverSheetVisible: false })
  },

  confirmTakeoverRole() {
    if (this.data.writeLocked) return
    if (!this.data.canTakeoverRoles) {
      toast('当前不能接管角色')
      return
    }
    const payload = takeoverPayload(this.data.roles, this.data.takeoverDraft)
    if (!payload) {
      toast('请选同队待分配成员并填写原因')
      return
    }
    this.setData({ takeoverSheetVisible: false })
    this.executeAction('TAKEOVER_ROLE', payload)
  },

  _setBroadcastTargetType(targetType) {
    const normalized = ['ALL', 'TEAM', 'ROLE'].indexOf(targetType) >= 0 ? targetType : 'ALL'
    const targets = broadcastTargets(normalized, this.data.teams, this._roleOptions || [])
    const selected = targets[0] || null
    const recipientCount = broadcastRecipientCount(normalized, selected, this.data.teams, this.data.roles)
    const targetLabel = selected ? selected.label : '定向范围待选择'
    this._broadcastTargetOptions = targets
    this.setData({
      // 5-04:行组件要 {id,title} 并回传 {id};原来喂的是 teamView 原始行 → 空白且点不中
      broadcastTargetRows: targets.map(function (item) { return { id: item.id, title: item.label } }),
      broadcastPreviewReady: recipientCount !== null && recipientCount > 0 && !!selected,
      broadcastPreviewText: targetLabel + (recipientCount === null ? ' · 人数待确认' : ' · ' + recipientCount + ' 人'),
      broadcastDraft: {
        targetType: normalized,
        targetIndex: 0,
        content: (this.data.broadcastDraft && this.data.broadcastDraft.content) || '',
      },
    })
  },

  openBroadcast() {
    if (this.data.writeLocked) return
    if (!this.data.canBroadcast) {
      toast(this.data.broadcastDisabledText || '当前不能发送广播')
      return
    }
    this.setData({ broadcastSheetVisible: true, broadcastDraft: { targetType: 'ALL', targetIndex: 0, content: '' } })
    this._setBroadcastTargetType('ALL')
  },

  closeBroadcast() {
    if (this.data.writeLocked) return
    this.setData({ broadcastSheetVisible: false })
  },

  selectBroadcastTargetType(e) {
    if (this.data.writeLocked) return
    // chip 组件回传 {id}(旧写法读 currentTarget.dataset → 恒空 → 永远回落 ALL)
    const targetType = String((e && e.detail && e.detail.id) || '').toUpperCase()
    this._setBroadcastTargetType(targetType)
  },

  onBroadcastTargetChange(e) {
    const picked = String((e && e.detail && e.detail.id) == null ? '' : e.detail.id)
    const index = (this._broadcastTargetOptions || []).findIndex(function (item) {
      return String(item.id) === picked
    })
    const selected = index >= 0 ? this._broadcastTargetOptions[index] : null
    if (!selected) return
    const targetType = this.data.broadcastDraft.targetType
    const recipientCount = broadcastRecipientCount(targetType, selected, this.data.teams, this.data.roles)
    this.setData({
      broadcastPreviewReady: recipientCount !== null && recipientCount > 0,
      broadcastPreviewText: selected.label + (recipientCount === null ? ' · 人数待确认' : ' · ' + recipientCount + ' 人'),
      broadcastDraft: Object.assign({}, this.data.broadcastDraft, { targetIndex: index }),
    })
  },

  onBroadcastContentInput(e) {
    const content = String((e && e.detail && e.detail.value) || '')
    this.setData({ broadcastDraft: Object.assign({}, this.data.broadcastDraft, { content: content }) })
  },

  confirmBroadcast() {
    if (this.data.writeLocked) return
    const draft = this.data.broadcastDraft || {}
    const content = String(draft.content || '').trim()
    const selected = (this._broadcastTargetOptions || [])[draft.targetIndex]
    if (!this.data.canBroadcast || !this.data.broadcastPreviewReady || !selected) {
      toast('接收范围待确认，暂不能发送')
      return
    }
    if (!content) {
      toast('请输入广播内容')
      return
    }
    const payload = { targetType: draft.targetType, content: content }
    if (draft.targetType === 'TEAM') payload.targetId = selected.id
    if (draft.targetType === 'ROLE') payload.roleCode = selected.id
    this.setData({ broadcastSheetVisible: false })
    this.executeAction('BROADCAST', payload)
  },

  openManualUnlock() {
    if (this.data.writeLocked) return
    if (!this.data.canUnlockChapter || this.data.chapterOptions.length === 0) {
      toast('当前没有可解锁的章节')
      return
    }
    this.setData({ unlockSheetVisible: true, unlockChapterIndex: 0, unlockReason: '' })
  },

  closeManualUnlock() {
    if (this.data.writeLocked) return
    this.setData({ unlockSheetVisible: false })
  },

  onUnlockReasonInput(e) {
    this.setData({ unlockReason: String((e && e.detail && e.detail.value) || '') })
  },

  onUnlockChapterChange(e) {
    // 行组件回传 {id}(= chapterId),按 id 反查索引;旧写法读 detail.value 恒 NaN → 永远解第 1 章
    const picked = String((e && e.detail && e.detail.id) == null ? '' : e.detail.id)
    const index = (this.data.chapterOptions || []).findIndex(function (item) {
      return String(item.id) === picked
    })
    if (index < 0 || !this.data.chapterOptions[index]) return
    this.setData({ unlockChapterIndex: index })
  },

  confirmManualUnlock() {
    if (this.data.writeLocked) return
    const reason = String(this.data.unlockReason || '').trim()
    const selected = this.data.chapterOptions[this.data.unlockChapterIndex]
    if (!this.data.canUnlockChapter || !selected || !reason) {
      toast('请填写手动解锁原因')
      return
    }
    this.setData({ unlockSheetVisible: false })
    this.executeAction('UNLOCK_CHAPTER', { chapterId: selected.chapterId, reason: reason })
  },

  onToggleLeaderboard() {
    if (this.data.writeLocked) return
    if (!this.data.canToggleLeaderboard || !this.data.leaderboardVisibleKnown) {
      toast('当前版本暂不能调整榜单')
      return
    }
    const visible = !this.data.leaderboard.visible
    const that = this
    modal.show({
      title: visible ? '显示榜单' : '隐藏榜单',
      content: visible ? '确认对玩家显示当前榜单？' : '隐藏后玩家将暂时看不到榜单。',
      confirmText: '确认',
      success(result) { if (result.confirm) that.executeAction('SET_LEADERBOARD_VISIBILITY', { visible: visible }) },
    })
  },

  // 「结束活动」的确认已由宿主页的 T2 居中确认(cy-club-director-end-confirm)承担,
  // 这里不再叠第二道弹窗(2026-09-05 审核:双重确认)。
  onFinishSession() {
    if (this.data.writeLocked) return
    if (!this.data.canFinish) {
      toast('当前不能结束活动')
      return
    }
    this.executeAction('FINISH', {})
  },

  copyRecap() {
    if (!this.data.canExportRecap || this.data.exportState === 'loading') {
      toast('复盘还没生成，稍后再导出')
      return false
    }
    const that = this
    this.setData({ exportState: 'loading' })
    this._getAdapter().exportRecap(this._activityId).then(function (data) {
      let text
      try { text = JSON.stringify(data) } catch (_) { text = '' }
      if (!text) throw new Error('复盘导出数据无效')
      wx.setClipboardData({
        data: text,
        success() {
          that.setData({ exportState: 'idle' })
          toast.success('复盘数据已复制')
        },
        fail() {
          that.setData({ exportState: 'idle' })
          toast('复制失败，请稍后重试')
        },
      })
    }).catch(function (error) {
      that.setData({ exportState: 'idle' })
      const network = error && (error.network === true || String(error.code || '').toUpperCase() === 'NETWORK_ERROR')
      toast(network ? '网络异常，复制失败' : '复盘数据复制失败')
    })
    return true
  },

  onStartSession() {
    if (this.data.writeLocked) return
    if (!this.data.readiness || !this.data.readiness.canStart) {
      toast('准备未完成，暂时不能开局')
      return
    }
    const that = this
    modal.show({
      title: '确认开局',
      content: '开局后玩家将按当前角色和节点状态进入活动。',
      confirmText: '开始活动',
      success(result) { if (result.confirm) that.executeAction('START', {}) },
    })
  },

  onPrepareSession() {
    if (this.data.writeLocked) return
    if (!this.data.canPrepare) {
      toast('当前不能进入准备')
      return
    }
    const that = this
    modal.show({
      title: '进入准备',
      content: '进入后将开始收集站点和队伍 READY 状态。',
      confirmText: '开始准备',
      success(result) { if (result.confirm) that.executeAction('PREPARE', {}) },
    })
  },

  executeAction(action, payload, nodeId) {
    if (this.data.writeLocked) return
    if (this.data.loadState !== 'ready') return
    if (this.data.revision == null) {
      toast('状态版本待确认，请先重新加载')
      return
    }
    if (action === 'TAKEOVER_ROLE') {
      if (!this.data.canTakeoverRoles) return
      const normalizedTakeover = takeoverPayload(this.data.roles, payload)
      if (!normalizedTakeover) return
      payload = normalizedTakeover
    }
    const that = this
    const requestId = nextRequestId(this._activityId)
    const command = {
      activityId: this._activityId,
      nodeId: nodeId == null ? null : nodeId,
      requestId: requestId,
      expectedRevision: this.data.revision,
      action: action,
      payload: payload || {},
    }
    this.setData({
      writeState: 'submitting',
      writeMessage: '正在提交…',
      writeLocked: true,
      canRetryUnknownWrite: false,
    })
    this._unknownRequestId = ''
    this._pendingCommand = command
    this._pendingReceiptIndex = normalizePendingReceiptIndex({
      activityId: command.activityId,
      nodeId: command.nodeId,
      requestId: command.requestId,
      expectedRevision: command.expectedRevision,
      action: command.action,
    }, this._activityId)
    if (!savePendingWrite(this._activityId, command)) {
      this._pendingCommand = null
      this._pendingReceiptIndex = null
      this.setData({
        writeState: 'storage-error',
        writeMessage: '无法安全保存本次操作，请检查小程序存储后重试',
        writeLocked: false,
        canRetryUnknownWrite: false,
      })
      toast('无法安全保存，请稍后重试')
      return false
    }
    this._getAdapter().submit(command).then(function (result) {
      if (result && (result.state === 'unknown-write' || result.state === 'business-error')) {
        that._unknownRequestId = requestId
        that.setData({
          writeState: 'unknown-write',
          writeMessage: '结果待核对，核对前已锁定全部写操作',
          writeLocked: true,
          canRetryUnknownWrite: true,
        })
        return
      }
      if (result && result.state === 'rejected') {
        clearPendingWrite(that._activityId)
        that._pendingCommand = null
        that._pendingReceiptIndex = null
        that._unknownRequestId = ''
        that.setData({ writeState: 'idle', writeMessage: '', writeLocked: false, canRetryUnknownWrite: false })
        // CU-C-76:后端把驳回原因放在 reasonCode 里(如 GAME_BROADCAST_NO_RECIPIENT),
        // 以前这里不分原因统一一句「操作未生效」,把可执行的下一步抹掉了。
        toast(rejectedActionText(command.action, result.raw) || '操作未生效，请刷新后重试')
        return
      }
      clearPendingWrite(that._activityId)
      that._pendingCommand = null
      that._pendingReceiptIndex = null
      that._unknownRequestId = ''
      that.setData({ writeState: 'idle', writeMessage: '', writeLocked: false, canRetryUnknownWrite: false })
      that.loadProjection()
      // 写成功后主题维度的核销数/场次也变了,宿主页一起刷,别停在旧态
      if (typeof that.fetchDetail === 'function') that.fetchDetail()
    }).catch(function () {
      that._unknownRequestId = requestId
      that.setData({
        writeState: 'unknown-write',
        writeMessage: '请求结果待核对，核对前已锁定全部写操作',
        writeLocked: true,
        canRetryUnknownWrite: true,
      })
      toast('结果待核对，请勿重复操作')
    })
    return true
  },

  onReconcileUnknownWrite() {
    if (!this.data.writeLocked || !this._unknownRequestId) return
    const that = this
    const requestId = this._unknownRequestId
    this.setData({ writeState: 'receipt-reading', writeMessage: '正在核对最终结果…' })
    this._getAdapter().readReceipt(this._activityId, requestId,
      this._pendingCommand || this._pendingReceiptIndex).then(function (result) {
      if (!result || result.state === 'pending' || result.state === 'business-error') {
        that.setData({
          writeState: 'unknown-write',
          writeMessage: '结果仍待核对，写操作继续锁定',
          writeLocked: true,
        })
        return
      }
      const confirmed = result.state === 'confirmed'
      // CU-C-76:_pendingCommand 下面就被清掉,动作名要在清之前拿 —— 驳回原因按动作给文案
      const pendingAction = ((that._pendingCommand || that._pendingReceiptIndex || {}).action) || ''
      clearPendingWrite(that._activityId)
      that._pendingCommand = null
      that._pendingReceiptIndex = null
      that._unknownRequestId = ''
      that.setData({
        writeState: 'idle',
        writeMessage: '',
        writeLocked: false,
        canRetryUnknownWrite: false,
      })
      toast(confirmed ? '结果已确认' : (rejectedActionText(pendingAction, result.raw) || '操作未生效'),
        { icon: confirmed ? 'success' : 'none' })
      that.loadProjection()
    }).catch(function () {
      that.setData({
        writeState: 'unknown-write',
        writeMessage: '暂时无法核对，写操作继续锁定',
        writeLocked: true,
      })
    })
  },

  retryUnknownWrite() {
    const command = this._pendingCommand
    if (!this.data.writeLocked || this.data.writeState !== 'unknown-write' || !command) return false
    const that = this
    if (!savePendingWrite(this._activityId, command)) {
      this.setData({
        writeState: 'unknown-write',
        writeMessage: '无法安全保存重试状态；原操作仍待核对',
        writeLocked: true,
        canRetryUnknownWrite: true,
      })
      toast('无法安全保存，未发送重试')
      return false
    }
    this.setData({ writeState: 'submitting', writeMessage: '正在用原请求号重试…', writeLocked: true })
    this._getAdapter().submit(command).then(function (result) {
      if (!result || result.state === 'unknown-write' || result.state === 'business-error') {
        that.setData({
          writeState: 'unknown-write', writeMessage: '结果仍待核对，写操作继续锁定', writeLocked: true,
        })
        return
      }
      const confirmed = result.state === 'confirmed'
      clearPendingWrite(that._activityId)
      that._pendingCommand = null
      that._pendingReceiptIndex = null
      that._unknownRequestId = ''
      that.setData({
        writeState: 'idle', writeMessage: '', writeLocked: false, canRetryUnknownWrite: false,
      })
      toast(confirmed ? '结果已确认' : '操作未生效', { icon: confirmed ? 'success' : 'none' })
      that.loadProjection()
    }).catch(function () {
      that.setData({
        writeState: 'unknown-write', writeMessage: '重试结果仍待核对，写操作继续锁定', writeLocked: true,
      })
    })
    return true
  },

  // 分享/扫码直达时本页可能是根栈，裸 navigateBack 会死路（all-page-back-stack-contract 门禁）。
}

module.exports = { DIRECTOR_DATA, DIRECTOR_METHODS }
