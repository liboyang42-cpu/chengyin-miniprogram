const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.join(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function createPage(overrides) {
  const requests = []
  const toasts = []
  const navigations = []
  let sessionClears = 0
  let stopped = 0
  let config
  const state = Object.assign({ memberId: 'merchant-a', sessionResult: { ok: true } }, overrides || {})
  global.getApp = () => ({
    getImgUrl(value) { return value ? `https://img.example/${value}` : '' },
    getRequestErrorMessage(_res, fallback) { return fallback },
    getUserID() { return state.memberId },
    getSession() { return { clearSession() { sessionClears += 1 } } },
    getSessionManager() {
      return {
        ensureSession() {
          if (state.sessionResult.ok && !state.memberId) state.memberId = 'merchant-a'
          return Promise.resolve(state.sessionResult)
        },
      }
    },
    sendRequest(options) { requests.push(options) },
  })
  global.wx = {
    getSystemInfoSync() { return { statusBarHeight: 24 } },
    navigateTo(options) { navigations.push({ method: 'navigateTo', url: options.url }) },
    switchTab(options) { navigations.push({ method: 'switchTab', url: options.url }) },
    reLaunch(options) { navigations.push({ method: 'reLaunch', url: options.url }) },
    showToast(options) { toasts.push(options) },
    stopPullDownRefresh() { stopped += 1 },
    setNavigationBarColor() {},
  }
  global.Page = value => { config = value }
  const absolute = path.join(ROOT, 'pages/merchant/relation/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  config.data = JSON.parse(JSON.stringify(config.data))
  config.setData = patch => Object.assign(config.data, patch)
  return {
    page: config,
    requests,
    toasts,
    navigations,
    state,
    sessionClears: () => sessionClears,
    stopped: () => stopped,
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function relationHome(overrides) {
  return Object.assign({
    code: 200,
    data: {
      stats: { merchantCount: 0, clubCount: 0, pendingCoopCount: 0 },
      relations: [],
      discovery: { merchants: [], clubs: [] },
    },
  }, overrides)
}

function assertCardProjection(view) {
  assert.match(view, /cover="\{\{item\.coverUrl\}\}"/)
  assert.match(view, /logo="\{\{item\.logoUrl\}\}"/)
}

test('合作页把后端公开封面与头像字段投影成卡片真实资源', () => {
  const { page, requests } = createPage()
  page.onLoad({})
  requests[0].success(relationHome({
    code: '200',
    data: {
      stats: { merchantCount: 0, clubCount: 0, pendingCoopCount: 0 },
      relations: [],
      discovery: {
        merchants: [{ id: 2, memberId: 20, name: '邻店', coverImage: 'merchant-cover.jpg', logo: 'merchant-logo.png', businessStatus: 9, locationVerified: 'unknown', distance: -20 }],
        clubs: [{ id: 3, name: '夜行俱乐部', cover: 'club-cover.jpg', logo: 'club-logo.png' }],
      },
    },
  }))

  assert.equal(page.data.merchants[0].coverUrl, 'https://img.example/merchant-cover.jpg')
  assert.equal(page.data.merchants[0].logoUrl, 'https://img.example/merchant-logo.png')
  assert.equal(page.data.merchants[0].displayStatus, 'none')
  assert.equal(page.data.merchants[0].displayLocationVerified, null)
  assert.equal(page.data.merchants[0].distanceText, '')
  assert.equal(page.data.clubs[0].coverUrl, 'https://img.example/club-cover.jpg')
  assert.equal(page.data.clubs[0].logoUrl, 'https://img.example/club-logo.png')

  const view = read('pages/merchant/relation/index.wxml')
  assertCardProjection(view)
  assert.doesNotMatch(view, /d_logo|d_banner|default|placeholder/i)
})

test('负控：卡片回退消费未转换字段时封面投影门禁会变红', () => {
  const broken = read('pages/merchant/relation/index.wxml')
    .replace('cover="{{item.coverUrl}}"', 'cover="{{item.coverImage}}"')
    .replace('logo="{{item.logoUrl}}"', 'logo="{{item.logo}}"')
  assert.throws(() => assertCardProjection(broken))
})

test('合作页非空脏列表显示分区错误，不能伪装成成功空态', () => {
  const { page, requests } = createPage()
  page.onLoad({})
  requests[0].success(relationHome({
    code: 200,
    data: {
      stats: { merchantCount: 0, clubCount: 0, pendingCoopCount: 0 },
      relations: [],
      discovery: {
        merchants: [{ id: 2, name: { raw: true } }],
        clubs: [{ id: 3, name: '有效俱乐部' }],
      },
    },
  }))

  assert.equal(page.data.pageState, 'ready')
  assert.equal(page.data.merchants.length, 0)
  assert.equal(page.data.merchantError, '部分商家资料暂无法显示')
  assert.equal(page.data.clubError, '')
  assert.match(read('pages/merchant/relation/index.wxml'), /merchantError[\s\S]*bind:action="loadRelationHome"/)
  assert.match(read('pages/merchant/relation/index.wxml'), /wx:elif="\{\{!merchantError\}\}"[^>]*title="暂无可合作商家"/)
})

test('合作页刷新失败保留上次内容并提供可见重试', () => {
  const { page, requests } = createPage()
  page.onLoad({})
  requests[0].success(relationHome({
    data: {
      stats: { merchantCount: 0, clubCount: 0, pendingCoopCount: 0 },
      relations: [],
      discovery: { merchants: [{ id: 2, memberId: 20, name: '邻店' }], clubs: [] },
    },
  }))
  requests[0].complete()

  page.loadRelationHome()
  requests[1].fail({ errMsg: 'network fail' })
  requests[1].complete()

  assert.equal(page.data.pageState, 'ready')
  assert.equal(page.data.merchants[0].displayName, '邻店')
  assert.doesNotMatch(read('pages/merchant/relation/index.wxml'), /<cy-inline-error[^>]*staleError/)
})

test('合作页初次异常进入整页错误，请求静默且防重复', () => {
  const { page, requests } = createPage()
  page.onLoad({})
  page.loadRelationHome()

  assert.equal(requests.length, 1)
  assert.equal(requests[0].hideLoading, true)
  assert.equal(requests[0].silentError, true)
  assert.doesNotThrow(() => requests[0].success(undefined))
  requests[0].complete()

  assert.equal(page.data.pageState, 'error')
  assert.equal(page.data.error, '合作数据加载失败')
  assert.deepEqual(page.data.merchants, [])
  assert.deepEqual(page.data.clubs, [])
})

test('合作页 401 静默重登后自动重载，403 静默回会员中心', async () => {
  const { page, requests, navigations, state } = createPage()
  page.onLoad({})
  assert.equal(requests.length, 1)

  state.memberId = ''
  requests[0].fail({ code: 401, msg: '登录状态失效' }, 401)
  requests[0].complete()
  await flush()
  assert.equal(page.data.pageState, 'loading', '重登期间保持普通加载态,不摆整屏去登录')
  const retried = requests[1]
  assert.ok(retried, '重登成功后必须自动重拉合作数据')
  retried.success(relationHome())
  retried.complete()
  assert.equal(page.data.pageState, 'ready')

  page.loadRelationHome()
  requests[2].fail({ code: 403, msg: '商家身份无效或权限不足' }, 403)
  assert.deepEqual(navigations.at(-1), { method: 'switchTab', url: '/pages/member/index/index' },
    '无商家身份深链误入必须静默回会员中心,不弹整屏页')

  const view = read('pages/merchant/relation/index.wxml')
  assertNoLoginGate(view)
  assert.match(view, /<cy-inline-error[^>]*wx:elif="\{\{pageState === 'error'\}\}"[\s\S]{0,200}?bind:action="retryRelation"/)
})

function assertNoLoginGate(view) {
  assert.doesNotMatch(view, /登录已失效|去登录|goLogin|goWorkbench/, '整屏登录/无权限闸必须删除')
  assert.match(view, /<cy-inline-error[^>]*wx:elif="\{\{pageState === 'error'\}\}"[\s\S]{0,200}?bind:action="retryRelation"/)
}

test('负控:把未登录整屏 cy-empty 加回合作页必须判红', () => {
  const view = read('pages/merchant/relation/index.wxml')
  const mutated = view.replace(
    /<cy-inline-error class="rel-inline-error" wx:elif="\{\{pageState === 'error'\}\}"/,
    '<cy-empty wx:elif="{{pageState === \'anonymous\'}}" title="登录已失效" cta="去登录" bind:cta="goLogin" />\n    <cy-inline-error class="rel-inline-error" wx:elif="{{pageState === \'error\'}}"',
  )
  assert.notEqual(mutated, view, '负控锚点失效')
  assert.throws(() => assertNoLoginGate(mutated), /整屏登录\/无权限闸必须删除/)
})

test('合作页未登录先静默登录,失败只落页内错误态', async () => {
  const first = createPage({ memberId: '', sessionResult: { ok: false } })
  first.page.onLoad({})
  assert.equal(first.requests.length, 0, '登录没成功不该发合作请求')
  await flush()
  assert.equal(first.page.data.pageState, 'error')
  assert.equal(first.page.data.error, '登录失败，请重试')

  const second = createPage({ memberId: '' })
  second.page.onLoad({})
  await flush()
  assert.equal(second.requests.length, 1, '静默登录成功后必须自动加载')
})

test('合作页异常回调与缺少可访问主体的商家卡都不会落成空态', () => {
  const { page, requests } = createPage()
  page.onLoad({})
  requests[0].successStatusAbnormal({ msg: 'upstream abnormal' })
  requests[0].complete()
  assert.equal(page.data.pageState, 'error')

  page.loadRelationHome()
  requests[1].success(relationHome({
    data: {
      stats: { merchantCount: 0, clubCount: 0, pendingCoopCount: 0 },
      relations: [],
      discovery: { merchants: [{ id: 2, name: '没有 memberId 的商家' }], clubs: [] },
    },
  }))
  assert.equal(page.data.merchants.length, 0)
  assert.equal(page.data.merchantError, '部分商家资料暂无法显示')
})

test('合作页下拉刷新收口刷新态，卸载后迟到响应无效', () => {
  const { page, requests, stopped } = createPage()
  page.onLoad({})
  requests[0].success(relationHome())
  requests[0].complete()

  page.onPullDownRefresh()
  assert.equal(page.data.refreshing, true)
  page.onUnload()
  requests[1].success(relationHome({
    data: {
      stats: { merchantCount: 0, clubCount: 0, pendingCoopCount: 0 },
      relations: [],
      discovery: { merchants: [{ id: 9, memberId: 90, name: '迟到商家' }], clubs: [] },
    },
  }))
  requests[1].complete()

  assert.deepEqual(page.data.merchants, [])
  assert.equal(stopped(), 1)
  const config = JSON.parse(read('pages/merchant/relation/index.json'))
  assert.equal(config.enablePullDownRefresh, true)
})

// CU-M-97:合作 Tab 俱乐部卡按钮写「发起合作」,实点却只进俱乐部主页,要再点一次才到表单。
// 现约定:整卡正文 = 看资料(goClub → 俱乐部主页),按钮 = 直达 coop/invite type=1 表单。
test('CU-M-97 俱乐部卡按钮直达邀约表单,整卡仍进俱乐部主页', () => {
  const { page, requests, navigations } = createPage()
  page.onLoad({ topicId: '990029', topicName: '隔离走查样本' })
  requests[0].success(relationHome({
    data: {
      stats: { merchantCount: 0, clubCount: 1, pendingCoopCount: 0 },
      relations: [],
      discovery: {
        merchants: [],
        clubs: [{ id: 7, name: '城瘾跑团', logo: 'club-logo.png', memberCount: 12, city: '上海' }],
      },
    },
  }))

  page.goClubCoop({ currentTarget: { dataset: { id: 7 } } })
  const cta = navigations.at(-1)
  assert.equal(cta.method, 'navigateTo')
  assert.match(cta.url, /^\/pages\/coop\/invite\/index\?type=1&toId=7/, '按钮必须走邀约表单而不是主页')
  assert.ok(cta.url.includes('toName=' + encodeURIComponent('城瘾跑团')), '带合作对象名,表单不用再选')
  assert.ok(cta.url.includes('toMeta=' + encodeURIComponent('12 位成员 · 上海')))
  assert.ok(cta.url.includes('topicId=990029'), '从主题进来时要把主题带进表单')

  page.goClub({ currentTarget: { dataset: { id: 7 } } })
  assert.match(navigations.at(-1).url, /^\/pages\/club\/detail\/index\?id=7/, '整卡仍是看资料')

  const view = read('pages/merchant/relation/index.wxml')
  assert.match(view, /<cy-club-card[^>]*bind:tap="goClub"[^>]*bind:action="goClubCoop"/,
    '卡片动作与点击必须分流')
})

test('负控:把俱乐部卡按钮动作改回 goClub,CU-M-97 契约会变红', () => {
  const { page, requests, navigations } = createPage()
  page.onLoad({})
  requests[0].success(relationHome({
    data: {
      stats: { merchantCount: 0, clubCount: 1, pendingCoopCount: 0 },
      relations: [],
      discovery: { merchants: [], clubs: [{ id: 7, name: '城瘾跑团' }] },
    },
  }))
  const broken = page.goClub.bind(page)
  broken({ currentTarget: { dataset: { id: 7 } } })
  assert.doesNotMatch(navigations.at(-1).url, /coop\/invite/, '旧行为只进主页 —— 这正是本条要修的')
  const mutated = read('pages/merchant/relation/index.wxml')
    .replace('bind:action="goClubCoop"', 'bind:action="goClub"')
  assert.throws(() => assert.match(
    mutated, /<cy-club-card[^>]*bind:tap="goClub"[^>]*bind:action="goClubCoop"/))
})
