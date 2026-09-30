// Phase 3.2 结算模型 checkout-model —— 先写失败测试(TDD RED)。
//
// 纯函数,抽取 settlement.js 与 topic/settlement.js 共享的不变量(原各重复 2 份,共 4 份):
//  - computeDiscount:积分抵扣金额(1积分=0.02元,最多抵50元,不超票面)的精确算法。
//  - validateCheckout:下单前校验链(票务→地址→协议→姓名→手机→手机格式),地址缺失文案各页可传。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../utils/checkout/checkout-model.js');

// ---- computeDiscount ----
test('不使用折扣:折扣0、积分0、总额=票面(两位小数)', () => {
  const r = model.computeDiscount({ basePrice: 100, userPoints: 5000, useDiscount: false });
  assert.deepEqual(r, { discountAmount: 0, usedPoints: 0, totalAmount: 100 });
});

test('积分充足:封顶抵扣50元、用2500积分、总额票面-50', () => {
  const r = model.computeDiscount({ basePrice: 100, userPoints: 5000, useDiscount: true });
  assert.equal(r.discountAmount, 50);
  assert.equal(r.usedPoints, 2500);
  assert.equal(r.totalAmount, 50);
});

test('积分不足:按积分抵扣(100积分=2元)', () => {
  const r = model.computeDiscount({ basePrice: 100, userPoints: 100, useDiscount: true });
  assert.equal(r.discountAmount, 2);
  assert.equal(r.usedPoints, 100);
  assert.equal(r.totalAmount, 98);
});

test('票面小于可抵扣:抵扣不超过票面,总额0', () => {
  const r = model.computeDiscount({ basePrice: 1, userPoints: 5000, useDiscount: true });
  assert.equal(r.discountAmount, 1);
  assert.equal(r.usedPoints, 50);
  assert.equal(r.totalAmount, 0);
});

test('零积分仍勾选折扣:折扣0、总额票面', () => {
  const r = model.computeDiscount({ basePrice: 100, userPoints: 0, useDiscount: true });
  assert.equal(r.discountAmount, 0);
  assert.equal(r.usedPoints, 0);
  assert.equal(r.totalAmount, 100);
});

test('票面缺失按0处理,不抛异常', () => {
  const r = model.computeDiscount({ basePrice: 0, userPoints: 100, useDiscount: true });
  assert.equal(r.totalAmount, 0);
  assert.equal(r.discountAmount, 0);
});

// ---- validateCheckout ----
const okInput = {
  hasTicket: true, hasAddress: true, agreementChecked: true,
  realName: '阿岚', phone: '13800138000', addressMissingMsg: '请选择配送地址',
};

test('校验全通过', () => {
  assert.deepEqual(model.validateCheckout(okInput), { ok: true });
});

test('无票务 → 请选择票务', () => {
  const r = model.validateCheckout(Object.assign({}, okInput, { hasTicket: false }));
  assert.equal(r.ok, false);
  assert.equal(r.error, '请选择票务');
});

test('无地址 → 用传入的地址缺失文案 + focusAddress', () => {
  const r = model.validateCheckout(Object.assign({}, okInput, { hasAddress: false, addressMissingMsg: '请选择个人信息' }));
  assert.equal(r.ok, false);
  assert.equal(r.error, '请选择个人信息');
  assert.equal(r.focusAddress, true);
});

test('未同意协议 → 提示', () => {
  const r = model.validateCheckout(Object.assign({}, okInput, { agreementChecked: false }));
  assert.equal(r.error, '请阅读并同意相关协议');
  assert.equal(r.focusAddress, undefined);
});

test('缺姓名 → 提示 + focusAddress', () => {
  const r = model.validateCheckout(Object.assign({}, okInput, { realName: '' }));
  assert.equal(r.error, '请选择有效地址，需要包含收货人姓名');
  assert.equal(r.focusAddress, true);
});

test('缺手机 → 提示 + focusAddress', () => {
  const r = model.validateCheckout(Object.assign({}, okInput, { phone: '' }));
  assert.equal(r.error, '请选择有效地址，需要包含手机号码');
  assert.equal(r.focusAddress, true);
});

test('手机格式错误 → 提示 + focusAddress', () => {
  const r = model.validateCheckout(Object.assign({}, okInput, { phone: '12345' }));
  assert.equal(r.error, '地址中的手机号码格式不正确');
  assert.equal(r.focusAddress, true);
});
