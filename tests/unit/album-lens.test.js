// 相册全屏几何:照片一圈的透视投影 + 屏幕边缘固定玻璃的拉伸
const test = require('node:test');
const assert = require('node:assert/strict');
const { offsetOf, cardColumns, lensColumns } = require('../../pages/play/utils/album-lens.js');

const geom = { cx: 375, cy: 450, cardW: 420, cardH: 620, sideX: 420, P: 640, radius: 0 };

test('首尾相接:第一张的左边是最后一张', () => {
  assert.equal(offsetOf(3, 0, 4), -1);
  assert.equal(offsetOf(1, 0, 4), 1);
  assert.equal(offsetOf(1, 0.5, 4), 0.5);
});

test('中间那张正对:宽高原样,取样从左到右', () => {
  const cols = cardColumns(Object.assign({ o: 0 }, geom));
  assert.equal(cols.length, 421);
  assert.equal(Math.round(cols[0].dh), 620);
  assert.ok(cols[0].u01 < cols[cols.length - 1].u01);
});

test('右边那张翻过 90° 成镜像,外沿朝镜头张开;隔一张的不画', () => {
  const cols = cardColumns(Object.assign({ o: 1 }, geom));
  assert.ok(cols.length > 0 && cols[0].dx > 375, '在右边');
  assert.ok(cols[0].u01 > cols[cols.length - 1].u01, '镜像:取样从右往左');
  assert.ok(cols[cols.length - 1].dh > cols[0].dh, '外沿比内沿高');
  assert.deepEqual(cardColumns(Object.assign({ o: 2 }, geom)), []);
});

test('边缘玻璃:内沿一比一接上中间,越往屏幕边取样越慢(拖影)、竖向越放大', () => {
  const cols = lensColumns({ W: 750, zone: 150, flare: 0.5 });
  const left = cols.filter((c) => c.dx < 375).sort((a, b) => b.dx - a.dx);   // 从内沿往外
  assert.ok(Math.abs(left[0].sx - left[0].dx) <= 1.01, '内沿取自己那一列');
  const near = left[0].sx - left[5].sx;
  const far = left[left.length - 6].sx - left[left.length - 1].sx;
  assert.ok(near > far * 3, '外沿几乎停在同一列');
  assert.ok(left[left.length - 1].scale > 1.45 && left[0].scale < 1.01);
  const right = cols.filter((c) => c.dx > 375);
  assert.equal(right.length, left.length, '两侧对称');
});

test('色散错位收着:内沿不错位,只在屏幕边错开几个像素', () => {
  const plain = lensColumns({ W: 750, zone: 150, flare: 0.5 });
  const moved = lensColumns({ W: 750, zone: 150, flare: 0.5, shift: 4 });
  const at = (cols, dx) => cols.find((c) => c.dx === dx).sx;
  assert.ok(Math.abs(at(moved, 149) - at(plain, 149)) < 0.01, '内沿接缝处不错位');
  assert.ok(Math.abs(at(moved, 0) - at(plain, 0) - 4) < 0.1, '左边屏幕边错满 4px');
  assert.ok(Math.abs(at(moved, 749) - at(plain, 749) + 4) < 0.1, '右边反向错开');
});
