// pages/activity/list · 导航标题与次级管理入口契约(2026-07-29 · WT2 增量)
//
// 背景:7-29 全局裁决要求 cy-nav-bar 对宽 action 保持标题严格几何居中,可读槽不足时隐藏标题。
// 本页是全仓唯一同时传 title 与右侧 action 的页面 —— 375pt 下「我发布的」(≈60px)把可用槽
// 压到 15px,标题被整个隐藏,而本页没有内容标题兜底 ⇒ 可发布用户看到一条无标题导航。
//
// 本契约的核心不是"长得对",而是**把本页的 nav 配置真喂给共享组件的算法**,断言算出来
// showTitle === true。这样页面一旦把 action 塞回导航条,守卫立刻判红。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// 共享组件 cy-nav-bar 的纯算法(不复制一份到测试里 —— 复制的那份只会证明它自己)
function loadTitleInsets() {
  const abs = path.join(ROOT, 'components/cy/nav-bar/index.js')
  const prevComponent = global.Component
  const prevGetApp = global.getApp
  const prevWx = global.wx
  let captured = null
  global.Component = (o) => { captured = o }
  global.getApp = () => ({ globalData: {} })
  global.wx = { getWindowInfo: () => ({ windowWidth: 375 }) }
  try {
    delete require.cache[require.resolve(abs)]
    require(abs)
  } finally {
    global.Component = prevComponent
    global.getApp = prevGetApp
    global.wx = prevWx
  }
  assert.ok(captured && captured.methods && captured.methods._titleInsets,
    'cy-nav-bar 必须暴露 _titleInsets 纯算法(契约靠它把页面配置换算成 showTitle)')
  return captured.methods._titleInsets
}

// 从页面 wxml 里解析出 <cy-nav-bar> 这一段,判断它有没有 actions 槽。
// 只认真实结构:自闭合 <cy-nav-bar ... /> 或成对且内部无 slot="actions"。
function navActionWidthOf(wxml) {
  const selfClosing = wxml.match(/<cy-nav-bar\b[^>]*\/>/)
  const paired = wxml.match(/<cy-nav-bar\b[\s\S]*?<\/cy-nav-bar>/)
  assert.ok(selfClosing || paired, '页面必须使用 cy-nav-bar')
  const block = paired ? paired[0] : selfClosing[0]
  if (!/slot="actions"/.test(block)) return 0
  // 有 action 槽:按本页那条「我发布的」文案的实测宽度估(--cy-type-label 4 字 ≈60px)
  return 60
}

const WXML = () => read('pages/activity/list/index.wxml')

function assertNavTitleAlwaysVisible(wxml) {
  const titleInsets = loadTitleInsets()
  const actionWidth = navActionWidthOf(wxml)
  // 375pt(最窄主流机)+ 微信胶囊避让 96px:这是最坏情况,过了它其它尺寸都过
  const r = titleInsets(375, 96, actionWidth)
  assert.equal(r.titleLeft, r.titleRight, '标题左右内距必须相等(几何居中)')
  assert.equal(r.showTitle, true,
    `375pt 下本页 nav 标题被隐藏(action 宽=${actionWidth},可用槽=${375 - r.titleLeft * 2}px)` +
    ' —— 可发布用户会看到一条没有标题的导航条')
}

test('activity/list:两种 canPublish 状态下「官方活动」都保持可见且几何居中', () => {
  assertNavTitleAlwaysVisible(WXML())
})

test('负控:把「我发布的」action 塞回导航条(旧布局)必须判红', () => {
  const wxml = WXML()
  const mutated = wxml.replace(
    '<cy-nav-bar title="官方活动" custom-back bind:back="onNavBack" />',
    '<cy-nav-bar title="官方活动" custom-back bind:back="onNavBack">\n' +
    '    <view slot="actions" class="oe-nav-actions">\n' +
    '      <view wx:if="{{canPublish}}" class="oe-nav-mine" bindtap="goMine">我发布的</view>\n' +
    '    </view>\n  </cy-nav-bar>',
  )
  assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
  // 先自证变异真的被守卫看见(否则下面的 throws 可能是别的原因红的)
  assert.equal(navActionWidthOf(mutated), 60, '变异后必须解析出 action 槽,否则守卫没被触动')
  assert.throws(() => assertNavTitleAlwaysVisible(mutated), assert.AssertionError)
})

// ---- 次级管理入口:不能因为"从导航条搬走"就把功能搬丢 ----

function assertManageEntry(wxml) {
  // 入口仍在,且在内容区(不在 cy-nav-bar 里)
  assert.match(wxml, /class="oe-manage-link"[^>]*bindtap="goMine"/,
    '「我发布的」入口必须仍然存在(它通向 official-mine 管理台:含"我发的通知+触达统计",列表页无法替代)')
  const navBlock = wxml.match(/<cy-nav-bar\b[^>]*\/>/) || wxml.match(/<cy-nav-bar\b[\s\S]*?<\/cy-nav-bar>/)
  assert.doesNotMatch(navBlock[0], /goMine/, '入口不得回到导航条')
  // 可达性不得随 loading/error 收掉 —— 改动前它在导航条上是常驻的
  const row = wxml.match(/<view wx:if="\{\{canPublish \|\| events\.length \|\| \(!loading && !curError\)\}\}" class="oe-summary-row">[\s\S]*?\n    <\/view>/)
  assert.ok(row, '摘要行的显示条件必须放宽到 canPublish,否则加载/错误态下管理入口不可达')
  assert.match(row[0], /wx:if="\{\{canPublish\}\}"[^>]*bindtap="goMine"/,
    '「我发布的」在 canPublish 下必须恒显示,不得再叠加 loading/error 条件')
}

test('activity/list:「我发布的」下沉到内容区后仍随时可达', () => {
  assertManageEntry(WXML())
})

test('负控:把管理入口重新绑上 loading/error 条件(可达性倒退)必须判红', () => {
  const wxml = WXML()
  const mutated = wxml.replace(
    '<view wx:if="{{canPublish || events.length || (!loading && !curError)}}" class="oe-summary-row">',
    '<view wx:if="{{!loading && !curError}}" class="oe-summary-row">',
  )
  assert.notEqual(mutated, wxml, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertManageEntry(mutated), assert.AssertionError)
})

// 命中区必须**横纵各守一条**。只守 min-height 是不够的:四字 caption 的横宽是
// glyph 数碰巧撑出来的,文案一改就悄悄缩水,而且没有任何断言会发现。
function assertManageHitArea(wxss) {
  const rule = wxss.match(/\.oe-manage-link\{[^}]*\}/)
  assert.ok(rule, '找不到 .oe-manage-link 规则')
  ;[['min-height', '纵向'], ['min-width', '横向']].forEach(([prop, axis]) => {
    const m = rule[0].match(new RegExp(prop + ':\\s*(\\d+)rpx'))
    assert.ok(m, `管理入口必须显式给 ${prop}(${axis}命中区不能靠文案长度碰巧撑出来)`)
    assert.ok(Number(m[1]) >= 88, `${axis}命中区必须 ≥88rpx(44pt),实为 ${m[1]}rpx`)
  })
  // border-box:否则 min-width 会与左右内距叠加,量出来的盒子和写的数字对不上
  assert.match(rule[0], /box-sizing:border-box/, '给了内距就必须 border-box,否则尺寸语义漂移')
}

test('activity/list:命中区横纵都 ≥88rpx(44pt),不靠字号糊弄', () => {
  assertManageHitArea(read('pages/activity/list/index.wxss'))
})

test('负控:纵向命中区缩到 44rpx 必须判红', () => {
  const wxss = read('pages/activity/list/index.wxss')
  const mutated = wxss.replace(
    /(\.oe-manage-link\{[^}]*?)min-height:88rpx/,
    '$1min-height:44rpx',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertManageHitArea(mutated), assert.AssertionError)
})

test('负控:横向只靠文案宽度(删掉 min-width)必须判红', () => {
  const wxss = read('pages/activity/list/index.wxss')
  const mutated = wxss.replace(
    /(\.oe-manage-link\{[^}]*?)min-width:88rpx;/,
    '$1',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertManageHitArea(mutated), assert.AssertionError)
})

test('activity/list:页面名不得在 nav 与内容区重复', () => {
  const wxml = WXML()
  const navBlock = wxml.match(/<cy-nav-bar\b[^>]*\/>/) || wxml.match(/<cy-nav-bar\b[\s\S]*?<\/cy-nav-bar>/)
  assert.match(navBlock[0], /title="官方活动"/, 'nav 必须承载页面名')
  // 注释不渲染,先剥掉再判 —— 否则解释"为什么标题只留在 nav"的注释自己会把断言判红
  const body = wxml.replace(navBlock[0], '').replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(body, /城市事件/, '旧产品名不得再出现在内容区')
  assert.doesNotMatch(body, /承接邀约/, '邀约是动作名,不得再写成独立产品「承接邀约」')
  assert.doesNotMatch(body, /<cy-page-title/, '本页不得引入内容区大标题')
})
