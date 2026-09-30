const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const PAGE_MODULE = '../../pages/roam/index.js'
const ROOT = path.resolve(__dirname, '../..')

function loadRoamPage() {
  let definition
  const previous = { Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx }
  try {
    global.Page = config => { definition = config }
    // 2026-09-16 C-06:GO 前会判登录态并补一次登录,桩里必须有会话,否则永远停在 intro。
    global.getApp = () => ({ globalData: {}, getUserID: () => '9' })
    global.getCurrentPages = () => []
    global.wx = { getStorageSync: () => undefined }
    delete require.cache[require.resolve(PAGE_MODULE)]
    require(PAGE_MODULE)
  } finally {
    global.Page = previous.Page
    global.getApp = previous.getApp
    global.getCurrentPages = previous.getCurrentPages
    global.wx = previous.wx
  }
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
  page.setData = function (patch, done) {
    Object.assign(this.data, patch)
    if (done) done()
  }
  return page
}

function startWithLocation({ reducedMotion = false } = {}) {
  const page = loadRoamPage()
  const previous = { getApp: global.getApp, wx: global.wx, setTimeout: global.setTimeout }
  const timers = []
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay }
    timers.push(timer)
    return timer
  }
  global.getApp = () => ({
    globalData: {},
    getUserID: () => '9',
    recordConsent: () => Promise.resolve(),
  })
  global.wx = {
    getStorageSync: () => undefined,
    getLocation(options) {
      options.success({ latitude: 31.2304, longitude: 121.4737 })
      if (options.complete) options.complete()
    },
  }
  page.data.reducedMotion = reducedMotion
  page.markRoamIntroSeen = () => {}
  page._disposeFogRenderer = () => { page._fogLifecycleGen = (page._fogLifecycleGen || 0) + 1 }
  page._initWorld = () => {}
  page._syncPlayHeader = () => {}
  page._scheduleFootprintHint = () => {}
  page._syncGoal = () => {}
  page._mapLoadWatch = () => {}
  page._animateZoom = function () { this._animateZoomCalled = true }
  page._npc = null

  return {
    page,
    timers,
    restore() {
      global.getApp = previous.getApp
      global.wx = previous.wx
      global.setTimeout = previous.setTimeout
    },
  }
}

test('点击 GO 且定位成功后先进入 opening，动画完成才交给漫游地图', () => {
  const h = startWithLocation()
  try {
    h.page.goStart()
    assert.equal(h.page.data.screen, 'opening', '定位成功后不能硬切地图，应先进入开场态')
    const opening = h.timers.find(timer => timer.delay === 4200)
    assert.ok(opening, '常规动态效果应保留完整开场节奏')
    opening.fn()
    assert.equal(h.page.data.screen, 'map', '开场完成后必须进入真实漫游地图')
    assert.equal(h.page.data.mapScale, 14, '开场结束时仍是原来的远景，不能先缩成步行圈')
    const zoom = h.timers.find(timer => timer.delay === 650)
    assert.ok(zoom, '露出地图后再走原来的远景→步行缩放')
    zoom.fn()
    assert.equal(h.page._animateZoomCalled, true)
  } finally {
    h.restore()
  }
})

test('减少动态效果时仍经过 opening 语义态，但缩短为近乎瞬时过渡', () => {
  const h = startWithLocation({ reducedMotion: true })
  try {
    h.page.goStart()
    assert.equal(h.page.data.screen, 'opening')
    const opening = h.timers.find(timer => timer.delay === 220)
    assert.ok(opening, '减少动态效果不能继续等待完整动画')
    opening.fn()
    assert.equal(h.page.data.screen, 'map')
  } finally {
    h.restore()
  }
})

test('opening 期间真实地图已挂载，动画层承接 GO 到地图的视觉连续性', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/roam/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/roam/index.wxss'), 'utf8')
  assert.match(wxml, /screen=='opening'\|\|screen=='map'\|\|screen=='arrive'/)
  assert.match(wxml, /wx:if="\{\{screen=='opening'\}\}"[^>]*class="roam-opening"|class="roam-opening"[^>]*wx:if="\{\{screen=='opening'\}\}"/)
  assert.match(wxml, /class="roam-opening__ribbon roam-opening__ribbon--purple"/)
  assert.match(wxml, /class="roam-opening__ribbon roam-opening__ribbon--cyan"/)
  assert.match(wxml, /class="roam-opening__logo"/)
  assert.match(wxml, /wx:for="\{\{openingEmojis\}\}"/)
  assert.doesNotMatch(wxml, /roam-opening__pulse/)
  const openingRule = wxss.match(/\.roam-opening\{[^}]+\}/)
  assert.ok(openingRule, '开场层必须有独立样式')
  assert.doesNotMatch(openingRule[0], /r-openingAway/, '开场不能半途淡出，否则会露出未就绪的地图')
})

test('opening emoji 使用七个安全随机分区，并保持大小与转向差异', () => {
  const page = loadRoamPage()
  const emojis = page._buildOpeningEmojis(() => 0.37)
  assert.equal(emojis.length, 7)
  assert.ok(emojis.every(item => item.size >= 52 && item.size <= 98))
  assert.ok(emojis.every(item => Math.abs(item.rotate) >= 8))
  assert.ok(new Set(emojis.map(item => item.size)).size > 1, 'Emoji 不能全部同尺寸')
  assert.ok(new Set(emojis.map(item => item.rotate)).size > 1, 'Emoji 不能全部同方向')
})
