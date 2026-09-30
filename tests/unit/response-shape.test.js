const test = require('node:test');
const assert = require('node:assert/strict');

const { isRecord, isRecordList } = require('../../utils/response-shape.js');

test('record 守卫只接受非数组对象', () => {
  assert.equal(isRecord({ id: 1 }), true);
  for (const value of [null, undefined, [], 'x', 1, true]) assert.equal(isRecord(value), false);
});

test('record list 守卫拒绝空元素、数组元素和原始值', () => {
  assert.equal(isRecordList([]), true);
  assert.equal(isRecordList([{ id: 1 }, {}]), true);
  assert.equal(isRecordList([null]), false);
  assert.equal(isRecordList([[]]), false);
  assert.equal(isRecordList(['x']), false);
  assert.equal(isRecordList({}), false);
});
