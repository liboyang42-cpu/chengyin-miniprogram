const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveStepOfField, clampStep, buildProgress } = require('../../pages/publish/utils/publish/step-form');

const STEPS = [
  { key: 'basic', title: '基本信息', fields: ['name', 'addressName', 'startDate', 'endDate', 'categoryIds'] },
  { key: 'content', title: '活动内容', fields: ['description', 'imgUrl', 'templateId'] },
  { key: 'ticket', title: '票务与合作', fields: ['ticket*'] },
];

test('字段归属到正确的步', () => {
  assert.equal(resolveStepOfField(STEPS, 'name'), 0);
  assert.equal(resolveStepOfField(STEPS, 'endDate'), 0);
  assert.equal(resolveStepOfField(STEPS, 'imgUrl'), 1);
});

test('票单这类动态组用前缀命中,带下标的错误键也能定位', () => {
  assert.equal(resolveStepOfField(STEPS, 'ticketName0'), 2);
  assert.equal(resolveStepOfField(STEPS, 'ticketStock3'), 2);
  // 前缀不能退化成「任意包含」:tickle 不是票单字段
  assert.equal(resolveStepOfField(STEPS, 'xxticketName0'), -1);
});

test('未登记的字段返回 -1,让调用方留在原步而不是误跳第一步', () => {
  assert.equal(resolveStepOfField(STEPS, 'unknownField'), -1);
  assert.equal(resolveStepOfField([], 'name'), -1);
  assert.equal(resolveStepOfField(undefined, 'name'), -1);
});

test('步数越界被夹回端点,脏值退回第一步', () => {
  assert.equal(clampStep(STEPS, -1), 0);
  assert.equal(clampStep(STEPS, 9), 2);
  assert.equal(clampStep(STEPS, '1'), 1);
  assert.equal(clampStep(STEPS, NaN), 0);
  assert.equal(clampStep([], 3), 0);
});

test('进度点给出 done/current/todo 三态', () => {
  assert.deepEqual(buildProgress(STEPS, 1).map((p) => p.state), ['done', 'current', 'todo']);
  assert.deepEqual(buildProgress(STEPS, 0).map((p) => p.state), ['current', 'todo', 'todo']);
  // 越界的 current 也要落在合法步上,进度点不能全是 done
  assert.deepEqual(buildProgress(STEPS, 99).map((p) => p.state), ['done', 'done', 'current']);
  assert.deepEqual(buildProgress(STEPS, 1).map((p) => p.title), ['基本信息', '活动内容', '票务与合作']);
});

test('发布活动页真的按步渲染,且首错会先跳步再滚动', () => {
  const dir = path.join(__dirname, '../../pages/publish/activity');
  const wxml = fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');

  assert.match(wxml, /wx:for="\{\{progress\}\}"/, '大标题下必须有进度点');
  assert.match(wxml, /wx:if="\{\{step === 0\}\}"/, '第一步必须条件渲染');
  assert.match(wxml, /wx:if="\{\{step === 2\}\}"/, '最后一步必须条件渲染');
  assert.match(js, /resolveStepOfField\(/, '首错定位必须解析字段所属步');
  const scroll = js.match(/scrollToError\(key\)\s*\{([\s\S]*?)\n {2}\}/);
  assert.ok(scroll, 'scrollToError 不见了');
  assert.match(scroll[1], /setData\(/, '错误字段若不在当前步,必须先切步再滚动,否则选择器根本不在页面上');
});
