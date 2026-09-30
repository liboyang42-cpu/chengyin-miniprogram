'use strict';

// 迷雾持久化观感 + 羽化边缘:
// ① 历史 geohash7 格子(格宽~153m)重开后必须用 TILE_REVEAL_M(110m)大半径画,
//    否则相邻格心的 55m 圆互不相接,历史区退化成孤立圆点 —— 用户看到「点亮没保住」。
// ② _drawScreenFog 的揭示边缘用径向渐变羽化(FOG_FEATHER),不再是硬边贴纸圆。
//    判定半径不吃羽化(FOG_FEATHER 是渐变、软边不算「已揭开」),但**必须吃逐点 r** ——
//    历史格画出 110m 却按 55m 判定,55–110m 带里点 POI 会被静默 return、零反馈。
// ③ 逐点 r 三条渲染路径都要认(screen / overlay / poly),只有 screen 认 = 降级下连片失效。

const assert = require('assert');
const test = require('node:test');

const { projectRevealCircles, isPointRevealed } = require('../../utils/roam-screen-fog.js');

const REGION = {
  southwest: { latitude: 31.220, longitude: 121.460 },
  northeast: { latitude: 31.240, longitude: 121.480 },
};
const VIEWPORT = { width: 400, height: 400 };

test('projectRevealCircles 尊重逐点半径 r,并回退默认 radiusM', () => {
  const mid = { lat: 31.230, lng: 121.470 };
  const circles = projectRevealCircles(REGION, VIEWPORT, [
    { ...mid, r: 110 },
    { ...mid },
  ], 55);
  assert.strictEqual(circles.length, 2);
  assert.ok(Math.abs(circles[0].radiusX / circles[1].radiusX - 2) < 0.01, '110m 圆应是 55m 圆的 2 倍');
  assert.ok(Math.abs(circles[0].radiusY / circles[1].radiusY - 2) < 0.01);
});

test('负控:r 非法(0/负/NaN)不放大也不炸,按默认半径处理', () => {
  const mid = { lat: 31.230, lng: 121.470 };
  const circles = projectRevealCircles(REGION, VIEWPORT, [
    { ...mid, r: 0 }, { ...mid, r: -5 }, { ...mid, r: NaN },
  ], 55);
  assert.strictEqual(circles.length, 3);
  circles.forEach((c) => assert.ok(Math.abs(c.radiusX - circles[0].radiusX) < 1e-9, '非法 r 一律回退默认'));
});


test('isPointRevealed 认逐点 r：画多大就点得中多大(否则 55–110m 带静默吞点击)', () => {
  const tile = { lat: 31.230, lng: 121.470, r: 110 };
  const near = { lat: 31.230, lng: 121.470 };
  // 正东 ~80m：落在 55m 外、110m 内 —— 看得见就必须点得中
  const at80 = { lat: 31.230, lng: 121.470 + 80 * (1 / (111320 * Math.cos(31.230 * Math.PI / 180))) };
  assert.ok(isPointRevealed(at80, [tile], 55), '历史格 r=110 覆盖 80m 处，必须判为已揭开');
  assert.ok(!isPointRevealed(at80, [near], 55), '负控：没有 r 的普通轨迹点仍按 55m，80m 处判未揭开');
});

test('projectRevealCircles 的视口剔除按羽化后半径算(否则边缘羽化环被硬切)', () => {
  // 圆心在左边界外 1.3R 处：不放大会被剔掉，按 1.6 倍羽化则应保留
  const west = REGION.southwest.longitude, east = REGION.northeast.longitude;
  const lngPerPx = (east - west) / VIEWPORT.width;
  const r55px = projectRevealCircles(REGION, VIEWPORT, [{ lat: 31.230, lng: 121.470 }], 55)[0].radiusX;
  const offscreen = { lat: 31.230, lng: west - 1.3 * r55px * lngPerPx };
  assert.strictEqual(projectRevealCircles(REGION, VIEWPORT, [offscreen], 55).length, 0, '不传 feather 时按真实半径剔除');
  assert.strictEqual(projectRevealCircles(REGION, VIEWPORT, [offscreen], 55, 1.6).length, 1, '传 1.6 时羽化环仍会露进视口，必须保留');
});

// ---- 页面级:从真实入口验证 ----

let pageConfig;
global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  getUserID: () => 9,
  isDevEnv: () => false,
  sendRequest() {},
});

function loadRoamPage(storage) {
  global.wx = {
    env: { USER_DATA_PATH: '/tmp' },
    getStorageSync: (k) => (storage && storage[k]) || '',
    setStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getFileSystemManager: () => ({ writeFileSync() {}, unlink() {} }),
    createSelectorQuery: () => ({
      select: () => ({ fields: () => ({ exec: (cb) => cb([{ node: null }]) }) }),
    }),
  };
  global.Page = (config) => { pageConfig = config; };
  delete require.cache[require.resolve('../../pages/roam/index.js')];
  require('../../pages/roam/index.js');
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = (patch, cb) => { Object.assign(page.data, patch); if (cb) cb(); };
  return page;
}

test('_loadLocalHistory 给 roam_tiles 格子标 110m 大半径(重开连片,不退化成圆点)', () => {
  // wgs 附近一个 geohash7:直接用页面同款编码器造一格,保证解码必中
  const { geohash7 } = require('../../utils/roam-geo.js');
  const h = geohash7(31.2301, 121.4702);
  const page = loadRoamPage({
    'roam_memory_v1:9:tiles': { tiles: { [h]: 1 }, serverCursor: 8 },
    'roam_memory_v1:9:reveals': [{ lat: 31.2308, lng: 121.4708 }],
  });
  page._loadLocalHistory();
  const tilePt = page._historyReveals.find((p) => p.r);
  const trackPt = page._historyReveals.find((p) => !p.r);
  assert.ok(tilePt, '格子历史点必须存在且带 r');
  assert.strictEqual(tilePt.r, 110, '格子历史半径必须是 TILE_REVEAL_M(110m)');
  assert.ok(trackPt, '轨迹历史点保持无 r(用默认 REVEAL_M)');
});

test('_drawScreenFog 用径向渐变羽化擦除,且羽化倍率作用在缩放上', () => {
  const page = loadRoamPage({});
  const ops = { gradients: [], stops: [], scales: [], fillStyles: [] };
  const g = {
    save() {}, restore() {}, beginPath() {}, translate() {},
    clearRect() {}, fillRect() {},
    scale(x, y) { ops.scales.push([x, y]); },
    arc() {}, fill() { ops.fillStyles.push(this.fillStyle); },
    createRadialGradient(...a) {
      ops.gradients.push(a);
      return { _isGradient: true, addColorStop(off, color) { ops.stops.push([off, color]); } };
    },
  };
  page._fogScreenG = g;
  page._fogScreenSize = { width: 400, height: 400 };
  page._fogScreenCv = { toDataURL: () => 'data:image/png;base64,QUJD' };
  page._historyReveals = [];
  page._reveals = [{ lat: 31.230, lng: 121.470 }];
  page._drawScreenFog(REGION);

  assert.strictEqual(ops.gradients.length, 1, '每帧应创建一次羽化笔刷');
  // 渐变段:0 全擦 → 1/1.6 仍全擦 → 1 渐隐到 0
  assert.deepStrictEqual(ops.stops.map(([o]) => Number(o.toFixed(4))), [0, Number((1 / 1.6).toFixed(4)), 1]);
  assert.ok(/,0\)$/.test(ops.stops[2][1].replace(/\s/g, '')), '最外圈必须渐隐到透明');
  // 负控本体:圆的填充必须是渐变对象;退回 '#000000' 硬笔刷即红
  const circleFills = ops.fillStyles.filter((f) => f && f._isGradient);
  assert.strictEqual(circleFills.length, 1, '揭示圆必须用渐变笔刷填充,不许退回纯色硬边');
  // 缩放带上 FOG_FEATHER:画出的圆 = 投影半径 × 1.6
  const [projected] = projectRevealCircles(REGION, { width: 400, height: 400 }, page._reveals, 55);
  assert.ok(Math.abs(ops.scales[0][0] - projected.radiusX * 1.6) < 1e-6, '羽化倍率必须作用在 scale 上');
});

// ③ 逐点 r 必须三条渲染路径都认。只有 screen 认的话，overlay/poly 降级下
//    重开仍是互不相接的 55m 圆点 —— 正是本批要根治的症状，且降级路径没有任何报错。
test('_stampReveal(overlay 路径) 认逐点 r：110m 点画出的圆是 55m 点的 2 倍', () => {
  const page = loadRoamPage({});
  page._c = { lat: 31.230, lng: 121.470 };
  const radii = [];
  page._fogG = {
    globalCompositeOperation: '', fillStyle: '',
    beginPath() {}, fill() {},
    arc(px, py, r) { radii.push(r); },
  };
  page._stampReveal({ lat: 31.230, lng: 121.470, r: 110 }, 1);
  page._stampReveal({ lat: 31.230, lng: 121.470 }, 1);
  assert.strictEqual(radii.length, 2, '两次擦除都应真的画出来');
  assert.ok(Math.abs(radii[0] / radii[1] - 2) < 0.01, `110m 应是 55m 的 2 倍，实得 ${radii[0]}/${radii[1]}`);
});

test('_fogApplyReveal(poly 路径) 认逐点 r：80m 处的格子只有 r=110 才会变清', () => {
  const mkFog = () => {
    const HALF = 2500, CELL = 10, N = Math.ceil(HALF * 2 / CELL);
    const st = new Uint8Array(N * N); st.fill(255);
    return { HALF, CELL, N, st };
  };
  const cellAt = (F, xM, yM) => {
    const i = Math.floor((xM + F.HALF) / F.CELL);
    const j = Math.floor((yM + F.HALF) / F.CELL);
    return F.st[j * F.N + i];
  };
  const center = { lat: 31.230, lng: 121.470 };
  // 正东 80m：55m 圆够不着，110m 圆够得着
  const east80 = { lat: center.lat, lng: center.lng + 80 / (111320 * Math.cos(center.lat * Math.PI / 180)) };

  const page = loadRoamPage({});
  page._c = center;

  page._fog = mkFog();
  page._fogApplyReveal({ ...center, r: 110 });
  const withR = cellAt(page._fog, 80, 0);

  page._fog = mkFog();
  page._fogApplyReveal({ ...center });
  const withoutR = cellAt(page._fog, 80, 0);

  assert.ok(withR < 255, `r=110 必须把 80m 处的格子擦清，实得 ${withR}`);
  assert.strictEqual(withoutR, 255, `负控：没有 r 时按 55m，80m 处必须仍是满雾，实得 ${withoutR}`);
});
