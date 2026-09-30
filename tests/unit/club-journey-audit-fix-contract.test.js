'use strict'

// 俱乐部旅程审计修码契约(2026-08-31)
// 场次选择被原生 ActionSheet 截断、解散阻断清单被 scene-sheet 裁掉、开一场只认合作单。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')
const DETAIL_JS = 'pages/club/detail/index.js'
const DETAIL_WXML = 'pages/club/detail/index.wxml'
const EDIT_WXML = 'components/cy/scene-club-edit/index.wxml'
const EVENT_OPS_JS = 'pages/club/event-ops/index.js'
const EVENT_OPS_WXML = 'pages/club/event-ops/index.wxml'
const SESSION_JAVA = path.resolve(ROOT, '../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/ClubSessionServiceImpl.java')

const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function sevenActivities() {
  return [
    { id: 701, name: '周一晚' }, { id: 702, name: '周二晚' }, { id: 703, name: '周三晚' },
    { id: 704, name: '周四晚' }, { id: 705, name: '周五晚' }, { id: 706, name: '周六午' },
    { id: 707, name: '周日午·名字偏长会被原生菜单直接失败' },
  ]
}

function loadClubDetail(activityList) {
  let definition
  const navigations = []
  const requests = []
  const actionSheets = []
  vm.runInNewContext(read(DETAIL_JS), {
    getApp: () => ({
      globalData: {},
      sendRequest(options) {
        requests.push(options)
        options.success({ code: 200, data: { activityList: activityList || [] } })
      },
    }),
    Page(config) { definition = config },
    require(request) {
      const modules = {
        '../../../utils/motion.js': { haptic() {} },
        // 邀约/合作池整形与 coop/list 共用一份(2026-09-08 抽出);这里给真实现,
        // 因为「可对接的活动」那段就是要保证它按真整形渲染,桩会把问题遮住
        '../../../utils/coop-invite-view.js': require('../../utils/coop-invite-view.js'),
        '../../../utils/motion-preference.js': { readReducedMotion: () => false },
        '../../../utils/scene-registry.js': { getScene: () => ({}) },
        '../../../utils/datetime': { toTimestamp: () => 0 },
        '../../../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
        '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
        '../../../utils/group-code-session.js': require('../../utils/group-code-session.js'),
        '../../../utils/merchant-home-link.js': require('../../utils/merchant-home-link.js'),
        '../../../utils/ticket-source.js': require('../../utils/ticket-source.js'),
        '../../../utils/topic-share.js': require('../../utils/topic-share.js'),
        '../../../utils/response-shape.js': { isRecordList: Array.isArray, isRecord: (v) => !!v && typeof v === 'object' && !Array.isArray(v) },
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
    Date,
    JSON,
    Set,
    wx: {
      navigateTo({ url }) { navigations.push(url) },
      showToast() {},
      showModal() {},
      showActionSheet(options) { actionSheets.push(options) },
      getStorageSync() { return {} },
      setStorageSync() {},
      removeStorageSync() {},
    },
  }, { filename: DETAIL_JS })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return { page, navigations, requests, actionSheets }
}

// ⚠️ 判代码,不判散文:注释里写「不走 wx.showActionSheet」是在解释为什么不用它,
//    却会被裸文本扫描判成违规(2026-09-03 实测,榜单排序那处的说明注释就撞了)。
//    钉字面量的门禁会逼人把理由从注释里删掉 —— 那是把文档换成了绿灯。
const stripJsComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')

test('俱乐部详情场次与工具选择不得走 wx.showActionSheet', () => {
  const js = stripJsComments(read(DETAIL_JS))
  const wxml = read(DETAIL_WXML)
  assert.doesNotMatch(js, /wx\.showActionSheet/,
    '一周七场或场次名偏长时原生菜单直接 fail，点击无反馈；导演台已改 cy-sheet')
  // 负控:剥注释不能把判据剥成瞎子 —— 真调用必须照样被抓出来
  assert.match(stripJsComments('foo() { wx.showActionSheet({ itemList: [] }) }'), /wx\.showActionSheet/,
    '剥注释后连真调用都不见了,这道门禁成了摆设')
  assert.doesNotMatch(stripJsComments('// 不走 wx.showActionSheet,理由见上'), /wx\.showActionSheet/,
    '注释里的提及仍被判违规,门禁会逼人删掉解释')
  assert.match(wxml, /choiceSheetShow/,
    '超过 6 项必须用半屏清单，不能再依赖系统 ActionSheet 的 6 项上限')
  assert.match(wxml, /bindtap="onChoiceSheetSelect"/)
})

test('一周七场时管理工具弹出 cy-sheet，点选后进入该场名册', () => {
  const harness = loadClubDetail(sevenActivities())
  harness.page.data.club = { id: 9, isOwner: true }
  harness.page.data.clubId = 9
  harness.page.openActivityTools({ currentTarget: { dataset: { id: 88 } } })

  assert.equal(harness.actionSheets.length, 0, '不得回退原生 ActionSheet')
  assert.equal(harness.page.data.choiceSheetShow, true)
  assert.equal(harness.page.data.choiceSheetItems.length, 7)

  harness.page.onChoiceSheetSelect({ currentTarget: { dataset: { key: '707' } } })
  assert.equal(harness.page.data.choiceSheetShow, true,
    '选场次后应再给出本场工具，不能静默消失')
  harness.page.onChoiceSheetSelect({
    currentTarget: { dataset: { key: '/pages/club/event-ops/index?clubId=9&activityId=707' } },
  })
  assert.deepEqual(harness.navigations, ['/pages/club/event-ops/index?clubId=9&activityId=707'])
})

test('举报多场次同样走 cy-sheet，不能被 6 项截断', () => {
  const harness = loadClubDetail(sevenActivities())
  harness.page.data.club = { id: 9, isOwner: true }
  harness.page.data.clubId = 9
  harness.page.data.canSeeMembers = true
  harness.page.reportTopicActivity({ currentTarget: { dataset: { id: 88 } } })
  assert.equal(harness.actionSheets.length, 0)
  assert.equal(harness.page.data.choiceSheetItems.length, 7)
  harness.page.onChoiceSheetSelect({ currentTarget: { dataset: { key: '702' } } })
  assert.deepEqual(harness.navigations, [
    // CU-C-82:举报页要把对象写上屏,入口把场次显示名一并带过去
    '/pages/club/governance/index?clubId=9&mode=report&targetType=ACTIVITY&targetId=702&targetName=%E5%91%A8%E4%BA%8C%E6%99%9A',
  ])
})

test('解散阻断清单必须经 root-portal 挂到页面根，避免被 scene-sheet 的 transform 裁掉', () => {
  const wxml = read(EDIT_WXML)
  assert.match(wxml, /<root-portal[\s\S]*showDissolutionBlockers[\s\S]*<\/root-portal>/,
    'scene-club-edit 嵌在带 transform 的 scene-sheet 里，内层 cy-sheet 的 fixed 会变成包含块被 overflow 裁掉')
})

test('开一场候选必须包含俱乐部自己发的主题，不能只认合作单', () => {
  const java = fs.readFileSync(SESSION_JAVA, 'utf8')
  assert.match(java, /selectPublicCmsTopicList/,
    '发布主题走 fabu?clubId= 只写 cms_topic.club_id；只查 coop_order 会让主理人开场看到空列表')
  assert.match(java, /getClubId\(\)\.equals\(request\.getClubId\(\)\)|clubId\.equals\(topic\.getClubId\(\)\)/,
    '真正开场也必须放行本俱乐部发布的主题，否则列表有了提交仍报没有合作单')

  const opsJs = read(EVENT_OPS_JS)
  const opsWxml = read(EVENT_OPS_WXML)
  assert.doesNotMatch(opsJs, /暂无可开场的合作主题/,
    '空列表文案不能把俱乐部自有主题说成必须先合作')
  assert.doesNotMatch(opsWxml, /暂无生效合作主题/)
  assert.match(opsWxml, /暂无可开场的主题|还没有可开场的主题/)
})
