// cy-date-field 的纯逻辑层(2026-08-25):日期/时间列的生成与「字符串 ↔ 列下标」互转。
//
// 抽出来是为了能直接单测 —— 组件里那层只负责把它接到 picker-view 上。
// 与原生 <picker mode="date"/"time"> 的值格式逐字一致:date='YYYY-MM-DD'、time='HH:mm',
// 迁移时调用方的 JS 处理器一行都不用改。
const { pad2 } = require('./time-picker-options.js');

const YEAR_SPAN_BACK = 1;   // 往前一年:补录昨天/去年末的场次
const YEAR_SPAN_FWD = 3;    // 往后三年:招商截止、券有效期都在这个跨度内

function clampInt(value, lo, hi) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();   // month 是 1-based,day=0 取上月末日
}

/** date 模式的三列。baseYear 由调用方传入(取当前年),不在这里读时钟 —— 便于测试。 */
function dateColumns(baseYear, year, month) {
  const years = [];
  for (let y = baseYear - YEAR_SPAN_BACK; y <= baseYear + YEAR_SPAN_FWD; y += 1) years.push(String(y));
  const months = [];
  for (let m = 1; m <= 12; m += 1) months.push(pad2(m));
  const days = [];
  const total = daysInMonth(year, month);
  for (let d = 1; d <= total; d += 1) days.push(pad2(d));
  return [years, months, days];
}

/** 'YYYY-MM-DD' → [yearIdx, monthIdx, dayIdx];解析不出来时落在 baseYear 当天 */
function dateToIndex(value, baseYear, fallback) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  const fb = fallback || { year: baseYear, month: 1, day: 1 };
  const year = m ? clampInt(m[1], baseYear - YEAR_SPAN_BACK, baseYear + YEAR_SPAN_FWD) : fb.year;
  const month = m ? clampInt(m[2], 1, 12) : fb.month;
  const day = m ? clampInt(m[3], 1, daysInMonth(year, month)) : fb.day;
  return {
    index: [year - (baseYear - YEAR_SPAN_BACK), month - 1, day - 1],
    year,
    month,
    day,
  };
}

function indexToDate(index, baseYear) {
  const year = baseYear - YEAR_SPAN_BACK + clampInt(index[0], 0, YEAR_SPAN_BACK + YEAR_SPAN_FWD);
  const month = clampInt(index[1], 0, 11) + 1;
  // 12月31日切到2月时下标会越界,必须夹到当月最后一天,不能拼出 2-31 这种不存在的日期
  const day = Math.min(clampInt(index[2], 0, 30) + 1, daysInMonth(year, month));
  return year + '-' + pad2(month) + '-' + pad2(day);
}

/** 'HH:mm' → [hourIdx, minuteIdx] */
function timeToIndex(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!m) return [0, 0];
  return [clampInt(m[1], 0, 23), clampInt(m[2], 0, 59)];
}

function indexToTime(index) {
  return pad2(clampInt(index[0], 0, 23)) + ':' + pad2(clampInt(index[1], 0, 59));
}

/** start='YYYY-MM-DD' 下限:选到更早的日期时夹回下限,与原生 picker 的 start 语义一致 */
function clampToStart(value, start) {
  if (!start) return value;
  return value < start ? start : value;
}

module.exports = {
  YEAR_SPAN_BACK,
  YEAR_SPAN_FWD,
  daysInMonth,
  dateColumns,
  dateToIndex,
  indexToDate,
  timeToIndex,
  indexToTime,
  clampToStart,
};
