const test = require('node:test');
const assert = require('node:assert/strict');
const { frameCropRect, orientedImageSize, drawOrientedImage } = require('../../subpackageP3/pages/stamp-camera/index/crop.js');

test('取景框按 camera cover 映射到原图，导出尺寸严格为 4:5', () => {
  const crop = frameCropRect({
    imageWidth: 1000,
    imageHeight: 1000,
    viewportWidth: 100,
    viewportHeight: 200,
    frameLeft: 25,
    frameTop: 50,
    frameWidth: 50,
    frameHeight: 62.5
  });

  assert.equal(crop.sourceX, 375, '横向被 cover 裁去的部分也必须计入，不能直接按屏幕比例取 x');
  assert.equal(crop.sourceY, 250);
  assert.equal(crop.sourceWidth, 250);
  assert.equal(crop.sourceHeight, 312.5);
  assert.equal(crop.outputWidth / crop.outputHeight, 4 / 5, '输出文件必须是真正 4:5，不是只画 4:5 的框');
});

test('缩放后的取景框位置变化会改变真实源图裁切区域', () => {
  const left = frameCropRect({
    imageWidth: 1600,
    imageHeight: 1200,
    viewportWidth: 400,
    viewportHeight: 800,
    frameLeft: 20,
    frameTop: 180,
    frameWidth: 240,
    frameHeight: 300
  });
  const right = frameCropRect({
    imageWidth: 1600,
    imageHeight: 1200,
    viewportWidth: 400,
    viewportHeight: 800,
    frameLeft: 100,
    frameTop: 180,
    frameWidth: 240,
    frameHeight: 300
  });

  assert.ok(right.sourceX > left.sourceX, '框向右移动时，裁切内容也必须向右移动');
  assert.equal(left.outputWidth / left.outputHeight, 4 / 5);
  assert.equal(right.outputWidth / right.outputHeight, 4 / 5);
});

test('取整后的取景框仍按严格 4:5 裁源图，不靠拉伸凑输出比例', () => {
  const crop = frameCropRect({
    imageWidth: 1000,
    imageHeight: 1600,
    viewportWidth: 375,
    viewportHeight: 812,
    frameLeft: 71,
    frameTop: 190,
    frameWidth: 233,
    frameHeight: 291
  });

  assert.equal(crop.sourceWidth / crop.sourceHeight, 4 / 5);
  assert.equal(crop.outputWidth / crop.outputHeight, 4 / 5);
});

test('缺失取景框坐标直接拒绝，不能把 NaN 送进 canvas', () => {
  assert.throws(() => frameCropRect({
    imageWidth: 1000, imageHeight: 1000, viewportWidth: 375, viewportHeight: 812,
    frameWidth: 233, frameHeight: 291
  }), /取景框尺寸/);
});

test('竖拍 EXIF 方向先转成用户看到的尺寸，再绘制对应变换', () => {
  assert.deepEqual(orientedImageSize(400, 300, 'right'), { width: 300, height: 400 });
  assert.deepEqual(orientedImageSize(400, 300, 'left-mirrored'), { width: 300, height: 400 });
  assert.deepEqual(orientedImageSize(400, 300, 'up'), { width: 400, height: 300 });

  const calls = [];
  const ctx = {
    translate() { calls.push(['translate'].concat(Array.from(arguments))); },
    rotate() { calls.push(['rotate'].concat(Array.from(arguments))); },
    scale() { calls.push(['scale'].concat(Array.from(arguments))); },
    drawImage() { calls.push(['drawImage'].concat(Array.from(arguments))); }
  };
  const image = {};
  drawOrientedImage(ctx, image, 'right', 400, 300);
  assert.deepEqual(calls, [
    ['translate', 300, 0], ['rotate', Math.PI / 2], ['drawImage', image, 0, 0, 400, 300]
  ]);
});
