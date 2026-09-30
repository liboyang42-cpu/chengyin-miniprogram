// 批5 · 四角色(玩家 / 商家 / 平台 / 俱乐部)在小程序侧的行为契约 + 负控。
//
// 真源:开工计划 §5-1「四条角色链路逐条真跑」+ §5-3「把链路故意打断一处,验证它真的会红」
//       裁决表 E2(票源归因)· F4(图鉴)· 偏离 2(商家可见字段三约束)
//
// 这一批验的是**链路**不是单点:单点全绿而链路断掉,是这个仓库反复出现的形态。
// 因此每条契约都尽量跑真代码(载入真 app.js / 真页面 / 真组件),只有「全仓不得存在某入口」
// 这类反向断言才用源码扫描 —— 那种断言用行为跑不出来,因为它要证的正是「没有」。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const BAOMING = path.resolve(ROOT, 'pages/activity/baoming/baoming.js')
const TOPIC = path.resolve(ROOT, 'pages/topic/index/index.js')
const CLUB_DETAIL_JS = path.join(ROOT, 'pages/club/detail/index.js')
const CLUB_DETAIL_WXML = path.join(ROOT, 'pages/club/detail/index.wxml')

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8') }

function listFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, out)
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

// ---------------------------------------------------------------------------
// 玩家:分享落地 → 捕获 → 建单带归因
// ---------------------------------------------------------------------------

let store
let sandbox

beforeEach(() => {
  store = {}
  sandbox = { requests: [], toasts: [], navigations: [] }
  global.getApp = () => ({
    globalData: { user_id: 9, features: {} },
    isDevEnv: () => false,
    getUserID: () => 9,
    tips: (m) => sandbox.toasts.push(m),
    sendRequest: (r) => sandbox.requests.push(r),
    getRequestErrorMessage: (res, fb) => (res && res.msg) || fb,
    recordConsent: () => { const s = { then(r) { r(); return s }, catch() { return s } }; return s },
  })
  global.wx = {
    getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v },
    removeStorageSync: (k) => { delete store[k] },
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32, bottom: 56 }),
    showLoading() {}, hideLoading() {}, showToast() {}, showModal() {},
    requestSubscribeMessage() {}, requestPayment() {},
    navigateTo: (o) => sandbox.navigations.push(o.url),
    redirectTo: (o) => sandbox.navigations.push(o.url),
    hideTabBar() {}, setNavigationBarColor() {},
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
  }
  global.Page = (c) => { sandbox.pageConfig = c }
})

function loadApp() {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8')
  let config = null
  const ctx = {
    App: (c) => { config = c },
    getApp: () => ({}),
    wx: global.wx,
    Promise,
    setTimeout,
    console,
    require: (request) => (request.startsWith('.') ? require(path.join(ROOT, request)) : require(request)),
  }
  vm.createContext(ctx)
  vm.runInContext(source, ctx, { filename: 'app.js' })
  assert.ok(config, 'app.js App() 配置载入失败')
  return config
}

function loadBaoming() {
  delete require.cache[require.resolve(BAOMING)]
  require(BAOMING)
  const vmObj = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() },
  })
  vmObj.data = Object.assign({}, sandbox.pageConfig.data)
  return vmObj
}

function createdOrderBody(vmObj) {
  vmObj.data.pageState = 'ready'
  vmObj.data.activityId = 55
  vmObj.data.selectedTicket = { id: 1, price: 50 }
  vmObj.data.userInfo = { realName: '张三', phone: '13800138000', email: '' }
  vmObj._initWorkflow()
  vmObj._workflow.submit({
    activityId: 55,
    selectedTicket: vmObj.data.selectedTicket,
    useDiscount: false,
    userInfo: vmObj.data.userInfo,
    quoteSign: 'qs',
    requestId: 'rid-1',
  }, {})
  const req = sandbox.requests.find((r) => r.url === '/api/registration/create')
  assert.ok(req, '未发出建单请求')
  return JSON.parse(req.data)
}

test('玩家链路:分享落地捕获 ⇒ 建单请求带上 sourceClubId 与审计码', () => {
  const app = loadApp()
  app.captureTicketSource({ query: { id: '77', sourceClubId: '7', clubCode: 'club-7-t77' } })

  const page = loadBaoming()
  page.data.activityInfo = { id: 55, topicId: 77 }
  const body = createdOrderBody(page)

  assert.equal(body.sourceClubId, 7)
  assert.equal(body.sourceChannelCode, 'club-7-t77')
})

test('negative control:没有分享标记 ⇒ 建单不带任何归因字段(归平台)', () => {
  const page = loadBaoming()
  page.data.activityInfo = { id: 55, topicId: 77 }
  const body = createdOrderBody(page)

  assert.equal('sourceClubId' in body, false)
  assert.equal('sourceChannelCode' in body, false)
})

test('negative control:非法 deep-link(sourceClubId=abc)⇒ 建单不带归因,不得伪造', () => {
  const app = loadApp()
  app.captureTicketSource({ query: { id: '77', sourceClubId: 'abc', clubCode: 'x' } })

  const page = loadBaoming()
  page.data.activityInfo = { id: 55, topicId: 77 }
  const body = createdOrderBody(page)

  assert.equal('sourceClubId' in body, false)
})

test('negative control:归因是别期的 ⇒ 本期建单不带标记(不跨期复用)', () => {
  const app = loadApp()
  app.captureTicketSource({ query: { id: '999', sourceClubId: '7' } })

  const page = loadBaoming()
  page.data.activityInfo = { id: 55, topicId: 77 }
  const body = createdOrderBody(page)

  assert.equal('sourceClubId' in body, false)
})

test('negative control:活动详情没给 topicId ⇒ 不拿 activityId 顶替期,直接归平台', () => {
  const app = loadApp()
  app.captureTicketSource({ query: { id: '55', sourceClubId: '7' } }) // 故意用 activityId 当 topicId

  const page = loadBaoming()
  page.data.activityInfo = { id: 55 } // topicId 缺失
  const body = createdOrderBody(page)

  assert.equal('sourceClubId' in body, false, '期事实缺失时不得凭 activityId 归因')
})

test('重复落地同一条分享 ⇒ 归因幂等,建单结果一致', () => {
  const app = loadApp()
  app.captureTicketSource({ query: { id: '77', sourceClubId: '7', clubCode: 'c' } })
  app.captureTicketSource({ query: { id: '77', sourceClubId: '7', clubCode: 'c' } })

  const page = loadBaoming()
  page.data.activityInfo = { id: 55, topicId: 77 }
  assert.equal(createdOrderBody(page).sourceClubId, 7)
})

test('热启动 onShow 也捕获分享参数(分享卡再次进入时 query 只出现在 onShow)', () => {
  const app = loadApp()
  app.onShow({ query: { id: '77', sourceClubId: '7' } })

  const page = loadBaoming()
  page.data.activityInfo = { id: 55, topicId: 77 }
  assert.equal(createdOrderBody(page).sourceClubId, 7)
})

test('冷启动 onLaunch 也捕获(即使后续初始化抛错,归因已经落下)', () => {
  const app = loadApp()
  global.wx.getWindowInfo = () => { throw new Error('boom') }
  try { app.onLaunch({ query: { id: '77', sourceClubId: '7' } }) } catch (e) { /* 初始化后续步骤不在本断言范围 */ }
  // onLaunch 内部把初始化包在 Promise 里,boom 会变成 rejection;本用例只关心捕获时机,吞掉它。
  if (app.appReadyPromise && app.appReadyPromise.catch) app.appReadyPromise.catch(() => {})

  const page = loadBaoming()
  page.data.activityInfo = { id: 55, topicId: 77 }
  assert.equal(createdOrderBody(page).sourceClubId, 7, 'onLaunch 必须在初始化早期就捕获')
})

test('negative control:onLaunch 捕获 A、onShow 冲突 B、再次 onShow B 后页面建单仍归平台', () => {
  const app = loadApp()
  global.wx.getWindowInfo = () => { throw new Error('boom') }
  try { app.onLaunch({ query: { id: '77', sourceClubId: '7', clubCode: 'A' } }) } catch (e) {}
  if (app.appReadyPromise && app.appReadyPromise.catch) app.appReadyPromise.catch(() => {})

  app.onShow({ query: { id: '77', sourceClubId: '8', clubCode: 'B' } })
  app.onShow({ query: { id: '77', sourceClubId: '8', clubCode: 'B' } })

  const page = loadBaoming()
  page.data.activityInfo = { id: 55, topicId: 77 }
  const body = createdOrderBody(page)
  assert.equal('sourceClubId' in body, false, '冲突墓碑必须跨启动钩子保留到页面消费')
  assert.equal('sourceChannelCode' in body, false, '冲突时连审计码也不得留下')
})

// ---------------------------------------------------------------------------
// 主题页(ownerType=1)建单口也要带归因 —— 2026-09-19 审查 F-TS-1:
// 俱乐部项目卡分享落在主题页,而只有报名页合并了 attributionPayload,
// 于是这一整条路归因静默落平台、俱乐部票源奖励恒 0。
// ---------------------------------------------------------------------------

function loadTopic() {
  delete require.cache[require.resolve(TOPIC)]
  require(TOPIC)
  const vmObj = Object.assign({}, sandbox.pageConfig, {
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb() },
  })
  vmObj.data = Object.assign({}, sandbox.pageConfig.data)
  return vmObj
}

function topicOrderBody(vmObj, topicId) {
  // master 侧主题页建单前有「资料预检」(09-16 #10 线):_signupProfile 缺失会先异步拉 /api/user/info,
  // 同步路径直接 return ⇒ 测试按新口径预置实例字段(与页面进页预取等价)。
  vmObj._signupProfile = { realName: '张三', phone: '13800138000' }
  vmObj._initWorkflow()
  vmObj._createSelfPlayOrder(topicId)
  const req = sandbox.requests.find((r) => r.url === '/api/registration/create')
  assert.ok(req, '未发出建单请求')
  return JSON.parse(req.data)
}

test('主题页链路:分享落地捕获 ⇒ 主题建单带上 sourceClubId 与审计码', () => {
  const app = loadApp()
  app.captureTicketSource({ query: { id: '77', sourceClubId: '7', clubCode: 'club-7-t77' } })

  const body = topicOrderBody(loadTopic(), 77)
  assert.equal(body.ownerType, 1, '主题页建单的 ownerType 必须是 1')
  assert.equal(body.sourceClubId, 7)
  assert.equal(body.sourceChannelCode, 'club-7-t77')
})

test('negative control:主题页建别的期 ⇒ 不带标记(归因不跨期复用)', () => {
  const app = loadApp()
  app.captureTicketSource({ query: { id: '77', sourceClubId: '7' } })

  const body = topicOrderBody(loadTopic(), 88)
  assert.equal('sourceClubId' in body, false)
})

test('negative control:主题页无标记 ⇒ 建单不带归因字段,不得塞 null', () => {
  const body = topicOrderBody(loadTopic(), 77)
  assert.equal('sourceClubId' in body, false)
  assert.equal('sourceChannelCode' in body, false)
})

// ---------------------------------------------------------------------------
// 俱乐部:带票分享是归因的唯一产出口
// ---------------------------------------------------------------------------

function loadClubDetail() {
  const source = fs.readFileSync(CLUB_DETAIL_JS, 'utf8')
  let config = null
  const ctx = {
    Page: (c) => { config = c },
    getApp: global.getApp,
    wx: global.wx,
    Set, Map, Date, JSON, Math, Promise, setTimeout, clearTimeout, console,
    require: (request) => require(path.join(path.dirname(CLUB_DETAIL_JS), request)),
  }
  vm.createContext(ctx)
  vm.runInContext(source, ctx, { filename: 'club-detail.js' })
  assert.ok(config, 'club/detail Page() 载入失败')
  const page = Object.assign({}, config, {
    setData(patch) { Object.assign(this.data, patch) },
  })
  page.data = Object.assign({}, config.data)
  return page
}

test('俱乐部链路:主理人从项目卡分享 ⇒ 路径带本期归因参数', () => {
  const page = loadClubDetail()
  page.data.clubId = 7
  page.data.club = { id: 7, name: '毛孩子俱乐部', isOwner: true }
  page.loadShareEditions()
  const req = sandbox.requests.find((item) => item.url === '/api/club-compensation/editions')
  assert.ok(req, '必须从执行俱乐部条款真源拉可分享期次')
  assert.equal(JSON.parse(req.data).clubId, 7)
  req.success({ code: '200', data: [{ topicId: 77, topicName: '第一期', executingClubId: 7 }] })

  const share = page.onShareAppMessage({ target: { dataset: { topicId: 77 } } })

  assert.equal(share.title, '第一期')
  assert.ok(share.path.indexOf('/pages/topic/index/index?id=77') === 0)
  assert.ok(share.path.indexOf('sourceClubId=7') > -1)
  assert.ok(share.path.indexOf('clubCode=') > -1)
})

test('negative control:整页分享(非项目卡)不得带归因参数', () => {
  const page = loadClubDetail()
  page.data.clubId = 7
  page.data.club = { id: 7, name: '毛孩子俱乐部' }

  const share = page.onShareAppMessage({})

  assert.equal(share.path, '/pages/club/detail/index?id=7')
  assert.equal(share.path.indexOf('sourceClubId'), -1)
})

test('negative control:归因的 clubId 只能来自本页,不接受 dataset 传入的俱乐部', () => {
  const page = loadClubDetail()
  page.data.clubId = 7
  page.data.club = { id: 7, name: 'c', isOwner: true }
  page.data.shareEditions = [{ topicId: 77, topicName: '第一期', executingClubId: 7 }]

  const share = page.onShareAppMessage({ target: { dataset: { topicId: 77, sourceClubId: 999, clubId: 999 } } })

  assert.ok(share.path.indexOf('sourceClubId=7') > -1)
  assert.equal(share.path.indexOf('999'), -1, '外部传入的俱乐部 id 不得进归因参数')
})

test('negative control:/api/club/topics 的经典项目不能冒充探店日期次产出归因', () => {
  const page = loadClubDetail()
  page.data.clubId = 7
  page.data.club = { id: 7, name: 'c', isOwner: true }
  page._topics = [{ id: 77, name: '经典定向' }]
  page.data.shareEditions = []

  const share = page.onShareAppMessage({ target: { dataset: { topicId: 77 } } })

  assert.equal(share.path, '/pages/club/detail/index?id=7')
  assert.equal(share.path.indexOf('sourceClubId'), -1)
})

test('negative control:没有 clubId 时分享不得产出半个归因参数', () => {
  const page = loadClubDetail()
  page.data.clubId = null
  page.data.club = null

  const share = page.onShareAppMessage({ target: { dataset: { topicId: 77 } } })

  assert.equal(share.path.indexOf('sourceClubId'), -1)
})

test('带票分享钮真的挂在项目卡上,并阻断整行跳转', () => {
  const wxml = fs.readFileSync(CLUB_DETAIL_WXML, 'utf8')
  assert.ok(/wx:for="\{\{shareEditions\}\}"[^>]*>[\s\S]*?open-type="share"[^>]*data-topic-id="\{\{item\.topicId\}\}"/.test(wxml),
    '执行俱乐部期次缺少 open-type="share" 的带票分享钮')
  // CU-C-145:产品没有单独的「探店日」,这类活动就是「自由探索」—— 面向主理人的分类名统一。
  assert.match(wxml, /自由探索期次/)
  assert.doesNotMatch(wxml, /探店日期次/, '旧分类名不许回来')
  assert.ok(/catchtap="stopShareBubble"/.test(wxml), '分享钮必须 catchtap,否则点分享会顺带跳进管理页')
  assert.ok(/stopShareBubble\s*\(\)/.test(fs.readFileSync(CLUB_DETAIL_JS, 'utf8')),
    'catchtap 绑定的方法必须真存在(U2)')
})

// ---------------------------------------------------------------------------
// 商家:完局面是玩家私域,商家侧一格都不许有
// ---------------------------------------------------------------------------

test('negative control:商家侧任何页面都不得调用玩家完局面接口', () => {
  const merchantFiles = listFiles(path.join(ROOT, 'pages/merchant'))
  const offenders = merchantFiles.filter((f) => /explore-completion/.test(fs.readFileSync(f, 'utf8')))
  assert.deepEqual(offenders, [],
    '商家读面已按偏离 2 收窄到「本店进店 ∪ 本店核销」,完局面(图鉴/奖励/关注)属玩家私域')
})

test('negative control:商家侧不得出现票源归因字段(归因是玩家建单时的事)', () => {
  const merchantFiles = listFiles(path.join(ROOT, 'pages/merchant'))
  const offenders = merchantFiles.filter((f) => /sourceClubId|sourceChannelCode/.test(fs.readFileSync(f, 'utf8')))
  assert.deepEqual(offenders, [], '商家侧出现归因字段 = 归因产出口失控')
})

// ---------------------------------------------------------------------------
// 平台:小程序侧没有平台角色的写入口,平台动作全在后台
// ---------------------------------------------------------------------------

test('negative control:小程序侧不得存在「补发通关奖励」这类写入口', () => {
  const files = listFiles(path.join(ROOT, 'pages'))
    .concat(listFiles(path.join(ROOT, 'components')))
    .concat(listFiles(path.join(ROOT, 'utils')))
  const banned = /\/api\/[a-z0-9/-]*(grant-award|award\/grant|completion\/grant|regrant|reissue-award)/i
  const offenders = files.filter((f) => banned.test(fs.readFileSync(f, 'utf8')))
  assert.deepEqual(offenders, [],
    '奖励发放的唯一入口是核销侧 grantOnce;读面补发会绕开幂等闸')
})

test('negative control:小程序侧不得存在改票源归因的写接口(归因支付后由服务端冻结)', () => {
  const files = listFiles(path.join(ROOT, 'pages'))
    .concat(listFiles(path.join(ROOT, 'components')))
    .concat(listFiles(path.join(ROOT, 'utils')))
  const banned = /\/api\/[a-z0-9/-]*(ticket-source|source-club|attribution)/i
  const offenders = files.filter((f) => banned.test(fs.readFileSync(f, 'utf8')))
  assert.deepEqual(offenders, [],
    '归因只在建单时随请求体带一次,之后由 freezeTicketSourceOnPayment 冻死,不得再有改口')
})

test('平台侧的完局面接口是只读的:小程序只 POST 查询,没有任何写语义参数', () => {
  const detail = read('components/cy/scene-member-order-detail/index.js')
  const call = detail.split('\n').findIndex((line) => line.indexOf("'/api/registration/explore-completion'") > -1)
  assert.ok(call > -1, '完局面接口未被消费')
  const body = detail.split('\n').slice(call, call + 4).join('\n')
  assert.ok(/data:\s*\{\s*id:\s*info\.id\s*\}/.test(body), '只允许传 id;多传一个字段就要重新审这条是不是还只读')
})

// ---------------------------------------------------------------------------
// 后端归因冻结闸仍在(前端这条链路的全部安全性都压在它身上)
// ---------------------------------------------------------------------------

test('negative control:后端支付冻结闸必须还在,且仍会把非法标记冻成平台', () => {
  const xml = fs.readFileSync(
    path.resolve(ROOT, '../chengyinhub-system/src/main/resources/mapper/business/CmsRegistrationMapper.xml'), 'utf8')
  const freeze = xml.slice(xml.indexOf('<update id="freezeTicketSourceOnPayment">'))
  assert.ok(freeze.indexOf('</update>') > -1, 'freezeTicketSourceOnPayment 不见了')
  const body = freeze.slice(0, freeze.indexOf('</update>'))
  assert.ok(/else null/.test(body), '不满足条件必须冻结为平台(null),前端才敢把标记原样送上去')
  assert.ok(/a\.club_id = r\.source_club_id or t\.club_id = r\.source_club_id/.test(body),
    '标记必须至少等于活动或主题一侧的 club_id —— 这条没了,前端随便填个数就能归因')
  assert.ok(/source_frozen_at is null/.test(body), '冻结必须一次性,否则支付后还能改归因')
})
