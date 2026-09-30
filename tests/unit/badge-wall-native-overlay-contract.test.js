const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const WXML_PATH = 'subpackageP3/pages/badge-wall/index/index.wxml'
const JS_PATH = 'subpackageP3/pages/badge-wall/index/index.js'
const WXSS_PATH = 'subpackageP3/pages/badge-wall/index/index.wxss'
const JSON_PATH = 'subpackageP3/pages/badge-wall/index/index.json'
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertCoverBlock(source, cls, label) {
  const re = new RegExp('<cover-view class="' + cls + '(?:\\s|")[^>]*>[\\s\\S]*?<\\/cover-view>')
  assert.match(source, re, `${label} 必须使用 cover-view 置于 WebGL 原生层之上`)
}

function assertErrorContract(wxml, pageJson) {
  assert.match(wxml, /<cy-error class="bw-error-state" wx:if="\{\{loadFail \|\| partialFail \|\| \(glFail && viewMode === 'wall'\)\}\}"[\s\S]*retry="重试"[\s\S]*bind:retry="loadData"/)
  assert.match(wxml, /<scroll-view class="bw-list" scroll-y wx:if="\{\{viewMode === 'list' && badges\.length && !loadFail && !partialFail\}\}"/)
  assert.doesNotMatch(wxml, /bw-err-btn|class="bw-err"/, '自绘错误按钮必须收编 cy-error')
  assert.equal(pageJson.usingComponents && pageJson.usingComponents['cy-error'], '/components/cy/error/index')
}

test('badge-wall WebGL 分支的导航、字幕、错误态和详情层都在正确的原生层', () => {
  const wxml = read(WXML_PATH)
  const pageJson = JSON.parse(read(JSON_PATH))
  assertCoverBlock(wxml, 'bw-top', '顶部返回层')
  assertCoverBlock(wxml, 'bw-cap', '底部字幕层')
  assertCoverBlock(wxml, 'bw-veil', '详情遮罩层')
  assertCoverBlock(wxml, 'bw-sheet', '详情 sheet')
  assert.match(wxml, /<cover-view class="bw-back-hit"[^>]*bindtap="goBack"[^>]*aria-role="button"[^>]*aria-label="返回"/)
  assert.match(wxml, /<cover-view class="bw-cap-t">勋章墙<\/cover-view>/)
  // 2026-09-24 用户:「上面的那些颜色说明也要删掉」—— 图例整块删
  assert.doesNotMatch(wxml, /bw-legend|bw-lg/)
  assert.match(wxml, /<cover-view class="bw-sh-x"[^>]*bindtap="closeSheet"[^>]*aria-role="button"[^>]*aria-label="关闭勋章详情"/)
  assert.doesNotMatch(wxml, /<cy-nav-bar\b/, '原生 canvas 之上不能继续放普通 cy-nav-bar')
  assertErrorContract(wxml, pageJson)
})

test('badge-wall 覆盖层保留 88rpx 返回/关闭触达与正常视觉尺寸', () => {
  const wxss = read(WXSS_PATH)
  assert.match(wxss, /\.bw-back-hit\s*\{[^}]*min-width:\s*88rpx[^}]*min-height:\s*88rpx/)
  assert.match(wxss, /\.bw-back-inner\s*\{[^}]*width:\s*64rpx[^}]*height:\s*64rpx/)
  assert.match(wxss, /\.bw-sh-x\s*\{[^}]*width:\s*88rpx[^}]*height:\s*88rpx/)
  // 2026-09-24 叉号视觉框改照玩家场景弹窗:32px(--cy-comp-sheet-close-size),热区仍在外层 88rpx
  assert.match(wxss, /\.bw-sh-x-visual\s*\{[^}]*width:\s*var\(--cy-comp-sheet-close-size\)[^}]*height:\s*var\(--cy-comp-sheet-close-size\)/)
})

test('badge-wall 覆盖层顶部高度来自真实 navBarHeight,不复制写死导航避让', () => {
  const js = read(JS_PATH)
  const wxml = read(WXML_PATH)
  assert.match(js, /navBarHeight:\s*\(app\.globalData\s*&&\s*app\.globalData\.navBarHeight\)\s*\|\|\s*44/)
  assert.match(js, /setInsets\(that\.data\.statusBarHeight \+ that\.data\.navBarHeight \+ WALL_HEADER_INSET, WALL_BOTTOM_INSET\)/)
  assert.doesNotMatch(js, /setInsets\(that\.data\.statusBarHeight \+ 88, 190\)/)
  assert.match(wxml, /class="bw-top"[^>]*style="padding-top:\{\{statusBarHeight\}\}px;"/)
  assert.match(wxml, /class="bw-top-bar"[^>]*style="height:\{\{navBarHeight\}\}px;"/)
})

test('负控：把顶部覆盖层退回普通 view 必须判红', () => {
  const source = read(WXML_PATH)
  const mutated = source.replace('<cover-view class="bw-top"', '<view class="bw-top"')
  assert.notEqual(mutated, source, '变异锚点失效')
  assert.throws(() => assertCoverBlock(mutated, 'bw-top', '顶部返回层'))
})

test('负控：把详情 sheet 退回普通 view 必须判红', () => {
  const source = read(WXML_PATH)
  const mutated = source.replace('<cover-view class="bw-sheet ', '<view class="bw-sheet ')
  assert.notEqual(mutated, source, '变异锚点失效')
  assert.throws(() => assertCoverBlock(mutated, 'bw-sheet', '详情 sheet'))
})

test('负控：错误态恢复 bw-err-btn 自绘按钮必须判红', () => {
  const source = read(WXML_PATH)
  const mutated = source.replace('<cy-error class="bw-error-state"', '<view class="bw-err-btn"')
  assert.notEqual(mutated, source, '变异锚点失效')
  assert.throws(() => assertErrorContract(mutated, JSON.parse(read(JSON_PATH))))
})

test('负控：关闭按钮视觉盒撑满 88rpx 会把可视尺寸改大,必须判红', () => {
  const source = read(WXSS_PATH)
  const mutated = source.replace(/\.bw-sh-x-visual\s*\{[^}]*width:\s*var\(--cy-comp-sheet-close-size\)/, '.bw-sh-x-visual { width: 88rpx')
  assert.notEqual(mutated, source, '变异锚点失效')
  assert.throws(() => assert.match(mutated, /\.bw-sh-x-visual\s*\{[^}]*width:\s*var\(--cy-comp-sheet-close-size\)[^}]*height:\s*var\(--cy-comp-sheet-close-size\)/))
})
