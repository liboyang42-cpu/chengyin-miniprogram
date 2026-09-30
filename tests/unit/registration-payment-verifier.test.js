const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRegistrationStatus,
  createRegistrationPaymentVerifier,
} = require('../../utils/checkout/registration-payment-verifier.js');

test('报名支付状态只把服务端已支付判 success，关闭/退款判 failed', () => {
  assert.equal(classifyRegistrationStatus({ paymentStatus: 2 }), 'success');
  assert.equal(classifyRegistrationStatus({ registrationStatus: 2 }), 'success');
  assert.equal(classifyRegistrationStatus({ paymentStatus: 3 }), 'failed');
  assert.equal(classifyRegistrationStatus({ paymentStatus: 4 }), 'failed');
  assert.equal(classifyRegistrationStatus({ paymentStatus: 0, registrationStatus: 1 }), 'pending');
  assert.equal(classifyRegistrationStatus(null), 'unknown');
});

test('报名终态请求携带 per-request timeout 并返回可 abort task', () => {
  const requests = [];
  let aborted = 0;
  const app = {
    sendRequest(options) {
      requests.push(options);
      return { abort() { aborted += 1; } };
    }
  };
  const verify = createRegistrationPaymentVerifier(app, {
    perRequestTimeoutMs: 3210,
    totalDeadlineMs: 9000,
  });
  const control = verify({ registrationId: 7 }, () => {});
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/registration/info');
  assert.equal(requests[0].timeout, 3210);
  assert.deepEqual(requests[0].data, { id: 7 });
  control.destroy();
  assert.equal(aborted, 1);
});
