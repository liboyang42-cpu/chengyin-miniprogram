const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { getScene } = require('../../utils/scene-registry.js')

// 站外稳定深链:上线即长期契约(朋友圈卡片只能带 query、路径焊死在生成它的页上)。
const POI_HOST_ROUTE = '/subpackageRoam/poi-detail/index'

const PAGE_MODULE = '../../pages/searchmap/index.js'
const ROAM_PAGE_MODULE = '../../pages/roam/index.js'
const {
  getNodeLevelStyle,
  buildNodeLevelMarkerStyle,
} = require('../../pages/roam/node-level-style.js')
const {
  ROUTE_COLORS,
  ROUTE_BORDER_COLOR,
} = require('../../utils/play-visual-tokens.js')

function setByPath(target, key, value) {
  const parts = key.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] || {}
    cursor = cursor[part]
  })
  cursor[parts.at(-1)] = value
}

function loadSearchMapPage() {
  let definition
  const requests = []
  const navigations = []
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx }
  const app = {
    globalData: { statusBarHeight: 20 },
    sendRequest(request) { requests.push(request) },
  }

  const wxMock = {
    createMapContext: () => ({}),
    navigateTo(options) { navigations.push(options.url) },
    showToast() {},
  }
  try {
    global.Page = (config) => { definition = config }
    global.getApp = () => app
    global.wx = wxMock
    delete require.cache[require.resolve(PAGE_MODULE)]
    require(PAGE_MODULE)
  } finally {
    global.Page = previous.Page
    global.getApp = previous.getApp
    global.wx = previous.wx
  }

  assert.ok(definition, 'searchmap 必须注册 Page')
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback()
    },
  })
  // 2026-09-16 起 /api/city/nodes 只在「已定位或用户拖过地图」时才发;本文件测的是筛选/导航合同,
  // 统一按「已定位」建模(无定位的提示态在下面有专项用例与负控)。
  page._hasLocation = true
  return { page, requests, navigations, wxMock }
}

function withGlobalWx(wxMock, callback) {
  const previousWx = global.wx
  try {
    global.wx = wxMock
    callback()
  } finally {
    global.wx = previousWx
  }
}

function loadRoamPage() {
  let definition
  const previous = {
    Page: global.Page,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    wx: global.wx,
  }
  try {
    global.Page = (config) => { definition = config }
    global.getApp = () => ({ globalData: { features: {} } })
    global.getCurrentPages = () => []
    global.wx = {}
    delete require.cache[require.resolve(ROAM_PAGE_MODULE)]
    require(ROAM_PAGE_MODULE)
  } finally {
    global.Page = previous.Page
    global.getApp = previous.getApp
    global.getCurrentPages = previous.getCurrentPages
    global.wx = previous.wx
  }

  assert.ok(definition, 'roam 必须注册 Page')
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback()
    },
  })
}

function assertSearchmapNavigation(handler) {
  const navigations = []
  withGlobalWx({ navigateTo(options) { navigations.push(options.url) } }, handler)
  assert.deepEqual(navigations, ['/pages/searchmap/index'])
}

test('漫游工具区提供可达的 searchmap 探索地图入口', () => {
  const page = loadRoamPage()
  assertSearchmapNavigation(() => page.goSearchMap())
})

test('用户填写关键词、品类、探索标签和城市角色后，商家节点请求消费全部四项筛选', () => {
  const { page, requests } = loadSearchMapPage()
  page.setData({
    regionInfo: { latitude: 31.2304, longitude: 121.4737 },
    merchantCategories: [{ id: 9, categoryName: '咖啡馆' }],
  })

  page.onKeywordInput({ detail: { value: '咖啡' } })
  page.onMerchantCategoryChange({ detail: { value: '0' } })
  page.onMerchantTagInput({ detail: { value: '夜间友好' } })
  page.onMerchantRoleInput({ detail: { value: '街区客厅' } })
  page.searchFilter()

  const merchantRequest = requests.find((request) => request.url === '/api/city/nodes')
  assert.ok(merchantRequest, '确认筛选后必须刷新商家节点图层')
  assert.deepEqual(merchantRequest.data, {
    lat: 31.2304,
    lng: 121.4737,
    radius: 20000,
    keyword: '咖啡',
    categoryId: 9,
    tag: '夜间友好',
    cityRole: '街区客厅',
  })
})

function assertMerchantNodesLocationGate(source) {
  assert.match(source, /if \(!this\._hasLocation && !this\._regionUserChosen\) \{/,
    '无定位/未拖图时必须有闸,不能拿兜底坐标去查「附近据点」')
  // UI-14:图例提示胶囊删掉后,merchantNodeNeedLocation 成为只写不读的死状态,已随 UI 一并移除;
  // 闸本身(不发请求 + 不把缺定位伪装成网络错误)保留。
  assert.doesNotMatch(source, /merchantNodeNeedLocation/, '无 UI 消费方后不得再保留死状态位')
}

test('无定位:不发商家据点请求,落「开启定位」状态而不是网络错误', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../pages/searchmap/index.js'), 'utf8')
  assertMerchantNodesLocationGate(source)

  const { page, requests } = loadSearchMapPage()
  page._hasLocation = false
  page._regionUserChosen = false
  page.getMerchantNodes()

  assert.equal(requests.some((request) => request.url === '/api/city/nodes'), false,
    '没有定位时后端只会回 500「缺少定位」,请求不该发出去')
  // UI-14:图例错误提示胶囊删掉后,错误态字段一并移除(不再有可写的「缺定位/网络错误」分行);
  // 闸的判据变成——没有定位就不许有商家图层的请求出去(上一句已断言)。
  assert.equal(page.data.merchantNodesRefreshing, false, '缺定位时商家图层不进入刷新态')

  // 2026-09-18 UI-14:用户要求地图上不再出现两枚图层提示胶囊,
  // 状态与闸保留在 JS,UI 侧的 .smap-legend 整块已删。
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/searchmap/index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /smap-legend/)
})

test('负控:拆掉无定位闸(照发兜底坐标请求)必须判红', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../pages/searchmap/index.js'), 'utf8')
  const broken = source.replace('if (!this._hasLocation && !this._regionUserChosen) {', 'if (false) {')
  assert.notEqual(broken, source, '负控锚点失效:找不到商家据点的定位闸')
  assert.throws(() => assertMerchantNodesLocationGate(broken), assert.AssertionError)
})

test('活动地图接口 200 空 payload 不得崩溃，必须进入可重试错误态', () => {
  const { page, requests } = loadSearchMapPage()
  page.getList()
  const request = requests.find((item) => item.url === '/api/activity/list')

  assert.doesNotThrow(() => request.success({ code: 200, data: null }))
  assert.equal(page.data.listState, 'error')
  assert.equal(page.data.errorMsg, '活动列表没加载出来，请重试')
})

// 地图上的商家 marker 指向的是「据点」(cityNodeId),不是商家主体(merchantId)。
// 两件事必须同时锁,少一件就会出现「调用看似正确、结果仍回旧页」:
//   ① 页面确实是通过 openScene('roam-poi-detail') 走场景注册表,而不是自己拼路由;
//   ② 注册表解析出来的**最终 route** 落在据点宿主上。
// ②靠真实 scene-entry + scene-registry 端到端算出 URL 来锁 —— 注册表被改回旧页时这里就红。
test('商家 marker 点击进入据点深链宿主(调用与最终 route 一起锁)', () => {
  const { page, navigations, wxMock } = loadSearchMapPage()
  page.setData({
    markers: [{ id: 1000042, kind: 'merchant', poiId: 42 }],
  })

  withGlobalWx(wxMock, () => page.onMarkerTap({ markerId: 1000042 }))

  assert.deepEqual(navigations, [`${POI_HOST_ROUTE}?poiId=42`])

  const source = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.js'), 'utf8')
  assert.match(source, /openScene\('roam-poi-detail',\s*\{\s*poiId:/, 'marker 必须走场景注册表,不许自己拼据点路由')
  assert.doesNotMatch(source, /navigateTo\(\{\s*url:\s*'\/pages\/merchant\/profile/, '不得再直连旧商家页')
  assert.equal(getScene('roam-poi-detail').route, POI_HOST_ROUTE, '注册表的据点 route 就是站外稳定深链')
})

test('商家导航负控：活动 marker 不得误进商家主页', () => {
  const { page, navigations } = loadSearchMapPage()
  page.setData({
    markers: [{ id: 7, kind: 'activity', activityId: 7 }],
    list: { 7: { id: 7, title: '活动' } },
  })
  page.onMarkerTap({ markerId: 7 })
  assert.deepEqual(navigations, [])
  assert.equal(page.data.selShow, true)
})

test('nodeLevel 1-4 生成四种 token 对齐的 marker 图形与语义', () => {
  const styles = [1, 2, 3, 4].map(getNodeLevelStyle)
  assert.equal(new Set(styles.map((style) => style.shape)).size, 4)
  assert.equal(new Set(styles.map((style) => style.glyph)).size, 4)
  assert.equal(new Set(styles.map((style) => style.fillColor)).size, 4)
  styles.forEach((style) => {
    assert.ok(ROUTE_COLORS.includes(style.fillColor))
    assert.equal(style.borderColor, ROUTE_BORDER_COLOR)
    assert.match(style.fillToken, /^--cy-play-route(?:-[2-5])?$/)
    assert.equal(style.borderToken, '--cy-play-marker-border')
  })

  const markers = [1, 2, 3, 4].map((level) => buildNodeLevelMarkerStyle(level, 'actionable'))
  assert.equal(new Set(markers.map((marker) => marker.iconKey)).size, 4)
  assert.deepEqual(markers.map((marker) => marker.label), [
    '普通节点',
    '精选节点',
    '官方合作',
    '主题路线',
  ])
})

test('漫游 marker 消费四级 icon，而不是只改尺寸和 zIndex', () => {
  const page = loadRoamPage()
  page.setData({ visit: {}, goal: null, mapReady: false })
  page._pois = [1, 2, 3, 4].map((level) => ({
    id: level,
    lat: 31.23 + level / 1000,
    lng: 121.47 + level / 1000,
    name: '节点' + level,
    cat: 'merchant',
    state: 'seen',
    isCityNode: true,
    nodeLevel: level,
  }))
  page._icons = Object.fromEntries([1, 2, 3, 4].map((level) => [
    'node-level-' + level,
    '/tmp/node-level-' + level + '.png',
  ]))

  page._syncMarkers()

  assert.deepEqual(page.data.markers.map((marker) => marker.iconPath), [
    '/tmp/node-level-1.png',
    '/tmp/node-level-2.png',
    '/tmp/node-level-3.png',
    '/tmp/node-level-4.png',
  ])
  assert.deepEqual(page.data.markers.map((marker) => marker.callout.content.split(' · ')[0]), [
    '● 普通节点',
    '◆ 精选节点',
    '★ 官方合作',
    '⬟ 主题路线',
  ])
})
