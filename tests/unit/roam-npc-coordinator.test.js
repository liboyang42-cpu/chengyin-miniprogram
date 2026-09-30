// tests/unit/roam-npc-coordinator.test.js — profile 慢加载不丢开场/POI 语义/里程碑跨越/dispose
const { test } = require('node:test');
const assert = require('node:assert');
const { createRoamNpcCoordinator } = require('../../utils/roam-npc-coordinator.js');

// v2.1:poiKey = 坐标键(生产真实形状)。bindpoitap 的 e.detail 只有 {name,latitude,longitude},
// 无任何 id;r.poiId 只存在于 participating===true 分支而那条路立刻 navigateTo 跳走。
const K1 = '30.12345,120.54321';   // 同一个 POI
const K2 = '30.99999,120.11111';   // 另一个 POI

function harness(opts) {
  opts = opts || {};
  // featureOn 做成可变的:模拟 app.loadFeatureFlags 异步到货(冷启动竞态)
  let featureOn = opts.featureOn !== false;
  let chatOn = opts.chatOn === true;
  let t = 0; const timers = []; let seq = 0;
  const clock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.push({ id, at: t + ms, fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); },
    tick: (ms) => { t += ms; timers.filter(x => x.at <= t).splice(0).forEach(x => { clock.clearTimeout(x.id); x.fn(); }); },
  };
  const calls = { bubbles: [], finish: [], tracks: [], profileReqs: 0, lineReqs: [], chatOpen: [], chatClose: 0 };
  let profileCb = null;
  const ports = {
    clock,
    featurePort: { isEventOn: () => featureOn, isChatOn: () => chatOn },
    apiPort: {
      fetchProfile: (cb) => { calls.profileReqs++; profileCb = cb; },
      fetchEventLine: (pid, evt, cb) => {
        calls.lineReqs.push(evt);
        if (opts.lineErr) { cb(new Error('net')); return; }
        if (opts.emptyLine) { cb(null, { line: '', name: '小瘾', avatar: '' }); return; }
        cb(null, { line: '词-' + evt, name: '小瘾', avatar: '' });
      },
    },
    viewPort: {
      showBubble: (vm, cb) => { calls.bubbles.push(vm); cb(opts.renderErr ? new Error('render') : null); },
      showFinishLine: (vm) => { calls.finish.push(vm); },
      openChat: (sid) => { calls.chatOpen.push(sid); },
      closeChat: () => { calls.chatClose++; },
    },
    analyticsPort: { track: (n, p) => calls.tracks.push({ n, p }) },
  };
  const npc = createRoamNpcCoordinator(ports);
  return {
    npc, calls, clock,
    resolveProfile: (err, data) => profileCb && profileCb(err, data),
    setFeatureOn: (v) => { featureOn = v; },
    setChatOn: (v) => { chatOn = v; },
  };
}

test('feature 关 → 全静默(不拉 profile 不冒泡)', () => {
  const h = harness({ featureOn: false });
  h.npc.start();
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  assert.equal(h.calls.profileReqs, 0);
  assert.equal(h.calls.bubbles.length, 0);
});

test('Chat 稳定入口须同时满足 Event+Chat 开关，并把当前会话交给视图', () => {
  const h = harness({ featureOn: true, chatOn: false });
  h.npc.setSessionId(4242);
  assert.equal(h.npc.openChat(), false, 'Chat flag 默认关时不能打开');
  assert.deepEqual(h.calls.chatOpen, []);

  h.setChatOn(true);
  assert.equal(h.npc.openChat(), true);
  assert.deepEqual(h.calls.chatOpen, [4242]);

  h.setFeatureOn(false);
  assert.equal(h.npc.openChat(), false, 'Event 关时 Chat 必须连带关闭');
});

test('dispose 必须关闭 Chat，给页面取消在途 POST 的生命周期钩子', () => {
  const h = harness({ featureOn: true, chatOn: true });
  h.npc.dispose();
  assert.equal(h.calls.chatClose, 1);
  assert.equal(h.npc.openChat(), false);
});

test('★冷启动竞态:start() 时 flag 还没到,晚到之后仍要能生效', () => {
  // app.loadFeatureFlags 是异步的(POST /api/config/features),roam 页可能在它返回前就 onLoad。
  // 若 start() 把「此刻 flag=false」永久 latch,该页实例整场会话静默,零日志零告警,
  // 而灰度数据会让人误判「功能坏了/没人看」。
  const h = harness({ featureOn: false });
  h.npc.start();                       // 此刻 flag 还是默认 false
  assert.equal(h.calls.profileReqs, 0, 'flag 关时不该拉 profile');

  h.setFeatureOn(true);                // features 到货
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  assert.equal(h.calls.bubbles.length, 1, 'flag 晚到也必须能生效 —— 否则冷启动窗口内进页 = 永久静默');
});

test('★flag 中途关掉 → 立刻停,不再冒泡', () => {
  const h = harness();
  h.npc.start();
  h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.setFeatureOn(false);
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  assert.equal(h.calls.bubbles.length, 0, 'flag 是活的,关了就该立刻噤声');
});

test('profile 慢加载:开场事件排队,到货后冒泡且 impression 只在展示后记', () => {
  const h = harness();
  h.npc.start();
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  assert.equal(h.calls.bubbles.length, 0, 'profile 未到不冒泡');
  h.resolveProfile(null, { profileId: 9, name: '小瘾', avatar: '', greeting: 'hi' });
  assert.equal(h.calls.bubbles.length, 1);
  assert.deepEqual(h.calls.bubbles[0], { line: '词-roam_start' },
    '提示层给视图的契约只允许话术，不能泄露角色名或头像');
  const names = h.calls.tracks.map(x => x.n);
  assert.ok(names.includes('npc_profile_loaded'));
  assert.ok(names.includes('npc_bubble_impression'));
});

test('profile 两次失败 → 永久静默,漫游不受影响', () => {
  const h = harness();
  h.npc.start();
  h.resolveProfile(new Error('net'));      // 第 1 次失败 → 5s 后重试
  h.clock.tick(5000);
  h.resolveProfile(new Error('net'));      // 第 2 次失败 → 放弃
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  assert.equal(h.calls.bubbles.length, 0);
  assert.equal(h.calls.profileReqs, 2);
});

test('POI 只认 firstVisit=true 且会话内同 poiKey 去重', () => {
  const h = harness();
  h.npc.start(); h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.clock.tick(46000);
  h.npc.dispatch({ type: 'POI_VISIT_RECORDED', poiKey: K1, firstVisit: false });
  assert.equal(h.calls.lineReqs.filter(e => e === 'roam_poi_first_light').length, 0, 'firstVisit=false 不触发');
  h.npc.dispatch({ type: 'POI_VISIT_RECORDED', poiKey: K1, firstVisit: true });
  h.clock.tick(91000);
  h.npc.dispatch({ type: 'POI_VISIT_RECORDED', poiKey: K1, firstVisit: true });
  assert.equal(h.calls.lineReqs.filter(e => e === 'roam_poi_first_light').length, 1, '同 poiKey 不重复');
});

test('★不同 poiKey 各算一次(负控:防去重键塌成同一个)', () => {
  const h = harness();
  h.npc.start(); h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.clock.tick(46000);
  h.npc.dispatch({ type: 'POI_VISIT_RECORDED', poiKey: K1, firstVisit: true });
  h.clock.tick(91000);
  h.npc.dispatch({ type: 'POI_VISIT_RECORDED', poiKey: K2, firstVisit: true });
  assert.equal(h.calls.lineReqs.filter(e => e === 'roam_poi_first_light').length, 2,
    '两个不同坐标必须各触发一次 —— 红了说明去重键把不同 POI 认成了同一个');
});

test('★poiKey 缺失 → 不冒泡(宁可少说,不要塌成同一键全会话只响一次)', () => {
  const h = harness();
  h.npc.start(); h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.clock.tick(46000);
  h.npc.dispatch({ type: 'POI_VISIT_RECORDED', poiKey: '', firstVisit: true });
  h.npc.dispatch({ type: 'POI_VISIT_RECORDED', firstVisit: true });
  assert.equal(h.calls.lineReqs.filter(e => e === 'roam_poi_first_light').length, 0);
});

test('里程碑跨越语义:0→100 只发最高档 80', () => {
  const h = harness();
  h.npc.start(); h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.clock.tick(46000);
  h.npc.dispatch({ type: 'UNIQUE_TILE_COUNT_CHANGED', count: 100 });
  const ms = h.calls.lineReqs.filter(e => e.indexOf('roam_milestone') === 0);
  assert.deepEqual(ms, ['roam_milestone_80']);
});

test('里程碑不够档不发', () => {
  const h = harness();
  h.npc.start(); h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.clock.tick(46000);
  h.npc.dispatch({ type: 'UNIQUE_TILE_COUNT_CHANGED', count: 24 });
  assert.equal(h.calls.lineReqs.filter(e => e.indexOf('roam_milestone') === 0).length, 0);
});

test('SESSION_FINISHED 走结算屏渲染而非浮泡;dispose 后一切 no-op', () => {
  const h = harness();
  h.npc.start(); h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.npc.dispatch({ type: 'SESSION_FINISHED' });
  assert.equal(h.calls.finish.length, 1);
  assert.deepEqual(h.calls.finish[0], { line: '词-roam_end' },
    '结算提示也只能接收中性文字');
  assert.equal(h.calls.bubbles.length, 0, 'end 不走浮层');
  h.npc.dispose();
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  assert.equal(h.calls.bubbles.length, 0);
});

test('★空话术 → 不冒泡、不发 impression(cacheOnly 未命中的静默降级)', () => {
  const h = harness({ emptyLine: true });
  h.npc.start(); h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  assert.equal(h.calls.bubbles.length, 0, '空 line 不该冒泡');
  assert.equal(h.calls.tracks.filter(x => x.n === 'npc_bubble_impression').length, 0,
    '没展示就不该有 impression —— 埋点谎报是最难查的那种错');
});

test('★渲染失败 → 不发 impression 且归还配额可重试', () => {
  const h = harness({ renderErr: true });
  h.npc.start(); h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  assert.equal(h.calls.tracks.filter(x => x.n === 'npc_bubble_impression').length, 0);
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  assert.equal(h.calls.lineReqs.filter(e => e === 'roam_start').length, 2, '失败归还后允许重试 1 次');
});

test('★impression 的 properties 不含话术原文、bizId 是 Long', () => {
  const h = harness();
  h.npc.start();
  h.npc.setSessionId(4242);
  h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  const imp = h.calls.tracks.find(x => x.n === 'npc_bubble_impression');
  assert.ok(imp, '应有 impression');
  const s = JSON.stringify(imp.p);
  assert.ok(s.indexOf('词-roam_start') < 0, 'properties 不许带话术原文');
  assert.equal(typeof imp.p.bizId, 'number');
  assert.equal(imp.p.bizId, 4242);
  const forbidden = ['location', 'latitude', 'longitude', 'message', 'text', 'content', 'title', 'description', 'keyword', 'comment', 'openid'];
  forbidden.forEach(k => assert.ok(!(k in imp.p), '禁用敏感键名: ' + k));
});

test('★气泡到点自动收起', () => {
  const h = harness();
  h.npc.start(); h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  h.npc.dispatch({ type: 'SESSION_STARTED' });
  assert.equal(h.calls.bubbles.length, 1);
  h.clock.tick(6000);
  assert.equal(h.calls.bubbles.length, 2);
  assert.equal(h.calls.bubbles[1], null, '到点应传 null 收起气泡');
});

test('★排队上限 3 条,不无限堆积', () => {
  const h = harness();
  h.npc.start();
  for (let i = 0; i < 10; i++) h.npc.dispatch({ type: 'UNIQUE_TILE_COUNT_CHANGED', count: 30 });
  h.resolveProfile(null, { profileId: 9, name: '小瘾' });
  assert.ok(h.calls.lineReqs.length <= 3, '排队不该无限堆积');
});
