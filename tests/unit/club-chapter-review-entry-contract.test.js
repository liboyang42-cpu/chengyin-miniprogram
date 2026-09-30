'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const PAGE_PATH = path.join(ROOT, 'pages/club/topic-detail/index.js')
const WXML = fs.readFileSync(path.join(ROOT, 'pages/club/topic-detail/index.wxml'), 'utf8')
const MERCHANTINFO_JS = fs.readFileSync(
  path.join(ROOT, 'pages/topic/merchantinfo/merchantinfo.js'),
  'utf8',
)

function loadPage() {
  let definition
  const navigations = []
  const previous = {
    getApp: global.getApp,
    Page: global.Page,
    wx: global.wx,
    getCurrentPages: global.getCurrentPages,
  }
  global.getApp = () => ({ globalData: {}, sendRequest: () => {}, tips: () => {} })
  global.Page = (config) => { definition = config }
  global.getCurrentPages = () => [{}]
  global.wx = {
    navigateTo: (options) => navigations.push(options.url),
    showToast: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getSystemInfoSync: () => ({}),
  }
  delete require.cache[PAGE_PATH]
  try {
    require(PAGE_PATH)
  } finally {
    global.getApp = previous.getApp
    global.Page = previous.Page
    global.getCurrentPages = previous.getCurrentPages
  }
  const page = Object.assign({}, definition)
  page.data = Object.assign({}, definition.data)
  page.setData = function (patch) { Object.assign(this.data, patch) }
  page.loadProjection = function () {}
  return { page, navigations }
}

function applyAs(canReviewChapterApplications) {
  const mounted = loadPage()
  mounted.page._topicId = 990028
  mounted.page._clubId = 7002
  mounted.page._manageStats = {
    canDirect: false,
    canManageSessions: canReviewChapterApplications,
    canViewVerify: canReviewChapterApplications,
    canReviewChapterApplications,
  }
  mounted.page.applyDetail({
    status: 1,
    isOwner: canReviewChapterApplications ? 1 : 0,
    name: 'E2E 探店日一期',
    activityList: [],
  })
  return mounted
}

test('俱乐部主理人可从“更多”进入现有主办方承接审核，携带 CLUB 作用域', () => {
  const { page, navigations } = applyAs(true)
  assert.equal(page.data.canReviewChapterApplications, true)
  assert.match(WXML,
    /wx:if="\{\{canReviewChapterApplications\}\}"[^>]*bindtap="goChapterApplications"/,
    '承接审核入口必须由服务端专用权限字段控制可见')

  page.goChapterApplications()

  assert.deepEqual(navigations, [
    '/pages/topic/merchantinfo/merchantinfo?topicId=990028&scope=CLUB',
  ])
})

test('普通玩家或非管理者看不到承接审核，也不能用页面方法绕过', () => {
  const { page, navigations } = applyAs(false)
  assert.equal(page.data.canReviewChapterApplications, false)

  page.goChapterApplications()

  assert.deepEqual(navigations, [])
})

test('merchantinfo 保留 CLUB scope，并将它原样传给既有 owner-list/audit 权限链', () => {
  assert.match(MERCHANTINFO_JS,
    /\['MERCHANT', 'CLUB'\]\.includes\(options\.scope\) \? options\.scope : ''/,
    'CLUB scope 不得在 onLoad 被归一为空串或 MERCHANT')
  assert.match(MERCHANTINFO_JS,
    /url: '\/api\/merchant\/chapter-application\/owner-list',[\s\S]{0,280}?scope: that\.data\.operationScope/,
    'owner-list 必须继续复用 operationScope')
  assert.match(MERCHANTINFO_JS,
    /url: '\/api\/merchant\/chapter-application\/audit',[\s\S]{0,360}?scope: that\.data\.operationScope/,
    'audit 必须继续复用 operationScope')
})
