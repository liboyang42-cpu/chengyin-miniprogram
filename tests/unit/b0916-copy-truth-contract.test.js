'use strict'

// B 组审计(0916)文案/规则一致性契约:
//   B-04 定价确认 toast 谎报「已确认并开售」—— 后端只推进到 PRICING,SELLING 需运营开售审;
//   B-07 踢人确认弹窗说「需要对方重新接受邀请才能回来」—— KICKED(3) 不在邀请码复活白名单里。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const { getDangerAction } = require('../../utils/danger-actions.js')

let pageConfig
let requests
let toasts
let navigations

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44, menuButtonInfo: {} },
  getUserID: () => 7,
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
})
global.wx = {
  showToast: (options) => { toasts.push(options.title) },
  hideLoading() {},
  showLoading() {},
  navigateTo: (options) => { navigations.push(options.url) },
  navigateBack() {},
  redirectTo: (options) => { navigations.push(options.url) },
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  getWindowInfo: () => ({ statusBarHeight: 44 }),
}
global.Page = (config) => { pageConfig = config }
// 确认成功后页面 setTimeout(goBack, 500):把栈桩好,别让定时器在测试结束后才炸。
global.getCurrentPages = () => [{}]

function loadPricing() {
  pageConfig = null
  requests = []
  toasts = []
  navigations = []
  const absolute = path.join(ROOT, 'pages/topic/pricing/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch, done) { Object.assign(this.data, patch); if (done) done() }
  return page
}

test('B-04:定价确认成功 toast 说「等待开售审核」,不谎报已开售', () => {
  const page = loadPricing()
  Object.assign(page.data, { topicId: 8, canConfirmPrice: true, finalPrice: 45 })
  page.confirmPrice()
  assert.equal(requests[0].url, '/api/topic/pricing/confirm')
  requests[0].success({ code: '200', msg: '终价已确认，请等待开售审核' })

  assert.ok(toasts.includes('终价已确认，请等待开售审核'), '必须采用后端真实口径')
  assert.equal(toasts.includes('已确认并开售'), false, '确认≠开售,不能给发起人假的开卖预期')
})

test('B-04:后端没带 msg 时也用真话兜底,不回退旧谎报', () => {
  const page = loadPricing()
  Object.assign(page.data, { topicId: 8, canConfirmPrice: true, finalPrice: 45 })
  page.confirmPrice()
  requests[0].success({ code: '200' })

  assert.ok(toasts.includes('终价已确认，请等待开售审核'), '缺 msg 必须沿用同一句真话')
  assert.equal(toasts.includes('已确认并开售'), false)
})

test('B-07:踢人文案不再承诺邀请码可复活(KICKED 不在复活白名单)', () => {
  const action = getDangerAction('team.kick', {})
  const all = [action.title, action.content, action.confirmText, action.done.title, action.done.text]
    .concat(action.consequences.map((item) => item.text))
    .filter(Boolean)
    .join('\n')

  assert.doesNotMatch(all, /接受邀请/, '被移出者用邀请码回不来,不能承诺接受邀请即可回归')
  // 6-19:KICKED(3) 连重新申请也被后端永久拒绝(PlayTeamServiceImpl.apply / join 双重拦截),
  // 「重新申请加入」是第二个不存在的路径,同样不许承诺。
  assert.doesNotMatch(all, /重新申请/, '被移出后不能再申请,不能承诺重新申请可回')
  assert.match(all, /(不能|无法)再次申请加入/, '必须与后端一致:被移出后永久不能再申请')
  assert.match(all, /此操作不可撤销/, '不可逆动作文案保留(danger-confirm-gate)')
})
