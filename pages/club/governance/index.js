const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const app = getApp()
const { isRecord, isRecordList, bizFailureMessage } = require('../../../utils/response-shape.js')

const ALLOWED_STATUSES = ['ACTIVE', 'UNBANNED', 'EXPIRED']
const ALLOWED_SOURCES = ['CLUB', 'PLATFORM']
const ALLOWED_CASE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED']
const REPORT_TARGET_TYPES = ['CLUB', 'ACTIVITY', 'MEMBER']
const DURATION_OPTIONS = [
  { days: 7, label: '7 天' },
  { days: 30, label: '30 天' },
  { days: 90, label: '90 天' },
]

function jsonBody(data) { return JSON.stringify(data || {}) }
function jsonHeader() { return { 'Content-Type': 'application/json' } }
function isSuccess(res) { return !!res && (res.code === 200 || res.code === '200') }
function positiveId(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
function displayDate(value) {
  if (!value) return ''
  return String(value).replace('T', ' ').slice(0, 16)
}
function hasPermission(access, permission) {
  return isRecord(access) && Array.isArray(access.permissions) && access.permissions.indexOf(permission) >= 0
}
function reportTargetText(targetType) {
  if (targetType === 'CLUB') return '俱乐部'
  if (targetType === 'ACTIVITY') return '活动'
  return '成员'
}
// CU-C-82:举报入口带过来的目标显示名(活动名/成员昵称/俱乐部名)。只作展示 ——
// 提交判据仍然是 targetType + targetId 两个 id。
function entryName(value) {
  let text = ''
  try { text = decodeURIComponent(String(value || '')) } catch (error) { text = '' }
  return text.replace(/\s+/g, ' ').trim().slice(0, 40)
}
// 「活动「夜跑 · 09-24」」:让人认出举报的是哪一条。
// CU-C-139:原先尾巴上还拼了「 · #501」—— 内部编号不帮任何人认东西(主理人看着 501
//   想不起是哪场),提交判据另有 targetId,不必占一行文案。没带名称时就只剩类型,
//   宁可少说,也不摆一个谁也核对不了的编号。
function reportTargetLabel(targetType, name) {
  const typeText = reportTargetText(targetType)
  return name ? (typeText + '「' + name + '」') : typeText
}
// CU-C-139:弹窗标题只要一个简洁的动作名,目标本身交给正文那一行去核对。
function reportTargetHint(targetType) {
  if (targetType === 'CLUB') return '这个俱乐部'
  if (targetType === 'ACTIVITY') return '这场活动'
  if (targetType === 'MEMBER') return '这位成员'
  return '这条内容'
}
function shapeMembers(raw) {
  if (!isRecordList(raw)) return null
  const members = []
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i]
    const memberId = positiveId(row.memberId)
    if (!memberId) return null
    if (row.isOwner === true) continue
    members.push(Object.assign({}, row, {
      memberId,
      nickname: typeof row.nickname === 'string' && row.nickname.trim() ? row.nickname.trim() : '城瘾玩家',
    }))
  }
  return members
}
function shapeBans(raw, clubId) {
  if (!isRecordList(raw)) return null
  const bans = []
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i]
    const id = positiveId(row.id)
    const targetMemberId = positiveId(row.targetMemberId)
    const version = Number(row.version)
    const sourceType = String(row.sourceType || '')
    if (!id || !targetMemberId || String(row.clubId) !== String(clubId)
        || ALLOWED_STATUSES.indexOf(row.status) < 0 || !Number.isInteger(version) || version < 0
        || ALLOWED_SOURCES.indexOf(sourceType) < 0
        || (sourceType === 'CLUB' && !row.expiresAt)
        || typeof row.banReason !== 'string' || !row.banReason.trim()) return null
    const platformPermanent = sourceType === 'PLATFORM' && !row.expiresAt
    bans.push(Object.assign({}, row, {
      id,
      targetMemberId,
      version,
      isActive: row.status === 'ACTIVE',
      canClubUnban: row.status === 'ACTIVE' && sourceType === 'CLUB',
      sourceType,
      sourceText: sourceType === 'PLATFORM' ? '平台治理' : '俱乐部治理',
      targetNickname: typeof row.targetNickname === 'string' && row.targetNickname.trim()
        ? row.targetNickname.trim() : ('成员 #' + targetMemberId),
      statusText: row.status === 'ACTIVE' ? '封禁中' : (row.status === 'EXPIRED' ? '已到期' : '已解封'),
      expiresText: platformPermanent ? '平台永久封禁' : ('至 ' + displayDate(row.expiresAt)),
      bannedAtText: displayDate(row.bannedAt) || '时间未知',
    }))
  }
  return bans
}
function shapeCases(raw, clubId) {
  if (!isRecordList(raw)) return null
  const cases = []
  for (let i = 0; i < raw.length; i += 1) {
    const row = raw[i]
    const id = positiveId(row.id)
    const version = Number(row.version)
    const targetId = positiveId(row.targetId)
    const validTarget = row.caseType === 'APPEAL'
      ? row.targetType === 'BAN'
      : REPORT_TARGET_TYPES.indexOf(row.targetType) >= 0
    if (!id || String(row.clubId) !== String(clubId)
        || ['REPORT', 'APPEAL'].indexOf(row.caseType) < 0
        || ALLOWED_CASE_STATUSES.indexOf(row.status) < 0
        || !Number.isInteger(version) || version < 0 || !targetId || !validTarget) return null
    cases.push(Object.assign({}, row, {
      id,
      targetId,
      version,
      typeText: row.caseType === 'APPEAL' ? '封禁申诉' : (reportTargetText(row.targetType) + '举报'),
      statusText: row.status === 'PENDING' ? '平台处理中'
        : (row.status === 'APPROVED' ? '已支持' : '未支持'),
      createTimeText: displayDate(row.createTime) || '时间未知',
    }))
  }
  return cases
}

function shapeMyCasesPayload(res, clubId) {
  // /cases/mine:data 是工单数组(与已发布版本兼容),封禁判据在与 data 并列的顶层 activeBan。
  // 旧后端没有 activeBan 字段时按「判据未知」处理,而不是当「没有封禁」。
  const cases = shapeCases(res && res.data, clubId)
  if (!cases) return null
  if (!Object.prototype.hasOwnProperty.call(res, 'activeBan')) {
    return { cases: cases, activeBan: null, banKnown: false }
  }
  const ban = shapeActiveBan(res.activeBan, clubId)
  if (ban === undefined) return null
  return { cases: cases, activeBan: ban, banKnown: true }
}

// CU-C-84:申诉资格 = 「本人当前在指定俱乐部有没有有效封禁」。
// 过期语义(俱乐部封禁看 expiresAt、平台永久封禁看无到期)只在后端一处算,前端只投影。
function shapeActiveBan(raw, clubId) {
  if (raw === null || raw === undefined) return null
  // 有值就必须长得对:申诉表单的开关不能靠猜,形状不对交给上层报错
  if (!isRecord(raw)) return undefined
  const id = positiveId(raw.id)
  if (!id || String(raw.clubId) !== String(clubId) || raw.status !== 'ACTIVE'
      || ALLOWED_SOURCES.indexOf(String(raw.sourceType || '')) < 0) return undefined
  return {
    id,
    sourceText: raw.sourceType === 'PLATFORM' ? '平台治理' : '俱乐部治理',
    banReason: typeof raw.banReason === 'string' ? raw.banReason : '',
    bannedAtText: displayDate(raw.bannedAt) || '时间未知',
    expiresText: raw.expiresAt ? ('至 ' + displayDate(raw.expiresAt)) : '平台永久封禁',
  }
}

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    clubId: null,
    mode: 'manage',
    pageTitle: '成员治理',
    state: 'loading', // loading | no-permission | network-error | error(业务) | empty | ready
    errorText: '',
    members: [],
    bans: [],
    cases: [],
    // CU-C-84:本人当前的有效封禁(申诉资格判据)。banKnown=false = 这版后端没下发判据,
    // 申诉表单照旧渲染 —— 读不到判据不能当成「没有封禁」把合法入口关掉。
    activeBan: null,
    banKnown: false,
    isOwner: false,
    reportTargetType: null,
    reportTargetId: null,
    // CU-C-82:举报页要把「举报的是哪一条」摆在表单上方;名称来自入口 query,取不到就只显示 id
    reportTargetLabel: '',
    selectedMemberId: null,
    selectedDurationDays: 30,
    // 稿 R6:成员与期限都是行内选择器,选中的值显示在行右侧
    memberPickerVisible: false,
    durationPickerVisible: false,
    selectedMemberName: '',
    selectedDurationLabel: '30 天',
    durationOptions: DURATION_OPTIONS,
    actingKey: '',
  },

  onLoad(options) {
    const clubId = positiveId(options && options.clubId)
    if (!clubId) {
      this.setData({ state: 'error', errorText: '缺少俱乐部ID' })
      return
    }
    const requestedMode = options && options.mode
    const mode = requestedMode === 'appeal' || requestedMode === 'report' ? requestedMode : 'manage'
    this._requestedMemberId = mode === 'manage' ? positiveId(options && options.memberId) : null
    let reportTargetType = options && String(options.targetType || '').toUpperCase()
    let reportTargetId = positiveId(options && options.targetId)
    const legacyMemberId = positiveId(options && options.targetMemberId)
    if (mode === 'report') {
      if (!reportTargetType && legacyMemberId) reportTargetType = 'MEMBER'
      if (!reportTargetId && legacyMemberId) reportTargetId = legacyMemberId
      if (reportTargetType === 'CLUB' && !reportTargetId) reportTargetId = clubId
      if (REPORT_TARGET_TYPES.indexOf(reportTargetType) < 0 || !reportTargetId) {
        this.setData({ state: 'error', errorText: '缺少合法的举报目标' })
        return
      }
    }
    const pageTitle = mode === 'appeal' ? '封禁申诉'
      : (mode === 'report' ? (reportTargetText(reportTargetType) + '举报') : '成员治理')
    const reportLabel = mode === 'report'
      ? reportTargetLabel(reportTargetType, entryName(options && options.targetName))
      : ''
    this.setData({
      clubId, mode, reportTargetType, reportTargetId, pageTitle, reportTargetLabel: reportLabel,
    })
    if (mode === 'appeal') this.loadMyCases()
    else this.loadAccess()
  },

  // 根栈兜底:这四页可由分享/深链直达,栈深为 1 时 navigateBack 是空操作,
  // 必须退回俱乐部列表 tab,否则用户卡在页面里出不去(all-page-back-stack-contract)。
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/talent/list/index' })
  },
  onPullDownRefresh() { this.retryLoad() },
  retryLoad() { if (this.data.mode === 'appeal') this.loadMyCases(); else this.loadAccess() },

  loadAccess() {
    const that = this
    this._loadCycle = (this._loadCycle || 0) + 1
    const cycle = this._loadCycle
    this.setData({ state: 'loading', errorText: '', members: [], bans: [], selectedMemberId: null, selectedMemberName: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/access/me',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId }),
      header: jsonHeader(),
      success(res) {
        if (cycle !== that._loadCycle) return
        const access = isSuccess(res) && isRecord(res.data) ? res.data : null
        const scopedClub = access && isRecord(access.club) ? access.club : null
        if (!access || access.active !== true || !scopedClub
            || String(scopedClub.id) !== String(that.data.clubId)) {
          that.setData({ state: 'no-permission', errorText: bizFailureMessage(res, '当前账号不属于该俱乐部') })
          return
        }
        if (that.data.mode === 'report') {
          that.loadMyCases()
          return
        }
        if (!hasPermission(access, 'club:member:manage')) {
          that.setData({ state: 'no-permission', errorText: bizFailureMessage(res, '仅主理人与副主理人可进行成员治理') })
          return
        }
        const roleCodes = Array.isArray(access.roleCodes) ? access.roleCodes : []
        that.setData({ isOwner: roleCodes.indexOf('CLUB_OWNER') >= 0 })
        that.loadManagementData(cycle)
      },
      fail() {
        if (cycle === that._loadCycle) that.setData({ state: 'network-error', errorText: '网络没有连上' })
      },
      successStatusAbnormal(res) {
        if (cycle === that._loadCycle) {
          that.setData({ state: 'error', errorText: (res && res.msg) || '治理权限暂时不可用' })
        }
      },
      complete() { wx.stopPullDownRefresh() },
    })
  },

  loadMyCases() {
    const that = this
    this._loadCycle = (this._loadCycle || 0) + 1
    const cycle = this._loadCycle
    this.setData({ state: 'loading', errorText: '', cases: [], activeBan: null, banKnown: false })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/governance/cases/mine',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId }),
      header: jsonHeader(),
      success(res) {
        if (cycle !== that._loadCycle) return
        const shaped = isSuccess(res) ? shapeMyCasesPayload(res, that.data.clubId) : null
        if (!shaped) {
          that.setData({ state: 'error', errorText: bizFailureMessage(res, '治理工单暂时不可用') })
          return
        }
        that.setData({
          cases: shaped.cases, activeBan: shaped.activeBan, banKnown: shaped.banKnown, state: 'ready',
        })
      },
      fail() { if (cycle === that._loadCycle) that.setData({ state: 'network-error', errorText: '网络没有连上' }) },
      successStatusAbnormal(res) {
        if (cycle === that._loadCycle) {
          that.setData({ state: 'error', errorText: (res && res.msg) || '治理工单暂时不可用' })
        }
      },
      complete() { wx.stopPullDownRefresh() },
    })
  },

  loadManagementData(cycle) {
    const activeCycle = cycle || this._loadCycle
    this._membersReady = false
    this._bansReady = false
    this._loadFailed = false
    this.setData({ state: 'loading', errorText: '' })
    this.loadMembers(activeCycle)
    this.loadBans(activeCycle)
  },

  loadMembers(cycle) {
    const that = this
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/members',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId }),
      header: jsonHeader(),
      success(res) {
        if (cycle !== that._loadCycle) return
        const rows = isSuccess(res) ? shapeMembers(res.data) : null
        if (!rows) { that.failLoad(bizFailureMessage(res, '成员名单暂时不可用')); return }
        const requestedMemberId = positiveId(that._requestedMemberId)
        const selectedMemberId = requestedMemberId && rows.some(function (member) {
          return member.memberId === requestedMemberId
        }) ? requestedMemberId : null
        // 从别处带 memberId 进来时,行右侧要显示的是名字不是 id
        const picked = selectedMemberId && rows.find(function (m) { return m.memberId === selectedMemberId })
        that.setData({
          members: rows,
          selectedMemberId,
          selectedMemberName: picked ? (picked.nickname || '这位成员') : '',
        })
        that._membersReady = true
        that.finishLoad()
      },
      fail() { if (cycle === that._loadCycle) that.failLoad('网络没有连上') },
      successStatusAbnormal(res) {
        if (cycle === that._loadCycle) that.failLoad((res && res.msg) || '成员名单暂时不可用')
      },
    })
  },

  loadBans(cycle) {
    const that = this
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/governance/list',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId }),
      header: jsonHeader(),
      success(res) {
        if (cycle !== that._loadCycle) return
        const rows = isSuccess(res) ? shapeBans(res.data, that.data.clubId) : null
        if (!rows) { that.failLoad(bizFailureMessage(res, '治理记录暂时不可用')); return }
        that.setData({ bans: rows })
        that._bansReady = true
        that.finishLoad()
      },
      fail() { if (cycle === that._loadCycle) that.failLoad('网络没有连上') },
      successStatusAbnormal(res) {
        if (cycle === that._loadCycle) that.failLoad((res && res.msg) || '治理记录暂时不可用')
      },
    })
  },

  failLoad(message) {
    this._loadFailed = true
    this.setData({ state: 'error', errorText: message })
  },

  finishLoad() {
    if (this._loadFailed || !this._membersReady || !this._bansReady) return
    this.setData({ state: this.data.members.length || this.data.bans.length ? 'ready' : 'empty' })
  },

  openMemberPicker() { this.setData({ memberPickerVisible: true }) },
  closeMemberPicker() { this.setData({ memberPickerVisible: false }) },
  openDurationPicker() { this.setData({ durationPickerVisible: true }) },
  closeDurationPicker() { this.setData({ durationPickerVisible: false }) },

  pickMember(e) {
    const memberId = positiveId(e.currentTarget.dataset.memberId)
    if (!memberId) return
    const row = (this.data.members || []).find(function (m) { return String(m.memberId) === String(memberId) })
    this.setData({
      selectedMemberId: memberId,
      selectedMemberName: (row && row.nickname) || '这位成员',
      memberPickerVisible: false,
    })
  },

  pickDuration(e) {
    const days = Number(e.currentTarget.dataset.days)
    // 期限只认 7/30/90:别的值服务端会拒,这里先挡住
    if (days !== 7 && days !== 30 && days !== 90) return
    const row = (this.data.durationOptions || []).find(function (d) { return Number(d.days) === days })
    this.setData({
      selectedDurationDays: days,
      selectedDurationLabel: (row && row.label) || (days + ' 天'),
      durationPickerVisible: false,
    })
  },

  banSelectedMember() {
    if (this.data.actingKey) return
    const memberId = positiveId(this.data.selectedMemberId)
    if (!memberId) { toast('先选择一位成员'); return }
    const member = this.data.members.find(function (item) { return item.memberId === memberId })
    if (!member) { toast('成员状态已变化，请刷新'); return }
    const that = this
    modal.show({
      title: '确认封禁 ' + member.nickname,
      // CU-C-54:封禁同时结束成员关系(后端 removeMemberForBan),解封只恢复申请资格、不重建成员行。
      // 后果必须在点确认之前说清楚,和「移出成员」的确认层口径一致。
      content: '封禁后对方立即失去成员身份与群聊入口；解封只恢复申请资格，成员身份不会自动恢复。',
      editable: true,
      placeholderText: '填写封禁原因（必填）',
      confirmText: '确认封禁',
      danger: true,
      // CU-C-56:空原因不关面板 —— 提示贴回输入框下,已输入的内容留着
      validate(value) { return typeof value === 'string' && value.trim() ? '' : '请填写封禁原因'; },
      success(result) {
        if (!result.confirm) return
        const reason = typeof result.content === 'string' ? result.content.trim() : ''
        if (!reason) { toast('请填写封禁原因'); return }
        that.submitBan(memberId, reason)
      },
    })
  },

  submitBan(memberId, reason) {
    const that = this
    const key = 'ban:' + memberId
    const payload = {
      clubId: this.data.clubId,
      targetMemberId: memberId,
      reason,
      // CU-C-55:原来发的是设备本地墙上时间串(无时区),后端按东八区反解 —— 「７天」随时区漂移。
      // 改发 epoch 毫秒:7×24 小时就是 7×24 小时,跟在哪个时区点无关。
      expiresAtEpochMs: Date.now() + this.data.selectedDurationDays * 86_400_000,
      requestId: this.nextRequestId('cgb', memberId),
    }
    this.setData({ actingKey: key })
    app.sendRequest({
      url: '/api/club/governance/ban',
      method: 'POST',
      data: jsonBody(payload),
      header: jsonHeader(),
      success(res) {
        that.setData({ actingKey: '' })
        if (!isSuccess(res)) { toast((res && res.msg) || '封禁失败'); return }
        toast.success('已封禁并移出俱乐部')
        that.setData({ selectedMemberId: null })
        that.loadManagementData(that._loadCycle)
      },
      fail() { that.setData({ actingKey: '' }); toast('网络异常，请重试') },
      successStatusAbnormal(res) {
        that.setData({ actingKey: '' })
        toast((res && res.msg) || '封禁失败')
      },
      complete() { if (that.data.actingKey === key) that.setData({ actingKey: '' }) },
    })
  },

  unbanMember(e) {
    if (this.data.actingKey) return
    const id = positiveId(e.currentTarget.dataset.id)
    const version = Number(e.currentTarget.dataset.version)
    const row = this.data.bans.find(function (item) {
      return item.id === id && item.version === version && item.canClubUnban
    })
    if (!row) { toast('封禁状态已变化，请刷新'); return }
    const that = this
    modal.show({
      title: '解除 ' + row.targetNickname + ' 的封禁',
      content: '',
      editable: true,
      placeholderText: '填写复核说明（可选）',
      confirmText: '解除封禁',
      success(result) {
        if (result.confirm) that.submitUnban(row, typeof result.content === 'string' ? result.content.trim() : '')
      },
    })
  },

  submitUnban(row, reason) {
    const that = this
    const key = 'unban:' + row.id
    const payload = {
      clubId: this.data.clubId,
      banId: row.id,
      version: row.version,
      reason,
      requestId: this.nextRequestId('cgu', row.id),
    }
    this.setData({ actingKey: key })
    app.sendRequest({
      url: '/api/club/governance/unban',
      method: 'POST',
      data: jsonBody(payload),
      header: jsonHeader(),
      success(res) {
        that.setData({ actingKey: '' })
        if (!isSuccess(res)) { toast((res && res.msg) || '解封失败'); return }
        toast.success('已解除封禁')
        that.loadManagementData(that._loadCycle)
      },
      fail() { that.setData({ actingKey: '' }); toast('网络异常，请重试') },
      successStatusAbnormal(res) {
        that.setData({ actingKey: '' })
        toast((res && res.msg) || '解封失败')
      },
      complete() { if (that.data.actingKey === key) that.setData({ actingKey: '' }) },
    })
  },

  transferSelectedOwner() {
    if (this.data.actingKey || !this.data.isOwner) return
    const memberId = positiveId(this.data.selectedMemberId)
    const member = this.data.members.find(function (item) { return item.memberId === memberId })
    if (!member) { toast('先选择一位成员'); return }
    const that = this
    modal.show({
      title: '转让主理人给 ' + member.nickname,
      content: '',
      editable: true,
      placeholderText: '填写交接原因（必填）',
      confirmText: '确认转让',
      danger: true,
      // CU-C-56(同根因一并收口):空交接原因不关面板
      validate(value) { return typeof value === 'string' && value.trim() ? '' : '请填写交接原因'; },
      success(result) {
        if (!result.confirm) return
        const reason = typeof result.content === 'string' ? result.content.trim() : ''
        if (!reason) { toast('请填写交接原因'); return }
        that.submitOwnerTransfer(memberId, reason)
      },
    })
  },

  submitOwnerTransfer(memberId, reason) {
    const that = this
    const key = 'transfer:' + memberId
    this.setData({ actingKey: key })
    app.sendRequest({
      url: '/api/club/governance/owner/transfer',
      method: 'POST',
      data: jsonBody({
        clubId: this.data.clubId,
        targetMemberId: memberId,
        reason,
        requestId: this.nextRequestId('cgt', memberId),
      }),
      header: jsonHeader(),
      success(res) {
        that.setData({ actingKey: '' })
        if (!isSuccess(res)) { toast((res && res.msg) || '转让失败'); return }
        toast.success('主理人已转让')
        wx.navigateBack({ delta: 1 })
      },
      fail() { that.setData({ actingKey: '' }); toast('网络异常，请重试') },
      successStatusAbnormal(res) {
        that.setData({ actingKey: '' })
        toast((res && res.msg) || '转让失败')
      },
      complete() { if (that.data.actingKey === key) that.setData({ actingKey: '' }) },
    })
  },

  reportTarget() {
    if (this.data.actingKey || this.data.mode !== 'report') return
    // CU-C-82:最后一步仍要能核对举报的是哪一条 —— 但这件事交给正文那一行。
    // CU-C-139:标题不再复制整段目标(「举报活动「夜跑」 · #501」在居中弹窗里折成两行),
    //   只剩一个简洁动作名。
    this.promptAndSubmitCase('举报' + reportTargetHint(this.data.reportTargetType),
      '说明具体事实（必填）', 'report', this.data.reportTargetLabel)
  },

  appealBan() {
    if (this.data.actingKey || this.data.mode !== 'appeal') return
    // CU-C-84:没有有效封禁时后端会在提交那一刻拒掉(当前没有可申诉的有效封禁)——
    // 表单已经不渲染,这里再挡一层,防止旧快照/旧包下的点击白写一遍。
    if (this.data.banKnown && !this.data.activeBan) { toast('当前没有可申诉的封禁'); return }
    this.promptAndSubmitCase('提交封禁申诉', '说明申诉理由与事实（必填）', 'appeal')
  },

  // content 是可编辑弹窗里输入框上方那一行(见 cy-modal-host):标题说「做什么」,它说「对谁做」。
  promptAndSubmitCase(title, placeholderText, type, content) {
    const that = this
    modal.show({
      title,
      content: content || '',
      editable: true,
      placeholderText,
      confirmText: '提交平台',
      // CU-C-56(同根因一并收口):空说明不关面板
      validate(value) { return typeof value === 'string' && value.trim() ? '' : '请填写事实说明'; },
      success(result) {
        if (!result.confirm) return
        const reason = typeof result.content === 'string' ? result.content.trim() : ''
        if (!reason) { toast('请填写事实说明'); return }
        that.submitCase(type, reason)
      },
    })
  },

  submitCase(type, reason) {
    const that = this
    const target = type === 'report' ? this.data.reportTargetId : this.data.clubId
    const key = type + ':' + target
    const payload = {
      clubId: this.data.clubId,
      reason,
      requestId: this.nextRequestId(type === 'report' ? 'cgr' : 'cga', target),
    }
    if (type === 'report') {
      payload.targetType = this.data.reportTargetType
      payload.targetId = this.data.reportTargetId
      payload.evidence = {}
    }
    this.setData({ actingKey: key })
    const requestOptions = {
      method: 'POST',
      data: jsonBody(payload),
      header: jsonHeader(),
      success(res) {
        that.setData({ actingKey: '' })
        if (!isSuccess(res)) { toast((res && res.msg) || '提交失败'); return }
        toast.success('已提交平台处理')
        that.loadMyCases()
      },
      fail() { that.setData({ actingKey: '' }); toast('网络异常，请重试') },
      successStatusAbnormal(res) {
        that.setData({ actingKey: '' })
        toast((res && res.msg) || '提交失败')
      },
      complete() { if (that.data.actingKey === key) that.setData({ actingKey: '' }) },
    }
    if (type === 'report') {
      app.sendRequest({
        url: '/api/club/governance/cases/report',
        method: requestOptions.method,
        data: requestOptions.data,
        header: requestOptions.header,
        success: requestOptions.success,
        fail: requestOptions.fail,
        successStatusAbnormal: requestOptions.successStatusAbnormal,
        complete: requestOptions.complete,
      })
    } else {
      app.sendRequest({
        url: '/api/club/governance/cases/appeal',
        method: requestOptions.method,
        data: requestOptions.data,
        header: requestOptions.header,
        success: requestOptions.success,
        fail: requestOptions.fail,
        successStatusAbnormal: requestOptions.successStatusAbnormal,
        complete: requestOptions.complete,
      })
    }
  },

  nextRequestId(prefix, targetId) {
    this._requestSequence = (this._requestSequence || 0) + 1
    return prefix + '-' + this.data.clubId + '-' + targetId + '-'
      + Date.now().toString(36) + '-' + this._requestSequence.toString(36)
  },
})
