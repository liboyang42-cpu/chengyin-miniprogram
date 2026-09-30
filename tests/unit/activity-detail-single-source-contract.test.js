'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function activityHostHasShareAdapter(pageJs, pageWxml) {
  const wxml = read(pageWxml)
  const js = read(pageJs)
  assert.match(wxml, /<cy-scene-play-activity-detail\b/, `${pageWxml}: 必须是活动 Scene 的真实宿主`)
  assert.match(js, /\bactivityShareFromEvent\b/, `${pageJs}: 未接入活动分享 adapter`)
  const adapterStart = js.search(/\bonShareAppMessage\s*(?::\s*function\s*)?\([^)]*\)\s*\{/)
  assert.notEqual(adapterStart, -1, `${pageJs}: 缺少 Page-native onShareAppMessage adapter`)
  assert.match(
    js.slice(adapterStart, adapterStart + 1200),
    /\bactivityShareFromEvent\s*\(/,
    `${pageJs}: onShareAppMessage 没有把 Scene 分享事件交给活动 adapter`,
  )
}

function loadOrderPage() {
  let definition
  const filename = path.join(ROOT, 'subpackageMember/order/order.js')
  const registry = require('../../utils/scene-registry.js')
  const share = require('../../utils/activity-share.js')
  vm.runInNewContext(read('subpackageMember/order/order.js'), {
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 } }),
    Page(value) { definition = value },
    require(request) {
      if (request.endsWith('scene-registry.js')) return registry
      if (request.endsWith('activity-share.js')) return share
      throw new Error(`unexpected dependency: ${request}`)
    },
  }, { filename })
  return definition
}

function loadActivityDetailPage(wx) {
  let definition
  const filename = path.join(ROOT, 'pages/activity/detail/index.js')
  vm.runInNewContext(read('pages/activity/detail/index.js'), {
    getApp: () => ({
      globalData: { statusBarHeight: 20, navBarHeight: 44 },
      getUserRole() { return '' },
      getUserType() { return 1 },
    }),
    wx,
    Page(value) { definition = value },
    require(request) {
      if (request.endsWith('analytics.js')) return { track() {} }
      if (request.endsWith('activity-share.js')) return require('../../utils/activity-share.js')
      if (request.endsWith('scene-entry.js')) return { openScene() {} }
      if (request.endsWith('identity-policy.js')) return { isMerchantView() { return false } }
      if (request.endsWith('merchant-theme.js')) return { merchantPageShow() {}, merchantPageRestore() {} }
      throw new Error(`unexpected dependency: ${request}`)
    },
  }, { filename })
  return definition
}

test('活动详情路由页只保留深链 chrome，正文委托给 play-activity-detail 场景', () => {
  const pageJs = read('pages/activity/detail/index.js')
  const pageWxml = read('pages/activity/detail/index.wxml')
  const componentWxml = read('components/cy/scene-play-activity-detail/index.wxml')

  assert.match(pageWxml, /<cy-scene-play-activity-detail\b/)
  assert.match(pageWxml, /<cy-nav-bar\b/)
  assert.match(pageWxml, /<cy-page-title\b/)
  assert.doesNotMatch(pageWxml, /wx:for=/, '深链壳不得自己渲染活动列表正文')
  assert.doesNotMatch(pageJs, /url:\s*['"]\/api\//, '深链壳不得自己读取活动业务数据')
  assert.doesNotMatch(componentWxml, /<cy-(?:nav-bar|page-title)\b/, '场景正文不得重复宿主标题')
})

test('场景真源保留票务、地图、阵容、节点、评价、取消与分享能力', () => {
  const js = read('components/cy/scene-play-activity-detail/index.js')
  const wxml = read('components/cy/scene-play-activity-detail/index.wxml')

  for (const endpoint of ['/api/activity/info', '/api/activity/cancel', '/api/comment/add']) {
    assert.match(js, new RegExp(endpoint.replaceAll('/', '\\/')))
  }
  assert.match(js, /activity\/baoming\/baoming\?activityId=/)
  assert.match(js, /toTimestamp\(String\(ticket\.endTime\)\)/)
  assert.match(js, /app\.getUserType\(\)\s*==\s*2/)
  assert.match(js, /wx\.openLocation\(/)

  for (const binding of ['info.memberTemplateList', 'info.registrationList', 'info.commentList', 'cancelReason', 'uploadImages']) {
    assert.match(wxml, new RegExp(binding.replace('.', '\\.')))
  }
  assert.match(wxml, /open-type="share"/)
  assert.match(wxml, /disabled="\{\{!canCancel\}\}"[^>]*>确认取消并退款<\/cy-btn>/)
  assert.match(wxml, /disabled="\{\{!canConfirmSignup\}\}"[^>]*>立即报名<\/cy-btn>/)
  assert.match(wxml, /disabled="\{\{!canSubmitComment\}\}"[^>]*>发布评价<\/cy-btn>/)
})

// 2026-08-11:旧「承接商家」页下线,招牌主推(→ 活动详情)按设计文档 §7 明确砍掉,
// 不迁进统一主页 —— 所以这条清单少一项来源页,不是入口悄悄丢了委托。
/* 2026-09-06:pages/topic/index 从这份名单里去掉。
   用户拍板「主题报名没有废弃,是代码写错了」—— 主题页不再把人踢去活动详情页重选一遍票,
   而是就地开弹层选场次 + 票种,选完直接进结算(cy-session-picker,稿 11/11a)。
   它现在压根不打开活动详情,自然也谈不上「用不用 scene adapter 打开它」。
   ⚠️ 其余三个入口一条都没放宽 —— 它们仍然是「去看活动详情」,判据原样保留。 */
test('搜索、地图、我的项目入口都把活动交给可返回的 Scene Page adapter', () => {
  const files = [
    'pages/searchmap/index.js',
    'subpackageA/pages/myproject/index.js',
  ]

  for (const file of files) {
    const source = read(file)
    assert.match(source, /\{\s*openScene\s*\}\s*=\s*require\([^\n]*scene-entry\.js/, `${file}: 缺少可返回 Page adapter 依赖`)
    assert.match(source, /openScene\(['"]play-activity-detail['"],\s*\{\s*id(?:\s*:\s*[\w.]+)?\s*\}\)/, `${file}: 未委托 play-activity-detail`)
  }
})

test('普通来源页入口使用 navigateTo 保留 Page 栈，不得 switchTab 清空来源', () => {
  const sceneEntryPath = require.resolve('../../utils/scene-entry.js')
  const originalWx = global.wx
  const calls = []
  global.wx = {
    navigateTo(options) { calls.push({ method: 'navigateTo', url: options.url }) },
    switchTab(options) { calls.push({ method: 'switchTab', url: options.url }) },
    showToast() {},
  }

  try {
    delete require.cache[sceneEntryPath]
    const { openScene } = require(sceneEntryPath)
    const { getScene } = require('../../utils/scene-registry.js')
    const params = { id: 42, source: '我的项目' }
    const expectedScene = getScene('play-activity-detail', params)
    openScene(expectedScene.id, params)

    assert.equal(calls.length, 1, '一次入口只允许发起一次导航')
    assert.equal(calls[0].method, 'navigateTo', '普通页必须保留来源 Page 栈')
    const target = new URL(calls[0].url, 'https://miniapp.local')
    assert.equal(target.pathname, expectedScene.route, '应打开 registry 声明的 Page adapter')
    for (const [key, value] of Object.entries(params)) {
      assert.equal(target.searchParams.get(key), String(value), `${key}: Scene 参数不得丢失`)
    }
  } finally {
    global.wx = originalWx
    delete require.cache[sceneEntryPath]
  }
})

test('活动 Page adapter 关闭 Scene 时 navigateBack 回来源页，不得切 tab', () => {
  const calls = []
  const page = loadActivityDetailPage({
    navigateBack(options) { calls.push({ method: 'navigateBack', delta: options.delta }) },
    switchTab(options) { calls.push({ method: 'switchTab', url: options.url }) },
  })
  const wxml = read('pages/activity/detail/index.wxml')

  assert.match(wxml, /<cy-scene-play-activity-detail\b[^>]*\bbind:close="goBack"/, 'Scene close 必须接回 Page 返回 adapter')
  page.goBack()
  assert.deepEqual(calls, [{ method: 'navigateBack', delta: 1 }], '关闭活动必须回到原 Page 栈')
})

test('动态发现搜索把活动结果标成 Scene，结果页委托入口 adapter', () => {
  const searchData = read('utils/discover-search.js')
  const resultPage = read('pages/search2/result/index.js')

  assert.match(searchData, /activity:\s*\{[^}]*sceneId:\s*['"]play-activity-detail['"]/)
  assert.match(resultPage, /openScene\(sceneId,\s*\{\s*id\s*\}\)/)
})

test('订单宿主打开活动时 push Scene，关闭后恢复订单详情', () => {
  const page = loadOrderPage()
  const wxml = read('subpackageMember/order/order.wxml')
  const activityHost = wxml.slice(wxml.indexOf("sceneCurrent.id === 'play-activity-detail'"))
  const root = require('../../utils/scene-registry.js').getScene('member-order-detail', { id: 7 })
  const context = {
    data: { sceneStack: [root], sceneCurrent: root },
    setData(patch) { Object.assign(this.data, patch) },
  }

  assert.match(activityHost, /<cy-scene-sheet\b[^>]*\bbind:requestclose="backScene"[^>]*\bbind:back="backScene"/, '活动弹层关闭/返回必须 pop 回订单详情')
  assert.match(activityHost, /<cy-scene-play-activity-detail\b[^>]*\bbind:close="backScene"/, '活动正文 close 必须 pop 回订单详情')
  page.openScene.call(context, { detail: { id: 'play-activity-detail', params: { id: 42 } } })
  assert.deepEqual(Array.from(context.data.sceneStack, scene => scene.id), ['member-order-detail', 'play-activity-detail'])
  page.backScene.call(context)
  assert.deepEqual(Array.from(context.data.sceneStack, scene => scene.id), ['member-order-detail'])
  assert.equal(context.data.sceneCurrent.id, 'member-order-detail')
})

test('直达页宿主保留活动分享 adapter', () => {
  activityHostHasShareAdapter('pages/activity/detail/index.js', 'pages/activity/detail/index.wxml')
})

test('商家台宿主保留活动分享 adapter', () => {
  activityHostHasShareAdapter('pages/merchant/index/index.js', 'pages/merchant/index/index.wxml')
})

test('游玩页宿主保留活动分享 adapter', () => {
  activityHostHasShareAdapter('pages/play/index.js', 'pages/play/index.wxml')
})

test('漫游页宿主保留活动分享 adapter', () => {
  activityHostHasShareAdapter('pages/roam/index.js', 'pages/roam/index.wxml')
})

test('订单页宿主保留活动分享 adapter', () => {
  activityHostHasShareAdapter('subpackageMember/order/order.js', 'subpackageMember/order/order.wxml')
})

test('活动分享 payload 的路由与 Scene registry 真源一致', () => {
  const { activityShareFromEvent, buildActivityShare } = require('../../utils/activity-share.js')
  const { getScene } = require('../../utils/scene-registry.js')
  const activity = { id: 42, name: '夜游苏河', imgUrl: 'https://example.com/cover.jpg' }
  const payload = buildActivityShare(activity)
  const eventPayload = activityShareFromEvent({
    from: 'button',
    target: { dataset: { shareType: 'activity', activityId: activity.id, activityName: activity.name, activityImage: activity.imgUrl } },
  })

  assert.deepEqual(eventPayload, payload, 'Scene 按钮与菜单分享必须产生同一 payload')
  const target = new URL(payload.path, 'https://miniapp.local')
  assert.equal(target.pathname, getScene('play-activity-detail').route, '分享必须指向 registry 的深链 Page adapter')
  assert.equal(target.searchParams.get('id'), String(activity.id), '分享必须保留活动 ID')
  assert.equal(payload.title, activity.name)
  assert.equal(payload.imageUrl, activity.imgUrl)
  assert.equal(activityShareFromEvent({ from: 'menu' }), null)
})

// ---------------------------------------------------------------- CU-M-106 状态徽章同一真源
const SCENE_JS = 'components/cy/scene-play-activity-detail/index.js'

function mountActivityScene(transform) {
  let source = read(SCENE_JS)
  if (transform) {
    const next = transform(source)
    assert.notEqual(next, source, '变异锚点失效(源码已改动?)')
    source = next
  }
  const requests = []
  const absolutePath = path.join(ROOT, SCENE_JS)
  let definition
  const sandbox = {
    Date, Math, Promise, String, Number, Array, Object, JSON, RegExp, Error, console, setTimeout, clearTimeout,
    getApp: () => ({
      globalData: {},
      getUserID: () => 7,
      getUserType: () => 1,
      sendRequest: (options) => requests.push(options),
      getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    }),
    wx: { createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) }) },
    require(id) {
      if (!id.startsWith('.')) return require(id)
      return require(path.resolve(path.dirname(absolutePath), id))
    },
    Component(options) { definition = options },
  }
  vm.runInNewContext(source, sandbox, { filename: absolutePath })
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch) { Object.entries(patch).forEach(([key, value]) => { instance.data[key] = value }) },
    triggerEvent() {},
  }
  Object.entries(definition.methods || {}).forEach(([name, method]) => { instance[name] = method.bind(instance) })
  return { instance, requests }
}

/** 走查那一行:审核通过(status=1)、在架、档期 9/24 09:00 - 10/24 18:00,当天打开详情。 */
function openActivityDetail(harness, overrides) {
  harness.instance.load('5701')
  const req = harness.requests.find((r) => r.url === '/api/activity/info')
  assert.ok(req, '夹具没搭好:场景没有去拉活动详情')
  req.success({
    code: 200,
    data: Object.assign({
      id: 5701, name: '隔离走查样本：商家招牌主推活动', memberId: 7,
      status: 1, publishStatus: 1,
      startDate: '2026-09-24 09:00:00', endDate: '2026-10-24 18:00:00',
      state: 'running', stateText: '进行中',
    }, overrides || {}),
  })
  return harness.instance.data
}

test('CU-M-106 行为:详情的状态徽章读后端那一处生命周期判定,与「我的项目」列表同话', () => {
  const ready = openActivityDetail(mountActivityScene())
  assert.equal(ready.statusText, '进行中',
    '列表按档期说「进行中」,同一行在详情就不许说别的')
  assert.equal(ready.statusVariant, 'success')

  const upcoming = openActivityDetail(mountActivityScene(), { state: 'notStarted', stateText: '未开始' })
  assert.equal(upcoming.statusText, '未开始')
  assert.equal(upcoming.statusVariant, 'neutral')

  const rejected = openActivityDetail(mountActivityScene(), { status: 2, state: 'rejected', stateText: '未通过' })
  assert.equal(rejected.statusText, '未通过')
  assert.equal(rejected.statusVariant, 'danger')

  // 后端没给状态时不许猜一个,老实说待确认。
  const unknown = openActivityDetail(mountActivityScene(), { state: undefined, stateText: undefined })
  assert.equal(unknown.statusText, '状态待确认')

  // 这一页再也不能把 cms_activity.status(审核码)当 official_event 的生命周期码查表。
  assert.doesNotMatch(read(SCENE_JS), /require\('\.\.\/\.\.\/\.\.\/utils\/activity-status\.js'\)/,
    '详情页不得再引那张 0..9 生命周期表:它的 status 是审核码')
})

test('negative control CU-M-106: 把徽章改回按 status 查生命周期表 ⇒ 同一行又变成「即将开始」', () => {
  const revert = (src) => src
    .replace("const { chinaDayStart", "const { activityStatusMeta } = require('../../../utils/activity-status.js')\nconst { chinaDayStart")
    .replace("statusText: nonEmptyString(info.stateText) || '状态待确认',",
      "statusText: activityStatusMeta(info.status).text || '状态待确认',")

  const data = openActivityDetail(mountActivityScene(revert))
  // 病灶形态必须真的给出与列表矛盾的那句话,否则上面那条断言是恒真的。
  assert.equal(data.statusText, '即将开始',
    'status=1 是「审核通过」,被生命周期表念成「即将开始」——这正是走查读到的错话')
  assert.throws(
    () => assert.equal(openActivityDetail(mountActivityScene()).statusText, '即将开始'),
    assert.AssertionError,
    '修复后同一份数据必须说「进行中」,否则本节与正控互不成立',
  )
})
