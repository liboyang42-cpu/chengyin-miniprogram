const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('退款截止显示与订单状态在中国、UTC、洛杉矶设备一致', () => {
  const modulePath = path.resolve(__dirname, '../../utils/order-status.js');
  const script = `const {formatRefundDeadline,summarizeOrderState}=require(${JSON.stringify(modulePath)});
    console.log(JSON.stringify({
      bare:formatRefundDeadline('2026-09-18 02:26:14'),
      zoned:formatRefundDeadline('2026-09-17T18:26:14Z'),
      epoch:formatRefundDeadline(1789669574000),
      missing:formatRefundDeadline(null),
      invalid:formatRefundDeadline('not-a-date'),
      state:summarizeOrderState({registrationStatus:2,cmsActivity:{startDate:'2026-09-18 02:26:14',endDate:'2026-09-18 04:26:14'}},Date.parse('2026-09-17T18:26:13Z')).key
    }));`;
  for (const TZ of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC']) {
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }));
    assert.equal(result.bare, '2026-09-18 02:26', TZ);
    assert.equal(result.zoned, result.bare, TZ);
    assert.equal(result.epoch, result.bare, TZ);
    assert.equal(result.missing, '', TZ);
    assert.equal(result.invalid, '', TZ);
    assert.equal(result.state, 'not_started', TZ);
  }
});
