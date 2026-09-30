const { test } = require('node:test')
const assert = require('node:assert/strict')

const PAGE_MODULE = '../../pages/roam/index.js'

function setByPath(target, key, value) {
  const parts = key.split('.')
  let cursor = target
  parts.slice(0, -1).forEach(part => {
    cursor[part] = cursor[part] || {}
    cursor = cursor[part]
  })
  cursor[parts.at(-1)] = value
}

function loadRoamPage(sessions, options) {
  let definition
  const config = options || {}
  const storage = config.storage || { 'roam_memory_v1:101:sessions': sessions }
  const wxMock = { getStorageSync: key => storage[key] }
  const appMock = { globalData: { features: {} }, getUserID: () => config.playerId || '101' }
  const previous = { Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx }
  try {
    global.Page = config => { definition = config }
    global.getApp = () => appMock
    global.getCurrentPages = () => []
    global.wx = wxMock
    delete require.cache[require.resolve(PAGE_MODULE)]
    require(PAGE_MODULE)
  } finally {
    global.Page = previous.Page
    global.getApp = previous.getApp
    global.getCurrentPages = previous.getCurrentPages
    global.wx = previous.wx
  }

  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
  page.setData = function (patch) {
    Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
  }
  return { page, wxMock, appMock }
}

// 2026-08-08 用户裁决改版:护照 tab 分两层 —— 顶部四项读数、上排方卡=我的档案
// (漫游记录/集邮册/勋章墙)、下排大卡=去玩什么(官方活动/发现店铺)。
// 旧的「旅程卡截断 12 张 + passport 瓦片」随「探索护照」场景一起下线,契约跟着改。
test('起始页护照:读数与档案卡都统计全部历史,不跟着任何截断走', () => {
  const sessions = Array.from({ length: 13 }, (_, index) => ({
    ts: index + 1,
    date: `08-${String((index % 28) + 1).padStart(2, '0')}`,
    distance: '1.0',
    shops: 1,
    photos: [{ path: `${index}.jpg` }],
  }))
  const { page, wxMock, appMock } = loadRoamPage(sessions)
  const previousWx = global.wx
  const previousGetApp = global.getApp
  try {
    global.wx = wxMock
    global.getApp = () => appMock
    page._loadIntroPassport()
  } finally {
    global.wx = previousWx
    global.getApp = previousGetApp
  }

  const stat = key => page.data.passport.stats.find(item => item.k === key).v
  assert.equal(stat('漫游'), 13, '漫游次数统计全部历史')
  assert.equal(stat('探店'), 13, '探店数统计全部历史')
  assert.equal(stat('公里'), '13.0', '里程统计全部历史')

  const tile = key => page.data.passport.tiles.find(item => item.key === key)
  assert.equal(tile('history').value, '13 次旅程')
  assert.equal(tile('stamp').value, '13 张邮票')
  assert.ok(tile('badge'), '勋章墙常驻')
  assert.equal(page.data.passport.tiles.length, 3, '上排只放三张档案卡:记录/集邮/勋章')

  const plays = page.data.passport.plays.map(item => item.key)
  assert.deepEqual(plays, ['event', 'discover'], '下排大卡只放官方活动与发现店铺')
})

test('negative control: 读数改回跟着旅程卡截断走必须判红', () => {
  const sessions = Array.from({ length: 13 }, (_, index) => ({ ts: index + 1, date: '08-01', distance: '1.0', shops: 1, photos: [{ path: `${index}.jpg` }] }))
  const { page, wxMock, appMock } = loadRoamPage(sessions)
  const previousWx = global.wx
  const previousGetApp = global.getApp
  try {
    global.wx = wxMock
    global.getApp = () => appMock
    page._loadIntroPassport()
  } finally {
    global.wx = previousWx
    global.getApp = previousGetApp
  }
  const shops = page.data.passport.stats.find(item => item.k === '探店').v
  assert.notEqual(shops, 12, '一旦读数被 slice(0,12) 之类截断,这里会变 12 并判红')
})

test('护照只统计当前玩家的漫游记录，不认领旧共享缓存或其他玩家记录', () => {
  const ownSessions = [{ ts: 20201, distance: '2.0', shops: 2, photos: [] }]
  const { page, wxMock, appMock } = loadRoamPage([], {
    playerId: '202',
    storage: {
      roam_sessions: Array.from({ length: 9 }, (_, index) => ({ ts: index + 1, shops: 9 })),
      'roam_memory_v1:101:sessions': [{ ts: 10101, distance: '1.0', shops: 1 }],
      'roam_memory_v1:202:sessions': ownSessions,
    },
  })
  const previousWx = global.wx
  const previousGetApp = global.getApp
  try {
    global.wx = wxMock
    global.getApp = () => appMock
    page._loadIntroPassport()
  } finally {
    global.wx = previousWx
    global.getApp = previousGetApp
  }

  const stat = key => page.data.passport.stats.find(item => item.k === key).v
  assert.equal(stat('漫游'), 1)
  assert.equal(stat('探店'), 2)
  assert.equal(stat('公里'), '2.0')
})
