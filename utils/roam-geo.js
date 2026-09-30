// 漫游(City Fog)本地地理数学:geohash 编解码 + 米↔经纬度 + 平面近似距离。
// 纯函数、无 wx / 无 this,从 pages/roam/index.js 抽出并加单测。
// 注意:distM 是**平面近似**(equirectangular,111320m/度),用于本地短距/迷雾网格,
//       不是球面 haversine;需要跨城/长距精度请用 utils/geo.js 的 haversine。

const GEO32 = '0123456789bcdefghjkmnpqrstuvwxyz';

// 7 位 geohash 编码(经纬交替二分,与 geohashDecode7 互逆)。
function geohash7(lat, lng) {
  let latR0 = -90, latR1 = 90, lngR0 = -180, lngR1 = 180;
  let hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < 7) {
    if (even) {
      const mid = (lngR0 + lngR1) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngR0 = mid; } else { ch = ch << 1; lngR1 = mid; }
    } else {
      const mid = (latR0 + latR1) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latR0 = mid; } else { ch = ch << 1; latR1 = mid; }
    }
    even = !even;
    if (++bit === 5) { hash += GEO32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

// 7 位 geohash 解码 → 格中心 {lat,lng};非法输入返回 null。
function geohashDecode7(hash) {
  if (!hash || hash.length < 7) return null;
  let latR0 = -90, latR1 = 90, lngR0 = -180, lngR1 = 180, even = true;
  for (let i = 0; i < 7; i++) {
    const idx = GEO32.indexOf(hash[i]);
    if (idx < 0) return null;
    for (let bit = 4; bit >= 0; bit--) {
      const mask = 1 << bit;
      if (even) {
        const mid = (lngR0 + lngR1) / 2;
        if (idx & mask) lngR0 = mid; else lngR1 = mid;
      } else {
        const mid = (latR0 + latR1) / 2;
        if (idx & mask) latR0 = mid; else latR1 = mid;
      }
      even = !even;
    }
  }
  return { lat: (latR0 + latR1) / 2, lng: (lngR0 + lngR1) / 2 };
}

function m2lat(m) { return m / 111320; }
function m2lng(m, lat) { return m / (111320 * Math.cos(lat * Math.PI / 180)); }

// 平面近似距离(米)。a/b = {lat,lng}。本地短距用,非球面。
function distM(a, b) {
  const dy = (b.lat - a.lat) * 111320;
  const dx = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dx, dy);
}

module.exports = { geohash7, geohashDecode7, m2lat, m2lng, distM };
