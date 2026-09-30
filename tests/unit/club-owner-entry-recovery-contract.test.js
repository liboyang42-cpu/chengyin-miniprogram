// E-05(2026-09-16 整体检查 E 组):`/pages/club/detail/index?owner=1` 的两条死路。
//
// 病:① 解析失败后点「重新加载」→ onRetry 里 loadAll 因 clubId 为空直接 return ⇒ 永久骨架;
//     ② /api/club/my 返回业务错误(5xx)时被当成 owned=[] ⇒ 弹「你还没有俱乐部」并 0.9s 后强制退出。
// 治:onRetry 在 clubId 为空时重走 resolveOwnerEntry;非 200/缺 data 分流为可重试的错误态。
// 负控:把任一条改回去,本文件必须判红。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js')

const ROOT = path.resolve(__dirname, '../..')
const DETAIL_JS = 'pages/club/detail/index.js'
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function loadDetail() {
  let definition
  const navigations = []
  const requests = []
  const toasts = []
  const scheduled = []
  const app = {
    globalData: {},
    sendRequest(request) { requests.push(request) },
    getUserRole: () => 'member',
    getUserID: () => 1001,
    getAvatar: () => '',
    getNickname: () => '',
    tips(message) { toasts.push(message) },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  }
  vm.runInNewContext(read(DETAIL_JS), {
    getApp: () => app,
    Page(page) { definition = page },
    require(request) {
      const modules = {
        '../../../utils/motion.js': require('../../utils/motion.js'),
        '../../../utils/motion-preference.js': require('../../utils/motion-preference.js'),
        '../../../utils/scene-registry.js': { getScene: () => ({}) },
        '../../../utils/datetime': { toTimestamp: (value) => Date.parse(String(value).replace(' ', 'T')) || 0 },
        '../../../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
        '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
        '../../../utils/group-code-session.js': { buildGroupCodeIssuePayload: () => ({}), listGroupCodeActivities: () => [] },
        '../../../utils/merchant-home-link.js': require('../../utils/merchant-home-link.js'),
        '../../../utils/ticket-source.js': require('../../utils/ticket-source.js'),
        '../../../utils/topic-share.js': require('../../utils/topic-share.js'),
        '../../../utils/response-shape.js': require('../../utils/response-shape.js'),
        '../../../utils/coop-invite-view.js': require('../../utils/coop-invite-view.js'),
        '../utils/club-event-calendar.js': require('../../pages/club/utils/club-event-calendar.js'),
        '../../../utils/feed-play-card.js': require('../../utils/feed-play-card.js'),
        // CU-C-60/CU-C-107:俱乐部页新增的三个 require(扫码路由表 / 核销写闸 / 正文摘要),
        // 都是纯模块,沙箱里给真实现。
        '../../../utils/verification-scan.js': require('../../utils/verification-scan.js'),
        '../../../utils/write-action-workflow.js': require('../../utils/write-action-workflow.js'),
        '../../../utils/danger-actions.js': require('../../utils/danger-actions.js'),
      }
      if (modules[request]) return modules[request]
      throw new Error('unexpected require: ' + request)
    },
    setTimeout(fn) { scheduled.push(fn); return 1 },
    clearTimeout() {},
    Set,
    Date,
    JSON,
    wx: {
      navigateTo(options) { navigations.push(options.url) },
      navigateBack() { navigations.push('__back__') },
      switchTab(options) { navigations.push(options.url) },
      pageScrollTo() {},
      showToast(options) { toasts.push((options && options.title) || '') },
      showModal() {},
      showShareMenu() {},
      setStorageSync() {},
      getStorageSync: () => '',
      stopPullDownRefresh() {},
    },
  }, { filename: DETAIL_JS })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback.call(this) },
  })
  return { page, navigations, requests, toasts, scheduled }
}

test('owner 入口业务失败 = 可重试错误态,不弹「没有俱乐部」也不踢人;重试重发 /api/club/my', () => {
  const { page, requests, navigations, scheduled } = loadDetail()
  page.onLoad({ owner: '1' })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/club/my')

  // 负控锚点:5xx 走业务错误分支
  requests[0].success({ code: 500, msg: '服务开小差了' })
  assert.equal(page.data.detailLoaded, true)
  assert.equal(page.data.notFound, true, '业务失败必须落回可重试的错误态')
  assert.equal(page.data.clubId, null)
  assert.deepEqual(navigations, [], '业务失败不许自动退出')
  assert.deepEqual(scheduled, [], '业务失败不许挂 0.9s 强制退出')

  // 点「重新加载」:必须重发 /api/club/my,而不是对着空 clubId 空转(永久骨架)
  const before = requests.length
  page.onRetry()
  const again = requests.slice(before).filter((r) => r.url === '/api/club/my')
  assert.equal(again.length, 1, 'clubId 为空时 onRetry 必须重走 owner 解析')

  again[0].success({ code: 200, data: { owned: [{ id: 7, name: '夜行团' }] } })
  assert.equal(page.data.clubId, 7)
  assert.ok(requests.some((r) => r.url === '/api/club/detail'), '解析出 clubId 后要继续拉详情')
})

test('200 且 owned 为空才是「你还没有俱乐部」:提示后退出', () => {
  const { page, requests, navigations, toasts, scheduled } = loadDetail()
  page.onLoad({ owner: '1' })
  requests[0].success({ code: 200, data: { owned: [] } })
  assert.ok(toasts.includes('你还没有俱乐部'))
  assert.equal(scheduled.length, 1, '只有真空态才安排退出')
  scheduled[0]()
  assert.ok(navigations.includes('__back__'))
})
