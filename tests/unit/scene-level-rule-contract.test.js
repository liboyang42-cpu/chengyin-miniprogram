// 层级规则(用户 2026-08-04 定):
//   「我的订单 / 我的会员这种大功能就是正常页面;历史记录 / 核销记录 / 查看状态这种才是弹窗。」
//
// 也就是说:二级大功能(从一级页直接点开、自己内部还有下一层)= 正常页面;
//          三级(从二级点开的记录 / 详情 / 状态 / 单一选择)= 场景弹窗。
//
// 这条规则最容易被悄悄推翻 —— 因为「全部弹窗化」曾经是方案原文的写法。
// 这里把两个方向都钉住:二级不许再被弹窗化,三级不许退回压页面栈。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 一级页:tab 页与工作台。它们打开二级功能必须用页面导航。
const TIER1 = [
  'components/cy/profile/index.js',
  'pages/shezhi/shezhi.js',
  'pages/merchant/index/index.js',
]

// 二级大功能:各自独立成页,不得从一级页以 openScene 打开
const LEVEL2 = [
  'asset-earnings',            // 账户收益
  'member-order-history',      // 我的订单
  'member-participation-history', // 我的参与
  'game-coupon-wallet',        // 优惠券
  'merchant-ledger',           // 经营台账(内部还有 4 个 tab)
  'merchant-decor',            // 店铺装修
  'club-manage', 'club-create', 'club-apply',
  'settings-how-to-play', 'settings-likes', 'settings-profile',
  'merchant-apply',
]

// 三级:记录 / 详情 / 状态,必须是弹窗,由它的父页面托管
const LEVEL3_HOSTED = {
  'member-order-detail': 'subpackageMember/order/order.wxml',
  'asset-income-detail': 'subpackageA/pages/assetcenter/earnings/index.wxml',
  'member-withdraw-history': 'subpackageA/pages/assetcenter/earnings/index.wxml',
  'member-invite-history': 'subpackageA/pages/assetcenter/earnings/index.wxml',
}

test('一级页不得用 openScene 打开二级大功能', () => {
  const bad = []
  for (const host of TIER1) {
    const src = read(host)
    for (const id of LEVEL2) {
      if (src.includes(`openScene('${id}'`)) bad.push(`${host} -> ${id}`)
    }
  }
  assert.deepEqual(bad, [], `二级大功能应各自成页,不该被弹窗化:\n  ${bad.join('\n  ')}`)
})

test('D38 注销是用户指定的弹窗例外，设置页直接托管完整注销 scene', () => {
  assert.match(read('pages/shezhi/shezhi.js'), /openScene\('settings-deregister'\)/)
  assert.match(read('components/cy/scene-route-content/index.wxml'),
    /<cy-scene-settings-deregister[^>]*sceneId === 'settings-deregister'/)
})

test('三级记录/详情由它的父页面托管弹窗,而不是一级 tab 页', () => {
  for (const [id, hostWxml] of Object.entries(LEVEL3_HOSTED)) {
    const src = read(hostWxml)
    assert.match(
      src,
      new RegExp(`sceneCurrent\\.id === '${id}'`),
      `${hostWxml} 应托管三级场景 ${id} —— 关闭后要回到父页面,不是回到 tab 页`
    )
    // 一级 tab 页不该再挂它(否则关闭后会跳回 tab,层级就断了)
    assert.doesNotMatch(
      read('components/cy/profile/index.wxml'),
      new RegExp(`sceneCurrent\\.id === '${id}'`),
      `「我的」不该再托管 ${id}`
    )
  }
})

test('订单预览先进入订单父页,再由父页打开详情场景', () => {
  const member = read('components/cy/profile/index.js')
  const order = read('subpackageMember/order/order.js')
  assert.doesNotMatch(member, /openScene\('member-order-detail'/, '一级「我的」不得直接托管订单详情')
  assert.match(member, /subpackageMember\/order\/order\?detailId=/, '预览卡应把详情 id 交给订单父页')
  assert.match(order, /onLoad\(options\)/)
  assert.match(order, /getScene\('member-order-detail'/)
})

test('二级页面自己就是宿主:订单页 / 收益页都带场景栈', () => {
  for (const p of ['subpackageMember/order/order.js', 'subpackageA/pages/assetcenter/earnings/index.js']) {
    const src = read(p)
    assert.match(src, /sceneCurrent/, `${p} 应持有场景栈以托管自己的三级弹窗`)
    assert.match(src, /getScene\(/, `${p} 应从注册表取场景定义,不自己拼`)
  }
})

test('地图宿主是技术例外:play / roam 的二级内容仍走弹窗', () => {
  // 这两页压新路由会打断 <map>、定位与计时(方案 §0-1),与层级规则无关,是硬约束。
  for (const host of ['pages/play/index.js', 'pages/roam/index.js']) {
    assert.match(read(host), /openScene\('/, `${host} 是地图宿主,必须继续用场景弹窗`)
  }
})

test('club-edit 复用完整编辑组件,不得退化成通用七字段表单', () => {
  const routeJson = JSON.parse(read('components/cy/scene-route-content/index.json'))
  const routeWxml = read('components/cy/scene-route-content/index.wxml')
  const routeJs = read('components/cy/scene-route-content/index.js')
  const clubWxml = read('components/cy/scene-club-edit/index.wxml')
  const clubJs = read('components/cy/scene-club-edit/index.js')

  assert.equal(routeJson.usingComponents['cy-scene-club-edit'], '/components/cy/scene-club-edit/index')
  assert.match(routeWxml, /<cy-scene-club-edit[\s\S]*club-id="\{\{params\.id \|\| params\.clubId\}\}"/)
  assert.doesNotMatch(routeWxml, /formType === 'club-create' \|\| formType === 'club-edit'/)
  assert.doesNotMatch(routeJs, /'club-edit':\s*\{[^\n]*formType:\s*'club-edit'/)
  assert.match(clubWxml, /pickLogo/)
  assert.match(clubWxml, /pickCover/)
  assert.match(clubWxml, /prioritySignupEnabled/)
  // 原来这里用 memberDiscountPrice 当「没退化成通用表单」的标记物,但成员优惠价已于
  // 2026-08-12 全局停用、输入框撤掉。换成同属经营配置、仍然存在的保留名额,
  // 断言的意图(完整编辑组件而非七字段表单)不变。
  assert.match(clubWxml, /memberReservedQuota/)
  assert.match(clubWxml, /memberReservedQuota/)
  assert.match(clubJs, /triggerEvent\('dirtychange',\s*\{\s*dirty:\s*true\s*\}\)/)
  for (const host of [
    'components/cy/scene-deep-link/index.wxml',
    'components/cy/profile/index.wxml',
    'pages/merchant/index/index.wxml',
    'pages/shezhi/shezhi.wxml',
  ]) {
    assert.match(read(host), /<cy-scene-route-content[^>]*bind:back="backScene"/, `${host} 必须转发完整编辑组件的返回事件`)
  }
  const clubHost = read('pages/club/detail/index.wxml')
  assert.match(clubHost, /dirty="\{\{sceneDirty\}\}"/)
  assert.match(clubHost, /bind:dirtychange="onSceneDirtyChange"/)
  assert.match(clubHost, /<cy-modal[^>]*bind:confirm="confirmSceneDiscard"/)
})

test('scene-sheet 是唯一纵向滚动区,club-edit 深链也保留脏表单确认闸', () => {
  const verticalSceneComponents = [
    'components/cy/scene-club-edit/index.wxml',
    'components/cy/scene-game-coupon-wallet/index.wxml',
    'components/cy/scene-roam-history/index.wxml',
    'components/cy/scene-roam-discover/index.wxml',
    'components/cy/scene-roam-task-list/index.wxml',
  ]
  for (const component of verticalSceneComponents) {
    assert.doesNotMatch(read(component), /<scroll-view[^>]*\bscroll-y\b/, `${component} 不得在 scene-sheet 正文内再造纵向滚动区`)
  }

  const clubWxssPath = path.join(ROOT, 'components/cy/scene-club-edit/index.wxss')
  const clubWxss = fs.readFileSync(clubWxssPath, 'utf8')
  const imported = clubWxss.match(/@import\s+"([^"]+)"/)
  assert.ok(imported, 'club-edit 必须导入完整表单样式')
  assert.ok(fs.existsSync(path.resolve(path.dirname(clubWxssPath), imported[1])), 'club-edit 的 WXSS import 必须真实存在')

  const deepLinkWxml = read('pages/club/edit/index.wxml')
  const deepLinkJs = read('pages/club/edit/index.js')
  assert.match(deepLinkWxml, /bind:dirtychange="onDirtyChange"/)
  assert.match(deepLinkWxml, /<cy-modal[^>]*bind:confirm="confirmBack"/)
  assert.match(deepLinkJs, /requestBack\(\)[\s\S]*this\.data\.dirty/)
})
