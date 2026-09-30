// 本地足迹边缘提示：只挑最近一场已保存足迹的末端点作地图高亮。
// 它不生成路线、不调用服务端、不把坐标写进文案或埋点。

const { geohash7, m2lat, m2lng } = require('./roam-geo.js');

function isPoint(point) {
  return !!point && Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng))
    && Math.abs(Number(point.lat)) <= 90 && Math.abs(Number(point.lng)) <= 180;
}

function hasUnexploredNeighbor(point, revealedTiles) {
  if (!revealedTiles || !Object.keys(revealedTiles).length) return false;
  const dLat = m2lat(160);
  const dLng = m2lng(160, point.lat);
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  return offsets.some(([latFactor, lngFactor]) => !revealedTiles[
    geohash7(point.lat + dLat * latFactor, point.lng + dLng * lngFactor)
  ]);
}

function buildFootprintHint(sessions, currentPoint, revealedTiles) {
  if (!Array.isArray(sessions) || !isPoint(currentPoint)) return null;
  let latest = null;
  sessions.forEach((session) => {
    const track = Array.isArray(session && session.track) ? session.track.filter(isPoint) : [];
    if (!track.length) return;
    if (!latest || Number(session.ts || 0) > Number(latest.session.ts || 0)) latest = { session, track };
  });
  if (!latest) return null;

  const edge = latest.track[latest.track.length - 1];
  if (!hasUnexploredNeighbor(edge, revealedTiles)) return null;
  return {
    point: { lat: Number(edge.lat), lng: Number(edge.lng) },
    // 固定中性文案：不得包含方向、路线、坐标或下一步行动指令。
    text: '上次的足迹边缘仍留在这里；附近还有尚未点亮的区域。',
  };
}

module.exports = { buildFootprintHint };
