const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')

/**
 * 2026-08-26:管理员打开管理 tab,NOW 卡的标题一度永远是「读取管理进度…」。
 *
 * 成因:阶段机每个分支都依赖 ownerProjectState / inviteFeedbackState,
 * 而喂它们的 loadOwnerManagement() 对非 owner 直接早退 —— stage 永远算不出来,
 * 停在初始的 'loading'。管理员是 #845 才拿到管理 tab 的,所以这条路径以前不存在。
 */
function loadPage() {
  const src = fs.readFileSync(path.join(ROOT, 'pages/club/detail/index.js'), 'utf8')
  let captured = null
  const sandbox = {
    Page(options) { captured = options },
    Component() {},
    getApp: () => ({ globalData: {}, getUserID: () => 1, getUserRole: () => 'player', sendRequest() {} }),
    require: (id) => {
      if (id.startsWith('.')) { try { return require(path.join(ROOT, 'pages/club/detail', id)) } catch (e) { return {} } }
      return {}
    },
    wx: { showToast() {}, navigateTo() {}, switchTab() {}, navigateBack() {} },
    module: { exports: {} }, exports: {}, console,
    Date, Set, Map, Number, String, Array, Object, Boolean, JSON, Math, isNaN, parseInt, parseFloat,
  }
  sandbox.global = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'club-detail.js' })
  assert.ok(captured, 'Page() 必须被调用')
  const page = Object.assign({}, captured)
  page.data = JSON.parse(JSON.stringify(captured.data))
  page.setData = function (patch) { Object.assign(page.data, patch) }
  return page
}

test('管理员的 NOW 卡落到 admin 终态,不停在「读取管理进度…」', () => {
  const page = loadPage()
  assert.equal(page.data.ownerStage, 'loading', '初始就是 loading —— 这正是当初漏出去的那一格')

  page.data.club = { id: 1, isOwner: false, viewerIsAdmin: true }
  page.data.topicState = 'ready'
  page._topics = [{ id: 11 }]
  page.updateOwnerStage()

  assert.equal(page.data.ownerStage, 'admin')
  assert.notEqual(page.data.ownerPrimaryLabel, '读取管理进度…', '管理员不得看到永不结束的加载文案')
  assert.ok(page.data.ownerStageHint && page.data.ownerStageHint.length > 0, 'admin 态必须有说明文案')
})

test('负控:主理人仍然走原来的阶段机,不被 admin 分支截胡', () => {
  const page = loadPage()
  page.data.club = { id: 1, isOwner: true, viewerIsAdmin: false }
  page.data.topicState = 'ready'
  page._topics = []            // 没有项目 ⇒ publish 阶段
  page.updateOwnerStage()
  assert.equal(page.data.ownerStage, 'publish', '主理人无项目时必须是 publish,不能被 admin 分支吃掉')

  page.data.topicState = 'error'
  page.updateOwnerStage()
  assert.equal(page.data.ownerStage, 'error', '主理人的错误态必须还在')
})

test('负控:普通成员根本不该进管理 tab,更不该拿到 admin 阶段', () => {
  const page = loadPage()
  page.data.club = { id: 1, isOwner: false, viewerIsAdmin: false }
  page.data.topicState = 'ready'
  page._topics = [{ id: 11 }]
  page.updateOwnerStage()
  assert.notEqual(page.data.ownerStage, 'admin', '非治理者不得落到 admin 终态')
})
