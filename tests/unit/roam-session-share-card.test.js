const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 2026-08-06：主页统一到 cy-profile 共用组件后，member/index 与 userinfo 的 wxml
// 只剩一行 <cy-profile />，本文件的断言原本钉在旧结构的节点上。约束没失效、只是搬进了
// 组件 —— 用 helper 在读文件这一层展开，断言原样保留。

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

// 2026-07-31 修时区 flaky:全文件的 ts 固定用 1717243200000(2024-06-01T12:00:00.000Z，
// 正午 UTC),不要改回 1717200000000(UTC 午夜)。页面用 d.getMonth()/d.getDate() 读本地
// 日历天来显示"哪一天"，这是正确行为(用户要看的是自己当地的日期，不是 UTC 日期)——
// 真正的 bug 是测试 fixture 选了 UTC 午夜这个边界值，负偏移时区下本地时间倒退回前一天，
// 断言里写死的"6月1日"就对不上了。改成正午 UTC 后，从 UTC-11 到 UTC+14 的现实时区都稳定
// 落在 6 月 1 日，不需要再改产线代码去用 UTC getter(那样反而会让显示的日期跟用户所在
// 时区脱节，是另一种真 bug)。
const PAGE_MODULE = '../../subpackageRoam/session/index.js'
const PAGE_DIR = path.join(__dirname, '../../subpackageRoam/session')
const PAGE_WXML = fs.readFileSync(path.join(PAGE_DIR, 'index.wxml'), 'utf8')
const PAGE_JSON = JSON.parse(fs.readFileSync(path.join(PAGE_DIR, 'index.json'), 'utf8'))

let pageConfig
let toastCalls
let exportedCanvas
let savedPaths
let drawnTexts
let sentRequests

function makeContext() {
  return {
    scale() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    arc() {}, fill() {}, fillText(text) { drawnTexts.push(String(text)) }, save() {}, restore() {}, clip() {},
    createLinearGradient: () => ({ addColorStop() {} }),
  }
}

function makeCanvas() {
  return { width: 0, height: 0, getContext: () => makeContext() }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

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
  delete require.cache[require.resolve(PAGE_MODULE)]
  // utils/loading.js 的原生回落带 show/hide 计数,跟页面一起重装,别让上一条用例的余额漏进来
  delete require.cache[require.resolve('../../utils/loading.js')]
  require(PAGE_MODULE)
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([path, value]) => setByPath(page.data, path, value))
    if (callback) callback()
  }
  return page
}

beforeEach(() => {
  pageConfig = null
  toastCalls = []
  exportedCanvas = null
  savedPaths = []
  drawnTexts = []
  sentRequests = []
  global.Page = (config) => { pageConfig = config }
  global.getApp = () => ({ globalData: {}, getUserID: () => 9, sendRequest: (request) => { sentRequests.push(request) } })
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 390 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ left: 280, right: 368, bottom: 88 }),
    getStorageSync: () => [{
      ts: 1717243200000,
      zone: '这片街区',
      distance: '3.2',
      explorePct: 68,
      durSec: 1500,
      shops: 4,
      pois: [
        { name: '武康大楼', cat: 'landmark', lat: 31.20, lng: 121.40 },
        { name: '衡山公园', cat: 'park', lat: 31.21, lng: 121.41 },
      ],
      track: [
        { lat: 31.20, lng: 121.40 },
        { lat: 31.21, lng: 121.41 },
      ],
    }],
    createSelectorQuery: () => ({
      select: () => ({
        fields: () => ({ exec: (callback) => callback([{ node: makeCanvas() }]) }),
      }),
    }),
    canvasToTempFilePath: (options) => {
      exportedCanvas = options.canvas
      options.success({ tempFilePath: '/tmp/roam-session-card.png' })
    },
    showToast: (options) => { toastCalls.push(options) },
    saveImageToPhotosAlbum: (options) => {
      savedPaths.push(options.filePath)
      options.success()
    },
    showLoading() {},
    hideLoading() {},
  }
})

test('用户主动保存时等待相册 API 成功后才反馈已保存', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  await page.share()

  const result = await page.saveShareCard()

  assert.deepEqual(result, { ok: true, saved: true })
  assert.deepEqual(savedPaths, ['/tmp/roam-session-card.png'])
  assert.equal(toastCalls.at(-1).title, '已保存到相册')
})

test('相册权限拒绝会说明原因并允许去设置后重试保存', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  await page.share()
  const modals = []
  let openSettingCalls = 0
  global.wx.saveImageToPhotosAlbum = ({ fail }) => fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
  global.wx.showModal = (options) => {
    modals.push(options)
    options.success({ confirm: true })
  }
  global.wx.openSetting = () => { openSettingCalls += 1 }

  const denied = await page.saveShareCard()

  assert.deepEqual(denied, { ok: false, saved: false })
  assert.match(page.data.share.error, /相册权限/)
  assert.equal(page.data.share.retrySave, true)
  assert.equal(modals[0].title, '需要相册权限')
  assert.equal(openSettingCalls, 1)

  global.wx.saveImageToPhotosAlbum = ({ success }) => success()
  const retried = await page.retryShare()
  assert.deepEqual(retried, { ok: true, saved: true })
  assert.equal(page.data.share.error, '')
})

test('分享面板公开保存、微信分享、失败重试和返回入口', () => {
  assert.doesNotMatch(PAGE_WXML, /分享面板后续接入/)
  assert.match(PAGE_WXML, /<cy-sheet[^>]+show="\{\{share\.show\}\}"/)
  assert.match(PAGE_WXML, /bindtap="saveShareCard"/)
  assert.match(PAGE_WXML, /open-type="share"/)
  assert.match(PAGE_WXML, /bind:retry="retryShare"/)
  assert.match(PAGE_WXML, /bindtap="closeShare"/)
  assert.equal(PAGE_JSON.usingComponents['cy-sheet'], '/components/cy/sheet/index')
})

test('分享 sheet 的主保存动作使用语义按钮，并给两个动作提供显式可着色文字盒', () => {
  assert.equal(PAGE_JSON.usingComponents['cy-btn'], '/components/cy/btn/index')
  assert.match(
    PAGE_WXML,
    /<cy-btn[^>]*class="ss-share-action"[^>]*variant="primary"[^>]*loading="\{\{share\.saving\}\}"[^>]*disabled="\{\{share\.saving\}\}"[^>]*bindtap="saveShareCard">[\s\S]*?<text class="ss-share-action__label">保存到相册<\/text>[\s\S]*?<\/cy-btn>/
  )
  assert.match(
    PAGE_WXML,
    /<button class="ss-share-action ss-share-action--native" open-type="share">[\s\S]*?<text class="ss-share-action__label">微信分享<\/text>[\s\S]*?<\/button>/
  )
})

test('深链回看使用共享导航壳，并把 ts 交给唯一正文组件', () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })

  assert.equal(page.data.ts, '1717243200000')
  assert.match(PAGE_WXML, /<cy-nav-bar[^>]*plain[^>]*custom-back[^>]*bind:back="goBack"/)
  assert.match(PAGE_WXML, /<cy-scene-roam-session[^>]*ts="\{\{ts\}\}"[^>]*bind:share="share"/)
  assert.doesNotMatch(PAGE_WXML, /class="ss-top"|class="ss-x"/)
  assert.equal(PAGE_JSON.usingComponents['cy-scene-roam-session'], '/components/cy/scene-roam-session/index')
})

test('深链分享卡遇到有限但超出 Date 范围的 ts 时显示“日期不可用”', () => {
  const invalidDateTs = Number.MAX_SAFE_INTEGER
  global.wx.getStorageSync = () => [{ ts: invalidDateTs, pois: [], track: [] }]
  const page = loadPage()

  page.onLoad({ ts: String(invalidDateTs) })

  assert.equal(page.data.s.dateFull, '日期不可用')
  assert.equal(page.data.s.routeName, '城市漫游足迹')
  assert.doesNotMatch(page.data.s.dateFull, /NaN/)
})

test('非数组存储或目标记录损坏时进入读失败，并清理已经展示的旧记录', () => {
  const malformed = [
    {},
    [{ ts: 1717243200000, pois: {} }],
    [{ ts: 1717243200000, track: {} }],
    [{ ts: 1717243200000, pois: [null] }],
    [{ ts: 1717243200000, track: [{ lat: 31.2 }] }],
    [{ ts: 1717243200000, track: [{ lat: true, lng: 121.4 }] }],
    [{ ts: 1717243200000, track: [{ lat: [31.2], lng: 121.4 }] }],
  ]

  malformed.forEach((stored) => {
    const page = loadPage()
    page.onLoad({ ts: '1717243200000' })
    page.setData({
      s: { routeName: '旧路线', pois: [{ name: '旧地点' }] },
      segs: [{ i: 1 }],
      poiDots: [{ i: 0 }],
      'share.show': true,
      'share.imagePath': '/tmp/old.png',
    })
    global.wx.getStorageSync = () => stored

    page._load()

    assert.equal(page.data.err, 'read')
    assert.deepEqual(page.data.s, { pois: [] })
    assert.deepEqual(page.data.segs, [])
    assert.deepEqual(page.data.poiDots, [])
    assert.equal(page.data.share.show, false)
    assert.equal(page.data.share.imagePath, '')
  })
})

test('损坏的兄弟记录不污染合法目标，分享动作重读本账户记录恢复页面工具链', async () => {
  const valid = global.wx.getStorageSync()[0]
  global.wx.getStorageSync = () => [valid, {}]
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })

  assert.equal(page.data.err, '')
  assert.equal(page.data.s.distance, 3.2)

  page._clearSessionView('read')
  page._drawShareCard = () => Promise.resolve('/tmp/from-scene.png')
  const shared = await page.share({ detail: { session: valid } })

  assert.deepEqual(shared, { ok: true, imagePath: '/tmp/from-scene.png' })
  assert.equal(page.data.err, '')
  assert.equal(page.data.s.distance, 3.2)
})

test('无效目标记录不显示重新生成，也不能绕过有效性门禁产出空卡', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  let prepareCalls = 0
  page._prepareShareCard = () => {
    prepareCalls += 1
    return Promise.resolve({ ok: true, imagePath: '/tmp/invalid-record-card.png' })
  }
  const malformed = { ts: 1717243200000, pois: [], track: [{ lat: 31.2 }] }

  global.wx.getStorageSync = () => [malformed]
  const first = await page.share({ detail: { session: malformed } })
  const retried = await page.retryShare()

  assert.deepEqual(first, { ok: false, imagePath: '' })
  assert.deepEqual(retried, { ok: false, imagePath: '' })
  assert.equal(prepareCalls, 0)
  assert.match(page.data.share.error, /无法生成/)
  assert.match(PAGE_WXML, /retry="\{\{err \? '' : '重新生成'\}\}"/)
})

test('缺失或空数组字段保持既有空态，而不是把合法记录误报为读失败', () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  global.wx.getStorageSync = () => [{ ts: 1717243200000, zone: '空路线' }]

  page._load()

  assert.equal(page.data.err, '')
  assert.deepEqual(page.data.s.pois, [])
  assert.deepEqual(page.data.segs, [])

  global.wx.getStorageSync = () => []
  page._load()
  assert.equal(page.data.err, 'notfound')
  assert.deepEqual(page.data.s, { pois: [] })

  global.wx.getStorageSync = () => [{}, null]
  page._load()
  assert.equal(page.data.err, 'notfound')

  global.wx.getStorageSync = () => ''
  page._load()
  assert.equal(page.data.err, 'notfound')
})

test('字符串时间戳的合法本地漫游记录可以被回看页准确命中', () => {
  const page = loadPage()
  global.wx.getStorageSync = () => [{
    ts: '1717243200000',
    zone: '空路线',
    distance: '1.2',
    explorePct: 12,
    durSec: 900,
    shops: 1,
  }]

  page.onLoad({ ts: '1717243200000' })

  assert.equal(page.data.err, '')
  assert.equal(page.data.s.distance, 1.2)
})

test('迟到的分享生成失败不能覆盖后一次成功结果', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  const first = deferred()
  const second = deferred()
  const jobs = [first, second]
  page._drawShareCard = () => jobs.shift().promise

  const firstRun = page.share()
  const secondRun = page.share()
  second.resolve('/tmp/latest.png')
  assert.deepEqual(await secondRun, { ok: true, imagePath: '/tmp/latest.png' })
  first.reject(new Error('late failure'))
  assert.deepEqual(await firstRun, { ok: false, imagePath: '' })

  assert.equal(page.data.share.imagePath, '/tmp/latest.png')
  assert.equal(page.data.share.error, '')
  assert.equal(page.data.share.drawing, false)
})

test('关闭页面后迟到的分享回写不会重新写入页面状态', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  const pending = deferred()
  page._drawShareCard = () => pending.promise

  const run = page.share()
  page.closeShare()
  pending.resolve('/tmp/stale.png')

  assert.deepEqual(await run, { ok: false, imagePath: '' })
  assert.equal(page.data.share.show, false)
  assert.equal(page.data.share.imagePath, '')
  assert.equal(page.data.share.drawing, false)
})

test('清理损坏记录时会收起仍在途的生成 loading', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  const pending = deferred()
  page._drawShareCard = () => pending.promise
  let shows = 0
  let hides = 0
  global.wx.showLoading = () => { shows += 1 }
  global.wx.hideLoading = () => { hides += 1 }

  const run = page.share()
  global.wx.getStorageSync = () => ({ broken: true })
  page._load()

  assert.equal(shows, 1)
  assert.equal(hides, 1)
  pending.resolve('/tmp/stale.png')
  assert.deepEqual(await run, { ok: false, imagePath: '' })
  assert.equal(hides, 1)
})

test('保存防重：双击只调用一次相册 API，并在完成后解除 saving', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  await page.share()
  const pending = deferred()
  let saveCalls = 0
  global.wx.saveImageToPhotosAlbum = (options) => {
    saveCalls += 1
    pending.promise.then(() => options.success())
  }

  const first = page.saveShareCard()
  const second = page.saveShareCard()
  assert.equal(first, second)
  assert.equal(saveCalls, 1)
  assert.equal(page.data.share.saving, true)

  pending.resolve()
  assert.deepEqual(await first, { ok: true, saved: true })
  assert.equal(page.data.share.saving, false)
})

test('关闭分享后旧保存不占用新一轮分享的防重锁', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  await page.share()
  const first = deferred()
  const second = deferred()
  const pending = [first, second]
  let saveCalls = 0
  global.wx.saveImageToPhotosAlbum = (options) => {
    saveCalls += 1
    pending[saveCalls - 1].promise.then(() => options.success())
  }

  const oldSave = page.saveShareCard()
  page.closeShare()
  await page.share()
  const newSave = page.saveShareCard()

  assert.equal(saveCalls, 2)
  second.resolve()
  assert.deepEqual(await newSave, { ok: true, saved: true })
  first.resolve()
  assert.deepEqual(await oldSave, { ok: false, saved: false })
})

test('开始新一轮分享时旧保存不会复用到新卡片', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  await page.share()
  const first = deferred()
  const second = deferred()
  const pending = [first, second]
  let saveCalls = 0
  global.wx.saveImageToPhotosAlbum = (options) => {
    saveCalls += 1
    pending[saveCalls - 1].promise.then(() => options.success())
  }

  const oldSave = page.saveShareCard()
  await page.share()
  const newSave = page.saveShareCard()

  assert.equal(saveCalls, 2)
  second.resolve()
  assert.deepEqual(await newSave, { ok: true, saved: true })
  first.resolve()
  assert.deepEqual(await oldSave, { ok: false, saved: false })
})

test('canvas 导出成功但没有 tempFilePath 时按失败处理并允许重试', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  let exports = 0
  global.wx.canvasToTempFilePath = (options) => {
    exports += 1
    if (exports === 1) options.success({ tempFilePath: '' })
    else options.success({ tempFilePath: '/tmp/recovered.png' })
  }

  const failed = await page.share()
  assert.deepEqual(failed, { ok: false, imagePath: '' })
  assert.match(page.data.share.error, /生成失败/)

  const retried = await page.retryShare()
  assert.deepEqual(retried, { ok: true, imagePath: '/tmp/recovered.png' })
  assert.equal(page.data.share.imagePath, '/tmp/recovered.png')
})

test('生成失败时记录不丢失，并可在面板内重试成功', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })
  global.wx.createSelectorQuery = () => ({
    select: () => ({ fields: () => ({ exec: (callback) => callback([]) }) }),
  })

  const failed = await page.share()

  assert.equal(failed.ok, false)
  assert.equal(page.data.share.show, true)
  assert.match(page.data.share.error, /生成失败/)
  assert.equal(page.data.s.routeName, '武康大楼等2处足迹回看')

  global.wx.createSelectorQuery = () => ({
    select: () => ({ fields: () => ({ exec: (callback) => callback([{ node: makeCanvas() }]) }) }),
  })
  const retried = await page.retryShare()
  assert.equal(retried.ok, true)
  assert.equal(page.data.share.error, '')
  assert.equal(page.data.share.imagePath, '/tmp/roam-session-card.png')
})

test('已有漫游记录点击分享会生成含完成事实的成果卡，而不是占位 toast', async () => {
  const page = loadPage()
  page.onLoad({ ts: '1717243200000' })

  await page.share()

  assert.equal(page.data.share.show, true)
  assert.equal(page.data.share.imagePath, '/tmp/roam-session-card.png')
  assert.equal(page.data.s.routeName, '武康大楼等2处足迹回看')
  assert.equal(page.data.s.completeFact, '已完成本次漫游')
  assert.ok(page.data.s.dateFull)
  assert.equal(exportedCanvas.width, 1500)
  assert.equal(exportedCanvas.height, 2000)
  assert.ok(drawnTexts.includes('武康大楼等2处足迹回看'))
  assert.ok(drawnTexts.includes('已完成本次漫游'))
  assert.ok(drawnTexts.some((text) => /6月1日/.test(text)))
  assert.equal(toastCalls.some((item) => /后续接入/.test(item.title)), false)

  // 第二轮拍板 17:分享快照发布成功后,微信分享 path 直达这条足迹(不再只落漫游首页)。
  const publish = sentRequests.find((request) => request.url === '/api/roam/share/snapshot')
  assert.ok(publish, '打开分享面板就发布分享快照')
  publish.success({ code: 200, data: { token: 'abcdef01abcdef01abcdef01abcdef01' } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(page.onShareAppMessage(), {
    title: '武康大楼等2处足迹回看 · 已完成本次漫游',
    path: '/subpackageRoam/session/index?shareToken=abcdef01abcdef01abcdef01abcdef01',
    imageUrl: '/tmp/roam-session-card.png',
  })
})


test('历史深链正文与导出共享里程读模型，非法值未知且真实0保留', async () => {
  const page = loadPage()
  for (const [input, number, text] of [['bad', null, '—'], [null, null, '—'], [0, 0, '0'], ['0.2', 0.2, '0.2']]) {
    assert.equal(page._setSessionView({ ts: 1717243200000, distance: input, pois: [], track: [] }), true)
    assert.equal(page.data.s.distance, number)
    assert.equal(page.data.s.distanceText, text)
    drawnTexts = []
    await page._drawShareCard()
    assert.ok(drawnTexts.includes(text))
  }
  assert.match(PAGE_WXML, /\{\{s.distanceText\}\}/)
})

test('深链换号不接受旧子组件足迹，迟到的绘图和保存不污染新账号', async () => {
  const page = loadPage()
  const original = global.wx.getStorageSync()[0]
  page.onLoad({ ts: String(original.ts) })
  const drawing = deferred()
  page._drawShareCard = () => drawing.promise
  const oldDraw = page.share({ detail: { session: original } })
  await Promise.resolve()
  global.getApp = () => ({ getUserID: () => 10, globalData: {} })
  global.wx.getStorageSync = () => []
  page.onShow()
  drawing.resolve('/tmp/account9.png')
  assert.equal((await oldDraw).ok, false)
  assert.equal(page.data.share.imagePath, '')
  let prepared = 0
  page._prepareShareCard = () => { prepared++; return Promise.resolve({ ok: true }) }
  assert.equal((await page.share({ detail: { session: original } })).ok, false)
  assert.equal(prepared, 0)
  assert.equal((await page.saveShareCard()).saved, false)
  assert.equal(savedPaths.length, 0)
  assert.equal(page.data.s.distance, undefined)
})

test('旧千点历史深链分享先裁隐私再按几何预算，不生成千个节点', () => {
  const page = loadPage()
  const track = Array.from({ length: 1000 }, (_, i) => ({ lat: 31 + i * 0.0001, lng: 121 + i % 2 * 0.001 }))
  const before = JSON.stringify(track)
  const route = page._route({ track, pois: [] })
  assert.ok(route.segs.length > 0 && route.segs.length <= 179)
  assert.equal(JSON.stringify(track), before)
})
