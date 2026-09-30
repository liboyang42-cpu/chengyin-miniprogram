const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveVerificationResult, completionReceiptMessage } = require('../../utils/merchant-verification');

test('首次核销显示成功结果', () => {
  assert.deepEqual(resolveVerificationResult({ code: 200, msg: '核销成功' }, '核销'), {
    state: 'success',
    title: '核销成功',
    message: '核销成功',
    show: true
  });
});

test('优惠券和订单的结构化重复标记都显示重复核销', () => {
  assert.equal(resolveVerificationResult({
    code: 200,
    msg: '该优惠券已核销',
    data: { alreadyUsed: true }
  }, '核销').state, 'duplicate');
  assert.equal(resolveVerificationResult({
    code: 500,
    msg: '该订单已核销',
    data: { alreadyVerified: true }
  }, '验票').state, 'duplicate');
});

test('非重复业务错误显示失败，并保留服务端原因', () => {
  assert.deepEqual(resolveVerificationResult({ code: 500, msg: '二维码已过期' }, '验票'), {
    state: 'failure',
    title: '验票失败',
    message: '二维码已过期',
    show: true
  });
});

test('通关探索值回执只在 earnedXp>0 的首次响应展示', () => {
  assert.equal(resolveVerificationResult({
    code: 200,
    msg: '核销成功',
    data: { completionEarnedXp: 36 }
  }, '核销').message, '核销成功 · 玩家通关 +36 探索值已到账');

  assert.equal(resolveVerificationResult({
    code: 200,
    msg: '核销成功',
    data: { completionEarnedXp: 0 }
  }, '核销').message, '核销成功', '幂等重放不得再次展示奖励');
  assert.equal(completionReceiptMessage({
    code: 200, msg: '核销成功', data: { completionEarnedXp: 36 }
  }, '核销成功'), '核销成功 · 玩家通关 +36 探索值已到账', 'profile toast 复用同一回执口径');
});
