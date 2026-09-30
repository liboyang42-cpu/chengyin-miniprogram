/* CU-M-130 · 模板详情「能力」标签与内容对不上(2026-09-24 走查 R50)
 *
 * 隔离模板的「能力」页只有「来源：城市运动装备馆」+ 一句和主按钮重复的说明 ——
 * 来源就是头部的发布者署名,场景在详情栏已经铺成 chips,能力 tab 里独有的只有「方式」。
 * 三者只剩署名时不给这个 tab(而不是继续摆一个点进去没内容的标签)。
 *
 * 判据写在页面里(patchNormalized / applyDetailPayload 都算好的 capRows),测试用 vm 装真页面跑,
 * 不复制一份判据到测试里。
 */
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js')

const ROOT = path.resolve(__dirname, '../..')
const SOURCE = fs.readFileSync(path.join(ROOT, 'pages/templatedetail/templatedetail.js'), 'utf8')

function loadPage() {
  let definition = null
  vm.runInNewContext(SOURCE, {
    console,
    getApp: () => ({
      globalData: { statusBarHeight: 20, navBarHeight: 44 },
      getUserRole: () => 'player',
      getUserType: () => '2',
      getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
      sendRequest() {},
    }),
    Page(value) { definition = value },
    require(request) {
      if (request === './utils/scroll-motion.js') return { applyHeroRecede: () => false }
      if (request === './utils/templateDetail.js') return require(path.join(ROOT, 'pages/templatedetail/utils/templateDetail.js'))
      if (request === '../../utils/mockData.js') return { getTemplateById: () => null }
      if (request === '../../utils/analytics.js') return { track() {} }
      if (request === '../../utils/identity/identity-policy.js') return require(path.join(ROOT, 'utils/identity/identity-policy.js'))
      if (request === '../../utils/merchant-theme.js') return { merchantPageShow() {}, merchantPageRestore() {} }
      if (request === '../../utils/response-shape.js') return require(path.join(ROOT, 'utils/response-shape.js'))
      throw new Error(`unexpected require: ${request}`)
    },
    wx: {
      getStorageSync: () => '',
      setStorageSync() {},
      navigateTo() {}, switchTab() {}, navigateBack() {}, redirectTo() {},
      getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
      createAnimation: () => ({}),
      nextTick: (cb) => cb(),
    },
  })
  assert.ok(definition, 'templatedetail 页面没有注册 Page()')
  return { page: definition }
}

/** patchNormalized 是 dev mock 与 onLoad 共用的那条装配路。 */
function normalizedTarget(raw, startTab) {
  const { page } = loadPage()
  const target = { scope: 'library' }
  if (startTab) target.activeTab = startTab
  page.patchNormalized.call(page, target, raw)
  return target
}

function tabsOf(source) {
  return Array.from((source && source.tplTabs) || [], (tab) => tab.key)
}

const WITH_WAY = { id: 7, title: '站起来回答', validationMethodStr: '选项验证', publisher: '城市运动装备馆' }
const ONLY_SOURCE = { id: 8, title: '口令换券', publisher: '城市运动装备馆' }

test('CU-M-130 有能力字段的模板照常给「能力」tab', () => {
  const target = normalizedTarget(WITH_WAY)
  assert.deepEqual(tabsOf(target), ['details', 'capabilities'])
  assert.deepEqual(Array.from(target.capRows, (row) => row.key), ['way', 'from'])
})

test('CU-M-130 只剩署名的模板不给「能力」tab,深链也要退回详情', () => {
  const target = normalizedTarget(ONLY_SOURCE, 'capabilities')
  assert.deepEqual(tabsOf(target), ['details'], '没有「方式」就没有能力可看,不该留着这个 tab')
  assert.equal(target.activeTab, 'details', '?tab=capabilities 深链进来不能停在一个不存在的 tab 上')
})

test('CU-M-130 真接口那条路(applyDetailPayload)同样收 tab', () => {
  const { page } = loadPage()
  let patch = null
  page.setData = (value) => { patch = value }
  page.data = { scope: 'library', activeTab: 'capabilities' }
  page.applyDetailPayload.call(page, ONLY_SOURCE)
  assert.deepEqual(tabsOf(patch), ['details'])
  assert.equal(patch.activeTab, 'details')
  page.applyDetailPayload.call(page, WITH_WAY)
  assert.deepEqual(tabsOf(patch), ['details', 'capabilities'])
  assert.equal(patch.activeTab, 'capabilities', '有能力可看时,深链停留的位置不该被改掉')
})

test('CU-M-130 场景与来源不算能力:两者都出现在别处,不能撑住这个 tab', () => {
  const target = normalizedTarget({
    id: 9, title: '只在店里玩', publisher: '某店', usageLocation: '门店',
    sysCategoryList: [{ categoryName: '城市探索' }],
  })
  assert.deepEqual(Array.from(target.capRows, (row) => row.key), ['scene', 'from'])
  assert.deepEqual(tabsOf(target), ['details'])
})

test('CU-M-130 负控:把判据换成「有行就给 tab」,上一条必须判红', () => {
  const mutated = SOURCE.replace(
    "return (capRows || []).some(function (row) { return row && row.key === 'way'; });",
    'return (capRows || []).length > 0;',
  )
  assert.notEqual(mutated, SOURCE, '负控未命中 hasCapabilityInfo 的判据')
  let definition = null
  vm.runInNewContext(mutated, {
    console,
    getApp: () => ({ globalData: {}, getUserRole: () => 'player', getUserType: () => '2', sendRequest() {} }),
    Page(value) { definition = value },
    require(request) {
      if (request === './utils/scroll-motion.js') return { applyHeroRecede: () => false }
      if (request === './utils/templateDetail.js') return require(path.join(ROOT, 'pages/templatedetail/utils/templateDetail.js'))
      if (request === '../../utils/mockData.js') return { getTemplateById: () => null }
      if (request === '../../utils/analytics.js') return { track() {} }
      if (request === '../../utils/identity/identity-policy.js') return require(path.join(ROOT, 'utils/identity/identity-policy.js'))
      if (request === '../../utils/merchant-theme.js') return { merchantPageShow() {}, merchantPageRestore() {} }
      if (request === '../../utils/response-shape.js') return require(path.join(ROOT, 'utils/response-shape.js'))
      throw new Error(`unexpected require: ${request}`)
    },
    wx: { getStorageSync: () => '', setStorageSync() {}, getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }) },
  })
  const target = { scope: 'library', activeTab: 'capabilities' }
  definition.patchNormalized.call(definition, target, JSON.parse(JSON.stringify(ONLY_SOURCE)))
  assert.throws(
    () => assert.deepEqual(Array.from(target.tplTabs, (tab) => tab.key), ['details']),
    /deepStrictEqual|Expected values|values/,
    '按「有没有行」判据,只剩来源时也会留着能力 tab = 上一条合同是假的',
  )
})

test('RUN-024 分类名称含中点也保持一个标签，不能伪装商家类型', () => {
  const target = normalizedTarget({ id: 9, title: '分类测试', sysCategoryList: [{ categoryName: 'CU走查·解谜互动' }] })
  assert.deepEqual(Array.from(target.sceneChips), ['CU走查·解谜互动'])
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/templatedetail/templatedetail.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /推荐商家类型/)
})
