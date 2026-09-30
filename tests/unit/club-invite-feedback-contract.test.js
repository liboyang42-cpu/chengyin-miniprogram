const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const DETAIL = path.join(ROOT, 'pages/club/detail/index.js')
const STATUS_CLASS_BY_CODE = new Map([
  [0, 'pending'],
  [1, 'accepted'],
  [2, 'rejected'],
  [5, 'expired'],
])

function loadDetail() {
  const requests = []
  const navigations = []
  let definition
  const app = {
    globalData: {},
    sendRequest(request) { requests.push(request) },
  }
  const sandbox = {
    getApp: () => app,
    Page(page) { definition = page },
    require(request) {
      const modules = {
        '../../../utils/motion.js': require('../../utils/motion.js'),
        '../../../utils/motion-preference.js': require('../../utils/motion-preference.js'),
        '../../../utils/scene-registry.js': { getScene: () => ({}) },
        '../../../utils/datetime': { toTimestamp: () => 0 },
        '../../../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
        '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
        '../../../utils/group-code-session.js': { buildGroupCodeIssuePayload: () => ({}), listGroupCodeActivities: () => [] },
        '../../../utils/merchant-home-link.js': require('../../utils/merchant-home-link.js'),
        '../../../utils/ticket-source.js': require('../../utils/ticket-source.js'),
        '../../../utils/topic-share.js': require('../../utils/topic-share.js'),
        '../../../utils/response-shape.js': require('../../utils/response-shape.js'),
        // 邀约/合作池整形与 coop/list 共用一份(2026-09-08 抽出);这里给真实现,
        // 因为「可对接的活动」那段就是要保证它按真整形渲染,桩会把问题遮住
        '../../../utils/coop-invite-view.js': require('../../utils/coop-invite-view.js'),
        '../utils/club-event-calendar.js': require('../../pages/club/utils/club-event-calendar.js'),
        // 帖文卡的 variant 判定与广场共用一份,俱乐部页 require 的就是它
        '../../../utils/feed-play-card.js': require('../../utils/feed-play-card.js'),
        // CU-C-60/CU-C-107:俱乐部页新增的三个 require(扫码路由表 / 核销写闸 / 正文摘要),
        // 都是纯模块,沙箱里给真实现。
        '../../../utils/verification-scan.js': require('../../utils/verification-scan.js'),
        '../../../utils/write-action-workflow.js': require('../../utils/write-action-workflow.js'),
        '../../../utils/danger-actions.js': require('../../utils/danger-actions.js'),
      }
      if (modules[request]) return modules[request]
      throw new Error(`unexpected require: ${request}`)
    },
    Set,
    wx: {
      navigateTo(options) { navigations.push(options) },
    },
  }
  vm.runInNewContext(fs.readFileSync(DETAIL, 'utf8'), sandbox, { filename: DETAIL })
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data, {
      clubId: '9',
      club: { id: 9, isOwner: true },
      topicState: 'ready',
    }),
    setData(patch) { Object.assign(this.data, patch) },
  })
  page._topics = [{ id: 901 }, { id: 902 }, { id: 905 }, { id: 906 }]
  return { page, requests, navigations }
}

function assertStatusSemantics(rows) {
  const classes = []
  STATUS_CLASS_BY_CODE.forEach((expectedClass, status) => {
    const row = rows.find((item) => item.status === status)
    assert.ok(row, `status=${status} 的发出邀约必须进入反馈面`)
    assert.equal(row.statusClass, expectedClass, `status=${status} 必须保持独立状态语义`)
    classes.push(row.statusClass)
  })
  assert.equal(new Set(classes).size, STATUS_CLASS_BY_CODE.size, '四个关键状态不得合并渲染')
}

test('俱乐部管理 tab 把发出邀约的关键状态映射为四种独立反馈语义', () => {
  const { page, requests, navigations } = loadDetail()
  page.loadMessages()
  assert.equal(requests.length, 1)
  requests[0].success({
    code: '200',
    data: {
      received: [],
      sent: [0, 1, 2, 5].map((status, index) => ({ id: status + 1, status, topicId: page._topics[index].id })),
    },
  })

  assert.equal(page.data.inviteFeedbackState, 'ready')
  assertStatusSemantics(page.data.sentInvites)

  const view = fs.readFileSync(path.join(ROOT, 'pages/club/detail/index.wxml'), 'utf8')
  const style = fs.readFileSync(path.join(ROOT, 'pages/club/detail/index.wxss'), 'utf8')
  assert.match(view, /wx:elif="\{\{sentInvites\.length\}\}"[\s\S]*?wx:for="\{\{sentInvites\}\}"/)
  assert.match(view, /inviteFeedbackState === 'error'[^>]*bind:retry="reloadInviteFeedback"/)
  assert.match(view, /manage-invite-status--\{\{item\.statusClass\}\}/)
  assert.match(view, /\{\{item\.statusText\}\}/)
  assert.match(style, /\.manage-invite\s*\{[^}]*min-height:\s*88rpx;/)

  page.goCooperation()
  assert.equal(navigations[0].url, '/pages/coop/list/index?tab=sent')
  const coop = fs.readFileSync(path.join(ROOT, 'pages/coop/list/index.js'), 'utf8')
  assert.match(coop, /options\.tab === 'sent'/)
})

test('邀约范围加载失败后的重试同时重拉主题范围与邀约数据', () => {
  const { page, requests } = loadDetail()
  page.data.topicState = 'error'
  page.reloadInviteFeedback()
  assert.deepEqual(requests.map((request) => request.url), ['/api/club/topics', '/api/coop/list'])
  assert.equal(page.data.topicState, 'loading')
  assert.equal(page.data.inviteFeedbackState, 'loading')
})

test('多俱乐部主理人的发出邀约只保留当前俱乐部主题，且等待主题范围后再结束 loading', () => {
  const { page, requests } = loadDetail()
  page.data.topicState = 'loading'
  page._topics = []
  page.loadMessages()
  requests[0].success({
    code: '200',
    data: {
      received: [],
      sent: [
        { id: 1, status: 0, topicId: 901 },
        { id: 2, status: 1, topicId: 1001 },
      ],
    },
  })
  assert.equal(page.data.inviteFeedbackState, 'loading', '主题范围未返回前不得把全账号 sent 当成当前团结果')

  page._topics = [{ id: 901 }]
  page.setData({ topicState: 'ready' })
  page.applySentInviteFilter()
  assert.equal(page.data.inviteFeedbackState, 'ready')
  assert.deepEqual(Array.from(page.data.sentInvites, (item) => item.id), [1])
})

test('负控：把过期态折回待回应语义时状态契约必须判红', () => {
  const rows = Array.from(STATUS_CLASS_BY_CODE, ([status, statusClass]) => ({ status, statusClass }))
  const pending = rows.find((item) => item.status === 0)
  const expired = rows.find((item) => item.status === 5)
  expired.statusClass = pending.statusClass
  assert.throws(() => assertStatusSemantics(rows), assert.AssertionError)
})
