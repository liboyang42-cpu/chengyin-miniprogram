// Phase 3.1 发布提交状态机 publish-workflow —— 先写失败测试(TDD RED)。
//
// 抽取 publish/activity 与 publish/fabu 共享的提交时序与不变量(依赖注入,可脱离真机单测):
//  idle → submitting(request) → 成功 done / 失败回 idle 可重试。
// 不变量:
//  - 防重:在途(submitting)再次 submit 直接忽略,request 只调一次。
//  - 业务/网络失败 → 回 idle(可重试);成功 → done 且 onSuccess 只触发一次。
//  - 已 done 再 submit 被忽略(发布成功后 2s 跳转期间按钮保持不可点)。
//  - 页面销毁后(destroy)任何在途回调都不再触发(避免 setData / redirect after unload)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPublishWorkflow } = require('../../pages/publish/utils/publish/publish-workflow.js');

// 可手动驱动的桩:request 把 cb 存起来,测试再决定何时以何结果回调。
function makeWf(over) {
  const calls = { request: 0 };
  let reqCb = null;
  const deps = Object.assign({
    request: (payload, cb) => { calls.request++; reqCb = cb; },
  }, over);
  const wf = createPublishWorkflow(deps);
  return { wf, calls, resolve: (r) => reqCb(r) };
}

const handlers = () => {
  const log = [];
  return {
    log,
    onSuccess: (d) => log.push(['success', d]),
    onFail: (r) => log.push(['fail', r]),
  };
};

test('缺少 request 依赖直接抛错', () => {
  assert.throws(() => createPublishWorkflow({}), /request/);
});

test('防重:在途再次 submit 被忽略,request 只调一次', () => {
  const { wf, calls } = makeWf();
  const h = handlers();
  assert.equal(wf.submit({ name: 'a' }, h), true);
  assert.equal(wf.submit({ name: 'a' }, h), false); // 在途,忽略
  assert.equal(calls.request, 1);
  assert.equal(wf.isBusy(), true);
});

test('request 收到 payload', () => {
  let seen = null;
  const { wf } = makeWf({ request: (payload, cb) => { seen = payload; } });
  wf.submit({ name: '主题X' }, handlers());
  assert.deepEqual(seen, { name: '主题X' });
});

test('成功 → onSuccess(data) 仅一次、done、再 submit 被忽略', () => {
  const { wf, calls, resolve } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolve({ ok: true, data: { id: 7 } });
  assert.deepEqual(h.log, [['success', { id: 7 }]]);
  assert.equal(wf.getState(), 'done');
  assert.equal(wf.submit({}, h), false, '已 done 忽略');
  assert.equal(calls.request, 1);
});

test('业务失败(code!=200)→ onFail(res)、回 idle 可重试', () => {
  const { wf, calls, resolve } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolve({ ok: false, msg: '名称重复' });
  assert.deepEqual(h.log, [['fail', { ok: false, msg: '名称重复' }]]);
  assert.equal(wf.isBusy(), false, '回 idle');
  assert.equal(wf.submit({}, h), true, '可重试');
  assert.equal(calls.request, 2);
});

test('网络失败 → onFail(res)、回 idle 可重试', () => {
  const { wf, resolve } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolve({ ok: false, networkError: true });
  assert.deepEqual(h.log, [['fail', { ok: false, networkError: true }]]);
  assert.equal(wf.isBusy(), false);
  assert.equal(wf.submit({}, h), true, '可重试');
});

test('销毁后:成功回调不再触发 handler(避免跳转 after unload)', () => {
  const { wf, resolve } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  wf.destroy();
  resolve({ ok: true, data: { id: 1 } });
  assert.equal(h.log.length, 0, '销毁后不回调');
});

test('销毁后:失败回调不再触发 handler', () => {
  const { wf, resolve } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  wf.destroy();
  resolve({ ok: false, msg: 'x' });
  assert.equal(h.log.length, 0);
});
