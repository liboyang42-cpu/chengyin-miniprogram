'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const DETAIL_JS = 'pages/club/detail/index.js'
const DETAIL_WXML = 'pages/club/detail/index.wxml'
const DIRECTOR_ADAPTER = '../../pages/club/utils/club-game-director-adapter.js'
// 2026-09-03:pages/club/game-director 整页已删,十张卡按 Figma 新的全流程稿收编进
// 活动详情页。状态机与写入安全那 600 行原样搬进 topic-detail/director.js,合同跟着搬 ——
// **不是**因为页面没了就把这些断言删掉:executeAction 的「回执未知」落盘、对账、重试
// 一行都没变,它们照样要有人钉着。
const DIRECTOR_JS = 'pages/club/topic-detail/director.js'
const DIRECTOR_HOST_WXML = 'pages/club/topic-detail/index.wxml'
// 导演台的界面从「宿主页里的一整段内联标记」变成了八个组件。断言的对象是
// **导演台这套界面**,不是某个文件,所以这里把八个组件的 wxml 和宿主页里那几个
// <cy-club-director-*> 标签拼起来当作一个整体来查。
// ⚠️ 不能直接读宿主页全文:活动详情页自己的「台账 ›」这类文案会误伤
//    「不许用文本符号冒充图标」那条(实测踩到)。
const DIRECTOR_COMPONENTS = [
  'ready', 'end-confirm', 'chapter-sheet', 'team-sheet',
  'role-sheet', 'broadcast-sheet', 'incident-sheet', 'recap',
]
const { classifyPageDomain, topLevelThemeClasses } = require('../../scripts/ui-theme-unit-lint.js')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}


// 把宿主页里一个方法(形如 `name() { ... },`)抠出来当普通函数跑,this 绑到给定对象。
// 这样合同验的是**这段逻辑本身**,不是它长什么样的文本 —— 改写法也逃不掉。
function runPageMethod(source, name, page) {
  const re = new RegExp(`\\n  ${name}\\(\\) \\{([\\s\\S]*?)\\n  \\},`)
  const m = re.exec(source)
  assert.ok(m, `宿主页缺 ${name}`)
  const fn = new Function(`return function () {${m[1]}\n}`)()
  fn.call(page)
}

// 导演台界面的全文 = 八个组件 + 宿主页里挂它们的那几个标签
function directorView() {
  // 2026-09-04 主包瘦身:这八个只被 pages/club 分包用,已下沉到分包内。
  //   club-director-row-list 没跟着搬(它还有主包消费方),所以别把这行改成通配。
  const parts = DIRECTOR_COMPONENTS.map((n) => read(`pages/club/components/club-director-${n}/index.wxml`))
  const host = read(DIRECTOR_HOST_WXML)
  for (const m of host.matchAll(/<cy-club-director-[\s\S]*?\/>/g)) parts.push(m[0])
  // 宿主页里导演台自己的外壳(加载/错误/空态 + 写锁安全出口)也算导演台界面 ——
  // 它不是组件,但收编前就在旧页上,合同一直在钉它。
  // 宿主页里导演台那**整段**区域(注释标记 → 底部占位)都算导演台界面:
  // 外壳(加载/错误/空态 + 写锁安全出口)、空态说明、复盘导出入口都在里面,
  // 它们不是组件,但收编前就在旧页上,合同一直在钉它们。
  const region = /导演台\(施工文档[\s\S]*?<view class="ctd-footspacer">/.exec(host)
  assert.ok(region, '宿主页里找不到导演台区域 —— 本合同的锚点要重挑')
  assert.match(region[0], /directorActive/,
    '导演台外壳没了:投影加载失败会静默,写锁也没有安全出口')
  parts.push(region[0])
  assert.ok(parts.length > DIRECTOR_COMPONENTS.length,
    '宿主页里一个 cy-club-director-* 都没挂 —— 组件建了却没人渲染')
  // ⚠️ 剥注释再交出去:「不许用文本符号冒充图标」那条会把注释里的 ★ 也判成违规
  //    (2026-09-03 实测踩到两次,另一次是 wx.showActionSheet)。
  //    钉字面量的门禁会逼人把理由从注释里删掉 —— 那是把文档换成了绿灯。
  return parts.join('\n').replace(/<!--[\s\S]*?-->/g, '')
}
const DIRECTOR_WXML = { toString: () => DIRECTOR_HOST_WXML }

function loadClubDetail(activityList) {
  let definition
  const navigations = []
  const requests = []
  const actionSheets = []
  vm.runInNewContext(read(DETAIL_JS), {
    getApp: () => ({
      globalData: {},
      sendRequest(options) {
        requests.push(options)
        options.success({ code: 200, data: { activityList: activityList || [] } })
      },
    }),
    Page(config) { definition = config },
    require(request) {
      const modules = {
        '../../../utils/motion.js': { haptic() {} },
        // 邀约/合作池整形与 coop/list 共用一份(2026-09-08 抽出);这里给真实现,
        // 因为「可对接的活动」那段就是要保证它按真整形渲染,桩会把问题遮住
        '../../../utils/coop-invite-view.js': require('../../utils/coop-invite-view.js'),
        '../../../utils/motion-preference.js': { readReducedMotion: () => false },
        '../../../utils/scene-registry.js': { getScene: () => ({}) },
        '../../../utils/datetime': { toTimestamp: () => 0 },
        '../../../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
        '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
        '../../../utils/group-code-session.js': require('../../utils/group-code-session.js'),
        '../../../utils/merchant-home-link.js': require('../../utils/merchant-home-link.js'),
        '../../../utils/ticket-source.js': require('../../utils/ticket-source.js'),
        '../../../utils/topic-share.js': require('../../utils/topic-share.js'),
        '../../../utils/response-shape.js': { isRecordList: Array.isArray },
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
    Date,
    JSON,
    Set,
    wx: {
      navigateTo({ url }) { navigations.push(url) },
      showToast() {},
      showModal() {},
      showActionSheet(options) { actionSheets.push(options) },
    },
  }, { filename: DETAIL_JS })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return { page, navigations, requests, actionSheets }
}

// ⚠️ 2026-09-03:导演台不再有自己的 onLoad —— 它是宿主页(活动详情)并进去的模块,
//    入口方法叫 initDirector(activityId),由宿主页在拿到 activityId 时调用。
function loadDirector(adapter, initialStorage, options) {
  let definition
  const toasts = []
  const modals = []
  const storage = Object.assign({}, initialStorage || {})
  const clipboard = []
  // 2026-09-03:导演台从「一整页 Page({...})」变成「宿主页并进来的模块」,
  // 所以这里不再等 Page() 回调,而是接住 module.exports 再拼成同形状的页面对象。
  // 断言一条没改 —— 变的只是这段逻辑住在哪。
  const moduleShim = { exports: {} }
  vm.runInNewContext((options && options.directorSource) || read(DIRECTOR_JS), {
    module: moduleShim,
    exports: moduleShim.exports,
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 }, getUserID: () => '9' }),
    Page(config) { definition = config },
    require(request) {
      if (request === '../utils/club-game-director-adapter.js') {
        return { createClubGameDirectorAdapter() { throw new Error('测试必须注入 adapter') } }
      }
      throw new Error(`unexpected require: ${request}`)
    },
    Date,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
    wx: {
      showToast(options) { toasts.push(options) },
      showModal(options) { modals.push(options) },
      navigateBack() {},
      getStorageSync(key) { return storage[key] },
      setStorageSync(key, value) {
        if (options && options.storageWriteError) throw new Error('storage unavailable')
        storage[key] = value
      },
      removeStorageSync(key) { delete storage[key] },
      setClipboardData(options) {
        clipboard.push(options.data)
        if (typeof options.success === 'function') options.success()
      },
    },
  }, { filename: DIRECTOR_JS })
  if (!definition) {
    const mod = moduleShim.exports
    assert.ok(mod.DIRECTOR_DATA && mod.DIRECTOR_METHODS,
      'director.js 必须导出 DIRECTOR_DATA / DIRECTOR_METHODS,否则宿主页并不进来')
    definition = Object.assign({ data: mod.DIRECTOR_DATA }, mod.DIRECTOR_METHODS)
  }
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    _directorAdapter: adapter,
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback.call(this) },
  })
  return { page, toasts, modals, storage, clipboard }
}

function settle() {
  return new Promise((resolve) => setImmediate(resolve))
}

function validClubRecap(overrides) {
  return Object.assign({
    schemaVersion: 'GAME_RECAP_V1', generatedAt: '2026-08-23 18:30:45',
    metrics: [
      { key: 'PAID_PLAYERS', label: '付费玩家', value: 24, unit: '人' },
      { key: 'NORMAL_COMPLETERS', label: '正常完成', value: 16, unit: '人' },
    ],
    funnel: {
      paidPlayers: 24, arrivedPlayers: 22, taskSubmitters: 20,
      normalCompleters: 16, fallbackCompleters: 2, finishedTeams: 6,
    },
    hints: { level1Uses: 5, level2Uses: 2, answerReveals: 1 },
    incidents: { merchantPauseEvents: 2, merchantFallbackCompletions: 2, playerRejectedSubmissions: 3 },
    collaboration: { eligibleTeams: 8, completedTeams: 6, ratePercent: 75 },
    takeovers: { count: 1 },
    stations: [{
      nodeId: 8, nodeName: '老码头补给站', arrivedPlayers: 18, submissionCount: 15,
      normalCompletedCount: 10, fallbackCompletedCount: 1, rejectedCount: 2, pauseEventCount: 2,
    }],
    exportAvailable: true,
  }, overrides || {})
}

function runningClubProjection(overrides) {
  return Object.assign({
    sessionId: 9001, activityId: 701, status: 'RUNNING', revision: 9,
    currentChapterId: 31, availableActions: [],
    readiness: { requiredStations: 1, readyStations: 1, teamsReady: true, blockers: [], canStart: false },
    stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], leaderboard: null, recap: null,
  }, overrides || {})
}

test('活动导演台入口只在 owner 管理区出现，直接调用也不能让非 owner 进入', () => {
  const view = read(DETAIL_WXML)
  assert.match(view, /wx:if="\{\{club\.isOwner && item\.id && item\.gameModuleEnabled\}\}"[^>]*catchtap="goGameDirector"[^>]*data-topic-id="\{\{item\.id\}\}"[^>]*data-game-module-enabled=/)
  assert.match(view, /活动导演台/)

  const owner = loadClubDetail([
    { id: 701, name: '场次 1' }, { id: 702, name: '场次 2' }, { id: 703, name: '场次 3' },
    { id: 704, name: '场次 4' }, { id: 705, name: '场次 5' }, { id: 706, name: '场次 6' },
    { id: 707, name: '场次 7' },
  ])
  owner.page.data.club = { id: 9, isOwner: true }
  owner.page.goGameDirector({ currentTarget: { dataset: { topicId: 88, gameModuleEnabled: true } } })
  assert.equal(owner.requests[0].url, '/api/topic/info-to-user')
  assert.deepEqual(JSON.parse(JSON.stringify(owner.requests[0].data)), { id: 88 })
  assert.equal(owner.page.data.directorActivityPickerShow, true)
  assert.equal(owner.page.data.directorActivityOptions.length, 7)
  owner.page.onDirectorActivitySelect({ currentTarget: { dataset: { id: 999 } } })
  assert.deepEqual(owner.navigations, [])
  owner.page.onDirectorActivitySelect({ currentTarget: { dataset: { id: 702 } } })
  // 2026-09-03:导演台不再是独立页面,入口改指活动详情页并带上 activityId。
  // topicId 也一起传 —— 那一页的主体(H1-H6)靠它,只有 activityId 会进错页面。
  assert.deepEqual(owner.navigations,
    ['/pages/club/topic-detail/index?topicId=88&clubId=9&activityId=702'])

  const member = loadClubDetail()
  member.page.data.club = { id: 9, isOwner: false }
  member.page.goGameDirector({ currentTarget: { dataset: { topicId: 88, gameModuleEnabled: true } } })
  assert.deepEqual(member.navigations, [])
  assert.deepEqual(member.requests, [])

  const ordinary = loadClubDetail()
  ordinary.page.data.club = { id: 9, isOwner: true }
  ordinary.page.goGameDirector({ currentTarget: { dataset: { topicId: 88, gameModuleEnabled: false } } })
  assert.deepEqual(ordinary.requests, [], '普通主题不得发起导演台 activity 查询')
})

test('导演台新增界面不使用文本符号冒充图标', () => {
  const pseudoIcon = /[›×➜→←★☆◆◇●○■□▲▼▶◀]/
  assert.doesNotMatch(directorView(), pseudoIcon)
  const picker = read(DETAIL_WXML).match(/<cy-sheet show="\{\{directorActivityPickerShow\}\}"[\s\S]*?<\/cy-sheet>/)
  assert.ok(picker, '必须保留 owner 场次选择 sheet')
  assert.doesNotMatch(picker[0], pseudoIcon)
})

test('导演 adapter 固定 CLUB 投影并拒绝任何非 CLUB 响应', async () => {
  const { createClubGameDirectorAdapter } = require(DIRECTOR_ADAPTER)
  const calls = []
  const adapter = createClubGameDirectorAdapter({
    loadProjection(role, activityId) {
      calls.push({ role, activityId })
      return Promise.resolve({ status: 'ready', data: { perspective: 'PLAYER', activityId, club: {} } })
    },
    submitAction() { throw new Error('本用例不应写入') },
    readReceipt() { throw new Error('本用例不应读回执') },
  })

  await assert.rejects(adapter.load(701), (error) => error && error.code === 'OWNER_REQUIRED')
  assert.deepEqual(calls, [{ role: 'club', activityId: 701 }])
})

test('NOT_PREPARED owner 投影精确允许空 club 以发起 PREPARE，其他空 club 仍拒绝', async () => {
  const { createClubGameDirectorAdapter } = require(DIRECTOR_ADAPTER)
  let raw = {
    sessionId: null, activityId: 701, perspective: 'CLUB', status: 'NOT_PREPARED', revision: 0,
    currentChapterId: null, availableActions: ['PREPARE'],
  }
  const adapter = createClubGameDirectorAdapter({
    loadProjection() { return Promise.resolve({ status: 'ready', data: raw }) },
    submitAction() { return Promise.resolve({ status: 'unknown' }) },
    readReceipt() { return Promise.resolve({ status: 'pending' }) },
  })
  const projection = await adapter.load(701)
  assert.deepEqual(projection.availableActions, ['PREPARE'])
  assert.equal(projection.status, 'NOT_PREPARED')
  assert.equal(projection.readiness.canStart, false)

  raw = Object.assign({}, raw, { status: 'READY', revision: 1, availableActions: ['START'] })
  await assert.rejects(adapter.load(701), (error) => error && error.code === 'OWNER_REQUIRED')
})

test('未取得 owner 的 CLUB 投影前，adapter 拒绝直接写入', async () => {
  const { createClubGameDirectorAdapter } = require(DIRECTOR_ADAPTER)
  let writes = 0
  const adapter = createClubGameDirectorAdapter({
    loadProjection() { throw new Error('本用例不读取投影') },
    submitAction() { writes += 1; return Promise.resolve({ status: 'CONFIRMED' }) },
    readReceipt() { throw new Error('本用例不读回执') },
  })

  await assert.rejects(adapter.submit({
    activityId: 701,
    requestId: 'gd-701-unauthorized',
    expectedRevision: 8,
    action: 'START',
    payload: {},
  }), (error) => error && error.code === 'OWNER_REQUIRED')
  assert.equal(writes, 0)
})

test('adapter 按共享 client 包装和后端 CLUB 真实字段解析，不把业务失败当成成功', async () => {
  const { createClubGameDirectorAdapter } = require(DIRECTOR_ADAPTER)
  let submitResult = { status: 'business-error', requestId: 'gd-701-business', message: '状态冲突' }
  let receiptResult = { status: 'matched', requestId: 'gd-701-business', receipt: {
    receiptId: 501, activityId: 701, requestId: 'gd-701-business', action: 'START', outcome: 'APPLIED', revision: 10,
  } }
  const adapter = createClubGameDirectorAdapter({
    loadProjection() {
      return Promise.resolve({ status: 'ready', data: {
        sessionId: 9001, activityId: 701, perspective: 'CLUB', status: 'RUNNING', revision: 9,
        currentChapterId: 31, availableActions: ['BROADCAST', 'SET_LEADERBOARD_VISIBILITY'],
        club: {
          readiness: { requiredStations: 2, readyStations: 2, teamsReady: true },
          stations: [],
          roles: [
            { teamId: 11, memberId: 21, roleCode: 'SCOUT', roleName: '侦察员', status: 'CONFIRMED' },
            { teamId: 11, memberId: 22, roleCode: 'KEEPER', roleName: '守护员', status: 'ASSIGNED' },
          ],
          roleOptions: [
            { roleCode: 'SCOUT', roleName: '侦察员' },
            { roleCode: 'KEEPER', roleName: '守护员' },
          ],
          teams: [{ teamId: 11, name: '第一队', memberCount: 2 }],
          broadcasts: [],
          leaderboardVisible: false,
        },
      } })
    },
    submitAction() { return Promise.resolve(submitResult) },
    readReceipt() { return Promise.resolve(receiptResult) },
  })

  const projection = await adapter.load(701)
  assert.equal(projection.leaderboard.visible, false)
  assert.deepEqual(projection.roleOptions.map((item) => item.roleCode), ['SCOUT', 'KEEPER'])
  assert.equal(projection.teams[0].memberCount, 2)
  const businessCommand = {
    activityId: 701, nodeId: null, requestId: 'gd-701-business', expectedRevision: 9, action: 'START', payload: {},
  }
  assert.equal((await adapter.submit(businessCommand)).state, 'unknown-write')
  assert.equal((await adapter.readReceipt(701, 'gd-701-business', businessCommand)).state, 'confirmed')

  submitResult = {
    status: 'success', requestId: 'gd-701-applied',
    receipt: {
      receiptId: 502, activityId: 701, outcome: 'APPLIED', requestId: 'gd-701-applied', action: 'START', revision: 10,
    },
  }
  assert.equal((await adapter.submit({
    activityId: 701, nodeId: null, requestId: 'gd-701-applied', expectedRevision: 9, action: 'START', payload: {},
  })).state, 'confirmed')
  submitResult = {
    status: 'success', requestId: 'gd-701-unmatched',
    receipt: { outcome: 'PENDING', requestId: 'gd-701-unmatched' },
  }
  assert.equal((await adapter.submit({ activityId: 701, requestId: 'gd-701-unmatched' })).state, 'unknown-write')

  submitResult = { status: 'unknown', requestId: 'gd-701-unknown' }
  receiptResult = { status: 'network-error', requestId: 'gd-701-unknown' }
  assert.equal((await adapter.submit({ activityId: 701, requestId: 'gd-701-unknown' })).state, 'unknown-write')
  assert.equal((await adapter.readReceipt(701, 'gd-701-unknown')).state, 'pending')
})

test('adapter 只有精确匹配命令的 APPLIED/FAILED 终态回执才能解除未知写', () => {
  const { normalizeReceiptResult, normalizeSubmitResult } = require(DIRECTOR_ADAPTER)
  const command = {
    activityId: 701,
    nodeId: null,
    requestId: 'gd-701-exact-terminal',
    expectedRevision: 9,
    action: 'START',
    payload: {},
  }
  const failedReceipt = {
    receiptId: 502,
    activityId: 701,
    requestId: command.requestId,
    action: command.action,
    outcome: 'FAILED',
    revision: 9,
  }
  const wrongAction = Object.assign({}, failedReceipt, { action: 'FINISH' })

  assert.equal(normalizeSubmitResult({
    status: 'business-error', requestId: command.requestId, reasonCode: 'GAME_LOGIN_REQUIRED',
  }, command).state, 'unknown-write')
  assert.equal(normalizeReceiptResult({
    status: 'business-error', requestId: command.requestId, reasonCode: 'GAME_LOGIN_REQUIRED',
  }, command).state, 'pending')
  assert.equal(normalizeSubmitResult({ status: 'business-error', receipt: wrongAction }, command).state, 'unknown-write')
  assert.equal(normalizeReceiptResult({ status: 'business-error', receipt: wrongAction }, command).state, 'pending')
  assert.equal(normalizeSubmitResult({ status: 'business-error', receipt: failedReceipt }, command).state, 'rejected')
  assert.equal(normalizeReceiptResult({ status: 'business-error', receipt: failedReceipt }, command).state, 'rejected')
  assert.equal(normalizeSubmitResult({
    status: 'success', receipt: Object.assign({}, failedReceipt, { outcome: 'APPLIED' }),
  }, command).state, 'confirmed')
})

test('adapter 与真实 game-session-client envelope 端到端匹配 APPLIED 回执', async () => {
  const { createClubGameDirectorAdapter } = require(DIRECTOR_ADAPTER)
  const { createGameSessionClient } = require('../../utils/game-session-client.js')
  const requestId = 'gd-701-real-1'
  const client = createGameSessionClient({
    sendRequest(options) {
      if (options.url === '/api/game/session/view') {
        options.success({ code: 200, data: {
          sessionId: 9001, activityId: 701, perspective: 'CLUB', status: 'RUNNING', revision: 9,
          currentChapterId: 31, availableActions: ['BROADCAST'],
          club: {
            readiness: { requiredStations: 1, readyStations: 1, teamsReady: true },
            stations: [], roles: [], teams: [], roleOptions: [], chapterOptions: [], broadcasts: [],
            leaderboardVisible: true,
          },
        } })
      } else if (options.url === '/api/game/session/command') {
        options.success({ code: 200, data: {
          receiptId: 501, activityId: 701, requestId, action: 'BROADCAST', outcome: 'APPLIED', revision: 10,
        } })
      } else {
        options.success({ code: 200, data: { receiptId: 501, activityId: 701, requestId, action: 'BROADCAST', outcome: 'APPLIED', revision: 10 } })
      }
      return { abort() {} }
    },
  })
  const adapter = createClubGameDirectorAdapter(client)
  await adapter.load(701)
  const submitted = await adapter.submit({
    activityId: 701, nodeId: null, requestId, expectedRevision: 9,
    action: 'BROADCAST', payload: { targetType: 'ALL', content: '现场通知' },
  })
  assert.equal(submitted.state, 'confirmed')
  assert.equal((await adapter.readReceipt(701, requestId, {
    activityId: 701, nodeId: null, requestId, expectedRevision: 9,
    action: 'BROADCAST', payload: { targetType: 'ALL', content: '现场通知' },
  })).state, 'confirmed')
})

test('准备总览缺项会 fail closed，异常节点和卡住队伍排在前面', async () => {
  const { createClubGameDirectorAdapter } = require(DIRECTOR_ADAPTER)
  const adapter = createClubGameDirectorAdapter({
    loadProjection() {
      return Promise.resolve({ status: 'ready', data: {
        sessionId: 9001,
        activityId: 701,
        perspective: 'CLUB',
        status: 'PREPARING',
        revision: 8,
        availableActions: ['START'],
        club: {
          readiness: { requiredStations: 3, readyStations: 2, teamsReady: true, blockers: ['南门店未 READY'] },
          stations: [
            { nodeId: 2, name: '北门店', status: 'READY' },
            { nodeId: 1, name: '南门店', status: 'PAUSED', issue: '物料损坏' },
          ],
          teams: [
            { teamId: 11, name: '第一队', status: 'PLAYING', completedNodes: 2, totalNodes: 3 },
            { teamId: 12, name: '第二队', status: 'BLOCKED', blockedReason: '等待本站核验' },
          ],
          broadcasts: [],
        },
      } })
    },
    submitAction() { throw new Error('准备未完成时不得写入') },
    readReceipt() { throw new Error('本用例不应读回执') },
  })

  const projection = await adapter.load(701)
  assert.equal(projection.readiness.canStart, false)
  assert.deepEqual(projection.readiness.blockers, ['南门店未 READY'])
  assert.deepEqual(projection.stations.map((item) => item.nodeId), [1, 2])
  assert.deepEqual(projection.teams.map((item) => item.teamId), [12, 11])
})

test('导演 adapter 仅暴露服务端可解锁后续章，并保留权威卡点回读且不补零', () => {
  const { normalizeClubProjection } = require(DIRECTOR_ADAPTER)
  const projection = normalizeClubProjection({
    sessionId: 9001,
    activityId: 701,
    perspective: 'CLUB',
    status: 'RUNNING',
    revision: 9,
    currentChapterId: 2,
    availableActions: ['UNLOCK_CHAPTER'],
    club: {
      readiness: { requiredStations: 3, readyStations: 3, teamsReady: true, blockers: [] },
      chapterOptions: [
        { chapterId: 1, title: '第一章', unlocked: true, unlockable: false },
        { chapterId: 2, title: '第二章', unlocked: true, unlockable: false },
        { chapterId: 3, title: '第三章', unlocked: false, unlockable: true },
      ],
      stations: [],
      roles: [],
      teams: [
        { teamId: 11, teamName: '正常队', status: 'RUNNING', completedNodes: 1, totalNodes: 3 },
        {
          teamId: 12, teamName: '卡点队', status: 'BLOCKED', completedNodes: 1, totalNodes: 3,
          currentStuckNode: { nodeId: 88, nodeName: '旧钟楼', stationStatus: 'PAUSED' },
          hintLevel: 2,
          recentEvent: { requestId: 'player-hint-2', action: 'PLAYER_HINT', outcome: 'APPLIED' },
          blockedReason: '旧钟楼（已暂停）',
        },
      ],
      broadcasts: [],
    },
  })

  assert.deepEqual(projection.chapterOptions.map((item) => item.chapterId), [3])
  assert.deepEqual(projection.teams.map((item) => item.teamId), [12, 11])
  assert.equal(projection.teams[0].currentStuckNode.nodeId, 88)
  assert.equal(projection.teams[0].hintLevel, 2)
  assert.equal(projection.teams[0].recentEvent.outcome, 'APPLIED')
  assert.equal(projection.teams[0].recentEvent.requestId, undefined)
  assert.equal(projection.teams[0].recentEvent.reasonCode, undefined)
  assert.equal(projection.teams[0].recentEvent.revision, undefined)
  assert.doesNotMatch(JSON.stringify(projection.teams[0]), /player-hint-2/)
  assert.equal(projection.teams[1].hintLevel, undefined)
  assert.doesNotMatch(JSON.stringify(projection.teams[1]), /"hintLevel":0/)
})

test('导演页使用后端 nodeName 展示站点名，不降级成未命名节点', async () => {
  const projection = {
    sessionId: 9001,
    activityId: 701,
    status: 'PREPARING',
    revision: 8,
    availableActions: [],
    readiness: { requiredStations: 1, readyStations: 0, teamsReady: true, blockers: [], canStart: false },
    stations: [{ nodeId: 1, nodeName: '南门书店', status: 'READY' }],
    teams: [], roles: [], roleOptions: [], broadcasts: [], leaderboard: null, recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit() { throw new Error('本用例不应写入') },
    readReceipt() { throw new Error('本用例不应读回执') },
  })

  harness.page.initDirector('701')
  await settle()
  assert.equal(harness.page.data.stations[0].nameText, '南门书店')
})

test('异常队伍卡明确展示权威卡点、提示层级和最近有效事件，缺失保持待确认', () => {
  // 2026-09-03:队伍卡抽成了通用行组件,三行权威明细改由宿主页摊成 details 喂进去。
  // 这里直接跑那段转换 —— 比对模板文本硬:组件换个写法也逃不掉。
  const host = read('pages/club/topic-detail/index.js')
  const run = (teams) => {
    const page = { data: { teams }, setData(p) { Object.assign(this.data, p) } }
    runPageMethod(host, 'refreshTeamRows', page)
    return page.data.directorTeamRows
  }

  const full = run([{
    teamId: 7, nameText: 'A 队', progressText: '第 2 站', statusText: '进行中', isAbnormal: true,
    issueText: '1 次判定被驳回', stuckNodeText: '外滩观景平台', hintLevelText: '提示 2 级',
    recentEventText: '12:38 被驳回一次',
  }])[0]
  assert.deepEqual(full.details.map((d) => d.label), ['卡点节点', '提示层级', '最近有效事件'])
  assert.deepEqual(full.details.map((d) => d.text),
    ['外滩观景平台', '提示 2 级', '12:38 被驳回一次'])

  // 缺失保持待确认:不写 0(会被读成「没有卡点」)、不留空(会被读成「查过了没有」)
  const missing = run([{ teamId: 8, nameText: 'B 队', statusText: '进行中', isAbnormal: true }])[0]
  assert.deepEqual(missing.details.map((d) => d.text), ['待确认', '待确认', '待确认'])
  for (const d of missing.details) {
    assert.notEqual(d.text, '0', '缺值写成 0 会被读成「没有卡点」')
    assert.notEqual(d.text, '', '缺值留空会被读成「查过了没有」')
  }

  // 正常队伍不摊这三行 —— 它们只对异常队伍有意义
  const normal = run([{ teamId: 9, nameText: 'C 队', progressText: '第 1 站', statusText: '进行中' }])[0]
  assert.deepEqual(normal.details, [])

  // 组件确实渲染 details,不是宿主页算了没人用
  assert.match(read('pages/club/components/club-director-row-list/index.wxml'),
    /wx:for="\{\{item\.details\}\}"/, 'row-list 没渲染 details,宿主页白算')
  assert.match(read(DIRECTOR_HOST_WXML), /teams="\{\{directorTeamRows\}\}"/,
    '组件绑到了原始 teams,三行明细根本到不了界面')
})

test('导演页先显示加载态，准备未完成时只展示阻断原因且不发送开局命令', async () => {
  const writes = []
  const projection = {
    sessionId: 9001,
    activityId: 701,
    status: 'PREPARING',
    revision: 8,
    availableActions: ['START'],
    readiness: {
      requiredStations: 3,
      readyStations: 2,
      teamsReady: true,
      blockers: ['南门店未 READY'],
      canStart: false,
    },
    stations: [{ nodeId: 1, name: '南门店', status: 'PAUSED', issue: '物料损坏' }],
    teams: [{ teamId: 12, name: '第二队', status: 'BLOCKED', blockedReason: '等待本站核验' }],
    roles: [],
    roleOptions: [],
    broadcasts: [],
    leaderboard: null,
    recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { writes.push(input); return Promise.resolve({}) },
    readReceipt() { return Promise.resolve({}) },
  })

  harness.page.initDirector('701')
  assert.equal(harness.page.data.loadState, 'loading')
  await settle()
  assert.equal(harness.page.data.loadState, 'ready')
  assert.equal(harness.page.data.readinessText, '2/3 站 READY')
  assert.deepEqual(harness.page.data.blockers, ['南门店未 READY'])

  harness.page.onStartSession()
  assert.equal(writes.length, 0)
  assert.match(harness.toasts[0].title, /未完成|不能开局/)

  const view = directorView()
  assert.match(view, /wx:if="\{\{loadState === 'loading'\}\}"/)
  assert.match(view, /wx:elif="\{\{loadState === 'ready'\}\}"/)
})

test('adapter 写入固定 club 角色，unknown 结果只能经原 requestId 回读', async () => {
  const { createClubGameDirectorAdapter } = require(DIRECTOR_ADAPTER)
  const calls = []
  const adapter = createClubGameDirectorAdapter({
    loadProjection(role, activityId) {
      calls.push({ kind: 'load', role, activityId })
      return Promise.resolve({ status: 'ready', data: {
        sessionId: 9001,
        activityId,
        perspective: 'CLUB',
        status: 'READY',
        revision: 8,
        availableActions: ['START'],
        club: { readiness: {}, stations: [], roles: [], broadcasts: [], leaderboardVisible: false },
      } })
    },
    submitAction(role, input) {
      calls.push({ kind: 'submit', role, input })
      return Promise.resolve({ status: 'UNKNOWN', requestId: input.requestId })
    },
    readReceipt(activityId, requestId) {
      calls.push({ kind: 'receipt', activityId, requestId })
      return Promise.resolve({ status: 'PENDING', requestId })
    },
  })
  const command = {
    activityId: 701,
    nodeId: null,
    requestId: 'gd-701-1',
    expectedRevision: 8,
    action: 'START',
    payload: {},
  }

  await adapter.load(701)
  const submitted = await adapter.submit(command)
  assert.equal(submitted.state, 'unknown-write')
  const receipt = await adapter.readReceipt(701, 'gd-701-1')
  assert.equal(receipt.state, 'pending')
  assert.deepEqual(calls, [
    { kind: 'load', role: 'club', activityId: 701 },
    { kind: 'submit', role: 'club', input: command },
    { kind: 'receipt', activityId: 701, requestId: 'gd-701-1' },
  ])
})

test('unknown 写在回执仍 pending 时保持全页写锁，不能再次发送', async () => {
  let submits = 0
  let reads = 0
  const projection = {
    sessionId: 9001,
    activityId: 701,
    status: 'READY',
    revision: 8,
    availableActions: ['START'],
    readiness: { requiredStations: 3, readyStations: 3, teamsReady: true, blockers: [], canStart: true },
    stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], leaderboard: null, recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit() { submits += 1; return Promise.resolve({ state: 'unknown-write', requestId: 'gd-701-1' }) },
    readReceipt() { reads += 1; return Promise.resolve({ state: 'pending', requestId: 'gd-701-1' }) },
  })
  harness.page.initDirector('701')
  await settle()

  harness.page.onStartSession()
  harness.modals[0].success({ confirm: true })
  await settle()
  assert.equal(submits, 1)
  assert.equal(harness.page.data.writeLocked, true)
  assert.equal(harness.page.data.writeState, 'unknown-write')

  harness.page.onStartSession()
  assert.equal(submits, 1, '未知写未回读前不得重复发同一业务动作')
  harness.page.onReconcileUnknownWrite()
  await settle()
  assert.equal(reads, 1)
  assert.equal(harness.page.data.writeLocked, true)
  assert.equal(harness.page.data.writeState, 'unknown-write')
})

test('角色分配只能从服务端角色选项中选择，并按锁定契约提交', async () => {
  const writes = []
  const projection = {
    sessionId: 9001,
    activityId: 701,
    status: 'RUNNING',
    revision: 9,
    currentChapterId: 31,
    availableActions: ['ASSIGN_ROLES'],
    readiness: { requiredStations: 3, readyStations: 3, teamsReady: true, blockers: [], canStart: false },
    stations: [],
    teams: [{ teamId: 11, name: '第一队', memberCount: 2 }],
    roles: [{ teamId: 11, memberId: 21, memberName: '阿青', roleCode: 'SCOUT', roleName: '侦察员', status: 'ASSIGNED' }],
    roleOptions: [
      { roleCode: 'SCOUT', roleName: '侦察员' },
      { roleCode: 'KEEPER', roleName: '守护员' },
    ],
    broadcasts: [], leaderboard: null, recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { writes.push(input); return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()
  assert.equal(harness.page.data.roles[0].confirmationText, '待确认')

  // 5-02:成员/角色都走行/ chip 组件的真事件形状 —— 组件回传 {id},不传 dataset/value
  harness.page.onRoleMemberPick({ detail: { id: '11:21' } })
  harness.page.onRoleOptionChange({ detail: { id: 'KEEPER' } })
  harness.page.confirmRoleAssignment()
  await settle()

  assert.equal(writes.length, 1)
  assert.equal(writes[0].action, 'ASSIGN_ROLES')
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), {
    teamId: 11,
    assignments: [{ memberId: 21, roleCode: 'KEEPER' }],
  })
})

/* 2026-09-19 审查 F-PK-2:弹层里「选择成员」那一列组件一直如实抛 selectmember,宿主却没接,
   而且喂给它的是**队伍**不是成员 —— 主理人看着能换人,确认时写下去的却是最初点进来的那个。 */
test('角色分配弹层改选同队另一人 ⇒ 写的是被选中的人', async () => {
  const writes = []
  const projection = {
    sessionId: 9001,
    activityId: 701,
    status: 'RUNNING',
    revision: 9,
    currentChapterId: 31,
    availableActions: ['ASSIGN_ROLES'],
    readiness: { requiredStations: 3, readyStations: 3, teamsReady: true, blockers: [], canStart: false },
    stations: [],
    teams: [{ teamId: 11, name: '第一队', memberCount: 2 }, { teamId: 12, name: '第二队', memberCount: 1 }],
    roles: [
      { teamId: 11, memberId: 21, memberName: '阿青', roleCode: 'SCOUT', roleName: '侦察员', status: 'ASSIGNED' },
      { teamId: 11, memberId: 22, memberName: '小满', roleCode: '', status: 'ASSIGNED' },
      { teamId: 12, memberId: 23, memberName: '别队的人', roleCode: '', status: 'ASSIGNED' },
    ],
    roleOptions: [
      { roleCode: 'SCOUT', roleName: '侦察员' },
      { roleCode: 'KEEPER', roleName: '守护员' },
    ],
    broadcasts: [], leaderboard: null, recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { writes.push(input); return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()

  harness.page.openRoleAssignment({ currentTarget: { dataset: { teamId: 11, memberId: 21 } } })
  // 列的必须是**同队成员**:第一队两人,别队那个不许混进来
  assert.deepEqual(harness.page.data.roleMemberRows.map((row) => row.memberId), [21, 22])
  assert.equal(harness.page.data.roleMemberRows[0].disabled, true, '当前那个人这一行应置灰')
  assert.equal(harness.page.data.roleMemberRows[1].subtitle, '待分配')

  harness.page.onRoleMemberPick({ detail: { id: '11:22' } })
  harness.page.onRoleOptionChange({ detail: { id: 'KEEPER' } })
  assert.equal(harness.page.data.roleDraft.memberName, '小满')
  harness.page.confirmRoleAssignment()
  await settle()

  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), {
    teamId: 11,
    assignments: [{ memberId: 22, roleCode: 'KEEPER' }],
  }, '改选了人,写下去的必须是新选的那个')
})

test('定向广播先用权威队伍成员数预览范围，再按锁定契约发送', async () => {
  const writes = []
  const projection = {
    sessionId: 9001,
    activityId: 701,
    status: 'RUNNING',
    revision: 9,
    currentChapterId: 31,
    availableActions: ['BROADCAST'],
    readiness: { requiredStations: 3, readyStations: 3, teamsReady: true, blockers: [], canStart: false },
    stations: [],
    teams: [
      { teamId: 11, name: '第一队', memberCount: 2 },
      { teamId: 12, name: '第二队', memberCount: 1 },
    ],
    roles: [
      { teamId: 11, memberId: 21, roleCode: 'SCOUT' },
      { teamId: 11, memberId: 22, roleCode: 'KEEPER' },
      { teamId: 12, memberId: 23, roleCode: 'SCOUT' },
    ],
    roleOptions: [
      { roleCode: 'SCOUT', roleName: '侦察员' },
      { roleCode: 'KEEPER', roleName: '守护员' },
    ],
    broadcasts: [], leaderboard: null, recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { writes.push(input); return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()

  harness.page.openBroadcast()
  assert.equal(harness.page.data.broadcastPreviewReady, true)
  assert.match(harness.page.data.broadcastPreviewText, /3 人/)
  // 5-04:chip 组件回传 {id}(旧写法读 currentTarget.dataset,在组件事件里恒为空)
  harness.page.selectBroadcastTargetType({ detail: { id: 'ROLE' } })
  assert.match(harness.page.data.broadcastPreviewText, /2 人/)
  harness.page.onBroadcastContentInput({ detail: { value: '侦察员请原地等待' } })
  harness.page.confirmBroadcast()
  await settle()

  assert.equal(writes[0].action, 'BROADCAST')
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), {
    targetType: 'ROLE',
    roleCode: 'SCOUT',
    content: '侦察员请原地等待',
  })
})

test('广播范围缺成员数时显示待确认且禁止发送，不写成 0 人', async () => {
  const writes = []
  const projection = {
    sessionId: 9001, activityId: 701, status: 'RUNNING', revision: 9,
    availableActions: ['BROADCAST'], currentChapterId: 31,
    readiness: { requiredStations: null, readyStations: null, teamsReady: null, blockers: [], canStart: false },
    stations: [], teams: [{ teamId: 11, name: '第一队' }], roles: [], roleOptions: [],
    broadcasts: [], leaderboard: null, recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { writes.push(input); return Promise.resolve({ state: 'confirmed' }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()

  harness.page.openBroadcast()
  harness.page.onBroadcastContentInput({ detail: { value: '请注意安全' } })
  assert.equal(harness.page.data.broadcastPreviewReady, false)
  assert.match(harness.page.data.broadcastPreviewText, /人数待确认/)
  assert.doesNotMatch(harness.page.data.broadcastPreviewText, /0 人/)
  harness.page.confirmBroadcast()
  assert.equal(writes.length, 0)
})

// CU-C-76(2026-09-25 leftover 批次):「不能发广播」有两种 —— 本场没跑起来 / 本场在跑但一个
// 可送达玩家都没有。走查读到的是:零成员的场子入口照样能点,点完只有一句笼统提示,
// 既不说为什么也不说怎样才能发。现在原因由后端投影给码,下面三条分别钉住两种码和旧响应。
test('CU-C-76:本场在跑但没人可送达时,广播入口提前禁用并说清下一步', async () => {
  const harness = loadDirector({
    load() {
      return Promise.resolve(runningClubProjection({
        availableActions: ['BROADCAST'], broadcastBlocker: 'NO_RECIPIENT',
      }))
    },
    submit(input) { return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()

  assert.equal(harness.page.data.canBroadcast, false, '零成员的场子入口还放行')
  assert.match(harness.page.data.broadcastDisabledText, /没有可送达的玩家/, '没说清是哪一种「不能」')
  assert.match(harness.page.data.broadcastDisabledText, /报名进场/, '只说不能,不给可执行的下一步')
  harness.page.openBroadcast()
  assert.equal(harness.page.data.broadcastSheetVisible, false, '被禁用的入口仍然弹得开选范围流程')
  assert.equal(harness.toasts.length, 1)
  assert.equal(harness.toasts[0].title, harness.page.data.broadcastDisabledText,
    '点它时弹的那句必须和置灰行上那句同源,不能两处各写一份')
})

test('CU-C-76:本场没跑起来时仍按场次状态解释,不改口成「没人」', async () => {
  const harness = loadDirector({
    load() {
      return Promise.resolve(runningClubProjection({
        status: 'READY', availableActions: [], broadcastBlocker: 'NOT_RUNNING',
      }))
    },
    submit(input) { return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()
  assert.equal(harness.page.data.canBroadcast, false)
  assert.match(harness.page.data.broadcastDisabledText, /只有本场进行中才能发送/)
  assert.doesNotMatch(harness.page.data.broadcastDisabledText, /报名进场/,
    '把「没人」那句套到场次状态未开始上,等于告诉主理人去做一件没用的事')
})

test('CU-C-76:后端没给原因码(旧响应/缺字段)时入口照常可点', async () => {
  const harness = loadDirector({
    load() { return Promise.resolve(runningClubProjection({ availableActions: ['BROADCAST'] })) },
    submit(input) { return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()
  assert.equal(harness.page.data.canBroadcast, true, '新增的闸门不得把本来能发的场子关死')
  harness.page.openBroadcast()
  assert.equal(harness.page.data.broadcastSheetVisible, true)
})

test('CU-C-76:发送被驳回时按原因码出话,认不出才回退通用文案', async () => {
  async function rejectToast(reasonCode) {
    const harness = loadDirector({
      load() {
        // 得有可预览的队伍,否则 confirmBroadcast 在「接收范围待确认」那一步就拦下了,走不到发送
        return Promise.resolve(runningClubProjection({
          availableActions: ['BROADCAST'],
          teams: [{ teamId: 11, name: '第一队', memberCount: 2 }],
        }))
      },
      submit(input) {
        return Promise.resolve({ state: 'rejected', requestId: input.requestId, raw: { reasonCode: reasonCode } })
      },
      readReceipt() { return Promise.resolve({ state: 'pending' }) },
    })
    harness.page.initDirector('701')
    await settle()
    harness.page.openBroadcast()
    harness.page.onBroadcastContentInput({ detail: { value: '请集合' } })
    harness.page.confirmBroadcast()
    await settle()
    assert.equal(harness.toasts.length, 1, '驳回只该有一句反馈')
    return harness.toasts[0].title
  }

  const noRecipient = await rejectToast('GAME_BROADCAST_NO_RECIPIENT')
  assert.match(noRecipient, /没有发出/,
    '投影算完到点发送之间没人进场,光「操作未生效」等于让人再点一次')
  assert.match(noRecipient, /报名进场后再发/)
  assert.match(await rejectToast('GAME_STATE_CONFLICT'), /操作未生效，请刷新后重试/,
    '认不出的原因码不得编造解释,保留原通用文案')
})

test('手动解锁必须填原因，且只提交章节开放动作', async () => {
  const writes = []
  const projection = {
    sessionId: 9001, activityId: 701, status: 'RUNNING', revision: 9,
    currentChapterId: 31, availableActions: ['UNLOCK_CHAPTER'],
    chapterOptions: [
      { chapterId: 31, title: '当前章' },
      { chapterId: 41, title: '第二章' },
      { chapterId: 42, title: '第三章' },
    ],
    readiness: { requiredStations: 3, readyStations: 3, teamsReady: true, blockers: [], canStart: false },
    stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], leaderboard: null, recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { writes.push(input); return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()

  harness.page.openManualUnlock()
  assert.deepEqual(JSON.parse(JSON.stringify(harness.page.data.chapterOptions.map((item) => item.chapterId))), [41, 42])
  harness.page.confirmManualUnlock()
  assert.equal(writes.length, 0, '没有原因不得解锁')
  harness.page.onUnlockReasonInput({ detail: { value: '伪造章节' } })
  harness.page.setData({ unlockChapterIndex: 99 })
  harness.page.confirmManualUnlock()
  assert.equal(writes.length, 0, '目标章节必须来自服务端 chapterOptions')
  harness.page.openManualUnlock()
  // 5-04:行组件回传 {id}(= chapterId),宿主页按 id 反查 index
  harness.page.onUnlockChapterChange({ detail: { id: 42 } })
  harness.page.onUnlockReasonInput({ detail: { value: '现场设备故障，导演同意绕过' } })
  harness.page.confirmManualUnlock()
  await settle()

  assert.equal(writes[0].action, 'UNLOCK_CHAPTER')
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), {
    chapterId: 42,
    reason: '现场设备故障，导演同意绕过',
  })
  const view = directorView()
  assert.match(view, /玩家进度与发放状态保持不变/)
  assert.doesNotMatch(view, /标记任务完成|发放权益|核销权益/)
})

test('榜单显隐只在服务端下发动作时可写，否则 fail closed', async () => {
  const lockedWrites = []
  const base = {
    sessionId: 9001, activityId: 701, status: 'RUNNING', revision: 9,
    currentChapterId: 31,
    readiness: { requiredStations: 3, readyStations: 3, teamsReady: true, blockers: [], canStart: false },
    stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], recap: null,
  }
  const locked = loadDirector({
    load() { return Promise.resolve(Object.assign({}, base, { availableActions: [], leaderboard: { visible: true } })) },
    submit(input) { lockedWrites.push(input); return Promise.resolve({ state: 'confirmed' }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  locked.page.initDirector('701')
  await settle()
  locked.page.onToggleLeaderboard()
  assert.equal(lockedWrites.length, 0)
  assert.match(locked.toasts[0].title, /暂不能调整/)

  const writes = []
  const writable = loadDirector({
    load() {
      return Promise.resolve(Object.assign({}, base, {
        availableActions: ['SET_LEADERBOARD_VISIBILITY'],
        leaderboard: { visible: false },
      }))
    },
    submit(input) { writes.push(input); return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  writable.page.initDirector('701')
  await settle()
  writable.page.onToggleLeaderboard()
  writable.modals[0].success({ confirm: true })
  await settle()
  assert.equal(writes[0].action, 'SET_LEADERBOARD_VISIBILITY')
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), { visible: true })
})

test('结束活动仅提交 FINISH，复盘未下发时不伪造零指标', async () => {
  const writes = []
  const projection = {
    sessionId: 9001, activityId: 701, status: 'RUNNING', revision: 9,
    currentChapterId: 31, availableActions: ['FINISH'],
    readiness: { requiredStations: 3, readyStations: 3, teamsReady: true, blockers: [], canStart: false },
    stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], leaderboard: null, recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { writes.push(input); return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()
  assert.deepEqual(JSON.parse(JSON.stringify(harness.page.data.recapMetrics)), [])
  harness.page.onFinishSession()
  // 2026-09-06:「结束活动」的确认由宿主页 T2 弹层承担,director 不再叠第二道 modal
  await settle()
  assert.equal(writes[0].action, 'FINISH')
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), {})

  const view = directorView()
  assert.match(view, /复盘尚未生成/)
  assert.doesNotMatch(view, /暂无复盘[^<]*0/)
})

test('草稿活动只在 PREPARE 可用时允许进入准备', async () => {
  const writes = []
  const projection = {
    sessionId: 9001, activityId: 701, status: 'DRAFT', revision: 1,
    currentChapterId: null, availableActions: ['PREPARE'],
    readiness: { requiredStations: null, readyStations: null, teamsReady: null, blockers: [], canStart: false },
    stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], leaderboard: null, recap: null,
  }
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { writes.push(input); return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()
  harness.page.onPrepareSession()
  harness.modals[0].success({ confirm: true })
  await settle()
  assert.equal(writes[0].action, 'PREPARE')
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), {})
})

test('加载异常分流 empty / business / network，且失败后不得用旧投影继续写入', async () => {
  const cases = [
    [{ code: 'SESSION_NOT_FOUND', message: '活动局不存在' }, 'empty'],
    [{ code: 'OWNER_REQUIRED', message: '无权访问' }, 'business-error'],
    [{ code: 'NETWORK_ERROR', message: '连接失败' }, 'network-error'],
  ]
  for (const [error, expectedState] of cases) {
    const writes = []
    const harness = loadDirector({
      load() { return Promise.reject(error) },
      submit(input) { writes.push(input); return Promise.resolve({ state: 'confirmed' }) },
      readReceipt() { return Promise.resolve({ state: 'pending' }) },
    })
    harness.page.initDirector('701')
    await settle()
    assert.equal(harness.page.data.loadState, expectedState)
    harness.page.executeAction('FINISH', {})
    assert.equal(writes.length, 0)
  }
  const view = directorView()
  assert.match(view, /wx:elif="\{\{loadState === 'business-error'\}\}"/)
  assert.match(view, /wx:elif="\{\{loadState === 'network-error'\}\}"/)
  assert.match(view, /节点数据尚未下发，不能据此判断为零进度/)
})

test('unknown 写持久化：重新进入自动用原 requestId 回读，pending 保留，确认后清理', async () => {
  const projection = {
    sessionId: 9001, activityId: 701, status: 'READY', revision: 8,
    currentChapterId: null, availableActions: ['START'],
    readiness: { requiredStations: 1, readyStations: 1, teamsReady: true, blockers: [], canStart: true },
    stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], leaderboard: null, recap: null,
  }
  const first = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  first.page.initDirector('701')
  await settle()
  first.page.onStartSession()
  first.modals[0].success({ confirm: true })
  await settle()
  const storageKey = 'cy.gameDirector.pendingWrite.m9.a701'
  assert.equal(first.storage[storageKey].action, 'START')
  const requestId = first.storage[storageKey].requestId

  const receiptCalls = []
  let receiptState = 'pending'
  const reopened = loadDirector({
    load() { return Promise.resolve(projection) },
    submit() { throw new Error('重新进入时不得重复写') },
    readReceipt(activityId, restoredRequestId) {
      receiptCalls.push({ activityId, requestId: restoredRequestId })
      return Promise.resolve({ state: receiptState, requestId: restoredRequestId })
    },
  }, first.storage)
  reopened.page.initDirector('701')
  await settle()
  await settle()
  assert.deepEqual(receiptCalls, [{ activityId: '701', requestId }])
  assert.equal(reopened.page.data.writeLocked, true)
  assert.equal(reopened.storage[storageKey].requestId, requestId)

  receiptState = 'business-error'
  reopened.page.onReconcileUnknownWrite()
  await settle()
  assert.equal(reopened.page.data.writeLocked, true)
  assert.equal(reopened.page._unknownRequestId, requestId)
  assert.equal(reopened.storage[storageKey].requestId, requestId)

  receiptState = 'confirmed'
  reopened.page.onReconcileUnknownWrite()
  await settle()
  await settle()
  assert.equal(reopened.page.data.writeLocked, false)
  assert.equal(reopened.storage[storageKey], undefined)
})

test('导演写命令在发请求前就持久化 requestId，请求抛错也必须保持写锁', async () => {
  const projection = {
    sessionId: 9001, activityId: 701, status: 'READY', revision: 8,
    currentChapterId: null, availableActions: ['START'],
    readiness: { requiredStations: 1, readyStations: 1, teamsReady: true, blockers: [], canStart: true },
    stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], leaderboard: null, recap: null,
  }
  let rejectSubmit
  const harness = loadDirector({
    load() { return Promise.resolve(projection) },
    submit() {
      return new Promise(function (_, reject) { rejectSubmit = reject })
    },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  harness.page.initDirector('701')
  await settle()

  harness.page.onStartSession()
  harness.modals[0].success({ confirm: true })
  const storageKey = 'cy.gameDirector.pendingWrite.m9.a701'
  assert.equal(harness.storage[storageKey].action, 'START', '必须先持久化再进入异步请求')
  assert.equal(harness.page.data.writeLocked, true)

  rejectSubmit(new Error('连接中断'))
  await settle()
  assert.equal(harness.page.data.writeState, 'unknown-write')
  assert.equal(harness.page.data.writeLocked, true)
  assert.equal(harness.storage[storageKey].action, 'START')
})

test('导演回执索引落盘失败时 fail closed，网络请求不得发出', async () => {
  const submits = []
  const harness = loadDirector({
    load() { return Promise.resolve({
      sessionId: 9001, activityId: 701, status: 'READY', revision: 8,
      availableActions: ['START'],
      readiness: { requiredStations: 1, readyStations: 1, teamsReady: true, blockers: [], canStart: true },
      stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], leaderboard: null, recap: null,
    }) },
    submit(command) { submits.push(command); return Promise.resolve({ state: 'confirmed' }) },
    readReceipt() { throw new Error('未发送写请求时不应读回执') },
  }, {}, { storageWriteError: true })

  harness.page.initDirector('701')
  await settle()
  harness.page.executeAction('START', {})
  await settle()

  assert.equal(submits.length, 0)
  assert.equal(harness.page._pendingCommand, null)
  assert.equal(harness.page.data.writeLocked, false)
  assert.equal(harness.page.data.writeState, 'storage-error')
  assert.match(harness.page.data.writeMessage, /无法安全保存/)
  assert.match(harness.toasts[0].title, /无法安全保存/)
})

test('导演页收编进俱乐部端恒暗（2026-09-02 改稿，不再是全站唯一的浅色管理页）', () => {
  // 2026-09-03:导演台不再是独立页面,主题由宿主页(活动详情)承担 ——
  // 组件本身不带页面级主题类,所以这条要看宿主页而不是 directorView()。
  const route = 'pages/club/topic-detail/index'
  const source = read(DIRECTOR_HOST_WXML)
  const themes = topLevelThemeClasses(source)
  assert.equal(classifyPageDomain(route), 'player', '导演台已归默认域，不再是专属 club 主题域的特例')
  assert.equal(themes.has('theme-dark'), true, '俱乐部导演台深链页恒暗，与 pages/club/detail 等其余俱乐部页一致')
  assert.equal(themes.has('theme-merchant'), false, '不许再挂 theme-merchant')

  const broken = source.replace(/\btheme-dark\b/, 'theme-merchant')
  assert.notEqual(broken, source, '负控必须实际把导演台改回商家浅色')
  assert.equal(topLevelThemeClasses(broken).has('theme-dark'), false)
})

test('角色接管入口只向已确认且已有角色的成员展示', () => {
  // 2026-09-03:守卫从模板的 wx:if 挪到了宿主页 —— 抽成组件后组件只渲染给它的列表,
  // 把关只能在喂数据的一侧。这比原来更硬:不合格的人根本不进列表,
  // 组件换个写法也漏不出必定失败的接管入口。这里直接跑那段筛选,不看文本。
  const host = read('pages/club/topic-detail/index.js')
  const runFilter = (roles, canTakeoverRoles) => {
    const page = { data: { roles, canTakeoverRoles }, setData(p) { Object.assign(this.data, p) } }
    runPageMethod(host, 'refreshTakeoverCandidates', page)
    return page.data.directorTakeoverCandidates
  }
  const rows = [
    { teamId: 11, memberId: 1, memberNameText: '阿青', roleNameText: '侦察员', roleCode: 'SCOUT', confirmationStatus: 'CONFIRMED' },
    { teamId: 11, memberId: 2, roleCode: 'SCOUT', confirmationStatus: 'PENDING' },
    { teamId: 11, memberId: 3, roleCode: '', confirmationStatus: 'CONFIRMED' },
    { teamId: 11, memberId: 4, memberNameText: '小唐', roleNameText: '向导', roleCode: 'GUIDE', confirmationStatus: 'CONFIRMED' },
  ]
  // 5-03:候选行必须是行组件认的 {id,title,subtitle}(id = teamId:memberId),否则列表空白、点不中
  assert.deepEqual(runFilter(rows, true).map((r) => r.id), ['11:1', '11:4'],
    'PENDING 或未分配角色不得出现必定失败的接管入口')
  assert.deepEqual(runFilter(rows, true).map((r) => r.title), ['阿青', '小唐'],
    'title 取 memberNameText,组件拿不到 title 就是空白行')
  assert.deepEqual(runFilter(rows, false), [],
    '没有接管权限时一个候选都不该有')
  assert.deepEqual(runFilter(undefined, true), [], 'roles 还没下发时不许崩,也不许瞎给')
  // 绑定确实用的是这份筛过的列表,不是原始 roles
  assert.match(read(DIRECTOR_HOST_WXML), /takeovers="\{\{directorTakeoverCandidates\}\}"/,
    '组件绑到了没筛过的列表,守卫等于没写')

  // 负控:把「已确认」那半条判据拿掉,PENDING 的人就会混进候选 —— 必须能被抓到。
  // ⚠️ 先剥注释再变异:宿主页在 data 块的注释里也写着同一串判据(它在解释守卫从哪搬来的),
  //    直接 replace 会命中那条注释、代码纹丝不动,而 notEqual 照样为真 —— 负控空转。
  //    2026-09-03 实测踩到,是这条负控自己抓出来的。
  const host2 = read('pages/club/topic-detail/index.js').replace(/^\s*\/\/.*$/gm, '')
  const loosened = host2.replace(" && item.confirmationStatus === 'CONFIRMED'", '')
  assert.notEqual(loosened, host2, '变异没生效:判据形状已漂移,这个负控在空转')
  const page2 = {
    data: {
      canTakeoverRoles: true,
      roles: [{ memberId: 2, roleCode: 'SCOUT', confirmationStatus: 'PENDING' }],
    },
    setData(p) { Object.assign(this.data, p) },
  }
  runPageMethod(loosened, 'refreshTakeoverCandidates', page2)
  assert.equal(page2.data.directorTakeoverCandidates.length, 1,
    '放宽后 PENDING 没混进来,说明判据根本没在起作用')
  // 旧的模板 wx:if 守卫已经不存在了(守卫挪到了喂数据那侧),
  // 确认它没有偷偷留在任何一个组件里 —— 两处都有会出现「藏起来但仍可点」的鬼影。
  assert.doesNotMatch(
    directorView(),
    /wx:if="\{\{canTakeoverRoles\s*&&\s*item\.roleCode/,
    '模板里还留着旧守卫:守卫应当只有一处,在喂数据那侧',
  )
})

test('导演未知写只落回执索引；内存可精确重试，重进后只读回执且禁止重构广播 payload', async () => {
  const projection = {
    sessionId: 9001, activityId: 701, status: 'RUNNING', revision: 9,
    currentChapterId: 31, availableActions: ['BROADCAST'],
    readiness: { requiredStations: 1, readyStations: 1, teamsReady: true, blockers: [], canStart: false },
    stations: [], teams: [{ teamId: 11, name: '第一队', memberCount: 2 }], roles: [], roleOptions: [],
    broadcasts: [], leaderboard: null, recap: null,
  }
  const submits = []
  const first = loadDirector({
    load() { return Promise.resolve(projection) },
    submit(input) { submits.push(input); return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  first.page.initDirector('701')
  await settle()
  first.page.openBroadcast()
  first.page.onBroadcastContentInput({ detail: { value: '侦察员请原地等待，口令蓝鲸' } })
  first.page.confirmBroadcast()
  await settle()

  const storageKey = 'cy.gameDirector.pendingWrite.m9.a701'
  const requestId = first.storage[storageKey].requestId
  assert.deepEqual(JSON.parse(JSON.stringify(first.storage[storageKey])), {
    activityId: '701', nodeId: null, requestId,
    expectedRevision: 9, action: 'BROADCAST',
  })
  assert.doesNotMatch(JSON.stringify(first.storage[storageKey]), /payload|command|savedAt|content|蓝鲸|reason|playerMessage/i)
  assert.deepEqual(JSON.parse(JSON.stringify(first.page._pendingCommand)), JSON.parse(JSON.stringify(submits[0])))

  first.page.retryUnknownWrite()
  await settle()
  assert.deepEqual(JSON.parse(JSON.stringify(submits[1])), JSON.parse(JSON.stringify(submits[0])),
    '页面未重启时必须复用内存中的原命令精确重试')

  const receiptCalls = []
  let receiptState = 'pending'
  const reopened = loadDirector({
    load() { return Promise.resolve(projection) },
    submit() { throw new Error('重启后不得从回执索引重构广播命令') },
    readReceipt(activityId, restoredRequestId, receiptIndex) {
      receiptCalls.push({ activityId, requestId: restoredRequestId, receiptIndex })
      return Promise.resolve({ state: receiptState, requestId: restoredRequestId })
    },
  }, first.storage)
  reopened.page.initDirector('701')
  await settle()
  await settle()
  assert.equal(reopened.page._pendingCommand, null)
  assert.equal(reopened.page.retryUnknownWrite(), false)
  assert.equal(receiptCalls.length, 1, '重进后只自动读取一次回执')
  assert.deepEqual(JSON.parse(JSON.stringify(receiptCalls[0].receiptIndex)), {
    activityId: '701', nodeId: null, requestId, expectedRevision: 9, action: 'BROADCAST',
  })
  assert.equal(reopened.page.data.writeLocked, true)
  assert.equal(reopened.page._unknownRequestId, requestId)
  assert.equal(reopened.storage[storageKey].requestId, requestId)

  receiptState = 'rejected'
  reopened.page.onReconcileUnknownWrite()
  await settle()

  assert.equal(reopened.page.data.writeLocked, false)
  assert.equal(reopened.storage[storageKey], undefined)
  assert.match(directorView(), /bindtap="retryUnknownWrite"/)
  assert.match(directorView(), /重试原操作/)
})

test('club recap 只保留冻结聚合字段，任一子块畸形则整块 fail closed', () => {
  const { normalizeClubProjection } = require(DIRECTOR_ADAPTER)
  const recap = validClubRecap()
  recap.phone = '13800000000'
  recap.stations[0].evidence = 'https://private.example/evidence.jpg'
  const raw = {
    sessionId: 9001, activityId: 701, perspective: 'CLUB', status: 'FINISHED', revision: 10,
    availableActions: [],
    club: { readiness: {}, stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], recap },
  }
  const normalized = normalizeClubProjection(raw)
  assert.equal(normalized.recap.schemaVersion, 'GAME_RECAP_V1')
  assert.equal(normalized.recap.collaboration.ratePercent, 75)
  assert.doesNotMatch(JSON.stringify(normalized.recap), /phone|longitude|latitude|evidence|photo|memberId|memberName/i)

  const invalidRate = JSON.parse(JSON.stringify(raw))
  invalidRate.club.recap.collaboration.ratePercent = 101
  assert.equal(normalizeClubProjection(invalidRate).recap, null)

  const missingField = JSON.parse(JSON.stringify(raw))
  delete missingField.club.recap.hints.answerReveals
  assert.equal(normalizeClubProjection(missingField).recap, null)

  const isoTime = JSON.parse(JSON.stringify(raw))
  isoTime.club.recap.generatedAt = '2026-08-23T18:30:45Z'
  assert.equal(normalizeClubProjection(isoTime).recap, null)
})

test('adapter 只在同活动 owner 投影授权后导出，并二次净化安全 JSON', async () => {
  const { createClubGameDirectorAdapter } = require(DIRECTOR_ADAPTER)
  const calls = []
  const recap = validClubRecap()
  const exported = {
    schemaVersion: 'GAME_RECAP_EXPORT_V1', generatedAt: '2026-08-23 18:31:00',
    activityId: 701, sessionId: 9001, recap: JSON.parse(JSON.stringify(recap)),
    memberName: '不得导出',
  }
  exported.recap.stations[0].photo = 'https://private.example/photo.jpg'
  const adapter = createClubGameDirectorAdapter({
    loadProjection(role, activityId) {
      calls.push({ kind: 'load', role, activityId })
      return Promise.resolve({ status: 'ready', data: {
        sessionId: 9001, activityId: 701, perspective: 'CLUB', status: 'FINISHED', revision: 10,
        availableActions: [],
        club: { readiness: {}, stations: [], teams: [], roles: [], roleOptions: [], broadcasts: [], recap },
      } })
    },
    loadClubRecapExport(activityId) {
      calls.push({ kind: 'export', activityId })
      return Promise.resolve({ status: 'ready', data: exported })
    },
    submitAction() { throw new Error('本用例不应写入') },
    readReceipt() { throw new Error('本用例不应读回执') },
  })

  await assert.rejects(adapter.exportRecap(701), (error) => error && error.code === 'OWNER_REQUIRED')
  assert.deepEqual(calls, [])
  await adapter.load(701)
  await assert.rejects(adapter.exportRecap(702), (error) => error && error.code === 'OWNER_REQUIRED')
  const result = await adapter.exportRecap(701)
  assert.deepEqual(calls, [
    { kind: 'load', role: 'club', activityId: 701 },
    { kind: 'export', activityId: 701 },
  ])
  assert.equal(result.schemaVersion, 'GAME_RECAP_EXPORT_V1')
  assert.doesNotMatch(JSON.stringify(result), /phone|longitude|latitude|evidence|photo|memberId|memberName/i)
})

test('角色接管仅允许有角色的来源交给同队待分配成员，且原因必填', async () => {
  const writes = []
  const roles = [
    { teamId: 11, memberId: 21, memberName: '阿青', roleCode: 'SCOUT', roleName: '侦察员', status: 'CONFIRMED' },
    { teamId: 11, memberId: 22, memberName: '小林', roleCode: '', roleName: '', status: 'JOINED' },
    { teamId: 11, memberId: 23, memberName: '小郑', roleCode: 'KEEPER', roleName: '守护员', status: 'CONFIRMED' },
    { teamId: 11, memberId: 25, memberName: '小唐', roleCode: 'GUIDE', roleName: '向导', status: 'PENDING' },
    { teamId: 12, memberId: 24, memberName: '小周', roleCode: '', roleName: '', status: 'JOINED' },
  ]
  const harness = loadDirector({
    load() { return Promise.resolve(runningClubProjection({ availableActions: ['TAKEOVER_ROLE'], roles })) },
    submit(input) { writes.push(input); return Promise.resolve({ state: 'unknown-write', requestId: input.requestId }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
    exportRecap() { throw new Error('本用例不导出') },
  })
  harness.page.initDirector('701')
  await settle()

  harness.page.openTakeoverRole({ detail: { id: '11:22' } })
  assert.equal(harness.page.data.takeoverSheetVisible, false, '无角色成员不得作为来源')
  harness.page.openTakeoverRole({ detail: { id: '11:25' } })
  assert.equal(harness.page.data.takeoverSheetVisible, false, '角色未 CONFIRMED 的成员不得作为接管来源')
  harness.page.setData({ takeoverDraft: {
    teamId: 11, sourceMemberId: 25, targetMemberId: 22, reason: '绕过来源状态',
  } })
  harness.page.confirmTakeoverRole()
  assert.equal(writes.length, 0, '即使绕过 sheet，PENDING 来源也不得构造必失败命令')
  harness.page.openTakeoverRole({ detail: { id: '11:21' } })
  assert.equal(harness.page.data.takeoverSheetVisible, true)
  assert.deepEqual(JSON.parse(JSON.stringify(harness.page._takeoverTargetOptions.map((item) => item.memberId))), [22])

  harness.page.setData({ takeoverDraft: Object.assign({}, harness.page.data.takeoverDraft, { targetMemberId: 24, reason: '跨队' }) })
  harness.page.confirmTakeoverRole()
  assert.equal(writes.length, 0, '跨队目标不得写入')
  harness.page.setData({ takeoverDraft: Object.assign({}, harness.page.data.takeoverDraft, { targetMemberId: 23, reason: '目标已有角色' }) })
  harness.page.confirmTakeoverRole()
  assert.equal(writes.length, 0, '已有角色目标不得写入')

  harness.page.openTakeoverRole({ detail: { id: '11:21' } })
  harness.page.confirmTakeoverRole()
  assert.equal(writes.length, 0, '未填原因不得写入')
  harness.page.onTakeoverReasonInput({ detail: { value: '现场队员无法继续履职' } })
  harness.page.confirmTakeoverRole()
  await settle()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].action, 'TAKEOVER_ROLE')
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].payload)), {
    teamId: 11, sourceMemberId: 21, targetMemberId: 22, reason: '现场队员无法继续履职',
  })
  assert.equal(harness.page.data.writeLocked, true, '接管写入 unknown 后应进入同一全页锁')

  const deniedWrites = []
  const denied = loadDirector({
    load() { return Promise.resolve(runningClubProjection({ availableActions: [], roles })) },
    submit(input) { deniedWrites.push(input); return Promise.resolve({ state: 'confirmed' }) },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
  })
  denied.page.initDirector('701')
  await settle()
  denied.page.openTakeoverRole({ detail: { id: '11:21' } })
  assert.equal(denied.page.data.takeoverSheetVisible, false)
  assert.equal(deniedWrites.length, 0)
})

test('复盘导出按钮仅在权威可导出投影中显示，只复制服务端净化 JSON', async () => {
  const safeExport = {
    schemaVersion: 'GAME_RECAP_EXPORT_V1', generatedAt: '2026-08-23 18:31:00',
    activityId: 701, sessionId: 9001, recap: validClubRecap(),
  }
  const harness = loadDirector({
    load() { return Promise.resolve(runningClubProjection({ recap: validClubRecap() })) },
    submit() { throw new Error('本用例不应写入') },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
    exportRecap(activityId) {
      assert.equal(activityId, '701')
      return Promise.resolve(safeExport)
    },
  })
  harness.page.initDirector('701')
  await settle()
  assert.equal(harness.page.data.canExportRecap, true)
  harness.page.copyRecap()
  await settle()
  assert.equal(harness.clipboard.length, 1)
  assert.deepEqual(JSON.parse(harness.clipboard[0]), safeExport)
  assert.doesNotMatch(harness.clipboard[0], /phone|longitude|latitude|evidence|photo|memberId|memberName/i)

  const failed = loadDirector({
    load() { return Promise.resolve(runningClubProjection({ recap: validClubRecap() })) },
    submit() { throw new Error('本用例不应写入') },
    readReceipt() { return Promise.resolve({ state: 'pending' }) },
    exportRecap() { return Promise.reject({ code: 'NETWORK_ERROR', message: '网络异常' }) },
  })
  failed.page.initDirector('701')
  await settle()
  failed.page.copyRecap()
  await settle()
  assert.match(failed.toasts[0].title, /网络异常|失败/)

  const view = directorView()
  assert.match(view, /复制复盘数据/)
  assert.match(view, /bindtap="copyRecap"/)
  assert.match(view, /角色接管/)
})

async function assertBroadcastReceiptFeedback(options) {
  for (const restored of [false, true]) {
    const harness = loadDirector({
      load() { return Promise.resolve(runningClubProjection({ availableActions: ['BROADCAST'] })) },
      readReceipt() { return Promise.resolve({ state: 'rejected', raw: { reasonCode: 'GAME_BROADCAST_NO_RECIPIENT' } }) },
    }, null, options)
    harness.page.initDirector('701')
    await settle()
    harness.page._unknownRequestId = 'broadcast-receipt'
    harness.page._pendingCommand = restored ? null : { action: 'BROADCAST' }
    harness.page._pendingReceiptIndex = { action: 'BROADCAST' }
    harness.page.setData({ writeLocked: true })
    harness.page.onReconcileUnknownWrite()
    await settle()
    assert.equal(harness.page.data.writeLocked, false, '终态回执必须解除写锁')
    assert.match(harness.toasts[0].title, /没有发出.*报名进场后再发/, '原页面和重进页面都必须保留广播驳回原因')
  }
}

test('广播未知写核对：内存命令与重进后的回执索引均保留驳回原因', async () => {
  await assertBroadcastReceiptFeedback()
})

test('负控：丢失回调上下文或不读取恢复索引必须使广播回执回归变红', async () => {
  const source = read(DIRECTOR_JS)
  const line = "const pendingAction = ((that._pendingCommand || that._pendingReceiptIndex || {}).action) || ''"
  assert.ok(source.includes(line))
  for (const replacement of [
    "const pendingAction = (this._pendingCommand && this._pendingCommand.action) || ''",
    "const pendingAction = (that._pendingCommand && that._pendingCommand.action) || ''",
  ]) {
    await assert.rejects(() => assertBroadcastReceiptFeedback({
      directorSource: source.replace(line, replacement),
    }), assert.AssertionError)
  }
})
