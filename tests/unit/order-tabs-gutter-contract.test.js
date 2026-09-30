// H09:订单列表内容与逻辑已搬到 components/cy/scene-member-order-history(页面退化成深链薄壳),
// 断言随之指向组件文件;判据本身一条没放宽。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8')

// R4-C04:四列手写 order-filter 网格未获 §5.3 授权,已按 github/master 原形恢复为共享 cy-tabs,
// 断言随之回到 master 的 chip 口径。
test('order chips have a page-gutter wrapper so the final state is not flush to the viewport edge', () => {
  const wxml = read('components/cy/scene-member-order-history/index.wxml')
  const wxss = read('components/cy/scene-member-order-history/index.wxss')
  assert.match(wxml, /<view class="order-tabs-wrap"[^>]*>\s*<cy-tabs\b[\s\S]*<\/view>/)
  // 搬进 scene-sheet 后左右边距由正文的 --cy-comp-sheet-body-pad-x(16px)提供,
  // 与 --cy-page-x(32rpx=16px)同值 —— 组件再补一次就是双份缩进,正是本文件另两条断言在防的事。
  // 所以这里从「必须自带 --cy-page-x」翻成「不得再补 --cy-page-x」,意图(chip 不贴边、不双缩进)不变。
  assert.match(wxss, /\.order-tabs-wrap\s*\{/, '缺少 chip 包裹层')
  assert.doesNotMatch(
    wxss,
    /\.order-tabs-wrap\s*\{[^}]*var\(--cy-page-x\)/,
    'scene-sheet 正文已给 16px 左右内距,order-tabs-wrap 再补 --cy-page-x 会双份缩进',
  )
  assert.doesNotMatch(wxss, /\.order-filter\s*\{/, '手写四列网格(§5.3 未授权)不得回潮')
  assertGutterWrapOnlyHoldsChips(wxml)
})

// 这层 wrapper 的唯一职责是给 chip 补页面左右边距。cy-page-title 自己已经带 --cy-page-x,
// 塞进来会叠成双份缩进,标题与全站其它页对不齐(导航统一那轮真的这么写过一次)。
function assertGutterWrapOnlyHoldsChips(wxml) {
  const wrap = wxml.match(/<view class="order-tabs-wrap"[^>]*>[\s\S]*?<\/view>/)
  assert.ok(wrap, '缺少 .order-tabs-wrap')
  // wrapper 里承接的必须是共享 cy-tabs 的 chip 变体(§5.3 未授权的手写四列网格已撤)
  assert.match(wrap[0], /<cy-tabs\b/, 'gutter wrapper 必须只承接共享 cy-tabs')
  assert.match(wrap[0], /variant="chip"/, '订单状态筛选必须是 cy-tabs 的 chip 变体')
  assert.doesNotMatch(
    wrap[0],
    /<cy-page-title|<cy-nav-bar/,
    '导航/标题被套进 gutter wrapper:标题会拿到双份 --cy-page-x 缩进\n' + wrap[0],
  )
}

test('negative control: 把页面标题塞回 gutter wrapper(双份缩进)必须判红', () => {
  const original = read('components/cy/scene-member-order-history/index.wxml')
  const mutated = original.replace(
    /<view class="order-tabs-wrap"[^>]*>/,
    (m) => `${m}\n  <cy-page-title title="我的订单" />`,
  )
  assert.notEqual(mutated, original, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertGutterWrapOnlyHoldsChips(mutated), assert.AssertionError)
})

test('negative control: removing the wrapper is rejected', () => {
  const original = read('components/cy/scene-member-order-history/index.wxml')
  const mutated = original.replace(/<view class="order-tabs-wrap"([^>]*)>/, '<view class="order-tabs-wrap-removed"$1>')
  assert.notEqual(mutated, original, '变异锚点失效(源码已改动?)')
  assert.throws(() => assertGutterWrapOnlyHoldsChips(mutated), assert.AssertionError)
})
