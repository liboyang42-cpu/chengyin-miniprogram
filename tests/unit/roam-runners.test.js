'use strict';
// 附近正在漫游的人:颜色稳定、时长写法照原型、脏回包丢得干净。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../utils/roam-runners.js');

test('同一个人永远同一个环色;色盘里不许出现自己的蓝或两种玩法色', () => {
  assert.equal(R.runnerColor(1013), R.runnerColor(1013));
  assert.equal(R.runnerColor(1013), R.runnerColor(1013 + R.RUNNER_COLORS.length));
  // 自己是 #2F7BF6、城市定向 #4ADE80、自由探索 #5A90D6 —— 撞上就分不清谁是谁
  ['#2F7BF6', '#4ADE80', '#5A90D6'].forEach((c) => {
    assert.ok(R.RUNNER_COLORS.indexOf(c) < 0, c + ' 不该出现在他人色盘里');
  });
  assert.equal(R.runnerColor(null), R.RUNNER_COLORS[0]);
});

test('在走时长照原型写成分:秒,过一小时才补小时位', () => {
  assert.equal(R.elapsedLabel(2300), '38:20');   // 原型 f-other-a
  assert.equal(R.elapsedLabel(724), '12:04');    // 原型 f-other-b
  assert.equal(R.elapsedLabel(3725), '1:02:05');
  assert.equal(R.elapsedLabel(-5), '00:00');
  assert.equal(R.elapsedLabel(undefined), '00:00');
});

test('normalizeRunners:没 id / 没坐标的整行丢掉,没图的店丢掉,越界的百分比夹住', () => {
  const rows = R.normalizeRunners([
    { memberId: 7, lat: 31.1, lng: 121.4, explorePct: 9999, shops: -3, elapsedSec: 2300,
      shopPhotos: [{ name: '昼夜咖啡', image: 'a.jpg' }, { name: '没图的', image: '' }, null] },
    { memberId: 0, lat: 31, lng: 121 },              // 没 id
    { memberId: 8, lat: 'x', lng: 121 },             // 坐标不是数
    null,
  ]);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.explorePct, 99);
  assert.equal(r.shops, 0);
  assert.equal(r.elapsed, '38:20');
  assert.deepEqual(r.shopPhotos, [{ name: '昼夜咖啡', image: 'a.jpg' }]);
  assert.equal(r.nickname, '漫游者');   // 后端没给昵称时的兜底,不留空字符串
  // ⚠️ 负控:这个 VO 是发给陌生人的,不许把身份线索带进前端行
  ['phone', 'mobile', 'realName', 'idCard'].forEach((k) => assert.equal(r[k], undefined));
});

test('sinceLabel 按真时长说话,不写死「今天第 2 次」', () => {
  assert.equal(R.sinceLabel(60), '刚出发');
  assert.equal(R.sinceLabel(1800), '走了半小时上下');
  assert.equal(R.sinceLabel(7200), '走了一个多小时');
});
