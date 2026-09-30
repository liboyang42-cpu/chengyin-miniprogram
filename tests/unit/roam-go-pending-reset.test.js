// 漫游是 tabBar 页,页面实例常驻(切 tab 不 onUnload,小程序热启动也保留实例)。
// goStart 的在途标记 _roamStartPending 若因弹窗/网络异常没被清,之后每次点 GO 和相机都静默 return,
// 且冷启动前无法自愈 —— 实机上表现为「GO 点了完全没反应,重启也没用」。
// onShow 必须把它归零,这是已死锁的实例唯一的自愈点。
const { test } = require('node:test')
const assert = require('node:assert/strict')

const PAGE_MODULE = '../../pages/roam/index.js'

function loadRoamPage() {
  let definition
  const previous = { Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx }
  try {
    global.Page = config => { definition = config }
    global.getApp = () => ({ globalData: {} })
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
  page.setData = function (patch) { Object.assign(this.data, patch) }
  return page
}

test('onShow 清掉 goStart 的在途标记,让已死锁的常驻实例自愈', () => {
  const page = loadRoamPage()
  const prevGetApp = global.getApp
  global.getApp = () => ({ globalData: {} })
  try {
    page._roamStartPending = true      // 模拟上一次 goStart 卡在途中(弹窗被吞/网络挂起)
    page.onShow()
    assert.equal(page._roamStartPending, false, 'onShow 后必须归零,否则 GO 永久静默')
  } finally {
    global.getApp = prevGetApp
  }
})

test('onShow 一并归零「开完就拍」的意图,别在下次出发时莫名弹相机', () => {
  const page = loadRoamPage()
  const prevGetApp = global.getApp
  global.getApp = () => ({ globalData: {} })
  try {
    page._shootAfterStart = true     // 上一次是点相机进来的,卡住了
    page.onShow()
    assert.equal(page._shootAfterStart, false, '陈旧的拍照意图必须清掉')
  } finally {
    global.getApp = prevGetApp
  }
})

test('onShow 作废在途流程:旧 chain 的回调弃权,不会开出第二个会话', () => {
  const page = loadRoamPage()
  const prevGetApp = global.getApp
  const prevWx = global.wx
  let locOpts = null
  let consentCalls = 0
  let openedSessions = 0
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    getLocation: opts => { locOpts = opts },   // 扣住回调,模拟定位还没回来
  }
  global.getApp = () => ({
    globalData: {},
    recordConsent: () => { consentCalls += 1; return new Promise(() => {}) },
  })
  page._openRoamMap = () => { openedSessions += 1 }
  try {
    page.onShow()
    page.goStart()                       // 本次 chain 捕获当前世代
    assert.ok(locOpts, 'goStart 应该走到 wx.getLocation')
    page.onShow()                        // 切走再回来 ⇒ 世代 +1,在途流程作废
    locOpts.success({ latitude: 31.23, longitude: 121.47 })  // 旧 chain 的回调这才回来
    assert.equal(openedSessions, 0, '已作废的 chain 不该再开第二个会话')
    assert.equal(consentCalls, 0, '已作废的 chain 不该再补 recordConsent 留痕')
  } finally {
    global.getApp = prevGetApp
    global.wx = prevWx
  }
})

test('onShow 归零后 goStart 不再被首行守卫挡掉', () => {
  const page = loadRoamPage()
  const prevGetApp = global.getApp
  const prevWx = global.wx
  let locRequested = false
  global.getApp = () => ({ globalData: {} })
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    getLocation: () => { locRequested = true },   // 只验证走到了请求定位这一步
  }
  try {
    page._roamStartPending = true
    page.onShow()
    page.goStart()
    assert.equal(locRequested, true, 'goStart 应该走到 wx.getLocation,而不是被 _roamStartPending 挡在首行')
  } finally {
    global.getApp = prevGetApp
    global.wx = prevWx
  }
})

// 门闩是在 markRoamIntroSeen 之前置上的。这一步一旦抛,门闩已经 true 而 getLocation 永远不会被
// 调用 ⇒ 之后每次点 GO 都在首行静默 return,页面毫无反应,冷启动前不自愈。
// 注意抛点在哪:markRoamIntroSeen 内部已经把 wx.setStorageSync 裹了 try,真正裸奔的是它上一行的
// buildRoamIntroSeenKey() —— 那里面直接调 getApp()/getUserID()。所以负控必须从 getApp 下手,
// 拿 setStorageSync 构造异常会被内部 try 吞掉,测了个寂寞(本条最初就是这么写的,假绿)。
test('取「看过引导」标记时抛异常,不能把 GO 的门闩焊死', () => {
  const page = loadRoamPage()
  const prevGetApp = global.getApp
  const prevWx = global.wx
  let locRequests = 0
  global.getApp = () => { throw new Error('getApp 在这一刻不可用') }
  global.wx = {
    getStorageSync: () => undefined,
    setStorageSync: () => {},
    getLocation: () => { locRequests += 1 },
  }
  try {
    page.goStart()
    assert.equal(locRequests, 1, '取本地标记失败不该挡住这次出发')
    // 更要紧的是别把下一次也毒死。注意 onShow 自己也调 getApp(读 avatar),所以这里要先把
    // getApp 恢复正常再走自愈路径 —— 否则测的就变成「onShow 抗不抗 getApp 抛」了,不是本条的意图。
    // (门闩归零排在 onShow 里读 getApp 之前,所以即便那一步抛,自愈本身仍然发生。)
    global.getApp = () => ({ globalData: {} })
    page.onShow()
    page.goStart()
    assert.equal(locRequests, 2, '第二次点 GO 仍须走到 getLocation,而不是被卡住的门闩静默吃掉')
  } finally {
    global.getApp = prevGetApp
    global.wx = prevWx
  }
})
