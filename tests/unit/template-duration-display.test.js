const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatDurationMinutes } = require('../../utils/template-display.js');

const WXML = fs.readFileSync(
  path.join(__dirname, '../../pages/template/index.wxml'),
  'utf8'
);

test('模板时长展示只补一次分钟单位', () => {
  assert.equal(formatDurationMinutes(35), '35分钟');
  assert.equal(formatDurationMinutes('35'), '35分钟');
  assert.equal(formatDurationMinutes('35分钟'), '35分钟');
  assert.equal(formatDurationMinutes('35 分钟'), '35分钟');
});

test('发布广场当前三处模板摘要复用归一化时长', () => {
  // 2026-08-26:列表卡的时长并进 _metaText(两个实体的 meta 组成不同,拆成两个装饰器),
  // 计数断言主语因此消失。真正的闸是下面两条「不许绕过归一化」+ 这条「装饰器必须调归一化」。
  const JS = fs.readFileSync(path.join(__dirname, '../../pages/template/index.js'), 'utf8');
  assert.match(JS, /decorateTopic\(list\)[\s\S]*?formatDurationMinutes\(item\.totalTime\)/,
    '主题摘要必须走归一化时长');
  assert.match(JS, /decorateGame\(list\)[\s\S]*?formatDurationMinutes\(item\.duration\)/,
    '玩法摘要必须走归一化时长');
  assert.ok((WXML.match(/_durationText|_metaText/g) || []).length >= 3, '头牌与两组模板摘要都要用归一化后的时长字段');
  assert.doesNotMatch(WXML, /item\.duration\s*}}/, '不许绕过归一化直接渲染 item.duration');
  assert.doesNotMatch(WXML, /templateInfo\.duration\s*}}/, '不许绕过归一化直接渲染 templateInfo.duration');
});
