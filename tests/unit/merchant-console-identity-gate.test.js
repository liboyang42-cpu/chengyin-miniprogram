// 2026-09-16 商家页去闸:工作台的「登录后查看商家工作台 / 正在确认商家身份 / 没有商家身份」
// 整屏闸全部删除。新契约:
//   未登录 → 静默 ensureSession 后自动加载;失败 → 页内 cy-inline-error + 重试;
//   401 → 静默重登一次;无商家身份 → 静默 switchTab 回会员中心。
// 负控:把整屏闸(consoleState + rv-gate)加回去必须判红。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_PATH = path.join(ROOT, 'pages/merchant/index/index.js')
const WXML_PATH = path.join(ROOT, 'pages/merchant/index/index.wxml')

let pageConfig
let requests
let userId
let authorization
let switched
let toasts
let sessionResults

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44 },
  getUserID: () => userId,
  getAuthorization: () => authorization,
  getSession: () => ({
    clearSession() {
      userId = 0
      authorization = ''
    },
  }),
  // 成功即等价于 session-store 落地(真实 session-manager 会写 user_id)。
  getSessionManager: () => ({
    ensureSession: () => {
      const result = sessionResults.length ? sessionResults.shift() : { ok: true }
      if (result.ok && !userId) userId = 9
      return Promise.resolve(result)
    },
  }),
  getUserRole: () => '',
  getUserType: () => 1,
  setUserRole() {},
  setUserType() {},
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 44 }),
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
  showToast: (opts) => { toasts.push(opts) },
  showLoading() {},
  hideLoading() {},
  switchTab: (opts) => { switched.push(opts.url) },
  navigateTo: (opts) => { switched.push(opts.url) },
  reLaunch: (opts) => { switched.push(opts.url) },
  stopPullDownRefresh() {},
  setNavigationBarColor() {},
  setBackgroundColor() {},
  setNavigationBarTitle() {},
}

global.Page = (config) => { pageConfig = config }

function loadPage() {
  delete require.cache[require.resolve(PAGE_PATH)]
  require(PAGE_PATH)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

function merchantAccess(id = 3, name = 'A店') {
  return {
    code: 200,
    data: {
      active: true,
      merchant: { id, name },
      roleCode: 'MERCHANT_OWNER',
      permissions: [
        'merchant:basic:read', 'merchant:profile:write', 'merchant:project:manage',
        'merchant:finance:read', 'merchant:verify', 'merchant:verify:record:read',
      ],
    },
  }
}

function requested(url) {
  return requests.filter((request) => request.url === url)
}

beforeEach(() => {
  pageConfig = null
  requests = []
  switched = []
  toasts = []
  sessionResults = []
  userId = 0
  authorization = 'old-token'
})

test('未登录不再整屏拦:静默登录成功后自动拉身份并渲染工作台', async () => {
  userId = 0
  const page = loadPage()
  page.onShow()
  assert.equal(page.data.consoleError, '', '静默登录期间不先摆错误态')

  await flush()
  const identityRequest = requested('/api/merchant/access/me')[0]
  assert.ok(identityRequest, '静默登录成功后必须自动继续身份确认')
  identityRequest.success(merchantAccess())
  assert.equal(page.data.consoleError, '')
  assert.equal(page.data.merchantAccess.active, true)
  assert.deepEqual(switched, [], '正常商家不得被整屏闸赶走')
})

test('静默登录失败只落页内内联错误,不发工作台请求', async () => {
  userId = 0
  sessionResults.push({ ok: false, reason: 'networkFail' })
  const page = loadPage()
  page.onShow()
  await flush()

  assert.equal(page.data.consoleError, '登录失败，请重试')
  assert.equal(requests.length, 0, '登录没成功不该发工作台请求')
  assert.deepEqual(switched, [])
})

test('登录失败后点重新加载:再走一次静默登录并正常加载', async () => {
  userId = 0
  sessionResults.push({ ok: false })
  const page = loadPage()
  page.onShow()
  await flush()
  assert.ok(page.data.consoleError)

  page.reloadConsole()
  await flush()
  assert.equal(page.data.consoleError, '')
  userId = 9
  await flush()
  assert.ok(requested('/api/merchant/access/me').length, '重试必须真的再走一次身份链路')
})

test('身份接口 401 静默重登后自动重拉,不落整屏去登录', async () => {
  userId = 9
  const page = loadPage()
  page.onShow()
  const identityRequest = requested('/api/merchant/access/me')[0]
  assert.ok(identityRequest)

  // request-client 静默重登失败时会先清会话,再把 401 作为第二参数透传。
  userId = 0
  identityRequest.fail({ code: 401, msg: '登录状态失效' }, 401)
  await flush()

  userId = 9
  await flush()
  const retried = requested('/api/merchant/access/me').at(-1)
  assert.ok(retried && retried !== identityRequest, '重登成功后必须自动重拉身份')
  retried.success(merchantAccess())
  assert.equal(page.data.merchantAccess.active, true)
  assert.equal(page.data.consoleError, '')
})

test('重登仍失败时只落页内错误,不再无限重登', async () => {
  userId = 9
  const page = loadPage()
  page.onShow()
  const identityRequest = requested('/api/merchant/access/me')[0]

  userId = 0
  sessionResults.push({ ok: false })
  identityRequest.fail({ code: 401, msg: '登录状态失效' }, 401)
  await flush()

  assert.equal(page.data.consoleError, '登录失败，请重试')
  assert.equal(requested('/api/merchant/access/me').length, 1, '重登失败不得再发身份请求')
})

test('身份接口业务 code 401/2 也走静默重登,并清掉旧商家敏感快照', async () => {
  for (const code of [401, 2]) {
    userId = 9
    authorization = 'old-token'
    requests = []
    switched = []
    sessionResults = []
    const page = loadPage()
    page._merchantScopeKey = '9:3'
    page.data.displayName = '旧门店'
    page.data.dashboardData = { revenue: '999.00', pendingOrders: 8 }
    page.onShow()

    sessionResults.push({ ok: false })
    requested('/api/merchant/access/me')[0].success({ code, msg: '登录状态失效' })
    await flush()

    assert.equal(page.data.consoleError, '登录失败，请重试', `业务 code=${code} 登录没成功要有页内出路`)
    assert.equal(page.data.displayName, '商家', `业务 code=${code} 必须清除旧门店名`)
    assert.equal(page.data.dashboardData.revenue, null, `业务 code=${code} 必须清除旧收入`)
  }
})

test('旧账号迟到的 401 不得把已经切换的新账号踢去重登', async () => {
  userId = 9
  const page = loadPage()
  page.onShow()
  const identityRequest = requested('/api/merchant/access/me')[0]

  userId = 10
  identityRequest.fail({ code: 401, msg: '旧账号登录状态失效' }, 401)
  await flush()

  assert.equal(page.data.consoleError, '')
  assert.equal(userId, 10)
  assert.equal(authorization, 'old-token')
  assert.deepEqual(switched, [])
})

test('身份接口返回非 200 落页内错误态,不退回空工作台', () => {
  userId = 9
  const page = loadPage()
  page.onShow()

  requested('/api/merchant/access/me')[0].success({ code: '500', msg: '商家身份没能确认' })
  assert.equal(page.data.consoleError, '商家身份没能确认')
})

test('身份接口超时/断网落成可重试的页内错误态', () => {
  userId = 9
  const page = loadPage()
  page.onShow()

  const identityRequest = requested('/api/merchant/access/me')[0]
  assert.equal(typeof identityRequest.fail, 'function', '身份请求必须有 fail 回调,否则超时会静默停在假空态')
  identityRequest.fail({ errMsg: 'request:fail timeout' })
  assert.equal(page.data.consoleError, '网络好像出了点小差')
})

test('重新加载会清掉页内错误并重走身份链路', () => {
  userId = 9
  const page = loadPage()
  page.onShow()
  requested('/api/merchant/access/me')[0].fail({})
  assert.ok(page.data.consoleError)

  requests.length = 0
  page.reloadConsole()

  assert.equal(page.data.consoleError, '')
  assert.ok(requested('/api/merchant/access/me').length, '重试必须真的再发一次请求')
})

test('无商家身份静默 switchTab 回会员中心,不摆整屏闸', () => {
  userId = 9
  requests = []
  switched = []
  const page = loadPage()
  page.onShow()
  requested('/api/merchant/access/me')[0].success({
    code: 200,
    data: { active: false, merchant: null, roleCode: '', applicationState: 'NONE', permissions: [] },
  })

  assert.deepEqual(switched, ['/pages/member/index/index'], 'NONE 必须静默回会员中心')
  assert.equal(page.data.consoleError, '')
  assert.equal(requests.length, 1, 'NONE 不得加载任何经营接口')
})

// 2026-09-17 拍板 #24:审核中/未通过/停用不再静默 switchTab,改页内状态 + 查看申请进度。
// 状态与原因一律以 /api/merchant/info 的申请行为准,不在前端拿枚举自己编文案。
test('入驻审核中/未通过/停用:页内显示状态与原因,不再跳走', () => {
  const cases = [
    ['PENDING', { status: 0, accountStatus: 1 }, '审核中', null],
    ['REJECTED', { status: 2, accountStatus: 1, reson: '营业执照模糊' }, '已驳回', '营业执照模糊'],
    ['DISABLED', { status: 1, accountStatus: 2, disableReason: '违规经营' }, '账号已停用', '违规经营'],
  ]
  for (const [applicationState, application, expectLabel, expectText] of cases) {
    userId = 9
    requests = []
    switched = []
    const page = loadPage()
    page.onShow()
    requested('/api/merchant/access/me')[0].success({
      code: 200,
      data: {
        active: false,
        merchant: { id: 7, name: '河畔咖啡' },
        roleCode: 'MERCHANT_OWNER',
        applicationState,
        permissions: [],
      },
    })

    assert.deepEqual(switched, [], `${applicationState} 不得跳走`)
    const info = requested('/api/merchant/info').at(-1)
    assert.ok(info, `${applicationState} 必须回读申请状态与原因`)
    info.success({ code: 200, data: Object.assign({ id: 7 }, application) })
    assert.equal(page.data.consoleStatus && page.data.consoleStatus.statusLabel, expectLabel)
    if (expectText) {
      assert.match(page.data.consoleStatus.statusText, new RegExp(expectText),
        `${applicationState} 的原因必须显示在页内`)
    }
    assert.equal(page.data.consoleError, '')
  }
})

test('状态卡在 wxml 里真的渲染了状态与「查看申请进度」入口', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  assert.match(wxml, /consoleStatus[\s\S]{0,400}?bindtap="goApplicationProgress"/,
    '状态卡必须带查看申请进度入口')
  assert.match(wxml, /查看申请进度/, '入口文案必须可见')
  assert.match(wxml, /statusText/, '原因必须来自状态投影,不能只写一个枚举名')
})

test('负控:拿掉申请状态分支后,停用商家会被静默踢回会员中心必须判红', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
  const anchor = "          if (access.applicationState && access.applicationState !== 'NONE') {"
  assert.ok(source.includes(anchor), '负控锚点失效')
  const mutated = source.replace(anchor, '          if (false) {')
  const tmp = path.join(ROOT, 'pages/merchant/index/.index.mutant.js')
  fs.writeFileSync(tmp, mutated)
  try {
    delete require.cache[require.resolve(tmp)]
    require(tmp)
    const page = Object.assign({}, pageConfig)
    page.data = JSON.parse(JSON.stringify(pageConfig.data))
    page.setData = function (patch) { Object.assign(this.data, patch) }
    userId = 9
    page.onShow()
    requested('/api/merchant/access/me').at(-1).success({
      code: 200,
      data: {
        active: false, merchant: { id: 7, name: '河畔咖啡' }, roleCode: 'MERCHANT_OWNER',
        applicationState: 'DISABLED', permissions: [],
      },
    })
    assert.deepEqual(switched, ['/pages/member/index/index'], '变异体必须回到旧的静默跳走')
    assert.throws(() => assert.deepEqual(switched, []), assert.AssertionError)
  } finally {
    fs.unlinkSync(tmp)
  }
})

test('停用 owner 缺少 merchant 摘要属于协议错误,不得静默放行或跳转', () => {
  userId = 9
  const page = loadPage()
  page.onShow()
  requested('/api/merchant/access/me')[0].success({
    code: 200,
    data: { active: false, applicationState: 'DISABLED', roleCode: 'MERCHANT_OWNER', merchant: null, permissions: [] },
  })

  assert.equal(page.data.consoleError, '经营身份没能确认，请重新检查')
  assert.deepEqual(switched, [])
})

test('旧账号迟到的停用状态不得把新账号踢去会员中心', () => {
  userId = 9
  const page = loadPage()
  page.onShow()
  const oldRequest = requested('/api/merchant/access/me')[0]

  userId = 10
  page.onShow()
  const currentRequest = requested('/api/merchant/access/me').at(-1)
  assert.notEqual(currentRequest, oldRequest)
  oldRequest.success({
    code: 200,
    data: {
      active: false, applicationState: 'DISABLED', roleCode: 'MERCHANT_OWNER', permissions: [],
      merchant: { id: 7, name: '旧账号门店' },
    },
  })

  assert.deepEqual(switched, [], '旧账号结论不得触发跳转')
  assert.equal(requested('/api/merchant/info').length, 0, '旧账号不得驱动新账号回读申请状态')
})

test('未登录商家深链不能在身份确认前把场景留在闸外', async () => {
  userId = 0
  sessionResults.push({ ok: false })
  const page = loadPage()
  page.onLoad({ scene: 'merchant-decor' })
  assert.ok(page.data.sceneCurrent, '负控前提：深链已装载场景')

  page.onShow()
  await flush()

  assert.equal(page.data.sceneCurrent, null)
})

test('核销员按权限只请求待办与动态，不请求看板，也不制造假错误', () => {
  userId = 9
  const page = loadPage()
  page.onShow()

  requested('/api/merchant/access/me')[0].success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店', logo: '/logo.png' },
      roleCode: 'MERCHANT_CHECKIN',
      permissions: ['merchant:basic:read', 'merchant:verify', 'merchant:verify:record:read'],
    },
  })

  const urls = requests.map((r) => r.url)
  assert.equal(urls.includes('/api/merchant/dashboard'), false)
  assert.equal(urls.includes('/api/merchant/info'), false,
    '核销员没有 PROFILE_WRITE，不应请求会返回 403 的店铺资料接口')
  assert.equal(urls.filter((url) => url === '/api/merchant/todo-summary').length, 1,
    '核销员有 VERIFY_RECORD_READ，待办接口已按权限放开')
  assert.equal(urls.filter((url) => url === '/api/merchant/events').length, 1,
    '核销员有 VERIFY_RECORD_READ，动态接口已按权限放开')
  assert.equal(page.data.dashboardLoading, false)
  assert.equal(page.data.dashboardError, '')
  assert.equal(page.data.todoLoading, true, '待办请求在途,loading 保持')
  assert.equal(page.data.todoError, false, '请求尚未失败,不许先造错误态')
  assert.equal(urls.includes('/api/registration/merchant/list'), false)
  assert.equal(urls.includes('/api/project/my'), false)
  assert.equal(urls.includes('/api/merchant/funnel'), false)
})

test('只有 basic 权限的店主不发三个聚合请求，待办保持未取到态而不是假空态', () => {
  userId = 11
  const page = loadPage()
  page.onShow()

  requested('/api/merchant/access/me')[0].success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 9, name: 'Owner 门店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:profile:write'],
    },
  })

  const urls = requests.map((r) => r.url)
  assert.equal(urls.includes('/api/merchant/dashboard'), false)
  assert.equal(urls.includes('/api/merchant/todo-summary'), false)
  assert.equal(urls.includes('/api/merchant/events'), false)
  assert.equal(page.data.todoError, true,
    '没权限取待办 ≠ 今日无待办:必须保持未取到态,卡面留空')
})

test('持读权限的员工岗位按权限码加载三个聚合，不再只给店主', () => {
  userId = 11
  const page = loadPage()
  page.onShow()

  requested('/api/merchant/access/me')[0].success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 9, name: '财务门店' },
      roleCode: 'MERCHANT_FINANCE',
      permissions: ['merchant:basic:read', 'merchant:finance:read', 'merchant:order:read',
        'merchant:verify:record:read'],
    },
  })

  const urls = requests.map((r) => r.url)
  assert.equal(urls.filter((url) => url === '/api/merchant/dashboard').length, 1)
  assert.equal(urls.filter((url) => url === '/api/merchant/todo-summary').length, 1)
  assert.equal(urls.filter((url) => url === '/api/merchant/events').length, 1)
})

test('营业状态写回只接受当前商家当前动作，逆序、切主体和卸载回调都失效', () => {
  userId = 11
  const page = loadPage()
  page._merchantScopeKey = '11:101'
  page.data.merchantAccess = { canWriteProfile: true }
  page.data.businessStatus = 1

  page.toggleBusiness()
  const first = requests[0]
  page.data.businessStatus = 0
  page.toggleBusiness()
  const second = requests[1]

  second.success({ code: 200 })
  first.success({ code: 200 })
  assert.equal(page.data.businessStatus, 1, '旧动作不得逆序覆盖最新营业状态')
  assert.equal(toasts.length, 1, '旧动作不得再弹成功回执')

  page.toggleBusiness()
  const oldScope = requests[2]
  page._merchantScopeKey = '22:202'
  oldScope.success({ code: 200 })
  assert.equal(page.data.businessStatus, 1, 'A 商家回调不得写进 B 商家页面')
  assert.equal(toasts.length, 1)

  page._merchantScopeKey = '22:202'
  page.toggleBusiness()
  const afterUnload = requests[3]
  page.onUnload()
  afterUnload.fail()
  assert.equal(toasts.length, 1, '卸载后的失败回调也不得弹 toast')
})

test('页面卸载后身份成功、降级或失败回调都不得写页、跳转或再发子请求', () => {
  const cases = [
    (request) => request.success(merchantAccess()),
    (request) => request.success({ code: 200, data: { active: false, applicationState: 'NONE', permissions: [] } }),
    (request) => request.fail({ msg: '迟到失败' }),
  ]

  cases.forEach((completeIdentity) => {
    userId = 9
    requests = []
    switched = []
    const page = loadPage()
    page.onShow()
    const identity = requested('/api/merchant/access/me')[0]
    const requestCount = requests.length
    let setDataCalls = 0
    const originalSetData = page.setData
    page.setData = function (patch) { setDataCalls += 1; originalSetData.call(this, patch) }

    page.onUnload()
    completeIdentity(identity)

    assert.equal(setDataCalls, 0)
    assert.equal(requests.length, requestCount)
    assert.deepEqual(switched, [])
  })
})

function assertNoConsoleGate(wxml) {
  assert.doesNotMatch(wxml, /rv-gate/, '整屏闸容器必须删除')
  assert.doesNotMatch(wxml, /consoleState/, 'consoleState 身份状态机必须删除')
  assert.doesNotMatch(wxml, /登录后查看|去登录|正在确认商家身份|没有商家身份/, '整屏闸文案必须删除')
  assert.match(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{consoleError\}\}"[^>]*bind:action="reloadConsole"/,
    '登录/身份失败必须落页内内联错误并可重试')
  assert.doesNotMatch(wxml, /wx:if="\{\{consoleError\}\}"[\s\S]{0,120}<cy-empty/, '错误态不得退回整屏空态')
}

test('wxml 不再有整屏身份闸,未登录的出路是页内错误 + 重试', () => {
  assertNoConsoleGate(fs.readFileSync(WXML_PATH, 'utf8'))
})

test('负控:恢复「未登录直接落整屏登录态并 return」必须让静默登录断言转红', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8')
  const anchor = '      // 静默登录:成功自动继续加载;失败只留页内错误,由 reloadConsole 重试。\n      ensureSession(app).then((ok) => {'
  assert.ok(source.includes(anchor), '负控锚点失效')
  const mutated = source.replace(anchor,
    "      this.setData({ consoleError: '登录后查看商家工作台' });\n      return;\n      ensureSession(app).then((ok) => {")

  // 变异体必须落在原页面目录里,否则相对 require 解析不到
  const tmp = path.join(ROOT, 'pages/merchant/index/.index.mutant.js')
  fs.writeFileSync(tmp, mutated)
  try {
    delete require.cache[require.resolve(tmp)]
    require(tmp)
    const page = Object.assign({}, pageConfig)
    page.data = JSON.parse(JSON.stringify(pageConfig.data))
    page.setData = function (patch) { Object.assign(this.data, patch) }
    userId = 0
    page.onShow()
    // 正向测试的第一条断言就是「静默登录期间不先摆错误态」;闸一加回来它必然红。
    assert.throws(() => assert.equal(page.data.consoleError, ''), assert.AssertionError)
  } finally {
    fs.unlinkSync(tmp)
  }
})

test('负控:把整屏身份闸加回 wxml 必须判红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const mutated = wxml.replace(
    '<cy-inline-error class="rv-console-error"',
    '<view class="rv-gate" wx:if="{{consoleState}}"><cy-empty cta="去登录" /></view>\n    <cy-inline-error class="rv-console-error"',
  )
  assert.notEqual(mutated, wxml, '负控锚点失效')
  assert.throws(() => assertNoConsoleGate(mutated), /整屏闸容器必须删除/)
})
