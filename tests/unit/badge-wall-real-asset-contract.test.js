'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function assertRealAssets(wxml, wxss) {
  const visible = wxml.replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(visible, /查看 3D 徽章\s*[→›]/, '3D 入口不能用文字箭头冒充图标')
  // 2026-09-24:关闭改用照 cy-sheet close-sm 出的细线叉(del.png 自带实心圆底,和全站弹窗的叉不是一个样子)
  assert.match(visible, /<cover-image class="bw-sh-x-icon" src="\/subpackageP3\/images\/icon_close_sm\.png"/,
    'WebGL 原生层上方的关闭按钮必须使用可叠加的真实图片资产')
  assert.match(visible, /<cover-image class="bw-back-icon" src="\/subpackageP3\/images\/icon_back\.png"/,
    'WebGL 原生层上方的返回按钮必须使用可叠加的真实图片资产')
  assert.match(visible, /查看 3D 徽章<cover-image class="bw-sh-3d-icon" src="\/images\/icon_right\.png"/,
    '3D 入口必须使用真实右箭头资产')
  assert.doesNotMatch(wxss, /\.bw-(?:sh-x-line|back-chevron)(?:--[ab])?(?:::before|::after)?\s*\{|rotate\([+-]?(?:40|45)deg\)/,
    '返回和关闭按钮不能继续用 CSS 线段绘制')
}

test('勋章墙原生层按钮使用真实图片资产，不使用文字或 CSS 伪图标', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'subpackageP3/images/icon_close_sm.png')), '关闭图片资产不存在')
  assertRealAssets(
    read('subpackageP3/pages/badge-wall/index/index.wxml'),
    read('subpackageP3/pages/badge-wall/index/index.wxss'),
  )
})

test('negative control：真实箭头退回文字箭头时必须判红', () => {
  const wxml = read('subpackageP3/pages/badge-wall/index/index.wxml')
    .replace('<cover-image class="bw-sh-3d-icon" src="/images/icon_right.png" mode="aspectFit" />', ' →')
  assert.throws(
    () => assertRealAssets(wxml, read('subpackageP3/pages/badge-wall/index/index.wxss')),
    /文字箭头|真实右箭头资产/,
  )
})
