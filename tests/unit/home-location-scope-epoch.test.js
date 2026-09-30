'use strict'

const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const PAGE = '../../pages/index/index.js'

let pageConfig
let memberId
let requests
let locationCalls
let settingCalls
let authorizeCalls
let loadingVisible

global.getApp = () => ({
  globalData: {},
  getUserID: () => memberId,
  getUserType: () => 0,
  getImgUrl: (value) => value,
  sendRequest: (request) => {
    requests.push(request)
    return { abort() {} }
  },
})

global.wx = {
  getStorageSync: () => '',
  getSetting: (options) => { settingCalls.push(options) },
  authorize: (options) => { authorizeCalls.push(options) },
  getLocation: (options) => { locationCalls.push(options) },
  showLoading: () => { loadingVisible = true },
  hideLoading: () => { loadingVisible = false },
  showToast() {},
  setNavigationBarColor() {},
}

global.Page = (config) => { pageConfig = config }

beforeEach(() => {
  memberId = 'member-a'
  requests = []
  locationCalls = []
  settingCalls = []
  authorizeCalls = []
  loadingVisible = false
  pageConfig = null
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

function makePage() {
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  })
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach((key) => { page.data[key] = patch[key] })
    if (callback) callback()
  }
  return page
}

test('旧账号发起的逆地理结果不得写入新账号', () => {
  const page = makePage()
  page.executeGetFuzzyLocation()
  locationCalls[0].success({ latitude: 31.2304, longitude: 121.4737 })

  const reverse = requests.find((request) => request.url === '/api/map/reverse-geocode')
  assert.ok(reverse, '定位成功后应发起逆地理解析')
  memberId = 'member-b'
  reverse.success({ code: 200, data: { city: '上海市' } })

  assert.equal(page.data.city, '')
  assert.equal(requests.some((request) => request.url === '/api/user/update'), false)
})

test('首页卸载后迟到的定位结果不得写页或继续发请求', () => {
  const page = makePage()
  let postUnloadWrites = 0
  const setData = page.setData
  page.setData = function (patch, callback) {
    postUnloadWrites += 1
    setData.call(this, patch, callback)
  }

  page.executeGetFuzzyLocation()
  page.onUnload()
  postUnloadWrites = 0

  assert.equal(loadingVisible, false, '离页必须立即收掉本页打开的全局定位 loading')
  locationCalls[0].success({ latitude: 31.2304, longitude: 121.4737 })

  assert.equal(postUnloadWrites, 0)
  assert.equal(requests.length, 0)
})

test('首页卸载后迟到的逆地理结果不得写城市或更新账号', () => {
  const page = makePage()
  page.executeGetFuzzyLocation()
  locationCalls[0].success({ latitude: 31.2304, longitude: 121.4737 })
  const reverse = requests.find((request) => request.url === '/api/map/reverse-geocode')
  assert.ok(reverse)

  page.onUnload()
  memberId = 'member-b'
  reverse.success({ code: 200, data: { city: '上海市' } })

  assert.equal(page.data.city, '')
  assert.equal(requests.some((request) => request.url === '/api/user/update'), false)
})

test('首页卸载后迟到的权限检查不得再发起授权', () => {
  const page = makePage()
  page.getFuzzyLocation()
  page.onUnload()

  settingCalls[0].success({ authSetting: {} })

  assert.equal(authorizeCalls.length, 0)
  assert.equal(locationCalls.length, 0)
})

test('首页卸载后迟到的模糊定位授权失败不得再申请精确定位', () => {
  const page = makePage()
  page.requestFuzzyLocationPermission()
  assert.equal(authorizeCalls.length, 1)
  page.onUnload()

  authorizeCalls[0].fail({ errMsg: 'authorize:fail' })

  assert.equal(authorizeCalls.length, 1)
  assert.equal(locationCalls.length, 0)
})
