const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const wxml = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.wxml'), 'utf8');
const detailWxml = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/topic-detail-sheet.wxml'), 'utf8');
const wxss = fs.readFileSync(path.join(ROOT, 'pages/publish/fabu/index.wxss'), 'utf8');

// 2026-09-08 用户逐屏走查:「这个下一站回民街是什么,删除掉这个下一站」——
// 故事流的节点块上原来挂了一行「下一站 · XX」摘要,在那个位置读不出它是什么,
// 也和块本身(这一段故事)不是一回事。摘要撤到节点弹窗里那一张卡上。
// ★ 这条合同的原意是「路线能力只能依附节点,不许长出主题级入口」—— 那一条照旧钉着
//   (下面 doesNotMatch 两行没动);变的只是摘要挂在**节点弹窗**而不是**故事流块**上。
test('分支对应依附节点,不新增主题级路线入口', () => {
  assert.match(wxml, /story-node-block__name/);
  assert.match(wxml, /story-node-block__meta/);
  assert.doesNotMatch(wxml, /story-node-block__route/,
    '故事流块上不再挂下一站摘要 —— 它读不出是什么,已挪到节点弹窗');
  assert.match(wxml, /node-card node-route-entry/, '节点弹窗里那条入口必须还在');
  assert.match(wxml, /routeNodeMappingSummary\[editTargetNodeLid\]/);
  assert.doesNotMatch(detailWxml, />故事路线</);
  assert.doesNotMatch(wxml, /routeEditorShow/);
});

test('节点详情只显示一个下一站摘要，结果映射在轻量底部弹层完成', () => {
  assert.match(wxml, /node-card node-route-entry/);
  assert.match(wxml, /routeNodeMappingSummary\[editTargetNodeLid\]/);
  assert.match(wxml, /route-mapping-sheet node-sheet/);
  assert.match(wxml, /routeMappingSourceLabel.*routeMappingTemplateLabel.*routeMappingSourceLabel/);
  assert.match(wxml, /routeMappingRows/);
  assert.match(wxml, /mapping\.label/);
  assert.match(wxml, /mapping\.targetLabel/);
  assert.match(wxml, /route-mapping-row__target/);
  assert.doesNotMatch(wxml, /class="node-pill"[^>]*>\{\{mapping\.targetLabel\}\}/);
  assert.match(wxml, /其他结果/);
  assert.match(wxml, /routeMappingFallbackLabel/);
  assert.match(wxml, /bindtap="finishNodeRouteMapping"/);
});

test('下一站 UI 沿用黑白灰卡片语言，不暴露技术图配置', () => {
  assert.match(wxss, /\.route-mapping-row/);
  assert.match(wxss, /var\(--cy-color-bg-surface\)/);
  assert.match(wxss, /var\(--cy-color-border-subtle\)/);
  assert.doesNotMatch(wxml, />起点和结局</);
  assert.doesNotMatch(wxml, />剧情状态</);
  assert.doesNotMatch(wxml, />地点限制</);
  assert.doesNotMatch(wxml, />分支高级规则</);
  assert.doesNotMatch(wxml, />路线图和复制</);
  assert.doesNotMatch(wxml, />测试路线</);
  assert.doesNotMatch(wxml, /允许受限循环/);
  assert.doesNotMatch(wxml, /玩法结果代码/);
});
