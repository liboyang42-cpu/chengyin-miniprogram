// 商家侧「节点NPC」入口(CR-927)接线合同:主题页「我的点位」行必须能把点位 id 带进半屏。
// 页面级只锁接线(按钮/字段/注册),半屏内部逻辑见 node-npc-form.test.js。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WXML = fs.readFileSync(path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.wxml'), 'utf8');
const JS = fs.readFileSync(path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.js'), 'utf8');
const JSON_CFG = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.json'), 'utf8'));

test('「我的点位」每行有节点NPC小按钮,并把 nodeId 带进半屏', () => {
  const button = WXML.match(/<cy-btn[^>]*bindtap="openNodeNpcForm"[\s\S]*?<\/cy-btn>/);
  assert.ok(button, '必须挂 openNodeNpcForm 按钮');
  assert.match(button[0], /size="sm"/, '按口径只放小按钮');
  assert.match(button[0], /data-node-id="\{\{chapterNode\.id\}\}"/, '必须带点位 id,不靠当前选中态');
  assert.match(button[0], /data-node-name="\{\{chapterNode\.name\}\}"/);
  assert.ok(WXML.indexOf('bindtap="openNodeNpcForm"') > WXML.indexOf('wx:for="{{myChapterNodes}}"'),
    '入口必须长在「我的点位」列表里');
});

test('页面注册 node-npc-form 并回传点位身份', () => {
  assert.equal(JSON_CFG.usingComponents['node-npc-form'], '/pages/topic/components/cy/node-npc-form/index');
  assert.match(WXML, /<node-npc-form[\s\S]*?show="\{\{nodeNpcFormVisible\}\}"/);
  assert.match(WXML, /node-id="\{\{nodeNpcNodeId\}\}"/);
  assert.match(WXML, /node-name="\{\{nodeNpcNodeName\}\}"/);
  assert.match(WXML, /bind:close="onNodeNpcFormClose"/);
});

test('页面 handler 只按 data-* 打开,保存成功才刷新列表', () => {
  assert.match(JS, /openNodeNpcForm\(e\)\s*\{/);
  assert.match(JS, /onNodeNpcFormClose\(e\)\s*\{/);
  assert.match(JS, /nodeNpcFormVisible: false,/);
  assert.match(JS, /nodeNpcNodeId: 0,/);
  assert.match(JS, /nodeNpcNodeName: '',/);
  const close = JS.match(/onNodeNpcFormClose\(e\)\s*\{[\s\S]*?\n  \},/);
  assert.ok(close, '必须能定位到 onNodeNpcFormClose 实现');
  assert.match(close[0], /e\.detail\.saved/, '失败留在表单重试,只有 saved=true 才刷新');
});
