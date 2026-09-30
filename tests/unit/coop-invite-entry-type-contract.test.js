/* 5-06(R9-09 残留):协作邀请空态「去发起邀请」按当前身份给对的 type。
 *
 * 病:goInvite 写死 `/pages/coop/invite/index?type=1` —— type=1 是「商家→俱乐部」,
 *     后端要求商家 COOP_MANAGE(ApiCoopController.invite 的 type==1 分支)。主理人点进去
 *     再提交必被拒;主理人该走 type=0(主题发布者邀商家,与页面其余 type=0 入口同义)。
 * 治:宿主页用身份策略(role/userType)判当前是不是俱乐部侧,是则 type=0,否则保持 type=1。
 * 负控:把 type 写回 1、或把身份判据删掉,主理人那条用例必红。
 * 身份真源与 pages/coop/invite/index.js 一致:utils/identity/identity-policy.js(不读 Storage)。
 */
'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const PAGE = path.resolve(__dirname, '../../pages/coop/list/index.js')

function loadGoInvite(identity) {
  const navigations = []
  let config = null
  const previous = { getApp: global.getApp, Page: global.Page, wx: global.wx }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserRole: () => identity.role,
    getUserType: () => identity.userType,
    sendRequest() {},
    tips() {},
    getAuthorization: () => 'token',
    getUserID: () => 1,
  })
  global.Page = (c) => { config = c }
  global.wx = {
    showToast() {}, navigateTo() {}, switchTab() {}, reLaunch() {},
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getSystemInfoSync: () => ({}), getWindowInfo: () => ({ windowWidth: 390 }),
    stopPullDownRefresh() {},
  }
  delete require.cache[PAGE]
  try { require(PAGE) } finally {
    global.getApp = previous.getApp
    global.Page = previous.Page
    global.wx = previous.wx
  }
  assert.ok(config, 'coop/list 页面没注册')
  return () => {
    config.goInvite.call({ _navigateTo: (url) => navigations.push(url) })
    assert.equal(navigations.length, 1)
    return navigations[0]
  }
}

test('主理人(俱乐部侧)空态去发起邀请走 type=0,不是写死的 type=1', () => {
  const url = loadGoInvite({ role: 'club', userType: 1 })()
  assert.match(url, /^\/pages\/coop\/invite\/index\?type=0$/)
})

test('商家空态去发起邀请仍走 type=1', () => {
  assert.match(loadGoInvite({ role: 'merchant', userType: 1 })(), /type=1$/)
  // 过渡期 role 未回填:userType==2 兜底也是商家
  assert.match(loadGoInvite({ role: '', userType: 2 })(), /type=1$/)
})

test('玩家默认仍是 type=1(本页不是玩家域,保持原行为)', () => {
  assert.match(loadGoInvite({ role: 'player', userType: 1 })(), /type=1$/)
})
