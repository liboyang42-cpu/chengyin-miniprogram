// F20 负控/回归:漫游结算的持久化距离必须是**原始米数**,不能被展示用的公里字符串吃掉精度。
// 旧码在 _arrive() 里先 ((this._dist)/1000).toFixed(1) 得到展示值 '0.0',
// 再把 parseFloat('0.0') 传给 _postRoamFinish(distanceKm) —— 44.528 米被提交成 0。
// 契约:展示(公里,1 位小数)与请求(米,distanceM)分离,后端收到的永远是原始米数四舍五入。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')

const { m2lat } = require('../../utils/roam-geo.js')

const ROAM_PAGE = '../../pages/roam/index.js'

let pageConfig
let requests
let storage

global.getApp = () => ({
  getUserID: () => '9',
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showLoading() {},
  hideLoading() {},
  showToast() {},
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  pageConfig = null
  requests = []
  storage = {}
})

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
  delete require.cache[require.resolve(ROAM_PAGE)]
  require(ROAM_PAGE)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([path, value]) => setByPath(page.data, path, value))
    if (callback) callback()
  }
  return page
}

// 只保留结算距离链路需要的最小实例态;把重活(定位/彩旗/落盘/揭雾上报)换成桩,
// 让 _arrive → _postRoamFinish → req('/api/roam/finish') 这条真实链路原样跑。
function prepareArrive(page, distM) {
  page.data.visit = { active: false }
  page.data.screen = 'map'
  page.data.paused = false
  page.data.medal = { show: false }
  page._stats = { explorePct: 12, time: '00:03:00', distance: '0.0' }
  page._pois = []
  page._foundRoamPois = {}
  page._sessionPhotos = []
  page._reveals = []
  page._pendingTiles = []
  page._roamSid = '88' // 距离回归使用已由 reveal 建立的真实会话形态
  page._dist = distM
  page._npc = null
  page._eventId = 0
  page._stopClock = () => {}
  page._stopReal = () => {}
  page._triggerCelebration = () => {}
  page._saveSession = () => {}
}

function submittedDistanceM() {
  const call = requests.find((r) => r.url === '/api/roam/finish')
  assert.ok(call, '结束漫游必须发出结算请求 /api/roam/finish')
  return call.data.distanceM
}

test('结算提交保留原始米数:44.528 米不能被展示用的 0.0 公里吃掉', () => {
  const page = loadPage()
  prepareArrive(page, 44.528)

  page._arrive()

  assert.equal(submittedDistanceM(), '45')
  assert.equal(page.data.finish.distance, '0.0', '展示仍按公里保留 1 位小数')
})

test('跨公里边界:1550 米不能被 1.6 公里的显示值改写成 1600', () => {
  const page = loadPage()
  prepareArrive(page, 1550)

  page._arrive()

  assert.equal(submittedDistanceM(), '1550')
  assert.equal(page.data.finish.distance, '1.6', '展示四舍五入到 1.6 公里')
})

test('多段短程累计后按原始米数提交,不因每段显示粒度归零', () => {
  const page = loadPage()
  prepareArrive(page, 0)
  page._applyMovePatch = () => {}
  page._addReveal = () => {}
  page._track = []
  page._player = null
  const p0 = { lat: 31.23, lng: 121.47 }
  page._reveals = [p0]

  page._realTick({ latitude: p0.lat, longitude: p0.lng, accuracy: 10 })
  const p1 = { lat: p0.lat + m2lat(20), lng: p0.lng }
  page._realTick({ latitude: p1.lat, longitude: p1.lng, accuracy: 10 })
  const p2 = { lat: p1.lat + m2lat(24.528), lng: p1.lng }
  page._realTick({ latitude: p2.lat, longitude: p2.lng, accuracy: 10 })

  assert.ok(Math.abs(page._dist - 44.528) < 0.01, '三段应累计出约 44.528 米')

  page._arrive()

  assert.equal(submittedDistanceM(), '45')
})

test('结算重试沿用原始米数,不会退回被格式化过的值', async () => {
  const page = loadPage()
  prepareArrive(page, 44.528)

  page._arrive()
  const first = requests.find((r) => r.url === '/api/roam/finish')
  assert.equal(first.data.distanceM, '45')

  first.success({ code: 500, msg: '稍后重试' })
  await new Promise((resolve) => setImmediate(resolve))
  requests = []
  page.data.finish.settleErr = 'server'
  page.retrySettle()

  assert.equal(submittedDistanceM(), '45')
})
