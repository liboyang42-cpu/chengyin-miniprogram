const { test } = require('node:test');
const assert = require('node:assert');

const { buildFootprintHint } = require('../../utils/roam-footprint-hint.js');
const { geohash7 } = require('../../utils/roam-geo.js');

test('没有可用历史时不产生足迹边缘提示', () => {
  assert.equal(buildFootprintHint([], { lat: 31.23, lng: 121.47 }, {}), null);
  assert.equal(buildFootprintHint([{ track: [] }], { lat: 31.23, lng: 121.47 }, {}), null);
  assert.equal(buildFootprintHint([{ track: [{ lat: 31.23, lng: 121.47 }] }], { lat: 31.23, lng: 121.47 }, {}), null);
});

test('只用本地最近一次足迹的边缘点，不生成路线或方向文案', () => {
  const hint = buildFootprintHint([
    { ts: 2, track: [{ lat: 31.2301, lng: 121.4701 }, { lat: 31.231, lng: 121.471 }] },
    { ts: 1, track: [{ lat: 30, lng: 120 }] },
  ], { lat: 31.23, lng: 121.47 }, { [geohash7(31.231, 121.471)]: 1 });

  assert.deepEqual(hint.point, { lat: 31.231, lng: 121.471 });
  assert.match(hint.text, /足迹边缘/);
  assert.doesNotMatch(hint.text, /前往|导航|向[东南西北]|左转|右转|路线/);
  assert.doesNotMatch(hint.text, /31\.231|121\.471/, '文案不能暴露原始位置');
});
