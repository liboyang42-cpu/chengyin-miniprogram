'use strict';
// 读数卡数字滚动 —— 逐条照原型 countUp() 抄,规则一条不改。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../utils/count-up.js');

test('该滚的滚:正号、小数位、后缀都跟着原值走', () => {
  assert.equal(C.shouldCount('1.20'), true);
  assert.equal(C.frame('1.20', 0), '0.00');
  assert.equal(C.frame('1.20', C.DURATION), '1.20');
  assert.equal(C.frame('12%', C.DURATION), '12%');
  assert.equal(C.frame('+180', C.DURATION), '+180');
  // 缓出曲线:半程时已经走过大半(1-(1-.5)³ = .875)
  assert.equal(C.frame('100', C.DURATION / 2), '88');
});

test('不该滚的原样返回:时间、0、纯文字', () => {
  // 00:00 滚出来是乱码,不是动效
  assert.equal(C.shouldCount('12:04'), false);
  assert.equal(C.frame('12:04', 100), '12:04');
  // 0 滚给谁看
  assert.equal(C.shouldCount('0'), false);
  assert.equal(C.frame('0', 100), '0');
  assert.equal(C.shouldCount('猫王咖啡'), false);
  assert.equal(C.frame('猫王咖啡', 100), '猫王咖啡');
  assert.equal(C.frame(null, 100), '');
});

test('超时即终值,不会越过', () => {
  assert.equal(C.frame('3', C.DURATION * 5), '3');
  assert.equal(C.frame('3', -100), '0');
});
