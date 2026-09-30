const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
function read(relative) { return fs.readFileSync(path.join(ROOT, relative), 'utf8') }
function applyDataPatch(data, patch) { Object.keys(patch).forEach((key) => { data[key] = patch[key] }) }

function createHarness(source) {
  let definition
  const requests = []
  const toasts = []
  const modals = []
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { requests.push(options) },
  }
  vm.runInNewContext(source || read('pages/club/governance/index.js'), {
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
    Math,
    wx: {
      navigateBack() {},
      showToast(options) { toasts.push(options) },
      showModal(options) {
        modals.push(options)
        options.success({ confirm: true, content: options.title.indexOf('解除') >= 0 ? '复核通过' : '线下骚扰' })
      },
      stopPullDownRefresh() {},
    },
  }, { filename: path.join(ROOT, 'pages/club/governance/index.js') })
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch) { applyDataPatch(this.data, patch) },
  })
  return { page, requests, toasts, modals }
}

function requestByUrl(harness, url, from = 0) {
  return harness.requests.slice(from).find((request) => request.url === url)
}

function openManagerPage(harness, members = [{ memberId: 902, nickname: '小林', isOwner: false }], bans = [], options = { clubId: '11' }) {
  harness.page.onLoad(options)
  assert.equal(harness.requests[0].url, '/api/club/access/me')
  harness.requests[0].success({
    code: '200',
    data: {
      active: true,
      club: { id: 11, name: '夜行者' },
      roleCodes: ['CLUB_OWNER'],
      permissions: ['club:read', 'club:member:manage'],
    },
  })
  requestByUrl(harness, '/api/club/members').success({ code: '200', data: members })
  requestByUrl(harness, '/api/club/governance/list').success({ code: '200', data: bans })
}

test('owner/co-owner 只有拿到 member:manage 后才加载同俱乐部 roster 与治理历史', () => {
  const harness = createHarness()
  openManagerPage(harness)

  assert.equal(harness.page.data.state, 'ready')
  // 2026-09-09 按稿 R6 重排后页面不再单独渲染俱乐部名,标题固定「成员治理」
  assert.equal(harness.page.data.pageTitle, '成员治理')
  assert.equal(harness.page.data.members.length, 1)
  assert.equal(harness.page.data.bans.length, 0)

  const forbidden = createHarness()
  forbidden.page.onLoad({ clubId: '11' })
  forbidden.requests[0].success({
    code: 200,
    data: { active: true, club: { id: 11 }, permissions: ['club:read'] },
  })
  // 2026-08-26:权限拒绝从 error 里分出来。原来两者同态,界面上都渲染成
  // 「治理功能暂时不可用 + 重新加载」—— 没权限的人会一直点那个永远好不了的重试。
  assert.equal(forbidden.page.data.state, 'no-permission', '权限拒绝不得伪装成加载失败')
  assert.equal(forbidden.requests.length, 1, '无治理权限不能请求成员名单或封禁历史')
})

test('详情治理入口只把 memberId 当预选意图，权限与 roster 回读通过后才选中', () => {
  const selected = createHarness()
  openManagerPage(selected, [
    { memberId: 902, nickname: '小林', isOwner: false },
    { memberId: 903, nickname: '阿照', isOwner: false },
  ], [], { clubId: '11', memberId: '902' })
  assert.equal(selected.page.data.selectedMemberId, 902)

  const stale = createHarness()
  openManagerPage(stale, [
    { memberId: 902, nickname: '小林', isOwner: false },
  ], [], { clubId: '11', memberId: '999' })
  assert.equal(stale.page.data.selectedMemberId, null,
    'query 里的成员不在后端 roster 时不得产生预选')
})

test('俱乐部封禁必须带成员、原因、1至90天期限和唯一 requestId，成功后重载服务端真源', () => {
  const harness = createHarness()
  openManagerPage(harness)
  harness.page.pickMember({ currentTarget: { dataset: { memberId: 902 } } })
  harness.page.pickDuration({ currentTarget: { dataset: { days: 7 } } })
  const before = harness.requests.length
  const sentAt = Date.now()

  harness.page.banSelectedMember()

  const request = requestByUrl(harness, '/api/club/governance/ban', before)
  assert.ok(request)
  const body = JSON.parse(request.data)
  assert.equal(body.clubId, 11)
  assert.equal(body.targetMemberId, 902)
  assert.equal(body.reason, '线下骚扰')
  // CU-C-55:期限必须发绝对时刻(epoch 毫秒)。原来发设备本地墙上时间串、后端按东八区反解,
  // 「７天」随时区漂移(走查实测 7 天实差 6 天 9 小时)。
  assert.equal(body.expiresAt, undefined, '不得再发无时区的本地时间串')
  assert.ok(Number.isInteger(body.expiresAtEpochMs), '期限发 epoch 毫秒')
  const days = (body.expiresAtEpochMs - sentAt) / 86400000
  assert.ok(days > 6.99 && days < 7.01, '选 7 天就是 7×24 小时,跟在哪个时区点无关')
  assert.match(body.requestId, /^cgb-11-902-[0-9a-z]+-[0-9a-z]+$/)
  assert.ok(body.requestId.length <= 64)
  assert.deepEqual(Array.from(harness.page.data.durationOptions).map((item) => item.days), [7, 30, 90])

  const requestCount = harness.requests.length
  harness.page.banSelectedMember()
  assert.equal(harness.requests.length, requestCount, '提交中重复点击不得产生第二个高风险请求')

  request.success({ code: '200', data: { id: 81 } })
  assert.ok(requestByUrl(harness, '/api/club/governance/list', requestCount))
  assert.ok(requestByUrl(harness, '/api/club/members', requestCount))
})

test('解封携带 banId/version/requestId 并在成功后重新读取治理历史', () => {
  const harness = createHarness()
  openManagerPage(harness, [], [{
    id: 81,
    clubId: 11,
    targetMemberId: 902,
    targetNickname: '小林',
    status: 'ACTIVE',
    sourceType: 'CLUB',
    banReason: '线下骚扰',
    bannedAt: '2026-08-23 12:00:00',
    expiresAt: '2026-08-30 12:00:00',
    version: 2,
  }])
  const before = harness.requests.length

  harness.page.unbanMember({ currentTarget: { dataset: { id: 81, version: 2 } } })

  const request = requestByUrl(harness, '/api/club/governance/unban', before)
  assert.ok(request)
  const body = JSON.parse(request.data)
  assert.equal(body.clubId, 11)
  assert.equal(body.banId, 81)
  assert.equal(body.version, 2)
  assert.equal(body.reason, '复核通过')
  assert.match(body.requestId, /^cgu-11-81-[0-9a-z]+-[0-9a-z]+$/)
  assert.ok(body.requestId.length <= 64)
  request.success({ code: 200 })
  assert.ok(requestByUrl(harness, '/api/club/governance/list', before + 1))
})

test('治理页具有四态并明确区分俱乐部限时治理与平台永久治理', () => {
  const view = read('pages/club/governance/index.wxml')
  assert.match(view, /state === 'loading'/)
  assert.match(view, /state === 'error'[\s\S]*bind:retry="retryLoad"/)
  assert.match(view, /state === 'empty'/)
  assert.match(view, /state === 'ready'/)
  // 2026-09-09 用户裁决「成员治理 不要那个提示语」,三句说明文案删掉。
  // 但它们守的那件事没变 —— 俱乐部只能限时、永久与申诉归平台。改判**代码**:
  // 期限选项只有 7/30/90(没有「永久」),平台工单单独一节且不在 manage 模式里。
  const durations = read('pages/club/governance/index.js')
  assert.match(durations, /DURATION_OPTIONS\s*=\s*\[[^\]]*7[^\]]*30[^\]]*90[^\]]*\]/,
    '俱乐部封禁只有 7/30/90 三档')
  assert.doesNotMatch(durations, /DURATION_OPTIONS[\s\S]{0,300}永久/,
    '永久封禁不归俱乐部,期限选项里不许出现(记录行仍会把平台的永久封禁读出来)')
  assert.match(view, /wx:if="\{\{mode !== 'manage'\}\}"[\s\S]{0,200}我的平台工单/,
    '举报与申诉是平台工单,不在俱乐部的管理模式里')
  assert.match(view, /bindtap="banSelectedMember"/)
  assert.match(view, /bindtap="unbanMember"/)
})

test('只有 owner 展示主理人转让，提交携带 target/scope/requestId', () => {
  const harness = createHarness()
  openManagerPage(harness)
  assert.equal(harness.page.data.isOwner, true)
  harness.page.pickMember({ currentTarget: { dataset: { memberId: 902 } } })
  const before = harness.requests.length
  harness.page.transferSelectedOwner()
  const request = requestByUrl(harness, '/api/club/governance/owner/transfer', before)
  assert.ok(request)
  const body = JSON.parse(request.data)
  assert.equal(body.clubId, 11)
  assert.equal(body.targetMemberId, 902)
  assert.match(body.requestId, /^cgt-11-902-[0-9a-z]+-[0-9a-z]+$/)

  const coOwner = createHarness()
  coOwner.page.onLoad({ clubId: '11' })
  coOwner.requests[0].success({
    code: 200,
    data: {
      active: true,
      club: { id: 11, name: '夜行者' },
      roleCodes: ['CLUB_MEMBER', 'CLUB_CO_OWNER'],
      permissions: ['club:member:manage'],
    },
  })
  requestByUrl(coOwner, '/api/club/members').success({ code: 200, data: [{ memberId: 902 }] })
  requestByUrl(coOwner, '/api/club/governance/list').success({ code: 200, data: [] })
  assert.equal(coOwner.page.data.isOwner, false)
})

test('平台永久封禁不提供俱乐部解封动作，有效记录仍清晰展示来源', () => {
  const harness = createHarness()
  openManagerPage(harness, [], [{
    id: 82,
    clubId: 11,
    targetMemberId: 902,
    status: 'ACTIVE',
    sourceType: 'PLATFORM',
    banReason: '平台确认长期安全风险',
    bannedAt: '2026-08-23 12:00:00',
    expiresAt: null,
    version: 0,
  }])
  assert.equal(harness.page.data.bans[0].canClubUnban, false)
  assert.equal(harness.page.data.bans[0].expiresText, '平台永久封禁')
})

test('举报与申诉走独立平台工单端点，不要求俱乐部治理权限', () => {
  const report = createHarness()
  report.page.onLoad({ clubId: '11', mode: 'report', targetMemberId: '902' })
  report.requests[0].success({
    code: 200,
    data: { active: true, club: { id: 11, name: '夜行者' }, roleCodes: ['CLUB_MEMBER'], permissions: [] },
  })
  requestByUrl(report, '/api/club/governance/cases/mine').success({ code: 200, data: [] })
  const reportBefore = report.requests.length
  report.page.reportTarget()
  const reportRequest = requestByUrl(report, '/api/club/governance/cases/report', reportBefore)
  assert.ok(reportRequest)
  assert.equal(JSON.parse(reportRequest.data).targetType, 'MEMBER')
  assert.equal(JSON.parse(reportRequest.data).targetId, 902)
  assert.deepEqual(JSON.parse(reportRequest.data).evidence, {})

  const appeal = createHarness()
  appeal.page.onLoad({ clubId: '11', mode: 'appeal' })
  assert.equal(appeal.requests[0].url, '/api/club/governance/cases/mine')
  appeal.requests[0].success({ code: 200, data: [] })
  const appealBefore = appeal.requests.length
  appeal.page.appealBan()
  assert.ok(requestByUrl(appeal, '/api/club/governance/cases/appeal', appealBefore))
  assert.equal(appeal.requests.some((item) => item.url === '/api/club/access/me'), false,
    '已被移出成员表的申诉人不应被 member access 前置挡死')
})

test('俱乐部与活动举报保留各自目标类型、目标 ID 和页面标题', () => {
  const club = createHarness()
  club.page.onLoad({ clubId: '11', mode: 'report', targetType: 'CLUB' })
  assert.equal(club.page.data.pageTitle, '俱乐部举报')
  club.requests[0].success({
    code: 200,
    data: { active: true, club: { id: 11, name: '夜行者' }, roleCodes: ['CLUB_MEMBER'], permissions: [] },
  })
  requestByUrl(club, '/api/club/governance/cases/mine').success({ code: 200, data: [] })
  club.page.reportTarget()
  const clubRequest = requestByUrl(club, '/api/club/governance/cases/report')
  assert.equal(JSON.parse(clubRequest.data).targetType, 'CLUB')
  assert.equal(JSON.parse(clubRequest.data).targetId, 11)

  const activity = createHarness()
  activity.page.onLoad({ clubId: '11', mode: 'report', targetType: 'ACTIVITY', targetId: '501' })
  assert.equal(activity.page.data.pageTitle, '活动举报')
  activity.requests[0].success({
    code: 200,
    data: { active: true, club: { id: 11, name: '夜行者' }, roleCodes: ['CLUB_MEMBER'], permissions: [] },
  })
  requestByUrl(activity, '/api/club/governance/cases/mine').success({ code: 200, data: [] })
  activity.page.reportTarget()
  const activityRequest = requestByUrl(activity, '/api/club/governance/cases/report')
  assert.equal(JSON.parse(activityRequest.data).targetType, 'ACTIVITY')
  assert.equal(JSON.parse(activityRequest.data).targetId, 501)
})

// CU-C-31 / CU-C-84:申诉资格 = 本人当前有没有有效封禁。
// 原来申诉模式只拉工单,表单常显,用户填完一遍提交时才被后端拒掉(「当前没有可申诉的有效封禁」)。
// 判据改由 /cases/mine 回包的 activeBan 下发,没有就把表单换成空态、提交也拦在前面。
function openAppealPage(casesPayload) {
  const harness = createHarness()
  harness.page.onLoad({ clubId: '11', mode: 'appeal' })
  assert.equal(harness.requests[0].url, '/api/club/governance/cases/mine')
  // 回包形状:data 仍是工单数组(兼容已发布版本),封禁判据在顶层 activeBan
  // 传数组 = 旧后端(无 activeBan 字段)
  const res = { code: 200, data: Array.isArray(casesPayload) ? casesPayload : casesPayload.cases }
  if (!Array.isArray(casesPayload) && Object.prototype.hasOwnProperty.call(casesPayload, 'activeBan')) res.activeBan = casesPayload.activeBan
  harness.requests[0].success(res)
  return harness
}

test('无有效封禁时申诉表单不渲染、提交被拦；有有效封禁才放行', () => {
  const none = openAppealPage({ cases: [], activeBan: null })
  assert.equal(none.page.data.banKnown, true, '这版后端已给出判据')
  assert.equal(none.page.data.activeBan, null)
  const before = none.requests.length
  none.page.appealBan()
  assert.equal(requestByUrl(none, '/api/club/governance/cases/appeal', before), undefined,
    '没有可申诉的封禁时不得发提交请求')
  assert.ok(none.toasts.some((item) => String(item.title).indexOf('没有可申诉的封禁') >= 0))

  const banned = openAppealPage({
    cases: [],
    activeBan: {
      id: 71, clubId: 11, targetMemberId: 903, status: 'ACTIVE', sourceType: 'CLUB',
      banReason: '线下骚扰', bannedAt: '2026-09-20 12:00:00', expiresAt: '2026-09-27 12:00:00', version: 0,
    },
  })
  assert.equal(banned.page.data.activeBan.id, 71)
  assert.equal(banned.page.data.activeBan.expiresText, '至 2026-09-27 12:00')
  assert.match(banned.page.data.activeBan.bannedAtText, /^2026-09-20/)
  const bannedBefore = banned.requests.length
  banned.page.appealBan()
  assert.ok(requestByUrl(banned, '/api/club/governance/cases/appeal', bannedBefore))
})

test('旧版后端只回工单数组时按「判据未知」处理，不把合法申诉入口关掉', () => {
  const legacy = openAppealPage([])
  assert.equal(legacy.page.data.banKnown, false)
  assert.equal(legacy.page.data.activeBan, null)
  const before = legacy.requests.length
  legacy.page.appealBan()
  assert.ok(requestByUrl(legacy, '/api/club/governance/cases/appeal', before),
    '读不到判据 ≠ 没有封禁')
})

test('activeBan 形状不合法按加载失败处理，不猜测申诉资格', () => {
  const broken = openAppealPage({ cases: [], activeBan: { id: 0, clubId: 11, status: 'ACTIVE', sourceType: 'CLUB' } })
  assert.equal(broken.page.data.state, 'error')
  assert.equal(broken.page.data.banKnown, false)
})

test('封禁确认层写明成员关系会结束（CU-C-54）', () => {
  const harness = createHarness()
  openManagerPage(harness)
  harness.page.pickMember({ currentTarget: { dataset: { memberId: 902 } } })
  harness.page.banSelectedMember()
  const modal = harness.modals[harness.modals.length - 1]
  assert.match(modal.title, /确认封禁 小林/)
  assert.match(modal.content, /成员身份/, '必须在点确认前说清封禁会结束成员身份')
  assert.match(modal.content, /解封只恢复申请资格/, '解封不重建成员行这件事也要说')
})

// CU-C-82:举报页必须写清「举报的是哪一条」。
// CU-C-139:但这一条只报「认得出」的信息 —— 内部编号不进文案,弹窗标题不复制整段目标。
test('举报目标渲染成一行说明,弹窗标题简洁、目标走正文（CU-C-82 / CU-C-139）', () => {
  const activity = createHarness()
  activity.page.onLoad({
    clubId: '11',
    mode: 'report',
    targetType: 'ACTIVITY',
    targetId: '501',
    targetName: encodeURIComponent('夜跑 · 2026-09-24 19:00'),
  })
  activity.requests[0].success({
    code: 200,
    data: { active: true, club: { id: 11, name: '夜行者' }, roleCodes: ['CLUB_MEMBER'], permissions: [] },
  })
  requestByUrl(activity, '/api/club/governance/cases/mine').success({ code: 200, data: { cases: [], activeBan: null } })
  assert.equal(activity.page.data.reportTargetLabel, '活动「夜跑 · 2026-09-24 19:00」',
    '名称与日期都得在页面上,不能只有一张空表单')
  assert.doesNotMatch(activity.page.data.reportTargetLabel, /#/,
    'CU-C-139:内部编号不帮主理人认出哪一场,不该占这一行')
  activity.page.reportTarget()
  const reportModal = activity.modals[activity.modals.length - 1]
  assert.equal(reportModal.title, '举报这场活动',
    'CU-C-139:标题只要一个简洁动作名 —— 复制整段目标会折成两行')
  assert.equal(reportModal.content, '活动「夜跑 · 2026-09-24 19:00」',
    'CU-C-82 的核对不丢:目标改摆在输入框上方那一行')

  const bare = createHarness()
  bare.page.onLoad({ clubId: '11', mode: 'report', targetType: 'CLUB' })
  bare.requests[0].success({
    code: 200,
    data: { active: true, club: { id: 11, name: '夜行者' }, roleCodes: ['CLUB_MEMBER'], permissions: [] },
  })
  requestByUrl(bare, '/api/club/governance/cases/mine').success({ code: 200, data: { cases: [], activeBan: null } })
  assert.equal(bare.page.data.reportTargetLabel, '俱乐部',
    '入口没带名称时只剩类型 —— 不拿一个谁也核对不了的编号顶上')
  bare.page.reportTarget()
  assert.equal(bare.modals[bare.modals.length - 1].title, '举报这个俱乐部')

  assert.match(read('pages/club/governance/index.wxml'), /\{\{reportTargetLabel\}\}/,
    '算出来的目标说明要在 wxml 里渲染')

  // 三个入口都得把显示名带上,否则治理页拿不到
  const detailJs = read('pages/club/detail/index.js')
  assert.match(detailJs, /targetMemberId=' \+ memberId[\s\S]{0,80}targetName=/)
  assert.match(detailJs, /targetType=CLUB&targetId=' \+ clubId[\s\S]{0,80}targetName=/)
  assert.match(detailJs, /targetType=ACTIVITY&targetId=' \+ id[\s\S]{0,80}targetName=/)
  assert.match(read('pages/club/detail/index.wxml'), /catchtap="reportClubMember"[^>]*data-nickname="\{\{item\.nickname/,
    '成员举报入口要从行上带出昵称')
})

// CU-C-139 负控:把内部编号拼回目标行、或让标题重新复制整段目标,上面那条就必须红。
test('负控:举报目标行摆回内部编号、或标题复制整段目标,契约要判红（CU-C-139）', () => {
  const source = read('pages/club/governance/index.js')
  // ① 目标行退回「类型「名」 · #id」(签名、返回、调用点三处一起退回)
  const swap = (text, from, to) => {
    const next = text.replace(from, to)
    assert.notEqual(next, text, `负控改的必须是现码里真存在那一行: ${from}`)
    return next
  }
  const withId = swap(
    swap(
      swap(source, 'function reportTargetLabel(targetType, name) {', 'function reportTargetLabel(targetType, targetId, name) {'),
      /return name \? \(typeText \+ '「' \+ name \+ '」'\) : typeText/,
      "return name ? (typeText + '「' + name + '」 · #' + targetId) : (typeText + ' #' + targetId)"
    ),
    'reportTargetLabel(reportTargetType, entryName(',
    'reportTargetLabel(reportTargetType, reportTargetId, entryName('
  )
  const harness = createHarness(withId)
  harness.page.onLoad({
    clubId: '11', mode: 'report', targetType: 'ACTIVITY', targetId: '501',
    targetName: encodeURIComponent('夜跑'),
  })
  harness.requests[0].success({
    code: 200,
    data: { active: true, club: { id: 11, name: '夜行者' }, roleCodes: ['CLUB_MEMBER'], permissions: [] },
  })
  assert.match(harness.page.data.reportTargetLabel, /#501/, '撤掉修复后目标行重新出现内部编号 ⇒ 上面断言会红')

  // ② 标题退回复制整段目标
  const longTitle = source.replace(
    /'举报' \+ reportTargetHint\(this\.data\.reportTargetType\)/,
    "'举报' + (this.data.reportTargetLabel || '这条')"
  )
  assert.notEqual(longTitle, source, '负控改的必须是现码里真存在那一行')
  const second = createHarness(longTitle)
  second.page.onLoad({
    clubId: '11', mode: 'report', targetType: 'ACTIVITY', targetId: '501',
    targetName: encodeURIComponent('夜跑'),
  })
  second.requests[0].success({
    code: 200,
    data: { active: true, club: { id: 11, name: '夜行者' }, roleCodes: ['CLUB_MEMBER'], permissions: [] },
  })
  second.page.reportTarget()
  assert.equal(second.modals[second.modals.length - 1].title, '举报活动「夜跑」',
    '撤掉修复后标题又变成两行长标题 ⇒ 上面断言会红')
})
