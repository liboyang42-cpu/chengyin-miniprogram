// 游玩页 P0 推荐评分(自由定向"下一处发现")。纯函数,从 pages/play/index.js 抽出并加单测。
// score = 距离分(近优) + 营业窗分(在窗 +0.3 / 不在 -0.8 / 未知 0) + 顺路分(与上一段方向夹角余弦 ×0.25)。
// 依赖 utils/geo 的 haversine(球面距离)与 bizWindowState(营业窗,时间由调用方传入)。

const geo = require('../../../utils/geo.js');

// nodes: 全部节点(含 done/doneAt/nodeId/lat/lng);pts: 节点在地图上的像素点[{px,py}](与 nodes 同序);
// undone: 待推荐候选 [{x: node, i: 节点下标}];loc: 当前 GPS {latitude,longitude} 或 null;
// nowMinutes: 当前「当日分钟数」(0-1439)。返回按 score 降序的候选 [{x,i,score,reason}]。
function scoreCandidates(nodes, pts, undone, loc, nowMinutes) {
  pts = pts || [];
  const doneSorted = nodes.filter((n) => n.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const last = doneSorted[0] || null;             // 最近完成点=出发参照
  const prev = doneSorted[1] || null;             // 上一段方向参照
  const oi = last ? nodes.findIndex((n) => n.nodeId === last.nodeId) : -1;
  const opt = (oi >= 0 ? pts[oi] : pts[0]) || { px: 300, py: 1000 };
  const pi = prev ? nodes.findIndex((n) => n.nodeId === prev.nodeId) : -1;
  const ppt = pi >= 0 ? pts[pi] : null;
  const scored = undone.map((o) => {
    const pt = pts[o.i] || { px: 0, py: 0 };
    // 距离:有 GPS 用真实米,否则退像素距离
    let dm = null;
    if (loc && o.x.lat && o.x.lng) dm = geo.haversine(loc.latitude, loc.longitude, o.x.lat, o.x.lng);
    else if (last && last.lat && last.lng && o.x.lat && o.x.lng) dm = geo.haversine(last.lat, last.lng, o.x.lat, o.x.lng);
    const dpx = Math.sqrt((pt.px - opt.px) ** 2 + (pt.py - opt.py) ** 2);
    const distScore = dm != null ? 1 / (1 + dm / 500) : 1 / (1 + dpx / 300);
    const biz = geo.bizWindowState(o.x.businessTime, nowMinutes);
    const bizScore = biz === false ? -0.8 : (biz === true ? 0.3 : 0);
    let dirScore = 0;
    if (ppt) {
      const v1x = opt.px - ppt.px, v1y = opt.py - ppt.py, v2x = pt.px - opt.px, v2y = pt.py - opt.py;
      const m = Math.sqrt(v1x * v1x + v1y * v1y) * Math.sqrt(v2x * v2x + v2y * v2y);
      if (m > 0) dirScore = 0.25 * ((v1x * v2x + v1y * v2y) / m);
    }
    const reason = biz === false ? '可能不在营业时间 · 看看别处?'
      : (dm != null ? ('离你约 ' + geo.distanceText(dm) + (biz === true ? ' · 营业中' : ''))
        : '顺路的下一处发现');
    return { x: o.x, i: o.i, score: distScore + bizScore + dirScore, reason };
  });
  return scored.sort((a, b) => b.score - a.score);
}

module.exports = { scoreCandidates };
