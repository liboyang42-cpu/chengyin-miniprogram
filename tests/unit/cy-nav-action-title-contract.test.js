// cy-nav-bar 标题槽与右 action 的关系契约。
//
// ⚠️ 极性在 2026-07-29 被翻面两次,现行裁决为准:
//   旧版锁的是 left=actionsRight / right=titleRight 的**非对称**内距 —— 那正是复核阻塞项 1
//   的缺陷本身:右 action 一宽,right 变大而 left 不变,标题几何中心被推向左边。
//   旧版的"负控"甚至专门把对称写法判红,等于把 bug 焊死。
//   新裁决:①几何居中(左右内距恒相等)②不与 action 重叠 —— 两条永不让步;
//   三者冲突时(可用槽宽 < 最小可读宽度)**整个不渲染 nav 标题**,不挤 0 宽也不左偏,
//   语义由页面自己的内容标题承担。
// 原始意图(不被宽 action 遮挡 + 无 action 页零漂移)保留,只换实现判据。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

// 真跑组件里的纯算法,不比对源码字符串
function titleInsets(windowWidth, actionsRight, actionWidth) {
  const abs = path.join(ROOT, 'components/cy/nav-bar/index.js')
  const prevComponent = global.Component
  const prevGetApp = global.getApp
  const prevWx = global.wx
  let captured = null
  global.Component = (options) => { captured = options }
  global.getApp = () => ({ globalData: {} })
  global.wx = { getWindowInfo: () => ({ windowWidth }) }
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally {
    global.Component = prevComponent
    global.getApp = prevGetApp
    global.wx = prevWx
  }
  assert.ok(captured && captured.methods && captured.methods._titleInsets,
    'cy-nav-bar must expose the pure _titleInsets algorithm')
  return captured.methods._titleInsets(windowWidth, actionsRight, actionWidth)
}

function assertActionTitleContract(wxml) {
  // 模板层:左右两个内距变量 + 窄槽降级开关
  assert.match(wxml, /style="left: \{\{titleLeft\}\}px; right: \{\{titleRight\}\}px;"/,
    'title must use the two inset variables produced by _titleInsets')
  assert.match(wxml, /<view wx:if="\{\{showTitle\}\}" class="nav__title"/,
    'title must be dropped entirely when the slot is unreadably narrow')
  assert.doesNotMatch(wxml, /class="nav__title"[^>]*\{\{titleRight \|\| actionsRight\}\}/,
    'the old asymmetric left/right pair must not come back')
}

test('P1 cy-nav title never drifts off-center, and no-action pages stay stable', () => {
  assertActionTitleContract(read('components/cy/nav-bar/index.wxml'))
  // 无 action 页零漂移:基线内距,标题照常显示
  const bare = titleInsets(375, 96, 0)
  assert.equal(bare.titleLeft, bare.titleRight)
  assert.equal(bare.titleLeft, 96)
  assert.equal(bare.showTitle, true)
  // 有 action 时:内距必须把 action 完整让开,且左右仍相等
  const withAction = titleInsets(375, 96, 60)
  assert.equal(withAction.titleLeft, withAction.titleRight, 'insets must stay symmetric')
  assert.ok(withAction.titleLeft >= 96 + 60, 'inset must clear the action entirely')
})

test('negative control (flipped): asymmetric insets are rejected', () => {
  const wxml = read('components/cy/nav-bar/index.wxml')
  const mutated = wxml.replace('style="left: {{titleLeft}}px; right: {{titleRight}}px;"',
    'style="left: {{actionsRight}}px; right: {{titleRight || actionsRight}}px;"')
  assert.notEqual(mutated, wxml, 'mutation anchor is stale')
  assert.throws(() => assertActionTitleContract(mutated), assert.AssertionError)
})

test('negative control: dropping the unreadable-slot fallback is rejected', () => {
  const wxml = read('components/cy/nav-bar/index.wxml')
  const mutated = wxml.replace('<view wx:if="{{showTitle}}" class="nav__title"', '<view class="nav__title"')
  assert.notEqual(mutated, wxml, 'mutation anchor is stale')
  assert.throws(() => assertActionTitleContract(mutated), assert.AssertionError)
})
