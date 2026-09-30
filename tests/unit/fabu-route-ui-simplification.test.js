'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.join(__dirname, '../..')
const pageWxml = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.wxml'), 'utf8')
const detailWxml = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/topic-detail-sheet.wxml'), 'utf8')
const pageJs = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.js'), 'utf8')
const pageJson = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.json'), 'utf8')

test('原故事流保持主界面，路线能力只作为节点内的下一站摘要', () => {
  assert.doesNotMatch(pageWxml, /id="routeGraphCard"/,
    '低频路线配置不能继续占用创作首屏独立卡片')
  assert.doesNotMatch(detailWxml, />故事路线</,
    '主题详情不再提供第二套全局路线编辑器')
  // 2026-09-08 用户走查:「这个下一站回民街是什么,删除掉这个下一站」。
  // 摘要从故事流块挪到节点弹窗 —— 合同要守的是「只有一个入口、且依附节点」,
  // 不是「必须长在故事流块上」。锚点跟着挪,严格程度不变。
  assert.doesNotMatch(pageWxml, /class="story-node-block__route"/,
    '故事流块上不再挂下一站摘要')
  assert.match(pageWxml, /class="node-card node-route-entry"[^>]*bindtap="openNodeRouteMapping"/,
    '节点弹窗里必须还能打开下一站对应')
  assert.match(pageWxml, /routeNodeMappingSummary\[editTargetNodeLid\]/)
})

test('节点编辑只保留一行下一站，底部弹层只做结果到地点的对应', () => {
  assert.match(pageWxml, /class="node-card node-route-entry"[^>]*bindtap="openNodeRouteMapping"/)
  assert.match(pageWxml, />下一站</)
  assert.match(pageWxml, /routeNodeMappingSummary\[editTargetNodeLid\] \|\| '按故事流继续'/)
  assert.match(pageWxml, /show="\{\{routeMappingShow\}\}"/)
  assert.match(pageWxml, /wx:for="\{\{routeMappingRows\}\}"/)
  // 2026-08-25:选择器由原生 <picker> 迁到 <cy-dropdown>,绑定写法从 bindchange 变成
  // bind:change。断言的意图(控件必须接上 handler)不变,所以两种写法都认。
  assert.match(pageWxml, /bind:?change="onRouteMappingTargetPick"/)
  assert.match(pageWxml, /bindtap="finishNodeRouteMapping"/)
  assert.match(pageWxml, />其他结果</)
  assert.match(pageWxml, /routeMappingFallbackLabel/)
  assert.doesNotMatch(pageWxml, /show="\{\{routeEditorShow\}\}"/,
    '默认 UI 不能残留全局路线编辑弹层')
  assert.doesNotMatch(pageWxml, />起点和结局</)
  assert.doesNotMatch(pageWxml, />高级设置</)
  assert.doesNotMatch(pageWxml, />测试路线</)
  assert.doesNotMatch(pageWxml, /outcomeCode/)
  assert.doesNotMatch(pageJson, /cy-tabs/)
  assert.match(pageJs, /routeMappingShow:\s*false/)
})
