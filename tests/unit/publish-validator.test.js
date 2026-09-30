// Phase 3.1 发布校验共享原语 publish-validator —— 先写失败测试(TDD RED)。
//
// 抽取 publish/activity 与 publish/fabu 共享的校验积累机制与共有规则(纯函数,不 setData/不发网络):
//  - createErrorBag:errors 映射(供 wxml 字段内联回显)+ order(供聚焦首个错误),两页原本各自手搓。
//  - nonEmpty:空值/占位哨兵('开始时间'/'开始日期'…)判空。
// 页面专有规则与逐票交错顺序(templateId/chapters/stock/price/mode/文案/聚焦 UX)仍留在页面。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createErrorBag,
  nonEmpty,
} = require('../../pages/publish/utils/publish/publish-validator.js');

test('nonEmpty:空串/undefined/null 为假', () => {
  assert.equal(nonEmpty(''), false);
  assert.equal(nonEmpty(undefined), false);
  assert.equal(nonEmpty(null), false);
  assert.equal(nonEmpty('主题'), true);
  assert.equal(nonEmpty(0), true, '0 是有效值(价格场景由页面单独校验)');
});

test('nonEmpty:等于占位哨兵视为空', () => {
  assert.equal(nonEmpty('开始时间', '开始时间'), false);
  assert.equal(nonEmpty('开始日期', '开始日期'), false);
  assert.equal(nonEmpty('2025-11-19 09:00', '开始时间'), true);
});

test('errorBag:require 累积错误、保持顺序、首个键、isValid', () => {
  const bag = createErrorBag();
  bag.require(nonEmpty(''), 'name', '请填写主题名称');
  bag.require(nonEmpty('有说明'), 'description', '请填写主题描述');
  bag.require(nonEmpty(''), 'imgUrl', '请上传主题封面');
  assert.deepEqual(bag.errors, { name: '请填写主题名称', imgUrl: '请上传主题封面' });
  assert.deepEqual(bag.order, ['name', 'imgUrl']);
  assert.equal(bag.firstKey(), 'name');
  assert.equal(bag.isValid(), false);
});

test('errorBag:全部通过 → isValid、firstKey 为空', () => {
  const bag = createErrorBag();
  bag.require(true, 'name', 'x');
  bag.require(true, 'description', 'y');
  assert.deepEqual(bag.errors, {});
  assert.equal(bag.isValid(), true);
  assert.equal(bag.firstKey(), undefined);
});

test('errorBag:add 直接加错误(用于自定义键)', () => {
  const bag = createErrorBag();
  bag.add('chapters', '请至少添加一个章节');
  assert.deepEqual(bag.errors, { chapters: '请至少添加一个章节' });
  assert.deepEqual(bag.order, ['chapters']);
});

test('errorBag:可选第四参 toastMessage 与字段内联文案分离(fabu 票务"第N个"前缀)', () => {
  const bag = createErrorBag();
  bag.require(false, 'ticketName0', '请填写票单名称', '第1个票务：请填写票单名称');
  bag.add('ticketPrice0', '价格不能为负数', '第1个票务：价格不能为负数');
  // errors 映射存短文案(供 wxml 内联),messages 存 toast 文案
  assert.deepEqual(bag.errors, { ticketName0: '请填写票单名称', ticketPrice0: '价格不能为负数' });
  assert.deepEqual(bag.messages, ['第1个票务：请填写票单名称', '第1个票务：价格不能为负数']);
  assert.equal(bag.firstMessage(), '第1个票务：请填写票单名称');
});

test('errorBag:省略 toastMessage 时 messages 回退为字段文案', () => {
  const bag = createErrorBag();
  bag.require(false, 'name', '请填写主题名称');
  assert.deepEqual(bag.messages, ['请填写主题名称']);
  assert.equal(bag.firstMessage(), '请填写主题名称');
});

