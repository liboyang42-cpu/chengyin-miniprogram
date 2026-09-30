const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('tabBar image geometry uses a class selector allowed in component WXSS', () => {
  const wxml = read('components/tabBar/index.wxml')
  const wxss = read('components/tabBar/index.wxss')
  assert.match(wxml, /<image[^>]*class="tabbar__icon"[^>]*mode="widthFix"/)
  assert.match(wxss, /\.tabbar__icon\s*\{[\s\S]*?width:\s*64rpx[\s\S]*?height:\s*64rpx/)
  assert.doesNotMatch(wxss, /(?:^|[,{\s])image(?:\s|\{|\.)/, 'component WXSS must not use the image tag selector')
})

test('tabBar 每个导航项占满等分栏且触达宽高都不低于 44px token', () => {
  const wxss = read('components/tabBar/index.wxss')
  const rule = wxss.match(/\.tabbar \.list \.ul \.li\s*\{([^}]*)\}/)
  assert.ok(rule, '缺少 tabBar .li 样式')
  assert.match(rule[1], /flex:\s*1\s*;/)
  assert.match(rule[1], /min-width:\s*var\(--cy-btn-h\)\s*;/)
  assert.match(rule[1], /min-height:\s*var\(--cy-btn-h\)\s*;/)
  // 去掉文字后只剩一个 64rpx 子元素,不居中会顶对齐、底下空一条
  assert.match(rule[1], /justify-content:\s*center\s*;/)
})

test('tabBar 保持原 16rpx 纵向呼吸,横向收到 12rpx 让图标铺更开(均走 space token)', () => {
  const wxss = read('components/tabBar/index.wxss')
  const listRule = wxss.match(/\.tabbar \.list\s*\{([\s\S]*?)\}/)

  assert.ok(listRule, 'tabBar list rule must exist')
  assert.match(listRule[1], /padding:\s*var\(--cy-space-2\) var\(--cy-space-1-5\)/)
  assert.match(listRule[1], /padding-bottom:\s*calc\(16rpx \+ constant\(safe-area-inset-bottom\)\)/)
  assert.match(listRule[1], /padding-bottom:\s*calc\(16rpx \+ env\(safe-area-inset-bottom\)\)/)
})

test('tabBar 只剩图标:不渲染文字标签,可达性靠每项 aria-label', () => {
  const wxml = read('components/tabBar/index.wxml')
  const wxss = read('components/tabBar/index.wxss')
  assert.doesNotMatch(wxml, /<text/)
  assert.doesNotMatch(wxss, /tab-txt/)
  assert.match(wxml, /aria-label="\{\{index === active \? '当前' \+ item\.text : '前往' \+ item\.text\}\}"/)
})

test('negative control: restoring the image tag selector is rejected', () => {
  const wxss = read('components/tabBar/index.wxss').replace(/\.tabbar__icon/g, 'image')
  assert.throws(() => assert.doesNotMatch(wxss, /(?:^|[,{\s])image(?:\s|\{|\.)/))
})

test('漫游地图入口不渲染底栏，其他页面的默认 tabBar 与导航尺寸不变', () => {
  const js = read('components/tabBar/index.js')
  const wxml = read('components/tabBar/index.wxml')
  const wxss = read('components/tabBar/index.wxss')
  const roamWxml = read('pages/roam/index.wxml')

  assert.match(js, /immersive:\s*\{\s*type:\s*Boolean,\s*value:\s*false\s*\}/)
  assert.match(wxml, /\{\{immersive \? 'tabbar--immersive' : ''\}\}/)
  assert.match(roamWxml, /<tabBar\s+wx:if="\{\{screen=='intro'\}\}"/)
  assert.match(wxss, /\.tabbar\.tabbar--immersive\.monochrome\.dark \.list\s*\{[\s\S]*?background:\s*transparent;/)
  assert.match(wxss, /\.tabbar\.tabbar--immersive\.monochrome\.dark \.list\s*\{[\s\S]*?backdrop-filter:\s*none;/)
  assert.match(wxss, /\.tabbar\.tabbar--immersive\.monochrome\.dark \.list\s*\{[\s\S]*?border-top-color:\s*transparent;/)
  assert.match(wxss, /\.tabbar\.tabbar--immersive\.monochrome\.dark \.list\s*\{[\s\S]*?box-shadow:\s*none;/)
  const immersiveRule = wxss.match(/\.tabbar\.tabbar--immersive\.monochrome\.dark \.list\s*\{([^}]*)\}/)
  assert.ok(immersiveRule)
  assert.doesNotMatch(immersiveRule[1], /(?:padding|font-size|width|height|gap|font-weight)\s*:/)
})
