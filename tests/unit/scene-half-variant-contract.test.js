'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const { SCENES } = require(path.join(ROOT, 'utils/scene-registry.js'))

// 记录/明细/列表/说明类 = 半屏(70vh),叉号关闭、无返回语义。
//
// ⚠️ 2026-08-08 落地时缩了范围,两处**故意不在表里**:
//   · roam-history —— `subpackageRoam` 由用户本人维护,已明令「漫游/探索护照做好了,不要再改 UI」。
//     本条契约不去规定别人地盘的形态。用户自己收口时再加回来。
//   · merchant-profit / member-participation-* —— 见文件末尾的「待裁决」说明。
const HALF_SCENE_IDS = [
  'points-tasks',
  'game-coupon-wallet',
  'member-order-history',
  'member-order-detail',
  'settings-likes',
  'settings-how-to-play',
  'settings-how-to-play-detail',
]

function assertHalfSceneContract(scenes) {
  for (const id of HALF_SCENE_IDS) {
    const scene = scenes[id]
    assert.ok(scene, `注册表缺少 ${id}`)
    assert.equal(scene.variant, 'half', `${id} 必须使用 70vh half 场景`)
    assert.equal(Object.hasOwn(scene, 'canBack'), false, `${id} 半屏场景只能用叉号关闭,不得保留 canBack`)
  }
}

test('记录、明细、列表和说明类场景统一使用 half 且无返回语义', () => {
  assertHalfSceneContract(SCENES)
})

// ⏸ 待裁决,本轮不锁:「分润明细 / 我的参与 改成独立页」是**产品形态**决策,不是收敛。
//
// 本分支(fix/scene-half-batch2)的设计是把这三个从弹窗注册表移除、改独立页,并写契约锁死。
// 但 master 现行设计是「它们是场景」,而且已部署已验证:
//   · merchant-profit 来自 #604(分润记录标出收款方)
//   · member-participation-detail 这条链上 #634 刚接了多据点选择
// 两套设计不兼容,谁对是产品问题不是技术问题 ⇒ 本轮只落无争议的半屏部分,这条挂起。
//
// 恢复方式:确认改独立页之后,把下面这段取消注释,并同步删掉注册表里那三条 + 两个页面的 scene 宿主。
// test('分润明细与我的参与走独立页面,不得留在弹窗注册表', () => {
//   for (const id of ['merchant-profit', 'member-participation-history', 'member-participation-detail']) {
//     assert.equal(Object.hasOwn(SCENES, id), false, `${id} 不得继续建模为 scene-sheet`)
//   }
// })

test('negative control: 任一目标场景退回 full 都必须判红', () => {
  for (const id of HALF_SCENE_IDS) {
    const regressed = { ...SCENES, [id]: { ...SCENES[id], variant: 'full' } }
    assert.throws(() => assertHalfSceneContract(regressed), assert.AssertionError, `${id} 回退 full 未被发现`)
  }
})

test('negative control: half 场景重新带 canBack 必须判红', () => {
  const regressed = {
    ...SCENES,
    'member-order-detail': { ...SCENES['member-order-detail'], canBack: true },
  }
  assert.throws(() => assertHalfSceneContract(regressed), assert.AssertionError)
})

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

function assertSharedPlayerCardRecipe(sources) {
  assert.match(sources.sheet, /\.ss--player[^}]*--cy-scene-card-bg:\s*var\(--cy-comp-sheet-player-history-card\)/s)
  assert.match(sources.sheet, /\.ss--player[^}]*--cy-scene-card-radius:\s*var\(--cy-comp-sheet-history-card-radius\)/s)
  assert.match(sources.reference, /\.hs-card[^}]*background:\s*var\(--cy-scene-card-bg,/s)
  assert.match(sources.route, /\.src--player \.src-metric,[\s\S]*?background:\s*var\(--cy-scene-card-bg,/)
  assert.match(sources.route, /\.src--player \.src-favorite-card[^}]*background:\s*var\(--cy-scene-card-bg,/s)
  assert.match(sources.coupon, /\.wallet-card[^}]*background:\s*var\(--cy-scene-card-bg,/s)
  assert.match(sources.orderHistory, /\.orderbox_li[^}]*background:\s*var\(--cy-scene-card-bg,/s)
  assert.match(sources.orderHistory, /\.orderbox_li[^}]*box-shadow:\s*var\(--cy-scene-card-shadow,\s*var\(--cy-shadow-card\)\)/s)
  assert.match(sources.orderDetail, /\.order-card[^}]*--cy-comp-card-bg:\s*var\(--cy-scene-card-bg,/s)
  assert.match(sources.orderDetail, /\.detail[^}]*background:\s*var\(--cy-scene-content-bg,\s*var\(--cy-color-bg-page\)\)/s)
  assert.match(sources.profile, /\.pts-row[^}]*background:\s*var\(--cy-scene-card-bg,/s)
  assert.match(sources.income, /\.id-list[^}]*background:\s*var\(--cy-scene-card-bg/)
  assert.match(sources.invite, /\.ir-card[^}]*background:\s*var\(--cy-scene-card-bg/)
  assert.match(sources.withdraw, /\.txjl[^}]*background:\s*var\(--cy-scene-card-bg/)
}

// ⏸ 待裁决,本轮不锁(理由同上):本条断言的主体已退回 master 版本。
// test('玩家记录/明细卡全部复用漫游历史的同一份半透明卡片代码', () => {
//   const sources = {
//     sheet: read('components/cy/scene-sheet/index.wxss'),
//     reference: read('components/cy/scene-roam-history/index.wxss'),
//     route: read('components/cy/scene-route-content/index.wxss'),
//     coupon: read('components/cy/scene-game-coupon-wallet/index.wxss'),
//     orderHistory: read('components/cy/scene-member-order-history/index.wxss'),
//     orderDetail: read('components/cy/scene-member-order-detail/index.wxss'),
//     profile: read('components/cy/profile/index.wxss'),
//     income: read('components/cy/scene-asset-income-detail/index.wxss'),
//     invite: read('components/cy/scene-member-invite-history/index.wxss'),
//     withdraw: read('components/cy/scene-member-withdraw-history/index.wxss'),
//   }
//   assertSharedPlayerCardRecipe(sources)
//   assert.throws(() => assertSharedPlayerCardRecipe({
//     ...sources,
//     sheet: sources.sheet.replace(
//       'var(--cy-comp-sheet-player-history-card)',
//       'var(--cy-color-bg-elevated)',
//     ),
//   }), assert.AssertionError)
// })

test('half 场景即使位于深链子栈也只能显示叉号，不得被栈长带回返回键', () => {
  const wxml = read('components/cy/scene-deep-link/index.wxml')
  assert.match(wxml, /can-back="\{\{sceneCurrent\.variant !== 'half' && \(sceneCurrent\.canBack \|\| sceneStack\.length > 1\)\}\}"/)
})

// ⏸ 待裁决,本轮不锁(理由同上):本条断言的主体已退回 master 版本。
// test('我的参与独立详情只执行单次导航，返回列表时由 onShow 重拉真实状态', () => {
//   const detail = read('subpackageMember/components/scene-member-participation-detail/index.js')
//   const detailPage = read('subpackageMember/mycanyuinfo/mycanyuinfo.wxml')
//   const listPage = read('subpackageMember/mycanyu/mycanyu.js')
//   assert.match(detail, /_leave\(url\)\s*\{\s*wx\.navigateTo\(\{ url \}\)\s*\}/)
//   assert.doesNotMatch(detail, /_leave\(url\)[\s\S]*?triggerEvent\('close'\)[\s\S]*?wx\.navigateTo/)
//   assert.doesNotMatch(detailPage, /bind:refresh="noop"/)
//   assert.match(listPage, /onShow\(\)\s*\{[\s\S]*?this\.getList\(\);?[\s\S]*?\}/)
// })

function assertMerchantWhiteRecipe(sources) {
  assert.match(sources.sheet, /\.ss--merchant[^}]*--cy-sheet-bg:\s*var\(--cy-comp-sheet-merchant-bg\)/s)
  assert.match(sources.more, /\.rv-more-item[^}]*background:\s*transparent/s)
  assert.match(sources.more, /\.rv-more-item[^}]*border-radius:\s*0/s)
  assert.match(sources.more, /\.rv-more-item \+ \.rv-more-item[^}]*border-top:\s*1rpx solid var\(--cy-color-border-subtle\)/s)
  assert.match(sources.route, /\.src--merchant \.src-list__item[^}]*background:\s*transparent/s)
  assert.match(sources.route, /\.src--merchant \.src-action[^}]*background:\s*transparent/s)
  assert.match(sources.route, /\.src--merchant \.src-metric,[\s\S]*?background:\s*transparent/s)
  assert.match(sources.route, /\.src--merchant \.src-metric,[\s\S]*?border-radius:\s*0/s)
  assert.match(sources.route, /\.src--merchant \.src-form__group[^}]*border-bottom:\s*1rpx solid var\(--cy-color-border-subtle\)/s)
  assert.match(sources.withdraw, /\.txjl-scene--merchant \.txjl[^}]*background:\s*transparent/s)
}

test('商家弹窗复用 Airbnb 白底平行+发丝线代码，不渲染灰色卡片', () => {
  const sources = {
    sheet: read('components/cy/scene-sheet/index.wxss'),
    more: read('pages/merchant/index/index.wxss'),
    route: read('components/cy/scene-route-content/index.wxss'),
    withdraw: read('components/cy/scene-member-withdraw-history/index.wxss'),
  }
  assertMerchantWhiteRecipe(sources)
  assert.throws(() => assertMerchantWhiteRecipe({
    ...sources,
    more: sources.more.replace('background: transparent;', 'background: var(--cy-color-bg-surface-subtle);'),
  }), assert.AssertionError)
})
