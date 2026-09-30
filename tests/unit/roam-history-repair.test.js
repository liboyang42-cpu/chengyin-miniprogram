'use strict'

// R9-42/43/44 漫游历史 存读数值契约 / 轨迹抽稀 / 历史分享足迹卡
//
// 三条都是「读方或入口没接上真实数据」,不是定位或服务端问题:
//   R9-42 落盘 distance 是 toFixed 字符串,组件只读 number → 里程显示「—」
//   R9-43 _saveSession 用 i % 3 固定抽样 → 丢终点与转折,回放不保真
//   R9-44 历史详情的 share 事件被 onSceneSessionShare 丢掉,只 showShareMenu

const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const { readNonNegative } = require('../../utils/roam-history-metrics.js')
const { simplifyTrack } = require('../../utils/roam-track-simplify.js')

function loadComponent(relativePath) {
  const absolutePath = path.join(ROOT, relativePath)
  const previousComponent = global.Component
  const previousBehavior = global.Behavior
  let definition
  global.Component = (config) => { definition = config }
  global.Behavior = (config) => config
  try {
    delete require.cache[require.resolve(absolutePath)]
    require(absolutePath)
  } finally {
    global.Component = previousComponent
    global.Behavior = previousBehavior
  }
  return definition
}

// ───────────────────────── R9-42:距离数值契约 ─────────────────────────

test('R9-42 距离读法:数字、数字字符串都认;0 与未知分开', () => {
  assert.equal(readNonNegative(0), 0)
  assert.equal(readNonNegative('0'), 0)
  assert.equal(readNonNegative('0.0'), 0)
  assert.equal(readNonNegative('0.2'), 0.2)
  assert.equal(readNonNegative(12.5), 12.5)
  assert.equal(readNonNegative(' 3.10 '), 3.1)
  assert.equal(readNonNegative(null), null)
  assert.equal(readNonNegative(undefined), null)
  assert.equal(readNonNegative(''), null)
  assert.equal(readNonNegative('   '), null)
  assert.equal(readNonNegative('bad'), null)
  assert.equal(readNonNegative(-1), null)
  assert.equal(readNonNegative('-2'), null)
  assert.equal(readNonNegative(NaN), null)
  assert.equal(readNonNegative(Infinity), null)
  // 只认老记录会写的十进制写法,Number() 的宽容(十六进制/科学计数)不算「可靠数值字符串」
  assert.equal(readNonNegative('0x10'), null)
  assert.equal(readNonNegative('1e3'), null)
  assert.equal(readNonNegative('.5'), null)
})

test('R9-42 历史列表:老记录的字符串里程不再显示为缺失,0 显示 0', () => {
  const definition = loadComponent('components/cy/scene-roam-history/index.js')
  const context = {
    _timestamp: definition.methods._timestamp,
    _formatDuration: definition.methods._formatDuration,
  }
  const rows = definition.methods._sorted.call({
    ...context,
    _sessions: [
      { ts: 1717243200000, zone: '徐汇', distance: '0.2', shops: 2 },
      { ts: 1717243200001, zone: '徐汇', distance: 0, shops: 0 },
      { ts: 1717243200002, zone: '徐汇', distance: 'bad', shops: 1 },
    ],
  }, 'new')
  const byTs = (ts) => rows.find((row) => row.ts === ts)
  assert.equal(byTs(1717243200000).distanceValue, 0.2)
  assert.equal(byTs(1717243200000).distanceText, '0.2')
  assert.equal(byTs(1717243200001).distanceValue, 0)
  assert.equal(byTs(1717243200001).distanceText, '0')
  assert.equal(byTs(1717243200002).distanceValue, null)
  // UI-04(2026-09-18):数字统计没取到显示 0,不再显示横杠
  assert.equal(byTs(1717243200002).distanceText, '0')
})

test('R9-42 本次漫游详情:字符串里程显示为真实值,未知按 UI-04 显示 0', () => {
  const definition = loadComponent('components/cy/scene-roam-session/index.js')
  const context = { _formatDuration: definition.methods._formatDuration }
  const stringDistance = definition.methods._normalize.call(context, {
    ts: 1717243200000, distance: '0.2', shops: 1, explorePct: 20, durSec: 60, pois: [],
  })
  assert.equal(stringDistance.distance, 0.2)
  assert.equal(stringDistance.distanceText, '0.2')

  const zero = definition.methods._normalize.call(context, {
    ts: 1717243200000, distance: 0, shops: 0, explorePct: 0, durSec: 0, pois: [],
  })
  assert.equal(zero.distanceText, '0')

  const unknown = definition.methods._normalize.call(context, {
    ts: 1717243200000, distance: 'bad', shops: 1, explorePct: 20, durSec: 60, pois: [],
  })
  assert.equal(unknown.distance, null)
  assert.equal(unknown.distanceText, '0')
})

// ───────────────────────── R9-43:轨迹抽稀 ─────────────────────────

// 一个 L 形受控路线:先向北,再在 p1 转东直走。p1 是唯一的真转折。
// 旧码 i % 3 === 0 只留 p0/p3 —— 终点 p4 与转折 p1 一起丢,回放变成一条斜直线。
const CONTROLLED_TRACK = [
  { lat: 38.8840, lng: -76.9990 },        // p0 起点
  { lat: 38.8850, lng: -76.9990 },        // p1 转折(向北)
  { lat: 38.8850, lng: -76.9980 },        // p2 向东
  { lat: 38.8850, lng: -76.9970 },        // p3 向东
  { lat: 38.8850, lng: -76.9960 },        // p4 终点
]

test('R9-43 抽稀保留首尾;转折不被当成共线噪声丢掉', () => {
  const simplified = simplifyTrack(CONTROLLED_TRACK)
  assert.deepEqual(simplified[0], CONTROLLED_TRACK[0], '起点必须保留')
  assert.deepEqual(simplified[simplified.length - 1], CONTROLLED_TRACK[4], '终点必须保留')
  assert.ok(simplified.some((point) => point.lat === CONTROLLED_TRACK[1].lat && point.lng === CONTROLLED_TRACK[1].lng), '转折点必须保留')
  assert.ok(simplified.length < CONTROLLED_TRACK.length, '近似共线的点应被抽掉')
})

test('R9-43 短轨迹原样保留,不因抽稀丢终点;空/坏点不生成假轨迹', () => {
  const two = [CONTROLLED_TRACK[0], CONTROLLED_TRACK[4]]
  assert.deepEqual(simplifyTrack(two), two)
  assert.deepEqual(simplifyTrack([CONTROLLED_TRACK[0]]), [CONTROLLED_TRACK[0]])
  assert.deepEqual(simplifyTrack([]), [])
  assert.deepEqual(simplifyTrack(null), [])
  assert.deepEqual(simplifyTrack([{ lat: 'x', lng: 1 }, null]), [])
})

test('R9-43 长轨迹超上限时仍保留首尾', () => {
  const long = Array.from({ length: 1000 }, (_, index) => ({
    lat: 31.2 + index * 0.00005,
    lng: 121.4 + (index % 2 === 0 ? 0.0003 : -0.0003),
  }))
  const simplified = simplifyTrack(long, { maxPoints: 50 })
  assert.ok(simplified.length <= 50)
  assert.deepEqual(simplified[0], long[0])
  assert.deepEqual(simplified[simplified.length - 1], long[long.length - 1])
})

test('R9-43 落盘轨迹保留终点,且里程按统一数值合同存', () => {
  const page = loadRoamPage()
  page._track = CONTROLLED_TRACK.map((point) => ({ ...point }))
  page._pois = []
  page._reveals = []
  page._sessionPhotos = []
  page._roamSid = 0
  page._clientSessionKey = ''
  page._recoveryArchiveTs = 0
  const fin = {
    zone: '这片街区', date: '9月13日', dateLine: '今天 · 上午 10:00',
    shops: 0, distance: '0.2', explorePct: 0, time: '00:01', photos: [],
  }

  assert.equal(page._saveSession(fin), true)
  const stored = storage['roam_memory_v1:9:sessions'][0]

  assert.equal(stored.distance, 0.2, 'distance 落盘为 number,不是展示字符串')
  assert.equal(typeof stored.distance, 'number')
  assert.deepEqual(stored.track[0], CONTROLLED_TRACK[0])
  assert.deepEqual(stored.track[stored.track.length - 1], CONTROLLED_TRACK[4], '终点不能被 i % 3 丢掉')
  assert.ok(stored.track.some((point) => point.lat === 38.8850 && point.lng === -76.9990), '转折点必须在落盘轨迹里')
})

test('R9-43 回放与落盘同源:组件从落盘轨迹构出的段数覆盖到终点', () => {
  const { buildRouteGeometry } = require('../../components/cy/scene-roam-session/route-replay.js')
  const page = loadRoamPage()
  page._track = CONTROLLED_TRACK.map((point) => ({ ...point }))
  page._pois = []
  page._reveals = []
  page._sessionPhotos = []
  page._roamSid = 0
  page._clientSessionKey = ''
  page._recoveryArchiveTs = 0
  page._saveSession({ zone: '这片街区', shops: 0, distance: '0.2', explorePct: 0, time: '00:01', photos: [] })

  const stored = storage['roam_memory_v1:9:sessions'][0]
  const geometry = buildRouteGeometry({ track: stored.track, pois: [] })
  assert.ok(geometry.segs.length >= 2, '落盘轨迹必须够画出到终点的路线')
})

// ───────────────────────── R9-44:历史分享足迹卡 ─────────────────────────

test('R9-44 历史详情分享:接收选中 session,打开绑定该记录的分享卡,不再只 showShareMenu', () => {
  const page = loadRoamPage()
  let showShareMenuCalls = 0
  global.wx.showShareMenu = () => { showShareMenuCalls += 1 }
  page.data.finish = { zone: '本次漫游', shops: 9, distance: '9.9', explorePct: 99, photos: [] }
  page.data.archSegs = []
  page.data.sceneStack = [
    { id: 'roam-history', params: {}, title: '漫游历史', variant: 'full', theme: 'player' },
    { id: 'roam-session', params: { ts: '1717243200000' }, title: '本次漫游', variant: 'full', theme: 'player' },
  ]
  const session = {
    ts: 1717243200000, zone: '徐汇', distance: '1.2', shops: 3, explorePct: 40, time: '00:20',
    track: CONTROLLED_TRACK.map((point) => ({ ...point })),
    pois: [{ name: '武康大楼', cat: 'landmark', lat: 38.8841, lng: -76.9990, color: '#fff' }],
  }

  storage['roam_memory_v1:9:sessions'] = [session]
  page.onSceneSessionShare({ detail: { session } })

  assert.equal(showShareMenuCalls, 0, '历史分享不能只调 wx.showShareMenu')
  assert.equal(page.data.share.show, true, '必须真的打开分享面板')
  assert.equal(page.data.sceneCurrent.id, 'roam-share')
  assert.equal(page._activeShareFinish().zone, '徐汇')
  assert.equal(page._activeShareFinish().distance, 1.2)
  assert.equal(page._activeShareFinish().shops, 3)
  assert.ok(page._activeShareArch().archSegs.length >= 2, '历史分享卡必须画选中记录的轨迹')
  assert.deepEqual(page.data.finish, { zone: '本次漫游', shops: 9, distance: '9.9', explorePct: 99, photos: [] }, '不能污染当前漫游结算数据')
  assert.deepEqual(page.data.archSegs, [], '不能污染当前漫游路线')
})

test('R9-44 取消分享回到历史详情,当前漫游状态不变', () => {
  const page = loadRoamPage()
  page.data.finish = { zone: '本次漫游', shops: 9, distance: '9.9', explorePct: 99, photos: [] }
  const historyScene = { id: 'roam-history', params: {}, title: '漫游历史', variant: 'full', theme: 'player' }
  const sessionScene = { id: 'roam-session', params: { ts: '1717243200000' }, title: '本次漫游', variant: 'full', theme: 'player' }
  page.data.sceneStack = [historyScene, sessionScene]
  const session = {
    ts: 1717243200000, zone: '徐汇', distance: 1.2, shops: 3, explorePct: 40,
    track: CONTROLLED_TRACK.map((point) => ({ ...point })), pois: [],
  }

  storage['roam_memory_v1:9:sessions'] = [session]
  page.onSceneSessionShare({ detail: { session } })
  assert.equal(page.data.sceneCurrent.id, 'roam-share')
  page.closeShare()

  assert.equal(page.data.sceneCurrent.id, 'roam-session', '取消应回到打开分享前的历史详情')
  assert.equal(page._shareSource, null)
  assert.deepEqual(page.data.finish, { zone: '本次漫游', shops: 9, distance: '9.9', explorePct: 99, photos: [] })
})

test('R9-44 点遮罩/✕ 关闭分享也回到历史详情,不整个清空场景栈', () => {
  const page = loadRoamPage()
  const historyScene = { id: 'roam-history', params: {}, title: '漫游历史', variant: 'full', theme: 'player' }
  const sessionScene = { id: 'roam-session', params: { ts: '1717243200000' }, title: '本次漫游', variant: 'full', theme: 'player' }
  page.data.sceneStack = [historyScene, sessionScene]
  const session = {
    ts: 1717243200000, zone: '徐汇', distance: 1.2, shops: 3, explorePct: 40,
    track: CONTROLLED_TRACK.map((point) => ({ ...point })), pois: [],
  }

  storage['roam_memory_v1:9:sessions'] = [session]
  page.onSceneSessionShare({ detail: { session } })
  page.onProtoSheetClose()

  assert.equal(page.data.sceneCurrent.id, 'roam-session', '遮罩/✕ 也必须回到历史详情')
  assert.equal(page._shareSource, null)
})

test('R9-44 空历史/坏旧数据不打开分享,也不假称已分享', () => {
  const page = loadRoamPage()
  const toasts = []
  global.wx.showToast = (options) => { toasts.push(options) }
  page.data.sceneStack = []
  page.data.finish = { photos: [] }

  page.onSceneSessionShare({ detail: {} })
  page.onSceneSessionShare({ detail: { session: null } })
  page.onSceneSessionShare({ detail: { session: { ts: 'not-a-date', track: [], pois: [] } } })

  assert.equal(page.data.share.show, false)
  assert.equal(page.data.sceneStack.length, 0)
  assert.equal(page._shareSource == null, true)
})

test('R9-44 历史分享的分享源只吃选中记录,不吃当前漫游的 _track/_c', () => {
  const page = loadRoamPage()
  page._track = [{ lat: 0, lng: 0 }, { lat: 0.5, lng: 0.5 }]
  page._c = { lat: 0, lng: 0 }
  page.data.finish = { zone: '本次漫游', shops: 9, distance: '9.9', explorePct: 99, photos: [] }
  page.data.sceneStack = [{ id: 'roam-session', params: { ts: '1717243200000' }, variant: 'full', theme: 'player' }]
  const session = {
    ts: 1717243200000, zone: '徐汇', distance: 1.2, shops: 3, explorePct: 40,
    track: CONTROLLED_TRACK.map((point) => ({ ...point })), pois: [],
  }

  storage['roam_memory_v1:9:sessions'] = [session]
  page.onSceneSessionShare({ detail: { session } })
  const arch = page._activeShareArch()
  assert.ok(arch.archSegs.length >= 2)
  // 历史轨迹 bbox 全在纬度 38.88x 一带;若误用当前漫游 _c/_track 会归一化到别处。
  assert.ok(arch.archSegs.every((segment) => segment.x >= 0 && segment.x <= 576 && segment.y >= 0 && segment.y <= 520))
  assert.equal(page._shareSource.finish.zone, '徐汇')
})

// ───────────────────────── 页面测试脚手架 ─────────────────────────

let pageConfig
let storage

function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadRoamPage() {
  delete require.cache[require.resolve('../../pages/roam/index.js')]
  require('../../pages/roam/index.js')
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(page.data, key, value))
    if (callback) callback()
  }
  page._sceneInTimer = null
  return page
}

global.getApp = () => ({
  getUserID: () => '9',
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest() {},
})

global.Page = (config) => { pageConfig = config }

global.wx = {
  getStorageSync: (key) => storage[key],
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)) },
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  showLoading() {},
  hideLoading() {},
  showToast() {},
  showShareMenu() {},
}

test.beforeEach(() => {
  pageConfig = null
  storage = {}
})

test('R9-43 折返和超预算的重要转折保留，坏坐标不变成 0/1', () => {
  const back = [{ lat: 31, lng: 121 }, { lat: 31.001, lng: 121 }, { lat: 31.0001, lng: 121 }]
  assert.deepEqual(simplifyTrack(back), back)
  const route = Array.from({ length: 500 }, (_, i) => ({ lat: 31 + i * 0.0001, lng: 121 + (i === 10 ? 0.1 : i % 2 * 0.0001) }))
  const reduced = simplifyTrack(route)
  assert.ok(reduced.length <= 180)
  assert.ok(reduced.some(p => p.lng === route[10].lng && p.lat === route[10].lat))
  assert.deepEqual(simplifyTrack([{ lat: '', lng: 121 }, { lat: true, lng: 121 }, { lat: 31, lng: [] }, { lat: 91, lng: 121 }]), [])
})

test('历史隐私裁剪与点密度无关，两点直线也裁掉原始首尾', () => {
  const { clipSavedTrackForSharing: clip } = require('../../utils/roam-route-privacy.js')
  const dense = Array.from({ length: 101 }, (_, i) => ({ lat: 31 + i * 0.0001, lng: 121 }))
  const sparse = simplifyTrack(dense)
  assert.equal(sparse.length, 2)
  const a = clip(dense), b = clip(sparse)
  assert.ok(Math.abs(a[0].lat - b[0].lat) < 1e-9)
  assert.ok(Math.abs(a.at(-1).lat - b.at(-1).lat) < 1e-9)
  assert.ok(b[0].lat > sparse[0].lat && b.at(-1).lat < sparse.at(-1).lat)
  assert.deepEqual(clip(sparse, { clipEnabled: false }), sparse)
  assert.deepEqual(clip([sparse[0], sparse[0]]), [])
})

test('分享画图不再按序号二次抽点，100 个折线点保留 99 段', () => {
  const page = loadRoamPage()
  const route = Array.from({ length: 100 }, (_, i) => ({ lat: 31 + i * 0.0001, lng: 121 + i % 2 * 0.001 }))
  assert.equal(page._buildArchFrom(route, [], route[0]).archSegs.length, 99)
})

test('历史分享只接受当前账户已存记录，日期取该记录', () => {
  const page = loadRoamPage()
  const session = { ts: 1717243200000, distance: 1, track: CONTROLLED_TRACK, pois: [] }
  page.onSceneSessionShare({ detail: { session } })
  assert.equal(page._shareSource == null, true)
  storage['roam_memory_v1:9:sessions'] = [session]
  page.onSceneSessionShare({ detail: { session: { ...session, distance: 99 } } })
  assert.equal(page._activeShareFinish().distance, 1)
  assert.ok(!page._shareCopy().startsWith('今天'))
})

test('取消生成中的足迹卡不保存相册，正常生成仍可保存', async () => {
  const page = loadRoamPage()
  let release, saves = 0
  page._saveToAlbum = async () => { saves++; return true }
  const pending = page._exportAndSave('生成卡片', () => new Promise(resolve => { release = resolve }), page._shareScope())
  await Promise.resolve()
  page._cancelShareWork()
  release('/tmp/old-card.png')
  assert.equal((await pending).saved, false)
  assert.equal(saves, 0)
  assert.equal((await page._exportAndSave('生成卡片', () => Promise.resolve('/tmp/new-card.png'), page._shareScope())).saved, true)
  assert.equal(saves, 1)
})

test('旧版本千点历史在分享与正文回放读取时受点数预算约束，不改原档', () => {
  const route = Array.from({ length: 1000 }, (_, i) => ({ lat: 31 + i * 0.0001, lng: 121 + i % 2 * 0.001 }))
  const before = JSON.stringify(route)
  const page = loadRoamPage()
  const arch = page._historyShareSource({ ts: 1717243200000, track: route, pois: [] }).arch
  const replay = require('../../components/cy/scene-roam-session/route-replay.js').buildRouteGeometry({ track: route })
  assert.ok(arch.archSegs.length > 0 && arch.archSegs.length <= 179)
  assert.ok(replay.segs.length > 0 && replay.segs.length <= 179)
  assert.equal(JSON.stringify(route), before)
})
