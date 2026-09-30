const test = require('node:test');
const assert = require('node:assert');

const {
  parseRatio,
  baseScaleOf,
  clampTransform,
  computeCropRect,
  MIN_SCALE,
  MAX_SCALE,
} = require('../../pages/crop/utils/crop-geometry');

// ---- parseRatio:微信 cropScale 字面量 → 数值宽高比 ----
test('parseRatio 解析合法比例', () => {
  assert.strictEqual(parseRatio('1:1'), 1);
  assert.strictEqual(parseRatio('16:9'), 16 / 9);
  assert.strictEqual(parseRatio('3:4'), 3 / 4);
  assert.strictEqual(parseRatio('4:5'), 4 / 5);
});

test('parseRatio 对自由比例/非法值返回 null(调用方据此用原图比例)', () => {
  assert.strictEqual(parseRatio('free'), null);
  assert.strictEqual(parseRatio(''), null);
  assert.strictEqual(parseRatio(undefined), null);
  assert.strictEqual(parseRatio('1:0'), null);
  assert.strictEqual(parseRatio('abc'), null);
});

// ---- baseScale:图片 cover 满裁剪框的基准缩放 ----
test('baseScale 取长边比 —— 竖图配方框时以宽为准', () => {
  // 1000x2000 竖图,放进 300x300 方框:宽 300/1000=0.3,高 300/2000=0.15,取大者 0.3(cover)
  assert.strictEqual(baseScaleOf(1000, 2000, 300, 300), 0.3);
});

test('baseScale 横图配方框时以高为准', () => {
  assert.strictEqual(baseScaleOf(2000, 1000, 300, 300), 0.3);
});

// ---- clampTransform:缩放与位移边界 ----
test('clampTransform 缩放下限为 1(不允许缩到露出黑边)', () => {
  const r = clampTransform({ imgW: 1000, imgH: 1000, frameW: 300, frameH: 300, scale: 0.5, x: 0, y: 0 });
  assert.strictEqual(r.scale, MIN_SCALE);
  assert.strictEqual(MIN_SCALE, 1);
});

test('clampTransform 缩放有上限,防止无限放大糊成马赛克', () => {
  const r = clampTransform({ imgW: 1000, imgH: 1000, frameW: 300, frameH: 300, scale: 99, x: 0, y: 0 });
  assert.strictEqual(r.scale, MAX_SCALE);
});

test('clampTransform 方图方框、scale=1 时位移锁死为 0(没有可拖动余量)', () => {
  const r = clampTransform({ imgW: 1000, imgH: 1000, frameW: 300, frameH: 300, scale: 1, x: 50, y: -80 });
  assert.strictEqual(r.x, 0);
  assert.strictEqual(r.y, 0);
});

test('clampTransform 竖图方框 scale=1 时可上下拖、不可左右拖', () => {
  // 1000x2000 → base 0.3 → 渲染 300x600;方框 300x300;纵向余量 (600-300)/2=150
  const r = clampTransform({ imgW: 1000, imgH: 2000, frameW: 300, frameH: 300, scale: 1, x: 40, y: 400 });
  assert.strictEqual(r.x, 0, '横向无余量,必须锁 0');
  assert.strictEqual(r.y, 150, '纵向余量 150,超出即夹到边界');
});

test('clampTransform 放大后横向出现余量', () => {
  // scale=2 → 渲染 600x1200;方框 300 → 横向余量 (600-300)/2=150
  const r = clampTransform({ imgW: 1000, imgH: 2000, frameW: 300, frameH: 300, scale: 2, x: 999, y: -999 });
  assert.strictEqual(r.x, 150);
  assert.strictEqual(r.y, -450); // (1200-300)/2 = 450
});

// ---- computeCropRect:导出时的源图裁剪矩形 ----
test('computeCropRect 方图方框未变换时裁全图', () => {
  const r = computeCropRect({ imgW: 1000, imgH: 1000, frameW: 300, frameH: 300, scale: 1, x: 0, y: 0 });
  assert.deepStrictEqual(r, { sx: 0, sy: 0, sw: 1000, sh: 1000 });
});

test('computeCropRect 竖图方框居中时裁中段,尺寸按短边', () => {
  // 1000x2000,方框 → 裁 1000x1000,垂直居中 → sy = (2000-1000)/2 = 500
  const r = computeCropRect({ imgW: 1000, imgH: 2000, frameW: 300, frameH: 300, scale: 1, x: 0, y: 0 });
  assert.deepStrictEqual(r, { sx: 0, sy: 500, sw: 1000, sh: 1000 });
});

test('computeCropRect 向下拖到顶(y 为正=图片下移)时裁图片顶部', () => {
  // y=+150 是纵向边界,图片下移到底 → 露出的是图片顶部 → sy=0
  const r = computeCropRect({ imgW: 1000, imgH: 2000, frameW: 300, frameH: 300, scale: 1, x: 0, y: 150 });
  assert.deepStrictEqual(r, { sx: 0, sy: 0, sw: 1000, sh: 1000 });
});

test('computeCropRect 向上拖到底时裁图片底部', () => {
  const r = computeCropRect({ imgW: 1000, imgH: 2000, frameW: 300, frameH: 300, scale: 1, x: 0, y: -150 });
  assert.deepStrictEqual(r, { sx: 0, sy: 1000, sw: 1000, sh: 1000 });
});

test('computeCropRect 放大后裁剪范围随之变小', () => {
  // scale=2 → sw = 1000/2 = 500,居中 → sx=(1000-500)/2=250
  const r = computeCropRect({ imgW: 1000, imgH: 1000, frameW: 300, frameH: 300, scale: 2, x: 0, y: 0 });
  assert.deepStrictEqual(r, { sx: 250, sy: 250, sw: 500, sh: 500 });
});

test('computeCropRect 16:9 框裁竖图', () => {
  // frame 300x168.75(16:9);1000x2000 图 → base=max(300/1000, 168.75/2000)=0.3 → 渲染 300x600
  // sw = 300/0.3 = 1000;sh = 168.75/0.3 = 562.5;居中 sy=(2000-562.5)/2=718.75
  const r = computeCropRect({ imgW: 1000, imgH: 2000, frameW: 300, frameH: 168.75, scale: 1, x: 0, y: 0 });
  assert.strictEqual(r.sx, 0);
  assert.strictEqual(r.sw, 1000);
  assert.ok(Math.abs(r.sh - 562.5) < 1e-6);
  assert.ok(Math.abs(r.sy - 718.75) < 1e-6);
});

test('computeCropRect 永不越界:夹住浮点误差导致的负值/超宽', () => {
  const r = computeCropRect({ imgW: 1000, imgH: 2000, frameW: 300, frameH: 300, scale: 1, x: 1e6, y: 1e6 });
  assert.ok(r.sx >= 0 && r.sy >= 0, '源坐标不得为负');
  assert.ok(r.sx + r.sw <= 1000 + 1e-6, '不得超出源图宽');
  assert.ok(r.sy + r.sh <= 2000 + 1e-6, '不得超出源图高');
});

test('computeCropRect 输入非法尺寸时返回 null,由调用方兜底原图', () => {
  assert.strictEqual(computeCropRect({ imgW: 0, imgH: 100, frameW: 10, frameH: 10, scale: 1, x: 0, y: 0 }), null);
  assert.strictEqual(computeCropRect({ imgW: 100, imgH: 100, frameW: 0, frameH: 10, scale: 1, x: 0, y: 0 }), null);
});
