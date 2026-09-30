// 时间滚轮选项与格式化的单一真源(2026-08-25)
//
// 收口前:5 个页面各造一份 24/60 的数组,格式还各不相同 ——
//   pages/topic/merchantapply、pages/publish/activity  时分都是裸数字  → 显示「9时」「0分」
//   subpackageMember/couponInfo                       时裸分补零      → 显示「9时」「05分」
//   pages/merchant/apply                              时分都补零      → 显示「09:00」
// 同一个 App 里同一件事三种样子。选项数组和格式化只留这一份。
//
// ⚠️ 默认分钟仍是 60 档(00–59)。步进会把 picker-view 的 index 与真实分钟解耦,
// 而既有 5 个调用方是营业时段、票务时间、优惠券有效期这类金额/履约相关的输入,
// 不能一起改。
// 2026-08-26:按上面预留的路子补了 minuteOptions(step) / minuteIndex / minuteAt 三件套 ——
// **既有调用方一行不动**(它们继续用 MINUTES 这个 60 档数组),只有新的 cy-time-range
// 显式传 step。index↔值的映射从此只有这一处实现。

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ⚠️ 这两个数组【必须是数字】,不能改成 '00'..'23' 字符串。
// 调用方拿 hours[index] 之后会做真算术:publish/activity 的
// `(startHour * 60) + startMinute` 在字符串下会变成字符串拼接(540 + '05' → '54005'),
// hours.indexOf(Number(x)) 也会全部落空。补零只在【展示层】做 —— 见 utils/time-format.wxs。
var HOURS = Array.from({ length: 24 }, function (_, i) { return i; });
var MINUTES = Array.from({ length: 60 }, function (_, i) { return i; });

/** 统一显示格式:HH:mm */
function formatHM(hour, minute) {
  return pad2(Number(hour) || 0) + ':' + pad2(Number(minute) || 0);
}

/** 一天内的分钟序号,用于比较起止先后 */
function minutesOfDay(hour, minute) {
  return (Number(hour) || 0) * 60 + (Number(minute) || 0);
}

/**
 * 结束是否严格晚于开始(同一天内)。
 * 跨夜场景(如 20:00–02:00)不适用本函数 —— 那种要由调用方显式声明「次日」语义。
 */
function isEndAfterStart(start, end) {
  if (!start || !end) return false;
  return minutesOfDay(end.hour, end.minute) > minutesOfDay(start.hour, start.minute);
}

/**
 * 分钟选项(按步进)。step 不合法一律退回 1 分钟 —— 不静默给一个奇怪的粒度,
 * 尤其 step=0 会让循环永不前进。
 * ⚠️ 与 MINUTES 一样返回【数字】,不是补零字符串:调用方会拿它做算术,补零只在展示层。
 */
function minuteOptions(step) {
  var s = step > 0 && step <= 60 ? Math.floor(step) : 1;
  var out = [];
  for (var m = 0; m < 60; m += s) out.push(m);
  return out;
}

/**
 * 分钟 → 该步进下的列下标。
 * ⚠️ 值不在列里(step=5 而分钟是 07)时取【最近的一格】。这会让显示与真值不一致,
 * 所以调用方拿到 index 之后必须用 minuteAt 反查回去当作新的真值,
 * 否则滚轮停在 05 而内部还记着 07,落库的就不是用户看到的那个时间。
 */
function minuteIndex(minute, step) {
  var col = minuteOptions(step);
  var target = Number(minute) || 0;
  var best = 0;
  for (var i = 1; i < col.length; i++) {
    if (Math.abs(col[i] - target) < Math.abs(col[best] - target)) best = i;
  }
  return best;
}

/** 列下标 → 分钟;越界回 0 而不是 undefined(undefined 会让下游算术变 NaN) */
function minuteAt(index, step) {
  var col = minuteOptions(step);
  var i = Number(index) || 0;
  return col[i] === undefined ? 0 : col[i];
}

module.exports = {
  pad2: pad2,
  HOURS: HOURS,
  MINUTES: MINUTES,
  formatHM: formatHM,
  minutesOfDay: minutesOfDay,
  isEndAfterStart: isEndAfterStart,
  minuteOptions: minuteOptions,
  minuteIndex: minuteIndex,
  minuteAt: minuteAt,
};
