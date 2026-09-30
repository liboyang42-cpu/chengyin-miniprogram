// FE-11 发布器日期时间纯函数。从 pages/publish/fabu/index.js 抽出:日期归一化/API 格式化/营业时间解析/时分格式化/日期列表生成。
// 无 wx / 无 this / 无副作用,可直接单测。逻辑与原 fabu 内联实现逐字一致。
// 页面读 this.data / setData 的部分由调用方保留(buildDateList 接收 today、返回纯数组,setData 仍在页面)。

// 归一化日期时间:纯日期补 defaultTime;带时分则规整为 "YYYY-MM-DD HH:mm:ss";解析不出返 null(= 原 _normalizeDateTime)。
function normalizeDateTime(v, defaultTime) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (m) return m[1] + ' ' + defaultTime;
  m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?/);
  if (m) return m[1] + ' ' + m[2] + ':' + (m[3] || '00');
  return null;
}

// 组装 API 提交用日期时间 "YYYY-MM-DD HH:mm:00"(= 原 formatDateTimeForAPI)。
//
// 2026-07-31 修时区 bug:原实现绕 `new Date(dateStr)` 再读 getFullYear/getMonth/getDate。
// dateStr 是 'YYYY-MM-DD' 这种纯日期串时,new Date() 按 UTC 午夜解析,而
// getFullYear/getMonth/getDate 是本地时区 getter——负偏移时区(如 UTC-7)下 UTC 午夜落到
// 本地前一天,day 少 1。所有调用方(fabu/activity/couponInfo 的日期选择器)传进来的都是
// 'YYYY-MM-DD' 纯日期串(来自 toISOString().split('T')[0] 或本函数同构的本地拼装),
// 压根不需要过 Date 对象,直接拆字符串重排即可,连时区问题的产生条件都不存在。
// 不是这个形状的输入(理论上不该出现,防御性保留)才退回 Date 解析,且改用 UTC getter——
// 和"先扔进 new Date() 走 UTC 解析"这条路径的语义保持一致,不会引入新的本地/UTC 错位。
function formatDateTimeForAPI(dateStr, hour, minute) {
  const hourStr = hour.toString().padStart(2, '0');
  const minuteStr = minute.toString().padStart(2, '0');

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]} ${hourStr}:${minuteStr}:00`;
  }

  const date = new Date(dateStr);
  const year = date.getUTCFullYear();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day} ${hourStr}:${minuteStr}:00`;
}

// 解析营业时间 "HH:mm-HH:mm" → {startHour,startMinute,endHour,endMinute};非法返 null(= 原 parseBusinessTime)。
function parseBusinessTime(businessTime) {
  if (!businessTime) return null;

  try {
    const parts = businessTime.split('-');
    if (parts.length !== 2) return null;

    const startParts = parts[0].split(':');
    const endParts = parts[1].split(':');

    if (startParts.length !== 2 || endParts.length !== 2) return null;

    return {
      startHour: parseInt(startParts[0]),
      startMinute: parseInt(startParts[1]),
      endHour: parseInt(endParts[0]),
      endMinute: parseInt(endParts[1])
    };
  } catch (error) {
    console.error('解析营业时间失败');
    return null;
  }
}

// 时分补零格式化 "HH:mm"(= 原 formatTime)。
function formatTime(hour, minute) {
  const formatNumber = n => n.toString().padStart(2, '0');
  return `${formatNumber(hour)}:${formatNumber(minute)}`;
}

// 从 today 起 31 天的日期选择列表(= 原 generateDateList 的纯计算部分;setData 仍留在页面)。
//
// 2026-07-31 修同一类时区 bug:原实现的 date 字段走 toISOString()(UTC),display/month/day
// 走本地 getMonth/getDate——正偏移时区(如 UTC+8)下,本地午夜到时区偏移那几个小时内
// (UTC+8 是 00:00-08:00),UTC 还停在前一天,date 字段就会比 display/month/day 慢一天。
// 改成 date 字段也用本地 getter 拼,四个字段单一真源,不会互相对不上。
function buildDateList(today) {
  const dateList = [];

  for (let i = 0; i < 31; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);

    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

    dateList.push({
      date: dateStr,
      display: `${month}月${day}日`,
      month: month,
      day: day
    });
  }

  return dateList;
}

module.exports = {
  normalizeDateTime: normalizeDateTime,
  formatDateTimeForAPI: formatDateTimeForAPI,
  parseBusinessTime: parseBusinessTime,
  formatTime: formatTime,
  buildDateList: buildDateList,
};
