'use strict'

/* utils/datetime-range.js 的纯函数契约。
 *
 * 为什么值得写:创建优惠券 / 券有效期两处各用 4 个滚轮拼一个区间,而**跨天**是这里最容易错的一点 ——
 * 只比时刻会把「9/1 22:00 → 9/2 02:00」算成 -20 小时。这条在真机上要等到有人真的设一个跨夜券才暴露。 */

const assert = require('node:assert/strict')
const test = require('node:test')
const dt = require('../../utils/datetime-range.js')

test('split:认 YYYY-MM-DD HH:mm[:ss],也认 T 分隔;非法一律 null', () => {
  assert.deepEqual(dt.split('2026-09-01 09:30:00'), { date: '2026-09-01', time: '09:30' })
  assert.deepEqual(dt.split('2026-09-01 09:30'), { date: '2026-09-01', time: '09:30' })
  assert.deepEqual(dt.split('2026-09-01T09:30:00'), { date: '2026-09-01', time: '09:30' })
  assert.equal(dt.split(''), null)
  assert.equal(dt.split('2026-09-01'), null, '缺时刻不算完整时刻')
  assert.equal(dt.split('2026-13-01 09:30'), null, '13 月不是合法日期')
  assert.equal(dt.split('2026-09-01 24:00'), null, '24 点不是合法钟点')
  assert.equal(dt.split(null), null)
})

test('join:补秒并归一化到两位;任一非法返回空串', () => {
  assert.equal(dt.join('2026-09-01', '9:30'), '2026-09-01 09:30:00', '单位数小时要补零')
  assert.equal(dt.join('2026-09-01', '09:30'), '2026-09-01 09:30:00')
  assert.equal(dt.join('2026-09-01', '25:00'), '')
  assert.equal(dt.join('bad', '09:30'), '')
})

test('★跨天必须按「日期+时刻」一起算 —— 只比时刻会算成负数', () => {
  assert.equal(dt.spanMinutes('2026-09-01 22:00:00', '2026-09-02 02:00:00'), 240,
    '跨夜 4 小时;只看时刻会得到 -1200')
  assert.equal(dt.spanMinutes('2026-09-01 09:00:00', '2026-09-01 17:30:00'), 510)
  assert.equal(dt.spanMinutes('2026-08-31 23:00:00', '2026-09-01 01:00:00'), 120, '跨月')
  assert.equal(dt.spanMinutes('2026-12-31 23:00:00', '2027-01-01 01:00:00'), 120, '跨年')
  assert.equal(dt.spanMinutes('2024-02-28 12:00:00', '2024-03-01 12:00:00'), 2880, '闰年二月多一天')
  assert.equal(dt.spanMinutes('2026-09-01 09:00:00', '2026-09-01 09:00:00'), 0, '同一时刻是 0')
  assert.equal(dt.spanMinutes('2026-09-02 09:00:00', '2026-09-01 09:00:00'), -1440, '倒序为负,不取绝对值')
})

test('spanMinutes 非法返回 null 而不是 0 —— 0 是「同一时刻」这个合法答案', () => {
  assert.equal(dt.spanMinutes('', '2026-09-01 09:00:00'), null)
  assert.notEqual(dt.spanMinutes('2026-09-01 09:00:00', '2026-09-01 09:00:00'), null)
})

test('formatSpan:跨天说天,不足一天退回小时/分钟', () => {
  assert.equal(dt.formatSpan(240), '4 小时')
  assert.equal(dt.formatSpan(90), '1 小时 30 分')
  assert.equal(dt.formatSpan(45), '45 分钟')
  assert.equal(dt.formatSpan(1440), '1 天')
  assert.equal(dt.formatSpan(1500), '1 天 1 小时')
  // ⚠️ 跨天时分钟不许被悄悄抹掉:2026-08-27 真机截图里 8/28 22:00 → 8/31 02:30(2 天 4.5 小时)
  // 曾被摘要说成「2 天 4 小时」,少报了 30 分钟。
  assert.equal(dt.formatSpan(3150), '2 天 4 小时 30 分')
  assert.equal(dt.formatSpan(1445), '1 天 5 分钟')
  assert.equal(dt.formatSpan(0), '')
  assert.equal(dt.formatSpan(-10), '')
})

test('validate:各类失败给出能区分的 reason', () => {
  const ok = dt.validate('2026-09-01 09:00:00', '2026-09-03 09:00:00')
  assert.deepEqual([ok.ok, ok.minutes, ok.reason], [true, 2880, ''])

  assert.equal(dt.validate('2026-09-03 09:00:00', '2026-09-01 09:00:00').reason, 'not-after')
  assert.equal(dt.validate('2026-09-01 09:00:00', '2026-09-01 09:00:00').reason, 'not-after',
    '起止同一刻的券没有有效期,不能放行')
  assert.equal(dt.validate('bad', '2026-09-01 09:00:00').reason, 'invalid')
  assert.equal(dt.validate('2026-09-01 09:00:00', '2026-09-01 10:00:00', { minMinutes: 120 }).reason, 'too-short')
  assert.equal(dt.validate('2026-09-01 09:00:00', '2026-09-30 09:00:00', { maxMinutes: 1440 }).reason, 'too-long')
  assert.equal(dt.validate('2026-08-01 09:00:00', '2026-09-01 09:00:00', { min: '2026-08-15 00:00:00' }).reason, 'before-min')
  assert.equal(dt.validate('2026-09-01 09:00:00', '2026-12-01 09:00:00', { max: '2026-10-01 00:00:00' }).reason, 'after-max')
})

test('validate 不夹取:越界把真实跨度原样返回', () => {
  const r = dt.validate('2026-09-01 09:00:00', '2026-09-30 09:00:00', { maxMinutes: 1440 })
  assert.equal(r.ok, false)
  assert.equal(r.minutes, 41760, '真实值原样返回,不是被夹过的 1440')
})

test('withDate / withTime:只换一半,另一半原样保留', () => {
  assert.equal(dt.withDate('2026-09-01 09:30:00', '2026-09-05'), '2026-09-05 09:30:00')
  assert.equal(dt.withTime('2026-09-01 09:30:00', '18:45'), '2026-09-01 18:45:00')
  assert.equal(dt.withDate('', '2026-09-05'), '2026-09-05 00:00:00', '原值为空时给个零点,不要产出空串')
  assert.equal(dt.withTime('', '18:45'), '', '没有日期就拼不出时刻')
})

test('负控:把跨天跨度写成只比时刻,跨夜必然算成负数', () => {
  const tr = require('../../utils/timerange.js')
  const broken = (a, b) => tr.toMinutes(b.slice(11, 16)) - tr.toMinutes(a.slice(11, 16))
  const A = '2026-09-01 22:00:00'
  const B = '2026-09-02 02:00:00'
  assert.equal(dt.spanMinutes(A, B), 240)
  assert.equal(broken(A, B), -1200)
  assert.notEqual(broken(A, B), dt.spanMinutes(A, B),
    '负控必须真的算出不同的值,否则这条断言什么也没证明')
})
