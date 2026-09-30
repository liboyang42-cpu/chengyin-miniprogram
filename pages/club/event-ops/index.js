const cyModal = require('../../../utils/modal.js');
const { chinaDateKey, chinaParts } = require('../../../utils/datetime.js');
const toast = require('../../../utils/toast.js');
const app = getApp()
const motion = require('../../../utils/motion.js')
const { readReducedMotion } = require('../../../utils/motion-preference.js')
const { bizFailureMessage } = require('../../../utils/response-shape.js')

const RECURRENCES = [
  { value: 'ONCE', label: '单次' },
  { value: 'WEEKLY', label: '每周' },
  { value: 'CUSTOM_DATES', label: '自定义日期' },
]
const ROSTER_TABS = [
  { key: 'registered', label: '已报名' },
  { key: 'waitlist', label: '候补' },
  { key: 'arrived', label: '已到场' },
  { key: 'noShow', label: '未到场' },
]

function positiveId(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
// CU-C-35:排期基准日统一走上海日历(utils/datetime.js)。原来用设备本地日历算
// 「今天」,非上海时区的设备上表单显示的是设备日历的今天、后端比的是上海日历的今天 ——
// 表单里明明写着今天,回包却说「场次日期不能早于今天」。
function shanghaiToday() { return chinaDateKey(new Date()) }
// CU-C-35:日期=今天且集合时刻已过 —— 「今天」这一档由后端拒绝,用户看到的日期又没错,
// 前后端都没人拦在提交之前。这里用同一个上海钟提前判出来,文案直说时刻。
// 只可能是今天这一档:物化器保证所有日期 >= 今天,WEEKLY 的后续场次都是 +7 天。
function assemblyAlreadyPast(dates, startTime, now) {
  const clock = chinaParts(now)
  const parts = /^(\d{2}):(\d{2})$/.exec(String(startTime || ''))
  if (!clock || !parts) return false
  const today = clock.year + '-' + (clock.month < 10 ? '0' + clock.month : clock.month)
    + '-' + (clock.day < 10 ? '0' + clock.day : clock.day)
  if (!(dates || []).some(date => date === today)) return false
  return (Number(parts[1]) * 60 + Number(parts[2])) <= (clock.hours * 60 + clock.minutes)
}
// CU-C-34(用户裁决 B):主题下拉的可见文案 = 名称 · 起止日期 · 承接来源。
// 实测同一页有两条完全同名的主题(走查样本),光看名字没法确认选的是哪一条;
// 起止日期与「自有/合作」都能从 topics 回包里直接读到,不用改接口。
function topicDropdownLabel(item, clubId) {
  const row = item || {}
  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : ('主题 #' + row.id)
  const day = (value) => {
    const p = chinaParts(value)
    return p ? (p.month + '月' + p.day + '日') : ''
  }
  const start = day(row.startDate)
  const end = day(row.endDate)
  const range = start && end ? (start + '–' + end) : (start || end)
  const source = String(row.clubId) === String(clubId) ? '自有' : '合作'
  return [name, range || '日期未定', source].join(' · ')
}
// CU-C-62:顶部「本场名册」原来只数 registered 这一个桶。活动一过点(以及任一成员被
// 更正为已到场/未到场),后端就把人从 registered 挪进 arrived / noShow,标题必然归零 ——
// 现场明明有 2 人已到场。名册总数 = 三个到场桶之和(候补是另一份名单,不算在内)。
function rosterTotal(buckets) {
  const source = buckets || {}
  const size = (rows) => (Array.isArray(rows) ? rows.length : 0)
  return size(source.registered) + size(source.arrived) + size(source.noShow)
}
// CU-C-73:可更正时段由后端 roster 回包下发。认不出来就当没这道前置闸(服务端仍会拦),
// 不因为一个新增字段把主理人的更正入口整个锁死。
function normalizeCorrectionWindow(value) {
  const row = value && typeof value === 'object' ? value : null
  if (!row || typeof row.operable !== 'boolean') return null
  return { startAt: row.startAt, endAt: row.endAt, operable: row.operable }
}
function correctionWindowText(window) {
  if (!window || window.operable) return ''
  const moment = (value) => {
    const p = chinaParts(value)
    if (!p) return ''
    const pad2 = (n) => (n < 10 ? '0' + n : String(n))
    return p.month + '月' + p.day + '日 ' + pad2(p.hours) + ':' + pad2(p.minutes)
  }
  const from = moment(window.startAt)
  const to = moment(window.endAt)
  const range = from && to ? (from + ' – ' + to) : (from || to)
  return range
    ? ('签到更正仅限活动开始至结束后 48 小时，本场可更正时段：' + range)
    : '签到更正仅限活动开始至结束后 48 小时。'
}
function jsonBody(data) { return JSON.stringify(data || {}) }
function jsonHeader() { return { 'Content-Type': 'application/json' } }
function ok(res) { return !!res && (res.code === 200 || res.code === '200') }
function conflict(res) { return !!res && Number(res.code) === 409 }
function requestId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}
const ATTENDANCE_REQUEST_INTENTS_KEY = 'club_attendance_request_intents_v1'
const ATTENDANCE_REQUEST_INTENT_TTL_MS = 24 * 60 * 60 * 1000
function requestIntentHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}
function attendanceRequestIntentsKey() {
  const memberId = app.getUserID && app.getUserID()
  return memberId === null || memberId === undefined || memberId === ''
    ? '' : ATTENDANCE_REQUEST_INTENTS_KEY + ':m' + memberId
}
function readAttendanceRequestIntents() {
  try {
    wx.removeStorageSync(ATTENDANCE_REQUEST_INTENTS_KEY)
    const key = attendanceRequestIntentsKey()
    const value = key ? wx.getStorageSync(key) : null
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch (ignored) { return {} }
}
function writeAttendanceRequestIntents(intents) {
  try {
    const key = attendanceRequestIntentsKey()
    if (!key) return
    if (Object.keys(intents).length) wx.setStorageSync(key, intents)
    else wx.removeStorageSync(key)
  } catch (ignored) {}
}
function planAttendanceRequestIntent(payload, memory) {
  const signature = JSON.stringify(payload)
  const key = [payload.clubId, payload.activityId, payload.memberId, requestIntentHash(signature)].join(':')
  const remembered = memory && memory[key]
  if (remembered && remembered.signature === signature) return remembered
  const intents = readAttendanceRequestIntents()
  const stored = intents[key]
  if (stored && typeof stored === 'object' && !Array.isArray(stored)
      && stored.signature === signature && typeof stored.requestId === 'string'
      && /^[A-Za-z0-9._:-]{1,64}$/.test(stored.requestId)
      && Number(stored.expiresAt) > Date.now()) {
    const restored = { key, signature, requestId: stored.requestId }
    if (memory) memory[key] = restored
    return restored
  }
  if (Object.prototype.hasOwnProperty.call(intents, key)) delete intents[key]
  const intent = { key, signature, requestId: requestId('attendance') }
  intents[key] = {
    signature,
    requestId: intent.requestId,
    expiresAt: Date.now() + ATTENDANCE_REQUEST_INTENT_TTL_MS,
  }
  writeAttendanceRequestIntents(intents)
  if (memory) memory[key] = intent
  return intent
}
function clearAttendanceRequestIntent(intent, memory) {
  if (!intent || !intent.key) return
  if (memory) delete memory[intent.key]
  const intents = readAttendanceRequestIntents()
  if (!Object.prototype.hasOwnProperty.call(intents, intent.key)) return
  delete intents[intent.key]
  writeAttendanceRequestIntents(intents)
}
function isExplicitClientFailure(res, statusCode) {
  const status = Number(statusCode || (res && res.code))
  return Number.isInteger(status) && status >= 400 && status < 500
}
function normalizeCancellationState(value, activityId) {
  const scopedActivityId = positiveId(value && value.activityId)
  const occurrenceStatus = String((value && value.occurrenceStatus) || '')
  const publishStatus = Number(value && value.publishStatus)
  if (scopedActivityId !== activityId || !['ACTIVE', 'CANCELLED'].includes(occurrenceStatus)
      || typeof (value && value.activityCancelled) !== 'boolean'
      || !Number.isInteger(publishStatus)) return null
  if (occurrenceStatus === 'CANCELLED'
      && (value.activityCancelled !== true || publishStatus !== 0)) return null
  if (occurrenceStatus === 'ACTIVE'
      && (value.activityCancelled !== false || publishStatus !== 1)) return null
  return {
    activityId: scopedActivityId,
    occurrenceStatus,
    activityCancelled: value.activityCancelled,
    publishStatus,
    cancelReason: typeof value.cancelReason === 'string' ? value.cancelReason.trim() : '',
  }
}
function cancellationSummary(result) {
  const refundStatus = String((result && result.refundStatus) || '')
  const refund = refundStatus === 'NOT_REQUIRED' ? '无需退款'
    : refundStatus === 'MANUAL_REVIEW_REQUIRED' ? '退款需人工跟进'
      : refundStatus === 'ACCEPTED_WITH_MANUAL_REVIEW' ? '退款任务已受理，部分需人工跟进'
        : refundStatus === 'ACCEPTED' || refundStatus === 'REFUND_REQUESTED'
          || refundStatus === 'ALREADY_ACCEPTED'
          ? '退款任务已受理' : '退款状态待回读'
  const registered = String((result && result.registeredNotificationStatus) || '')
  const waitlist = String((result && result.waitlistNotificationStatus) || '')
  const notifications = registered === 'NOT_REQUIRED' && waitlist === 'NOT_REQUIRED'
    ? '无需通知' : '通知已进入队列'
  return refund + '；' + notifications
}
// CU-C-150:候补认领时长在库与接口里都是分钟(offerMinutes),这一层不改它 ——
// 但页面原先把实现参数当标签用:「候补认领窗口（分钟，默认 1440 = 一天）」。主理人要的是「这个窗口多长」,
// 所以标签只说事,数值另起一句按自然单位回显。区间外的输入不回显(提交闸自会拦)。
function offerWindowText(minutes) {
  const value = Number(minutes)
  if (!Number.isInteger(value) || value < 5 || value > 1440) return ''
  if (value % 1440 === 0) return (value / 1440) + ' 天'
  if (value % 60 === 0) return (value / 60) + ' 小时'
  if (value < 60) return value + ' 分钟'
  return Math.floor(value / 60) + ' 小时 ' + (value % 60) + ' 分'
}

function normalizeRows(value) {
  if (!Array.isArray(value)) return null
  const rows = []
  for (let i = 0; i < value.length; i += 1) {
    const row = value[i]
    const memberId = positiveId(row && row.memberId)
    if (!memberId) return null
    rows.push(Object.assign({}, row, {
      memberId,
      nickname: typeof row.nickname === 'string' && row.nickname.trim()
        ? row.nickname.trim() : '未命名成员',
      correctionVersion: Number.isInteger(Number(row.correctionVersion))
        ? Number(row.correctionVersion) : 0,
    }))
  }
  return rows
}
// 日期清单行以前直接把 `主题 #{topicId} · WEEKLY` 端给主理人看 —— 一个数据库主键
// 加一个英文枚举。本页 topics(带中文主题名)和 RECURRENCES(单次/每周/自定义日期)
// 两份都在手边,拿来拼一句人话即可。
// topics 与 series 是并发请求、先后不定,所以两边成功后都要调一次这个函数。
function decorateSeriesRow(row, topics) {
  const topic = (topics || []).find(item => Number(item.id) === Number(row.topicId))
  const recurrence = RECURRENCES.find(item => item.value === row.recurrenceType)
  return Object.assign({}, row, {
    // 主题名还没到位时退回 `主题 #id`,不假装知道
    titleText: (topic && topic.name) || ('主题 #' + row.topicId),
    recurrenceLabel: (recurrence && recurrence.label) || row.recurrenceType,
  })
}

// CU-C-146:日期清单里两条同名系列逐字一样(走查现场是「E2E 探店日一期 · 自定义日期」
// 分别指向主题 990028 与 990027),点「编辑未来场次」改的是哪一组全凭运气。
// 与 CU-C-113(关联主题下拉)同一口径:只在**真的撞名**时逐级加深识别信息
// 首场日期 → 主题编号 → 系列编号,加深到没有两条读起来一样为止;不撞名的行一字不加。
// 首场日期在 /series/list 里恒为空(CU-C-04 已实证),拿不到就自动跳到下一级 ——
// 宁可用编号也不编一个库里没有的日期。
function decorateSeriesRows(rows, topics) {
  const decorated = (rows || []).map(row => decorateSeriesRow(row, topics))
  const baseLabel = row => row.titleText + ' · ' + row.recurrenceLabel
  const tally = list => {
    const counts = {}
    list.forEach(row => {
      const key = baseLabel(row)
      counts[key] = (counts[key] || 0) + 1
    })
    return counts
  }
  const unique = list => {
    const counts = tally(list)
    return list.every(row => counts[baseLabel(row)] === 1)
  }
  if (unique(decorated)) return decorated

  const counts = tally(decorated)
  const levels = [
    row => (row.futureDates && row.futureDates.length
      ? Number(String(row.futureDates[0]).slice(5, 7)) + '月' + Number(String(row.futureDates[0]).slice(8, 10)) + '日起' : ''),
    row => (row.topicId ? '主题 #' + row.topicId : ''),
    row => (row.id ? '系列 #' + row.id : ''),
  ]
  for (let depth = 0; depth < levels.length; depth++) {
    const suffixed = decorated.map(row => {
      // 只给撞名的那几行加识别信息,不撞名的一字不加(清单不能因为隔壁重名就全体变长)
      if (counts[baseLabel(row)] === 1) return row
      const parts = []
      for (let i = 0; i <= depth; i++) {
        const value = levels[i](row)
        if (value && parts.indexOf(value) < 0) parts.push(value)
      }
      return Object.assign({}, row, {
        titleText: row.titleText + (parts.length ? '（' + parts.join(' · ') + '）' : ''),
      })
    })
    if (unique(suffixed)) return suffixed
  }
  return decorated
}

function normalizeSeries(value, clubId) {
  const id = positiveId(value && value.id)
  const rowClubId = positiveId(value && value.clubId)
  const topicId = positiveId(value && value.topicId)
  const leadMemberId = positiveId(value && value.defaultLeadMemberId)
  const version = Number(value && value.version)
  const offerMinutes = Number(value && value.offerMinutes)
  const recurrenceType = String((value && value.recurrenceType) || '')
  if (!id || rowClubId !== clubId || !topicId || !leadMemberId
      || !Number.isInteger(version) || version < 0
      || !Number.isInteger(offerMinutes) || offerMinutes < 5 || offerMinutes > 1440
      || !RECURRENCES.some(item => item.value === recurrenceType)
      || typeof value.waitlistEnabled !== 'boolean') return null
  const capacity = value.defaultCapacity === null || value.defaultCapacity === undefined
    ? null : Number(value.defaultCapacity)
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000)) return null
  return {
    id, clubId: rowClubId, topicId, leadMemberId, version, offerMinutes,
    recurrenceType, capacity, waitlistEnabled: value.waitlistEnabled,
    futureDates: Array.isArray(value.futureDates)
      ? Array.from(new Set(value.futureDates.filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item))))).sort()
      : [],
  }
}

// Figma E1「日期清单」一行的展示口径。
// ★ signupCount 为 null = 报名数没算出来。这时既不显示「0 人已报名」,也不放开编辑 ——
//   显示成 0 只是看错,放开编辑会让人真的改掉一场有人的活动。
function occurrenceRow(raw) {
  const item = raw || {}
  const signup = Number.isFinite(Number(item.signupCount)) && item.signupCount !== null
    ? Number(item.signupCount) : null
  const refunded = Number.isFinite(Number(item.refundedCount)) && item.refundedCount !== null
    ? Number(item.refundedCount) : null
  const cancelled = item.status === 'CANCELLED'
  let meta
  if (cancelled) meta = refunded === null ? '本场已取消' : ('已退款 ' + refunded + ' 单')
  else if (signup === null) meta = '报名数待确认'
  else if (signup === 0) meta = '未开售'
  else meta = signup + ' 人已报名' + (item.editable ? '' : ' · 不可编辑')
  return {
    occurrenceId: item.occurrenceId,
    activityId: item.activityId,
    dateText: occurrenceDateText(item.occurrenceAt),
    meta: meta,
    editable: !!item.editable,
    // 状态徽标不是按钮:写「编辑」会被当成可点的动作(CU-C-04),编辑入口是上面那行系列卡。
    badge: cancelled ? '本场已取消' : (item.editable ? '可编辑' : (item.lockReason || '已锁定')),
    badgeKind: cancelled ? 'cancelled' : (item.editable ? 'editable' : 'locked'),
  }
}

// 后端下发 "yyyy-MM-dd HH:mm:ss"、带偏移 ISO 或时间戳;解析不出来就原样显示,不编一个日期。
// CU-C-03:场次时区固定上海(表单也这么写),必须按上海日历取字段 —— 原来用手机本地
// getHours/getDate,非上海时区的设备把 9-28 09:00 显示成「9月27日 18:00」。
function occurrenceDateText(raw) {
  if (raw === null || raw === undefined || raw === '') return '日期待确认'
  const p = chinaParts(typeof raw === 'number' ? raw : String(raw).replace(/\//g, '-'))
  if (!p) return String(raw)
  const week = ['日', '一', '二', '三', '四', '五', '六'][p.weekday]
  const pad2 = (n) => (n < 10 ? '0' + n : String(n))
  return p.month + '月' + p.day + '日 周' + week + ' ' + pad2(p.hours) + ':' + pad2(p.minutes)
}

Page({
  data: {
    statusBarHeight: (app.globalData || {}).statusBarHeight || 44,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    clubId: null,
    activityId: null,
    state: 'loading',
    errorText: '',
    canManage: false,
    canCheckin: false,
    recurrences: RECURRENCES,
    recurrenceType: 'ONCE',
    topics: [],
    topicIndex: 0,
    startDate: shanghaiToday(),
    // 集合时刻是场次退款钟(集合前 24h)的锚点,后端缺它会拒绝开场(5.9 起)。
    startTime: '09:00',
    minDate: shanghaiToday(),
    occurrenceCount: 4,
    customDates: [shanghaiToday()],
    capacity: '',
    defaultLeadMemberId: '',
    leadOptions: [{ memberId: null, nickname: '主理人（默认）' }],
    leadIndex: 0,
    leadLoadWarning: '',
    waitlistEnabled: true,
    offerMinutes: 1440,
    offerWindowText: offerWindowText(1440),
    submitting: false,
    seriesState: 'idle',
    seriesError: '',
    seriesRows: [],
    expandedSeriesId: null,
    occurrenceRows: [],
    occurrenceState: 'idle',   // idle | loading | ready | empty | error
    editingSeriesId: null,
    editingTopicId: null,
    seriesDetailLoading: false,
    rosterTabs: ROSTER_TABS,
    rosterTab: 'registered',
    rosterState: 'idle',
    rosterError: '',
    registered: [],
    waitlist: [],
    arrived: [],
    noShow: [],
    activeRoster: [],
    rosterTotal: 0,
    correctionOperable: true,
    correctionWindowText: '',
    actingMemberId: null,
    cancellationState: 'idle',
    cancellationError: '',
    cancellationSummary: '',
    cancellationReason: '',
    cancellationSubmitting: false,
    cancelConfirmShow: false,
  },

  onLoad(options) {
    this._cancellationRequestId = ''
    this._cancellationRequestReason = ''
    this._pendingCancellationResult = null
    const clubId = positiveId(options && (options.clubId || options.id))
    const activityId = positiveId(options && options.activityId)
    // E-07(2026-09-16):topic-detail 的「管理场次」带了 topicId,原来不消费 ⇒ 打开后停在全俱乐部
    // 第一个主题。记下来,列表到了就把下拉预选到该主题(不隐藏其他主题)。
    this._focusTopicId = positiveId(options && options.topicId)
    const recurrenceType = options && options.recurrence === 'ONCE' ? 'ONCE' : this.data.recurrenceType
    if (!clubId) {
      this.setData({ state: 'error', errorText: '缺少俱乐部 ID' })
      return
    }
    this.setData({ clubId, activityId, recurrenceType })
    this.loadAccess()
  },

  onPullDownRefresh() { this.loadAccess() },
  // 根栈兜底:这四页可由分享/深链直达,栈深为 1 时 navigateBack 是空操作,
  // 必须退回俱乐部列表 tab,否则用户卡在页面里出不去(all-page-back-stack-contract)。
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/talent/list/index' })
  },
  retryLoad() { this.loadAccess() },

  loadAccess() {
    const that = this
    this.setData({ state: 'loading', errorText: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/access/me',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId, activityId: this.data.activityId }),
      header: jsonHeader(),
      success(res) {
        const access = ok(res) && res.data && typeof res.data === 'object' ? res.data : null
        const permissions = access && Array.isArray(access.permissions) ? access.permissions : []
        if (!access || access.active !== true || String(access.club && access.club.id) !== String(that.data.clubId)) {
          that.setData({ state: 'no-permission', errorText: bizFailureMessage(res, '当前账号无权管理该俱乐部') })
          return
        }
        const canManage = permissions.indexOf('club:activity:manage') >= 0
        const canCheckin = !!that.data.activityId && permissions.indexOf('club:event:checkin') >= 0
        if (!canManage && !canCheckin) {
          that.setData({ state: 'no-permission', errorText: '当前角色没有活动运营或本场核销权限' })
          return
        }
        that.setData({ state: 'ready', canManage, canCheckin })
        if (canManage) {
          that.loadTopics()
          that.loadLeads()
          that.loadSeries()
          if (that.data.activityId) that.loadCancellationState()
        }
        if (canCheckin) that.loadRoster()
      },
      fail() { that.setData({ state: 'network-error', errorText: '网络没有连上' }) },
      successStatusAbnormal(res) {
        that.setData({ state: 'error', errorText: (res && res.msg) || '活动权限暂时不可用' })
      },
      complete() { wx.stopPullDownRefresh() },
    })
  },

  loadTopics() {
    const that = this
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/event-ops/topics',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId }),
      header: jsonHeader(),
      success(res) {
        const raw = ok(res) && Array.isArray(res.data) ? res.data : null
        if (!raw) {
          that.setData({ state: 'error', errorText: bizFailureMessage(res, '可开场主题加载失败') })
          return
        }
        const topics = raw.filter(item => positiveId(item && item.id)).map(item => ({
          id: positiveId(item.id),
          name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : ('主题 #' + item.id),
          dropdownLabel: topicDropdownLabel(item, that.data.clubId),
        }))
        // topics 可能晚于 series 到,补一次装饰,否则清单会一直停在 `主题 #3`
        // E-07:带 topicId 进来时把下拉预选到它(找不到就维持第一个,不静默改口径)
        let topicIndex = 0
        if (that._focusTopicId != null) {
          const focusIndex = topics.findIndex(item => item.id === that._focusTopicId)
          if (focusIndex >= 0) topicIndex = focusIndex
        }
        that.setData({
          topics,
          topicIndex,
          seriesRows: decorateSeriesRows(that.data.seriesRows, topics),
        })
      },
      fail() { that.setData({ state: 'error', errorText: '可开场主题加载失败' }) },
      successStatusAbnormal(res) {
        that.setData({ state: 'error', errorText: (res && res.msg) || '可开场主题加载失败' })
      },
    })
  },

  loadLeads() {
    const that = this
    const warning = '负责人名单暂时不可用，将沿用主理人默认值'
    this.setData({ leadLoadWarning: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/members',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId }),
      header: jsonHeader(),
      success(res) {
        const validRows = ok(res) && Array.isArray(res.data)
        const rows = validRows ? res.data : []
        const seen = new Set()
        const leads = [{ memberId: null, nickname: '主理人（默认）' }]
        rows.forEach(row => {
          const memberId = positiveId(row && row.memberId)
          if (!memberId || seen.has(memberId)) return
          seen.add(memberId)
          leads.push({
            memberId,
            nickname: typeof row.nickname === 'string' && row.nickname.trim()
              ? row.nickname.trim() : '未命名成员',
          })
        })
        that.setData({
          leadOptions: leads,
          leadIndex: 0,
          defaultLeadMemberId: '',
          leadLoadWarning: validRows ? '' : warning,
        })
      },
      fail() { that.setData({ leadLoadWarning: warning }) },
      successStatusAbnormal() { that.setData({ leadLoadWarning: warning }) },
    })
  },

  loadSeries() {
    if (!this.data.canManage) return
    const that = this
    this.setData({ seriesState: 'loading', seriesError: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/event-ops/series/list',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId }),
      header: jsonHeader(),
      success(res) {
        const raw = ok(res) && Array.isArray(res.data) ? res.data : null
        const rows = raw && raw.map(item => normalizeSeries(item, that.data.clubId))
        if (!rows || rows.some(item => !item)) {
          that.setData({ seriesState: 'error', seriesError: bizFailureMessage(res, '系列列表数据不完整') })
          return
        }
        that.setData({
          seriesRows: decorateSeriesRows(rows, that.data.topics),
          seriesState: rows.length ? 'ready' : 'empty',
        })
      },
      fail() { that.setData({ seriesState: 'error', seriesError: '系列列表加载失败' }) },
      successStatusAbnormal(res) {
        that.setData({ seriesState: 'error', seriesError: (res && res.msg) || '系列列表加载失败' })
      },
    })
  },

  // Figma E1:点系列行展开这一系列的日期清单(含已过去与已取消的场次)
  toggleSeriesDates(e) {
    const seriesId = Number(e.currentTarget.dataset.seriesId)
    if (!seriesId) return
    if (this.data.expandedSeriesId === seriesId) {
      this.setData({ expandedSeriesId: null, occurrenceRows: [], occurrenceState: 'idle' })
      return
    }
    this.setData({ expandedSeriesId: seriesId, occurrenceRows: [], occurrenceState: 'loading' })
    const that = this
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/event-ops/series/occurrences',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId, seriesId: seriesId }),
      header: jsonHeader(),
      success(res) {
        if (!ok(res) || !Array.isArray(res.data)) { that.setData({ occurrenceState: 'error' }); return }
        const rows = res.data.map(occurrenceRow)
        that.setData({ occurrenceRows: rows, occurrenceState: rows.length ? 'ready' : 'empty' })
      },
      fail() { that.setData({ occurrenceState: 'error' }) },
      successStatusAbnormal() { that.setData({ occurrenceState: 'error' }) },
    })
  },

  beginEditSeries(e) {
    const seriesId = positiveId(e && e.currentTarget && e.currentTarget.dataset.seriesId)
    if (!seriesId || this.data.submitting || this.data.seriesDetailLoading) return
    this.loadSeriesDetail(seriesId)
  },

  loadSeriesDetail(seriesId) {
    const id = positiveId(seriesId)
    if (!id || !this.data.canManage) return
    const that = this
    this.setData({ seriesDetailLoading: true })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/event-ops/series/detail',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId, seriesId: id }),
      header: jsonHeader(),
      success(res) {
        const series = ok(res) ? normalizeSeries(res.data, that.data.clubId) : null
        if (!series || series.id !== id) {
          toast(bizFailureMessage(res, '系列详情已变化，请刷新'))
          return
        }
        that._expectedVersion = series.version
        const dates = series.futureDates.length ? series.futureDates : [that.data.minDate]
        that.setData({
          editingSeriesId: series.id,
          editingTopicId: series.topicId,
          recurrenceType: series.recurrenceType,
          startDate: dates[0],
          // 后端读模型只回日期,不回每场时刻;编辑态默认 09:00,改后的时刻只作用于本次新增日期。
          startTime: '09:00',
          occurrenceCount: dates.length,
          customDates: dates,
          capacity: series.capacity === null ? '' : String(series.capacity),
          defaultLeadMemberId: series.leadMemberId,
          waitlistEnabled: series.waitlistEnabled,
          offerMinutes: series.offerMinutes,
          offerWindowText: offerWindowText(series.offerMinutes),
        })
      },
      fail() { toast('系列详情加载失败') },
      successStatusAbnormal(res) {
        toast((res && res.msg) || '系列详情加载失败')
      },
      complete() { that.setData({ seriesDetailLoading: false }) },
    })
  },

  cancelSeriesEdit() {
    if (this.data.submitting) return
    this.resetSeriesForm()
  },

  resetSeriesForm() {
    this._expectedVersion = null
    const today = this.data.minDate
    this.setData({
      editingSeriesId: null,
      editingTopicId: null,
      recurrenceType: 'ONCE',
      topicIndex: 0,
      startDate: today,
      startTime: '09:00',
      occurrenceCount: 4,
      customDates: [today],
      capacity: '',
      defaultLeadMemberId: '',
      leadIndex: 0,
      waitlistEnabled: true,
      offerMinutes: 1440,
      offerWindowText: offerWindowText(1440),
    })
  },

  chooseRecurrence(e) {
    if (this.data.submitting) return
    const type = String(e.currentTarget.dataset.type || '')
    if (RECURRENCES.some(item => item.value === type)) this.setData({ recurrenceType: type })
  },
  onTopicChange(e) { this.setData({ topicIndex: Number(e.detail.value) || 0 }) },
  onStartDateChange(e) { this.setData({ startDate: e.detail.value }) },
  onStartTimeChange(e) { this.setData({ startTime: e.detail.value }) },
  onCountInput(e) { this.setData({ occurrenceCount: e.detail.value }) },
  onCapacityInput(e) { this.setData({ capacity: e.detail.value }) },
  onLeadChange(e) {
    const index = Number(e.detail.value) || 0
    const option = this.data.leadOptions[index] || this.data.leadOptions[0]
    this.setData({ leadIndex: index, defaultLeadMemberId: option.memberId || '' })
  },
  onOfferInput(e) {
    const raw = e && e.detail ? e.detail.value : ''
    // 输入框里可以是半成品(空、0、3000):认不出来就不显示,提交闸仍按原判据拦。
    this.setData({ offerMinutes: raw, offerWindowText: offerWindowText(raw) })
  },
  onWaitlistChange(e) { this.setData({ waitlistEnabled: !!e.detail.value }) },
  onCustomDateChange(e) {
    const index = Number(e.currentTarget.dataset.index)
    const dates = this.data.customDates.slice()
    if (Number.isInteger(index) && dates[index] !== undefined) {
      dates[index] = e.detail.value
      this.setData({ customDates: dates })
    }
  },
  addCustomDate() {
    if (this.data.submitting || this.data.customDates.length >= 64) return
    const dates = this.data.customDates.slice()
    dates.push(this.data.startDate)
    this.setData({ customDates: dates })
  },
  removeCustomDate(e) {
    if (this.data.submitting || this.data.customDates.length <= 1) return
    const index = Number(e.currentTarget.dataset.index)
    const dates = this.data.customDates.slice()
    if (Number.isInteger(index) && dates[index] !== undefined) {
      dates.splice(index, 1)
      this.setData({ customDates: dates })
    }
  },

  submitSeries() {
    if (!this.data.canManage || this.data.submitting) return
    const editingSeriesId = positiveId(this.data.editingSeriesId)
    const topic = this.data.topics[this.data.topicIndex]
    const topicId = editingSeriesId ? positiveId(this.data.editingTopicId) : positiveId(topic && topic.id)
    if (!topicId) {
      toast('暂无可开场的主题')
      return
    }
    const rawExpectedVersion = this._expectedVersion
    const expectedVersion = Number(rawExpectedVersion)
    if (editingSeriesId && (rawExpectedVersion === null || rawExpectedVersion === undefined
        || rawExpectedVersion === '' || !Number.isInteger(expectedVersion) || expectedVersion < 0)) {
      toast('系列版本缺失，请重新进入编辑')
      return
    }
    const count = Number(this.data.occurrenceCount)
    const capacity = this.data.capacity === '' ? null : Number(this.data.capacity)
    const lead = this.data.defaultLeadMemberId === '' ? null : positiveId(this.data.defaultLeadMemberId)
    const offerMinutes = Number(this.data.offerMinutes)
    if (this.data.recurrenceType === 'WEEKLY' && (!Number.isInteger(count) || count < 1 || count > 64)) {
      toast('每周场次数需为 1–64')
      return
    }
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000)) {
      toast('容量需为 1–10000')
      return
    }
    if (!Number.isInteger(offerMinutes) || offerMinutes < 5 || offerMinutes > 1440) {
      toast('候补窗口需为 5–1440 分钟')
      return
    }
    const customDates = Array.from(new Set(this.data.customDates.filter(Boolean))).sort()
    if (this.data.recurrenceType === 'CUSTOM_DATES' && customDates.length === 0) {
      toast('请至少选择一个日期')
      return
    }
    const startTime = String(this.data.startTime || '').trim()
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) {
      toast('请选择集合时刻')
      return
    }
    // CU-C-35:日期=今天且集合时刻已过,当场拦下并说清是哪一项不对 —— 服务端的拒绝文案
    // 只会说「不能早于今天」,而表单上的日期正是今天。
    if (assemblyAlreadyPast(this.data.recurrenceType === 'CUSTOM_DATES' ? customDates : [this.data.startDate],
      startTime, new Date())) {
      toast('集合时间必须晚于当前时间')
      return
    }
    const that = this
    this.setData({ submitting: true })
    const payload = {
      clubId: this.data.clubId,
      topicId,
      recurrenceType: this.data.recurrenceType,
      startDate: this.data.startDate,
      startTime,
      occurrenceCount: this.data.recurrenceType === 'ONCE' ? 1 : count,
      customDates: this.data.recurrenceType === 'CUSTOM_DATES' ? customDates : null,
      capacity,
      defaultLeadMemberId: lead,
      waitlistEnabled: this.data.waitlistEnabled,
      offerMinutes,
    }
    if (editingSeriesId) {
      payload.seriesId = editingSeriesId
      payload.expectedVersion = expectedVersion
    } else {
      payload.requestId = requestId('series')
    }
    app.sendRequest({
      silentError: true,
      url: editingSeriesId
        ? '/api/club/event-ops/series/update-future'
        : '/api/club/event-ops/series/create',
      method: 'POST',
      data: jsonBody(payload),
      header: jsonHeader(),
      success(res) {
        if (ok(res) && positiveId(res.data && res.data.id)) {
          motion.haptic({ type: 'light', reducedMotion: readReducedMotion() })
          toast.success(editingSeriesId ? '未来场次已更新' : '系列场次已创建')
          that.resetSeriesForm()
          that.loadSeries()
          return
        }
        if (conflict(res) && editingSeriesId) {
          that.handleSeriesConflict(editingSeriesId)
          return
        }
        toast(bizFailureMessage(res, editingSeriesId ? '更新失败' : '创建失败'))
      },
      fail() { toast('网络异常，请稍后重试') },
      successStatusAbnormal(res) {
        if (conflict(res) && editingSeriesId) {
          that.handleSeriesConflict(editingSeriesId)
          return
        }
        toast((res && res.msg) || (editingSeriesId ? '更新失败' : '创建失败'))
      },
      complete() { that.setData({ submitting: false }) },
    })
  },

  handleSeriesConflict(seriesId) {
    toast('系列已被更新，正在刷新')
    this.loadSeries()
    this.loadSeriesDetail(seriesId)
  },

  loadCancellationState() {
    if (!this.data.canManage || !this.data.activityId) return
    this.readCancellationState(null)
  },

  retryCancellationReadback() {
    if (!this.data.canManage || !this.data.activityId || this.data.cancellationSubmitting) return
    this.readCancellationState(this._pendingCancellationResult)
  },

  readCancellationState(cancelResult) {
    const that = this
    this.setData({ cancellationState: 'loading', cancellationError: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/event-ops/occurrence/status',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId, activityId: this.data.activityId }),
      header: jsonHeader(),
      success(res) {
        const state = ok(res) ? normalizeCancellationState(res.data, that.data.activityId) : null
        if (!state) {
          that.setData({
            cancellationState: 'readback-error',
            cancellationError: bizFailureMessage(res, '取消状态回读失败，请重试'),
          })
          return
        }
        if (cancelResult && state.occurrenceStatus !== 'CANCELLED') {
          that.setData({
            cancellationState: 'readback-error',
            cancellationError: '取消请求已受理，但独立回读尚未确认取消，请重试回读',
          })
          return
        }
        const cancelled = state.occurrenceStatus === 'CANCELLED'
        if (cancelled) that._pendingCancellationResult = null
        that.setData({
          cancellationState: cancelled ? 'cancelled' : 'active',
          cancellationError: '',
          cancellationReason: state.cancelReason,
          cancellationSummary: cancelResult
            ? cancellationSummary(cancelResult) : that.data.cancellationSummary,
        })
        if (cancelResult && cancelled) {
          that._cancellationRequestId = ''
          that._cancellationRequestReason = ''
          toast.success('本场取消已确认')
          that.loadSeries()
          if (that.data.canCheckin) that.loadRoster()
        }
      },
      fail() {
        that.setData({ cancellationState: 'readback-error', cancellationError: '网络异常，取消状态回读失败' })
      },
      successStatusAbnormal(res) {
        that.setData({
          cancellationState: 'readback-error',
          cancellationError: (res && res.msg) || '取消状态回读失败，请重试',
        })
      },
    })
  },

  cancelCurrentOccurrence() {
    if (!this.data.canManage || !this.data.activityId || this.data.cancellationSubmitting
        || this.data.cancellationState === 'cancelled') return
    const that = this
    cyModal.show({
      title: '取消本场活动',
      content: '',
      editable: true,
      placeholderText: '请输入取消原因（至少 2 个字）',
      confirmText: '确认取消',
      danger: true,
      // CU-C-58:空/过短原因不关面板 —— 原来只能在面板关掉后补一条 2 秒 toast
      validate(value) {
        const reason = typeof value === 'string' ? value.trim() : ''
        return reason.length >= 2 && reason.length <= 255 ? '' : '取消原因需为 2–255 个字'
      },
      success(modal) {
        if (!modal || !modal.confirm) return
        const reason = typeof modal.content === 'string' ? modal.content.trim() : ''
        if (reason.length < 2 || reason.length > 255) {
          toast('取消原因需为 2–255 个字')
          return
        }
        // 原因合法后不直接发请求：先弹出 T2 居中二次确认（E2），只能点按钮，不点遮罩关闭。
        that._pendingCancelReason = reason
        that.setData({ cancelConfirmShow: true })
      },
    })
  },

  confirmCancelOccurrence() {
    const reason = this._pendingCancelReason
    this.setData({ cancelConfirmShow: false })
    if (!reason) return
    this._pendingCancelReason = ''
    this.submitOccurrenceCancellation(reason)
  },
  dismissCancelConfirm() {
    this._pendingCancelReason = ''
    this.setData({ cancelConfirmShow: false })
  },

  submitOccurrenceCancellation(reason) {
    if (!this.data.canManage || !this.data.activityId || this.data.cancellationSubmitting) return
    const normalizedReason = typeof reason === 'string' ? reason.trim() : ''
    if (normalizedReason.length < 2 || normalizedReason.length > 255) return
    const sameAttempt = this._cancellationRequestId
      && this._cancellationRequestReason === normalizedReason
    const idempotencyKey = sameAttempt
      ? this._cancellationRequestId : requestId('event-cancel')
    const that = this
    this._cancellationRequestId = idempotencyKey
    this._cancellationRequestReason = normalizedReason
    this.setData({
      cancellationSubmitting: true,
      cancellationState: 'submitting',
      cancellationError: '',
    })
    app.sendRequest({
      silentError: true,
      url: '/api/club/event-ops/cancel',
      method: 'POST',
      data: jsonBody({
        clubId: this.data.clubId,
        activityId: this.data.activityId,
        reason: normalizedReason,
        requestId: idempotencyKey,
      }),
      header: jsonHeader(),
      success(res) {
        const result = ok(res) && res.data && positiveId(res.data.activityId) === that.data.activityId
          ? res.data : null
        if (!result) {
          that.setData({
            cancellationState: 'error',
            cancellationError: bizFailureMessage(res, '取消失败，请稍后重试'),
          })
          return
        }
        that._pendingCancellationResult = result
        that.readCancellationState(result)
      },
      fail() {
        that.setData({ cancellationState: 'error', cancellationError: '网络结果未知，可用同一原因安全重试' })
      },
      successStatusAbnormal(res) {
        that.setData({
          cancellationState: 'error',
          cancellationError: (res && res.msg) || '取消失败，请稍后重试',
        })
      },
      complete() { that.setData({ cancellationSubmitting: false }) },
    })
  },

  loadRoster() {
    if (!this.data.canCheckin || !this.data.activityId) return
    const that = this
    this.setData({ rosterState: 'loading', rosterError: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/event-ops/roster',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId, activityId: this.data.activityId }),
      header: jsonHeader(),
      success(res) {
        const data = ok(res) && res.data && typeof res.data === 'object' ? res.data : null
        const registered = data && normalizeRows(data.registered)
        const waitlist = data && normalizeRows(data.waitlist)
        const arrived = data && normalizeRows(data.arrived)
        const noShow = data && normalizeRows(data.noShow)
        if (!data || registered === null || waitlist === null || arrived === null || noShow === null
            || data.phoneIncluded !== false) {
          that.setData({ rosterState: 'error', rosterError: bizFailureMessage(res, '名册数据不完整') })
          return
        }
        const buckets = { registered, waitlist, arrived, noShow }
        const window = normalizeCorrectionWindow(data.correctionWindow)
        that.setData({
          registered, waitlist, arrived, noShow,
          rosterTotal: rosterTotal(buckets),
          correctionOperable: !window || window.operable,
          correctionWindowText: correctionWindowText(window),
          activeRoster: buckets[that.data.rosterTab] || [],
          rosterTabs: ROSTER_TABS.map(item => Object.assign({}, item, { badge: buckets[item.key].length })),
          rosterState: 'ready',
        })
      },
      fail() { that.setData({ rosterState: 'error', rosterError: '网络没有连上' }) },
      successStatusAbnormal(res) {
        that.setData({ rosterState: 'error', rosterError: (res && res.msg) || '名册加载失败' })
      },
    })
  },
  chooseRosterTab(e) {
    const tab = String((e.detail && e.detail.key) || '')
    if (ROSTER_TABS.some(item => item.key === tab)) {
      this.setData({ rosterTab: tab, activeRoster: this.data[tab] || [] })
    }
  },
  correctAttendance(e) {
    const memberId = positiveId(e.currentTarget.dataset.memberId)
    const arrived = e.currentTarget.dataset.arrived === true || e.currentTarget.dataset.arrived === 'true'
    const expectedVersion = Number(e.currentTarget.dataset.version || 0)
    if (!memberId || this.data.actingMemberId) return
    // CU-C-73:未来场次(或已超结束 +48h)的服务端守门只有提交那一刻才生效,前端先拦一道,
    // 不让人填完原因才吃 409。完整时段已写在名册区的提示行上,这里只给一句短回执
    // (UI-GATE-0:toast 上限 16 字,长说明落页内)。
    if (!this.data.correctionOperable) {
      toast('现在不能更正')
      return
    }
    const that = this
    cyModal.show({
      title: arrived ? '更正为已到场' : '更正为未到场',
      content: '',
      editable: true,
      placeholderText: '请输入更正原因（至少 2 个字）',
      // CU-C-58(同页同根因):原因不足 2 字时不关面板 —— 原来直接就 return,连提示都没有
      validate(value) {
        return typeof value === 'string' && value.trim().length >= 2 ? '' : '更正原因至少 2 个字'
      },
      success(modal) {
        const reason = modal && typeof modal.content === 'string' ? modal.content.trim() : ''
        if (!modal.confirm || reason.length < 2) return
        that.submitCorrection(memberId, arrived, expectedVersion, reason)
      },
    })
  },
  submitCorrection(memberId, arrived, expectedVersion, reason) {
    const that = this
    const basePayload = {
      clubId: this.data.clubId,
      activityId: this.data.activityId,
      memberId,
      arrived,
      expectedVersion,
      reason,
    }
    this._attendanceRequestIntents = this._attendanceRequestIntents || {}
    const intent = planAttendanceRequestIntent(basePayload, this._attendanceRequestIntents)
    this.setData({ actingMemberId: memberId })
    app.sendRequest({
      silentError: true,
      url: '/api/club/event-ops/attendance/correct',
      method: 'POST',
      data: jsonBody(Object.assign({}, basePayload, { requestId: intent.requestId })),
      header: jsonHeader(),
      success(res) {
        if (ok(res) && positiveId(res.data && res.data.id)) {
          clearAttendanceRequestIntent(intent, that._attendanceRequestIntents)
          toast.success('签到已更正')
          that.loadRoster()
          return
        }
        if (isExplicitClientFailure(res)) {
          clearAttendanceRequestIntent(intent, that._attendanceRequestIntents)
        }
        toast(bizFailureMessage(res, '更正失败'))
      },
      fail() { toast('网络异常，请稍后重试') },
      successStatusAbnormal(res, statusCode) {
        if (isExplicitClientFailure(res, statusCode)) {
          clearAttendanceRequestIntent(intent, that._attendanceRequestIntents)
        }
        toast((res && res.msg) || '更正失败')
      },
      complete() { that.setData({ actingMemberId: null }) },
    })
  },
})
