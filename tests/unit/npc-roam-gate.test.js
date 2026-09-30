// tests/unit/npc-roam-gate.test.js — 配额/节流/展示后计费(补充方案 §9.4)
const { test } = require('node:test');
const assert = require('node:assert');
const { createNpcRoamGate } = require('../../utils/npc-roam-gate.js');

function mkClock(t0) { let t = t0 || 0; return { now: () => t, tick: (ms) => { t += ms; } }; }

test('start 每会话仅 1 次,展示后计费', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  assert.equal(g.tryAcquire('roam_start').ok, true);
  g.confirmShown('roam_start');
  assert.equal(g.tryAcquire('roam_start').ok, false);
});

test('★只有展示成功才扣配额:预占后未展示不算数', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  assert.equal(g.tryAcquire('roam_start').ok, true);
  g.releaseUnshown('roam_start');
  // 配额没被消耗 —— 这正是「展示后计费」的全部意义:拉话术失败不该白白吃掉一次开场
  assert.equal(g.tryAcquire('roam_start').ok, true);
});

test('失败归还配额,同事件重试 1 次后永久拒', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  assert.equal(g.tryAcquire('roam_start').ok, true);
  g.releaseUnshown('roam_start');                       // 第 1 次失败
  assert.equal(g.tryAcquire('roam_start').ok, true);    // 允许重试
  g.releaseUnshown('roam_start');                       // 第 2 次失败
  assert.equal(g.tryAcquire('roam_start').ok, false);   // 不再吵
});

test('全局 45s 节流,roam_end 豁免', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  g.tryAcquire('roam_start'); g.confirmShown('roam_start');
  assert.equal(g.tryAcquire('roam_milestone_25').ok, false, '45s 内被节流');
  c.tick(45000);
  assert.equal(g.tryAcquire('roam_milestone_25').ok, true);
  g.confirmShown('roam_milestone_25');
  assert.equal(g.tryAcquire('roam_end').ok, true, 'end 豁免全局节流');
});

test('poi 首亮 ≤2 次且间隔 ≥90s', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  assert.equal(g.tryAcquire('roam_poi_first_light').ok, true);
  g.confirmShown('roam_poi_first_light');
  c.tick(46000);
  assert.equal(g.tryAcquire('roam_poi_first_light').ok, false, '90s 内第二次拒');
  c.tick(46000);
  assert.equal(g.tryAcquire('roam_poi_first_light').ok, true);
  g.confirmShown('roam_poi_first_light');
  c.tick(200000);
  assert.equal(g.tryAcquire('roam_poi_first_light').ok, false, '会话配额 2 次用尽');
});

test('milestone 各 1 次;预占中重复 tryAcquire 拒', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  assert.equal(g.tryAcquire('roam_milestone_25').ok, true);
  assert.equal(g.tryAcquire('roam_milestone_25').ok, false, '在途预占防并发');
  g.confirmShown('roam_milestone_25');
  c.tick(45000);
  assert.equal(g.tryAcquire('roam_milestone_80').ok, true);
});

test('未知事件一律拒(防拼错的 eventType 悄悄冒泡)', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  assert.equal(g.tryAcquire('roam_milestone').ok, false, '§9.1:禁用模糊 roam_milestone');
  assert.equal(g.tryAcquire('').ok, false);
  assert.equal(g.tryAcquire(undefined).ok, false);
});

test('拒绝时给出 reason(便于排查为何没冒泡)', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  assert.equal(g.tryAcquire('nope').reason, 'unknown_event');
  g.tryAcquire('roam_start');
  assert.equal(g.tryAcquire('roam_start').reason, 'in_flight');
  g.confirmShown('roam_start');
  assert.equal(g.tryAcquire('roam_start').reason, 'quota');
  assert.equal(g.tryAcquire('roam_milestone_25').reason, 'global_gap');
});

test('★end 豁免的是全局节流,不是自己的配额', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  assert.equal(g.tryAcquire('roam_end').ok, true);
  g.confirmShown('roam_end');
  assert.equal(g.tryAcquire('roam_end').ok, false, 'end 仍只有 1 次');
});

test('★confirmShown 会推进全局节流窗口(end 展示后别的事件仍被节流)', () => {
  const c = mkClock(); const g = createNpcRoamGate({ now: c.now });
  g.tryAcquire('roam_end'); g.confirmShown('roam_end');
  assert.equal(g.tryAcquire('roam_milestone_25').ok, false, 'end 冒完泡,45s 内别的事件仍要让路');
});
