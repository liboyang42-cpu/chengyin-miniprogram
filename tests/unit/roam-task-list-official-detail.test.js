const { test } = require('node:test')
const assert = require('node:assert/strict')

// 3-18(阻断#16b):任务列表的行是 official_event,曾用同一 id 开普通活动详情(查 cms_activity)。
test('漫游任务列表点一行:交宿主打开官方活动详情页,不走普通活动详情场景', () => {
  let def
  const events = []
  global.getApp = () => ({ sendRequest() {} })
  global.Component = c => { def = c }
  const mod = require.resolve('../../components/cy/scene-roam-task-list/index.js')
  delete require.cache[mod]
  require(mod)
  const vm = Object.assign({}, def.methods, { triggerEvent: (name, detail) => events.push({ name, detail }) })
  vm.openDetail({ currentTarget: { dataset: { id: 42 } } })
  assert.deepEqual(events, [{ name: 'official', detail: { id: 42 } }], '不能再开 play-activity-detail 场景')

  let page
  const nav = []
  const prev = { Page: global.Page, getApp: global.getApp, wx: global.wx, getCurrentPages: global.getCurrentPages }
  global.Page = c => { page = c }
  global.getApp = () => ({ globalData: { features: {} }, getUserID: () => '1' })
  global.getCurrentPages = () => []
  global.wx = { getStorageSync: () => undefined, navigateTo: o => nav.push(o.url) }
  try {
    delete require.cache[require.resolve('../../pages/roam/index.js')]
    require('../../pages/roam/index.js')
    page.openOfficialEvent({ detail: { id: 42 } })
  } finally { Object.assign(global, prev) }
  assert.deepEqual(nav, ['/pages/activity/official-detail/index?id=42'])
})

test('每个挂 cy-scene-roam-task-list 的宿主都绑了 official(漏绑 = 点行没反应)', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { execSync } = require('node:child_process')
  const root = path.resolve(__dirname, '../..')
  const hosts = execSync("git grep -l '<cy-scene-roam-task-list' -- '*.wxml'", { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  assert.ok(hosts.length >= 3, '宿主清单异常:' + hosts.join(','))
  for (const host of hosts) {
    for (const tag of fs.readFileSync(path.join(root, host), 'utf8').match(/<cy-scene-roam-task-list[^>]*>/g)) {
      assert.match(tag, /bind:official="[A-Za-z]+"/, host + ' 没绑 official')
    }
  }
})
