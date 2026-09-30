// 走查 2026-09-18:专业编辑器「确认发布」永远点不动。
//
// /api/ai/safety/precheck 的入参(_buildPrecheckReq)只有 title/subtitle/description/nodes,
// 后端 prompt 却要求模型「检查缺封面」并允许输出 type=missing_cover。模型看不到封面,
// 于是**每一次**预检都回 {level:"error", type:"missing_cover"};_showPublishCheck 把 error
// 并进 blocking,弹层里「主题封面已上传」和「缺少封面图」同屏并存,而
// disabled="{{!!publishCheck.blocking.length}}" 让发布按钮永久禁用。
//
// 契约:AI 看不见的字段不归它判 —— missing_cover 整条丢弃,封面有无只由 buildPublishCheck() 说话。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PAGE = '../../pages/publish/fabu/index.js'

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 42,
  sendRequest: () => {},
  chooseImage: () => {},
  chooseDocument: () => {},
  tips: () => {},
  getRequestErrorMessage: (err, fallback) => (err && err.errMsg) || fallback,
})

global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
  showToast: () => {},
  hideLoading: () => {},
  showLoading: () => {},
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }),
  pageScrollTo: () => {},
  nextTick: (cb) => cb(),
}

let pageConfig
global.Page = (config) => { pageConfig = config }

// 线上实测的那份返回:封面已经上传,AI 仍报 error 级缺封面
const REAL_ISSUES = [
  { level: 'error', type: 'missing_cover', message: '缺少主题封面图，发布前需上传封面。' },
  { level: 'warn', type: 'missing_task', message: '其他节点缺少任务描述。' },
  { level: 'info', type: 'suspicious', message: '疑似测试内容。' },
]

function makePage(localBlocking) {
  const page = Object.assign({}, pageConfig)
  page.data = { formData: { name: 'x', imgUrl: 'https://cdn/cover.png' } }
  page.setData = (patch) => { Object.assign(page.data, patch) }
  page.buildPublishCheck = () => ({ blocking: localBlocking.slice(), advisory: [] })
  page._buildPublishSummary = () => []
  page._buildPublishPreview = () => null
  page._buildPublishPassed = (ok) => [{ label: '内容安全预检通过', ok }]
  page.setEditorState = () => {}
  return page
}

beforeEach(() => {
  pageConfig = null
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

test('AI 报的 missing_cover 不得进 blocking(它压根看不到封面)', () => {
  const page = makePage([])
  page._showPublishCheck(REAL_ISSUES, '')
  const blocking = page.data.publishCheck.blocking
  assert.equal(blocking.length, 0, `blocking 被 AI 的假缺封面污染: ${JSON.stringify(blocking)}`)
})

test('本地判定缺封面时仍然阻断 —— 丢弃 AI 那条不能把真缺口也丢掉', () => {
  const page = makePage([{ label: '缺少封面图，发布前需补充主题封面。', tab: '2' }])
  page._showPublishCheck(REAL_ISSUES, '')
  const blocking = page.data.publishCheck.blocking
  assert.equal(blocking.length, 1)
  assert.match(blocking[0].label, /封面/)
})

test('AI 的 warn/info 仍然进 advisory,error 级真问题仍然进 blocking', () => {
  const page = makePage([])
  page._showPublishCheck(REAL_ISSUES.concat([
    { level: 'error', type: 'suspicious', message: '简介含违规内容。' },
  ]), '')
  const pc = page.data.publishCheck
  assert.deepEqual(pc.blocking.map((b) => b.label), ['简介含违规内容。'])
  assert.ok(pc.advisory.some((a) => a.label === '其他节点缺少任务描述。'))
  assert.ok(pc.advisory.some((a) => a.label === '疑似测试内容。'))
  assert.equal(pc.advisory.some((a) => /缺少主题封面图/.test(a.label)), false,
    '丢弃 = 不进任何一栏,不是降级成建议')
})

test('只剩 missing_cover 时算预检通过(否则「内容安全预检通过」永远红)', () => {
  const page = makePage([])
  page._showPublishCheck([REAL_ISSUES[0]], '')
  assert.equal(page.data.publishCheck.passed[0].ok, true)
})
