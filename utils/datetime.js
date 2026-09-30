// 后端时间字符串的统一解析工具。
//
// 病根:后端下发的是不带时区的 "YYYY-MM-DD HH:MM:SS"(语义是中国时间,业务只服务中国用户)。
// `new Date(str.replace(/-/g,'/'))` 会按【运行环境本地时区】解析——手机时区不是 UTC+8 时
// (出国、手机时区设错、CI 跑在 UTC)就会整体偏移 8 小时。
//
// ⚠️ 两类用法,处置完全不同,改错方向会把原本正确的代码改坏:
//   A 类 纯展示:解析后又用 getHours()/getMonth() 等【本地】方法格式化再显示。
//       本地解析 + 本地格式化成对抵消,显示结果本来就是对的 —— 【不要用本工具去改它】,
//       只把解析一侧锚定而格式化一侧不动,反而会让 UTC 用户看到 10:00 显示成 02:00。
//   B 类 比较/倒计时/过期判断:与 Date.now() 比大小、算差值、判断已开始/已结束。
//       这类必须用 toTimestamp() 锚定,否则会静默显示错误状态。
//
// ⚠️ B 类里还要再分一层:比较"两个瞬时谁先谁后"用 toTimestamp() 就够;
//   但比较"算不算同一个自然日"(今天/昨天/本月)时,即使瞬时锚定对了,再用
//   getDate()/toDateString()/setHours(0,0,0,0) 取出来的仍是【运行环境本地日历】字段。
//   中国 7-26 02:00 在 UTC 是 7-25 18:00,"今天"照样判错 —— 这类要用 chinaDateKey()。

var CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

function isValidCalendar(y, mo, d, h, mi, s) {
  if (mo < 1 || mo > 12) return false;
  var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  var maxDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d < 1 || d > maxDay) return false;
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && s >= 0 && s <= 59;
}

// Date 能表示的瞬时范围(±8.64e15 ms); 超范围的有限数字不得产出 NaN 文案, 直接失败关闭。
function isValidEpoch(ts) {
  return isFinite(ts) && !isNaN(new Date(ts).getTime());
}

function pad2(n) { return String(n).length < 2 ? '0' + n : String(n); }

// 裸串/date-only: 语义为中国时间, 支持 - 或 / 分隔、可选 时:分[:秒[.毫秒]];
// 严格校验日历(如 2026-02-30 拒绝)后补 +08:00。
function parseChinaString(str) {
  var match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d{1,9})?)?)?$/);
  if (!match) return NaN;
  var y = Number(match[1]); var mo = Number(match[2]); var d = Number(match[3]);
  var h = match[4] ? Number(match[4]) : 0;
  var mi = match[5] ? Number(match[5]) : 0;
  var s = match[6] ? Number(match[6]) : 0;
  if (!isValidCalendar(y, mo, d, h, mi, s)) return NaN;
  var ts = Date.parse(match[1] + '-' + pad2(mo) + '-' + pad2(d) + 'T' + pad2(h) + ':' + pad2(mi) + ':' + pad2(s) + '+08:00');
  return isValidEpoch(ts) ? ts : NaN;
}

// 带偏移 ISO: 同样严格校验真实日历与时分秒(不能只交给 Date.parse, 否则 2026-02-30 会滚成 3 月 2 日)。
function parseOffsetIso(str) {
  var match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d\d:?\d\d)$/i);
  if (!match) return NaN;
  var y = Number(match[1]); var mo = Number(match[2]); var d = Number(match[3]);
  var h = Number(match[4]); var mi = Number(match[5]);
  var s = match[6] ? Number(match[6]) : 0;
  if (!isValidCalendar(y, mo, d, h, mi, s)) return NaN;
  var ts = Date.parse(str.replace(' ', 'T'));
  return isValidEpoch(ts) ? ts : NaN;
}

/**
 * 把后端时间解析成绝对时刻(epoch 毫秒), 不依赖运行环境时区。
 * 统一严格合同: 只接受 Date、有限正数、精确 10/13 位数字字符串、带偏移 ISO、严格合法日历串;
 * 10 位秒统一 ×1000; 0 哨兵/布尔/数组/对象/非法日历/非法时分秒/超 Date 范围一律失败关闭(NaN);
 * 负有限数按合法历史瞬时保留。已带时区标记(Z / +08:00 / -05:00)的字符串保持原样, 不重复锚定。
 */
function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return NaN;
  if (value instanceof Date) {
    var dts = value.getTime();
    return isValidEpoch(dts) ? dts : NaN;
  }
  if (typeof value === 'number') {
    if (!isFinite(value) || value === 0) return NaN;
    var nms = (Math.floor(value) === value && value > 0 && String(value).length === 10) ? value * 1000 : value;
    return isValidEpoch(nms) ? nms : NaN;
  }
  if (typeof value !== 'string') return NaN;
  var str = value.trim();
  if (!str) return NaN;
  if (/^\d{10}$/.test(str)) {
    var ms10 = Number(str) * 1000;
    return isValidEpoch(ms10) ? ms10 : NaN;
  }
  if (/^\d{13}$/.test(str)) {
    var ms13 = Number(str);
    return isValidEpoch(ms13) ? ms13 : NaN;
  }
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(str)) return parseOffsetIso(str);
  return parseChinaString(str);
}

/**
 * 取该时刻在【中国时区】下的日历日,返回 'YYYY-MM-DD'。
 * 实现不依赖运行环境时区:把瞬时 +8 小时后用 getUTC* 系列读字段。
 * 用它做"今天/昨天/同一天"比较,而不是 toDateString()/getDate()。
 */
function chinaDateKey(value) {
  var ts = toTimestamp(value);
  if (isNaN(ts)) return '';
  var d = new Date(ts + CHINA_OFFSET_MS);
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

/**
 * 券有效期展示口径:只显示到日,点分格式 'YYYY.MM.DD'(全站统一,区间写作 'A – B')。
 * 展示专用 —— **可用/过期判定仍用完整时间**(toTimestamp/chinaDateKey),不要拿它去比大小。
 * 入参沿用后端常见形式:裸串(中国时间语义)、带偏移 ISO、Date;认不出返回 ''。
 */
function formatDayDots(value) {
  var key = chinaDateKey(value);
  return key ? key.replace(/-/g, '.') : '';
}

/** 两个时刻在中国时区下是否同一天。 */
function isSameChinaDay(a, b) {
  var ka = chinaDateKey(a);
  return !!ka && ka === chinaDateKey(b);
}

/** 该时刻所在中国自然日的零点(epoch 毫秒)。替代 setHours(0,0,0,0)。 */
function chinaDayStart(value) {
  var key = chinaDateKey(value);
  if (!key) return NaN;
  return new Date(key + 'T00:00:00+08:00').getTime();
}

/** 该时刻所在中国自然日的末刻(epoch 毫秒),即当天 24:00 前 1 毫秒。 */
function chinaDayEnd(value) {
  var start = chinaDayStart(value);
  return isNaN(start) ? NaN : start + 24 * 60 * 60 * 1000 - 1;
}

/**
 * 取该时刻在【中国时区】下的日历字段,不依赖运行环境时区。
 * 给"既要比较又要显示"的混合场景用(如 IM 的"今天 14:30 / 昨天 / 周三"):
 * 一旦用 toTimestamp 锚定了瞬时,显示也必须用这里的字段,不能再用 getHours() 等本地方法,
 * 否则 UTC 环境下会把中国的 14:30 显示成 06:30。
 * @returns {{year:number,month:number,day:number,hours:number,minutes:number,weekday:number}}
 */
function chinaParts(value) {
  var ts = toTimestamp(value);
  if (isNaN(ts)) return null;
  var d = new Date(ts + CHINA_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    weekday: d.getUTCDay()
  };
}

module.exports = {
  toTimestamp: toTimestamp,
  chinaDateKey: chinaDateKey,
  isSameChinaDay: isSameChinaDay,
  chinaDayStart: chinaDayStart,
  chinaDayEnd: chinaDayEnd,
  chinaParts: chinaParts,
  formatDayDots: formatDayDots
};
