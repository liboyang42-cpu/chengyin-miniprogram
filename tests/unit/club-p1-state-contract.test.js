const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function applyDataPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]]
    cursor[parts[parts.length - 1]] = value
  })
}

function loadPage(relativePath, app, requireMap = {}) {
  let definition
  const filename = path.join(ROOT, relativePath)
  vm.runInNewContext(read(relativePath), {
    getApp: () => app,
    Page(page) { definition = page },
    require(request) {
      if (Object.prototype.hasOwnProperty.call(requireMap, request)) return requireMap[request]
      if (request === '../../../utils/response-shape.js') return require(path.join(ROOT, 'utils/response-shape.js'))
      // 邀约/合作池整形与 coop/list 共用一份(2026-09-08 抽出)。给真实现而不是桩:
      // 「可对接的活动」那段要保证的正是它按真整形渲染,桩会把问题遮住。
      if (request === '../../../utils/coop-invite-view.js') return require(path.join(ROOT, 'utils/coop-invite-view.js'))
      // 帖文卡的 variant 判定与广场共用一份,俱乐部页 require 的就是它
      if (request === '../../../utils/feed-play-card.js') return require(path.join(ROOT, 'utils/feed-play-card.js'))
      // CU-C-60/CU-C-107:俱乐部页新增的三个 require(扫码路由表 / 核销写闸 / 正文摘要),都是纯模块
      if (request === '../../../utils/verification-scan.js') return require(path.join(ROOT, 'utils/verification-scan.js'))
      if (request === '../../../utils/write-action-workflow.js') return require(path.join(ROOT, 'utils/write-action-workflow.js'))
      if (request === '../../../utils/danger-actions.js') return require(path.join(ROOT, 'utils/danger-actions.js'))
      if (request === '../utils/owner-action-guard.js') return require(path.join(ROOT, 'pages/club/utils/owner-action-guard.js'))
      throw new Error(`unexpected require: ${request}`)
    },
    Set,
    Date,
    JSON,
    wx: {
      navigateBack() {},
      navigateTo() {},
      showModal() {},
      showToast() {},
      showActionSheet() {},
      setStorageSync() {},
    },
  }, { filename })
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch) { applyDataPatch(this.data, patch) },
  })
  return page
}

function createEnrollHarness() {
  const requests = []
  const app = {
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    getUserID: () => 7,
    sendRequest(request) { requests.push(request) },
  }
  const page = loadPage('pages/club/enroll/index.js', app, {
    '../../../utils/motion-preference.js': require('../../utils/motion-preference.js'),
  })
  page.data.clubId = '9'
  page.data.permissionState = 'ready'
  return { page, requests }
}

function createDetailHarness() {
  const requests = []
  const app = {
    globalData: {},
    sendRequest(request) { requests.push(request) },
  }
  const page = loadPage('pages/club/detail/index.js', app, {
    // 真件不是桩:开团成功的震动降级(减动效不震)正是本轮要保证的行为
    '../../../utils/motion.js': require('../../utils/motion.js'),
    '../../../utils/motion-preference.js': require('../../utils/motion-preference.js'),
    '../../../utils/scene-registry.js': { getScene: () => ({}) },
    '../../../utils/datetime': { toTimestamp: () => 0 },
    '../../../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
    '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
    '../../../utils/group-code-session.js': {
      buildGroupCodeIssuePayload: () => ({}),
      listGroupCodeActivities: () => [],
    },
    '../../../utils/merchant-home-link.js': require('../../utils/merchant-home-link.js'),
    '../../../utils/ticket-source.js': require('../../utils/ticket-source.js'),
    '../../../utils/topic-share.js': require('../../utils/topic-share.js'),
    '../utils/club-event-calendar.js': require('../../pages/club/utils/club-event-calendar.js'),
  })
  page.data.clubId = '9'
  page.data.myMemberId = '7'
  return { page, requests }
}

test('报名名册把业务失败、网络失败和空数据落到互斥状态，WXML 分别消费并提供重试', () => {
  const business = createEnrollHarness()
  business.page.loadTeams()
  business.requests[0].success({ code: '500', msg: '服务暂不可用' })
  assert.equal(business.page.data.teamsState, 'business-error')
  assert.equal(business.page.data.teams.length, 0)

  const network = createEnrollHarness()
  network.page.loadTeams()
  network.requests[0].fail()
  assert.equal(network.page.data.teamsState, 'network-error')
  assert.equal(network.page.data.teams.length, 0)

  const empty = createEnrollHarness()
  empty.page.loadTeams()
  empty.requests[0].success({ code: '200', data: [] })
  assert.equal(empty.page.data.teamsState, 'ready')
  assert.equal(empty.page.data.teams.length, 0)

  const view = read('pages/club/enroll/index.wxml')
  assert.match(view, /<cy-error\b[^>]*wx:elif="\{\{teamsState === 'business-error'\}\}"[^>]*bind:retry="retryLoadTeams"/)
  assert.match(view, /<cy-error\b[^>]*wx:elif="\{\{teamsState === 'network-error'\}\}"[^>]*bind:retry="retryLoadTeams"/)
  assert.match(view, /<cy-empty\b[^>]*wx:elif="\{\{teamsState === 'ready' && teams\.length === 0\}\}"/)
})

// 2026-08-27 名册对管理员放开只读(与后端 topic-registrations 的 canGovernClub 闸同口径),
// 权限判据改读 /api/club/detail 的 isOwner/viewerIsAdmin;清退退款仍 owner-only。
test('报名名册权限走 /api/club/detail:主理人可退款、管理员只读、普通成员拒绝', () => {
  const owner = createEnrollHarness()
  owner.page.checkPermission()
  assert.equal(owner.requests[0].url, '/api/club/detail')
  owner.requests[0].success({ code: '200', data: { id: 9, isOwner: true, viewerIsAdmin: false } })
  assert.equal(owner.page.data.permissionState, 'ready')

  const admin = createEnrollHarness()
  admin.page.checkPermission()
  admin.requests[0].success({ code: '200', data: { id: 9, isOwner: false, viewerIsAdmin: true } })
  assert.equal(admin.page.data.permissionState, 'ready', '管理员必须能进名册,不再是点了必被拒的假入口')

  const member = createEnrollHarness()
  member.page.checkPermission()
  member.requests[0].success({ code: '200', data: { id: 9, isOwner: false, viewerIsAdmin: false } })
  assert.equal(member.page.data.permissionState, 'denied')
  assert.equal(member.requests.length, 1, '无权限身份不得再发请求探测名册')
  assert.equal(member.page.data.permissionDeniedSub, '仅主理人或管理员可查看报名名册')

  const unavailable = createEnrollHarness()
  unavailable.page.checkPermission()
  unavailable.requests[0].success({
    code: '200',
    data: { id: 9, isOwner: false, viewerIsAdmin: false, viewerIdentityUnavailable: true },
  })
  assert.equal(unavailable.page.data.permissionState, 'business-error', '身份加载失败不能误报成无权限')

  const view = read('pages/club/enroll/index.wxml')
  assert.match(view, /sub="\{\{permissionDeniedSub\}\}"/)
})

// 2026-09-09 清退退款从名册挪到核销详情:名册页不再有 canRefund,这条改由
// tests/unit/club-checkin-refund-contract.test.js 的「canRefund 由服务端说了算」守。

test('齿轮「报名名册」副标题按角色说实话:清退退款只对主理人承诺', () => {
  const view = read('pages/club/detail/index.wxml')
  assert.doesNotMatch(view, /<text class="cset-sub">看谁买了票，可对未核销的清退退款<\/text>/,
    '对管理员也展示「可清退退款」是撒谎字段')
  assert.match(view, /club\.isOwner \? '看谁买了票，可对未核销的清退退款' : '看谁买了票，清退退款仅主理人可操作'/)
})

test('报名名册拒绝空团队、空票种和空报名者元素', () => {
  const teams = createEnrollHarness()
  teams.page.loadTeams()
  assert.doesNotThrow(() => teams.requests[0].success({ code: '200', data: [null] }))
  assert.equal(teams.page.data.teamsState, 'business-error')

  const tickets = createEnrollHarness()
  tickets.page.data.teams = [{ id: 101, _detailState: 'idle', tickets: [] }]
  tickets.page.loadTeamDetail(0, 101)
  assert.doesNotThrow(() => tickets.requests[0].success({
    code: '200', data: { omsTicketList: [{ name: '票', cmsRegistrationList: [null] }] },
  }))
  assert.equal(tickets.page.data.teams[0]._detailState, 'business-error')
})

test('报名详情失败退出 loading，业务与网络错误都由 WXML 提供原位重试', () => {
  const business = createEnrollHarness()
  business.page.data.teams = [{ id: 101, _open: true, _detailState: 'idle', tickets: [] }]
  business.page.loadTeamDetail(0, 101)
  assert.equal(business.page.data.teams[0]._detailState, 'loading')
  business.requests[0].success({ code: '500', msg: '名册服务繁忙' })
  assert.equal(business.page.data.teams[0]._detailState, 'business-error')

  const network = createEnrollHarness()
  network.page.data.teams = [{ id: 102, _open: true, _detailState: 'idle', tickets: [] }]
  network.page.loadTeamDetail(0, 102)
  network.requests[0].fail()
  assert.equal(network.page.data.teams[0]._detailState, 'network-error')

  network.page.retryTeamDetail({ currentTarget: { dataset: { index: 0, topicId: 102 } } })
  assert.equal(network.requests.length, 2)
  assert.equal(network.page.data.teams[0]._detailState, 'loading')

  const view = read('pages/club/enroll/index.wxml')
  assert.match(view, /<cy-error\b[^>]*wx:elif="\{\{team\._detailState === 'business-error'\}\}"[^>]*bind:retry="retryTeamDetail"/)
  assert.match(view, /<cy-error\b[^>]*wx:elif="\{\{team\._detailState === 'network-error'\}\}"[^>]*bind:retry="retryTeamDetail"/)
})

test('成员列表把业务失败、网络失败和空数据分流，错误态不会进入“暂无成员”分支', () => {
  const business = createDetailHarness()
  business.page.loadMembers()
  business.requests[0].success({ code: '500', data: [] })
  assert.equal(business.page.data.membersState, 'business-error')
  assert.equal(business.page.data.members.length, 0)

  const network = createDetailHarness()
  network.page.loadMembers()
  network.requests[0].fail()
  assert.equal(network.page.data.membersState, 'network-error')
  assert.equal(network.page.data.members.length, 0)

  const empty = createDetailHarness()
  empty.page.loadMembers()
  empty.requests[0].success({ code: '200', data: [] })
  assert.equal(empty.page.data.membersState, 'ready')
  assert.equal(empty.page.data.members.length, 0)

  const view = read('pages/club/detail/index.wxml')
  assert.match(view, /<cy-error\b[^>]*wx:elif="\{\{membersState === 'business-error'\}\}"[^>]*bind:retry="loadMembers"/)
  assert.match(view, /<cy-error\b[^>]*wx:elif="\{\{membersState === 'network-error'\}\}"[^>]*bind:retry="loadMembers"/)
  assert.match(view, /<block\s+wx:elif="\{\{membersState === 'ready'\}\}"[\s\S]*?members\.length === 0/)
  const config = JSON.parse(read('pages/club/detail/index.json'))
  assert.equal(config.usingComponents['cy-error'], '/components/cy/error/index')
})

test('管理看板按当前 clubId 请求，坏响应不降级成假 0', () => {
  const ready = createDetailHarness()
  ready.page.data.club = { id: 9, isOwner: true }
  ready.page.loadClubStats()
  assert.equal(ready.requests[0].url, '/api/stats/club')
  assert.equal(ready.requests[0].method, 'POST')
  assert.deepEqual(JSON.parse(ready.requests[0].data), { clubId: '9' })
  ready.requests[0].success({
    code: '200',
    data: {
      clubId: 9,
      topicCount: 2,
      participants: 12,
      completed: 7,
      overallRate: 58.3,
      topics: [{ topicId: 101, name: '夜游', participants: 8, completed: 5, completionRate: 62.5, funnel: [] }],
    },
  })
  assert.equal(ready.page.data.clubStatsState, 'ready')
  assert.equal(ready.page.data.clubStats.overallRateText, '58.3%')
  assert.equal(ready.page.data.clubStats.topics[0].completionRateText, '62.5%')

  const malformed = createDetailHarness()
  malformed.page.data.club = { id: 9, isOwner: true }
  malformed.page.loadClubStats()
  malformed.requests[0].success({ code: '200', data: {} })
  assert.equal(malformed.page.data.clubStatsState, 'error')
  assert.equal(malformed.page.data.clubStats, null)

  const view = read('pages/club/detail/index.wxml')
  assert.match(view, /clubStatsState === 'loading'/)
  assert.match(view, /clubStatsState === 'error'[\s\S]*bind:retry="loadClubStats"/)
  assert.match(view, /clubStatsState === 'ready'/)
})

function declarations(source, selector) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少样式块 ${selector}`)
  return Object.fromEntries(match[1].split(';').map((line) => line.trim()).filter(Boolean).map((line) => {
    const split = line.indexOf(':')
    return [line.slice(0, split).trim(), line.slice(split + 1).trim()]
  }))
}

function parseRgb(hex) {
  const value = hex.trim().replace('#', '')
  assert.equal(value.length, 6, `只接受可测量的不透明 RGB token，收到 ${hex}`)
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16))
}

function luminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

function contrast(a, b) {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

test('发邀请按钮使用 DS 前景/背景 token，真实对比度达标且触控区至少 88rpx', () => {
  // 2026-08-20 稿 8:24:找场地卡上的按钮被删,发邀请链路 = 整卡点进商家主页 →
  // 主页底部「发起合作」(coop/invite type=0)。契约本体跟着 CTA 走:
  // DS token + 对比度 ≥4.5 + 触控区 ≥88rpx,验的是 cy-profile 的 .pc-coop-btn
  const style = read('components/cy/profile/index.wxss')
  const tokenSource = read('style/tokens.wxss')
  const button = declarations(style, '.pc-coop-btn')
  const theme = declarations(tokenSource, '.theme-dark')

  assert.match(button.background, /^var\(--cy-color-/)
  assert.match(button.color, /^var\(--cy-color-/)
  const backgroundToken = button.background.match(/^var\((--[^)]+)\)$/)[1]
  const foregroundToken = button.color.match(/^var\((--[^)]+)\)$/)[1]
  assert.ok(contrast(parseRgb(theme[backgroundToken]), parseRgb(theme[foregroundToken])) >= 4.5)
  assert.ok(Number.parseFloat(button['min-width']) >= 88)
  assert.ok(Number.parseFloat(button['min-height']) >= 88)

  // 链路前半段:找场地卡整卡可点,进商家主页(memberId 交接)
  const view = read('pages/club/detail/index.wxml')
  assert.match(view, /<cy-merchant-card[^>]*data-memberid="\{\{item\.memberId\}\}"[^>]*bind:tap="goMerchantProfile"/)
})
