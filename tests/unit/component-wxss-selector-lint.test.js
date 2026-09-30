const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { findUnsupportedComponentSelectors, lintComponentWxss } = require('../../scripts/component-wxss-selector-lint.js')

const ROOT = path.resolve(__dirname, '..', '..')

test('组件 WXSS 门禁拒绝 tag、ID、attribute selector，保留 class 与 :host', () => {
  assert.equal(findUnsupportedComponentSelectors('.tab image { width: 1rpx; }')[0].type, 'tag')
  assert.equal(findUnsupportedComponentSelectors('#tab .icon { width: 1rpx; }')[0].type, 'id')
  assert.equal(findUnsupportedComponentSelectors('.tab[data-state="on"] { width: 1rpx; }')[0].type, 'attribute')
  assert.deepEqual(findUnsupportedComponentSelectors(':host { display: block; } .tabbar__icon { width: 1rpx; }'), [])
})

test('所有已声明组件的 WXSS 均符合微信组件选择器限制', () => {
  assert.deepEqual(lintComponentWxss(ROOT), [])
})

test('tabBar 的图标样式有显式 class，不依赖被禁止的 image selector', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/tabBar/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'components/tabBar/index.wxss'), 'utf8')
  assert.match(wxml, /<image\s+class="tabbar__icon"/)
  assert.match(wxss, /\.tabbar__icon/)
  assert.doesNotMatch(wxss, /(^|[\s>])image(?=[\s.{:#\[])/m)
})
