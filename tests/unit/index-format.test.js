// FE-12 首页格式化纯函数 index-format —— 从 index.js 抽出。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatDateTimeForDisplay, processTopicDate } = require('../../utils/index/index-format.js');

test('formatDateTimeForDisplay:空 → 空串', () => {
  assert.equal(formatDateTimeForDisplay(null), '');
  assert.equal(formatDateTimeForDisplay(undefined), '');
});

test('formatDateTimeForDisplay:完整日期/星期/上下午/12时制补零', () => {
  // 2026-07-08 是周三;09:05 上午
  assert.equal(formatDateTimeForDisplay(new Date(2026, 6, 8, 9, 5)), '2026年7月8日 周三 上午09:05');
  // 下午 13:00 → 下午01:00
  assert.equal(formatDateTimeForDisplay(new Date(2026, 6, 8, 13, 0)), '2026年7月8日 周三 下午01:00');
  // 0 点 → 12(上午12:30)
  assert.equal(formatDateTimeForDisplay(new Date(2026, 6, 8, 0, 30)), '2026年7月8日 周三 上午12:30');
});

test('processTopicDate:补 month/day/dateTime + endDateTime;缺失才补', () => {
  const list = [{ startDate: '2026-07-08 19:30', endDate: '2026-07-09 21:00' }];
  const out = processTopicDate(list);
  assert.equal(out[0].month, '07');
  assert.equal(out[0].day, '08');
  assert.equal(out[0].dateTime, '07.08 19:30');
  assert.equal(out[0].endmonth, '07');
  assert.equal(out[0].endDateTime, '07.09 21:00');
});

test('processTopicDate:已有 dateTime 不覆盖;无时间部分补 00:00', () => {
  const list = [
    { startDate: '2026-07-08 19:30', dateTime: '已存在' },
    { startDate: '2026-07-10' },
  ];
  const out = processTopicDate(list);
  assert.equal(out[0].dateTime, '已存在', '已有 dateTime 不应覆盖');
  assert.equal(out[1].dateTime, '07.10 00:00', '无时间部分补 00:00');
});

test('processTopicDate:返回同一引用(就地修改)', () => {
  const list = [{ startDate: '2026-07-08 08:00' }];
  assert.equal(processTopicDate(list), list);
});
