const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { TEMPLATES } = require('../../utils/subscribe.js')

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function applyDataPatch(target, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = target
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!cursor[parts[index]]) cursor[parts[index]] = {}
      cursor = cursor[parts[index]]
    }
    cursor[parts[parts.length - 1]] = value
  })
}

function createPage(relativePath, appOverrides = {}, wxOverrides = {}) {
  const requests = []
  const navigations = []
  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(request) { requests.push(request) },
    getRequestErrorMessage(_response, fallback) { return fallback },
  }, appOverrides)

  global.getApp = () => app
  global.wx = Object.assign({
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getStorageSync: () => undefined,
    navigateTo: ({ url }) => navigations.push(url),
    setNavigationBarColor() {},
    setBackgroundColor() {},
    showToast() {},
  }, wxOverrides)

  let definition
  global.Page = (pageDefinition) => { definition = pageDefinition }
  const modulePath = path.join(ROOT, relativePath)
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)

  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  if (relativePath === 'pages/merchant/citynode/index.js') {
    page.data.accessState = 'ready'
    page.data.merchantAccess = { active: true, canManageProjects: true, canVerify: true }
  }
  page.setData = function (patch, done) {
    applyDataPatch(this.data, patch)
    if (typeof done === 'function') done()
  }
  return { page, requests, navigations }
}

function createComponent(relativePath, appOverrides = {}) {
  const requests = []
  const events = []
  const app = Object.assign({
    globalData: {},
    sendRequest(request) { requests.push(request) },
  }, appOverrides)

  global.getApp = () => app
  global.wx = {}
  let definition
  global.Component = (componentDefinition) => { definition = componentDefinition }
  const modulePath = path.join(ROOT, relativePath)
  delete require.cache[require.resolve(modulePath)]
  require(modulePath)

  const component = Object.assign({}, definition.methods)
  component.data = JSON.parse(JSON.stringify(definition.data || {}))
  Object.entries(definition.properties || {}).forEach(([key, property]) => {
    if (!(key in component.data)) component.data[key] = property.value
  })
  component.setData = function (patch, done) {
    applyDataPatch(this.data, patch)
    if (typeof done === 'function') done()
  }
  component.triggerEvent = (name, detail) => events.push({ name, detail })
  return { component, requests, events }
}

test('海报码只有收到非空 qrcodeUrl 才进入成功态，缺字段保留 poiId 并可重试', () => {
  const { page, requests } = createPage('pages/merchant/citynode/index.js')

  page.showPosterCode({ currentTarget: { dataset: { poiid: '17' } } })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].data.poiId, '17')
  assert.equal(page.data.posterSheet.show, true)
  assert.equal(page.data.posterSheet.poiId, '17')
  assert.equal(page.data.posterSheet.state, 'loading')

  requests[0].success({ code: 200, data: { nodeName: '河畔书店' } })
  assert.equal(page.data.posterSheet.state, 'error')
  assert.equal(page.data.posterSheet.qrcodeUrl, '')
  assert.equal(page.data.posterSheet.poiId, '17')

  page.retryPosterCode()
  assert.equal(requests.length, 2)
  assert.equal(requests[1].data.poiId, '17')
  requests[1].success({ code: '200', data: { qrcodeUrl: 'https://img.example/code.png', nodeName: '河畔书店' } })
  assert.equal(page.data.posterSheet.state, 'ready')
  assert.equal(page.data.posterSheet.qrcodeUrl, 'https://img.example/code.png')

  const blank = createPage('pages/merchant/citynode/index.js')
  blank.page.showPosterCode({ currentTarget: { dataset: { poiid: '18' } } })
  blank.requests[0].success({ code: 200, data: { qrcodeUrl: '   ' } })
  assert.equal(blank.page.data.posterSheet.state, 'error')

  const business = createPage('pages/merchant/citynode/index.js')
  business.page.showPosterCode({ currentTarget: { dataset: { poiid: '19' } } })
  business.requests[0].success({ code: 500, data: { qrcodeUrl: 'https://img.example/should-not-open.png' } })
  assert.equal(business.page.data.posterSheet.state, 'error')

  const network = createPage('pages/merchant/citynode/index.js')
  network.page.showPosterCode({ currentTarget: { dataset: { poiid: '20' } } })
  network.requests[0].fail()
  assert.equal(network.page.data.posterSheet.state, 'error')

  const closed = createPage('pages/merchant/citynode/index.js')
  closed.page.showPosterCode({ currentTarget: { dataset: { poiid: '21' } } })
  closed.page.closePosterCode()
  closed.requests[0].success({ code: 200, data: { qrcodeUrl: 'https://img.example/late.png' } })
  assert.equal(closed.page.data.posterSheet.show, false)

  const latest = createPage('pages/merchant/citynode/index.js')
  latest.page.loadPosterCode('22')
  latest.page.loadPosterCode('23')
  latest.requests[0].success({ code: 200, data: { qrcodeUrl: 'https://img.example/stale.png' } })
  assert.equal(latest.page.data.posterSheet.poiId, '23')
  assert.equal(latest.page.data.posterSheet.state, 'loading')
  latest.requests[1].success({ code: 200, data: { qrcodeUrl: 'https://img.example/latest.png' } })
  assert.equal(latest.page.data.posterSheet.state, 'ready')
  assert.equal(latest.page.data.posterSheet.qrcodeUrl, 'https://img.example/latest.png')

  const view = read('pages/merchant/citynode/index.wxml')
  assert.match(view, /posterSheet\.state === 'error'[\s\S]*bind:retry="retryPosterCode"/)
  assert.doesNotMatch(view, /二维码暂不可用/)
})

test('招牌主推把请求失败与成功空数组分开，错误可重试且真空态可发布活动', () => {
  const business = createPage('pages/merchant/decor/index.js')
  business.page.openFeatured()
  assert.equal(business.page.data.featuredState, 'loading')
  assert.deepEqual(business.page.data.featuredList, [])

  business.requests[0].success({ code: 500, msg: '服务异常' })
  assert.equal(business.page.data.featuredState, 'error')
  assert.deepEqual(business.page.data.featuredList, [])

  business.page.retryFeatured()
  assert.equal(business.requests.length, 2)
  business.requests[1].success({ code: 200, data: { rows: [] } })
  assert.equal(business.page.data.featuredState, 'ready')
  assert.deepEqual(business.page.data.featuredList, [])
  business.page.goPublishActivity()
  // 2026-09-25 CU-M-05 商家主办单场活动:这一路是商家入口,必须带 scope ——
  // 不带的话发布页按俱乐部主理人判身份,商家点进去被拦回品牌中心且没有任何失败提示。
  // 旧值 '/pages/publish/activity/index'。
  assert.deepEqual(business.navigations, ['/pages/publish/activity/index?scope=MERCHANT'])

  const network = createPage('pages/merchant/decor/index.js')
  network.page.openFeatured()
  network.requests[0].fail()
  assert.equal(network.page.data.featuredState, 'error')

  const malformed = createPage('pages/merchant/decor/index.js')
  malformed.page.openFeatured()
  malformed.requests[0].success({ code: 200, data: {} })
  assert.equal(malformed.page.data.featuredState, 'error')

  const latest = createPage('pages/merchant/decor/index.js')
  latest.page.openFeatured()
  latest.page.closeFeatured()
  latest.page.openFeatured()
  latest.requests[0].success({ code: 200, data: { rows: [{ id: 1, name: '旧活动' }] } })
  assert.equal(latest.page.data.featuredState, 'loading')
  assert.deepEqual(latest.page.data.featuredList, [])
  latest.requests[1].success({ code: 200, data: { rows: [{ id: 2, name: '新活动' }] } })
  assert.equal(latest.page.data.featuredState, 'ready')
  assert.deepEqual(latest.page.data.featuredList.map(item => item.id), [2])

  const view = read('pages/merchant/decor/index.wxml')
  assert.match(view, /featuredState === 'error'[\s\S]*bindtap="retryFeatured"/)
  assert.match(view, /featuredState === 'ready' && !featuredList\.length[\s\S]*bindtap="goPublishActivity"/)
})

test('团码页面与真实 scene owner 都把成功零场次落到 empty，失败继续落 error', () => {
  const pageHarness = createPage('pages/club/group-code/index.js')
  pageHarness.page.data.topicId = '9'
  pageHarness.page.selectActivity()
  pageHarness.requests[0].success({ code: 200, data: { activityList: [] } })
  assert.equal(pageHarness.page.data.state, 'empty')
  assert.deepEqual(pageHarness.page.data.activityOptions, [])

  const failedPage = createPage('pages/club/group-code/index.js')
  failedPage.page.data.topicId = '9'
  failedPage.page.selectActivity()
  failedPage.requests[0].success({ code: 500, data: { activityList: [] } })
  assert.equal(failedPage.page.data.state, 'error')

  const networkPage = createPage('pages/club/group-code/index.js')
  networkPage.page.data.topicId = '9'
  networkPage.page.selectActivity()
  networkPage.requests[0].fail()
  assert.equal(networkPage.page.data.state, 'error')

  const sceneHarness = createComponent('components/cy/scene-qr-group-code/index.js')
  sceneHarness.component.data.topicId = '9'
  sceneHarness.component.start('', '9')
  sceneHarness.requests[0].success({ code: '200', data: { activityList: [] } })
  assert.equal(sceneHarness.component.data.state, 'empty')
  assert.deepEqual(sceneHarness.component.data.options, [])

  const failedScene = createComponent('components/cy/scene-qr-group-code/index.js')
  failedScene.component.data.topicId = '9'
  failedScene.component.start('', '9')
  failedScene.requests[0].success({ code: 500, msg: '服务异常' })
  assert.equal(failedScene.component.data.state, 'error')

  const malformedScene = createComponent('components/cy/scene-qr-group-code/index.js')
  malformedScene.component.data.topicId = '9'
  malformedScene.component.start('', '9')
  malformedScene.requests[0].success({ code: 200, data: {} })
  assert.equal(malformedScene.component.data.state, 'error')

  const networkScene = createComponent('components/cy/scene-qr-group-code/index.js')
  networkScene.component.data.topicId = '9'
  networkScene.component.start('', '9')
  networkScene.requests[0].fail()
  assert.equal(networkScene.component.data.state, 'error')

  assert.match(read('pages/club/group-code/index.wxml'), /state === 'selecting' \|\| state === 'empty'[\s\S]*state === 'empty'[\s\S]*暂无可带队的场次/)
  assert.match(read('components/cy/scene-qr-group-code/index.wxml'), /state === 'empty'[\s\S]*暂无可带队的场次[\s\S]*bind:cta="close"/)
})

// 2026-08-09:合作页本身就是发现列表(商家 / 俱乐部两个 tab),空态再挂一个「发现合作对象」
// CTA 跳另一个选择器是自指。CTA 与 goCoopDiscovery 一并删除,空态只留说明。
test('合作页两个发现 tab 各自有空态，且不再自指到另一个选择器', () => {
  const { page } = createPage('pages/merchant/relation/index.js')
  assert.equal(typeof page.goCoopDiscovery, 'undefined')

  const view = read('pages/merchant/relation/index.wxml')
  assert.doesNotMatch(view, /cta="发现合作对象"|goCoopDiscovery/)
  assert.match(view, /activeTab === 'merchant'[\s\S]*title="暂无可合作商家"[\s\S]*title="暂无可合作俱乐部"/)
})

test('附近商家权限态打开设置后重新定位，成功空态可刷新附近商家', () => {
  const locations = []
  let settings
  const { page } = createPage('pages/coop/nearby/index.js', {}, {
    getLocation(options) { locations.push(options) },
    openSetting(options) { settings = options },
  })

  page.onLoad({})
  assert.equal(locations.length, 1)
  locations[0].fail({ errMsg: 'getLocation:fail auth deny' })
  assert.equal(page.data.pageState, 'permission')

  page.openLocationSettings()
  assert.ok(settings)
  settings.success({ authSetting: { 'scope.userLocation': true } })
  assert.equal(locations.length, 2)
  assert.equal(page.data.pageState, 'loading')

  const view = read('pages/coop/nearby/index.wxml')
  assert.match(view, /pageState === 'permission'[^>]*cta="去设置"[^>]*bind:cta="openLocationSettings"/)
  assert.match(view, /wx:else[^>]*cta="刷新附近商家"[^>]*bind:cta="retry"/)
})

test('合作中心路线与官方活动都有 true-empty，并复用同一个刷新合作机会动作', () => {
  const { page, requests } = createPage('pages/merchant/coop-center/index.js')
  page.loadAvailable()
  assert.deepEqual(requests.map(request => request.url), [
    '/api/merchant/marketing-home',
    '/api/official/events',
  ])

  const view = read('pages/merchant/coop-center/index.wxml')
  assert.equal((view.match(/cta="刷新合作机会"/g) || []).length, 2)
  assert.equal((view.match(/bind:cta="loadAvailable"/g) || []).length, 2)
  // CU-M-134:两段空态都只留一行「还没有…」+ 一个真动作;原来那句 sub 只是把标题换个说法
  // 再念一遍,还带着「平台…」的内部口径。
  assert.doesNotMatch(view, /暂无(官方活动|开放路线)/)
  assert.match(view, /!routes\.length[^>]*title="还没有开放的路线"[^>]*cta="刷新合作机会"/)
  assert.match(view, /!events\.length[^>]*title="还没有官方活动"[^>]*cta="刷新合作机会"/)
})

// 2026-09-15 入口随「邀约我的」tab 收进协作邀请「收到的」;回执走页内 actionReceipt(与本页其他动作同一出口)
test('协作邀请「收到的」由受邀方主动点击开启邀约提醒，并消费授权结果', async () => {
  const calls = []
  const { page } = createPage('pages/coop/list/index.js', {}, {
    requestSubscribeMessage(options) {
      calls.push(options.tmplIds)
      options.success({ [options.tmplIds[0]]: 'accept' })
    },
  })

  await page.enableInviteAlerts()
  assert.deepEqual(calls, [[TEMPLATES.coopInvited]])
  assert.equal(page.data.actionReceipt, '已开启邀约提醒')
  assert.match(read('pages/coop/list/index.wxml'), /bindtap="enableInviteAlerts"/)
})

test('收藏页只保留帖文与主题数据链，不回流退役活动与商家状态', () => {
  const { page, requests } = createPage('pages/mylike/mylike.js')
  page.loadLikeData()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/creativesquare/list')
  assert.equal(requests[0].data.favorite_only, 1)

  const source = read('pages/mylike/mylike.js')
  assert.match(source, /activeFavoriteTab/)
  assert.doesNotMatch(source, /ztList2|merchantList/)
  assert.doesNotMatch(source, /getActivityLikeList|getMerchantLikeList|activityUnlike|merchantUnlike|goActivity|goMerchant/)
  assert.doesNotMatch(source, /buildActivityShare|openScene/)

  const matrix = read('scripts/shot-matrix.js')
  assert.doesNotMatch(matrix, /A46-mylike-merchant|A47-mylike-activity/)
  assert.match(matrix, /A45-mylike-topic[^\n]*ztList1:[^\n]*favorite-card/)

  const settings = read('pages/shezhi/shezhi.wxml')
  const entry = settings.match(/<cy-cell\b[^>]*title="我的收藏"[^>]*>/)
  const emptyNoun = read('pages/mylike/mylike.wxml').match(/title="暂无收藏的([^"]+)"/)
  assert.ok(entry && emptyNoun, '设置入口与收藏空态都必须可解析')
  const description = entry[0].match(/description="([^"]*)"/)
  assert.ok(description && description[1].includes(emptyNoun[1]), '设置入口描述必须跟随收藏页当前唯一数据域')
  assert.doesNotMatch(description[1], /路线|场次/, '已退役的数据域不得继续出现在入口描述')
})

test('收藏页首展由 onLoad 单独请求，第一次 onShow 不制造第二个 page=1', () => {
  const { page, requests } = createPage('pages/mylike/mylike.js')
  page.onLoad({})
  page.onShow()
  assert.equal(requests.length, 1, '首展两个生命周期合计只能发一次请求')
  assert.equal(requests[0].data.pageNum, 1)
})

test('收藏页第二次 onShow 会从 page=1 刷新，且仍经过 loading 守卫', () => {
  const { page, requests } = createPage('pages/mylike/mylike.js')
  page.onLoad({})
  page.onShow()
  requests[0].complete()

  page.onShow()
  assert.equal(requests.length, 2, '返回收藏页必须重新读取服务端列表')
  assert.equal(requests[1].data.pageNum, 1)

  page.onShow()
  assert.equal(requests.length, 2, '刷新请求在途时不得再绕过 loading 守卫并发同页请求')
})

test('收藏接口 200 空 payload 不得崩溃或伪装成真实空列表', () => {
  const { page, requests } = createPage('pages/mylike/mylike.js')
  page.loadLikeData()

  assert.doesNotThrow(() => requests[0].success({ code: 200, data: null }))
  requests[0].complete()

  assert.equal(page.data.loading, false)
  assert.equal(page.data.errorMsg, '收藏帖文加载失败')
})
