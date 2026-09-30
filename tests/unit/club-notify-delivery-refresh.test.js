'use strict'

/* CU-C-135(2026-09-25 走查):俱乐部群发投递卡只写「总 4 / 已送达 0 / 失败 0」,
   没有「待投递」,处理中只在 send 那一刻的 toast 里活三秒,页面再也不会回读任务结果。
   这三条钉的是:卡面必须有「还剩多少没投出去」和处理中字样;刷新走只读回读接口;
   刷新失败不能把已经显示过的数字抹成 0。 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')

let pageConfig
let requests
let toasts

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44 },
  sendRequest: (request) => { requests.push(request) },
})

global.wx = {
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  showToast: (options) => { toasts.push(options && options.title) },
  stopPullDownRefresh() {},
  navigateBack() {},
  switchTab() {},
  previewImage() {},
}

global.getCurrentPages = () => []
global.Page = (config) => { pageConfig = config }

function loadPage() {
  pageConfig = null
  requests = []
  toasts = []
  const absolute = path.join(ROOT, 'pages/club/notify/index.js')
  delete require.cache[require.resolve(absolute)]
  require(absolute)
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch) { Object.assign(this.data, patch) }
  page.onLoad({ clubId: 21, activityId: 31 })
  respond(requests.shift(), accessPayload())                        // /api/club/access/me
  respond(requests.shift(), { counts: { REGISTERED: 4 } })           // audience-counts
  return page
}

function accessPayload() {
  return { active: true, club: { id: 21 }, permissions: ['club:event:operate', 'club:notify:send'] }
}

function respond(request, payload) {
  request.success({ code: 200, data: payload })
  if (request.complete) request.complete()
}

function campaign(status, total, success, failed) {
  return { id: 61, clubId: 21, activityId: 31, status, totalCount: total, successCount: success, failedCount: failed }
}

function sendReady(page) {
  page.onTitleInput({ detail: { value: '周六集合提醒' } })
  page.onContentInput({ detail: { value: '请提前十分钟到场' } })
  page.preview()
  respond(requests.shift(), {
    recipientCount: 4, inApp: 'AVAILABLE', wechatSubscription: 'UNAVAILABLE', phoneIncluded: false,
  })
  page.send()
}

test('处理中的投递卡补出「待投递」与处理中字样,不是光秃秃三个数', () => {
  const page = loadPage()
  sendReady(page)
  respond(requests.shift(), campaign('PROCESSING', 4, 0, 0))

  assert.equal(page.data.campaign.pendingCount, 4, '4 个人一条没投出去,待投递必须是 4')
  assert.equal(page.data.campaign.processing, true)
  assert.equal(page.data.campaign.statusText, '投递中')

  const wxml = read('pages/club/notify/index.wxml')
  assert.match(wxml, /待投递/, '卡面必须真有这一行,不能只存在于 js 的字段里')
  assert.match(wxml, /\{\{campaign\.pendingCount \|\| 0\}\}/, '没有这个数也要显示 0,不空着')
  assert.match(wxml, /\{\{campaign\.statusText\}\}/)
})

test('刷新走只读回读接口,读回推进后的计数', () => {
  const page = loadPage()
  sendReady(page)
  respond(requests.shift(), campaign('PROCESSING', 4, 0, 0))

  page.refreshCampaign()
  const request = requests.shift()
  assert.equal(request.url, '/api/club/event-notification/status')
  assert.equal(JSON.parse(request.data).campaignId, 61)
  request.success({ code: 200, data: campaign('PROCESSING', 4, 3, 0) })
  if (request.complete) request.complete()

  assert.equal(page.data.campaign.successCount, 3)
  assert.equal(page.data.campaign.pendingCount, 1, '投出去 3 条,待投递要跟着降到 1')
  assert.equal(page.data.refreshing, false, '刷新态必须落地,否则「刷新中…」永远不收回')
})

test('刷新失败保留上一次读到的数字,不抹成 0', () => {
  const page = loadPage()
  sendReady(page)
  respond(requests.shift(), campaign('PROCESSING', 4, 3, 0))
  toasts = []

  page.refreshCampaign()
  const request = requests.shift()
  request.fail(new Error('offline'))
  if (request.complete) request.complete()

  assert.equal(page.data.campaign.successCount, 3, '一次网络失败不能把已送达 3 说成 0')
  assert.equal(page.data.campaign.pendingCount, 1)
  assert.equal(toasts.length, 1, '手动刷新要点反馈')
})

test('后台回页面静默回读;没有任务时不白发请求', () => {
  const quiet = loadPage()
  quiet.onShow()
  assert.equal(requests.length, 0, '这一页还没发过通知,不该去读一个不存在的任务')

  const page = loadPage()
  sendReady(page)
  respond(requests.shift(), campaign('COMPLETED', 4, 4, 0))
  toasts = []

  page.onShow()
  const request = requests.shift()
  assert.ok(request, '有任务就要回读,否则后台投完页面永远不知道')
  assert.equal(request.url, '/api/club/event-notification/status')
  request.success({ code: 200, data: campaign('COMPLETED', 4, 4, 0) })
  if (request.complete) request.complete()
  assert.equal(toasts.length, 0, '自动回读成功不该弹提示,那是噪音')
  assert.equal(page.data.campaign.pendingCount, 0)
  assert.equal(page.data.campaign.statusText, '已投递完成')
})

test('回读只认带 id 的回包,任务号丢了就当场停手', () => {
  const page = loadPage()
  sendReady(page)
  respond(requests.shift(), campaign('PROCESSING', 4, 0, 0))
  page.setData({ campaign: null })

  page.refreshCampaign()
  assert.equal(requests.length, 0, '没有 campaignId 就不该发请求')
})
