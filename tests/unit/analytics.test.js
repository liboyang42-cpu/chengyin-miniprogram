// Phase 1.3 analytics 迁移 + 并发缺陷修复 —— 先写失败测试(TDD RED)。
//
// 契约(current-api-inventory.md):
//  #31 track 仅放行白名单;事件结构/回退不变。
//  #32 POST /api/analytics/events/batch,body={events},成功判定 code===200。
//  #33 MAX_QUEUE=100/MAX_BATCH=50;成功才出队、失败保留重试。
//  #35 修并发缺陷底线:投递窗口内新 track 的事件不被快照覆盖永久丢失;已成功事件最终计一次。
//  迁移:不再直接 wx.request,改走 app.sendRequest(认证由 request-client 自动注入,不手拼 Authorization)。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// storage 桩
const store = {};
global.wx = {
  getStorageSync: (k) => store[k],
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
};

// app 桩:捕获 sendRequest 调用,测试手动驱动 success
let sent = [];
let currentUserId = 'u1';
global.getApp = () => ({
  globalData: { siteBaseUrl: 'https://base' },
  getAuthorization: () => 'T',
  getUserID: () => currentUserId,
  sendRequest: (param) => { sent.push(param); },
});

const QKEY = 'p3_analytics_queue_v1:u1';
const ANALYTICS_PATH = '../../utils/analytics.js';

// 每个测试重新加载模块,隔离模块级状态(投递锁 flushing、sessionContext)。
let analytics;
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  sent = [];
  currentUserId = 'u1';
  delete require.cache[require.resolve(ANALYTICS_PATH)];
  analytics = require(ANALYTICS_PATH);
  analytics.setSessionContext({ sessionId: 's1' });
});

test('迁移:走 app.sendRequest、POST 正确地址、不手拼 Authorization', () => {
  analytics.track('content_view', { bizId: 'A' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, '/api/analytics/events/batch');
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].header.Authorization, undefined, '认证由 request-client 注入,不在 analytics 手拼');
  assert.equal(sent[0].data.events.length, 1);
  assert.equal(sent[0].data.events[0].bizId, 'A');
});

test('白名单:未注册事件不投递(契约#31)', () => {
  analytics.track('not_allowed_event', {});
  assert.equal(sent.length, 0);
});

test('Chat 埋点白名单完整且不携带用户输入或回答原文', () => {
  ['npc_chat_open', 'npc_chat_submit', 'npc_chat_complete', 'npc_chat_cancel'].forEach((eventName) => {
    analytics.track(eventName, {
      bizType: 'roam', bizId: 91, outcomeStatus: 'SUCCEEDED', safetyDecision: 'PASS',
      message: '用户原文不得进入 analytics', reply: '模型原文不得进入 analytics'
    });
  });

  const queue = store[QKEY] || [];
  assert.deepEqual(queue.map((event) => event.eventName),
    ['npc_chat_open', 'npc_chat_submit', 'npc_chat_complete', 'npc_chat_cancel']);
  queue.forEach((event) => {
    const properties = JSON.parse(event.propertiesJson);
    assert.equal(properties.message, undefined);
    assert.equal(properties.reply, undefined);
    assert.equal(event.bizId, 91);
  });
});

test('成功投递后出队;失败保留重试(契约#33)', () => {
  analytics.track('content_view', { bizId: 'A' });
  sent[0].fail(); // 失败 → 保留
  let q = store[QKEY] || [];
  assert.equal(q.length, 1, '失败保留');
  // 再次 flush 重试
  analytics.flush();
  sent[sent.length - 1].success({ code: 200 }); // 成功 → 出队
  q = store[QKEY] || [];
  assert.equal(q.length, 0, '成功出队');
});

test('并发底线#35:投递中新 track 的事件不被快照覆盖丢失', () => {
  analytics.track('content_view', { bizId: 'A' }); // push A → flush(在途 sent[0])
  assert.equal(sent.length, 1);
  analytics.track('content_view', { bizId: 'B' }); // 在途期间 push B
  assert.equal(sent.length, 1, '投递锁:在途不再并发投递,避免重复投');
  sent[0].success({ code: 200 });                  // A 投递成功
  const q = store[QKEY] || [];
  assert.equal(q.length, 1, 'B 不应被旧快照回写抹掉');
  assert.equal(q[0].bizId, 'B');
});

test('F24 A 清会话后 B 不会补发 A 的离线事件，且会重建 session', () => {
  analytics.track('content_view', { bizId: 'A' });
  const aSession = sent[0].data.events[0].sessionId;
  sent[0].fail();

  currentUserId = 'u2';
  analytics.track('content_view', { bizId: 'B' });
  const bCall = sent[sent.length - 1];
  assert.deepEqual(bCall.data.events.map((event) => event.bizId), ['B']);
  assert.notEqual(bCall.data.events[0].sessionId, aSession);
  assert.equal((store['p3_analytics_queue_v1:u1'] || []).length, 1);
  assert.equal((store['p3_analytics_queue_v1:u2'] || []).length, 1);
});

test('F24 旧无账号队列只删除不迁给当前账号', () => {
  store.p3_analytics_queue_v1 = [{ eventName: 'content_view', bizId: 'legacy' }];
  analytics.flush();
  assert.equal(store.p3_analytics_queue_v1, undefined);
  assert.equal(sent.length, 0);
});
