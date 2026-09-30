const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const PAGE = '../../pages/index/index.js'
let pageConfig
let sent
let userId
let reloginCalls
let roleUpdates
let isDev

global.getApp = () => ({
  isDevEnv: () => isDev,
  getUserID: () => userId,
  getUserType: () => 0,
  getUserRole: () => 'user',
  getImgUrl: (value) => value,
  sendRequest: (request) => { sent.push(request) },
  reLogin: () => { reloginCalls += 1 },
  setUserRole: (role) => { roleUpdates.push(role) },
  setUserType() {},
  setOpenID() {},
  tips() {},
  // 首页 onShow 会挂在"登录已落地"信号上复判身份(见 index-identity-recheck-after-login)。
  // 本文件的 storage 桩恒返回空 ⇒ 复判判定为玩家、当场返回,不影响下面这些用例。
  waitForAppReady: () => Promise.resolve(),
})

global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  removeStorageSync() {},
  showToast() {},
  showLoading() {},
  hideLoading() {},
  hideTabBar() {},
  setNavigationBarColor() {},
  navigateTo() {},
  redirectTo() {},
  switchTab() {},
  getWindowInfo: () => ({ statusBarHeight: 20, screenHeight: 812, windowHeight: 812, windowWidth: 375 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20, screenHeight: 812, windowHeight: 812, windowWidth: 375 }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32, right: 360, left: 280 }),
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  sent = []
  userId = 'member-1'
  reloginCalls = 0
  roleUpdates = []
  isDev = false
  pageConfig = null
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

function makePage() {
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  page.setData = (patch, callback) => {
    Object.keys(patch).forEach((key) => { page.data[key] = patch[key] })
    if (callback) callback()
  }
  return page
}

test('旧账号的用户资料响应不能覆盖新账号', () => {
  const page = makePage()
  page.getUserData()
  assert.equal(sent.length, 1)

  userId = 'member-2'
  sent[0].success({ code: '200', data: { nickname: '旧账号', phone: '13800000000' } })

  assert.notEqual(page.data.userInfo.nickname, '旧账号')
})

test('当前账号的用户资料响应可以正常写入', () => {
  const page = makePage()
  page.getUserData()

  sent[0].success({ code: '200', data: { nickname: '当前账号', phone: '13800000000' } })

  assert.equal(page.data.userInfo.nickname, '当前账号')
})

test('当前账号的角色响应可以更新身份快照', () => {
  const page = makePage()
  page.fetchCityEvent = () => {}

  page.onShow()
  assert.equal(sent.length, 1)
  sent[0].success({ code: '200', data: { role: 'user', userType: 0 } })

  assert.deepEqual(roleUpdates, [{ role: 'user', userType: 0 }])
})

test('旧账号的角色响应不能更新新账号身份快照', () => {
  const page = makePage()
  page.fetchCityEvent = () => {}

  page.onShow()
  assert.equal(sent.length, 1)
  userId = 'member-2'
  sent[0].success({ code: '200', data: { role: 'merchant', userType: 2 } })

  assert.deepEqual(roleUpdates, [])
})

test('换号时立即清空已显示的旧账号资料，后续请求失败也不恢复', () => {
  const page = makePage()
  page._privateDataMemberId = 'member-1'
  page._privateDataEpoch = 1
  page.data.userInfo = { avatar: 'old.png', nickname: '旧账号', point: '88' }
  page.data.continueExplore = { title: '旧账号私人旅程' }
  page.data.showPhoneModal = true
  userId = 'member-2'

  page.getUserData()

  assert.deepEqual(page.data.userInfo, { avatar: '', nickname: '', point: '0' })
  assert.equal(page.data.continueExplore, null)
  assert.equal(page.data.showPhoneModal, false)
  sent[0].fail({ errMsg: 'request:fail timeout' })
  assert.deepEqual(page.data.userInfo, { avatar: '', nickname: '', point: '0' })
})

test('开始重新登录后，同账号的旧响应也不能回写', () => {
  const page = makePage()
  page.getUserData()
  page.firstLogin()
  assert.equal(reloginCalls, 1)

  sent[0].success({ code: '200', data: { nickname: '旧会话', phone: '13800000000' } })

  assert.notEqual(page.data.userInfo.nickname, '旧会话')
})

test('旧账号的继续旅程响应不能泄露给新账号', () => {
  const page = makePage()
  page.loadContinueExplore()
  assert.equal(sent.length, 2, '报名旅程 + 进行中游戏会话两路')

  userId = 'member-2'
  sent[0].success({ code: '200', data: [{ id: 1, ownerType: 2, cmsActivity: { name: '旧账号私人旅程' } }] })
  sent[1].success({ code: '200', data: [{ activityId: 27, topicId: 31, title: '旧账号的游戏', elapsedSeconds: 60 }] })

  assert.equal(page.data.continueExplore, null)
})

test('拍板22 服务端有进行中的游戏会话时,首页卡片是「继续游戏」并直达游玩页(不论两路谁先回)', () => {
  const page = makePage()
  page.loadContinueExplore()
  assert.equal(sent[1].url, '/api/play/run-session/list')
  sent[1].success({ code: '200', data: [{ activityId: 27, topicId: 31, title: '外滩夜游', elapsedSeconds: 605 }] })
  sent[0].success({ code: '200', data: [{ id: 2, ownerType: 2, cmsActivity: { name: '当前旅程' } }] })

  assert.equal(page.data.continueExplore.kicker, '继续游戏')
  assert.equal(page.data.continueExplore.title, '外滩夜游')
  assert.equal(page.data.continueExplore.sub, '已暂停 · 已用时 10:05')
  assert.equal(page.data.continueExplore.focusPath, '/pages/play/index?activityId=27')
})

test('拍板22 没有进行中的游戏会话(或读失败)时,回落到报名旅程卡', () => {
  const page = makePage()
  page.loadContinueExplore()
  sent[0].success({ code: '200', data: [{ id: 2, ownerType: 1, cmsTopic: { name: '梧桐区' } }] })
  sent[1].fail({ errMsg: 'request:fail timeout' })
  assert.equal(page.data.continueExplore.kicker, '继续探索')
  assert.equal(page.data.continueExplore.title, '梧桐区')
})

test('当前账号的继续旅程响应可以正常展示', () => {
  const page = makePage()
  page.loadContinueExplore()

  sent[0].success({ code: '200', data: [{ id: 2, ownerType: 2, cmsActivity: { name: '当前旅程' } }] })

  assert.equal(page.data.continueExplore.title, '当前旅程')
})

test('首页卸载后私人资料与继续旅程的迟到响应都不能继续写页', () => {
  const page = makePage()
  page.getUserData()
  page.loadContinueExplore()
  const profileRequest = sent[0]
  const journeyRequest = sent[1]

  page.onUnload()
  profileRequest.success({ code: '200', data: { nickname: '卸载后资料', phone: '13800000000' } })
  journeyRequest.success({
    code: '200',
    data: [{ id: 9, ownerType: 2, cmsActivity: { name: '卸载后旅程' } }],
  })

  assert.notEqual(page.data.userInfo.nickname, '卸载后资料')
  assert.equal(page.data.continueExplore, null)
})

test('首页再次显示时同时刷新当前账号资料和继续旅程', async () => {
  const page = makePage()
  const calls = []
  page.data.isAppReady = true
  page.fetchCityEvent = () => {}
  page.getUserData = () => calls.push('profile')
  page.loadContinueExplore = () => calls.push('journey')

  page.onShow()
  await new Promise(resolve => setTimeout(resolve, 120))

  assert.deepEqual(calls, ['profile', 'journey'])
})

test('旧会话手机号响应不能写入当前账号', () => {
  const page = makePage()
  page.getPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' } })
  assert.equal(sent.length, 1)

  userId = 'member-2'
  sent[0].success({ code: '200', msg: '13800000000' })

  assert.equal(page.data['userInfo.phone'], undefined)
})

test('当前会话手机号响应可以正常写入', () => {
  const page = makePage()
  page.getPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' } })

  sent[0].success({ code: '200', msg: '13800000000' })

  assert.equal(page.data['userInfo.phone'], '13800000000')
})

test('当前会话从 data 写入绑定手机号,不把 msg 当号码', () => {
  const page = makePage()
  page.getPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' } })

  sent[0].success({ code: '200', msg: '操作成功', data: '13912345678' })

  assert.equal(page.data['userInfo.phone'], '13912345678')
  assert.equal(page.data.showPhoneModal, false)
})

test('消毒后的操作失败不能当成手机号写入', () => {
  const page = makePage()
  page.getPhoneNumber({ detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' } })

  sent[0].success({ code: '200', msg: '操作失败' })

  assert.equal(page.data['userInfo.phone'], undefined)
})

test('开发预览的游客态不能重新注入示例用户身份', (t) => {
  const page = makePage()
  isDev = true
  userId = ''

  page._applyIndexUiMock()
  t.after(() => clearInterval(page.data.countdownTimer))

  assert.deepEqual(page.data.userInfo, { avatar: '', nickname: '', point: '0' })
  assert.ok(page.data.nearbyActivityList.length > 0, '游客仍可预览公开首页内容')
})

test('游客态不重试私人资料请求，也不显示登录过期错误', () => {
  const page = makePage()
  userId = ''
  let scheduled = 0
  const originalSetTimeout = global.setTimeout
  global.setTimeout = () => { scheduled += 1 }
  try {
    page.getUserData()
  } finally {
    global.setTimeout = originalSetTimeout
  }

  assert.equal(scheduled, 0)
  assert.equal(sent.length, 0)
  assert.equal(page.data.isLoading, false)
})

test('取消授权必须关掉手机号弹窗，遮罩不能挡死首页', () => {
  const page = makePage()
  page.data.showPhoneModal = true
  page.getPhoneNumber({ detail: { errMsg: 'getPhoneNumber:fail user deny' } })
  assert.equal(page.data.showPhoneModal, false)
})

test('推荐卡报名数读 signupCount，不读对不上后端的 enrollCount', () => {
  const page = makePage()
  page.data.recommendedTopicList = [{
    id: 9,
    name: '外滩夜行',
    signupCount: 28,
    enrollCount: undefined,
    joinCount: undefined,
    signUpCount: undefined,
  }]
  page._buildRecoHero()
  assert.match(page.data.recoCards[0].metaLine, /28 人已报名/)
})
