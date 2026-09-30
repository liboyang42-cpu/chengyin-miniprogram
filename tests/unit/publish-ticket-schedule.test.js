const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cityOrientationScheduleIssues } = require('../../pages/publish/utils/publish/publish-ticket-schedule.js');

test('城市定向缺少集合起止时间会分别提示（数字或字符串 mode）', () => {
  assert.deepEqual(cityOrientationScheduleIssues({ mode: 1, startTime: '', endTime: '' }), [
    { field: 'startTime', message: '请选择集合开始时间' },
    { field: 'endTime', message: '请选择集合结束时间' }
  ]);
  assert.deepEqual(cityOrientationScheduleIssues({ mode: '1', startTime: '', endTime: '' }), [
    { field: 'startTime', message: '请选择集合开始时间' },
    { field: 'endTime', message: '请选择集合结束时间' }
  ]);
});

test('城市定向集合结束不得早于或等于集合开始', () => {
  assert.deepEqual(cityOrientationScheduleIssues({
    mode: 1,
    startTime: '2026-07-22 10:00',
    endTime: '2026-07-22 10:00'
  }), [{ field: 'endTime', message: '集合结束时间必须晚于开始时间' }]);
});

test('城市定向有效集合时间与自由定向不产生错误', () => {
  assert.deepEqual(cityOrientationScheduleIssues({
    mode: 1,
    startTime: '2026-07-22 10:00',
    endTime: '2026-07-22 12:00'
  }), []);
  assert.deepEqual(cityOrientationScheduleIssues({ mode: 2, startTime: '', endTime: '' }), []);
});
