const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js
const { attachDangerConfirm } = require('./helpers/danger-confirm-stub')

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function applyDataPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => { target[key] = value })
}

function createHarness() {
  let definition
  const requests = []
  const toasts = []
  const navigations = []
  const storage = {}
  const app = {
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    getUserID: () => '9',
    sendRequest(request) { requests.push(request) },
  }
  vm.runInNewContext(read('pages/club/roles/index.js'), {
    getApp: () => app,
    Page(page) { definition = page },
    require(request) {
      if (request === '../../../utils/response-shape.js') {
        return require(path.join(ROOT, 'utils/response-shape.js'))
      }
      throw new Error(`unexpected require: ${request}`)
    },
    Date,
    JSON,
    wx: {
      navigateBack() {},
      navigateTo(options) { navigations.push(options) },
      showToast(options) { toasts.push(options) },
      showModal(options) { options.success({ confirm: true }) },
      getStorageSync(key) { return storage[key] },
      setStorageSync(key, value) { storage[key] = value },
      removeStorageSync(key) { delete storage[key] },
      stopPullDownRefresh() {},
    },
  }, { filename: path.join(ROOT, 'pages/club/roles/index.js') })
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch) { applyDataPatch(this.data, patch) },
  })
  return { page, requests, toasts, navigations }
}

function createDetailHarness(storage = {}) {
  let definition
  const requests = []
  const navigations = []
  const actionSheets = []
  const app = {
    globalData: {},
    getUserID: () => '9',
    sendRequest(request) { requests.push(request) },
  }
  vm.runInNewContext(read('pages/club/detail/index.js'), {
    getApp: () => app,
    Page(page) { definition = page },
    require(request) {
      const modules = {
        '../../../utils/motion.js': require('../../utils/motion.js'),
        '../../../utils/motion-preference.js': require('../../utils/motion-preference.js'),
        '../../../utils/scene-registry.js': { getScene: () => ({}) },
        '../../../utils/datetime': { toTimestamp: () => 0 },
        '../../../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
        '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
        '../../../utils/group-code-session.js': require('../../utils/group-code-session.js'),
        '../../../utils/merchant-home-link.js': require('../../utils/merchant-home-link.js'),
        '../../../utils/ticket-source.js': require('../../utils/ticket-source.js'),
        '../../../utils/topic-share.js': require('../../utils/topic-share.js'),
        '../../../utils/response-shape.js': require('../../utils/response-shape.js'),
        // 邀约/合作池整形与 coop/list 共用一份(2026-09-08 抽出);这里给真实现,
        // 因为「可对接的活动」那段就是要保证它按真整形渲染,桩会把问题遮住
        '../../../utils/coop-invite-view.js': require('../../utils/coop-invite-view.js'),
        '../utils/club-event-calendar.js': require('../../pages/club/utils/club-event-calendar.js'),
        // 帖文卡的 variant 判定与广场共用一份,俱乐部页 require 的就是它
        '../../../utils/feed-play-card.js': require('../../utils/feed-play-card.js'),
        // CU-C-60:快捷扫码的写请求也要能在这层沙箱里跑起来
        '../../../utils/verification-scan.js': require('../../utils/verification-scan.js'),
        '../../../utils/write-action-workflow.js': require('../../utils/write-action-workflow.js'),
        '../../../utils/danger-actions.js': require('../../utils/danger-actions.js'),
      }
      if (Object.prototype.hasOwnProperty.call(modules, request)) return modules[request]
      throw new Error(`unexpected require: ${request}`)
    },
    Set,
    Date,
    JSON,
    wx: {
      navigateBack() {},
      navigateTo(options) { navigations.push(options.url) },
      showModal() {},
      showToast() {},
      showActionSheet(options) {
        actionSheets.push(options)
        if (options && options.success) options.success({ tapIndex: 0 })
      },
      getStorageSync(key) { return storage[key] },
      setStorageSync(key, value) { storage[key] = value },
      removeStorageSync(key) { delete storage[key] },
    },
  }, { filename: path.join(ROOT, 'pages/club/detail/index.js') })
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data, { clubId: 9, myMemberId: 901 }),
    setData(patch) { applyDataPatch(this.data, patch) },
  })
  return { page, requests, navigations, actionSheets, storage }
}

function requestByUrl(harness, url, from = 0) {
  return harness.requests.slice(from).find((request) => request.url === url)
}

function openOwnerPage(harness, members, options = { clubId: '9' }) {
  harness.page.onLoad(options)
  assert.equal(harness.requests[0].url, '/api/club/access/me')
  harness.requests[0].success({
    code: '200',
    data: { active: true, canManageRoles: true, club: { id: 9, name: '夜行者' }, permissions: ['club:role:manage'] },
  })
  requestByUrl(harness, '/api/club/roles/list').success({
    code: '200',
    data: {
      roles: [
        { roleCode: 'CLUB_CO_OWNER', name: '副主理人', scopeType: 'CLUB', permissions: ['club:write'] },
        { roleCode: 'CLUB_OPERATOR', name: '俱乐部运营', scopeType: 'CLUB', permissions: ['club:notify:send'] },
        { roleCode: 'EVENT_LEAD', name: '活动领队', scopeType: 'EVENT', permissions: ['club:event:operate'] },
      ],
      assignments: [],
    },
  })
  requestByUrl(harness, '/api/club/members').success({ code: '200', data: members })
}

test('仅 owner 通过 access/me 后加载固定角色目录与成员 roster，并进入 ready', () => {
  const harness = createHarness()
  openOwnerPage(harness, [
    { id: 1, memberId: 900, nickname: '主理人', isOwner: true },
    { id: 2, memberId: 901, nickname: '小林', isOwner: false },
  ])

  assert.equal(harness.page.data.state, 'ready')
  assert.equal(harness.page.data.members.length, 1)
  assert.deepEqual(Array.from(harness.page.data.roles, (role) => role.roleCode), [
    'CLUB_CO_OWNER', 'CLUB_OPERATOR',
  ])
  assert.equal(harness.page.data.assignments.length, 0)
})

test('详情成员权限入口只把合法 memberId 作为意图，access/me 与 roster 回读后才预选', () => {
  const selected = createHarness()
  openOwnerPage(selected, [
    { id: 1, memberId: 900, nickname: '主理人', isOwner: true },
    { id: 2, memberId: 901, nickname: '小林', isOwner: false },
  ], { clubId: '9', memberId: '901' })
  assert.equal(selected.page.data.selectedMemberId, 901)
  // CU-C-29:主表单读 selectedMemberName、选择器读 selectedMemberId ——
  // 只回填 id 会让主表单写「未选择」、而选择器里那一行已经是「已选」,同屏打架。
  assert.equal(selected.page.data.selectedMemberName, '小林',
    '预选必须两边同时回填,主表单与选择器不得各说一套')

  const stale = createHarness()
  openOwnerPage(stale, [
    { id: 1, memberId: 900, nickname: '主理人', isOwner: true },
    { id: 2, memberId: 901, nickname: '小林', isOwner: false },
  ], { clubId: '9', memberId: '999' })
  assert.equal(stale.page.data.selectedMemberId, null,
    'query 里的成员不在后端 roster 时不得产生预选')
  assert.equal(stale.page.data.selectedMemberName, '',
    '没选中就不能留上一个人的名字')
})

// 2026-08-26:原来「没权限」和「响应坏了」共用一个 error 态,界面上都渲染成
// 「角色管理暂时不可用 + 重新加载」—— 给了一个永远点不成功的重试按钮,
// 用户不会知道是权限问题。现在拆开,这条契约同时钉死「它们必须不一样」。
test('非 owner 落 no-permission、坏响应落 error、空 roster 落 empty，三者互不混用', () => {
  const forbidden = createHarness()
  forbidden.page.onLoad({ clubId: '9' })
  forbidden.requests[0].success({ code: '200', data: { active: true, canManageRoles: false } })
  assert.equal(forbidden.page.data.state, 'no-permission', '权限拒绝不得伪装成加载失败')
  assert.equal(forbidden.requests.length, 1)

  const malformed = createHarness()
  malformed.page.onLoad({ clubId: '9' })
  malformed.requests[0].success({ code: '200', data: {} })
  assert.equal(malformed.page.data.state, 'error')
  assert.notEqual(malformed.page.data.state, forbidden.page.data.state,
    '坏响应与没权限必须是两个态,否则重试按钮会出现在永远重试不好的地方')

  const empty = createHarness()
  openOwnerPage(empty, [{ id: 1, memberId: 900, nickname: '主理人', isOwner: true }])
  assert.equal(empty.page.data.state, 'empty')
})

test('分配请求只发送后端目录中的固定 club role/scope，成功后重载真源', () => {
  const harness = createHarness()
  openOwnerPage(harness, [
    { id: 1, memberId: 900, nickname: '主理人', isOwner: true },
    { id: 2, memberId: 901, nickname: '小林', isOwner: false },
  ])
  // 稿 R1 290:393 改成「选成员 › / 选角色 › / 分配」三行,角色不再从按钮的 dataset 上取
  harness.page.pickMember({ currentTarget: { dataset: { memberId: 901 } } })
  harness.page.pickRole({ currentTarget: { dataset: { roleCode: 'CLUB_CO_OWNER' } } })
  const before = harness.requests.length
  harness.page.assignRole()
  const request = requestByUrl(harness, '/api/club/roles/assign', before)
  assert.ok(request)
  const payload = JSON.parse(request.data)
  assert.equal(payload.clubId, 9)
  assert.equal(payload.targetMemberId, 901)
  assert.equal(payload.roleCode, 'CLUB_CO_OWNER')
  assert.match(payload.requestId, /^club-role-[A-Za-z0-9-]{1,50}$/)
  request.fail()
  harness.page.assignRole()
  const retry = harness.requests[harness.requests.length - 1]
  assert.equal(JSON.parse(retry.data).requestId, payload.requestId,
    '响应丢失后的重试必须复用同一 requestId')
  retry.success({ code: '200', data: { id: 71 } })
  assert.ok(requestByUrl(harness, '/api/club/roles/list', before + 1))

  const count = harness.requests.length
  harness.page.pickRole({ currentTarget: { dataset: { roleCode: 'EVENT_LEAD' } } })
  harness.page.assignRole()
  assert.equal(harness.requests.length, count, '无 activityId 的 club 管理页不能伪造 EVENT scope')
})

test('撤销发送 assignmentId/version/固定审计原因，不能依赖旧 club_member.role', () => {
  const harness = createHarness()
  openOwnerPage(harness, [
    { id: 1, memberId: 900, nickname: '主理人', isOwner: true },
    { id: 2, memberId: 901, nickname: '小林', isOwner: false },
  ])
  harness.page.data.assignments = [{ id: 71, version: 3, targetMemberId: 901, roleCode: 'CLUB_CO_OWNER' }]
  // 2026-08-27:撤销先过 cy-danger-confirm 三段式确认,确认后才发请求。
  // 合同要保的 payload 与 requestId 复用一字未改,只是多了「用户点确认」这一步。
  const dc = attachDangerConfirm(harness.page, { confirmHandler: 'onConfirmRevokeRole' })
  const before = harness.requests.length
  harness.page.revokeRole({ currentTarget: { dataset: { id: 71, version: 3 } } })
  assert.equal(harness.requests.length, before, '没确认之前不许发撤销请求')
  assert.ok(
    dc.opens[0].action.consequences.some(item => item.text.includes('此操作不可撤销')),
    '撤销角色是不可逆动作,确认文案必须写明不可撤销',
  )
  dc.confirm()
  const request = requestByUrl(harness, '/api/club/roles/revoke', before)
  const payload = JSON.parse(request.data)
  assert.equal(payload.clubId, 9)
  assert.equal(payload.assignmentId, 71)
  assert.equal(payload.version, 3)
  assert.equal(payload.reason, '主理人在角色管理页撤销')
  assert.match(payload.requestId, /^club-role-[A-Za-z0-9-]{1,50}$/)
  request.fail()
  harness.page.revokeRole({ currentTarget: { dataset: { id: 71, version: 3 } } })
  dc.confirm()
  const retry = harness.requests[harness.requests.length - 1]
  assert.equal(JSON.parse(retry.data).requestId, payload.requestId,
    '撤销响应丢失后的重试必须复用同一 requestId')
})

test('详情内容治理只认 access/me 的 club:write，旧 role=1 不能把撤销后的权限顶回来', () => {
  const revoked = createDetailHarness()
  revoked.page.loadClubAccess()
  assert.equal(revoked.requests[0].url, '/api/club/access/me')
  revoked.requests[0].success({
    code: '200',
    data: { active: true, club: { id: 9 }, permissions: ['club:read', 'club:event:checkin'] },
  })
  assert.equal(revoked.page.data.clubAccessState, 'ready')
  assert.equal(revoked.page.data.canModerateContent, false)

  revoked.page.loadMembers()
  revoked.requests[1].success({
    code: '200',
    data: [{ id: 2, memberId: 901, role: 1, status: 1, isOwner: false }],
  })
  assert.equal('myIsAdmin' in revoked.page.data, false, '旧 role 不再写入页面权限状态')
  assert.equal(revoked.page.data.canModerateContent, false, '旧 role 不得重新开启内容治理')

  const coOwner = createDetailHarness()
  coOwner.page.loadClubAccess()
  coOwner.requests[0].success({
    code: 200,
    data: { active: true, club: { id: 9 }, permissions: ['club:read', 'club:write'] },
  })
  assert.equal(coOwner.page.data.canModerateContent, true)

  const malformed = createDetailHarness()
  malformed.page.loadClubAccess()
  malformed.requests[0].success({ code: '200', data: { active: true, permissions: ['club:write'] } })
  assert.equal(malformed.page.data.clubAccessState, 'error')
  assert.equal(malformed.page.data.canModerateContent, false)
})

test('帖子编辑与置顶丢响应后跨页面复用同一意图，成功或明确4xx才清理并回读', () => {
  const storage = {}
  const oldPost = {
    id: 81, clubId: 9, authorMemberId: 901, type: 0,
    version: 2, isPinned: 0, content: '旧正文', images: '',
  }
  const firstEdit = createDetailHarness(storage)
  firstEdit.page.data.posts = [oldPost]
  firstEdit.page.onEditPost({ currentTarget: { dataset: { id: 81 } } })
  firstEdit.page.setData({ postEditText: '新正文' })
  firstEdit.page.submitPostEdit()
  const editRequest = requestByUrl(firstEdit, '/api/club/post/update')
  const editRequestId = JSON.parse(editRequest.data).requestId
  editRequest.fail()
  editRequest.complete()

  const replayEdit = createDetailHarness(storage)
  replayEdit.page.data.posts = [oldPost]
  replayEdit.page.onEditPost({ currentTarget: { dataset: { id: 81 } } })
  replayEdit.page.setData({ postEditText: '新正文' })
  replayEdit.page.submitPostEdit()
  const replayEditRequest = requestByUrl(replayEdit, '/api/club/post/update')
  assert.equal(JSON.parse(replayEditRequest.data).requestId, editRequestId)
  replayEditRequest.success({ code: 200, data: { id: 81, version: 3 } })
  replayEditRequest.complete()
  assert.ok(requestByUrl(replayEdit, '/api/club/post/list'), '编辑成功后必须回读帖子真源')
  assert.doesNotMatch(JSON.stringify(storage), new RegExp(editRequestId))

  const announcement = {
    id: 82, clubId: 9, authorMemberId: 900, type: 2,
    version: 3, isPinned: 0, content: '公告', images: '',
  }
  const pin = createDetailHarness(storage)
  pin.page.data.posts = [announcement]
  pin.page.data.canModerateContent = true
  pin.page.onTogglePin({ currentTarget: { dataset: { id: 82 } } })
  const firstPin = requestByUrl(pin, '/api/club/post/pin')
  const pinRequestId = JSON.parse(firstPin.data).requestId
  firstPin.successStatusAbnormal({ code: 503, msg: '暂不可用' }, 503)

  pin.page.onTogglePin({ currentTarget: { dataset: { id: 82 } } })
  const retryPin = pin.requests.at(-1)
  assert.equal(JSON.parse(retryPin.data).requestId, pinRequestId, '5xx 必须保留原置顶意图')
  retryPin.successStatusAbnormal({ code: 409, msg: 'requestId 冲突' }, 409)

  pin.page.onTogglePin({ currentTarget: { dataset: { id: 82 } } })
  const afterConflict = pin.requests.at(-1)
  assert.notEqual(JSON.parse(afterConflict.data).requestId, pinRequestId, '明确4xx后应开启新意图')
})

test('仅有场次委派也能发现管理页签，但只能打开被委派 activityId 的工具', () => {
  const harness = createDetailHarness()
  harness.page.data.club = { id: 9, isOwner: false }
  harness.page.loadClubAccess()
  harness.requests[0].success({
    code: 200,
    data: {
      active: true,
      club: { id: 9 },
      roleCodes: ['CLUB_MEMBER'],
      permissions: ['club:read'],
      eventAccesses: [{
        activityId: 71,
        topicId: 501,
        roleCodes: ['EVENT_CHECKIN'],
        permissions: ['club:read', 'club:activity:read', 'club:event:checkin'],
      }],
    },
  })

  assert.equal(harness.page.data.canUseManageTab, true)
  assert.equal(harness.page.data.canCheckInEvents, false,
    '场次权限不得提升为全俱乐部 check-in 权限')
  assert.deepEqual(Array.from(harness.page.data.clubTabs, item => item.key),
    ['posts', 'events', 'overview', 'manage'])

  harness.page.chooseActivityTool(71)
  assert.equal(harness.actionSheets.length, 0, '唯一工具应直接进入，不再弹系统菜单')
  assert.equal(harness.navigations[0], '/pages/club/event-ops/index?clubId=9&activityId=71')

  const sheetCount = harness.actionSheets.length
  const navigationCount = harness.navigations.length
  harness.page.chooseActivityTool(72)
  assert.equal(harness.actionSheets.length, sheetCount)
  assert.equal(harness.navigations.length, navigationCount,
    '未委派的场次不得出现任何工具或导航')
})

test('仅有场次委派只显示被委派话题，点击话题只打开该话题内被委派场次', () => {
  const detailView = read('pages/club/detail/index.wxml')
  const assertScopedProjectList = candidate => {
    assert.match(candidate, /manage-project-list[\s\S]*wx:for="\{\{manageTopics\}\}"/)
  }
  assertScopedProjectList(detailView)
  const unscopedView = detailView.replace('wx:for="{{manageTopics}}"', 'wx:for="{{topics}}"')
  assert.notEqual(unscopedView, detailView, '负控锚点失效')
  assert.throws(() => assertScopedProjectList(unscopedView),
    'EVENT-only 列表若退回全量 topics，静态合同必须变红')

  const harness = createDetailHarness()
  harness.page.data.club = { id: 9, isOwner: false }
  harness.page.loadClubAccess()
  harness.requests[0].success({
    code: 200,
    data: {
      active: true,
      club: { id: 9 },
      roleCodes: ['CLUB_MEMBER'],
      permissions: ['club:read'],
      eventAccesses: [{
        activityId: 71,
        topicId: 501,
        roleCodes: ['EVENT_CHECKIN'],
        permissions: ['club:read', 'club:activity:read', 'club:event:checkin'],
      }],
    },
  })

  harness.page.loadTopics()
  requestByUrl(harness, '/api/club/topics').success({
    code: 200,
    data: [
      { id: 501, name: '被委派项目' },
      { id: 502, name: '未委派项目' },
    ],
  })
  assert.deepEqual(Array.from(harness.page.data.manageTopics, item => item.id), [501],
    'EVENT-only 管理区不得列出未委派话题')

  const before = harness.requests.length
  harness.page.goManageTopic({ currentTarget: { dataset: { id: 501 } } })
  harness.page.goManageTopic({ currentTarget: { dataset: { id: 501 } } })
  assert.equal(harness.requests.filter(item => item.url === '/api/topic/info-to-user').length, 1,
    '场次工具读取未完成时不得重复发起请求')
  const topicRequest = requestByUrl(harness, '/api/topic/info-to-user', before)
  assert.ok(topicRequest, '被委派话题整行点击必须进入可执行的场次工具')
  topicRequest.success({
    code: 200,
    data: { activityList: [{ id: 71, name: '被委派场次' }, { id: 72, name: '未委派场次' }] },
  })
  assert.equal(harness.actionSheets.length, 0, '过滤后只剩一场时应直接进入，不再弹系统菜单')
  assert.equal(harness.navigations[0], '/pages/club/event-ops/index?clubId=9&activityId=71')
  topicRequest.complete()
  harness.page.goManageTopic({ currentTarget: { dataset: { id: 501 } } })
  assert.equal(harness.requests.filter(item => item.url === '/api/topic/info-to-user').length, 2,
    '请求完成后必须释放互斥，允许用户重试')
})

test('场次委派摘要必须角色与权限完全一致，畸形或越权组合立即 fail closed', () => {
  const malformedRows = [
    { activityId: 71, topicId: 501, roleCodes: [], permissions: ['club:event:operate'] },
    { activityId: 71, topicId: 501, roleCodes: ['EVENT_CHECKIN'], permissions: ['club:event:operate'] },
    { activityId: 71, topicId: 501, roleCodes: ['EVENT_LEAD'], permissions: ['club:read', 'club:event:operate'] },
    {
      activityId: 71,
      topicId: 501,
      roleCodes: ['EVENT_CHECKIN', 'EVENT_CHECKIN'],
      permissions: ['club:read', 'club:activity:read', 'club:event:checkin'],
    },
    {
      activityId: 71,
      topicId: 501,
      roleCodes: ['EVENT_CHECKIN'],
      permissions: ['club:read', 'club:activity:read', 'club:event:checkin', 'club:event:checkin'],
    },
    {
      activityId: 71,
      topicId: 501,
      roleCodes: ['EVENT_UNKNOWN'],
      permissions: ['club:read', 'club:activity:read'],
    },
    {
      activityId: 71,
      roleCodes: ['EVENT_CHECKIN'],
      permissions: ['club:read', 'club:activity:read', 'club:event:checkin'],
    },
  ]
  malformedRows.forEach((eventAccess) => {
    const harness = createDetailHarness()
    harness.page.data.club = { id: 9, isOwner: false }
    harness.page.loadClubAccess()
    harness.requests[0].success({
      code: 200,
      data: {
        active: true,
        club: { id: 9 },
        roleCodes: ['CLUB_MEMBER'],
        permissions: ['club:read'],
        eventAccesses: [eventAccess],
      },
    })
    assert.equal(harness.page.data.clubAccessState, 'error')
    assert.equal(harness.page.data.hasEventScope, false)
    assert.deepEqual(Array.from(harness.page.data.clubTabs, item => item.key),
      ['posts', 'events', 'overview'])
  })

  const duplicateActivity = createDetailHarness()
  duplicateActivity.page.data.club = { id: 9, isOwner: false }
  duplicateActivity.page.loadClubAccess()
  duplicateActivity.requests[0].success({
    code: 200,
    data: {
      active: true,
      club: { id: 9 },
      roleCodes: ['CLUB_MEMBER'],
      permissions: ['club:read'],
      eventAccesses: [
        {
          activityId: 71,
          topicId: 501,
          roleCodes: ['EVENT_CHECKIN'],
          permissions: ['club:read', 'club:activity:read', 'club:event:checkin'],
        },
        {
          activityId: 71,
          topicId: 501,
          roleCodes: ['EVENT_LEAD'],
          permissions: ['club:read', 'club:activity:read', 'club:event:operate', 'club:event:checkin'],
        },
      ],
    },
  })
  assert.equal(duplicateActivity.page.data.clubAccessState, 'error')
  assert.equal(duplicateActivity.page.data.hasEventScope, false)
})

test('同一俱乐部 access/me 重叠请求只接纳最新响应，旧响应不得复活已回收权限', () => {
  const harness = createDetailHarness()
  harness.page.data.club = { id: 9, isOwner: false }
  harness.page.loadClubAccess()
  harness.page.loadClubAccess()

  harness.requests[1].success({ code: 200, data: { active: false } })
  harness.requests[0].success({
    code: 200,
    data: {
      active: true,
      club: { id: 9 },
      roleCodes: ['CLUB_MEMBER'],
      permissions: ['club:read'],
      eventAccesses: [{
        activityId: 71,
        topicId: 501,
        roleCodes: ['EVENT_CHECKIN'],
        permissions: ['club:read', 'club:activity:read', 'club:event:checkin'],
      }],
    },
  })

  assert.equal(harness.page.data.clubAccessState, 'error')
  assert.equal(harness.page.data.hasEventScope, false)
  assert.deepEqual(Object.keys(harness.page._eventAccessByActivity), [])
})

test('详情管理页签由 access/me 权限驱动，副主理人与运营可进入，权限异常立即回收', () => {
  const coOwner = createDetailHarness()
  coOwner.page.data.club = { id: 9, isOwner: false, isJoined: true }
  coOwner.page.loadClubAccess()
  coOwner.requests[0].success({
    code: 200,
    data: {
      active: true,
      club: { id: 9 },
      permissions: [
        'club:read', 'club:write', 'club:member:list:read', 'club:member:manage',
        'club:activity:manage', 'club:event:operate', 'club:finance:read',
      ],
    },
  })
  assert.equal(coOwner.page.data.canUseManageTab, true)
  assert.equal(coOwner.page.data.canManageMembers, true)
  assert.equal(coOwner.page.data.canManageActivities, true)
  assert.equal(coOwner.page.data.canOperateEvents, true)
  assert.equal('canReadFinance' in coOwner.page.data, false, '财务权限只参与管理 tab 派生，不留死状态')
  assert.deepEqual(Array.from(coOwner.page.data.clubTabs, (tab) => tab.key), [
    'posts', 'events', 'overview', 'manage',
  ])

  const operator = createDetailHarness()
  operator.page.data.club = { id: 9, isOwner: false, isJoined: true }
  operator.page.loadClubAccess()
  operator.requests[0].success({
    code: '200',
    data: {
      active: true,
      club: { id: 9 },
      permissions: [
        'club:read', 'club:member:list:read', 'club:member:approve', 'club:content:manage',
        'club:notify:send',
      ],
    },
  })
  assert.equal(operator.page.data.canUseManageTab, true)
  assert.equal(operator.page.data.canManageMembers, false)
  assert.equal(operator.page.data.canApproveMembers, true)
  assert.equal(operator.page.data.canModerateContent, true)
  assert.equal(operator.page.data.canManageActivities, false)
  assert.equal(operator.page.data.canOperateEvents, false)
  assert.equal(operator.page.data.canCheckInEvents, false)
  // 2026-08-26:canNotifyMembers 与 canSendNotify 恒等、留两个只会漂移,已收成一个。
  //   同时它不再吃 legacyCanGovern —— 旧管理员在后端没有 NOTIFY_SEND。
  assert.equal(operator.page.data.canSendNotify, true)
  operator.page.switchTab({ detail: { key: 'manage' } })
  assert.equal(operator.page.data.activeTab, 'manage')

  operator.page.loadClubAccess()
  operator.requests[1].success({ code: '200', data: { active: false, club: { id: 9 }, permissions: [] } })
  assert.equal(operator.page.data.canUseManageTab, false)
  assert.equal(operator.page.data.activeTab, 'posts')
  assert.deepEqual(Array.from(operator.page.data.clubTabs, (tab) => tab.key), [
    'posts', 'events', 'overview',
  ])
})

test('成员低频动作层用该行真实 memberId 进入权限与限时治理，缺权限或坏 ID 安全关闭', () => {
  const allowed = createDetailHarness()
  allowed.page.data.club = { id: 9, memberId: 900, isOwner: true }
  allowed.page.data.canManageRoles = true
  allowed.page.data.canManageMembers = true
  allowed.page.goMemberRoles({ currentTarget: { dataset: { memberId: 901 } } })
  allowed.page.goMemberGovernance({ currentTarget: { dataset: { memberId: 901 } } })
  assert.deepEqual(allowed.navigations, [
    '/pages/club/roles/index?clubId=9&memberId=901',
    '/pages/club/governance/index?clubId=9&memberId=901',
  ])

  const denied = createDetailHarness()
  denied.page.data.club = { id: 9, memberId: 900, isOwner: false }
  denied.page.goMemberRoles({ currentTarget: { dataset: { memberId: 901 } } })
  denied.page.goMemberGovernance({ currentTarget: { dataset: { memberId: 'bad' } } })
  assert.deepEqual(denied.navigations, [])
})

test('静态负控：删除成员动作的 memberId 透传时路由契约必须判红', () => {
  const source = read('pages/club/detail/index.js')
  const assertPropagation = (candidate) => {
    assert.match(candidate, /roles\/index\?clubId=' \+ clubId \+ '&memberId=' \+ memberId/)
    assert.match(candidate, /governance\/index\?clubId=' \+ clubId \+ '&memberId=' \+ memberId/)
  }
  assertPropagation(source)
  const mutated = source.split(" + '&memberId=' + memberId").join('')
  assert.notEqual(mutated, source, '负控锚点失效')
  assert.throws(() => assertPropagation(mutated))
})

test('角色页四态与详情 Owner 管理区入口、分包注册均有静态契约', () => {
  const view = read('pages/club/roles/index.wxml')
  assert.match(view, /state === 'loading'/)
  assert.match(view, /state === 'error'[\s\S]*bind:retry="retryLoad"/)
  assert.match(view, /state === 'empty'/)
  assert.match(view, /state === 'ready'/)
  assert.match(view, /assignRole/)
  assert.match(view, /revokeRole/)

  const detail = read('pages/club/detail/index.wxml')
  assert.match(detail, /bindtap="goClubRoles"[\s\S]*角色与权限/)
  assert.match(detail, /activeTab === 'manage' && \(club\.isOwner \|\| canUseManageTab\)/)
  assert.match(detail, /catchtap="goClubGovernance"[\s\S]*成员治理/)
  assert.match(detail, /wx:if="\{\{club\.isOwner \|\| canApproveMembers\}\}"[\s\S]*入会申请/)
  assert.match(detail, /wx:if="\{\{club\.isOwner \|\| canManageActivities\}\}"[\s\S]*发布主题/)
  assert.match(detail, /wx:if="\{\{club\.isOwner \|\| canManageRoles\}\}"[\s\S]*角色与权限/)
  assert.match(detail, /class="member-actions"[\s\S]*catchtap="goMemberRoles"[\s\S]*>权限<[\s\S]*catchtap="goMemberGovernance"[\s\S]*>临时封禁<[\s\S]*catchtap="removeMember"[\s\S]*>移除</,
    '成员对象的低频动作必须留在成员行，且权限、封禁、移除语义分开')
  assert.doesNotMatch(detail, /bindtap="onSetRole"/)
  assert.doesNotMatch(read('pages/club/detail/index.js'), /onSetRole\s*\(/)

  const appConfig = JSON.parse(read('app.json'))
  const clubPackage = appConfig.subPackages.find((item) => item.root === 'pages/club')
  assert.ok(clubPackage.pages.includes('roles/index'))
})

// CU-C-57:场次角色页必须说清「作用对象是哪一场」。
// 原来从本场工具进去只带 activityId:nav 下没有任何活动名/日期,委派行也不写作用期限,
// 主理人在通用「角色与权限」页上分配权限,核对不了这一下点的是哪一场。
test('场次角色页带出作用对象(活动名·日期)，取不到就退到场次号；委派行带上作用期限', () => {
  const labelled = createHarness()
  openOwnerPage(labelled, [
    { id: 1, memberId: 900, nickname: '主理人', isOwner: true },
    { id: 2, memberId: 901, nickname: '小林', isOwner: false },
  ], { clubId: '9', activityId: '71', activityLabel: encodeURIComponent('夜跑 · 2026-09-24 19:00') })
  assert.equal(labelled.page.data.activitySubtitle, '夜跑 · 2026-09-24 19:00',
    '入口带了活动名就得显示出来,不能只留「角色与权限」四个字')

  const bare = createHarness()
  openOwnerPage(bare, [
    { id: 1, memberId: 900, nickname: '主理人', isOwner: true },
    { id: 2, memberId: 901, nickname: '小林', isOwner: false },
  ], { clubId: '9', activityId: '71' })
  assert.equal(bare.page.data.activitySubtitle, '场次 #71',
    '深链/旧入口没有活动名时,至少要让用户看出这是场次级页面')

  const clubScope = createHarness()
  openOwnerPage(clubScope, [
    { id: 1, memberId: 900, nickname: '主理人', isOwner: true },
    { id: 2, memberId: 901, nickname: '小林', isOwner: false },
  ])
  assert.equal(clubScope.page.data.activitySubtitle, '', '俱乐部范围的角色页不挂场次副标题')

  const view = read('pages/club/roles/index.wxml')
  assert.match(view, /cy-page-title[^>]*subtitle="\{\{activitySubtitle\}\}"/,
    '副标题得真的渲染出来,不然还是死字段')
})

test('委派行的作用期限来自后端 expiresAt，没有期限就不编一个出来', () => {
  const harness = createHarness()
  harness.page.onLoad({ clubId: '9', activityId: '71' })
  harness.requests[0].success({
    code: '200',
    data: { active: true, canManageRoles: true, club: { id: 9, name: '夜行者' }, permissions: ['club:role:manage'] },
  })
  requestByUrl(harness, '/api/club/roles/list').success({
    code: '200',
    data: {
      roles: [{ roleCode: 'EVENT_LEAD', name: '活动领队', scopeType: 'EVENT', permissions: ['club:event:operate'] }],
      assignments: [
        { id: 5, targetMemberId: 901, roleCode: 'EVENT_LEAD', scopeType: 'EVENT', scopeId: 71, version: 0, expiresAt: '2026-09-27 23:59:59' },
        { id: 6, targetMemberId: 902, roleCode: 'EVENT_LEAD', scopeType: 'EVENT', scopeId: 71, version: 0, expiresAt: null },
      ],
    },
  })
  requestByUrl(harness, '/api/club/members').success({
    code: '200',
    data: [
      { id: 1, memberId: 900, nickname: '主理人', isOwner: true },
      { id: 2, memberId: 901, nickname: '小林', isOwner: false },
      { id: 3, memberId: 902, nickname: '阿照', isOwner: false },
    ],
  })

  assert.equal(harness.page.data.assignments[0].expiresText, ' · 至 09-27')
  assert.equal(harness.page.data.assignments[1].expiresText, '', '没有 expiresAt 就不写期限')
  assert.match(read('pages/club/roles/index.wxml'), /\{\{item\.expiresText\}\}/,
    '算出来的期限要在委派行里渲染')
})
