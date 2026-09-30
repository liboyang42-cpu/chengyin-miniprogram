const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js
const { createRequestClient } = require('../../utils/transport/request-client.js')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function applyDataPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (let i = 0; i < parts.length - 1; i += 1) cursor = cursor[parts[i]]
    cursor[parts.at(-1)] = value
  })
}

function mount(relativePath, appOverrides) {
  const requests = []
  const navigations = []
  const modals = []
  const toasts = []
  let definition
  const app = {
    _userId: 7,
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    getUserID() { return this._userId },
    sendRequest(options) { requests.push(options) },
  }
  Object.assign(app, appOverrides || {})
  // owner-action-guard 走宿主的真 require,拿的是宿主全局的 getApp(不是下面 vm 沙箱里那个)
  global.getApp = () => app
  const wx = {
    navigateBack(options = {}) { navigations.push({ type: 'back', options }) },
    switchTab(options) { navigations.push({ type: 'tab', options }) },
    navigateTo(options) { navigations.push({ type: 'to', options }) },
    stopPullDownRefresh() {},
    showModal(options) { modals.push(options) },
    showToast(options) { toasts.push(options) },
  }
  vm.runInNewContext(read(relativePath), {
    getApp: () => app,
    // 根栈:全页返回合同(#806)按 getCurrentPages().length 判是否有上一页
    getCurrentPages: () => [{}],
    Page(config) { definition = config },
    require(request) {
      if (request === '../../../utils/response-shape.js') return require(path.join(ROOT, 'utils/response-shape.js'))
      if (request === '../../../utils/motion-preference.js') return require(path.join(ROOT, 'utils/motion-preference.js'))
      // 2026-09-09 清退退款从名册行内挪到核销详情后,两页共用的四条判据抽进了这个模块。
      if (request === '../utils/owner-action-guard.js') return require(path.join(ROOT, 'pages/club/utils/owner-action-guard.js'))
      throw new Error(`unexpected require: ${request}`)
    },
    JSON,
    Number,
    String,
    wx,
  }, { filename: relativePath })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      applyDataPatch(this.data, patch)
      if (callback) callback.call(this)
    },
  })
  return { page, app, requests, navigations, modals, toasts }
}

test('报名名册把权限查询失败与真实无权限分开，错误态可以原位重试', () => {
  const network = mount('pages/club/enroll/index.js')
  network.page.onLoad({ clubId: '9' })
  network.requests[0].fail({ errMsg: 'request:fail' })
  assert.equal(network.page.data.permissionState, 'network-error')

  network.page.retryPermission()
  assert.equal(network.requests.length, 2)

  const malformed = mount('pages/club/enroll/index.js')
  malformed.page.onLoad({ clubId: '9' })
  malformed.requests[0].success({ code: '200', data: null })
  assert.equal(malformed.page.data.permissionState, 'business-error')

  const denied = mount('pages/club/enroll/index.js')
  denied.page.onLoad({ clubId: '9' })
  denied.requests[0].success({ code: '200', data: { id: 9, isOwner: false, viewerIsAdmin: false } })
  assert.equal(denied.page.data.permissionState, 'denied')
  assert.equal(denied.requests.length, 1, '非 owner 非管理员必须直接拒绝，不再读取成员列表猜权限')

  const view = read('pages/club/enroll/index.wxml')
  assert.match(view, /permissionState === 'loading'[\s\S]*?<cy-skeleton/)
  assert.match(view, /permissionState === 'business-error'[\s\S]*?bind:retry="retryPermission"/)
  assert.match(view, /permissionState === 'network-error'[\s\S]*?bind:retry="retryPermission"/)
  // 2026-09-15 弹窗合同:无权限是终态 → 零按钮 fail 面板,2s 后走页面自己的 goBack
  assert.match(view, /permissionState === 'denied'[\s\S]*?bind:back="goBack" auto-back custom-back/)
})

test('owner 权限重验与 owner-only 名册读取一旦 401/403 就清空旧 PII', () => {
  const permission = mount('pages/club/enroll/index.js')
  Object.assign(permission.page.data, {
    clubId: '9', permissionState: 'ready',
    teamsState: 'ready', teams: [{ id: 101, tickets: [{ regs: [{ id: 33, nickname: '旧玩家' }] }] }],
  })
  permission.page.checkPermission()
  assert.equal(permission.page.data.teams.length, 0, '开始重验权限时就不得继续展示旧 PII')
  assert.equal(typeof permission.requests[0].successStatusAbnormal, 'function')
  permission.requests[0].successStatusAbnormal({}, 403)
  assert.equal(permission.page.data.permissionState, 'denied')

  const topics = mount('pages/club/enroll/index.js')
  Object.assign(topics.page.data, {
    clubId: '9', permissionState: 'ready',
    teamsState: 'ready', teams: [{ id: 101, tickets: [{ regs: [{ id: 33 }] }] }],
  })
  topics.page.loadTeams()
  assert.equal(typeof topics.requests[0].successStatusAbnormal, 'function')
  topics.requests[0].successStatusAbnormal({}, 403)
  assert.equal(topics.page.data.permissionState, 'denied')
  assert.equal(topics.page.data.teams.length, 0)

  const detail = mount('pages/club/enroll/index.js')
  Object.assign(detail.page.data, {
    clubId: '9', permissionState: 'ready',
    teamsState: 'ready', teams: [{ id: 101, _detailState: 'ready', tickets: [{ regs: [{ id: 33 }] }] }],
  })
  detail.page.loadTeamDetail(0, 101)
  assert.equal(typeof detail.requests[0].successStatusAbnormal, 'function')
  detail.requests[0].successStatusAbnormal({}, 403)
  assert.equal(detail.page.data.permissionState, 'denied')
  assert.equal(detail.page.data.teams.length, 0)

  const removed = mount('pages/club/enroll/index.js')
  Object.assign(removed.page.data, {
    clubId: '9', permissionState: 'ready',
    teamsState: 'ready',
    teams: [
      { id: 101, _detailState: 'ready', tickets: [{ regs: [{ id: 33 }] }] },
      { id: 202, _detailState: 'ready', tickets: [{ regs: [{ id: 44 }] }] },
    ],
  })
  removed.page.loadTeamDetail(0, 101)
  removed.page.setData({
    teams: [{ id: 202, _detailState: 'ready', tickets: [{ regs: [{ id: 44 }] }] }],
  })
  removed.requests[0].success({ code: 403, msg: '仅主理人或管理员可查看报名名册' })
  assert.equal(removed.page.data.permissionState, 'denied', '目标团移除后仍须先处理权限撤销')
  assert.equal(removed.page.data.teams.length, 0, '权限撤销不得保留其他团的报名者 PII')
})

test('报名名册刷新保留已有团队，失败留局部错误，迟到回包不能覆盖新结果', () => {
  const harness = mount('pages/club/enroll/index.js')
  Object.assign(harness.page.data, {
    clubId: '9', permissionState: 'ready',
    teamsState: 'ready', teams: [{ id: 1, name: '旧名册', _open: false, _detailState: 'idle', tickets: [] }],
  })

  harness.page.loadTeams()
  assert.equal(harness.page.data.refreshing, true)
  assert.equal(harness.page.data.teams[0].name, '旧名册')
  harness.requests[0].fail({ errMsg: 'network' })
  assert.equal(harness.page.data.teamsState, 'ready')
  assert.equal(harness.page.data.refreshing, false)
  assert.equal(harness.page.data.teams[0].name, '旧名册')
  assert.match(harness.page.data.staleError, /更新失败/)

  harness.page.loadTeams()
  harness.page.loadTeams()
  harness.requests[1].success({ code: '200', data: [{ id: 1, name: '迟到结果' }] })
  assert.equal(harness.page.data.refreshing, true)
  assert.equal(harness.page.data.teams[0].name, '旧名册')
  harness.requests[2].success({ code: '200', data: [{ id: 1, name: '最新结果' }] })
  assert.equal(harness.page.data.teams[0].name, '最新结果')
  assert.equal(harness.page.data.refreshing, false)

  const view = read('pages/club/enroll/index.wxml')
  assert.match(view, /refreshing[\s\S]*aria-role="status"[\s\S]*aria-live="polite"/)
  assert.match(view, /<cy-inline-error\b[^>]*wx:if="\{\{staleError\}\}"[^>]*bind:action="retryLoadTeams"/s,
    '名册页 staleError 兼作「退款结果仍待确认」提醒(涉及钱),必须保留可见')
  assert.match(view, /<cy-skeleton\b[^>]*team\._detailState === 'loading'/)
  assert.match(view, /<cy-icon\b[^>]*name="arrow-right"/)
  assert.doesNotMatch(view, />›</)
})

// 2026-09-09 清退退款从这一页挪到了核销详情(pages/club/checkin-detail)。
// 原来钉在这里的 11 条退款合同随入口迁走 ——「回执未知 ≠ 失败」那几条在
// tests/unit/club-checkin-refund-contract.test.js 里接着守;
// 「多团重排 / 多笔 parked / 旧 index」那几条不接:新形态一次只处理一单,
// 那些情形不存在了,留着就是给一段不存在的代码写合同。

test('报名名册身份切换立即清除旧成员快照并重新校验身份', () => {
  const harness = mount('pages/club/enroll/index.js')
  harness.page.onLoad({ clubId: '9' })
  harness.requests[0].success({ code: '200', data: { id: 9, isOwner: true, viewerIsAdmin: false } })
  harness.requests[1].success({ code: '200', data: [{ id: 101, name: '旧成员所在团' }] })
  assert.equal(harness.page.data.teams[0].name, '旧成员所在团')

  harness.app._userId = 8
  harness.page.onShow()
  assert.equal(harness.page.data.teams.length, 0, '身份变化必须先清空旧名册 PII')
  assert.equal(harness.page.data.permissionState, 'loading')
  assert.equal(harness.requests[2].url, '/api/club/detail')
  harness.requests[2].success({ code: '200', data: { id: 9, isOwner: false, viewerIsAdmin: false } })
  assert.equal(harness.page.data.permissionState, 'denied')
  assert.equal(harness.page.data.teams.length, 0)
})

test('入会申请缺参只给真实返回，深链返回失败落到俱乐部列表', () => {
  const harness = mount('pages/club/join-requests/index.js')
  harness.page.onLoad({})
  assert.equal(harness.page.data.state, 'missing-param')
  assert.equal(harness.requests.length, 0)

  // 根栈直链进入(无上一页):不再依赖 navigateBack 的 fail 回调,直接落到俱乐部列表。
  harness.page.goBack()
  assert.equal(harness.navigations[0].type, 'tab')
  assert.equal(harness.navigations[0].options.url, '/pages/talent/list/index')

  const view = read('pages/club/join-requests/index.wxml')
  const missingTag = view.match(/<cy-empty\b[^>]*state === 'missing-param'[^>]*>/s)
  assert.ok(missingTag)
  assert.match(missingTag[0], /bind:cta="goBack"/)
  assert.doesNotMatch(missingTag[0], /bind:retry="loadRequests"/)
})

test('入会申请刷新保留快照并拒绝迟到回包，失败提供局部恢复', () => {
  const harness = mount('pages/club/join-requests/index.js')
  Object.assign(harness.page.data, {
    clubId: 9, state: 'ready', requests: [{ id: 1, memberId: 7, nickname: '旧申请' }],
  })
  harness.page.loadRequests()
  assert.equal(harness.page.data.refreshing, true)
  assert.equal(harness.page.data.requests[0].nickname, '旧申请')
  harness.requests[0].fail({ errMsg: 'network' })
  assert.equal(harness.page.data.state, 'ready')
  assert.equal(harness.page.data.requests[0].nickname, '旧申请')
  assert.equal(harness.page.data.staleErrorKind, 'network')
  assert.match(harness.page.data.staleError, /更新失败/)

  harness.page.loadRequests()
  harness.page.loadRequests()
  harness.requests[1].success({ code: '200', data: [{ id: 1, memberId: 7, nickname: '迟到申请' }] })
  assert.equal(harness.page.data.requests[0].nickname, '旧申请')
  harness.requests[2].success({ code: '200', data: [{ id: 1, memberId: 7, nickname: '最新申请' }] })
  assert.equal(harness.page.data.requests[0].nickname, '最新申请')
  assert.equal(harness.page.data.staleError, '', '刷新成功必须清掉旧的内联错误')

  const view = read('pages/club/join-requests/index.wxml')
  assert.match(view, /refreshing[\s\S]*aria-role="status"[\s\S]*aria-live="polite"/)
  // 2026-09-17 用户拍板:本页刷新失败要有可见的内联错误 + 重试,是「有旧内容时静默降级」
  // (2026-08-26)的唯一例外 —— 待审名单直接影响审批动作,静默会让人对着旧名单做决定。
  assert.match(view, /<cy-inline-error\b[^>]*wx:if="\{\{staleError\}\}"[^>]*bind:action="loadRequests"/s)
})

test('入会申请刷新失败:业务失败用后端 msg,200 但数据校验不过不许把「操作成功」当失败原因', () => {
  // 业务失败(code 500):错误文案取后端 msg,旧快照保留
  const biz = mount('pages/club/join-requests/index.js')
  Object.assign(biz.page.data, {
    clubId: 9, state: 'ready', requests: [{ id: 1, memberId: 7, nickname: '旧申请' }],
  })
  biz.page.loadRequests()
  biz.requests[0].success({ code: 500, msg: '入会申请暂时不可用' })
  assert.equal(biz.page.data.state, 'ready')
  assert.equal(biz.page.data.staleErrorKind, 'data')
  assert.equal(biz.page.data.staleError, '入会申请暂时不可用')

  // 负控(settlement 同类 bug):HTTP 200 + code 200 的成功体 msg 是「操作成功」,
  // 数据形状不对时绝不能把它当错误原因,必须落固定兜底文案。
  const shaped = mount('pages/club/join-requests/index.js')
  Object.assign(shaped.page.data, {
    clubId: 9, state: 'ready', requests: [{ id: 1, memberId: 7, nickname: '旧申请' }],
  })
  shaped.page.loadRequests()
  shaped.requests[0].success({ code: 200, msg: '操作成功', data: null })
  assert.equal(shaped.page.data.state, 'ready')
  assert.equal(shaped.page.data.staleError, '入会申请暂时不可用')
  assert.doesNotMatch(shaped.page.data.staleError, /操作成功/)

  // 首屏(无快照)失败仍走整页错误态,不进 ready
  const first = mount('pages/club/join-requests/index.js')
  first.page.onLoad({ clubId: '9' })
  first.requests[0].success({ code: 200, msg: '操作成功', data: null })
  assert.equal(first.page.data.state, 'business-error')
  assert.equal(first.page.data.errorText, '入会申请暂时不可用')
  assert.doesNotMatch(first.page.data.errorText, /操作成功/)
})

test('入会审核 single-flight，失败留在对应卡片且两个动作都暴露禁用语义', () => {
  const harness = mount('pages/club/join-requests/index.js')
  Object.assign(harness.page.data, {
    clubId: 9, state: 'ready', requests: [{ id: 1, memberId: 7, nickname: '小城' }],
  })
  harness.page.review(7, true)
  harness.page.review(8, false)
  assert.equal(harness.requests.length, 1)
  assert.equal(harness.page.data.actingMemberId, 7)
  assert.equal(harness.page.data.actingAction, 'approve')
  harness.requests[0].success({ code: '500', msg: '申请状态已变化' })
  assert.equal(harness.page.data.actingMemberId, null)
  assert.equal(harness.page.data.actionErrorMemberId, 7)
  assert.equal(harness.page.data.actionErrorAction, 'approve')
  assert.equal(harness.page.data.actionErrorText, '申请状态已变化')

  harness.page.retryReview({ currentTarget: { dataset: { memberId: 7, action: 'approve' } } })
  assert.equal(harness.modals.length, 1)

  const view = read('pages/club/join-requests/index.wxml')
  assert.match(view, /<cy-inline-error\b[^>]*actionErrorMemberId === item\.memberId[^>]*bind:action="retryReview"/s)
  assert.equal((view.match(/aria-disabled="\{\{actingMemberId \? true : false\}\}"/g) || []).length, 2)
  assert.equal((view.match(/aria-role="button"/g) || []).length >= 2, true)
})

test('两页注册局部错误与真实图标组件', () => {
  const enroll = JSON.parse(read('pages/club/enroll/index.json'))
  const requests = JSON.parse(read('pages/club/join-requests/index.json'))
  assert.equal(enroll.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
  assert.equal(enroll.usingComponents['cy-icon'], '/components/cy/icon/index')
  assert.equal(enroll.enablePullDownRefresh, true)
  assert.equal(requests.usingComponents['cy-inline-error'], '/components/cy/inline-error/index')
})
