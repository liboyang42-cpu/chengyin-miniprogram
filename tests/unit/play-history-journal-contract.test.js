// 规则16 历史履约:nodes 返回的 historyNodes 只作手记/剧情只读回看,
// 不并入可玩 nodes(不参与 total/完成率/解锁/推荐/地图),也没有挑战/发奖入口。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')

const PLAY_PAGE = '../../pages/play/index.js'

let pageConfig

function setByPath(target, rawPath, value) {
  const parts = rawPath.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

beforeEach(() => {
  pageConfig = null
  global.getApp = () => ({
    globalData: { user_id: 9, features: {} },
    isDevEnv: () => false,
    sendRequest: () => {},
    getUploadClient: () => ({ uploadAll: () => ({ destroy() {} }) }),
  })
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showLoading() {},
    hideLoading() {},
    showToast() {},
    showModal: ({ success }) => success && success({ confirm: false }),
  }
  global.Page = (config) => { pageConfig = config }
})

function loadPlayPage() {
  delete require.cache[require.resolve(PLAY_PAGE)]
  require(PLAY_PAGE)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = function (patch, callback) {
    Object.keys(patch || {}).forEach((key) => setByPath(this.data, key, patch[key]))
    if (callback) callback()
  }
  return page
}

function pageWithHistory() {
  const page = loadPlayPage()
  page.data.mode = 1
  page.data.allDone = true
  page.data.total = 1
  page.data.doneCount = 1
  page.data.nodes = [{
    nodeId: 11, num: 1, sortId: 1, name: '在线站', description: '在线正文',
    done: true, doneAt: 100, imgUrl: 'https://cdn/online.png', fragmentText: '在线碎片',
  }]
  page._historyNodes = [{
    nodeId: 22, name: '已下架站', description: '历史正文', doneAt: 200,
    imgUrl: 'https://cdn/delisted.png', fragmentText: '历史碎片',
    history: true, done: true,
  }]
  page._routeState = { routeMode: 'LINEAR' }
  return page
}

test('historyNodes 只作只读手记卡续在末尾,不动可玩分母', () => {
  const page = pageWithHistory()

  page.buildJournal()

  const cards = page.data.journalCards
  assert.equal(cards.length, 2, '主线 1 张 + 历史 1 张')
  assert.equal(cards[0].nodeId, 11)
  const h = cards[1]
  assert.equal(h.key, 'history-22')
  assert.equal(h.nodeId, 22)
  assert.equal(h.history, true, '历史卡必须可识别')
  assert.equal(h.kvK, '已下架')
  assert.equal(h.kvT, '已下架站')
  assert.ok(!h.locked, '历史卡不是未解锁态')
  // 完成率分母保持当前可玩集合,不被历史站改变
  assert.equal(page.data.total, 1)
  assert.equal(page.data.doneCount, 1)
})

test('历史卡只走只读全文,不进入可玩查找', () => {
  const page = pageWithHistory()

  assert.equal(page._nodeById(22), undefined, '历史站不得被可玩查找命中')
  const history = page._historyNodeById(22)
  assert.ok(history)
  assert.equal(history.name, '已下架站')
})

test('无 historyNodes 时手记行为不变', () => {
  const page = loadPlayPage()
  page.data.mode = 1
  page.data.nodes = [{
    nodeId: 11, num: 1, sortId: 1, name: '在线站', description: '在线正文', done: false, doneAt: 0,
  }]
  page._routeState = { routeMode: 'LINEAR' }

  page.buildJournal()

  assert.equal(page.data.journalCards.length, 1)
  assert.equal(page.data.journalCards[0].nodeId, 11)
})

