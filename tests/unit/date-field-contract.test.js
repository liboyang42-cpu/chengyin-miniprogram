// cy-date-field 值格式契约(2026-08-25)
//
// 它替代全仓 14 处原生 <picker mode="date"/"time">。能安全替换的前提只有一条:
// **值格式与原生逐字一致** —— date 是 'YYYY-MM-DD',time 是 'HH:mm'。
// 一旦漂移(比如少补零成 '2026-8-5'),调用方拿去拼接口参数会静默失败:
// 后端解析不了、或者按另一个日期落库,前端一点报错都不会有。
const test = require('node:test')
const assert = require('node:assert/strict')
const df = require('../../utils/date-field.js')

const BASE = 2026

test('date 值格式:必须是 YYYY-MM-DD,月与日都补零', () => {
  assert.equal(df.indexToDate(df.dateToIndex('2026-08-05', BASE).index, BASE), '2026-08-05')
  assert.equal(df.indexToDate(df.dateToIndex('2026-12-31', BASE).index, BASE), '2026-12-31')
  assert.match(df.indexToDate([0, 0, 0], BASE), /^\d{4}-\d{2}-\d{2}$/)
})

test('time 值格式:必须是 HH:mm,时与分都补零', () => {
  assert.equal(df.indexToTime(df.timeToIndex('09:05')), '09:05')
  assert.equal(df.indexToTime([0, 0]), '00:00')
  assert.equal(df.indexToTime([23, 59]), '23:59')
  // 原生 picker 回传 '9:05' 这类也要吃得下
  assert.deepEqual(df.timeToIndex('9:05'), [9, 5])
})

test('★ 月份切换后日列必须夹到当月最后一天,不能拼出 2 月 31 日', () => {
  // 先停在 1月31日,再把月列切到 2月:下标 [1,1,30] 仍是「第31天」
  assert.equal(df.indexToDate([1, 1, 30], BASE), '2026-02-28')
  assert.equal(df.indexToDate([1, 3, 30], BASE), '2026-04-30')
  assert.equal(df.daysInMonth(2028, 2), 29, '闰年二月必须是 29 天')
})

test('start 下限语义与原生 picker 一致:选到更早会夹回下限', () => {
  assert.equal(df.clampToStart('2026-01-01', '2026-08-01'), '2026-08-01')
  assert.equal(df.clampToStart('2026-09-01', '2026-08-01'), '2026-09-01')
  assert.equal(df.clampToStart('2026-01-01', ''), '2026-01-01', '没给 start 时不许擅自夹')
})

test('非法/空值不崩,落在可预期的位置', () => {
  assert.match(df.indexToDate(df.dateToIndex('', BASE, { year: BASE, month: 1, day: 1 }).index, BASE), /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(df.timeToIndex(''), [0, 0])
  assert.deepEqual(df.timeToIndex('99:99'), [23, 59], '越界必须夹住,不能生成 99:99')
})

test('列数与跨度:年列 ±(1,3),月列 12,日列随月份变化', () => {
  const [years, months, days] = df.dateColumns(BASE, 2026, 2)
  assert.equal(years.length, df.YEAR_SPAN_BACK + df.YEAR_SPAN_FWD + 1)
  assert.equal(years[0], String(BASE - df.YEAR_SPAN_BACK))
  assert.equal(months.length, 12)
  assert.equal(days.length, 28, '2026 年 2 月是 28 天')
  assert.equal(df.dateColumns(BASE, 2026, 1)[2].length, 31)
})

test('negative control:去掉当月天数夹取后,2 月 31 日必须出现(证明上面那条不是恒真)', () => {
  const naive = (index, baseYear) => {
    const year = baseYear - df.YEAR_SPAN_BACK + index[0]
    const month = index[1] + 1
    const day = index[2] + 1                      // 故意不夹
    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
  }
  assert.equal(naive([1, 1, 30], BASE), '2026-02-31')
  assert.notEqual(df.indexToDate([1, 1, 30], BASE), '2026-02-31')
})
