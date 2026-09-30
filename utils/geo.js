// 纯地理/时间工具(无 wx / 无 this / 无副作用,可直接单测)。
// 从 pages/play/index.js 抽出并共享,roam/searchmap/activity 可复用同一份,避免各写各的距离公式。

// 两点球面距离(米)。Haversine,地球半径 R=6371000m。
function haversine(la1, lo1, la2, lo2) {
  const R = 6371000, rad = (x) => x * Math.PI / 180;
  const dLa = rad(la2 - la1), dLo = rad(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// 营业时间窗判定:解析 "HH:mm-HH:mm"(分隔符支持 - ~ — 至,支持跨夜窗如 22:00-02:00)。
// nowMinutes = 当前「当日分钟数」(0-1439),由调用方传入(便于单测,不在此处读 Date)。
// 返回:true 在窗内 / false 在窗外 / null 解析不出(调用方据此不加不减)。
function bizWindowState(bt, nowMinutes) {
  if (!bt) return null;
  const m = String(bt).match(/(\d{1,2}):(\d{2})\s*[-~—至]\s*(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const a = (+m[1]) * 60 + (+m[2]), b = (+m[3]) * 60 + (+m[4]);
  return b >= a ? (nowMinutes >= a && nowMinutes <= b) : (nowMinutes >= a || nowMinutes <= b);
}

// 距离友好文案:>=1km 显示 "N.N 公里",否则 "N 米"。
function distanceText(meters) {
  if (meters == null) return '';
  return meters >= 1000 ? (meters / 1000).toFixed(1) + ' 公里' : Math.round(meters) + ' 米';
}

module.exports = { haversine, bizWindowState, distanceText };
