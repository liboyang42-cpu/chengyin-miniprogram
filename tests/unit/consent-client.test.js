const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConsentClient } = require('../../utils/compliance/consent-client.js');

test('同意请求生成幂等标识并提交到合规接口', async () => {
  let request;
  const client = createConsentClient({
    now: () => 1720000000000,
    random: () => 'abc123',
    sendRequest: (options) => {
      request = options;
      options.success({ code: 200 });
    },
  });

  await client.record({ docType: 'privacy_policy', scene: 'app_launch', eventType: 'AGREE' });

  assert.equal(request.url, '/api/compliance/consents');
  assert.equal(request.method, 'POST');
  // 后端是 @RequestBody:必须显式 JSON header + 手动 stringify,否则 request-client 默认发 urlencoded 被后端拒收
  assert.equal(request.header['Content-Type'], 'application/json');
  assert.equal(typeof request.data, 'string');
  const body = JSON.parse(request.data);
  assert.equal(body.docType, 'privacy_policy');
  assert.equal(body.scene, 'app_launch');
  assert.equal(body.eventType, 'AGREE');
  assert.equal(body.requestId, 'consent-1720000000000-abc123');
});

// sendRequest 一个回调都不回(隐私授权闸把请求吞了)时,Promise 必须自己 settle ——
// 否则 privacy-gate / deregister / 漫游出发这些把 UX 挂在它 resolve 上的调用方全部静默挂死。
test('sendRequest 永不回调时按超时 reject，不会挂死调用方', async () => {
  const client = createConsentClient({
    settleTimeoutMs: 5,
    sendRequest: () => {},   // 既不 success 也不 fail,模拟被隐私闸吞掉
  });

  await assert.rejects(
    client.record({ docType: 'privacy_policy', scene: 'roam_location', eventType: 'AGREE' }),
    /同意记录超时/
  );
});

// 超时兜底不能反过来把已经成功的请求也判超时,也不能 settle 两次。
test('正常回调早于超时时，超时兜底不改变结果', async () => {
  const client = createConsentClient({
    settleTimeoutMs: 5,
    sendRequest: (options) => setTimeout(() => options.success({ code: 200 }), 1),
  });

  const result = await client.record({ docType: 'privacy_policy', scene: 'roam_location', eventType: 'AGREE' });
  assert.match(result.requestId, /^consent-/);
  await new Promise((r) => setTimeout(r, 12));  // 跨过超时点,确认没有第二次 settle 抛未捕获拒绝
});

test('拒绝不支持的同意事件，且不发请求', async () => {
  const client = createConsentClient({
    sendRequest: () => assert.fail('不应发送请求'),
  });

  await assert.rejects(
    client.record({ docType: 'privacy_policy', scene: 'app_launch', eventType: 'UNKNOWN' }),
    /同意事件不合法/
  );
});
