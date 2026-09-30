const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const DETAIL_JS = 'pages/club/detail/index.js'
const DETAIL_WXML = 'pages/club/detail/index.wxml'
const SETTINGS_JS = 'pages/shezhi/shezhi.js'
const WORKBENCH_JS = 'pages/club/workbench/index.js'
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadDetail() {
  let definition
  const navigations = []
  const requests = []
  const scrolls = []
  const app = {
    globalData: {},
    sendRequest(request) { requests.push(request) },
    getUserRole: () => 'member',
    getAvatar: () => '',
  }
  vm.runInNewContext(read(DETAIL_JS), {
    getApp: () => app,
    Page(page) { definition = page },
    require(request) {
      const modules = {
        '../../../utils/motion.js': require('../../utils/motion.js'),
        '../../../utils/motion-preference.js': require('../../utils/motion-preference.js'),
        '../../../utils/scene-registry.js': { getScene: () => ({}) },
        '../../../utils/datetime': { toTimestamp: (value) => Date.parse(String(value).replace(' ', 'T')) || 0 },
        '../../../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
        '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
        '../../../utils/group-code-session.js': { buildGroupCodeIssuePayload: () => ({}), listGroupCodeActivities: () => [] },
        // 真实现,不是桩:商家卡的落点地址正是本页要保证的东西之一
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
        // CU-C-60/CU-C-107:俱乐部页新增的三个 require(扫码路由表 / 核销写闸 / 正文摘要),
        // 都是纯模块,沙箱里给真实现。
        '../../../utils/verification-scan.js': require('../../utils/verification-scan.js'),
        '../../../utils/write-action-workflow.js': require('../../utils/write-action-workflow.js'),
        '../../../utils/danger-actions.js': require('../../utils/danger-actions.js'),
      }
      if (modules[request]) return modules[request]
      throw new Error(`unexpected require: ${request}`)
    },
    Set,
    Date,
    JSON,
    wx: {
      navigateTo(options) { navigations.push(options.url) },
      pageScrollTo(options) { scrolls.push(options) },
      showToast() {},
      showModal() {},
      showShareMenu() {},
      setStorageSync() {},
    },
  }, { filename: DETAIL_JS })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback.call(this) },
  })
  return { page, navigations, requests, scrolls }
}

function loadSettings() {
  let definition
  const navigations = []
  const requests = []
  const app = {
    globalData: {},
    sendRequest(request) { requests.push(request) },
  }
  vm.runInNewContext(read(SETTINGS_JS), {
    getApp: () => app,
    Page(page) { definition = page },
    require(request) {
      const modules = {
        '../../utils/motion.js': require('../../utils/motion.js'),
        '../../utils/motion-preference.js': require('../../utils/motion-preference.js'),
        '../../utils/identity/identity-policy.js': { isMerchantView: () => false },
        '../../utils/roleGuard.js': { isClubLeader: () => true, clear() {} },
        '../../utils/merchant-theme.js': { merchantPageShow() {}, merchantPageRestore() {} },
        '../../utils/scene-registry.js': { getScene: () => ({}) },
        '../../utils/scene-stack.js': {
          pushScene: (_stack, next) => [next],
          popScene: () => [],
          currentScene: (stack) => stack[stack.length - 1] || null,
          exitDecision: () => 'allow',
        },
      }
      if (modules[request]) return modules[request]
      throw new Error(`unexpected require: ${request}`)
    },
    wx: {
      navigateTo({ url }) { navigations.push(url) },
      showLoading() {},
      hideLoading() {},
    },
  }, { filename: SETTINGS_JS })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return { page, navigations, requests }
}

function loadWorkbench(options) {
  let definition
  let redirect = ''
  vm.runInNewContext(read(WORKBENCH_JS), {
    getApp: () => ({ globalData: {} }),
    Page(page) { definition = page },
    encodeURIComponent,
    wx: { redirectTo({ url }) { redirect = url }, navigateBack() {}, switchTab() {} },
  }, { filename: WORKBENCH_JS })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  page.onLoad(options || {})
  return redirect
}

function parseMiniRoute(route) {
  const parts = String(route).split('?')
  return {
    path: parts[0],
    query: Object.fromEntries(new URLSearchParams(parts[1] || '')),
  }
}

test('quick action 与四个真 tab 分离，管理仅 owner 可见且已选 tab 不回退', () => {
  const view = read(DETAIL_WXML)
  const script = read(DETAIL_JS)
  // 2026-08-26:分享从资料区那条整宽按钮收成导航栏图标。契约不变 ——
  // 分享仍是独立入口、不混进 tab;只是不再占一整行。
  // 2026-09-24 CU-C-61:分享改成原生 <button open-type="share">(view+bindtap 打不开转发面板)。
  assert.match(view, /class="cover-nav-act"[^>]*open-type="share"/)
  assert.doesNotMatch(view, /class="club-share"/, '分享不得再回到整宽按钮')
  assert.match(view, /<cy-tabs\b[^>]*class="club-view-tabs"[^>]*tabs="\{\{clubTabs\}\}"[^>]*active="\{\{activeTab\}\}"[^>]*bind:change="switchTab"/)
  assert.doesNotMatch(view, />群组<\/text>/)
  assert.doesNotMatch(script, /onGroupQuick\s*\(/)

  const { page } = loadDetail()
  assert.deepEqual(Array.from(page.tabsForClub({ isOwner: false }), (item) => item.key), ['posts', 'events', 'overview'])
  assert.deepEqual(Array.from(page.tabsForClub({ isOwner: true }), (item) => item.key), ['posts', 'events', 'overview', 'manage'])
  page.data.activeTab = 'events'
  page.data.club = { isOwner: false }
  page.switchTab({ currentTarget: { dataset: { tab: 'events' } } })
  assert.equal(page.data.activeTab, 'events', '已选 tab 必须幂等')
  page.switchTab({ currentTarget: { dataset: { tab: 'manage' } } })
  assert.equal(page.data.activeTab, 'events', '非 owner 不得通过事件绕过管理 tab 门禁')
  page.data.club.isOwner = true
  page.switchTab({ currentTarget: { dataset: { tab: 'manage' } } })
  assert.equal(page.data.activeTab, 'manage')
})

test('owner/member/admin 默认帖子，guest/商家访客默认概览', () => {
  const { page } = loadDetail()
  page.data.isMerchantViewer = false
  assert.equal(page.defaultTabForClub({ isOwner: true, isJoined: true }), 'posts')
  assert.equal(page.defaultTabForClub({ isOwner: false, isJoined: true }), 'posts')
  assert.equal(page.defaultTabForClub({ isOwner: false, isJoined: false }), 'overview')
  page.data.isMerchantViewer = true
  assert.equal(page.defaultTabForClub({ isOwner: false, isJoined: false }), 'overview')
  assert.equal(page.defaultTabForClub({ isOwner: true, isJoined: true }), 'posts', '商家+主理人双身份仍以当前俱乐部 owner 视图为准')
})

test('管理深链只在详情回读 owner 身份后生效，参数不能替非 owner 越权', () => {
  const owner = loadDetail()
  owner.page.onLoad({ id: '9', tab: 'manage' })
  assert.notEqual(owner.page.data.activeTab, 'manage', '服务端身份回读前不得提前打开管理 tab')
  const ownerDetail = owner.requests.find((request) => request.url === '/api/club/detail')
  ownerDetail.success({ code: '200', data: { id: 9, isOwner: true, isJoined: true } })
  assert.equal(owner.page.data.activeTab, 'manage', '服务端确认 owner 后才接受管理意图')

  const guest = loadDetail()
  guest.page.onLoad({ id: '9', tab: 'manage' })
  const guestDetail = guest.requests.find((request) => request.url === '/api/club/detail')
  guestDetail.success({ code: '200', data: { id: 9, isOwner: false, isJoined: false } })
  assert.equal(guest.page.data.activeTab, 'overview', '非 owner 塞 tab 参数仍只能进入公开默认视图')

  const genericOwner = loadDetail()
  genericOwner.page.onLoad({ id: '9', owner: '1' })
  const genericDetail = genericOwner.requests.find((request) => request.url === '/api/club/detail')
  genericDetail.success({ code: '200', data: { id: 9, isOwner: true, isJoined: true } })
  assert.equal(genericOwner.page.data.activeTab, 'posts', '通用 owner 入口仍保持帖子默认契约')
})

test('设置管理入口与旧 workbench 壳显式传递 manage 意图', () => {
  const settings = loadSettings()
  settings.page.pickClub()
  settings.requests[0].success({ code: '200', data: { owned: [{ id: 9 }] } })
  const manageEntry = parseMiniRoute(settings.navigations[0])
  assert.equal(manageEntry.path, '/pages/club/detail/index')
  assert.deepEqual(manageEntry.query, { owner: '1', tab: 'manage' })

  settings.page.data.isClubView = true
  settings.page.goEdit()
  const editEntry = parseMiniRoute(settings.navigations[1])
  assert.equal(editEntry.path, '/pages/club/detail/index')
  assert.deepEqual(editEntry.query, { owner: '1', tab: 'manage' })

  const withId = parseMiniRoute(loadWorkbench({ id: 'club/7' }))
  assert.equal(withId.path, '/pages/club/detail/index')
  assert.deepEqual(withId.query, { id: 'club/7', tab: 'manage' })
  const withoutId = parseMiniRoute(loadWorkbench({}))
  assert.deepEqual(withoutId.query, { owner: '1', tab: 'manage' })
})

test('俱乐部主理人从活动或管理项目进主办视图，其余身份仍进玩家视图', () => {
  const owner = loadDetail()
  owner.page.data.club = { isOwner: true, id: 9 }
  owner.page.goTopic({ currentTarget: { dataset: { id: 701 } } })
  owner.page.goManageTopic({ currentTarget: { dataset: { id: 702 } } })
  // P0(2026-09-05):主办视图必须带 clubId,活动详情页的管理入口全靠它
  assert.deepEqual(owner.navigations, [
    '/pages/club/topic-detail/index?topicId=701&clubId=9',
    '/pages/club/topic-detail/index?topicId=702&clubId=9',
  ])

  const member = loadDetail()
  member.page.data.club = { isOwner: false }
  member.page.goTopic({ currentTarget: { dataset: { id: 703 } } })
  assert.deepEqual(member.navigations, ['/pages/topic/index/index?id=703'])
})

test('owner primary 按发布、邀请、待回应、已接受四阶段从现有读模型派生', () => {
  const { page, navigations } = loadDetail()
  Object.assign(page.data, {
    clubId: 9,
    topicState: 'ready',
    ownerProjectState: 'ready',
    inviteFeedbackState: 'ready',
    projectRows: [],
    sentInvites: [],
  })

  page._topics = []
  page.updateOwnerStage()
  assert.deepEqual([page.data.ownerStage, page.data.ownerPrimaryLabel], ['publish', '发布主题'])

  page._topics = [{ id: 901 }]
  page.updateOwnerStage()
  assert.deepEqual([page.data.ownerStage, page.data.ownerPrimaryLabel], ['invite', '邀请商家'])

  page.data.sentInvites = [{ topicId: 901, status: 0 }]
  page.updateOwnerStage()
  assert.deepEqual([page.data.ownerStage, page.data.ownerPrimaryLabel], ['pending', '查看邀请进度'])

  page.data.projectRows = [{ clubId: 9, acceptStatus: 'merchantAccepted' }]
  page.updateOwnerStage()
  assert.deepEqual([page.data.ownerStage, page.data.ownerPrimaryLabel], ['accepted', '管理项目'])
  page.data.activeTab = 'posts'
  page.onOwnerPrimary()
  assert.equal(page.data.activeTab, 'manage', '发布方已接受仍进原管理 tab')
  assert.deepEqual(navigations, [], '发布方不得被执行俱乐部的场次入口换轨')

  page.data.inviteFeedbackState = 'error'
  page.updateOwnerStage()
  assert.equal(page.data.ownerStage, 'accepted', '已有 merchantAccepted 事实时不应被邀约列表故障降级')

  page.data.projectRows = [{ clubId: 9, acceptStatus: 'merchantOpen' }]
  page.data.inviteFeedbackState = 'ready'
  page.data.sentInvites = [{ topicId: 901, status: 2 }]
  page.updateOwnerStage()
  assert.equal(page.data.ownerStage, 'invite', '拒绝/过期不得伪装成可管理项目')
})

test('合作生效只认 /api/project/my 当前 clubId 的 merchantAccepted', () => {
  const { page, requests } = loadDetail()
  Object.assign(page.data, {
    clubId: 9,
    club: { id: 9, isOwner: true },
    topicState: 'ready',
    inviteFeedbackState: 'ready',
    sentInvites: [],
  })
  page._topics = [{ id: 901 }]
  page.loadOwnerProjects()
  assert.equal(requests[0].url, '/api/project/my')
  assert.equal(requests[0].data.type, 'all', 'project/my 的 type 是 projectType，不得误传 topic 导致空列表')
  requests[0].success({ code: '200', data: { rows: [
    { id: 901, bizType: 'topic', clubId: 9, acceptStatus: 'merchantAccepted' },
    { id: 902, bizType: 'topic', clubId: 10, acceptStatus: 'merchantAccepted' },
  ] } })
  assert.deepEqual(Array.from(page.data.projectRows, (item) => item.id), [901])
  assert.equal(page.data.ownerStage, 'accepted')
  assert.equal(page.data.ownerPrimaryLabel, '管理项目')
})

test('执行俱乐部接受承接后，主行动直接进入场次运营', () => {
  const { page, navigations } = loadDetail()
  Object.assign(page.data, {
    clubId: 7002,
    club: { id: 7002, isOwner: true },
    topicState: 'ready',
    ownerProjectState: 'ready',
    inviteFeedbackState: 'ready',
    messageState: 'ready',
    manageTopics: [{ id: 990028, name: '自由探索' }],
    projectRows: [],
    sentInvites: [],
    messages: [{ topicId: 990028, toType: 'club', toId: 7002, status: 1 }],
  })
  page._topics = page.data.manageTopics
  page.updateOwnerStage()
  assert.equal(page.data.ownerStage, 'accepted')
  assert.equal(page.data.ownerPrimaryLabel, '活动运营')
  // CU-C-89(用户裁决 B):这个阶段是俱乐部级的(任意一个项目被承接就算到),没有单一「该项目」,
  // 入口也只能打开全团场次清单 —— 文案不许再按单项目口吻写。
  assert.equal(page.data.ownerStageHint, '已承接项目，可查看全部项目的场次运营')
  assert.deepEqual(Array.from(page.data.leadTimelineNodes), [], '执行方不展示发布方的「商家已接受」时间线')
  assert.equal(page.data.leadTimelineSummary, '')

  page.onOwnerPrimary()
  assert.deepEqual(navigations, ['/pages/club/event-ops/index?clubId=7002'])
})

test('管理阶段失败后的 primary 会同时重拉主题、探店日期次、项目与邀约，不留死锁', () => {
  const { page, requests } = loadDetail()
  Object.assign(page.data, { clubId: 9, club: { id: 9, isOwner: true }, ownerStage: 'error' })
  page.onOwnerPrimary()
  assert.deepEqual(requests.map((request) => request.url), [
    '/api/club/topics',
    '/api/club-compensation/editions',
    '/api/project/my',
    '/api/coop/list',
  ])
})

test('待回应 primary 进管理 tab 后直达「我发出的邀约」', () => {
  const { page, scrolls } = loadDetail()
  Object.assign(page.data, { club: { isOwner: true }, ownerStage: 'pending', activeTab: 'posts' })
  page.onOwnerPrimary()
  assert.equal(page.data.activeTab, 'manage')
  assert.deepEqual(JSON.parse(JSON.stringify(scrolls)), [{ selector: '#manage-invite-section', duration: 250, offsetTop: 24 }])
  assert.match(read(DETAIL_WXML), /id="manage-invite-section"[\s\S]*?我发出的邀约/)
})

test('F-43：邀请商家 primary 展开现有商家区并在渲染后滚动定位', () => {
  const { page, scrolls } = loadDetail()
  Object.assign(page.data, {
    club: { isOwner: true },
    ownerStage: 'invite',
    activeTab: 'manage',
    openManageSection: '',
  })

  page.onOwnerPrimary()

  assert.equal(page.data.activeTab, 'manage')
  assert.equal(page.data.openManageSection, 'merchants')
  assert.deepEqual(JSON.parse(JSON.stringify(scrolls)), [
    { selector: '#manage-merchants-section', duration: 250, offsetTop: 24 },
  ])
  assert.match(read(DETAIL_WXML), /id="manage-merchants-section"[\s\S]*?可对接商家/)
})

// 2026-08-26 管理 tab 收敛:独立的「待带队场次」区块撤掉了 —— 它和上面的项目列表
// 是同一批数据的过滤视图,首屏出现两次。契约收敛成两条仍然要成立的事实:
//   ① 管理 tab 的项目行点进去仍是主办视图(不是玩家视图)
//   ② loadTopics 仍按 endDate 正确标 ended —— 这是「哪些还要带队」的判据来源
test('管理 tab 的项目行进主办视图，且 loadTopics 仍按 endDate 标记 ended', () => {
  const view = read(DETAIL_WXML)
  assert.match(view, /class="manage-project"[\s\S]*?bindtap="goManageTopic"/)
  // 守的是「管理 tab 里不再出现与项目列表重复的过滤视图」。2026-09-02 活动 tab 按 Figma
  // 282:622 / 282:660 分了「即将举行 / 已结束」两段、也叫 upcomingTopics —— 那是另一个 tab
  // 的分段渲染,不是这条契约要挡的重复视图,所以守卫收窄到管理 tab 段落。
  const manageTab = view.slice(view.indexOf('class="feed feed--plain manage-feed"'))
  assert.ok(manageTab, '找不到管理 tab 段落,守卫失去锚点')
  assert.doesNotMatch(manageTab, /upcomingTopics/, '待带队场次区块已撤,不应再有残留绑定')

  const { page, requests } = loadDetail()
  page.data.clubId = 9
  page.data.club = { id: 9, isOwner: true }
  page.loadTopics()
  requests[0].success({ code: '200', data: [
    { id: 901, startDate: '2099-01-01 10:00:00', endDate: '2099-01-01 12:00:00' },
    { id: 902, startDate: '2000-01-01 10:00:00', endDate: '2000-01-01 12:00:00' },
  ] })
  assert.deepEqual(Array.from(page._topics, (item) => [item.id, item.ended]), [[901, false], [902, true]])
})

test('俱乐部主题卡以 productType 识别自由探索，不要求旧 mode 字段', () => {
  const { page, requests } = loadDetail()
  page.data.clubId = 9
  page.loadTopics()
  requests[0].success({ code: '200', data: [
    { id: 990028, name: '自由探索', productType: 2 },
    { id: 990029, name: '现行字段优先', productType: 1, mode: 2 },
    { id: 990030, name: '旧数据兼容', mode: 2 },
  ] })
  assert.deepEqual(Array.from(page._topics, item => item.categoryText), [
    '自由探索', '城市定向', '自由探索',
  ])
})

test('从发布/邀请/主办视图返回会重拉 owner 数据，首展不与 onLoad 双请求', () => {
  const { page } = loadDetail()
  let reloads = 0
  page.loadAll = () => { reloads += 1 }
  Object.assign(page.data, { clubId: 9, club: { id: 9, isOwner: true } })
  page.onShow()
  assert.equal(reloads, 0, '首次 onShow 应交给 onLoad 请求')
  page.onShow()
  assert.equal(reloads, 1, '返页必须重拉 loadAll，进而刷新 topics/project/my/coop/list')
})

test('公开帖子的游客空态只限制发布，不得误写为不可查看', () => {
  const view = read(DETAIL_WXML)
  assert.match(view, /加入俱乐部后可发布/)
  assert.doesNotMatch(view, /加入俱乐部后可查看与发布/)
})
