'use strict'
// 地图组队 P 方案 · 漫游地图页(subpackageRoam/nearby)接线契约。Figma txQoyVyK 590:1014 P1–P6。
// 静态:无开局入口 / 底部只两枚角控件且开卡时收起 / 私密字段不出现。
// 行为:用桩 Page 驱动 viewerStatus 各分支、errorCode 分支、角控件收起。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const WXML = stripComments(read('subpackageRoam/nearby/index.wxml'))
const JS = stripComments(read('subpackageRoam/nearby/index.js'))

test('无开局入口:页面不再有开一局 / hangout create / join', () => {
  assert.doesNotMatch(WXML, /开一局|开局|openCreate|submitCreate/)
  assert.doesNotMatch(JS, /hangout\/create|hangout\/join|openCreate|submitCreate/)
})

test('顶部条「附近的队伍 · N 支在招募」+ 底部只剩「范围」「我的队伍」两枚角控件,开卡片时收起', () => {
  assert.match(WXML, /\{\{headerText\}\}/)
  const corners = WXML.match(/class="mt-corner[ "][^>]*>/g) || []
  assert.equal(corners.length, 2, '底部角控件必须恰好两枚')
  const wrap = WXML.match(/<view class="mt-corners"[^>]*>/)
  assert.ok(wrap, '角控件要包在 mt-corners 里')
  assert.match(wrap[0], /wx:if="\{\{!sheet\}\}"/, '开任何半屏时角控件收起')
  assert.match(WXML, /\{\{rangeText\}\}/)
  assert.match(WXML, /\{\{myTeamsText\}\}/)
  assert.doesNotMatch(WXML, /openTools|openStampCamera|pgrabhit/, '旧抽屉/拍照入口不再留在地图上')
})

test('队伍私密字段不出现在前端(页面 js/wxml)', () => {
  for (const src of [WXML, JS]) assert.doesNotMatch(src, /inviteCode|leaderMemberId|ownerType/)
})

test('失败走 cy-result-sheet(失败半屏合同),不直接 toast 后端文案', () => {
  assert.match(WXML, /<cy-result-sheet\b[^>]*kind="\{\{resultSheet\.kind\}\}"/)
  assert.doesNotMatch(JS, /cyToast\.error\(\(res && res\.msg\)/)
  assert.doesNotMatch(JS, /msg\.indexOf|msg\.includes|msg\.match|\.msg\s*===/)
})

test('P5 同意/拒绝是一行里并排的两颗小按钮,拒绝(次)在左、同意(主)在右', () => {
  const row = WXML.match(/<view class="mt-app__acts"[\s\S]*?<\/view>\s*<\/view>/)
  assert.ok(row, '申请人按钮组')
  const i = row[0].indexOf('拒绝'); const j = row[0].indexOf('同意')
  assert.ok(i > 0 && j > i)
  assert.match(row[0], /mt-sbtn mt-sbtn--s[^"]*"[^>]*>拒绝/)
  assert.match(row[0], /mt-sbtn mt-sbtn--w[^"]*"[^>]*>同意/)
})

// ── 行为 ──────────────────────────────────────────────
const PAGE = '../../subpackageRoam/nearby/index.js'
let config
let requests
let navigations
// 申请留言弹层(stub 无 cy-modal-host 时 modal.js 回落 wx.showModal):默认确认并带一句留言。
let modalAnswer = { confirm: true, content: '一起走完全程' }
global.getApp = () => ({
  globalData: {},
  getImgUrl: (u) => u || '',
  sendRequest: (opts) => { requests.push(opts) },
})
global.wx = {
  getWindowInfo: () => ({ screenHeight: 844, safeArea: { bottom: 810 } }),
  getMenuButtonBoundingClientRect: () => ({ bottom: 88 }),
  getLocation: () => {},
  navigateTo: (o) => { navigations.push(o.url) },
  showToast: () => {},
  showModal: (o) => { o && typeof o.success === 'function' && o.success(Object.assign({}, modalAnswer)) },
  createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }),
}
global.Page = (c) => { config = c }

function setByPath(target, raw, value) {
  const parts = raw.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cur = target
  for (let i = 0; i < parts.length - 1; i += 1) { if (cur[parts[i]] == null) cur[parts[i]] = {}; cur = cur[parts[i]] }
  cur[parts[parts.length - 1]] = value
}

function load() {
  requests = []; navigations = []
  modalAnswer = { confirm: true, content: '一起走完全程' }
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) })
  page.setData = function (patch, cb) { Object.keys(patch).forEach((k) => setByPath(this.data, k, patch[k])); if (cb) cb() }
  page._openSheet = function (name) { this.setData({ sheet: name, sheetIn: true }) }
  page._genTeamIcons = () => Promise.resolve(false)
  page._genIcons = () => Promise.resolve(false)
  page.onLoad()
  return page
}

const team = (over) => Object.assign({
  teamId: 7, title: '外滩夜行', activityId: 11, activityName: '外滩夜行路线 · 周五 19:30 场', topicId: 3, productType: 1,
  addressName: '外滩源', coordSource: 'GATHER', latitude: 31.2, longitude: 121.4, distance: 600, leaderName: '小周',
  joinedCount: 3, maxMembers: 4, memberAvatars: [], viewerStatus: 'NONE', viewerHasTicket: false, pendingCount: null,
}, over)

function feedTeams(page, rows) {
  page.fetchTeams({ lat: 31.2, lng: 121.4 }, 3000)
  const req = requests.filter((r) => r.url === '/api/team/nearby').pop()
  assert.ok(req, '必须请求 GET /api/team/nearby')
  assert.equal(req.method, 'GET')
  req.success({ code: 200, data: rows })
}

function tapTeam(page, id) { page.onMarkerTap({ detail: { markerId: id * 10 + 4 } }) }

test('nearby 回来:顶部条计数 + 点位;点开卡片 → 角控件收起(sheet 非空)', () => {
  const page = load()
  feedTeams(page, [team(), team({ teamId: 8, latitude: 31.3 })])
  assert.equal(page.data.headerText, '附近的队伍 · 2 支在招募')
  assert.equal(page.data.markers.filter((m) => m.id % 10 === 4).length, 2)
  assert.equal(page.data.sheet, '')
  tapTeam(page, 7)
  assert.equal(page.data.sheet, 'team')
  assert.equal(page.data.current.teamId, 7)
  page.closeSheet()
  assert.equal(page.data.sheet, '')
})

test('viewerHasTicket=false → 「去买这场的票」跳活动详情购票', () => {
  const page = load()
  feedTeams(page, [team()])
  tapTeam(page, 7)
  assert.equal(page.data.current.card.primary.text, '去买这场的票')
  page.onCardPrimary()
  assert.deepEqual(navigations, ['/pages/activity/detail/index?id=11'])
})

test('有票 → 申请加入 → 成功变 PENDING,只剩撤回', () => {
  const page = load()
  feedTeams(page, [team({ viewerHasTicket: true })])
  tapTeam(page, 7)
  page.onCardPrimary()
  const req = requests.filter((r) => r.url === '/api/team/apply').pop()
  assert.ok(req)
  const body = JSON.parse(req.data)
  assert.equal(body.teamId, 7)
  assert.equal(body.message, '一起走完全程', '申请留言随申请一起发(拍板第19条)')
  assert.equal(req.silentError, true)
  req.success({ code: 200, msg: '已申请，等待队长同意', data: {} })
  assert.equal(page.data.current.card.mode, 'pending')
  assert.equal(page.data.current.card.primary, null)
  page.onCardSecondary()
  const w = requests.filter((r) => r.url === '/api/team/withdraw').pop()
  assert.ok(w)
  w.success({ code: 200 })
  assert.equal(page.data.current.card.mode, 'apply')
})

test('errorCode=TICKET_REQUIRED → 卡片回到买票态 + 失败半屏(去买票/先不买)', () => {
  const page = load()
  feedTeams(page, [team({ viewerHasTicket: true })])
  tapTeam(page, 7)
  page.onCardPrimary()
  requests.filter((r) => r.url === '/api/team/apply').pop().success({ code: 500, errorCode: 'TICKET_REQUIRED', msg: '请先购票' })
  assert.equal(page.data.current.card.mode, 'buy')
  assert.equal(page.data.resultSheet.show, true)
  assert.equal(page.data.resultSheet.kind, 'fail')
  assert.equal(page.data.resultSheet.primaryText, '去买票')
  page.onResultPrimary()
  assert.deepEqual(navigations, ['/pages/activity/detail/index?id=11'])
})

test('errorCode=TEAM_FULL → 关卡 + 从地图移除 + 失败半屏;没有 errorCode 只报失败不改状态', () => {
  const page = load()
  feedTeams(page, [team({ viewerHasTicket: true })])
  tapTeam(page, 7)
  page.onCardPrimary()
  requests.filter((r) => r.url === '/api/team/apply').pop().success({ code: 500, errorCode: 'TEAM_FULL', msg: '已满' })
  assert.equal(page.data.sheet, '')
  assert.equal(page.data.markers.filter((m) => m.id === 74).length, 0)
  assert.equal(page.data.resultSheet.kind, 'fail')

  const p2 = load()
  feedTeams(p2, [team({ viewerHasTicket: true })])
  tapTeam(p2, 7)
  p2.onCardPrimary()
  requests.filter((r) => r.url === '/api/team/apply').pop().success({ code: 500, msg: 'TEAM_FULL 已满' })
  assert.equal(p2.data.current.card.mode, 'apply', '只有文案里写了码,不能按文案分支')
  assert.equal(p2.data.resultSheet.why, 'TEAM_FULL 已满')
})

test('PENDING / REJECTED 卡片', () => {
  const page = load()
  feedTeams(page, [team({ viewerStatus: 'PENDING' }), team({ teamId: 8, viewerStatus: 'REJECTED' })])
  tapTeam(page, 7)
  assert.deepEqual(page.data.current.card.secondary, { text: '撤回申请', action: 'withdraw' })
  assert.equal(page.data.current.card.foot, '队长没处理或活动开始时,申请自动失效')
  tapTeam(page, 8)
  assert.equal(page.data.current.card.notice.text, '不能再申请这支队伍')
  assert.equal(page.data.current.card.primary, null)
})

test('LEADER → P5 申请列表;同意/拒绝发 handle;APPLY_NOT_PENDING 移除该行', () => {
  const page = load()
  feedTeams(page, [team({ viewerStatus: 'LEADER', pendingCount: 2 })])
  tapTeam(page, 7)
  assert.equal(page.data.sheet, 'leader')
  const a = requests.filter((r) => r.url === '/api/team/applications').pop()
  assert.ok(a)
  a.success({ code: 200, data: [{ memberId: 5, memberName: '阿杰' }, { memberId: 6, memberName: 'Mia' }] })
  assert.equal(page.data.applicants.length, 2)
  page.onHandle({ currentTarget: { dataset: { id: 5, ok: 'true' } } })
  const h = requests.filter((r) => r.url === '/api/team/handle').pop()
  assert.deepEqual(JSON.parse(h.data), { teamId: 7, memberId: 5, approved: true })
  h.success({ code: 500, errorCode: 'APPLY_NOT_PENDING', msg: '已处理' })
  assert.deepEqual(page.data.applicants.map((x) => x.memberId), [6])
  assert.equal(page.data.resultSheet.kind, 'fail')
  page.onHandle({ currentTarget: { dataset: { id: 6, ok: 'false' } } })
  const h2 = requests.filter((r) => r.url === '/api/team/handle').pop()
  assert.equal(JSON.parse(h2.data).approved, false)
})

test('我的队伍 P6:拉 my + my-applications,三态行;开时角控件收起', () => {
  const page = load()
  page.openMyTeams()
  assert.equal(page.data.sheet, 'mine')
  requests.filter((r) => r.url === '/api/team/my').pop().success({ code: 200, data: [{ id: 7, title: '外滩夜行', joinedCount: 3, maxMembers: 4, status: 0 }] })
  requests.filter((r) => r.url === '/api/team/my-applications').pop().success({ code: 200, data: [
    { teamId: 8, title: '苏河湾探店日', leaderName: '阿May', applyStatus: 'PENDING' },
    { teamId: 10, title: '霓虹拾光', applyStatus: 'REJECTED' }] })
  assert.deepEqual(page.data.myRows.map((r) => r.badge), ['已加入', '申请中', '队长未同意'])
  page.onMyRowAction({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(navigations, ['/pages/team/detail/index?teamId=7'])
  page.onMyRowAction({ currentTarget: { dataset: { index: 2 } } })
  assert.equal(page.data.sheet, '')
})

test('刷新后卡片那支队伍不在了(满员/开场) → 队伍卡收掉,不留过期的「申请加入」', () => {
  const page = load()
  feedTeams(page, [team({ viewerHasTicket: true })])
  tapTeam(page, 7)
  assert.equal(page.data.sheet, 'team')
  feedTeams(page, [])
  assert.equal(page.data.sheet, '')
  assert.equal(page.data.headerText, '附近的队伍 · 0 支在招募')
})

test('申请列表迟到的旧响应不串到别的队伍;非队长读列表失败标题是「申请列表没读到」', () => {
  const page = load()
  feedTeams(page, [team({ viewerStatus: 'LEADER' }), team({ teamId: 8, viewerStatus: 'LEADER', latitude: 31.3 })])
  tapTeam(page, 7)
  const first = requests.filter((r) => r.url === '/api/team/applications').pop()
  tapTeam(page, 8)
  first.success({ code: 200, data: [{ memberId: 5, memberName: '阿杰' }] })
  assert.equal(page.data.applicants.length, 0)
  requests.filter((r) => r.url === '/api/team/applications').pop().success({ code: 500, msg: '只有队长可以操作' })
  assert.equal(page.data.resultSheet.title, '申请列表没读到')
})

test('P6 撤回成功只重拉列表,不重开半屏;角控件计数不算被拒', () => {
  const page = load()
  page.openMyTeams()
  requests.filter((r) => r.url === '/api/team/my').pop().success({ code: 200, data: [] })
  requests.filter((r) => r.url === '/api/team/my-applications').pop().success({ code: 200, data: [
    { teamId: 8, title: 'a', applyStatus: 'PENDING' }, { teamId: 10, title: 'b', applyStatus: 'REJECTED' }] })
  assert.equal(page.data.myTeamsText, '我的队伍 · 1')
  let reopened = 0
  page._openSheet = () => { reopened += 1 }
  page.onMyRowAction({ currentTarget: { dataset: { index: 0 } } })
  requests.filter((r) => r.url === '/api/team/withdraw').pop().success({ code: 200 })
  assert.equal(reopened, 0)
  assert.ok(requests.filter((r) => r.url === '/api/team/my').length >= 3)
})
