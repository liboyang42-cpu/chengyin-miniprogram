// 回归：商家合作中心「可申请路线」在接口成功时必须真正渲染并收掉 loading。
//
// 背景:index.js 顶部只导入了 { toTimestamp, chinaParts },routeCards() 却调了没导入的
// chinaDayStart —— ReferenceError 抛在 wx.request 的 success 回调里被吞掉,setData 整句
// 不执行,routesLoading 停在初值 true。表现是「接口成功=永远转圈,接口失败=反而正常收场」,
// 真机零报错。静态绑定门禁和全量单测都拦不住这一类,只能靠本用例守。

const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')

const COOP_CENTER_PAGE = '../../pages/merchant/coop-center/index.js'

let pageConfig
let requests

global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  getUserID: () => 9,
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
  tips() {},
})

global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
  navigateTo() {}, switchTab() {},
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => { pageConfig = null; requests = [] })

function setByPath(target, path, value) {
  const parts = path.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage() {
  delete require.cache[require.resolve(COOP_CENTER_PAGE)]
  require(COOP_CENTER_PAGE)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([path, value]) => setByPath(page.data, path, value))
    if (callback) callback()
  }
  return page
}

// normalizeMarketingHome 校验很严,少一个字段就整包判 null 走 error 分支,
// 所以夹具必须字段齐全,否则测的是 error 分支、根本到不了 routeCards()。
function marketingHome(items) {
  return {
    code: 200,
    data: {
      recruiting: { count: items.length, items },
      coupons: { couponCount: 0, received: 0, verified: 0 },
      content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
      funnel: [],
    },
  }
}

const FUTURE_DEADLINE = '2099-01-01 00:00:00'

test('路线接口成功时渲染路线卡并收掉 loading（不得抛错卡在转圈）', () => {
  const page = loadPage()

  page.loadRoutes()
  assert.equal(page.data.routesLoading, true, '发起请求后应处于 loading')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/merchant/marketing-home')

  requests[0].success(marketingHome([
    { id: 1, name: '夜游苏河', imgUrl: '', productType: 1,
      recruitDeadline: FUTURE_DEADLINE, remainingMerchantCount: 5 },
  ]))

  assert.equal(page.data.routesLoading, false, 'loading 必须归零,否则用户永远看转圈')
  assert.equal(page.data.routesError, '', '成功路径不应有错误文案')
  assert.equal(page.data.routes.length, 1, '合法的可申请路线必须渲染出来')
  assert.equal(page.data.routes[0].title, '夜游苏河')
})

// 稿 234:276:卡片有「已满」「已截止」两态 —— 要不要接这一站由商家判断,不替他藏
test('已截止/已满照稿展示,不限名额不写余席;余席阈值 ≥2 绿 / 1 与 0 琥珀', () => {
  const page = loadPage()
  page.loadRoutes()

  requests[0].success(marketingHome([
    { id: 1, name: '已截止', imgUrl: '', productType: 1,
      recruitDeadline: '2020-01-01 00:00:00', remainingMerchantCount: 5 },
    { id: 2, name: '没名额', imgUrl: '', productType: 1,
      recruitDeadline: FUTURE_DEADLINE, remainingMerchantCount: 0 },
    { id: 3, name: '不限', imgUrl: '', productType: 2,
      recruitDeadline: FUTURE_DEADLINE, remainingMerchantCount: null },
    { id: 4, name: '最后一席', imgUrl: '', productType: 1,
      recruitDeadline: FUTURE_DEADLINE, remainingMerchantCount: 1 },
  ]))

  assert.equal(page.data.routesLoading, false)
  const byTitle = Object.fromEntries(page.data.routes.map((r) => [r.title, r]))
  assert.equal(byTitle['已截止'].deadlineText, '已截止')
  assert.deepEqual([byTitle['已截止'].seatText, byTitle['已截止'].seatTone], ['余 5 席', 'ok'])
  assert.deepEqual([byTitle['没名额'].seatText, byTitle['没名额'].seatTone], ['已满', 'tight'])
  assert.equal(byTitle['不限'].seatText, '', 'null = 不招商或不限名额,不得渲染成已满')
  assert.deepEqual([byTitle['最后一席'].seatText, byTitle['最后一席'].seatTone], ['余 1 席', 'tight'])
  assert.match(byTitle['最后一席'].deadlineText, /^招商截止 1月1日$/)
})

test('结算方式行按章节档位与公示口径拼,混档只列档位', () => {
  const page = loadPage()
  page.loadRoutes()
  requests[0].success(marketingHome([
    { id: 1, name: '权益', productType: 1, recruitDeadline: FUTURE_DEADLINE, termsModes: ['PERK'], perkMinValue: 30,
      cityKeyword: '静安', locationCount: 4, startDate: '2099-03-01 10:00:00', endDate: '2099-03-02 18:00:00' },
    { id: 2, name: '引流', productType: 2, recruitDeadline: FUTURE_DEADLINE, termsModes: ['TRAFFIC'] },
    { id: 3, name: '混档', productType: 2, recruitDeadline: FUTURE_DEADLINE, termsModes: ['PERK', 'TRAFFIC'] },
  ]))
  const [perk, traffic, mixed] = page.data.routes
  assert.equal(perk.termsText, '权益核销 · 权益不低于 ¥30')
  assert.equal(perk.metaText, '静安 · 4 站')
  assert.equal(perk.dateText, '3月1日 – 3月2日')
  assert.equal(perk.modeText, '城市定向')
  assert.equal(traffic.termsText, '引流合作 · 无结算')
  assert.equal(mixed.termsText, '权益核销 / 引流合作')
})

test('对照:接口失败时同样要收掉 loading 并给出错误文案', () => {
  const page = loadPage()
  page.loadRoutes()

  requests[0].fail({ msg: '网络开小差' })

  assert.equal(page.data.routesLoading, false)
  assert.equal(page.data.routes.length, 0)
  assert.match(page.data.routesError, /网络开小差/)
})

/* CU-M-132/133(2026-09-24 走查):营销卡写「15 个开放商机」,点进广场却是 10 张全是「已截止」,
   剩下 5 条既看不见也没有说明。计数与排列改在服务端(recruiting()),广场这边负责把
   「还有没列出的」讲明白 —— 不谎报,也不在老 jar 没下发时凭空造一句。 */
function homeWithScope(items, scope) {
  return {
    code: 200,
    data: {
      recruiting: Object.assign({ count: items.length, items }, scope),
      coupons: { couponCount: 0, received: 0, verified: 0 },
      content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
      funnel: [],
    },
  }
}

test('CU-M-133:还有未截止的商机没列出时,广场写明共 N · 前 M', () => {
  const items = Array.from({ length: 10 }, (unused, index) => ({
    id: index + 1, name: '路线 ' + (index + 1), imgUrl: '', productType: 1,
    recruitDeadline: FUTURE_DEADLINE, remainingMerchantCount: 3,
  }))
  const page = loadPage()
  page.loadRoutes()
  requests[0].success(homeWithScope(items, { openCount: 15, shownCount: 10, hasMoreOpen: true }))
  assert.equal(page.data.routeScopeText, '共 15 个开放商机 · 当前列出前 10 个')

  const full = loadPage()
  full.loadRoutes()
  requests[0].success(homeWithScope(items, { openCount: 10, shownCount: 10, hasMoreOpen: false }))
  assert.equal(full.data.routeScopeText, '', '没有剩余就不许声明被截断')

  const legacy = loadPage()
  legacy.loadRoutes()
  requests[0].success(homeWithScope(items, {}))
  assert.equal(legacy.data.routeScopeText, '', '老 jar 不下发这几个字段时按未截断处理')
})
