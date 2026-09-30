const { test } = require('node:test')
const assert = require('node:assert/strict')

// 3-17(阻断#16a):运行态抽屉点「勋章」曾把 screen 置空 → 整页黑屏,计时/定位还在跑。
function loadPage() {
  let def
  const nav = []
  const prev = { Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx }
  global.Page = c => { def = c }
  global.getApp = () => ({ globalData: { features: {} }, getUserID: () => '101' })
  global.getCurrentPages = () => []
  global.wx = { getStorageSync: () => undefined }
  try {
    delete require.cache[require.resolve('../../pages/roam/index.js')]
    require('../../pages/roam/index.js')
  } finally { Object.assign(global, prev) }
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) })
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb() }
  return { page, nav }
}

test('运行态抽屉点「勋章」:不清空 screen,去勋章墙页面', () => {
  const { page, nav } = loadPage()
  page.data.screen = 'map'
  const prevWx = global.wx
  global.wx = { navigateTo: o => nav.push(o.url) }
  try { page.openRoamPassport() } finally { global.wx = prevWx }
  assert.equal(page.data.screen, 'map', 'screen 必须仍是运行态,不能置空')
  assert.deepEqual(nav, ['/subpackageP3/pages/badge-wall/index/index'])
})
