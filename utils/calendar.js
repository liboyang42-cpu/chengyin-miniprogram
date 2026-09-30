/**
 * utils/calendar.js —— 月历网格的纯计算层(2026-08-26)
 *
 * 只算数据,不碰 setData、不碰样式:组件把结果丢进 wx:for,WXS 负责首日偏移那点样式。
 * 拆成纯函数是为了能在 node 里单测 —— 跨月/跨年/闰年/首日偏移这几处最容易错,
 * 而它们在真机上极难复现(要等到 2 月 29 号)。
 *
 * 日期一律用 'YYYY-MM-DD' 字符串:
 *   · 字典序 === 时间序,比大小不用建 Date 对象;
 *   · 不带时区,不会因为 new Date('2026-08-26') 被解析成 UTC 而在东八区差一天。
 * 只有「相隔几天」必须真算,那里走 Date.UTC(见 daysBetween)。
 */

const PAD = (n) => (n < 10 ? '0' + n : '' + n)

/** 'YYYY-MM-DD';入参是 1-based 月份 */
function ymd(year, month, day) {
  return year + '-' + PAD(month) + '-' + PAD(day)
}

function parse(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  if (!m) return null
  return { year: +m[1], month: +m[2], day: +m[3] }
}

/** 该月天数(闰年由 Date 自己算,不自己写 4/100/400 规则) */
function monthDays(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * 该月 1 号前面要空几格。
 * firstDayOfWeek: 1=周一起(中国习惯,默认) 0=周日起
 */
function firstDayOffset(year, month, firstDayOfWeek) {
  const fdw = firstDayOfWeek === 0 ? 0 : 1
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() // 0=周日
  return (weekday - fdw + 7) % 7
}

/** a、b 相隔几天(b - a);两端都必须是合法 'YYYY-MM-DD' */
function daysBetween(a, b) {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return 0
  const ta = Date.UTC(pa.year, pa.month - 1, pa.day)
  const tb = Date.UTC(pb.year, pb.month - 1, pb.day)
  return Math.round((tb - ta) / 86400000)
}

/** 月份 +n,返回 {year, month} */
function shiftMonth(year, month, n) {
  const total = year * 12 + (month - 1) + n
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

/**
 * 单个日期的状态枚举 —— 样式全靠它,不靠 isStart && !isEnd && inRange 这种组合判断。
 * 组合判断多一个条件就多一类边界 bug,枚举是一个字段一个真相。
 *
 * @returns 'start' | 'end' | 'start-end' | 'middle' | 'selected' | 'disabled' | ''
 */
function dayType(date, sel, mode, disabledSet) {
  if (disabledSet && disabledSet[date]) return 'disabled'
  if (mode === 'range') {
    const start = sel && sel[0]
    const end = sel && sel[1]
    if (start && end && start === end && date === start) return 'start-end'
    if (start && date === start) return 'start'
    if (end && date === end) return 'end'
    if (start && end && date > start && date < end) return 'middle'
    return ''
  }
  return sel && date === sel ? 'selected' : ''
}

/**
 * 构造一个月的**结构**。
 *
 * ⚠️ 这里刻意不算每格的 type —— 那是 index.wxs 的 dayClass 在渲染层干的活。
 * 理由:type 由 [start, end] 决定,若在这里算,每点一次日期就要把六个月约 180 格
 * 重新 setData 过桥一次。结构(哪天、第几号、有没有 mark)只跟月份有关,构建一次就不动了。
 *
 * @returns { key, year, month, title, offset, days: [{ text, date, mark }] }
 */
function buildMonth(year, month, options) {
  const opts = options || {}
  const total = monthDays(year, month)
  const days = []
  for (let d = 1; d <= total; d++) {
    const date = ymd(year, month, d)
    days.push({
      text: d,
      date: date,
      mark: (opts.marks && opts.marks[date]) || '',
    })
  }
  return {
    key: year + '-' + PAD(month),
    year: year,
    month: month,
    // 2026-08-27:原来当年省掉年份(只写「9 月」)。日历一次铺 12 个月,滚到年底就是
    // 「12 月」紧挨着「2027 年 1 月」—— 省掉的那一半反而要读者自己推断当前是哪年。
    // 参考图(Any Distance 日历浮层)同样是「May 2025」恒带年份。年份一律写全。
    title: year + ' 年 ' + month + ' 月',
    offset: firstDayOffset(year, month, opts.firstDayOfWeek),
    days: days,
  }
}

/** 从 fromDate 所在月起,连续 count 个月 */
function buildMonths(fromDate, count, options) {
  const from = parse(fromDate)
  if (!from || !(count > 0)) return []
  const out = []
  for (let i = 0; i < count; i++) {
    const ym = shiftMonth(from.year, from.month, i)
    out.push(buildMonth(ym.year, ym.month, options))
  }
  return out
}

/**
 * 区间选择的状态机 —— 点一下之后 [start, end] 该变成什么。
 *
 * 规则(与主流 range picker 一致,不自创):
 *   · 空 / 已选满  → 重开,只落 start
 *   · 只有 start   → 点在 start 之前 = 用户想改开始,重开;点在之后 = 落 end
 *   · 同一天       → allowSameDay 才允许收成 start-end,否则视为重开
 *
 * @returns { value: [start, end|null], done: Boolean }  done=两端齐了
 */
function pickRange(sel, date, allowSameDay) {
  const start = sel && sel[0]
  const end = sel && sel[1]
  if (!start || end) return { value: [date, null], done: false }
  if (date < start) return { value: [date, null], done: false }
  if (date === start) {
    return allowSameDay
      ? { value: [start, date], done: true }
      : { value: [date, null], done: false }
  }
  return { value: [start, date], done: true }
}

/**
 * 今天。
 * ⚠️ 必须走本地时区分量,不能用 toISOString().slice(0,10) —— 那是 UTC,
 * 东八区凌晨 0–8 点会退回前一天,用户会看到「今天」被标成昨天。
 */
function today(now) {
  const n = now || new Date()
  return ymd(n.getFullYear(), n.getMonth() + 1, n.getDate())
}

/** date 往后 n 天(n 可为负)。走 UTC 分量,不受本地时区影响 */
function addDays(date, n) {
  const p = parse(date)
  if (!p) return ''
  const t = new Date(Date.UTC(p.year, p.month - 1, p.day + n))
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}

/** 星期几,0=周日 */
function weekday(date) {
  const p = parse(date)
  if (!p) return -1
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
}

/**
 * 底部快捷芯片。参考图给的是 Weekend / 3 nights / 1 week / 2 weeks(旅行语境),
 * 城瘾换成自己的语义:
 *   'weekend' 最近的周末(含今天;今天是周日就只剩今天)
 *   'next7'   今天起 7 天
 *   'month'   本月(1 号已过去就从今天起,不给一个点了没反应的芯片)
 *
 * @param min 可选下界;算出来早于 min 的一律抬到 min
 * @returns [start, end] | null(kind 不认识)
 */
function quickRange(kind, today, min) {
  const lift = (d) => (min && d < min ? min : d)
  if (kind === 'next7') {
    const s = lift(today)
    return [s, addDays(s, 6)]
  }
  if (kind === 'weekend') {
    const wd = weekday(today)
    if (wd < 0) return null
    // 0=周日:周末只剩今天这一天,不倒回上周六
    if (wd === 0) return [lift(today), lift(today)]
    const sat = addDays(today, (6 - wd + 7) % 7)
    return [lift(sat), lift(addDays(sat, 1))]
  }
  if (kind === 'month') {
    const p = parse(today)
    if (!p) return null
    const first = ymd(p.year, p.month, 1)
    const last = ymd(p.year, p.month, monthDays(p.year, p.month))
    const s = lift(first > today ? first : today)
    // min 已越过本月末:抬完 start 会得到 start > end 的倒置区间,
    // 「本月」这个语义已不成立,宁可不给也不给一段倒着的日子
    if (s > last) return null
    return [s, last]
  }
  return null
}

module.exports = {
  ymd,
  parse,
  monthDays,
  firstDayOffset,
  daysBetween,
  shiftMonth,
  dayType,
  buildMonth,
  buildMonths,
  pickRange,
  today,
  addDays,
  weekday,
  quickRange,
}
