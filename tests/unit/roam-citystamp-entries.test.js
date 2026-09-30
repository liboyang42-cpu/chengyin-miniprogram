const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 3-24「投一张」:scene-roam-poi-detail 只发 citystamp 事件,宿主不绑就是死按钮。
test('每个挂 cy-scene-roam-poi-detail 的宿主都绑了 citystamp', () => {
  const hosts = execSync("git grep -l '<cy-scene-roam-poi-detail' -- '*.wxml'", { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean)
  assert.ok(hosts.length >= 4, '宿主清单异常:' + hosts.join(','))
  for (const host of hosts) {
    for (const tag of read(host).match(/<cy-scene-roam-poi-detail[^>]*>/g)) {
      assert.match(tag, /bind:citystamp="[A-Za-z]+"/, host + ' 没绑 citystamp,「投一张」点了没反应')
    }
  }
})

test('深链宿主「投一张」:先收起深链页,再进城市签', () => {
  let def
  const nav = []
  const events = []
  global.Component = c => { def = c }
  global.getApp = () => ({ globalData: {} })
  global.wx = { navigateTo: o => nav.push(o.url), navigateBack() {} }
  const mod = require.resolve('../../components/cy/scene-deep-link/index.js')
  delete require.cache[mod]
  require(mod)
  const vm = Object.assign({}, def.methods, { data: { sceneId: 'roam-poi-detail' }, _rootOpened: true,
    triggerEvent: (n) => events.push(n) })
  const realTimeout = global.setTimeout
  global.setTimeout = (fn) => fn()
  try { vm.openCityStamp({ detail: { place: '外滩' } }) } finally { global.setTimeout = realTimeout }
  assert.deepEqual(events, ['close'])
  assert.deepEqual(nav, ['/subpackageRoam/citystamp/index?kind=sign&place=' + encodeURIComponent('外滩')])
})

// 3-24「城市贴纸」:打卡半屏第一行曾不带 kind,落到默认的「今日城市签」。
test('打卡后「城市贴纸」打开的是 kind=sticker', () => {
  let def
  const nav = []
  const prev = { Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx }
  global.Page = c => { def = c }
  global.getApp = () => ({ globalData: { features: {} }, getUserID: () => '1' })
  global.getCurrentPages = () => []
  global.wx = { getStorageSync: () => undefined, navigateTo: o => nav.push(o.url) }
  try {
    delete require.cache[require.resolve('../../pages/roam/index.js')]
    require('../../pages/roam/index.js')
    const page = Object.assign({}, def, { data: { checkinView: { place: '外滩' } }, setData(p) { Object.assign(this.data, p) } })
    page.onCheckinStamp()
  } finally { Object.assign(global, prev) }
  assert.equal(nav.length, 1)
  assert.match(nav[0], /^\/subpackageRoam\/citystamp\/index\?kind=sticker&/)
})
