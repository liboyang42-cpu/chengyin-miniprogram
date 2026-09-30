'use strict'

// 第二轮拍板 17:朋友发来的「XX路线 已完成」足迹卡,点开直接看到那条足迹(路线轨迹 + 成绩)。
// 原症状:subpackageRoam/session 的 onShareAppMessage path 写死 /pages/roam/index,接收方只看到漫游首页。
// 轨迹只在分享者本机 ⇒ 分享时上传「已过位置隐私闸」的快照,path 带随机令牌,接收页只读快照。
const test = require('node:test')
const assert = require('node:assert/strict')
const snapshot = require('../../utils/roam-share-snapshot.js')

// release-0917 集成:形状约束是「32 位十六进制」,与熵无关;原随机形状值被 gitleaks generic-api-key 按熵判成疑似密钥,
// 按 #1076 先例用重复段降熵(不写 .gitleaksignore)。
const TOKEN = 'abcdef01'.repeat(4)
// 一条 2km 直线:第一个点就是「家门口」。
const RAW_TRACK = Array.from({ length: 21 }, (_, i) => ({ lat: 31.2 + i * 0.001, lng: 121.4 }))
const SESSION = {
  ts: 1717243200000, routeName: '武康大楼等2处足迹回看', time: '25:00', distance: 3.2, explorePct: 68, shops: 4,
  medal: '', shopMedalName: '', track: RAW_TRACK,
  pois: [{ name: '武康大楼', cat: 'landmark', catLabel: '地标', lat: 31.205, lng: 121.4, iconName: 'poi-landmark' }],
}

function memoryStorage(initial) {
  const data = Object.assign({}, initial)
  return {
    data,
    getStorageSync: (key) => (key in data ? data[key] : ''),
    setStorageSync: (key, value) => { data[key] = value },
    removeStorageSync: (key) => { delete data[key] },
  }
}

function fakeApp(reply, userId) {
  const sent = []
  return {
    sent,
    getUserID: () => (userId == null ? '9' : userId),
    sendRequest(options) {
      sent.push(options)
      const res = reply(options)
      if (res === 'fail') options.fail({ errMsg: 'request:fail' })
      else if (res) options.success(res)
    },
  }
}

test('拍板17 上传分享卡已裁剪的真实轨迹,由服务端统一量化', () => {
  const payload = snapshot.buildSharePayload(SESSION, { clipEnabled: true, clipPercent: 10 })
  assert.ok(payload.track.length >= 2)
  const span = (track) => track[track.length - 1].lat - track[0].lat
  assert.ok(span(payload.track) < 0.02 - 0.003, '首尾按设置各裁掉约 10%(原始跨度 0.02°)')
  assert.ok(Math.abs(payload.track[0].lat - 31.202) < 1e-9, '服务端必须收到真实坐标才能守住信任边界')
  assert.equal(payload.track[0].lng, 121.4)
  assert.equal(payload.pois[0].lat, 31.205)
  assert.deepEqual(Object.keys(payload.pois[0]), ['name', 'cat', 'catLabel', 'lat', 'lng'], '只带展示字段')
  assert.equal(payload.shops, 4)
  // 负控:关掉裁剪时跨度就是原始整段 —— 证明上面的断言确实在测裁剪,不是恒真。
  const unclipped = snapshot.buildSharePayload(SESSION, { clipEnabled: false, clipPercent: 10 })
  assert.ok(Math.abs(span(unclipped.track) - 0.02) < 1e-6)
})

test('拍板17 发布:成功拿令牌;可见范围仅自己不发布;接口失败给出原因', async () => {
  const ok = fakeApp(() => ({ code: 200, data: { token: TOKEN } }))
  assert.deepEqual(await snapshot.publishShareSnapshot(ok, memoryStorage(), SESSION), { token: TOKEN, reason: '' })
  assert.equal(ok.sent[0].url, '/api/roam/share/snapshot')
  assert.equal(ok.sent[0].data.clientTs, SESSION.ts)
  assert.equal(JSON.parse(ok.sent[0].data.snapshot).routeName, '武康大楼等2处足迹回看')

  const privateApp = fakeApp(() => ({ code: 200, data: { token: TOKEN } }))
  const privateStorage = memoryStorage({ roam_share_privacy: { visibility: 'private' } })
  assert.deepEqual(await snapshot.publishShareSnapshot(privateApp, privateStorage, SESSION), { token: '', reason: 'private' })
  assert.equal(privateApp.sent.length, 0)

  const broken = fakeApp(() => ({ code: 500, msg: 'x' }))
  assert.deepEqual(await snapshot.publishShareSnapshot(broken, memoryStorage(), SESSION), { token: '', reason: 'failed' })
  const badToken = fakeApp(() => ({ code: 200, data: { token: '../../x' } }))
  assert.equal((await snapshot.publishShareSnapshot(badToken, memoryStorage(), SESSION)).token, '')
})

test('拍板17 作废没成功时留待办;下次发布先补作废,补不成就不发布新快照', async () => {
  const storage = memoryStorage()
  const offline = fakeApp(() => 'fail')
  assert.equal(await snapshot.revokeShareSnapshots(offline, storage), false)
  assert.equal(storage.data[snapshot.revokePendingKey(offline)], 1)
  // 换 B 账号:A 的待办标记不属于 B,B 发布不去补作废,也清不掉 A 的标记。
  const other = fakeApp(() => ({ code: 200, data: { token: TOKEN } }), '10')
  assert.equal((await snapshot.publishShareSnapshot(other, storage, SESSION)).token, TOKEN)
  assert.deepEqual(other.sent.map((o) => o.url), ['/api/roam/share/snapshot'])
  assert.equal(storage.data[snapshot.revokePendingKey(offline)], 1)

  const stillOffline = fakeApp((o) => (o.url === '/api/roam/share/revoke' ? 'fail' : { code: 200, data: { token: TOKEN } }))
  assert.deepEqual(await snapshot.publishShareSnapshot(stillOffline, storage, SESSION), { token: '', reason: 'revoke-pending' })
  assert.deepEqual(stillOffline.sent.map((o) => o.url), ['/api/roam/share/revoke'], '旧链接没作废前不发新链接')

  const online = fakeApp((o) => (o.url === '/api/roam/share/revoke' ? { code: 200, data: { revoked: 2 } } : { code: 200, data: { token: TOKEN } }))
  assert.equal((await snapshot.publishShareSnapshot(online, storage, SESSION)).token, TOKEN)
  assert.deepEqual(online.sent.map((o) => o.url), ['/api/roam/share/revoke', '/api/roam/share/snapshot'])
  assert.equal(storage.data[snapshot.revokePendingKey(online)], undefined)
})

test('拍板17 接收方读取:有 = ready;分享者已作废 = gone;断网 = error(可重试)', async () => {
  const ready = fakeApp(() => ({ code: 200, data: { ts: 1, routeName: '外滩', track: [], pois: [] } }))
  assert.equal((await snapshot.readShareSnapshot(ready, TOKEN)).state, 'ready')
  assert.deepEqual(ready.sent[0].data, { token: TOKEN })
  assert.equal(ready.sent[0].method, 'GET')
  assert.equal((await snapshot.readShareSnapshot(fakeApp(() => ({ code: 500, msg: '这条足迹已不再公开' })), TOKEN)).state, 'gone')
  assert.equal((await snapshot.readShareSnapshot(fakeApp(() => 'fail'), TOKEN)).state, 'error')
  const neverSent = fakeApp(() => null)
  assert.equal((await snapshot.readShareSnapshot(neverSent, 'not-a-token')).state, 'gone')
  assert.equal(neverSent.sent.length, 0, '非法令牌不发请求')
})

// ---------- 页面:接收方落地 ----------
const PAGE_MODULE = '../../subpackageRoam/session/index.js'
let pageConfig
function loadPage(app, storage) {
  global.Page = (config) => { pageConfig = config }
  global.getApp = () => app
  global.wx = Object.assign({ switchTab() {}, navigateBack() {} }, storage)
  delete require.cache[require.resolve(PAGE_MODULE)]
  require(PAGE_MODULE)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = (patch, cb) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.split('.')
      let cursor = page.data
      parts.slice(0, -1).forEach((part) => { cursor = cursor[part] = cursor[part] || {} })
      cursor[parts[parts.length - 1]] = value
    })
    if (cb) cb()
  }
  return page
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('拍板17 朋友点开带令牌的分享:不读本机、只读快照,直接看到那条足迹;再转发沿用同一令牌', async () => {
  const shared = { ts: 1717243200000, routeName: '外滩夜走', time: '42:05', distance: 3.2, track: [{ lat: 31.2, lng: 121.4 }, { lat: 31.21, lng: 121.41 }], pois: [] }
  const app = Object.assign(fakeApp(() => ({ code: 200, data: shared })), { globalData: {}, getUserID: () => '' })
  let storageReads = 0
  const page = loadPage(app, { getStorageSync: () => { storageReads += 1; return '' } })
  page.onLoad({ shareToken: TOKEN })
  await flush()
  assert.equal(app.sent[0].url, '/api/roam/share/snapshot')
  assert.equal(page.data.sharedState, 'ready')
  assert.equal(page.data.snapshot.routeName, '外滩夜走')
  assert.equal(page.data.s.routeName, '外滩夜走')
  assert.equal(storageReads, 0, '接收方本机没有也不该读分享者的足迹')
  page.onShow()
  assert.equal(app.sent.length, 1, 'onShow 不回退去读本机')
  assert.equal(page.onShareAppMessage().path, '/subpackageRoam/session/index?shareToken=' + TOKEN)
})

test('拍板17 分享者已作废 / 断网:落页内空态或重试,不冒充成一条空足迹', async () => {
  const gone = Object.assign(fakeApp(() => ({ code: 500, msg: '这条足迹已不再公开' })), { globalData: {}, getUserID: () => '' })
  const gonePage = loadPage(gone, { getStorageSync: () => '' })
  gonePage.onLoad({ shareToken: TOKEN })
  await flush()
  assert.equal(gonePage.data.sharedState, 'gone')
  assert.equal(gonePage.data.snapshot, null)
  assert.equal(gonePage.onShareAppMessage().path, '/pages/roam/index', '已失效的令牌不再往外转')

  let first = true
  const flaky = Object.assign(fakeApp(() => { if (first) { first = false; return 'fail' } return { code: 200, data: { ts: 1, track: [], pois: [] } } }), { globalData: {}, getUserID: () => '' })
  const flakyPage = loadPage(flaky, { getStorageSync: () => '' })
  flakyPage.onLoad({ shareToken: TOKEN })
  await flush()
  assert.equal(flakyPage.data.sharedState, 'error')
  await flakyPage.retryShared()
  assert.equal(flakyPage.data.sharedState, 'ready')
})

test('拍板17 分享者没开面板直接右上角转发:先发布再带令牌;发布失败仍落漫游首页', async () => {
  const app = Object.assign(fakeApp(() => ({ code: 200, data: { token: TOKEN } })), { globalData: {}, getUserID: () => '9' })
  const page = loadPage(app, { getStorageSync: () => '' })
  page._sessionOwner = '9'
  page._setSessionView(Object.assign({}, SESSION))
  const share = page.onShareAppMessage()
  assert.equal(share.path, '/pages/roam/index', '同步兜底 path')
  assert.equal((await share.promise).path, '/subpackageRoam/session/index?shareToken=' + TOKEN)

  const failing = Object.assign(fakeApp(() => ({ code: 500, msg: 'x' })), { globalData: {}, getUserID: () => '9' })
  const page2 = loadPage(failing, { getStorageSync: () => '' })
  page2._sessionOwner = '9'
  page2._setSessionView(Object.assign({}, SESSION))
  assert.equal((await page2.onShareAppMessage().promise).path, '/pages/roam/index')
  assert.equal(page2.data.share.linkReason, 'failed', '面板里要说明链接没生成')
})

test('拍板17 清空本机足迹后,分享出去的足迹链接一起作废', async () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/roam/index.js'), 'utf8')
  const body = src.slice(src.indexOf('confirmClearRoamLocal() {'), src.indexOf('onRoamRightAction()'))
  assert.match(body, /clearLocal\(\)/)
  assert.match(body, /roam-share-snapshot\.js'\)\.revokeShareSnapshots\(getApp\(\), wx\)/, '清空足迹必须作废分享快照')
  const wxml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/roam/index.wxml'), 'utf8')
  assert.match(wxml, /分享出去的足迹链接也会失效/, '确认文案要说清后果')
})

test('拍板17 足迹正文组件收到快照就直接渲染(不读本机),并收起分享按钮', () => {
  let componentConfig
  global.Component = (config) => { componentConfig = config }
  global.Behavior = (config) => config
  global.getApp = () => ({ getUserID: () => '' })
  global.wx = { getStorageSync: () => { throw new Error('接收方不该读本机足迹') } }
  const modulePath = require.resolve('../../components/cy/scene-roam-session/index.js')
  delete require.cache[modulePath]
  require(modulePath)
  const data = Object.assign({}, componentConfig.data, {
    ts: '',
    snapshot: { ts: 1717243200000, routeName: '外滩夜走', time: '42:05', distance: 3.2, shops: 2, explorePct: 12,
      track: [{ lat: 31.2, lng: 121.4 }, { lat: 31.21, lng: 121.41 }], pois: [{ name: '外滩', cat: 'landmark', lat: 31.205, lng: 121.405 }] },
  })
  const instance = Object.assign({ data }, componentConfig.methods)
  instance.setData = (patch) => Object.assign(instance.data, patch)
  instance._load()
  assert.equal(instance.data.state, 'ready')
  assert.equal(instance.data.session.distanceText, '3.2')
  assert.ok(instance.data.routeSegs.length > 0, '朋友能看到路线轨迹')
  const wxml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../components/cy/scene-roam-session/index.wxml'), 'utf8')
  assert.match(wxml, /class="ss-ctaw" wx:if="\{\{!snapshot\}\}"/, '别人的足迹不给「分享足迹卡」按钮')
})
