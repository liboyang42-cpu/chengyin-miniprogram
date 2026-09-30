const toast = require('../../../utils/toast.js');
const app = getApp()
const { isRecord, isRecordList, bizFailureMessage } = require('../../../utils/response-shape.js')

const CLUB_ROLE_CODES = ['CLUB_CO_OWNER', 'CLUB_OPERATOR']
const EVENT_ROLE_CODES = ['EVENT_LEAD', 'EVENT_CHECKIN']
const ROLE_REQUEST_INTENT_STORAGE_KEY = 'club_role_request_intents_v1'
const ROLE_REQUEST_INTENT_TTL_MS = 24 * 60 * 60 * 1000
const ROLE_SUMMARY = {
  CLUB_CO_OWNER: '可维护俱乐部资料、成员与活动；不能分配角色',
  CLUB_OPERATOR: '可管理内容、入会审核与成员通知；活动与现场权限按场次单独委派',
  EVENT_LEAD: '仅负责当前场次的现场执行与核销',
  EVENT_CHECKIN: '仅负责当前场次核销，不获得成员或财务权限',
}

function jsonBody(data) { return JSON.stringify(data || {}) }
function jsonHeader() { return { 'Content-Type': 'application/json' } }
function isSuccess(res) { return !!res && (res.code === 200 || res.code === '200') }
function isClientError(res) {
  const code = Number(res && res.code)
  return code >= 400 && code < 500
}
function newRequestId() {
  return 'club-role-' + Date.now().toString(36) + '-'
    + Math.random().toString(36).slice(2, 12)
}
function roleRequestIntentStorageKey() {
  const memberId = app.getUserID && app.getUserID()
  return memberId === null || memberId === undefined || memberId === ''
    ? '' : ROLE_REQUEST_INTENT_STORAGE_KEY + ':m' + memberId
}
function readRequestIntents() {
  try {
    wx.removeStorageSync(ROLE_REQUEST_INTENT_STORAGE_KEY)
    const key = roleRequestIntentStorageKey()
    const value = key ? wx.getStorageSync(key) : null
    return isRecord(value) ? value : {}
  } catch (error) {
    return {}
  }
}
function writeRequestIntents(intents) {
  try {
    const key = roleRequestIntentStorageKey()
    if (!key) return
    if (Object.keys(intents).length) wx.setStorageSync(key, intents)
    else wx.removeStorageSync(key)
  } catch (error) {
    // 本地存储只负责页面重建恢复；当前页内仍由 _roleRequestIds 保留稳定 requestId。
  }
}
function loadRequestIntent(key) {
  const intents = readRequestIntents()
  const intent = intents[key]
  if (isRecord(intent) && typeof intent.requestId === 'string'
      && /^club-role-[A-Za-z0-9-]{1,50}$/.test(intent.requestId)
      && Number(intent.expiresAt) > Date.now()) return intent.requestId
  if (Object.prototype.hasOwnProperty.call(intents, key)) {
    delete intents[key]
    writeRequestIntents(intents)
  }
  return ''
}
function saveRequestIntent(key, requestId) {
  const intents = readRequestIntents()
  intents[key] = { requestId, expiresAt: Date.now() + ROLE_REQUEST_INTENT_TTL_MS }
  writeRequestIntents(intents)
}
function clearRequestIntent(key) {
  const intents = readRequestIntents()
  if (Object.prototype.hasOwnProperty.call(intents, key)) {
    delete intents[key]
    writeRequestIntents(intents)
  }
}
function positiveId(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
// CU-C-57:本场工具带过来的「活动名 · 开始时间」;只有活动范围才用得上,取不到就空。
function entryLabel(value) {
  let text = ''
  try { text = decodeURIComponent(String(value || '')) } catch (error) { text = '' }
  return text.replace(/\s+/g, ' ').trim().slice(0, 40)
}
// 委派行的«作用期限»:到那天失効。只取到日,不写时:分 —— 屏幕上不需要这个精度。
function expiryText(value) {
  if (!value) return ''
  const text = String(value).replace('T', ' ')
  return text.length >= 10 ? (' · 至 ' + text.slice(5, 10)) : ''
}

function roleAllowed(roleCode, activityId) {
  return activityId ? EVENT_ROLE_CODES.indexOf(roleCode) >= 0 : CLUB_ROLE_CODES.indexOf(roleCode) >= 0
}

function shapeRoleData(raw, clubId, activityId) {
  if (!isRecord(raw) || !isRecordList(raw.roles) || !isRecordList(raw.assignments)) return null
  const roles = []
  for (let i = 0; i < raw.roles.length; i += 1) {
    const row = raw.roles[i]
    if (!roleAllowed(row.roleCode, activityId)) continue
    const expectedScope = activityId ? 'EVENT' : 'CLUB'
    if (row.scopeType !== expectedScope || typeof row.name !== 'string' || !Array.isArray(row.permissions)) return null
    roles.push(Object.assign({}, row, {
      summary: ROLE_SUMMARY[row.roleCode],
      scopeText: activityId ? ('场次 #' + activityId) : '本俱乐部',
    }))
  }
  if (!roles.length) return null

  const assignments = []
  for (let i = 0; i < raw.assignments.length; i += 1) {
    const row = raw.assignments[i]
    const id = positiveId(row.id)
    const targetMemberId = positiveId(row.targetMemberId)
    const version = Number(row.version)
    if (!id || !targetMemberId || !Number.isInteger(version) || version < 0) return null
    if (!roleAllowed(row.roleCode, activityId)) continue
    if (activityId) {
      if (row.scopeType !== 'EVENT' || String(row.scopeId) !== String(activityId)) return null
    } else if (row.scopeType !== 'CLUB' || String(row.scopeId) !== String(clubId)) {
      return null
    }
    assignments.push(Object.assign({}, row, { id, targetMemberId, version }))
  }
  return { roles, assignments }
}

function shapeMembers(raw) {
  if (!isRecordList(raw)) return null
  const members = []
  for (let i = 0; i < raw.length; i += 1) {
    const member = raw[i]
    const memberId = positiveId(member.memberId)
    if (!memberId) return null
    if (member.isOwner === true) continue
    members.push(Object.assign({}, member, {
      memberId,
      nickname: typeof member.nickname === 'string' && member.nickname.trim()
        ? member.nickname.trim() : '城瘾玩家',
    }))
  }
  return members
}

// R1 Figma(290:393)「当前委派」把主理人列为第一行(全部权限,不可撤销)——
// shapeMembers 会把主理人从可选成员里过滤掉,这里单独找回昵称给那一行展示用。
function findOwnerName(raw) {
  if (!isRecordList(raw)) return ''
  for (let i = 0; i < raw.length; i += 1) {
    const member = raw[i]
    if (member && member.isOwner === true) {
      return typeof member.nickname === 'string' && member.nickname.trim()
        ? member.nickname.trim() : '主理人'
    }
  }
  return ''
}

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    clubId: null,
    activityId: null,
    // CU-C-57:nav 下的副标题 = 本页作用对象(哪一场)。空串时不渲染副标题。
    activitySubtitle: '',
    ownerName: '主理人',
    // 稿 R1 290:393:成员与角色都是行内选择器,选中的名字显示在行右侧
    memberPickerVisible: false,
    rolePickerVisible: false,
    selectedMemberName: '',
    selectedRoleCode: '',
    selectedRoleName: '',
    state: 'loading', // loading | no-permission | network-error | error(业务) | empty | ready
    errorText: '',
    members: [],
    roles: [],
    assignments: [],
    selectedMemberId: null,
    actingKey: '',
  },

  onLoad(options) {
    const clubId = positiveId(options && options.clubId)
    const activityId = positiveId(options && options.activityId)
    if (!clubId) {
      this.setData({ state: 'error', errorText: '缺少俱乐部ID' })
      return
    }
    this._requestedMemberId = positiveId(options && options.memberId)
    // CU-C-57:场次角色页必须说清作用对象。从本场工具进来时入口已经把
    // 「活动名 · 开始时间」编进 query;取不到(深链/旧入口)就退到「场次 #id」。
    const activityLabel = activityId ? entryLabel(options && options.activityLabel) : ''
    const activitySubtitle = activityId ? (activityLabel || ('场次 #' + activityId)) : ''
    this.setData({ clubId, activityId, activitySubtitle })
    this.loadAccess()
  },

  // 根栈兜底:这四页可由分享/深链直达,栈深为 1 时 navigateBack 是空操作,
  // 必须退回俱乐部列表 tab,否则用户卡在页面里出不去(all-page-back-stack-contract)。
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/talent/list/index' })
  },
  onPullDownRefresh() { this.retryLoad() },
  retryLoad() { this.loadAccess() },

  loadAccess() {
    const that = this
    this._loadCycle = (this._loadCycle || 0) + 1
    const cycle = this._loadCycle
    this.setData({ state: 'loading', errorText: '', members: [], roles: [], assignments: [], selectedMemberId: null, selectedMemberName: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/access/me',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId, activityId: this.data.activityId || undefined }),
      header: jsonHeader(),
      success(res) {
        if (cycle !== that._loadCycle) return
        const access = isSuccess(res) && isRecord(res.data) ? res.data : null
        const scopedClub = access && isRecord(access.club) ? access.club : null
        // 「响应坏了」与「没权限」是两回事:前者该给重试,后者重试一万次也没用。
        // 顺序有讲究:先判「有没有拿到数据」,再判「后端明确说不行」,最后才判范围 ——
        // 一个明确回答「你没权限」的响应本来就不必带 club 范围,不能因为缺 club 就误报成坏响应。
        // 判据:**只有后端明确表态时才认定「无权限」**。access.active 不是布尔
        // (字段缺失 / 响应残缺)就说明它没表态 —— 那是坏响应,该给重试,不能栽成权限问题。
        if (!access || typeof access.active !== 'boolean') {
          that.setData({ state: 'error', errorText: bizFailureMessage(res, '角色权限暂时不可用') })
          return
        }
        if (access.active !== true || access.canManageRoles !== true) {
          that.setData({ state: 'no-permission', errorText: bizFailureMessage(res, '仅俱乐部主理人可管理角色') })
          return
        }
        if (!scopedClub || String(scopedClub.id) !== String(that.data.clubId)) {
          that.setData({ state: 'error', errorText: bizFailureMessage(res, '角色权限暂时不可用') })
          return
        }
        that.loadManagementData(cycle)
      },
      fail() {
        if (cycle === that._loadCycle) that.setData({ state: 'network-error', errorText: '网络没有连上' })
      },
      successStatusAbnormal(res) {
        if (cycle === that._loadCycle) that.setData({ state: 'error', errorText: (res && res.msg) || '角色权限暂时不可用' })
      },
      complete() { wx.stopPullDownRefresh() },
    })
  },

  loadManagementData(cycle) {
    this._rolesReady = false
    this._membersReady = false
    this._loadFailed = false
    this.loadRoleData(cycle)
    this.loadMembers(cycle)
  },

  loadRoleData(cycle) {
    const that = this
    const activeCycle = cycle || this._loadCycle
    this._rolesReady = false
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/roles/list',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId, activityId: this.data.activityId || undefined }),
      header: jsonHeader(),
      success(res) {
        if (activeCycle !== that._loadCycle) return
        const shaped = isSuccess(res) ? shapeRoleData(res.data, that.data.clubId, that.data.activityId) : null
        if (!shaped) { that.failLoad(bizFailureMessage(res, '角色目录暂时不可用')); return }
        that.setData({ roles: shaped.roles, assignments: shaped.assignments })
        that._rolesReady = true
        that.finishLoad()
      },
      fail() { if (activeCycle === that._loadCycle) that.failLoad('网络没有连上') },
      successStatusAbnormal(res) {
        if (activeCycle === that._loadCycle) that.failLoad((res && res.msg) || '角色目录暂时不可用')
      },
    })
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
        const members = isSuccess(res) ? shapeMembers(res.data) : null
        if (!members) { that.failLoad(bizFailureMessage(res, '成员名单暂时不可用')); return }
        const requestedMemberId = positiveId(that._requestedMemberId)
        const selectedMemberId = requestedMemberId && members.some(function (member) {
          return member.memberId === requestedMemberId
        }) ? requestedMemberId : null
        // CU-C-29:主表单读 selectedMemberName、选择器读 selectedMemberId —— 深链预选只回填了 id,
        // 于是「未选择」和选择器里的「已选」同屏打架。这里跟 pickMember 一个口径把名字一并回填。
        const picked = selectedMemberId && members.find(function (member) {
          return member.memberId === selectedMemberId
        })
        const ownerName = isSuccess(res) ? findOwnerName(res.data) : ''
        that.setData({
          members,
          selectedMemberId,
          selectedMemberName: picked ? (picked.nickname || '这位成员') : '',
          ownerName: ownerName || that.data.ownerName,
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

  failLoad(message) {
    this._loadFailed = true
    this.setData({ state: 'error', errorText: message })
  },

  finishLoad() {
    if (this._loadFailed || !this._rolesReady || !this._membersReady) return
    const memberNames = {}
    this.data.members.forEach(function (member) { memberNames[String(member.memberId)] = member.nickname })
    const roleNames = {}
    const roleSummaries = {}
    this.data.roles.forEach(function (role) {
      roleNames[role.roleCode] = role.name
      roleSummaries[role.roleCode] = role.summary
    })
    const assignments = this.data.assignments.map(function (assignment) {
      return Object.assign({}, assignment, {
        memberName: memberNames[String(assignment.targetMemberId)] || ('成员 #' + assignment.targetMemberId),
        roleName: roleNames[assignment.roleCode] || '角色',
        roleSummary: roleSummaries[assignment.roleCode] || '',
        // CU-C-57:委派行补上作用期限(后端 VO 一直带着 expiresAt,前端此前没显示)
        expiresText: expiryText(assignment.expiresAt),
      })
    })
    this.setData({ assignments, state: this.data.members.length ? 'ready' : 'empty' })
  },

  openMemberPicker() { this.setData({ memberPickerVisible: true }) },
  closeMemberPicker() { this.setData({ memberPickerVisible: false }) },
  openRolePicker() { this.setData({ rolePickerVisible: true }) },
  closeRolePicker() { this.setData({ rolePickerVisible: false }) },

  pickMember(e) {
    const memberId = e.currentTarget.dataset.memberId
    const row = this.data.members.find(function (m) { return String(m.memberId) === String(memberId) })
    this.setData({
      selectedMemberId: memberId,
      selectedMemberName: (row && row.nickname) || '这位成员',
      memberPickerVisible: false,
    })
  },

  pickRole(e) {
    const roleCode = e.currentTarget.dataset.roleCode
    const row = this.data.roles.find(function (r) { return r.roleCode === roleCode })
    this.setData({
      selectedRoleCode: roleCode,
      selectedRoleName: (row && row.name) || '',
      rolePickerVisible: false,
    })
  },

  // 稿上是一个「分配」大按钮,成员与角色都已经在上面两行选好了 —— 不再从 dataset 取角色
  assignRole() {
    if (this.data.actingKey) return
    const memberId = positiveId(this.data.selectedMemberId)
    const roleCode = this.data.selectedRoleCode
    const role = this.data.roles.find(function (item) { return item.roleCode === roleCode })
    if (!memberId) { toast('先选择一位成员'); return }
    if (!roleCode) { toast('先选择一个角色'); return }
    if (!role || !roleAllowed(roleCode, this.data.activityId)) {
      toast('该角色不适用于当前范围')
      return
    }
    const payload = { clubId: this.data.clubId, targetMemberId: memberId, roleCode }
    if (role.scopeType === 'EVENT') payload.activityId = this.data.activityId
    this.submitAssignment(payload)
  },

  submitAssignment(payload) {
    const that = this
    const key = 'assign:' + payload.targetMemberId + ':' + payload.roleCode
    const intentKey = [key, payload.clubId, payload.activityId || 'club'].join(':')
    this._roleRequestIds = this._roleRequestIds || {}
    const requestId = this._roleRequestIds[intentKey]
      || loadRequestIntent(intentKey) || newRequestId()
    this._roleRequestIds[intentKey] = requestId
    saveRequestIntent(intentKey, requestId)
    this.setData({ actingKey: key })
    app.sendRequest({
      url: '/api/club/roles/assign',
      method: 'POST',
      data: jsonBody(Object.assign({}, payload, { requestId })),
      header: jsonHeader(),
      success(res) {
        that.setData({ actingKey: '' })
        if (!isSuccess(res)) {
          if (isClientError(res)) {
            delete that._roleRequestIds[intentKey]
            clearRequestIntent(intentKey)
          }
          toast((res && res.msg) || '分配失败'); return
        }
        delete that._roleRequestIds[intentKey]
        clearRequestIntent(intentKey)
        toast.success('角色已分配')
        that.loadRoleData(that._loadCycle)
      },
      fail() { that.setData({ actingKey: '' }); toast('网络异常，请重试') },
      successStatusAbnormal(res) {
        that.setData({ actingKey: '' })
        if (isClientError(res)) {
          delete that._roleRequestIds[intentKey]
          clearRequestIntent(intentKey)
        }
        toast((res && res.msg) || '分配失败')
      },
      complete() { if (that.data.actingKey === key) that.setData({ actingKey: '' }) },
    })
  },

  revokeRole(e) {
    if (this.data.actingKey) return
    const id = positiveId(e.currentTarget.dataset.id)
    const version = Number(e.currentTarget.dataset.version)
    const assignment = this.data.assignments.find(function (item) {
      return String(item.id) === String(id) && item.version === version
    })
    if (!assignment) { toast('角色状态已变化，请刷新'); return }
    // 三段式第一段:确认。文案(后果 + 「此操作不可撤销」)在 utils/danger-actions.js。
    this._pendingRevoke = assignment
    const dc = this.selectComponent && this.selectComponent('#dc')
    if (dc) dc.open('club.role.revoke', { name: assignment.roleName })
  },

  /** 三段式第二段:确认弹窗里点了「撤销角色」才真的发请求。 */
  onConfirmRevokeRole(e) {
    if (e.detail.key !== 'club.role.revoke') return
    const assignment = this._pendingRevoke
    if (!assignment) return
    const dc = this.selectComponent && this.selectComponent('#dc')
    if (dc) dc.busyOn()
    this.submitRevoke(assignment)
  },

  submitRevoke(assignment) {
    const that = this
    const key = 'revoke:' + assignment.id
    const intentKey = [key, this.data.clubId, assignment.version].join(':')
    this._roleRequestIds = this._roleRequestIds || {}
    const requestId = this._roleRequestIds[intentKey]
      || loadRequestIntent(intentKey) || newRequestId()
    this._roleRequestIds[intentKey] = requestId
    saveRequestIntent(intentKey, requestId)
    const payload = {
      clubId: this.data.clubId,
      assignmentId: assignment.id,
      version: assignment.version,
      reason: '主理人在角色管理页撤销',
      requestId,
    }
    if (assignment.scopeType === 'EVENT') payload.activityId = assignment.scopeId
    this.setData({ actingKey: key })
    app.sendRequest({
      url: '/api/club/roles/revoke',
      method: 'POST',
      data: jsonBody(payload),
      header: jsonHeader(),
      success(res) {
        that.setData({ actingKey: '' })
        if (!isSuccess(res)) {
          if (isClientError(res)) {
            delete that._roleRequestIds[intentKey]
            clearRequestIntent(intentKey)
          }
          that.reportRevoke(false, (res && res.msg) || '撤销失败'); return
        }
        delete that._roleRequestIds[intentKey]
        clearRequestIntent(intentKey)
        // 三段式第三段:结果确认卡
        that.reportRevoke(true)
        that.loadRoleData(that._loadCycle)
      },
      fail() { that.setData({ actingKey: '' }); that.reportRevoke(false, '网络异常，请重试') },
      successStatusAbnormal(res) {
        that.setData({ actingKey: '' })
        if (isClientError(res)) {
          delete that._roleRequestIds[intentKey]
          clearRequestIntent(intentKey)
        }
        that.reportRevoke(false, (res && res.msg) || '撤销失败')
      },
      complete() { if (that.data.actingKey === key) that.setData({ actingKey: '' }) },
    })
  },

  /** 三段式第三段:把撤销结果回给确认组件(成功→结果卡,失败→原地重试)。 */
  reportRevoke(ok, text) {
    const dc = this.selectComponent && this.selectComponent('#dc')
    if (!dc) { toast(ok ? '角色已撤销' : (text || '撤销失败')); return }
    if (ok) dc.done()
    else dc.failed(text || '撤销失败')
  },
})
