const test = require('node:test');
const assert = require('node:assert/strict');
const {
  staticTernaryUrls,
  literalReqUrls,
  resolveDynamicUrls,
  classifyEndpointCandidates,
} = require('../lint/requestbody-dynamic-url');

test('解析只有静态分支的动态 URL 三元表达式', function () {
  assert.deepEqual(
    staticTernaryUrls("Number(status) === 2 ? '/api/registration/cancel-refund' : '/api/registration/cancel'"),
    ['/api/registration/cancel-refund', '/api/registration/cancel']
  );
  assert.equal(staticTernaryUrls("scope ? '/api/a' : dynamicUrl"), null);
});

test('只解析审计过的动态 URL 形态', function () {
  assert.deepEqual(
    resolveDynamicUrls('pages/member/index/index.js', 'scan.url', ''),
    [
      '/api/verify/groupcode/redeem',
      '/api/registration/scan_dynamic_code',
      '/api/coupon/verification',
      '/api/registration/scan_qr_code',
    ]
  );
  assert.equal(resolveDynamicUrls('pages/member/index/index.js', 'other.url', ''), null);
});

test('会员页私有 req wrapper 从当前字面量调用点取候选，动态调用不允许静默放过', function () {
  const source = [
    'function req(url, data) {}',
    "req('/api/user/info', {})",
    "req('/api/club/my', {})",
  ].join('\n');
  assert.deepEqual(literalReqUrls(source), ['/api/user/info', '/api/club/my']);
  assert.equal(literalReqUrls('function req(url) {}\nreq(dynamicUrl, {})'), null);
});

test('负控：同形动态 URL 只要有 @RequestBody 候选就必须阻断', function () {
  const verdict = classifyEndpointCandidates(
    ['/api/registration/cancel', '/api/registration/cancel-refund'],
    function (url) { return url.endsWith('cancel-refund') ? 'body' : 'nonbody'; }
  );
  assert.deepEqual(verdict, { candidate: '/api/registration/cancel-refund', kind: 'body' });
});
