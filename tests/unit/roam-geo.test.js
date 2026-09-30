const { test } = require('node:test');
const assert = require('node:assert');
const { geohash7, geohashDecode7, m2lat, m2lng, distM } = require('../../utils/roam-geo.js');

test('geohash7: 长度恒为 7', () => {
  assert.strictEqual(geohash7(31.2304, 121.4737).length, 7);
  assert.strictEqual(geohash7(-33.8, 151.2).length, 7);
});

test('geohash7: 确定性(同输入同输出)', () => {
  assert.strictEqual(geohash7(31.2304, 121.4737), geohash7(31.2304, 121.4737));
});

test('geohash 编解码往返:解码回来落在原点附近(7位精度 <200m)', () => {
  const lat = 31.2304, lng = 121.4737;
  const back = geohashDecode7(geohash7(lat, lng));
  assert.ok(back, '解码非空');
  const err = distM({ lat, lng }, back);
  assert.ok(err < 200, `往返误差 ${err.toFixed(1)}m 应 <200m`);
});

test('geohashDecode7: 非法输入 → null', () => {
  assert.strictEqual(geohashDecode7(''), null);
  assert.strictEqual(geohashDecode7('abc'), null);      // 太短
  assert.strictEqual(geohashDecode7('aaaaaaa'), null);  // 'a' 不在 geohash32 字母表
});

test('相邻两点 geohash 前缀相同(邻近性)', () => {
  const h1 = geohash7(31.2304, 121.4737);
  const h2 = geohash7(31.2305, 121.4738); // ~15m 外
  assert.strictEqual(h1.slice(0, 5), h2.slice(0, 5), '前 5 位应相同');
});

test('m2lat / m2lng: 111320m/度基准', () => {
  assert.ok(Math.abs(m2lat(111320) - 1) < 1e-9);
  // 同样米数,纬度越高换算出的经度「度数」越大(经线向两极收敛)
  assert.ok(m2lng(111320, 60) > m2lng(111320, 0));
});

test('distM: 同点 0 + 正值(平面近似,以首点纬度为锚,故非严格对称)', () => {
  const a = { lat: 31.23, lng: 121.47 }, b = { lat: 31.24, lng: 121.48 };
  assert.strictEqual(distM(a, a), 0);
  assert.ok(distM(a, b) > 0);
  // 近距离(<2km)锚点差异带来的不对称应很小(<1m)
  assert.ok(Math.abs(distM(a, b) - distM(b, a)) < 1);
});

test('distM: 1 度纬度 ≈ 111320m(平面近似)', () => {
  const d = distM({ lat: 31.0, lng: 121.0 }, { lat: 32.0, lng: 121.0 });
  assert.ok(Math.abs(d - 111320) < 111320 * 0.01, `实际 ${d}m`);
});
