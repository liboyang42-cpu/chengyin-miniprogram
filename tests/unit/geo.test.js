const { test } = require('node:test');
const assert = require('node:assert');
const { haversine, bizWindowState, distanceText } = require('../../utils/geo.js');

test('haversine: 同点距离为 0', () => {
  assert.strictEqual(haversine(31.23, 121.47, 31.23, 121.47), 0);
});

test('haversine: 对称(A→B == B→A)', () => {
  const ab = haversine(31.0, 121.0, 31.1, 121.1);
  const ba = haversine(31.1, 121.1, 31.0, 121.0);
  assert.ok(Math.abs(ab - ba) < 1e-6);
});

test('haversine: 1 度纬度 ≈ 111.2km(误差 <0.5%)', () => {
  const d = haversine(31.0, 121.0, 32.0, 121.0);
  assert.ok(Math.abs(d - 111195) < 111195 * 0.005, `实际 ${d}m`);
});

test('haversine: 上海人民广场→外滩 ≈ 2.5km 量级(1.5~4km)', () => {
  const d = haversine(31.2304, 121.4737, 31.2397, 121.4900);
  assert.ok(d > 1500 && d < 4000, `实际 ${d}m`);
});

test('bizWindowState: 正常窗内/窗外', () => {
  assert.strictEqual(bizWindowState('09:00-18:00', 12 * 60), true);   // 12:00 在内
  assert.strictEqual(bizWindowState('09:00-18:00', 8 * 60), false);   // 08:00 在外
  assert.strictEqual(bizWindowState('09:00-18:00', 20 * 60), false);  // 20:00 在外
});

test('bizWindowState: 边界含端点', () => {
  assert.strictEqual(bizWindowState('09:00-18:00', 9 * 60), true);    // 09:00 含
  assert.strictEqual(bizWindowState('09:00-18:00', 18 * 60), true);   // 18:00 含
});

test('bizWindowState: 跨夜窗(22:00-02:00)', () => {
  assert.strictEqual(bizWindowState('22:00-02:00', 23 * 60), true);   // 23:00 在内
  assert.strictEqual(bizWindowState('22:00-02:00', 1 * 60), true);    // 01:00 在内
  assert.strictEqual(bizWindowState('22:00-02:00', 12 * 60), false);  // 12:00 在外
});

test('bizWindowState: 多种分隔符 - ~ — 至', () => {
  for (const sep of ['-', '~', '—', '至']) {
    assert.strictEqual(bizWindowState('09:00' + sep + '18:00', 12 * 60), true, `分隔符 ${sep}`);
  }
});

test('bizWindowState: 空/解析不出 → null(不加不减)', () => {
  assert.strictEqual(bizWindowState('', 600), null);
  assert.strictEqual(bizWindowState(null, 600), null);
  assert.strictEqual(bizWindowState('全天营业', 600), null);
});

test('distanceText: 米/公里分档', () => {
  assert.strictEqual(distanceText(320), '320 米');
  assert.strictEqual(distanceText(1500), '1.5 公里');
  assert.strictEqual(distanceText(null), '');
});
