const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function rule(source, selector) {
  const matches = source.match(new RegExp('\\.' + selector + '\\s*\\{[^}]*\\}', 'g'))
  assert.ok(matches, `找不到 .${selector} 样式规则`)
  assert.equal(matches.length, 1, `.${selector} 不能由后续同名规则覆盖契约`)
  return matches[0]
}

function assertSheetCloseAccessibility(wxml, wxss, tokens) {
  assert.match(
    wxml,
    /class="sh__head \{\{closable \? 'sh__head--closable' : ''\}\}" wx:if="\{\{title\}\}"/,
    '仅 closable 的标题栏必须为 88rpx 热区预留垂直空间',
  )
  assert.match(
    wxml,
    /class="sh__title \{\{closable \? 'sh__title--closable' : ''\}\}"/,
    '仅 closable 的标题必须为关闭热区预留右侧空间',
  )

  const close = wxml.match(/<view class="sh__close"[^>]*><cy-icon name="\{\{closeIcon\}\}" size="\{\{closeIconSize\}\}" \/><\/view>/)
  assert.ok(close, '有标题且 closable 时必须渲染 cy-sheet 关闭控件')
  assert.match(close[0], /wx:if="\{\{closable\}\}"/, '关闭控件必须继续尊重 closable 公共属性')
  assert.match(close[0], /bindtap="onClose"/, '关闭控件必须继续触发既有 close 事件')
  assert.match(close[0], /aria-role="button"/, '关闭控件必须声明 button 语义')
  assert.match(close[0], /aria-label="\{\{closeLabel\}\}"/, '关闭控件必须有可读的动态关闭标签')

  const head = rule(wxss, 'sh__head')
  assert.match(head, /position:\s*relative/, '关闭热区必须相对头部绝对定位')
  assert.doesNotMatch(head, /min-height\s*:/, '通用标题栏不得承载仅 closable 的 88rpx 高度规则')

  const closableHead = rule(wxss, 'sh__head--closable')
  assert.match(closableHead, /min-height:\s*var\(--cy-btn-h\)/, '可关闭标题栏必须完整容纳 88rpx 关闭热区')
  assert.match(closableHead, /box-sizing:\s*border-box/, '可关闭标题栏的最小高度必须包含既有内边距')

  const closableTitle = rule(wxss, 'sh__title--closable')
  assert.match(closableTitle, /flex:\s*1/, '可关闭标题必须填满除关闭位之外的可用空间')
  assert.match(closableTitle, /min-width:\s*0/, '长标题必须可收缩，不能绘制到关闭热区下方')
  assert.match(closableTitle, /box-sizing:\s*border-box/, '标题预留必须计入自身宽度')
  assert.match(closableTitle, /padding-right:\s*var\(--cy-btn-h\)/, '标题右侧必须完整预留关闭热区')

  const closeRule = rule(wxss, 'sh__close')
  assert.match(closeRule, /position:\s*absolute/, '关闭热区必须脱离头部流，视觉 X 不得因扩热区位移')
  assert.match(closeRule, /top:\s*50%/, '关闭热区必须沿原有头部中心定位')
  assert.match(closeRule, /right:\s*0/, '关闭视觉 X 必须保持原有右侧锚点')
  assert.match(closeRule, /transform:\s*translateY\(-50%\)/, '关闭热区必须沿原有头部中心定位')
  assert.match(closeRule, /width:\s*var\(--cy-btn-h\)/, '关闭热区宽度必须读现有 88rpx 按钮 token')
  assert.match(closeRule, /height:\s*var\(--cy-btn-h\)/, '关闭热区高度必须读现有 88rpx 按钮 token')
  assert.match(closeRule, /box-sizing:\s*border-box/, '关闭热区尺寸必须包含内边距')
  assert.match(closeRule, /justify-content:\s*center/, '视觉 X 必须在圆形热区内居中')
  assert.match(closeRule, /padding-right:\s*0/, '圆形热区不得再把 X 推向右边')
  assert.match(closeRule, /font-size:\s*var\(--cy-font-subtitle\)/, '视觉 X 必须保持既有小字号 token')
  assert.match(closeRule, /color:\s*var\(--cy-text-secondary\)/, '关闭色必须继续读现有主题 token')
  /* 2026-09-02(vault §3.21 已定 · 用户当面点名):✕ 去圆底,只留字形。
     本契约保护的是**无障碍与热区** —— 上面 width/height/position 那几条才是它的本体,一条没动。
     这里把旧口径「必须是圆形 chip」换成新口径:底色必须透明。 */
  assert.match(closeRule, /background:\s*transparent/, '✕ 不许再有圆底,只留字形')
  assert.doesNotMatch(closeRule, /url\(/, '关闭热区不得额外引入资产')

  const buttonHeight = tokens.match(/--cy-btn-h:\s*(\d+)rpx/)
  assert.ok(buttonHeight, '找不到既有 --cy-btn-h token')
  assert.ok(Number(buttonHeight[1]) >= 88, `关闭热区必须横纵均 ≥88rpx，当前 token 为 ${buttonHeight[1]}rpx`)
}

test('cy-sheet 关闭控件有可读语义、88rpx 真热区且不与标题/body 重叠', () => {
  assertSheetCloseAccessibility(
    read('components/cy/sheet/index.wxml'),
    read('components/cy/sheet/index.wxss'),
    read('style/tokens.wxss'),
  )
})

test('负控：移除关闭 aria-label 必须判红', () => {
  const wxml = read('components/cy/sheet/index.wxml')
  const mutated = wxml.replace(
    /(<view class="sh__close"[^>]*?) aria-label="\{\{closeLabel\}\}"/,
    '$1',
  )
  assert.notEqual(mutated, wxml, '变异锚点失效（源码已改动？）')
  assert.throws(
    () => assertSheetCloseAccessibility(mutated, read('components/cy/sheet/index.wxss'), read('style/tokens.wxss')),
    assert.AssertionError,
  )
})

test('负控：收窄关闭热区必须判红', () => {
  const wxss = read('components/cy/sheet/index.wxss')
  const mutated = wxss.replace('width: var(--cy-btn-h);', 'width: 64rpx;')
  assert.notEqual(mutated, wxss, '变异锚点失效（源码已改动？）')
  assert.throws(
    () => assertSheetCloseAccessibility(read('components/cy/sheet/index.wxml'), mutated, read('style/tokens.wxss')),
    assert.AssertionError,
  )
})

test('负控：撤销标题关闭位预留必须判红', () => {
  const wxss = read('components/cy/sheet/index.wxss')
  const mutated = wxss.replace('padding-right: var(--cy-btn-h);', 'padding-right: 0;')
  assert.notEqual(mutated, wxss, '变异锚点失效（源码已改动？）')
  assert.throws(
    () => assertSheetCloseAccessibility(read('components/cy/sheet/index.wxml'), mutated, read('style/tokens.wxss')),
    assert.AssertionError,
  )
})

test('负控：把 88rpx 关闭热区缩回视觉尺寸必须判红', () => {
  const wxss = read('components/cy/sheet/index.wxss')
  // 2026-09-02:原负控是「去掉圆形 chip 必须红」,而现在没有 chip 了(§3.21 去圆底),那条会恒绿。
  // 换成守真正会坏的那条:88rpx 热区不许缩回视觉尺寸。
  const mutated = wxss.replace('  width: var(--cy-btn-h);\n  height: var(--cy-btn-h);', '  width: 40rpx;\n  height: 40rpx;')
  assert.notEqual(mutated, wxss, '变异锚点失效（源码已改动？）')
  assert.throws(
    () => assertSheetCloseAccessibility(read('components/cy/sheet/index.wxml'), mutated, read('style/tokens.wxss')),
    assert.AssertionError,
  )
})

test('负控：向通用 header 泄漏 closable 高度规则必须判红', () => {
  const wxss = read('components/cy/sheet/index.wxss')
  const mutated = wxss.replace(
    '  padding: 24rpx 0 8rpx;\n}',
    '  padding: 24rpx 0 8rpx;\n  min-height: var(--cy-btn-h);\n}',
  )
  assert.notEqual(mutated, wxss, '变异锚点失效（源码已改动？）')
  assert.throws(
    () => assertSheetCloseAccessibility(read('components/cy/sheet/index.wxml'), mutated, read('style/tokens.wxss')),
    assert.AssertionError,
  )
})
