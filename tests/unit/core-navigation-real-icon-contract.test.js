'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function assertRealNavigationIcons(navWxml, navWxss, cellWxml, cellWxss, navJson, cellJson) {
  assert.match(navWxml, /<cy-icon class="nav__back-icon" name="back" size="40"\s*\/>/)
  assert.doesNotMatch(navWxss, /nav__chevron|rotate\([+-]?40deg\)/,
    '全站返回图标不能由 CSS 线段绘制')
  assert.equal(JSON.parse(navJson).usingComponents['cy-icon'], '/components/cy/icon/index')

  assert.match(cellWxml, /<cy-icon[^>]*class="cell__chevron" name="\{\{arrowIcon\}\}" size="32"\s*\/>/)
  assert.doesNotMatch(cellWxss, /border-(?:top|right):[^;]+;|transform:\s*rotate\(45deg\)/,
    '列表行箭头不能由边框旋转绘制')
  assert.equal(JSON.parse(cellJson).usingComponents['cy-icon'], '/components/cy/icon/index')
}

test('全站导航返回与列表行箭头复用真实 cy-icon', () => {
  assertRealNavigationIcons(
    read('components/cy/nav-bar/index.wxml'),
    read('components/cy/nav-bar/index.wxss'),
    read('components/cy/cell/index.wxml'),
    read('components/cy/cell/index.wxss'),
    read('components/cy/nav-bar/index.json'),
    read('components/cy/cell/index.json'),
  )
})

test('negative control：列表行退回 CSS 箭头时必须判红', () => {
  const cellWxml = read('components/cy/cell/index.wxml')
    .replace('<cy-icon wx:if="{{arrow}}" class="cell__chevron" name="arrow-right" size="32" />', '<view wx:if="{{arrow}}" class="cell__chevron"></view>')
  const cellWxss = read('components/cy/cell/index.wxss') + '\n.cell__chevron { border-top: 4rpx solid; transform: rotate(45deg); }\n'
  assert.throws(() => assertRealNavigationIcons(
    read('components/cy/nav-bar/index.wxml'), read('components/cy/nav-bar/index.wxss'),
    cellWxml, cellWxss,
    read('components/cy/nav-bar/index.json'), read('components/cy/cell/index.json'),
  ), /列表行箭头|cy-icon/)
})
