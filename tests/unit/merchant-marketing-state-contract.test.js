'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_PATH = path.join(ROOT, 'pages/merchant/marketing/index.js')
const WXML_PATH = path.join(ROOT, 'pages/merchant/marketing/index.wxml')
const WXSS_PATH = path.join(ROOT, 'pages/merchant/marketing/index.wxss')
const JSON_PATH = path.join(ROOT, 'pages/merchant/marketing/index.json')

let pageDefinition
let requests
let navigations
let memberId
let sessionResult

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function currentApp() {
  return {
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    getUserID: () => memberId,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    getSessionManager: () => ({
      // 成功等价于 session-store 落地(真实 session-manager 会写 user_id)。
      ensureSession: () => {
        if (sessionResult.ok && !memberId) memberId = 'merchant-a'
        return Promise.resolve(sessionResult)
      },
    }),
    sendRequest: (request) => { requests.push(request) },
  }
}

global.getApp = () => currentApp()
global.wx = {
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  navigateTo: ({ url }) => { navigations.push(url) },
  setNavigationBarColor() {},
  setBackgroundColor() {},
}
global.Page = (definition) => { pageDefinition = definition }

function setByPath(target, dataPath, value) {
  const parts = dataPath
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean)
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  pageDefinition = null
  requests = []
  navigations = []
  memberId = 'merchant-a'
  sessionResult = { ok: true }
  delete require.cache[require.resolve(PAGE_PATH)]
  require(PAGE_PATH)
  const page = Object.assign({}, pageDefinition)
  page.data = JSON.parse(JSON.stringify(pageDefinition.data))
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([dataPath, value]) => setByPath(this.data, dataPath, value))
    if (callback) callback()
  }
  return page
}

function analyticsPayload(windowDays = 30) {
  const day = 24 * 60 * 60 * 1000
  const endExclusive = Date.parse('2026-08-23T16:00:00.000Z')
  const currentStartInclusive = endExclusive - windowDays * day
  const previousStartInclusive = currentStartInclusive - windowDays * day
  const stage = (code, label) => ({ code, label, currentCount: 0, previousCount: 0, changeRate: null })
  return {
    semantics: 'INDEPENDENT_EVENT_COUNTS',
    windowDays,
    window: {
      timezone: 'Asia/Shanghai', basis: 'COMPLETE_CALENDAR_DAYS',
      previousStartInclusive, currentStartInclusive, endExclusive,
    },
    stages: [
      stage('BROWSE', '浏览'), stage('SIGNUP', '报名'), stage('PAYMENT', '支付'),
      stage('VERIFY', '核销'), stage('REFUND_APPLY', '退款申请'),
    ],
    touchpoints: {
      coverage: 'PARTIAL', attributed: false,
      items: [
        { code: 'IN_APP_TOPIC', label: '主题入口', eventCount: 0 },
        { code: 'IN_APP_ACTIVITY', label: '活动入口', eventCount: 0 },
        { code: 'UNATTRIBUTED', label: '未归因', eventCount: 0 },
      ],
    },
  }
}

function marketingResponse(overrides) {
  const data = Object.assign({
    recruiting: { count: 0, items: [] },
    coupons: { couponCount: 0, received: 0, verified: 0 },
    content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
    analytics: analyticsPayload(30),
  }, overrides || {})
  return { code: 200, data }
}

function marketingRequest(index) {
  // 2026-08-26 重做:近7天/近30天窗口切换随「经营事件」分析区块一并让位,
  // 聚合请求不再带 windowDays 参数(后端默认口径)。
  const matches = requests.filter((request) => request.url.startsWith('/api/merchant/marketing-home'))
  return index == null ? matches.at(-1) : matches[index]
}

function startMarketing(page) {
  page.onLoad()
  page.onShow()
  const access = requests.find((request) => request.url === '/api/merchant/access/me')
  assert.ok(access, '营销数据前必须先确认商家域身份')
  access.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_MARKETING',
      permissions: [
        'merchant:basic:read', 'merchant:project:manage', 'merchant:marketing:read',
        'merchant:marketing:write', 'merchant:coupon:manage', 'merchant:coop:manage',
      ],
    },
  })
  return marketingRequest()
}

test('F02: 聚合请求失败不把已确认商家权限改成身份失败', () => {
  const page = loadPage()
  const request = startMarketing(page)
  request.fail({ code: 500, msg: '服务开小差了' })
  request.complete()
  assert.equal(page.data.accessState, 'ready')
  assert.equal(page.data.funnelError, '服务开小差了')
})

function assertStateMarkup(wxml) {
  assert.match(wxml, /funnelLoading\s*&&\s*!marketingLoaded/,
    '首载只能显示同构骨架，不能先渲染零指标或业务空态')
  assert.match(wxml, /funnelLoading\s*&&\s*marketingLoaded/,
    '已有内容刷新时必须保留旧内容并显式标记 stale')
  assert.doesNotMatch(wxml, /<cy-inline-error\b[^>]*marketingLoaded/,
    '已有营销内容刷新失败静默降级，旧内容留在屏上，不挂常驻横幅')
  // 2026-08-26 重做:券的「未知 vs 明确零张」判定从 wxml 三元搬进 js,
  // 抓手从 couponSummary 换成 couponCard,规则一个字没变。
  assert.match(fs.readFileSync(PAGE_PATH, 'utf8'), /const COUPON_UNKNOWN = \{[^}]*'数据待同步'/,
    '优惠券指标未知时必须明确待同步')
  assert.doesNotMatch(wxml, /couponCard\.[A-Za-z]+\s*\|\|\s*0/,
    '未知优惠券数量不得被 || 0 冒充成真实零值')
  assert.match(wxml, /funnelLoading\s*&&\s*!marketingLoaded[\s\S]{0,300}?class="mine" wx:else/,
    '我的内容空态只能出现在首载成功之后')
  // 2026-09-16 去闸:未登录不再整屏「登录后查看商家营销」,静默登录后加载;
  // 登录/身份确认失败落 entryError 内联错误,岗位拒权落页内 denied 说明。
  assert.doesNotMatch(wxml, /cy-state-shell/, '整屏状态壳必须删除')
  assert.doesNotMatch(wxml, /accessState\s*===\s*'anonymous'/, '未登录不得再有整屏态')
  assert.doesNotMatch(wxml, /登录后查看|去登录/, '整屏闸文案必须删除')
  assert.match(wxml, /<cy-inline-error[^>]*wx:if="\{\{entryError\}\}"[^>]*bind:action="retryAll"/,
    '登录/身份确认失败必须落页内内联错误并可重试')
  assert.match(wxml, /<cy-inline-error[^>]*wx:elif="\{\{accessState === 'denied'\}\}"[^>]*bind:action="retryAll"/,
    '明确拒权必须落页内说明,不再整屏')
}

test('首载呈现骨架;未确认的数字位写 0、状态位说实话', () => {
  const page = loadPage()
  startMarketing(page)

  assert.equal(page.data.marketingLoaded, false)
  // marketingState 已下线 —— 「未确认」现在由 marketingLoaded=false 本身表达,
  // 券位则是 COUPON_UNKNOWN(而不是 null,null 专表「服务端明确回零张」)。
  // 2026-09-19 用户裁决:数字位没有数字就是 0,不放横杠;「没读到」改由副行文案承担。
  assert.equal(page.data.couponCard.title, '0 张在投放')
  assert.equal(page.data.couponCard.sub, '数据待同步')
  assert.equal(page.data.myContent.every((item) => item.count === null), true,
    '内部真值仍是 null:零内容与未确认在路由上必须可分(见「未知内容数量不会被当作零内容」)')
  assert.deepEqual(page.data.myContent.map((item) => item.countText), ['0', '0', '0'])
  assert.equal(page.data.funnelLoading, true)
  assertStateMarkup(fs.readFileSync(WXML_PATH, 'utf8'))
})

test('服务端明确全零后才进入业务空态，零值仍保留为已确认事实', () => {
  const page = loadPage()
  const request = startMarketing(page)

  request.success(marketingResponse())
  request.complete()

  assert.equal(page.data.marketingLoaded, true)
  assert.equal(page.data.couponCard, null, '服务端明确回零张才允许是 null(落虚线空态)')
  assert.deepEqual(page.data.myContent.map((item) => item.count), [0, 0, 0])
  assert.equal(page.data.funnelLoading, false)

  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  assert.match(wxml, /marketingDataState === 'empty'[\s\S]*?cta="\{\{merchantAccess\.canManageProjects \? '发布第一个主题' : ''\}\}"[\s\S]*?bind:cta="startFirstContent"/,
    '全零首屏必须在原业务空态提供有权限才可见的首发 CTA')
  page.startFirstContent()
  assert.equal(navigations.at(-1), '/pages/publish/fabu/index?scope=MERCHANT',
    '首发 CTA 必须直达商家主题创建页')
})

test('已有营销内容刷新失败时保留最后一次成功快照并提供局部重试', () => {
  const page = loadPage()
  const initial = startMarketing(page)
  initial.success(marketingResponse({
    coupons: { couponCount: 2, received: 8, verified: 3 },
    content: { topicCount: 5, freeExploreCount: 1, activityCount: 2 },
  }))
  initial.complete()
  const snapshot = JSON.parse(JSON.stringify({
    couponCard: page.data.couponCard,
    myContent: page.data.myContent,
    hero: page.data.hero,
  }))

  page.loadMarketingHome()
  assert.equal(page.data.funnelLoading, true)
  assert.deepEqual(page.data.couponCard, snapshot.couponCard)
  const refresh = marketingRequest()
  refresh.fail({ msg: '网络连接失败' })
  refresh.complete()

  assert.equal(page.data.funnelError, '网络连接失败')
  assert.equal(page.data.funnelLoading, false)
  assert.deepEqual(page.data.couponCard, snapshot.couponCard)
  assert.deepEqual(page.data.myContent, snapshot.myContent)
  assert.deepEqual(page.data.hero, snapshot.hero)
})

test('缺失独立事件数值的脏成功响应仍是错误，不能降级成 0 或成功空态', () => {
  const page = loadPage()
  const request = startMarketing(page)
  const analytics = analyticsPayload(30)
  analytics.stages[0] = Object.assign({}, analytics.stages[0], { currentCount: null })
  request.success(marketingResponse({
    analytics,
  }))
  request.complete()

  assert.equal(page.data.marketingLoaded, false)
  // marketingState 已下线 —— 「未确认」现在由 marketingLoaded=false 本身表达,
  // 券位则是 COUPON_UNKNOWN(而不是 null,null 专表「服务端明确回零张」)。
  // ★脏响应仍然**不算成功**:marketingLoaded 保持 false、funnelError 有值、可重试。
  //   变的只是数字位怎么写(0 而不是横杠),闸门一个字没动。
  assert.equal(page.data.couponCard.title, '0 张在投放')
  assert.equal(page.data.couponCard.sub, '数据待同步')
  assert.equal(page.data.myContent.every((item) => item.count === null), true)
  assert.match(page.data.funnelError, /营销数据/)
})

test('连续刷新只接受最后一轮响应，旧营销快照不能倒灌', () => {
  const page = loadPage()
  const oldRequest = startMarketing(page)
  page.loadMarketingHome()
  const freshRequest = marketingRequest()

  freshRequest.success(marketingResponse({
    coupons: { couponCount: 9, received: 9, verified: 9 },
  }))
  freshRequest.complete()
  oldRequest.success(marketingResponse({
    coupons: { couponCount: 1, received: 1, verified: 1 },
  }))
  oldRequest.complete()

  assert.equal(page.data.couponCard.title, '9 张在投放')
})

test('账号切换立即清除上一商家的营销快照，旧账号回调不得进入新视角', () => {
  const page = loadPage()
  const requestA = startMarketing(page)
  requestA.success(marketingResponse({
    coupons: { couponCount: 4, received: 8, verified: 2 },
  }))
  requestA.complete()
  memberId = 'merchant-b'
  page.onShow()
  assert.equal(page.data.couponCard.sub, '数据待同步')
  assert.equal(page.data.marketingLoaded, false)

  requestA.success(marketingResponse({
    coupons: { couponCount: 99, received: 99, verified: 99 },
  }))
  assert.equal(page.data.couponCard.sub, '数据待同步', 'A 的迟到结果不得写入 B 视角')

  const accessB = requests.filter((request) => request.url === '/api/merchant/access/me').at(-1)
  accessB.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 8, name: 'B 门店' },
      roleCode: 'MERCHANT_MARKETING',
      permissions: ['merchant:basic:read', 'merchant:project:manage', 'merchant:marketing:read'],
    },
  })
  const requestB = marketingRequest()
  requestB.success(marketingResponse({
    coupons: { couponCount: 2, received: 3, verified: 1 },
  }))
  requestB.complete()
  assert.equal(page.data.couponCard.title, '2 张在投放')
})

test('access/me 在途时账号改变，即使未触发新 onShow 也不得放行旧主体', () => {
  const page = loadPage()
  page.onLoad()
  page.onShow()
  const accessA = requests.find((request) => request.url === '/api/merchant/access/me')

  memberId = 'merchant-b'
  accessA.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: 'A 门店' },
      roleCode: 'MERCHANT_MARKETING',
      permissions: ['merchant:marketing:read'],
    },
  })

  assert.equal(page.data.merchantId, 0)
  assert.equal(page.data.merchantAccess.active, false)
  assert.equal(marketingRequest(), undefined, '旧账号身份不得为新账号启动营销数据请求')
})

test('聚合层 403 会清空旧指标并标为身份错误，不能冒充 access/me 的岗位拒权', () => {
  const page = loadPage()
  const initial = startMarketing(page)
  initial.success(marketingResponse({
    coupons: { couponCount: 3, received: 5, verified: 2 },
  }))
  initial.complete()

  page.loadMarketingHome()
  const offline = marketingRequest()
  offline.fail({ errMsg: 'request:fail', msg: '网络连接失败' })
  offline.complete()
  assert.equal(page.data.accessState, 'ready')
  assert.equal(page.data.couponCard.title, '3 张在投放')

  page.loadMarketingHome()
  const denied = marketingRequest()
  denied.success({ code: 403, msg: '商家身份无效或权限不足' })
  denied.complete()
  // ★#817 的负控,用改版后的字段名重写:聚合层的 403 **不得**冒充 access/me 的岗位拒权。
  // 岗位有没有权限只有 access/me 说了算;拿聚合层错误码判 denied 会撤掉重试按钮,
  // 让一次普通的接口失败看起来像「你被撤权了」。这里必须留在可重试的错误态。
  assert.notEqual(page.data.accessState, 'denied',
    '聚合层 403 不是岗位拒权,不能撤掉重试')
  assert.ok(page.data.funnelError, '聚合层失败必须留下可重试的错误态')
  assert.equal(page.data.couponCard.sub, '数据待同步')
  assert.equal(page.data.marketingLoaded, false)
})

test('聚合身份错误后的重新确认若遇到断网，不能继续沿用旧错误', () => {
  const page = loadPage()
  const denied = startMarketing(page)
  denied.success({ code: 403, msg: '商家身份无效或权限不足' })
  denied.complete()
  // 2026-08-26 重做:状态字段从 marketingState 拆成 accessState(权限真源结论)
  // + funnelError/merchantError(可重试的失败)。契约一字未改。
  assert.ok(page.data.funnelError, '聚合层 403 必须留下可重试的错误')
  assert.notEqual(page.data.accessState, 'denied', '聚合层 403 不是岗位拒权')

  page.reloadMarketing()
  assert.equal(page.data.accessState, 'checking', '重新确认开始后旧拒权结论必须先失效')
  assert.equal(page.data.funnelError, '', '重新确认必须先清掉旧错误,不能沿用')
  const retry = requests.filter((request) => request.url === '/api/merchant/access/me').at(-1)
  retry.fail({ msg: '网络连接失败' })

  // 2026-09-16:身份真源的失败改落 entryError(页内首屏内联错误),身份没确认属于
  // 入口级失败,不能跟着「有旧内容时的刷新失败」一起静默。
  assert.equal(page.data.entryError, '网络好像出了点小差')
  assert.notEqual(page.data.accessState, 'denied', '断网不是拒权,重试入口必须留着')
})

test('未登录不再整屏拦:静默登录成功后自动确认权限并加载营销', async () => {
  const page = loadPage()
  memberId = ''
  page.onLoad()
  assert.equal(page.data.entryError, '', '静默登录期间不先摆错误态')

  await flush()
  const access = requests.find((request) => request.url === '/api/merchant/access/me')
  assert.ok(access, '静默登录成功后必须自动继续权限确认')
  access.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_MARKETING',
      permissions: ['merchant:basic:read', 'merchant:marketing:read'],
    },
  })
  assert.ok(marketingRequest(), '权限确认后必须自动拉营销数据')
})

test('静默登录失败落 entryError 内联错误,不发权限请求', async () => {
  const page = loadPage()
  memberId = ''
  sessionResult = { ok: false, reason: 'networkFail' }
  page.onLoad()
  await flush()

  assert.equal(page.data.entryError, '登录失败，请重试')
  assert.equal(requests.length, 0, '登录没成功不该发营销请求')
  assert.equal(page.data.accessState, 'checking')
})

test('身份 401 静默重登一次后自动重拉,不落整屏去登录', async () => {
  const page = loadPage()
  const request = startMarketing(page)
  memberId = ''
  request.fail({ code: 401, msg: '登录状态失效' }, 401)
  await flush()

  const retried = requests.filter((r) => r.url === '/api/merchant/access/me').at(-1)
  assert.ok(retried, '重登成功后必须自动重拉权限')
  assert.equal(page.data.entryError, '')
})

test('重新确认会清掉 entryError 并真的再走一次入口链路', async () => {
  const page = loadPage()
  memberId = ''
  sessionResult = { ok: false }
  page.onLoad()
  await flush()
  assert.ok(page.data.entryError)

  sessionResult = { ok: true }
  page.retryAll()
  assert.equal(page.data.entryError, '')
  await flush()
  assert.ok(requests.some((r) => r.url === '/api/merchant/access/me'), '重试必须真的再走一次权限确认')
})

// 2026-09-17 拍板 #25:岗位没开营销权限时,页面只留一句说明,不再渲染
// hero/券卡/我的内容的「—/数据待同步」占位 —— 拿未知当数据画,员工会以为系统坏了。
function assertDeniedHidesData(wxml) {
  assert.match(wxml, /title="你的岗位还没有营销数据权限"/,
    '拒权必须说清是岗位没开权限')
  assert.match(wxml, /请联系店主开通/, '必须给出出路:联系店主开通')
  const guard = "wx:if=\"{{accessState !== 'denied'}}\""
  const guardIndex = wxml.indexOf(guard)
  assert.ok(guardIndex > 0, '数据区必须有一道「非拒权才渲染」的闸门')
  const heroIndex = wxml.indexOf('class="hero"')
  assert.ok(heroIndex > guardIndex, 'hero 等数据区必须在闸门之内,拒权时不渲染')
  const deckIndex = wxml.indexOf('class="deck-slot"')
  assert.ok(deckIndex > guardIndex, '优惠券数据区也必须在闸门之内')
}

test('岗位没有营销数据权限时只留说明,不渲染数据占位', () => {
  const page = loadPage()
  page.onLoad()
  page.onShow()
  const access = requests.find((request) => request.url === '/api/merchant/access/me')
  access.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_CHECKIN',
      permissions: ['merchant:basic:read', 'merchant:verify'],
    },
  })

  assert.equal(page.data.accessState, 'denied')
  assert.equal(page.data.accessError, '请联系店主开通')
  assert.equal(marketingRequest(), undefined, '拒权后不得再拉营销聚合')

  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  assertDeniedHidesData(wxml)
  // 负控:拆掉闸门后数据占位会重新露出,契约必须判红。
  const mutated = wxml.replace("wx:if=\"{{accessState !== 'denied'}}\"", '')
  assert.notEqual(mutated, wxml, '负控锚点失效')
  assert.throws(() => assertDeniedHidesData(mutated), assert.AssertionError)
})

test('未知内容数量不会被当作零内容送去创建页', () => {
  const page = loadPage()
  page.data.merchantAccess = { canManageProjects: true }

  page.goMyContent({ currentTarget: { dataset: { key: 'topic' } } })
  assert.equal(navigations.at(-1), '/subpackageA/pages/myproject/index?type=simple_topic&scope=MERCHANT')

  page.goMyContent({ currentTarget: { dataset: { key: 'topic', count: 0 } } })
  assert.equal(navigations.at(-1), '/pages/publish/fabu/index?scope=MERCHANT')
})

test('营销页状态组件、触达面积与状态播报均在页面内闭环', () => {
  const json = fs.readFileSync(JSON_PATH, 'utf8')
  const wxss = fs.readFileSync(WXSS_PATH, 'utf8')
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  for (const component of ['cy-skeleton', 'cy-inline-error']) {
    assert.match(json, new RegExp(`"${component}"\\s*:`), `${component} 未注册`)
  }
  assert.doesNotMatch(json, /"cy-state-shell"\s*:/, '整屏状态壳已无消费方,不得再注册')
  // .entry-row 已下线。规则不变:工具入口触达高度 ≥ 88rpx。
  // 不钉具体数值,从样式块里取真实值来比 —— 改版调高度不该让这条红,调矮才该红。
  const tileHeight = /\.tile\s*\{[^}]*?height:\s*(\d+)rpx/s.exec(wxss)
  assert.ok(tileHeight, '.tile 样式块或其 height 声明不存在,选择器已失效')
  assert.ok(Number(tileHeight[1]) >= 88,
    `营销工具入口触达高度必须至少 88rpx,实测 ${tileHeight[1]}rpx`)
  assert.match(wxml, /aria-role="status"[^>]*aria-live="polite"/,
    'stale 刷新必须向辅助技术播报')
  assert.match(wxml, /data-action="coupon"[\s\S]{0,200}?aria-role="button"[\s\S]{0,200}?aria-label="[^"]+"/,
    '优惠券入口必须有稳定、可读的动作名称')
  assert.match(wxml, /aria-label="\{\{item\.ariaLabel\}\}"/,
    '内容入口必须区分查看、管理和创建动作')
})

test('负控:恢复「未登录整屏态」必须让 wxml 契约转红', () => {
  const wxml = fs.readFileSync(WXML_PATH, 'utf8')
  const mutated = wxml.replace(
    '<cy-inline-error class="m-inline-error"',
    '<cy-state-shell wx:if="{{accessState === \'anonymous\'}}" title="登录后查看商家营销" primary="去登录" />\n    <cy-inline-error class="m-inline-error"',
  )
  assert.notEqual(mutated, wxml, '负控锚点失效')
  assert.throws(() => assertStateMarkup(mutated), /整屏状态壳必须删除/)
})

test('负控：恢复 || 0 或让首载空态越过成功闸门时契约会转红', () => {
  const source = fs.readFileSync(WXML_PATH, 'utf8')
  const fakeZero = source.replace('{{couponCard.title}}', "{{couponCard.couponCount || 0}} 张在投放")
  assert.notEqual(fakeZero, source, '负控锚点失效：券卡标题表达式不存在')
  assert.throws(() => assertStateMarkup(fakeZero), assert.AssertionError)

  const fakeEmpty = source.replaceAll('funnelLoading && !marketingLoaded', 'funnelLoading')
  assert.notEqual(fakeEmpty, source, '负控锚点失效：首载闸门不存在')
  assert.throws(() => assertStateMarkup(fakeEmpty), assert.AssertionError)
})

// 2026-09-19 用户裁决:「营销页没有数字就是 0,不能是横杠」。
// 这条把裁决钉成回归:页面可见文本(注释除外)与 js 里的字符串字面量都不许再出现破折号占位。
// 注释里的中文破折号「——」是标点,不算 UI 文本,所以先剥掉注释再扫。
test('营销页数字位不许出现横杠占位(用户裁决 2026-09-19)', () => {
  const wxmlVisible = fs.readFileSync(WXML_PATH, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(wxmlVisible, /—/, 'wxml 可见文本里仍有破折号占位:数字位必须写 0')

  const js = fs.readFileSync(PAGE_PATH, 'utf8')
  assert.doesNotMatch(js, /(['"])—+\1/, 'js 字符串字面量里仍有破折号占位:数字位必须写 0')

  const page = loadPage()
  startMarketing(page)
  assert.equal(page.data.hero.value, '0')
  assert.deepEqual(page.data.myContent.map((item) => item.countText), ['0', '0', '0'])
  assert.equal(page.data.couponCard.title, '0 张在投放')
  // 负控:把未知态改回横杠,上面那条扫描必须抓到(证明它不是恒绿的空扫)
  // 锚点跟的是 heroPlaceholder 的返回字面量(#1088 把 HERO_UNKNOWN 常量重构成了函数,
  //   「数字位写 0」这句裁决本身没变,变的只是锚点写法,扫描口径随之同步)。
  const regressed = js.replace("return { value: '0', sub: '', label: label", "return { value: '—', sub: '', label: label")
  assert.notEqual(regressed, js, '负控锚点失效:heroPlaceholder 字面量已改名,扫描口径需同步')
  assert.match(regressed, /(['"])—+\1/, '把未知态改回横杠时裁决必须转红')
})
