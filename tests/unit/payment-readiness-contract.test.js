const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.resolve(__dirname, '../../pages/activity/baoming/baoming.js');
const viewPath = path.resolve(__dirname, '../../pages/activity/baoming/baoming.wxml');

test('报名页在现金支付前读取 readiness，并在不可用时禁用 CTA', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const view = fs.readFileSync(viewPath, 'utf8');

  assert.match(page, /\/api\/registration\/payment-readiness/);
  assert.match(page, /paymentReady:\s*false/);
  assert.match(page, /successStatusAbnormal\(res\)\s*\{\s*settle\(false/);
  assert.match(page, /fail\(\)\s*\{\s*settle\(false/);
  assert.match(page, /paymentReady === false/);
  assert.match(view, /重新检查支付服务/);
});
