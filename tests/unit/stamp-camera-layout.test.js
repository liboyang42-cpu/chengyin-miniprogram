const test = require('node:test');
const assert = require('node:assert/strict');
const { clampFrameRatio, layoutStampCamera } = require('../../subpackageP3/pages/stamp-camera/index/layout.js');

test('取景卡内的取景框始终居中、完整可见且严格为 4:5', () => {
  const layout = layoutStampCamera({ width: 390, height: 844 });

  assert.equal(layout.frameH * 4, layout.frameW * 5, '取景框必须严格保持 4:5');
  assert.ok(layout.frameL >= layout.screenL, '邮票框不能越过取景卡左边缘');
  assert.ok(layout.frameT >= layout.screenT, '邮票框不能越过取景卡上边缘');
  assert.ok(layout.frameL + layout.frameW <= layout.screenL + layout.screenW, '邮票框不能越过取景卡右边缘');
  assert.ok(layout.frameT + layout.frameH <= layout.screenT + layout.screenH, '邮票框不能越过取景卡下边缘');
  assert.ok(Math.abs((layout.frameL + layout.frameW / 2) - (layout.screenL + layout.screenW / 2)) <= 1,
    '邮票框应在取景卡内水平居中');
});

test('取景卡照原型 camPanel:让开微信胶囊、快门压在卡的底边内', () => {
  const layout = layoutStampCamera({ width: 390, height: 844, statusBarHeight: 24 });

  // 2026-09-11 用户裁决「不是 canon 了 用原型的」:拟物机身退场,body* 与 screen* 合成同一张卡。
  assert.equal(layout.bodyL, layout.screenL, '卡本体就是取景区,不再有机身外壳');
  assert.equal(layout.bodyW, layout.screenW);
  assert.ok(layout.screenW >= 320 && layout.screenW < 390, '卡左右各让 14px,不顶到两侧');
  assert.ok(layout.screenT >= 76, '卡顶必须让开微信胶囊那条带');
  assert.equal(layout.backL, layout.screenL + 12, '✕ 照原型钉在卡的左上角 12/12');
  assert.equal(layout.backT, layout.screenT + 12);
  assert.ok(layout.shutterL >= layout.screenL && layout.shutterL + layout.shutterS <= layout.screenL + layout.screenW,
    '快门必须落在卡内水平居中');
  assert.ok(Math.abs((layout.shutterL + layout.shutterS / 2) - 390 / 2) <= 1, '快门在屏幕中线上');
  assert.ok(layout.shutterT + layout.shutterS <= layout.screenT + layout.screenH, '快门压在卡的底边内,不掉出去');
});

test('短屏设备:卡整体落在窗口内,取景框仍完整嵌在卡里', () => {
  const layout = layoutStampCamera({ width: 320, height: 568 });

  assert.ok(layout.screenT >= 0 && layout.screenT + layout.screenH <= 568, '卡必须完全落在可视窗口内');
  assert.ok(layout.frameT + layout.frameH <= layout.screenT + layout.screenH, '取景框不能越过卡的下缘');
});

test('手势与布局共用 0.4 到 0.9 的取景框缩放边界', () => {
  assert.equal(clampFrameRatio(0.39), 0.4);
  assert.equal(clampFrameRatio(0.4), 0.4);
  assert.equal(clampFrameRatio(1), 0.9);
  assert.equal(
    layoutStampCamera({ width: 390, height: 844, frameRatio: 0.39 }).frameW,
    layoutStampCamera({ width: 390, height: 844, frameRatio: 0.4 }).frameW,
    '越过下限后的手势不能再改变布局'
  );
});

test('无效窗口尺寸直接拒绝，避免把 NaN 写进相机裁切坐标', () => {
  assert.throws(() => layoutStampCamera({ width: 0, height: 844 }), /窗口尺寸/);
});
