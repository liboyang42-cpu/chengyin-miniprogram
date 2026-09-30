// CU-C-163 · 模板编辑页两处「同步」开关重复且名称不同。
// 两颗 cy-switch 同绑 formData.isSync / switch1Change:上面叫「同步到模板广场」(无条件渲染),
// 底部叫「同步到模板库」(id<=0)。实点任一颗两颗一起动,却让人以为是两个设置。
// 修法只有一处:留上面那颗(它本来就无条件渲染,删掉下面那颗不改变任何可见态),
// 并让这块设置在页面上只有一个名字。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxmlPath = path.resolve(__dirname, '../../pages/publish/temp/index.wxml');
const wxssPath = path.resolve(__dirname, '../../pages/publish/temp/index.wxss');
const wxml = fs.readFileSync(wxmlPath, 'utf8');
const wxss = fs.readFileSync(wxssPath, 'utf8');

// 注释不面向商家,量"页面上有几种叫法"必须先把注释剥掉。
const visible = wxml.replace(/<!--[\s\S]*?-->/g, '');
const count = (text, re) => (text.match(re) || []).length;

test('formData.isSync 在全页只有一个开关入口', () => {
  assert.equal(count(wxml, /bindchange="switch1Change"/g), 1, 'switch1Change 只能接一颗开关');
  assert.equal(count(wxml, /checked="{{\s*formData\.isSync/g), 1, '绑定 formData.isSync 的开关只能有一颗');
  assert.ok(!/class="[^"]*cg-sync/.test(wxml), '底部那一颗的容器不得留着');
  assert.ok(!/\.cg-sync\s*\{/.test(wxss), '删掉的那一颗不留死样式');
});

test('这块设置在页面上只有一个名字', () => {
  // 不钉出现几次,钉的是「凡说到这个动作,都叫模板广场」——
  // 一处开关名 + 保存前摘要的开/关两种说法。
  assert.ok(count(visible, /同步到模板/g) >= 2, '这一页确实在说这块设置');
  assert.equal(count(visible, /同步到模板(?!广场)/g), 0, '「同步到模板…」不许有第二种叫法');
  assert.match(visible, /<view class="cg-sq-name">同步到模板广场<\/view>/);
  assert.ok(!/模板库/.test(visible), '「模板广场」与「模板库」不许同时出现在这一页');
});

test('合并没有丢掉草稿与正式发布的生效时机', () => {
  // 走查点名要有的信息:开了之后什么时候真的公开。
  assert.match(visible, /当前同步到模板广场；保存草稿不会公开/);
  assert.match(visible, /当前不同步到模板广场/);
});

test('负控:再摆第二颗 isSync 开关就会红', () => {
  const withDuplicate = `${wxml}<cy-switch checked="{{ formData.isSync }}" bindchange="switch1Change" />`;
  assert.equal(count(withDuplicate, /bindchange="switch1Change"/g), 2,
    '脚手架自检:这条断言确实数得出重复开关');
  const renamed = wxml.replace('同步到模板广场；保存草稿', '同步到模板库；保存草稿');
  assert.ok(/模板库/.test(renamed.replace(/<!--[\s\S]*?-->/g, '')),
    '脚手架自检:名字改回去也会被抓到');
});
