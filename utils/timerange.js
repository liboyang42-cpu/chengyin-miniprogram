/**
 * utils/timerange.js —— 时段跨度的计算(2026-08-26)
 *
 * ⚠️ 这里**不重复** utils/time-picker-options.js 已有的东西:
 * 滚轮选项(HOURS/MINUTES/minuteOptions)、`HH:mm` 格式化(formatHM)、
 * 一天内的分钟序号(minutesOfDay)、结束是否晚于开始(isEndAfterStart)都在那边,
 * 本文件只加它没有的三件:
 *   ① 'HH:mm' 字符串 ↔ 分钟数的互转(那边的接口是 {hour, minute} 对象,
 *      而页面上存的是 'HH:mm' 字符串,如 serviceStartTime / startText);
 *   ② **跨天**的跨度(22:00→02:00 = 240 分钟)—— isEndAfterStart 明确声明不适用跨夜;
 *   ③ 时长上下限的判定(play/celebrate 那条「120—210 分钟」原来只是旁边一行说明,
 *      没有任何地方算过)。
 */

const opts = require('./time-picker-options.js')

/** 'HH:mm' → 当天第几分钟;非法返回 -1(不是 0 —— 0 是合法的 00:00) */
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
  if (!m) return -1
  const h = +m[1]
  const min = +m[2]
  if (h > 23 || min > 59) return -1
  return opts.minutesOfDay(h, min)
}

/** 分钟数 → 'HH:mm';超出一天的部分取模(跨天场景下 26:00 要显示成 02:00) */
function fromMinutes(total) {
  if (!(total >= 0)) return ''
  const t = Math.floor(total) % 1440
  return opts.formatHM(Math.floor(t / 60), t % 60)
}

/**
 * 时段跨了多少分钟。
 * @param allowCross 允许跨天:结束早于开始时视为次日(22:00→02:00 = 240 分钟)。
 *   ⚠️ time-picker-options 的 isEndAfterStart 明确写了「跨夜不适用」,所以跨夜语义只在这里。
 * @returns 分钟数;算不出返回 -1。不返回 0 兜底 —— 0 是「起止同一刻」这个合法答案
 */
function spanMinutes(start, end, allowCross) {
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s < 0 || e < 0) return -1
  // ⚠️ 同一刻必须先判,而且要判在 allowCross 之前:否则 09:00→09:00 会走进跨天分支
  // 被算成整整 1440 分钟(「选了同一个时刻」被解释成「通宵 24 小时」)。
  if (e === s) return 0
  if (e > s) return e - s
  if (allowCross) return 1440 - s + e
  return -1
}

/** 'N 小时 M 分',整点省掉分,不足一小时只说分 */
function formatSpan(minutes) {
  if (!(minutes > 0)) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return m + ' 分钟'
  return h + ' 小时' + (m ? ' ' + m + ' 分' : '')
}

/**
 * 校验一个时段。**只判定,不修改** —— 越界时把事实原样返回,由调用方决定文案与去留;
 * 自动夹到合法值是「替用户断定」。
 *
 * @param opts_ { allowCross, minMinutes, maxMinutes }
 * @returns { ok, minutes, reason }
 *   reason: 'invalid' 格式不对 | 'not-after' 结束不晚于开始 | 'too-short' | 'too-long'
 */
function validate(start, end, opts_) {
  const o = opts_ || {}
  const minutes = spanMinutes(start, end, o.allowCross)
  if (minutes < 0) {
    return {
      ok: false,
      minutes: -1,
      reason: toMinutes(start) < 0 || toMinutes(end) < 0 ? 'invalid' : 'not-after',
    }
  }
  if (minutes === 0) return { ok: false, minutes: 0, reason: 'not-after' }
  if (o.minMinutes > 0 && minutes < o.minMinutes) {
    return { ok: false, minutes: minutes, reason: 'too-short' }
  }
  if (o.maxMinutes > 0 && minutes > o.maxMinutes) {
    return { ok: false, minutes: minutes, reason: 'too-long' }
  }
  return { ok: true, minutes: minutes, reason: '' }
}

/**
 * 'HH:mm' → picker-view 的 [小时下标, 分钟下标]。
 * 映射本身走 time-picker-options 的 minuteIndex,这里只做字符串解析那一层。
 */
function toIndex(hhmm, step) {
  const total = toMinutes(hhmm)
  if (total < 0) return [0, 0]
  return [Math.floor(total / 60), opts.minuteIndex(total % 60, step)]
}

/** picker-view 的 [小时下标, 分钟下标] → 'HH:mm' */
function fromIndex(index, step) {
  const i = index || []
  return opts.formatHM(Number(i[0]) || 0, opts.minuteAt(i[1], step))
}

module.exports = {
  toMinutes,
  fromMinutes,
  spanMinutes,
  formatSpan,
  validate,
  toIndex,
  fromIndex,
}
