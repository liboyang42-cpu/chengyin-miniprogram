'use strict'

// B-03:后端 M1-3 门卡(ApiActivityController.java:849-861)对非俱乐部成员回
// {gate:true, clubId, activityName, message}。玩家侧三个消费点以前都不认这个形状:
//   ① session-picker 判「票种没读出来」+ 恒失败重试
//   ② scene-play-activity-detail 当正常详情渲染 → 占位标题 + 空票种
//   ③ baoming 判整页 error → 「活动信息没能加载出来」+ 恒失败重试
// 现在三处都识别 gate,渲染加入引导并给出 clubId 跳转。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
const GATE = { gate: true, clubId: 77, activityName: '夜行俱乐部专场', message: '来自俱乐部的活动，加入后查看' }

function harness(relativePath, kind) {
  const requests = []
  const nav = []
  let definition
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44, user_id: 9 },
    getUserType: () => 1,
    getUserID: () => 9,
    tips: () => {},
    sendRequest: (options) => { requests.push(options); return { abort() {} } },
    getRequestErrorMessage: (res, fallback) => (res && (res.msg || res.errMsg)) || fallback,
    getPageSize: () => 10,
    goBack: () => {},
    isDevEnv: () => false,
  })
  global.Page = (config) => { definition = config }
  global.Component = (config) => { definition = config }
  global.wx = {
    showToast: () => {},
    hideLoading: () => {},
    showLoading: () => {},
    navigateTo: (options) => nav.push(options.url),
    redirectTo: (options) => nav.push(options.url),
    navigateBack: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getWindowInfo: () => ({ statusBarHeight: 20 }),
  }
  delete require.cache[require.resolve(path.join(ROOT, relativePath))]
  require(path.join(ROOT, relativePath))
  const vm = Object.assign({}, kind === 'component' ? definition.methods : definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb.call(this) },
    triggerEvent() {},
  })
  return { vm, requests, nav, definition }
}

test('session-picker:门卡渲染加入引导,不再报「票种没读出来」', () => {
  const { vm, requests, nav } = harness('pages/topic/components/cy/session-picker/index.js', 'component')
  vm.pickActivity(9)
  assert.equal(requests[0].url, '/api/activity/info')
  requests[0].success({ code: 200, data: GATE })

  assert.equal(vm.data.ticketsState, 'gate')
  assert.match(vm.data.ticketsError, /加入后查看/)
  assert.equal(vm.data.gateClubId, 77)
  assert.deepEqual(vm.data.tickets, [])

  vm.goGateClub()
  assert.deepEqual(nav, ['/pages/club/detail/index?id=77'])
})

test('scene-play-activity-detail:门卡进独立状态,不渲染占位详情', () => {
  const { vm, requests, nav } = harness('components/cy/scene-play-activity-detail/index.js', 'component')
  vm.load('9')
  requests[0].success({ code: 200, data: GATE })

  assert.equal(vm.data.state, 'gate')
  assert.match(vm.data.gateMessage, /加入后查看/)
  assert.equal(vm.data.gateClubId, 77)
  assert.deepEqual(vm.data.tickets, [], '门卡不得进入票种渲染')

  vm.goGateClub()
  assert.deepEqual(nav, ['/pages/club/detail/index?id=77'])
})

test('baoming:门卡不是整页 error,给加入俱乐部出口而不是重试', () => {
  const { vm, requests, nav, definition } = harness('pages/activity/baoming/baoming.js', 'page')
  vm.data.activityId = 9
  vm.getActivityInfo()
  assert.equal(requests[0].url, '/api/activity/info')
  requests[0].success({ code: 200, data: GATE })

  assert.equal(vm.data.pageState, 'gate')
  assert.equal(vm.data.canPay, false)
  assert.equal(vm.data.signupState, 'unavailable')
  assert.match(vm.data.loadErrorMsg, /加入后查看/)
  assert.equal(vm.data.gateClubId, 77)

  vm.goGateClub()
  assert.deepEqual(nav, ['/pages/club/detail/index?id=77'])

  // 门卡态没有重试出口:重试只有在用户加入俱乐部后才可能成功
  assert.doesNotMatch(read('pages/activity/baoming/baoming.wxml'),
    /pageState === 'gate'[\s\S]{0,200}bind:retry/, '门卡不得挂重试')
  assert.ok(definition.data.pageState === 'loading', 'pageState 初始值不变')
})

test('三个消费点都必须先判 gate 再谈票种/详情字段', () => {
  for (const file of [
    'pages/topic/components/cy/session-picker/index.js',
    'components/cy/scene-play-activity-detail/index.js',
    'pages/activity/baoming/baoming.js',
  ]) {
    assert.match(read(file), /gate === true/, `${file} 必须识别门卡`)
  }
})
