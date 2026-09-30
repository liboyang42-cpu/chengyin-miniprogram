// 专业发布编辑器:节点拖拽重排的几何耦合 + 地图/步骤条的分步归属。
//
// 病:拖拽落点 = Math.round(拖到的 y / rowHpx),而 rowHpx 由 JS 里的 CARD_H_RPX 折算,
// 行的真实高度却写在 wxss 里。两个数字分居两个文件、没有任何东西逼它们一致 ——
// 谁改一边,拖一行掉两行,而且不报任何错、单测也不会红。故在这里把它们钉死。
//
// 同时钉住 2026-08-09 的结构决定:
//  - 地图只在「剧情」这步渲染(路线这步让位给列表)
//  - 返回钮 + 步骤条必须在地图之外(留在 <map> 里会跟着地图一起消失,另外两步就没有导航了)
//  - 拖拽三件套 + 节点抽屉入口必须真绑在 wxml 上(它们曾经全是 0 绑定的死代码)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, '..', '..', 'pages', 'publish', 'fabu')
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

function rowGeometryFromWxss(wxss) {
  const rule = /\.slopes-node-row\s*\{([^}]*)\}/.exec(wxss)
  assert.ok(rule, 'wxss 必须定义 .slopes-node-row')
  const height = /height:\s*(\d+)rpx/.exec(rule[1])
  const margin = /margin-bottom:\s*var\(--cy-space-2\)/.exec(rule[1])
  assert.ok(height, '.slopes-node-row 必须定高,否则 movable-view 的 y 折算没有依据')
  assert.ok(margin, '.slopes-node-row 的行间距必须是 --cy-space-2(16rpx),换 token 要同步改本契约')
  return Number(height[1]) + 16
}

function cardHFromJs(js) {
  const m = /const CARD_H_RPX = (\d+)/.exec(js)
  assert.ok(m, 'index.js 必须定义 CARD_H_RPX')
  return Number(m[1])
}

test('拖拽落点几何:JS 的 CARD_H_RPX 必须等于 wxss 行高 + 行间距', () => {
  assert.equal(
    cardHFromJs(read('index.js')),
    rowGeometryFromWxss(read('index.wxss')),
    'CARD_H_RPX 与 .slopes-node-row 的实际占位对不上 → 松手后落点算偏,拖一行掉两行且零报错',
  )
})

test('negative control: 任一边漂移,几何契约必须判红', () => {
  const js = read('index.js')
  const wxss = read('index.wxss')

  const driftedJs = js.replace(/const CARD_H_RPX = \d+/, 'const CARD_H_RPX = 220')
  assert.notEqual(driftedJs, js, '负控未命中 CARD_H_RPX')
  assert.throws(
    () => assert.equal(cardHFromJs(driftedJs), rowGeometryFromWxss(wxss)),
    assert.AssertionError,
  )

  const driftedWxss = wxss.replace(/(\.slopes-node-row\s*\{[^}]*height:\s*)\d+(rpx)/, '$1200$2')
  assert.notEqual(driftedWxss, wxss, '负控未命中行高')
  assert.throws(
    () => assert.equal(cardHFromJs(js), rowGeometryFromWxss(driftedWxss)),
    assert.AssertionError,
  )
})

test('地图由 viewMode 切换,导航 chrome 必须留在地图之外', () => {
  const wxml = read('index.wxml')
  const mapWrap = /<view class="slopes-map-wrap"([^>]*)>/.exec(wxml)
  assert.ok(mapWrap, '必须有地图容器')
  // 2026-08-10:地图曾一度绑在「剧情」这步上。绑步骤是错的 —— 三种模式想看地图的时机
  // 各不相同,改由左下角药丸切 viewMode,谁都能自己决定什么时候看地图。
  assert.match(
    mapWrap[1],
    /wx:if="\{\{editorPage === 1 && viewMode === 'map'\}\}"/,
    '地图必须由 viewMode 驱动,且只在第 1 页 —— 第 2 页是纯票务表单,地图对它没意义',
  )
  assert.doesNotMatch(wxml, /activeTab/, '旧三步态已退役,不该有残留')

  const mapBlock = /<view class="slopes-map-wrap"[\s\S]*?<\/map>/.exec(wxml)
  assert.ok(mapBlock, '必须能截出地图块')
  assert.doesNotMatch(mapBlock[0], /slopes-back/, '返回钮不能留在地图里:地图撤走它会跟着消失')
  assert.doesNotMatch(mapBlock[0], /pd-step-progress/, '进度条不能留在地图里:地图只在第 1 页,留里面另一页就没导航了')

  assert.match(wxml, /class="slopes-sheet \{\{editorPage === 1 && viewMode === 'map' \? '' : 'slopes-sheet--full'\}\}"/,
    '只有第 1 页的地图视图才让出顶部空间,其余情况 sheet 占满屏')
})

test('拖拽三件套与节点抽屉入口必须真绑在 wxml 上(它们曾经全是死代码)', () => {
  const wxml = read('index.wxml')
  const js = read('index.js')
  ;[
    ['onNodeDragStart', 'catchlongpress'],
    ['onNodeDragChange', 'bindchange'],
    ['onNodeDragEnd', 'bindtouchend'],
    ['showEditNodes', 'catchtap'],
    ['selectNode', 'catchtap'],
  ].forEach(([handler, binding]) => {
    assert.match(wxml, new RegExp(`${binding}="${handler}"`), `${handler} 必须由 ${binding} 真绑定,否则又是死代码`)
    assert.match(js, new RegExp(`^  ${handler}\\(`, 'm'), `${handler} 必须在 index.js 里真存在`)
  })

  // 拖拽态必须关掉 sheet 的纵向滚动,否则和 movable-view 抢同一个手势
  assert.match(wxml, /scroll-y="\{\{!dragNodeLid\}\}"/, '拖拽进行中必须停掉 sheet 滚动')
})
