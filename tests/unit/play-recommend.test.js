const { test } = require('node:test');
const assert = require('node:assert');
const { scoreCandidates } = require('../../pages/play/utils/play-recommend.js');

const loc = { latitude: 31.230, longitude: 121.470 };
const NOON = 12 * 60;
const pts2 = [{ px: 0, py: 0 }, { px: 0, py: 0 }];

test('近的候选排前面(GPS 距离,近优)', () => {
  const near = { nodeId: 1, lat: 31.231, lng: 121.471, businessTime: '' }; // ~140m
  const far = { nodeId: 2, lat: 31.260, lng: 121.500, businessTime: '' };  // ~4km
  const nodes = [near, far];
  const undone = [{ x: far, i: 1 }, { x: near, i: 0 }];
  const out = scoreCandidates(nodes, pts2, undone, loc, NOON);
  assert.strictEqual(out[0].x.nodeId, 1);
  assert.ok(out[0].score > out[1].score);
});

test('营业窗:在窗(+0.3)排在不在窗(-0.8)前;同坐标同距离', () => {
  const inW = { nodeId: 1, lat: 31.231, lng: 121.471, businessTime: '09:00-18:00' };  // 12:00 在窗
  const outW = { nodeId: 2, lat: 31.231, lng: 121.471, businessTime: '20:00-23:00' }; // 12:00 不在窗
  const nodes = [inW, outW];
  const undone = [{ x: outW, i: 1 }, { x: inW, i: 0 }];
  const out = scoreCandidates(nodes, pts2, undone, loc, NOON);
  assert.strictEqual(out[0].x.nodeId, 1);
  // 分差应≈1.1(0.3 -(-0.8)),距离分相同抵消
  assert.ok(out[0].score - out[1].score > 1.0);
});

test('reason 文案:在窗带「营业中」、不在窗带「不在营业时间」', () => {
  const inW = { nodeId: 1, lat: 31.231, lng: 121.471, businessTime: '09:00-18:00' };
  const outW = { nodeId: 2, lat: 31.231, lng: 121.471, businessTime: '20:00-23:00' };
  const out = scoreCandidates([inW, outW], pts2, [{ x: inW, i: 0 }, { x: outW, i: 1 }], loc, NOON);
  const r1 = out.find((r) => r.x.nodeId === 1).reason;
  const r2 = out.find((r) => r.x.nodeId === 2).reason;
  assert.ok(r1.startsWith('离你约') && r1.includes('营业中'), r1);
  assert.strictEqual(r2, '可能不在营业时间 · 看看别处?');
});

test('无 GPS 且无完成点坐标 → dm=null → reason「顺路的下一处发现」', () => {
  const n = { nodeId: 1, lat: 0, lng: 0, businessTime: '' }; // lat/lng 0 视为无坐标
  const out = scoreCandidates([n], [{ px: 0, py: 0 }], [{ x: n, i: 0 }], null, NOON);
  assert.strictEqual(out[0].reason, '顺路的下一处发现');
});

test('返回按 score 降序', () => {
  const a = { nodeId: 1, lat: 31.231, lng: 121.471, businessTime: '' };
  const b = { nodeId: 2, lat: 31.245, lng: 121.485, businessTime: '' };
  const c = { nodeId: 3, lat: 31.270, lng: 121.510, businessTime: '' };
  const nodes = [a, b, c];
  const undone = nodes.map((x, i) => ({ x, i }));
  const out = scoreCandidates(nodes, [{ px: 0, py: 0 }, { px: 0, py: 0 }, { px: 0, py: 0 }], undone, loc, NOON);
  for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].score >= out[i].score);
});

test('空 undone → 空数组', () => {
  assert.deepStrictEqual(scoreCandidates([], [], [], loc, NOON), []);
});
