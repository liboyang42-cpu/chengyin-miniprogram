'use strict'

// R10-06/07:关注调用端必须带「期望状态」——丢响应后重试同一意图不得反转;
// 失败不假成功、不吞错;迟回包/切账号(代际)不落屏。真实 Page/Component + 请求桩。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

const PROFILE = 'components/cy/profile/index.js'
const SQUARE_LIST = 'pages/square/list/index.js'
const SQUARE_DETAIL = 'pages/square/detail/index.js'
const ORDER_DETAIL = 'components/cy/scene-member-order-detail/index.js'

global.wx = global.wx || {
  showToast() {}, hideToast() {}, showLoading() {}, hideLoading() {},
  getStorageSync() { return '' }, setStorageSync() {},
  stopPullDownRefresh() {}, startPullDownRefresh() {},
  navigateTo() {}, navigateBack() {}, reLaunch() {}, switchTab() {},
  setNavigationBarTitle() {}, previewImage() {}, vibrateShort() {}, pageScrollTo() {},
}

// 被 require 的重型 utils 全部替换成惰性 no-op 代理:调用端逻辑驱动时只碰到少量方法。
function noopModule() {
  const fn = function () { return noopModule() }
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === 'then' || prop === 'toJSON') return undefined
      return noopModule()
    },
    apply() { return noopModule() },
    construct() { return {} },
  })
}

function setByPath(target, keyPath, value) {
  const parts = keyPath.split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function mount(relativePath, kind, options = {}) {
  const requests = []
  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => '9',
    getPageSize: () => 10,
    getTotalPage: () => 1,
    tips() {},
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(request) { requests.push(request) },
  }, options.app || {})
  global.getApp = () => app
  let definition
  const context = {
    getApp: () => app,
    getCurrentPages: () => [{}],
    wx: global.wx,
    Page: (d) => { definition = d },
    Component: (d) => { definition = d },
    require: () => noopModule(),
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    console,
    Date, JSON, Object, Array, Number, String, Math, Promise, isFinite, isNaN,
  }
  vm.runInNewContext(options.source || read(relativePath), context, { filename: relativePath })

  const methods = kind === 'component' ? definition.methods : definition
  const instance = {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback.call(this)
    },
    triggerEvent() {},
  }
  Object.entries(methods).forEach(([name, fn]) => { if (typeof fn === 'function') instance[name] = fn.bind(instance) })
  const asked = (url) => requests.filter((r) => r.url === url)
  instance.answer = (url, response) => {
    const request = asked(url).pop()
    assert.ok(request, '缺少请求 ' + url)
    request.success(response)
    if (request.complete) request.complete()
  }
  instance.failLast = (url) => {
    const request = asked(url).pop()
    assert.ok(request, '缺少请求 ' + url)
    request.fail({ errMsg: 'request:fail timeout' })
    if (request.complete) request.complete()
  }
  return { instance, requests, asked }
}

// ---------------------------------------------------------------- 个人主页

function mountProfile(options = {}) {
  const requests = []
  let definition = null
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => '9',
    getUserRole: () => 'player',
    getUserType: () => 1,
    isDevEnv: () => false,
    getPageSize: () => 10,
    sendRequest(request) { requests.push(request) },
    tips() {},
  }
  global.getApp = () => app
  global.Component = (def) => { definition = def }
  delete require.cache[require.resolve(path.join(ROOT, PROFILE))]
  require(path.join(ROOT, PROFILE))

  const component = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
  })
  Object.keys(definition.properties || {}).forEach((key) => {
    const prop = definition.properties[key]
    component.data[key] = options[key] !== undefined ? options[key] : prop.value
  })
  component.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setByPath(component.data, key, value))
    if (callback) callback()
  }
  component.requests = requests
  component.answer = (url, response) => {
    const list = requests.filter((r) => r.url === url)
    const request = list[list.length - 1]
    assert.ok(request, '缺少请求 ' + url)
    request.success(response)
    if (request.complete) request.complete()
  }
  return component
}

function followRequest(requests) {
  const list = requests.filter((r) => r.url === '/api/user/follow/action')
  assert.ok(list.length, '缺少关注请求')
  return list[list.length - 1]
}

test('个人主页:关注请求带意图态,丢响应重试同一意图不反转,代际变化丢弃迟回包', async () => {
  const profile = mountProfile({ userId: '88' })
  profile.setData({ subjectIsMerchant: false, userInfo: { isFollow: 0 }, primaryCta: '关注' })

  profile.toggleFollow()
  assert.equal(followRequest(profile.requests).data.follow, 1, '首次关注必须带 follow=1')

  // 丢响应:UI 不翻、不假成功
  const first = followRequest(profile.requests)
  first.fail({ errMsg: 'request:fail timeout' })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(profile.data.userInfo.isFollow, 0, '失败不得把 UI 置成已关注')
  assert.equal(profile.data.followSubmitting, false)

  // 用户保持同一意图重试:仍发 follow=1(服务端据此幂等,不会变取消)
  profile.toggleFollow()
  assert.equal(followRequest(profile.requests).data.follow, 1, '重试必须保持同一意图,不得反转为取消')
  profile.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(profile.data.userInfo.isFollow, 1)
  assert.equal(profile.data.primaryCta, '已关注')

  // 主动取消:意图 0
  profile.toggleFollow()
  assert.equal(followRequest(profile.requests).data.follow, 0)
  profile.answer('/api/user/follow/action', { code: '200' })
  await Promise.resolve(); await Promise.resolve()
  assert.equal(profile.data.userInfo.isFollow, 0)
  assert.equal(profile.data.primaryCta, '关注')
})

test('个人主页:切账号/资料换代后迟到的关注回包不得落屏', async () => {
  const profile = mountProfile({ userId: '88' })
  profile.setData({ subjectIsMerchant: false, userInfo: { isFollow: 0 }, primaryCta: '关注' })
  profile.toggleFollow()
  const request = followRequest(profile.requests)

  // 切账号/资料读回使代际 +1
  profile._followEpoch = (profile._followEpoch || 0) + 1
  request.success({ code: '200' })
  await Promise.resolve(); await Promise.resolve()

  assert.equal(profile.data.userInfo.isFollow, 0, '旧代际回包不得把新会话的 UI 翻成已关注')
})

// ---------------------------------------------------------------- 广场列表 / 详情

test('广场列表:关注带意图态,失败不翻 UI,重试同意图不反转', () => {
  const { instance, asked } = mount(SQUARE_LIST, 'page')
  instance.setData({ list: [{ memberId: 88, isFollowTheUser: 0, id: 1 }] })

  instance.followClick({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(asked('/api/user/follow/action')[0].data.follow, 1)

  instance.failLast('/api/user/follow/action')
  assert.equal(instance.data.list[0].isFollowTheUser, 0, '丢响应不得把列表项置成已关注')

  instance.followClick({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(asked('/api/user/follow/action')[1].data.follow, 1, '重试必须同一意图')
  instance.answer('/api/user/follow/action', { code: '200' })
  assert.equal(instance.data.list[0].isFollowTheUser, 1)

  instance.followClick({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(asked('/api/user/follow/action')[2].data.follow, 0, '已关注后再点才是取消')
  instance.answer('/api/user/follow/action', { code: '200' })
  assert.equal(instance.data.list[0].isFollowTheUser, 0)
})

test('广场详情:关注带意图态并只有成功才翻 UI', () => {
  const { instance, asked } = mount(SQUARE_DETAIL, 'page')
  instance.setData({ info: { memberId: 88, isFollowTheUser: 0 } })

  instance.followClick({})
  assert.equal(asked('/api/user/follow/action')[0].data.follow, 1)
  instance.failLast('/api/user/follow/action')
  assert.equal(instance.data.info.isFollowTheUser, 0)

  instance.followClick({})
  assert.equal(asked('/api/user/follow/action')[1].data.follow, 1)
  instance.answer('/api/user/follow/action', { code: '200' })
  assert.equal(instance.data.info.isFollowTheUser, 1)
})

test('广场详情评论区:关注按钮只表达关注,重试幂等', () => {
  const { instance, asked } = mount(SQUARE_DETAIL, 'page')
  instance.setData({ id: 5, list: [{ id: 1, memberId: 88, isFollowTheUser: 0 }] })

  instance.commentFollowClick({ currentTarget: { dataset: { index: 0 } } })
  const request = asked('/api/user/follow/action')[0]
  assert.ok(request)
  assert.equal(request.data.follow, 1, '评论区关注必须是 follow=1 目标态')
})

test('订单详情:关注主办带 follow=1,失败不假成功', () => {
  const { instance, asked } = mount(ORDER_DETAIL, 'component')
  instance.setData({ completion: { revisit: { canFollow: true, clubLeaderMemberId: 88, followed: false } } })

  instance.followClub()
  assert.equal(asked('/api/user/follow/action')[0].data.follow, 1)
  instance.failLast('/api/user/follow/action')
  assert.equal(instance.data.completion.revisit.followed, false, '失败不得显示已关注')

  instance.followClub()
  assert.equal(asked('/api/user/follow/action')[1].data.follow, 1)
  instance.answer('/api/user/follow/action', { code: '200' })
  assert.equal(instance.data.completion.revisit.followed, true)
})

// ---------------------------------------------------------------- 负控

test('负控:广场列表去掉意图态参数时必须判红', () => {
  const source = read(SQUARE_LIST)
  const mutated = source.replace('        follow: intendedFollow,\n', '')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 follow 意图态')
  const { instance, asked } = mount(SQUARE_LIST, 'page', { source: mutated })
  instance.setData({ list: [{ memberId: 88, isFollowTheUser: 0, id: 1 }] })
  instance.followClick({ currentTarget: { dataset: { index: 0 } } })
  assert.throws(() => assert.equal(asked('/api/user/follow/action')[0].data.follow, 1), assert.AssertionError)
})

test('负控:个人主页去掉意图态参数时必须判红', () => {
  const source = read(PROFILE)
  const mutated = source.replace(', follow: intendedFollow ', ' ')
  assert.notEqual(mutated, source, '负控锚点失效:未找到 follow 意图态')
  const requests = []
  let definition = null
  const app = {
    globalData: {},
    getUserID: () => '9',
    getUserRole: () => 'player',
    getUserType: () => 1,
    isDevEnv: () => false,
    getPageSize: () => 10,
    sendRequest(request) { requests.push(request) },
    tips() {},
  }
  global.getApp = () => app
  global.Component = (def) => { definition = def }
  vm.runInNewContext(mutated, {
    getApp: () => app,
    Component: global.Component,
    wx: global.wx,
    require: (id) => require(path.resolve(path.dirname(path.join(ROOT, PROFILE)), id)),
    console, Promise, Object, Array, Number, String, Math, Date, isFinite, isNaN, JSON,
  }, { filename: PROFILE })
  const profile = Object.assign({}, definition.methods, { data: JSON.parse(JSON.stringify(definition.data)) })
  profile.setData = (patch) => Object.entries(patch).forEach(([k, v]) => setByPath(profile.data, k, v))
  profile.setData({ subjectIsMerchant: false, userInfo: { isFollow: 0 }, primaryCta: '关注' })
  profile.toggleFollow()
  assert.throws(() => assert.equal(followRequest(requests).data.follow, 1), assert.AssertionError)
})

// ---------------------------------------------------------------- R10-06 读侧:清空后对端不可见

test('广场详情:清空后的空 pics 不再渲染空媒体位', () => {
  const { instance } = mount(SQUARE_DETAIL, 'page')
  instance.setData({ id: 5 })
  instance.getData()
  instance.answer('/api/creativesquare/info', {
    code: '200',
    data: { id: 5, memberId: 9, contents: '正文', pics: '', address: '', longitude: '', latitude: '' },
  })
  assert.equal(instance.data.picList.length, 0, '空 pics 必须解析为空数组,不能是 [""]')
})

test('广场列表:清空后的空 pics 解析为空数组', () => {
  const { instance } = mount(SQUARE_LIST, 'page')
  instance.getList(true, 1)
  instance.answer('/api/creativesquare/list', {
    code: '200',
    data: { rows: [{ id: 5, memberId: 9, contents: '正文', pics: '', address: '' }], total: 1 },
  })
  assert.equal(instance.data.list[0].picList.length, 0, '列表空 pics 不得解析出空图片位')
})

test('负控:详情读侧不做空段过滤时必须判红', () => {
  const source = read(SQUARE_DETAIL)
  const mutated = source.replace(".split(';').filter(function (pic) { return pic; })", ".split(';')")
  assert.notEqual(mutated, source, '负控锚点失效:未找到空段过滤')
  const { instance } = mount(SQUARE_DETAIL, 'page', { source: mutated })
  instance.setData({ id: 5 })
  instance.getData()
  instance.answer('/api/creativesquare/info', {
    code: '200',
    data: { id: 5, memberId: 9, contents: '正文', pics: '', address: '' },
  })
  assert.throws(() => assert.equal(instance.data.picList.length, 0), assert.AssertionError)
})
