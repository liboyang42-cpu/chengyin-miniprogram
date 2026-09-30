'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const JS_PATH = path.join(ROOT, 'pages/merchant/apply/index.js')
const WXML_PATH = path.join(ROOT, 'pages/merchant/apply/index.wxml')
const WXSS_PATH = path.join(ROOT, 'pages/merchant/apply/index.wxss')
const TOKENS_PATH = path.join(ROOT, 'style/tokens.wxss')
const DATE_SHEET_WXSS_PATH = path.join(ROOT, 'components/cy/date-sheet/index.wxss')

function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  assert.ok(match, `缺少 ${selector} 样式`)
  return match[1]
}

function tokenRpx(tokens, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tokens.match(new RegExp(`${escaped}:\\s*(\\d+(?:\\.\\d+)?)rpx`))
  assert.ok(match, `缺少 ${name} 的 rpx 真值`)
  return Number(match[1])
}

function assertAccessibleControls(wxml, wxss) {
  assert.ok(/class="wizard-progress[^"]*"[^>]*aria-role="progressbar"[^>]*aria-valuenow="\{\{step\}\}"/.test(wxml),
    '四步进度必须向读屏说明当前位置')
  assert.ok(/class="hp-day[^>]*aria-role="checkbox"[^>]*aria-checked="\{\{item\.on\}\}"/.test(wxml),
    '经营日必须暴露可选中控件语义')
  assert.ok(/(?:height|min-height):\s*88rpx\b/.test(rule(wxss, '.hp-day')),
    '经营日触控目标不得小于 88rpx')
  const tokens = fs.readFileSync(TOKENS_PATH, 'utf8')
  const dateSheetWxss = fs.readFileSync(DATE_SHEET_WXSS_PATH, 'utf8')
  const gapToken = rule(wxss, '.hp-days').match(/gap:\s*var\((--cy-space-[\w-]+)\)/)
  const padToken = rule(wxss, '.hp-sheet').match(/padding:\s*var\((--cy-space-[\w-]+)\)/)
  const columns = rule(wxss, '.hp-days').match(/grid-template-columns:\s*repeat\((\d+),\s*minmax\(88rpx,\s*1fr\)\)/)
  const sheetPadding = rule(dateSheetWxss, '.ds-pop').match(/padding:\s*0\s+(\d+(?:\.\d+)?)rpx\b/)
  assert.ok(gapToken && padToken && columns && sheetPadding,
    '经营日网格必须使用可计算的列数、间距与父级内边距')
  const columnCount = Number(columns[1])
  const itemWidth = (
    750 - Number(sheetPadding[1]) * 2 - tokenRpx(tokens, padToken[1]) * 2
    - tokenRpx(tokens, gapToken[1]) * (columnCount - 1)
  ) / columnCount
  assert.ok(itemWidth >= 88, `七个经营日横排后单项仅 ${itemWidth.toFixed(1)}rpx，未达到 88rpx 宽度`)
  assert.ok(/class="img-add"[^>]*aria-role="button"[^>]*aria-label="添加品牌形象图"/.test(wxml),
    '品牌形象图添加入口必须有可读按钮名称')
  assert.ok(/accessibilityLabel="\{\{submitting \? '正在提交商家入驻申请'/.test(wxml),
    '动态提交按钮必须有稳定的可读名称')
}

function assertBootstrapMarkup(wxml) {
  assert.ok(/<block wx:elif="\{\{bootstrapState === 'ready'\}\}">/.test(wxml),
    '申请正文只能由显式 ready 状态放行')
  assert.ok(/<view class="bootstrap-state" wx:else>[\s\S]*状态暂时不可用[\s\S]*retryBootstrap/.test(wxml),
    '未知状态必须 fail closed 并给出恢复动作')
}

function loadPage(options = {}) {
  const requests = []
  const roleCallbacks = []
  const modals = []
  const navigation = []
  const imageCallbacks = []
  const locationRequests = []
  let userId = options.userId === undefined ? 9 : options.userId
  let authorization = options.authorization || 'token-a'
  let roleClearCount = 0
  let definition
  const roleGuard = {
    load(callback) { roleCallbacks.push(callback) },
    isClubLeader() { return Boolean(options.clubLeader) },
    hasSnapshot() { return options.roleSnapshotReady !== false },
    ownedClubs() { return [] },
    clear() { roleClearCount += 1 },
  }
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID() { return userId },
    getAuthorization() { return authorization },
    sendRequest(options) { requests.push(options) },
    chooseImage(callback) { imageCallbacks.push(callback) },
  }
  const wx = {
    showModal(options) { modals.push(options) },
    showToast() {},
    navigateBack() { navigation.push('back') },
    switchTab() { navigation.push('home') },
    navigateTo(options) { navigation.push(options.url) },
    chooseLocation(options) { locationRequests.push(options) },
    openSetting() {},
    // 换步重播进场动画用 nextTick;沙箱里不给,refreshStep 一跑就抛
    nextTick() {},
  }
  const sandbox = {
    Array,
    Date,
    Math,
    Object,
    RegExp,
    String,
    getApp: () => app,
    Page(config) { definition = config },
    wx,
    require(request) {
      if (request.endsWith('roleGuard.js')) return roleGuard
      if (request.endsWith('merchant-theme.js')) {
        return { merchantPageShow() {}, merchantPageRestore() {} }
      }
      if (request.endsWith('merchant-identity-policy.js')) {
        return require(path.join(ROOT, 'utils/merchant-identity-policy.js'))
      }
      // 本轮页面新引入的时间选项真源:用真模块而不是桩 —— 桩会和真值漂移,
      // 而这页的起止校验正是靠它,喂假数据等于测了个不存在的实现。
      if (request.endsWith('time-picker-options.js')) {
        return require(path.join(ROOT, 'utils/time-picker-options.js'))
      }
      // 减动效偏好:用真模块,桩会和真值漂移
      if (request.endsWith('motion-preference.js')) {
        return require(path.join(ROOT, 'utils/motion-preference.js'))
      }
      // 形变模块里用 wx.createSelectorQuery,实名 util 里用 getApp():
      // 普通 require 拿不到沙箱全局,放进同一个上下文编译 —— 被测到的是真实现不是桩
      if (request.endsWith('wizard-morph.js') || request.endsWith('publisher-identity.js')) {
        const rel = request.endsWith('wizard-morph.js') ? 'utils/wizard-morph.js' : 'utils/publisher-identity.js'
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        const mod = { exports: {} }
        const context = Object.assign({}, sandbox, { module: mod, exports: mod.exports })
        // util 自己的相对 require(./form-state.js)按 utils/ 解析,纯函数真 require 即可
        context.require = (dep) => (dep.startsWith('.')
          ? require(path.join(ROOT, 'utils', dep.replace(/^\.\//, '')))
          : require(dep))
        vm.runInNewContext(src, context, { filename: rel })
        return mod.exports
      }
      throw new Error(`unexpected require: ${request}`)
    },
  }
  vm.runInNewContext(options.source || fs.readFileSync(JS_PATH, 'utf8'), sandbox, { filename: JS_PATH })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch, callback) {
    Object.assign(this.data, patch)
    if (callback) callback.call(this)
  }
  return {
    page, requests, roleCallbacks, modals, navigation, imageCallbacks, locationRequests,
    switchIdentity(nextUserId, nextAuthorization) {
      userId = nextUserId
      authorization = nextAuthorization || ('token-' + nextUserId)
    },
    roleClearCount() { return roleClearCount },
  }
}

test('身份与既有申请确认完成前保持首载态，不提前露出新申请表', () => {
  const { page, requests, roleCallbacks } = loadPage()
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')

  assert.equal(page.data.bootstrapState, 'checking-role')
  page.onLoad()
  assert.equal(roleCallbacks.length, 1)
  assert.equal(requests.length, 0, '身份检查完成前不得请求或显示申请信息')
  assert.match(wxml, /bootstrapState === 'checking-role'/)
  assert.match(wxml, /bootstrapState === 'checking-application'/)
  assert.match(wxml, /bootstrapState === 'ready'\s*&&\s*mode==='form'/,
    '向导和表单只能在两道检查都完成后出现')
  assertBootstrapMarkup(wxml)
})

test('身份检查未取得权限快照时停在可恢复错误，不伪装成新商家', () => {
  const { page, requests, roleCallbacks } = loadPage({ roleSnapshotReady: false })
  page.onLoad()
  roleCallbacks[0]({ role: 'player', permission: {} })

  assert.equal(requests.length, 0, '身份事实缺失时不得继续推导为可申请')
  assert.equal(page.data.bootstrapState, 'error')
  assert.match(page.data.bootstrapError, /申请资格/)

  page.retryBootstrap()
  assert.equal(roleCallbacks.length, 2)
  assert.equal(page.data.bootstrapState, 'checking-role')
})

test('资格与申请检查在途时，同步连点不会生成并发请求或反序覆盖', () => {
  const { page, requests, roleCallbacks } = loadPage()
  page.onLoad()
  page.retryBootstrap()
  page.retryBootstrap()
  assert.equal(roleCallbacks.length, 1, '资格检查在途只能保留一个航班')

  roleCallbacks[0]({ role: 'player', permission: { canCreateTheme: true }, ownedClubs: [] })
  assert.equal(requests.length, 1)
  page.retryBootstrap()
  assert.equal(roleCallbacks.length, 1, '既有申请检查在途也不得再开资格航班')
  assert.equal(requests.length, 1)
})

test('重试或离页后，上一航班的迟到回调不能覆盖当前状态', () => {
  const { page, requests, roleCallbacks } = loadPage()
  page.onLoad()
  roleCallbacks[0]({ role: 'player', permission: { canCreateTheme: true }, ownedClubs: [] })
  requests[0].fail({ code: '503', msg: '第一次检查失败' })

  page.retryBootstrap()
  roleCallbacks[1]({ role: 'player', permission: { canCreateTheme: true }, ownedClubs: [] })
  assert.equal(page.data.bootstrapState, 'checking-application')

  requests[0].success({ code: '200', data: { name: '过期商家', status: 0 } })
  assert.equal(page.data.bootstrapState, 'checking-application', '旧航班成功不得覆盖重试中的检查')
  assert.equal(page.data.apply, null)

  page.onUnload()
  requests[1].success({ code: '200', applicationState: 'NONE' })
  assert.equal(page.data.bootstrapState, 'checking-application', '离页后的迟到回调不得继续写页面状态')
})

test('既有申请检查失败可原位重试，重试全程保留草稿', () => {
  const { page, requests, roleCallbacks } = loadPage()
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  page.data.name = '河畔咖啡'
  page.data.phone = '13800138000'

  page.onLoad()
  roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
  requests[0].success({ code: '500', msg: '申请状态服务暂不可用' })

  assert.equal(page.data.bootstrapState, 'error')
  assert.equal(page.data.bootstrapError, '申请状态服务暂不可用')
  assert.equal(page.data.name, '河畔咖啡')
  assert.match(wxml, /bootstrapState === 'error'/)
  assert.match(wxml, /bind:primary="retryBootstrap"/)

  page.retryBootstrap()
  assert.equal(page.data.bootstrapState, 'checking-role')
  assert.equal(roleCallbacks.length, 2)
  assert.equal(page.data.name, '河畔咖啡')
  roleCallbacks[1]({ role: 'player', permission: {}, ownedClubs: [] })
  requests[1].success({ code: '200', applicationState: 'NONE' })

  assert.equal(page.data.bootstrapState, 'ready', '无既有申请是可创建态，不是故障态')
  assert.equal(page.data.name, '河畔咖啡')
  assert.equal(page.data.phone, '13800138000')
})

test('既有申请检查断网时给出网络恢复态', () => {
  const { page, requests, roleCallbacks } = loadPage()
  page.onLoad()
  roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
  requests[0].fail({ errMsg: 'request:fail timeout' })

  assert.equal(page.data.bootstrapState, 'error')
  assert.equal(page.data.bootstrapErrorKind, 'network')
  assert.match(page.data.bootstrapError, /网络/)
})

test('既有申请 HTTP body 失败保留服务原因，不冒充设备断网', () => {
  const { page, requests, roleCallbacks } = loadPage()
  page.onLoad()
  roleCallbacks[0]({ role: 'player', permission: { canCreateTheme: true }, ownedClubs: [] })
  // request-client 对 HTTP 非 200 只把 res.data 交给 fail，不保留 statusCode。
  requests[0].fail({ msg: '网络服务暂不可用' })

  assert.equal(page.data.bootstrapState, 'error')
  assert.equal(page.data.bootstrapErrorKind, 'error')
  assert.equal(page.data.bootstrapError, '网络服务暂不可用')
})

test('最终提交在途与业务失败都原位可见，草稿不丢且可重试', () => {
  const { page, requests, modals } = loadPage()
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  Object.assign(page.data, {
    bootstrapState: 'ready',
    mode: 'form',
    step: 4,
    canNext: true,
    identityRegistered: true,
    name: '河畔咖啡',
    phone: '13800138000',
    address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00',
    businessLicense: 'https://img.example/license.jpg',
  })

  page.submit()
  assert.equal(page.data.submitting, true)
  assert.equal(page.data.submitError, '')
  assert.match(wxml, /loading="\{\{submitting\}\}"/)
  assert.match(wxml, /step===4\s*\?\s*\(submitting \? '提交中…' : '提交申请'\)/)
  requests[0].success({ code: '500', msg: '审核服务暂不可用' })

  assert.equal(page.data.submitting, false)
  assert.equal(page.data.submitError, '审核服务暂不可用')
  assert.equal(page.data.step, 4)
  assert.equal(page.data.name, '河畔咖啡')
  assert.equal(page.data.businessLicense, 'https://img.example/license.jpg')
  assert.equal(modals.length, 0, '提交错误应留在当前步骤，不用弹窗打断草稿')
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{submitError && step===4\}\}"/)
  assert.match(wxml, /bind:action="retrySubmit"/)

  page.retrySubmit()
  assert.equal(requests.length, 2)
  assert.equal(page.data.submitting, true)
  assert.equal(page.data.submitError, '')
  assert.equal(page.data.name, '河畔咖啡')
})

test('状态优化不改变商家入驻 API、JSON header 与既有字段全集', () => {
  const { page, requests } = loadPage()
  Object.assign(page.data, {
    bootstrapState: 'ready', mode: 'form', step: 4, canNext: true,
    identityRegistered: true,
    name: '河畔咖啡', preference: '餐饮', phone: '13800138000', address: '滨江路 8 号',
    locationLat: 31.2, locationLng: 121.4, businessTime: '周一至周日 10:00-22:00',
    description: '江边咖啡', businessLicense: 'license.jpg', derivatives: ['a.jpg', 'b.jpg'],
  })

  page.submit()
  const request = requests[0]
  const payload = JSON.parse(request.data)
  assert.equal(request.url, '/api/merchant/merchant_registration')
  assert.equal(request.method, 'POST')
  assert.equal(request.header['Content-Type'], 'application/json')
  assert.deepEqual(Object.keys(payload).sort(), [
    'address', 'businessLicense', 'businessTime', 'derivatives', 'description', 'id',
    'locationLat', 'locationLng', 'name', 'phone', 'preference',
  ].sort())
  assert.equal(payload.derivatives, 'a.jpg,b.jpg')
})

test('主理人可以提交待审申请，并完整展示不同状态的待移交俱乐部', () => {
  const initial = loadPage({ clubLeader: true })
  initial.page.onLoad()
  initial.roleCallbacks[0]({
    role: 'club', isClubLeader: true, permission: {},
    ownedClubs: [
      { id: 11, name: '已生效俱乐部', status: 1 },
      { id: 12, name: '待审核俱乐部', status: 0 },
      { id: 13, name: '被驳回俱乐部', status: 2 },
    ],
  })
  assert.equal(initial.requests.length, 1, '主理人仍应检查既有商家申请')
  initial.requests[0].success({ code: 200, applicationState: 'NONE' })
  assert.equal(initial.page.data.bootstrapState, 'ready')
  assert.equal(initial.page.data.mode, 'form')
  assert.equal(initial.page.data.introMode, false, '有待处置俱乐部时应直接展示表单与移交说明')
  assert.deepEqual(initial.page.data.ownedClubs.map((club) => [club.id, club.statusText, club.canTransfer]), [
    [11, '已生效，须先移交', true],
    [12, '待审核，暂不能移交', false],
    [13, '审核未通过，需先处置', false],
  ])
  assert.equal(initial.modals.length, 0)

  initial.page.openClubGovernance({ currentTarget: { dataset: { clubId: 12 } } })
  assert.equal(initial.navigation.length, 0, '未生效俱乐部不得开放治理权限')
  initial.page.openClubGovernance({ currentTarget: { dataset: { clubId: 11 } } })
  assert.deepEqual(initial.navigation, ['/pages/club/governance/index?clubId=11'])

  const submit = loadPage({ clubLeader: true })
  Object.assign(submit.page.data, {
    bootstrapState: 'ready', mode: 'form', step: 4, canNext: true,
    identityRegistered: true,
    name: '河畔咖啡', phone: '13800138000', address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00', businessLicense: 'license.jpg',
  })
  submit.page.submit()
  assert.equal(submit.requests.length, 1, '主理人可以提交申请等待审核与身份条件核验')
  assert.equal(submit.requests[0].url, '/api/merchant/merchant_registration')
  assert.equal(submit.modals.length, 0)
})

test('主理人能力存在但没有 owned club 时不虚构移交对象', () => {
  const { page, requests, roleCallbacks } = loadPage({ clubLeader: true })
  page.onLoad()
  roleCallbacks[0]({ role: 'club', isClubLeader: true, permission: {}, ownedClubs: [] })
  requests[0].success({ code: 200, applicationState: 'NONE' })

  assert.equal(page.data.bootstrapState, 'ready')
  assert.deepEqual(page.data.ownedClubs, [])
  assert.equal(page.data.hasOwnedClubs, false)
})

test('owned club 返回畸形时整体失败，不把缺失对象伪装成零 club', () => {
  const { page, requests, roleCallbacks } = loadPage({ clubLeader: true })
  page.onLoad()
  roleCallbacks[0]({ role: 'club', isClubLeader: true, permission: {}, ownedClubs: [{ name: '缺少ID' }] })

  assert.equal(requests.length, 0)
  assert.equal(page.data.bootstrapState, 'error')
  assert.match(page.data.bootstrapError, /俱乐部信息/)
})

test('角色快照缺少 ownedClubs 字段时失败关闭，不从 getter 回退成零 club', () => {
  const { page, requests, roleCallbacks } = loadPage({ clubLeader: true })
  page.onLoad()
  roleCallbacks[0]({ role: 'club', isClubLeader: true, permission: {} })

  assert.equal(requests.length, 0)
  assert.equal(page.data.bootstrapState, 'error')
  assert.match(page.data.bootstrapError, /俱乐部信息/)
})

test('ownedClubs 显式 null 与布尔状态都失败关闭，不回退成零 club 或已生效', () => {
  for (const ownedClubs of [null, [{ id: 11, name: '脏状态', status: true }]]) {
    const { page, requests, roleCallbacks } = loadPage({ clubLeader: true })
    page.onLoad()
    roleCallbacks[0]({ role: 'club', isClubLeader: true, permission: {}, ownedClubs })
    assert.equal(requests.length, 0)
    assert.equal(page.data.bootstrapState, 'error')
    assert.match(page.data.bootstrapError, /俱乐部信息/)
  }
})

test('既有申请只接受严格对象合同，数组、布尔值和布尔状态都失败关闭', () => {
  for (const data of [[], true, { id: 8, name: '脏申请', status: true, accountStatus: true }]) {
    const { page, requests, roleCallbacks } = loadPage()
    page.onLoad()
    roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
    requests[0].success({ code: 200, data })
    assert.equal(page.data.bootstrapState, 'error')
    assert.equal(page.data.apply, null)
  }
})

test('从治理页返回会重读真实身份与申请，且同账号未提交草稿不丢', () => {
  const harness = loadPage({ clubLeader: true })
  const { page, requests, roleCallbacks } = harness
  page.onLoad()
  page.onShow()
  roleCallbacks[0]({
    role: 'club', isClubLeader: true, permission: {},
    ownedClubs: [{ id: 11, name: '待移交', status: 1 }],
  })
  requests[0].success({ code: 200, applicationState: 'NONE' })
  page.data.name = '保留的咖啡店草稿'

  page.onShow()
  assert.equal(roleCallbacks.length, 2, '再次显示页面必须重读服务端角色事实')
  assert.equal(harness.roleClearCount(), 1, '返回后必须丢弃旧角色缓存，失败时不得回落到移交前快照')
  roleCallbacks[1]({ role: 'player', isClubLeader: false, permission: {}, ownedClubs: [] })
  assert.equal(requests.length, 2, '角色刷新后必须重读申请事实')
  requests[1].success({ code: 200, applicationState: 'NONE' })

  assert.equal(page.data.name, '保留的咖啡店草稿')
  assert.deepEqual(page.data.ownedClubs, [])
  assert.equal(page.data.hasOwnedClubs, false)
})

test('驳回后重填时 onShow 回读申请事实不会覆盖未提交草稿', () => {
  const harness = loadPage()
  const { page, requests, roleCallbacks } = harness
  page.onLoad()
  page.onShow()
  roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
  requests[0].success({ code: 200, data: { id: 8, name: '旧店名', status: 2, accountStatus: 0 } })
  page.onReapply()
  page.data.name = '正在修改的新店名'
  page.data.address = '新地址'

  page.onShow()
  roleCallbacks[1]({ role: 'player', permission: {}, ownedClubs: [] })
  requests[1].success({ code: 200, data: { id: 8, name: '旧店名', address: '旧地址', status: 2, accountStatus: 0 } })

  assert.equal(page.data.mode, 'form')
  assert.equal(page.data.name, '正在修改的新店名')
  assert.equal(page.data.address, '新地址')
  assert.equal(page.data.apply.id, 8, '仍应保存最新服务端申请事实供重新提交使用')
})

test('返回时服务端已激活或停用则真实状态优先，不让旧重填草稿遮住状态页', () => {
  for (const accountStatus of [1, 2]) {
    const harness = loadPage()
    const { page, requests, roleCallbacks } = harness
    page.onLoad()
    page.onShow()
    roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
    requests[0].success({ code: 200, data: { id: 8, name: '旧店名', status: 2, accountStatus: 0 } })
    page.onReapply()
    page.data.step = 4
    page.data.name = '未提交草稿'

    page.onShow()
    roleCallbacks[1]({ role: 'player', permission: {}, ownedClubs: [] })
    requests[1].success({ code: 200, data: { id: 8, name: '最新门店', status: 1, accountStatus } })

    assert.equal(page.data.mode, 'status')
    assert.equal(page.data.apply.statusLabel, accountStatus === 1 ? '已生效' : '账号已停用')
    assert.equal(page.data.name, '最新门店')
  }
})

test('切换账号会清除旧账号草稿，迟到回调不能写入新账号', () => {
  const harness = loadPage({ userId: 9 })
  harness.page.onLoad()
  harness.page.onShow()
  harness.roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
  harness.requests[0].success({ code: 200, applicationState: 'NONE' })
  harness.page.data.name = 'A 账号草稿'

  harness.switchIdentity(10, 'token-b')
  harness.page.onShow()
  assert.equal(harness.page.data.name, '', '新账号不得继承旧账号表单')
  harness.roleCallbacks[1]({ role: 'player', permission: {}, ownedClubs: [] })
  harness.requests[1].success({ code: 200, applicationState: 'NONE' })
  harness.requests[0].success({ code: 200, data: { id: 1, name: 'A 账号旧申请', status: 0 } })

  assert.equal(harness.page.data.mode, 'form')
  assert.equal(harness.page.data.apply, null)
})

test('R9-35 停用账号只读平台停用原因 disableReason，未填写时明确说明', () => {
  // 负控（审查 §4 R9-35 复现路径）：先驳回填「执照模糊」，残留 reson 绝不能当停用原因展示
  const legacy = loadPage()
  legacy.page.onLoad()
  legacy.roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
  legacy.requests[0].success({
    code: 200,
    data: { id: 9, name: '停用门店', status: 1, accountStatus: 2, reson: '执照模糊', disableReason: '' },
  })
  assert.equal(legacy.page.data.apply.statusLabel, '账号已停用')
  assert.doesNotMatch(legacy.page.data.apply.statusText, /执照模糊/)
  assert.doesNotMatch(legacy.page.data.apply.statusText, /停用原因：/)
  assert.match(legacy.page.data.apply.statusText, /平台暂未填写停用原因/)

  const cases = [
    { disableReason: '平台风控核查', expect: /停用原因：平台风控核查/ },
    { disableReason: '', expect: /平台暂未填写停用原因/ },
  ]
  for (const item of cases) {
    const { page, requests, roleCallbacks } = loadPage()
    page.onLoad()
    roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
    requests[0].success({
      code: 200,
      data: { id: 8, name: '停用门店', status: 1, accountStatus: 2, disableReason: item.disableReason },
    })
    assert.equal(page.data.mode, 'status')
    assert.equal(page.data.apply.statusLabel, '账号已停用')
    assert.match(page.data.apply.statusText, item.expect)
  }

  // 负控：已生效门店即使残留旧驳回原因也不展示停用原因
  const active = loadPage()
  active.page.onLoad()
  active.roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
  active.requests[0].success({ code: 200, data: { id: 10, name: '正常门店', status: 1, accountStatus: 1, reson: '旧原因' } })
  assert.doesNotMatch(active.page.data.apply.statusText, /停用原因|旧原因/)
})

test('已审核但未激活与停用账号不误称已成为商家', () => {
  for (const accountStatus of [0, 2]) {
    const { page, requests, roleCallbacks } = loadPage()
    page.onLoad()
    roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
    requests[0].success({
      code: 200,
      data: { id: 8, name: '状态门店', status: 1, accountStatus },
    })
    assert.notEqual(page.data.apply.statusLabel, '已生效')
    assert.notEqual(page.data.apply.statusText, '已成为城瘾商家')
  }

  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  assert.match(wxml, /apply\.statusText/)
  assert.doesNotMatch(wxml, /apply\.status===1[^\n]*恭喜！你已成为城瘾商家/)
  assert.match(wxml, /ownedClubs/)
  assert.match(wxml, /openClubGovernance/)
  assert.match(wxml, /class="club-transfer-action"[\s\S]*data-club-id="\{\{item\.id\}\}"[\s\S]*bindtap="openClubGovernance"/,
    '治理入口必须把 clubId 和点击事件绑在原生 wrapper，不能依赖 cy-btn 自定义事件转发 dataset')
})

test('最终提交断网与业务失败使用同一个可恢复错误缝隙', () => {
  const { page, requests } = loadPage()
  Object.assign(page.data, {
    bootstrapState: 'ready', mode: 'form', step: 4, canNext: true,
    identityRegistered: true,
    name: '河畔咖啡', phone: '13800138000', address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00', businessLicense: 'license.jpg',
  })
  page.submit()
  requests[0].fail({ errMsg: 'request:fail timeout' })

  assert.equal(page.data.submitting, false)
  assert.match(page.data.submitError, /网络/)
  assert.equal(page.data.step, 4)
  assert.equal(page.data.address, '滨江路 8 号')
})

test('提交回调绑定发起账号与当时快照，切号后的迟到成功或失败都不能写新账号', () => {
  for (const outcome of ['success', 'fail']) {
    const harness = loadPage({ userId: 9 })
    const { page, requests, roleCallbacks } = harness
    page.onLoad()
    page.onShow()
    roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
    requests[0].success({ code: 200, applicationState: 'NONE' })
    Object.assign(page.data, {
      mode: 'form', step: 4, name: 'A 门店', phone: '13800138000',
      address: 'A 地址', businessTime: '周一至周日 10:00-22:00', businessLicense: 'a.jpg',
      // RUN-52:实名登记是入驻单之前的一发独立写。本契约测的是「入驻单回调」绑账号,
      // 所以夹具直接给一个已登记的人,别让实名那一发插到请求队列前面。
      identityRegistered: true,
    })
    page.submit()
    const oldSubmit = requests[1]

    harness.switchIdentity(10, 'token-b')
    page.onShow()
    roleCallbacks[1]({ role: 'player', permission: {}, ownedClubs: [] })
    requests[2].success({ code: 200, applicationState: 'NONE' })
    page.data.name = 'B 未提交草稿'
    if (outcome === 'success') oldSubmit.success({ code: 200 })
    else oldSubmit.fail({ errMsg: 'request:fail timeout' })

    assert.equal(page.data.name, 'B 未提交草稿')
    assert.equal(page.data.step, 1)
    assert.equal(page.data.submissionReceipt, null)
    assert.equal(page.data.submitError, '')
  }
})

test('提交成功回执使用请求快照，不读取回包时可能已变化的 page.data', () => {
  const { page, requests } = loadPage()
  Object.assign(page.data, {
    bootstrapState: 'ready', mode: 'form', step: 4, name: '提交时门店', phone: '13800138000',
    address: '地址', businessTime: '周一至周日 10:00-22:00', businessLicense: 'a.jpg',
    // RUN-52:同上,已登记的人直接发入驻单,receipt 断言才落在这一发上。
    identityRegistered: true,
  })
  page.submit()
  page.data.name = '回包前被改动的值'
  requests[0].success({ code: 200 })
  assert.equal(page.data.submissionReceipt.name, '提交时门店')
  assert.equal(page.data.submissionReceipt.phone, '13800138000')
})

test('位置与图片选择回调绑定发起账号，切号后不把 A 的结果写进 B 草稿', () => {
  const harness = loadPage({ userId: 9 })
  const { page, roleCallbacks, requests, imageCallbacks, locationRequests, modals } = harness
  page.onLoad()
  page.onShow()
  roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
  requests[0].success({ code: 200, applicationState: 'NONE' })
  page.uploadLicense()
  page.addDerivative()
  page.openLocationPicker()
  page.chooseLocation()

  harness.switchIdentity(10, 'token-b')
  page.onShow()
  roleCallbacks[1]({ role: 'player', permission: {}, ownedClubs: [] })
  requests[1].success({ code: 200, applicationState: 'NONE' })
  imageCallbacks[0](['a-license.jpg'])
  imageCallbacks[1](['a-brand.jpg'])
  locationRequests[0].success({ address: 'A 地址', latitude: 31.2, longitude: 121.4 })
  modals[0].success({ confirm: true })

  assert.equal(page.data.businessLicense, '')
  assert.equal(page.data.derivatives.length, 0)
  assert.equal(page.data.address, '')
  assert.equal(page.data.locationLat, null)
  assert.equal(locationRequests.length, 1, 'A 账号打开地图确认框的迟到回调不得替 B 账号启动位置选择')
})

test('同账号从原生位置选择返回触发 onShow 后，选择结果仍可落入原草稿', () => {
  const harness = loadPage({ userId: 9 })
  const { page, roleCallbacks, requests, locationRequests } = harness
  page.onLoad()
  page.onShow()
  roleCallbacks[0]({ role: 'player', permission: {}, ownedClubs: [] })
  requests[0].success({ code: 200, applicationState: 'NONE' })
  page.openLocationPicker()

  page.onShow()
  roleCallbacks[1]({ role: 'player', permission: {}, ownedClubs: [] })
  requests[1].success({ code: 200, applicationState: 'NONE' })
  locationRequests[0].success({ address: '同账号地址', latitude: 31.2, longitude: 121.4 })

  assert.equal(page.data.address, '同账号地址')
  assert.equal(page.data.locationLat, 31.2)
})

test('最终提交的 legacy 重登失败不误报设备断网', () => {
  const { page, requests } = loadPage()
  Object.assign(page.data, {
    bootstrapState: 'ready', mode: 'form', step: 4, canNext: true,
    identityRegistered: true,
    name: '河畔咖啡', phone: '13800138000', address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00', businessLicense: 'license.jpg',
  })
  page.submit()
  requests[0].fail({ code: 2, msg: '网络登录服务暂不可用' })

  assert.equal(page.data.submitErrorKind, 'data')
  assert.equal(page.data.submitError, '网络登录服务暂不可用')
})

test('提交在途时锁住重复提交、上一步与顶栏返回', () => {
  const { page, requests, navigation } = loadPage()
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  Object.assign(page.data, {
    bootstrapState: 'ready', mode: 'form', step: 4, canNext: true,
    identityRegistered: true,
    name: '河畔咖啡', phone: '13800138000', address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00', businessLicense: 'license.jpg',
  })

  page.submit()
  page.onNext()
  page.onBack()
  page.onHeaderBack()

  assert.equal(requests.length, 1, '提交在途的连点不得生成第二份申请')
  assert.equal(page.data.step, 4, '提交在途不得退回可编辑步骤')
  assert.deepEqual(navigation, [], '提交在途不得退出并接收迟到回调')
  assert.doesNotMatch(wxml, /class="wizard-secondary"/, '返回操作已上移到独立顶栏，不得在底栏重复出现')
  assert.match(wxml, /loading="\{\{submitting\}\}"/)
})

test('提交成功留下持久可读回执，并保留再次查看审核进度的路径', () => {
  const { page, requests, modals } = loadPage()
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  Object.assign(page.data, {
    bootstrapState: 'ready', mode: 'form', step: 4, canNext: true,
    identityRegistered: true,
    name: '河畔咖啡', phone: '13800138000', address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00', businessLicense: 'license.jpg',
  })

  page.submit()
  requests[0].success({ code: '200', msg: '更新成功' })

  assert.equal(page.data.step, 5)
  assert.equal(page.data.mode, 'form')
  assert.deepEqual(
    JSON.parse(JSON.stringify(page.data.submissionReceipt)),
    { name: '河畔咖啡', phone: '13800138000' },
  )
  assert.equal(page.data.submitting, false)
  assert.equal(page.data.submitError, '')
  assert.equal(modals.length, 0)
  assert.match(wxml, /class="success"[^>]*aria-role="status"[^>]*aria-live="polite"/)
  assert.match(wxml, /submissionReceipt\.name/)
  assert.match(wxml, /submissionReceipt\.phone/)
  assert.match(wxml, /可再次进入“商家入驻”查看审核进度/)
})

test('商家申请的进度、营业日、图片与动态主操作满足读屏和 88rpx 契约', () => {
  assertAccessibleControls(
    fs.readFileSync(WXML_PATH, 'utf8'),
    fs.readFileSync(WXSS_PATH, 'utf8'),
  )
})

test('负控：触控目标或无障碍语义回退时契约确实变红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const wxss = fs.readFileSync(WXSS_PATH, 'utf8')
  const smallTarget = wxss.replace(/(\.hp-day\s*\{[^}]*?)(?:height|min-height):\s*88rpx\b/s, '$1height: 72rpx')
  const crampedRow = wxss.replace('repeat(4, minmax(88rpx, 1fr))', 'repeat(7, minmax(88rpx, 1fr))')
  const unnamedAdd = wxml.replace(' aria-role="button" aria-label="添加品牌形象图"', '')
  const failOpen = wxml.replace('<block wx:elif="{{bootstrapState === \'ready\'}}">', '<block wx:else>')
  assert.ok(smallTarget !== wxss, '负控锚点失效：营业日尚未使用 88rpx')
  assert.ok(crampedRow !== wxss, '负控锚点失效：营业日间距尚未收窄')
  assert.ok(unnamedAdd !== wxml, '负控锚点失效：图片添加入口尚未接入无障碍名称')
  assert.ok(failOpen !== wxml, '负控锚点失效：正文尚未由 ready 显式放行')
  assert.throws(() => assertAccessibleControls(wxml, smallTarget), /不得小于 88rpx/)
  assert.throws(() => assertAccessibleControls(wxml, crampedRow), /未达到 88rpx 宽度/)
  assert.throws(() => assertAccessibleControls(unnamedAdd, wxss), /可读按钮名称/)
  assert.throws(() => assertBootstrapMarkup(failOpen), /显式 ready/)
})

test('负控：移除 epoch 防线后，迟到回调契约确实变红', () => {
  const source = fs.readFileSync(JS_PATH, 'utf8')
  const withoutEpoch = source.replace(/\s*if \(bootstrapEpoch !== that\._bootstrapEpoch \|\| identityKey !== currentIdentityKey\(\)\) return;/g, '')
  assert.ok(withoutEpoch !== source, '负控锚点失效：bootstrap 尚未接入 epoch 防线')

  assert.throws(() => {
    const { page, requests, roleCallbacks } = loadPage({ source: withoutEpoch })
    page.onLoad()
    roleCallbacks[0]({ role: 'player', permission: { canCreateTheme: true }, ownedClubs: [] })
    requests[0].fail({ code: '503', msg: '第一次检查失败' })
    page.retryBootstrap()
    roleCallbacks[1]({ role: 'player', permission: { canCreateTheme: true }, ownedClubs: [] })
    requests[0].success({ code: '200', data: { name: '过期商家', status: 0 } })
    assert.equal(page.data.bootstrapState, 'checking-application', '旧航班成功不得覆盖重试中的检查')
  }, /旧航班成功不得覆盖/)
})

// ===== RUN-52 经营者实名:第 4 步闸与提交时序 =====
const ID_OK = '99000019491231019X' // GB11643 校验位自洽的测试号(只在校验用,不是真人)

test('走到第 4 步才查一次实名登记状态;已登记的经营者不必再填', () => {
  const { page, requests } = loadPage()
  page.onLoad()
  assert.equal(requests.length, 0, '停在前三步时不该多发这一发')
  page.refreshStep(4)
  assert.equal(requests[0].url, '/api/publisher/identity/status')
  page.refreshStep(3)
  page.refreshStep(4)
  assert.equal(requests.length, 1, '来回换步也不重复查状态')
  requests[0].success({ code: 200, data: { registered: true } })
  assert.equal(page.data.identityRegistered, true)
  Object.assign(page.data, {
    name: '河畔咖啡', phone: '13800138000', address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00', businessLicense: 'license.jpg',
  })
  page.validate()
  assert.equal(page.data.canNext, true, '已登记的人第 4 步不该因为缺实名点不动')
})

test('实名不齐不许提交;补齐后先落实名,成功之后才发入驻单且单里没有 PII', () => {
  const { page, requests } = loadPage()
  Object.assign(page.data, {
    bootstrapState: 'ready', mode: 'form', step: 4,
    name: '河畔咖啡', phone: '13800138000', address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00', businessLicense: 'license.jpg',
  })
  page.validate()
  assert.equal(page.data.canNext, false, '姓名/证件/单独同意三项不齐时「提交申请」必须不亮')
  page.submit()
  assert.equal(requests.length, 0, '没过实名校验一个请求都不许发出去')

  Object.assign(page.data, { realName: '王舟', idCard: ID_OK, identityConsented: true })
  page.validate()
  assert.equal(page.data.canNext, true)

  page.submit()
  assert.equal(requests.length, 1, '实名没落库之前不得把入驻单发出去(后端闸按这个顺序判)')
  assert.equal(requests[0].url, '/api/publisher/identity')
  const identity = JSON.parse(requests[0].data)
  assert.deepEqual(Object.keys(identity).sort(), ['consent', 'idCard', 'realName', 'source'])
  assert.equal(identity.source, 'merchant_apply')
  assert.equal(identity.idCard, ID_OK)

  requests[0].success({ code: 200, data: { registered: true } })
  assert.equal(page.data.identityRegistered, true)
  assert.equal(requests.length, 2)
  assert.equal(requests[1].url, '/api/merchant/merchant_registration')
  assert.doesNotMatch(requests[1].data, /realName|idCard/,
    '实名两格不许混进入驻单:merchant_registration 带 @Log,参数会明文抄进 sys_oper_log')
  requests[1].success({ code: '200', msg: '更新成功' })
  assert.equal(page.data.step, 5)
})

test('实名登记失败停在第 4 步:入驻单不许跟着发出去', () => {
  const { page, requests } = loadPage()
  Object.assign(page.data, {
    bootstrapState: 'ready', mode: 'form', step: 4, canNext: true,
    name: '河畔咖啡', phone: '13800138000', address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00', businessLicense: 'license.jpg',
    realName: '王舟', idCard: ID_OK, identityConsented: true,
  })
  page.submit()
  requests[0].success({ code: 500, msg: '该证件已绑定其他账号' })
  assert.equal(requests.length, 1, '实名没登记成功就不许再发入驻单')
  assert.equal(page.data.submitting, false)
  assert.equal(page.data.submitError, '该证件已绑定其他账号')
  assert.equal(page.data.submitErrorKind, 'data')
  assert.equal(page.data.identityRegistered, false)
  assert.equal(page.data.step, 4, '报错留在原地,草稿不丢')
  assert.equal(page.data.name, '河畔咖啡')
})
