// Phase 3.2 结算支付状态机 checkout-workflow —— 先写失败测试(TDD RED)。
//
// 抽取 settlement / topic/settlement 共享的下单→支付时序与不变量(依赖注入,可脱离真机单测):
//  idle → submitting(createOrder) → [payable?] paying(requestPayment) : 免费成功 → done。
// 不变量:
//  - 防重:在途(submitting/paying)再次 submit 直接忽略,createOrder 只调一次。
//  - 创建订单失败 → 不拉起支付,回 idle(可重试)。
//  - 支付取消/失败 → 回 idle(可重试);支付成功 → done 且 onPaySuccess 只触发一次。
//  - 页面销毁后(destroy)任何在途回调都不再触发(避免 setData after unload)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCheckoutWorkflow } = require('../../utils/checkout/checkout-workflow.js');

// 可手动驱动的桩:createOrder/requestPayment 把 cb 存起来,测试再决定何时以何结果回调。
function makeWf(over) {
  const calls = { order: 0, pay: 0, verify: 0 };
  let orderCb = null; let payCb = null; let verifyCb = null;
  const deps = Object.assign({
    createOrder: (payload, cb) => { calls.order++; orderCb = cb; },
    requestPayment: (orderData, cb) => { calls.pay++; payCb = cb; },
    isPayable: (d) => d.payableAmount > 0,
    verifyPayment: (data, cb) => { calls.verify++; verifyCb = cb; },
  }, over);
  const wf = createCheckoutWorkflow(deps);
  return {
    wf, calls,
    resolveOrder: (r) => orderCb(r),
    resolvePay: (r) => payCb(r),
    resolveVerify: (r) => verifyCb && verifyCb(r),
  };
}

const handlers = () => {
  const log = [];
  return {
    log,
    onOrderFail: (r) => log.push(['orderFail', r]),
    onFreeSuccess: (d) => log.push(['free', d]),
    onPaySuccess: (d) => log.push(['paySuccess', d]),
    onPayCancel: () => log.push(['cancel']),
    onPayFail: (r) => log.push(['payFail', r]),
    onPayUnknown: (r) => log.push(['unknown', r]),
  };
};

test('防重:在途再次 submit 被忽略,createOrder 只调一次', () => {
  const { wf, calls } = makeWf();
  const h = handlers();
  assert.equal(wf.submit({}, h), true);
  assert.equal(wf.submit({}, h), false); // 在途,忽略
  assert.equal(calls.order, 1);
  assert.equal(wf.isBusy(), true);
});

test('创建订单失败 → onOrderFail、不拉起支付、回 idle 可重试', () => {
  const { wf, calls, resolveOrder } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: false, msg: '报名失败' });
  assert.deepEqual(h.log, [['orderFail', { ok: false, msg: '报名失败' }]]);
  assert.equal(calls.pay, 0, '不应拉起支付');
  assert.equal(wf.isBusy(), false, '回 idle');
  assert.equal(wf.submit({}, h), true, '可重试');
  assert.equal(calls.order, 2);
});

test('免费订单(payableAmount=0)→ onFreeSuccess、不拉起支付、done', () => {
  const { wf, calls, resolveOrder } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 0, id: 9 } });
  assert.deepEqual(h.log, [['free', { payableAmount: 0, id: 9 }]]);
  assert.equal(calls.pay, 0);
});

test('应付>0 → 拉起支付(传订单数据);支付成功+验证通过 → onPaySuccess 仅一次、done', () => {
  const { wf, calls, resolveOrder, resolvePay, resolveVerify } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100, payParams: { x: 1 } } });
  assert.equal(calls.pay, 1);
  resolvePay({ ok: true });
  assert.equal(wf.getState(), 'verifying');
  resolveVerify({ ok: true });
  assert.deepEqual(h.log, [['paySuccess', { payableAmount: 100, payParams: { x: 1 } }]]);
  assert.equal(wf.getState(), 'done');
  // 已 done,再 submit 被忽略
  assert.equal(wf.submit({}, h), false);
});

test('支付取消 → onPayCancel、回 idle 可重试', () => {
  const { wf, resolveOrder, resolvePay, calls } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100 } });
  resolvePay({ ok: false, cancelled: true });
  assert.deepEqual(h.log, [['cancel']]);
  assert.equal(wf.isBusy(), false);
  assert.equal(wf.submit({}, h), true, '取消后可重试');
});

test('支付失败(非取消)→ onPayFail、回 idle', () => {
  const { wf, resolveOrder, resolvePay } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100 } });
  resolvePay({ ok: false, cancelled: false, errMsg: 'fail' });
  assert.equal(h.log[0][0], 'payFail');
  assert.equal(wf.isBusy(), false);
});

test('微信支付失败不得把 requestPayment 原始诊断串透传给页面', () => {
  const { wf, resolveOrder, resolvePay } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100 } });
  resolvePay({
    ok: false,
    cancelled: false,
    errMsg: 'requestPayment:fail system error trace_id=internal-123',
  });

  assert.deepEqual(h.log, [[
    'payFail',
    {
      ok: false,
      cancelled: false,
      errMsg: '支付失败，请重试',
    },
  ]]);
});

test('销毁后:订单回调不再触发任何 handler', () => {
  const { wf, resolveOrder, calls } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  wf.destroy();
  resolveOrder({ ok: true, data: { payableAmount: 100 } });
  assert.equal(h.log.length, 0, '销毁后不回调');
  assert.equal(calls.pay, 0, '销毁后不拉起支付');
});

test('销毁后:支付回调不再触发 handler', () => {
  const { wf, resolveOrder, resolvePay } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100 } });
  wf.destroy();
  resolvePay({ ok: true });
  assert.equal(h.log.length, 0);
});

test('verifyPayment:支付成功先进入verifying,验证通过才到done并触发onPaySuccess', () => {
  const { wf, calls, resolveOrder, resolvePay, resolveVerify } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100, id: 1 } });
  resolvePay({ ok: true });
  // 支付成功 → verifying,尚未 done
  assert.equal(calls.verify, 1);
  assert.equal(wf.getState(), 'verifying');
  assert.equal(wf.isBusy(), true);
  // onPaySuccess 还没触发
  assert.equal(h.log.filter(function (e) { return e[0] === 'paySuccess'; }).length, 0);
  // 验证通过 → done
  resolveVerify({ ok: true });
  assert.equal(wf.getState(), 'done');
  assert.equal(wf.isBusy(), false);
  assert.deepEqual(h.log, [['paySuccess', { payableAmount: 100, id: 1 }]]);
});

test('verifyPayment:验证失败回idle、触发onPayFail、可重试', () => {
  const { wf, calls, resolveOrder, resolvePay, resolveVerify } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100, id: 2 } });
  resolvePay({ ok: true });
  resolveVerify({ ok: false, errMsg: '订单状态未确认' });
  assert.equal(wf.getState(), 'idle');
  assert.equal(wf.isBusy(), false);
  assert.equal(h.log[0][0], 'payFail');
  // 可重试
  assert.equal(wf.submit({}, h), true);
});

test('verifyPayment:验证回调前销毁不触发任何handler', () => {
  const { wf, resolveOrder, resolvePay, resolveVerify } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100 } });
  resolvePay({ ok: true });
  wf.destroy();
  resolveVerify({ ok: true });
  assert.equal(h.log.length, 0);
});

test('不传verifyPayment时行为不变:支付成功直接done', () => {
  const { wf, calls, resolveOrder, resolvePay } = makeWf({
    verifyPayment: undefined, // 显式不传
  });
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100, id: 3 } });
  resolvePay({ ok: true });
  assert.equal(wf.getState(), 'done');
  assert.equal(calls.verify, 0);
  assert.deepEqual(h.log, [['paySuccess', { payableAmount: 100, id: 3 }]]);
});

test('onPayVerifying在支付成功但验证未完成时触发', () => {
  const { wf, resolveOrder, resolvePay } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100 } });
  resolvePay({ ok: true });
  // onPayVerifying 在进入 verifying 状态时触发
  // (当前 handlers 默认没有 onPayVerifying 所以 log 里看不到)
  // 状态确认
  assert.equal(wf.getState(), 'verifying');
  assert.equal(wf.isBusy(), true);
});

test('支付终态超过 deadline 必须进入 unknown，禁止把未知当失败后重复下单', () => {
  const { wf, resolveOrder, resolvePay, resolveVerify, calls } = makeWf();
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100 } });
  resolvePay({ ok: true });
  resolveVerify({ ok: false, status: 'unknown', errMsg: '结果未知' });

  assert.equal(wf.getState(), 'unknown');
  assert.equal(wf.isBusy(), false);
  assert.deepEqual(h.log, [['unknown', { ok: false, status: 'unknown', errMsg: '结果未知' }]]);
  assert.equal(wf.submit({}, h), false, 'unknown 不能直接重建订单');
  assert.equal(calls.order, 1);
});

test('destroy 必须终止 verifyPayment 返回的在途控制器', () => {
  let aborted = 0;
  const { wf, resolveOrder, resolvePay } = makeWf({
    verifyPayment: function () {
      return { abort: function () { aborted++; } };
    },
  });
  wf.submit({}, handlers());
  resolveOrder({ ok: true, data: { payableAmount: 100 } });
  resolvePay({ ok: true });

  wf.destroy();

  assert.equal(aborted, 1);
});

test('支付参数不完整时不得拉起微信支付', () => {
  const { wf, resolveOrder, calls } = makeWf({
    validatePayment: function (data) { return !!(data && data.payParams && data.payParams.paySign); },
  });
  const h = handlers();
  wf.submit({}, h);
  resolveOrder({ ok: true, data: { payableAmount: 100, payParams: { timeStamp: '1' } } });

  assert.equal(calls.pay, 0);
  assert.equal(wf.getState(), 'idle');
  assert.equal(h.log[0][0], 'payFail');
  assert.equal(h.log[0][1].status, 'failed');
});
