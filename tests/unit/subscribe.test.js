const { test } = require('node:test');
const assert = require('node:assert');
const { request, resolveTemplateIds, STATUS, TEMPLATES } = require('../../utils/subscribe.js');

function replaceWx(t, value) {
  const hadWx = Object.prototype.hasOwnProperty.call(global, 'wx');
  const previous = global.wx;
  if (value === undefined) delete global.wx;
  else global.wx = value;
  t.after(() => {
    if (hadWx) global.wx = previous;
    else delete global.wx;
  });
}

test('已配置 key → 对应模板 ID', () => {
  assert.deepStrictEqual(
    resolveTemplateIds(['signupSuccess', 'refund']),
    [TEMPLATES.signupSuccess, TEMPLATES.refund]
  );
});

test('未配置/未知 key 被过滤', () => {
  assert.deepStrictEqual(resolveTemplateIds(['signupSuccess', 'bogus', 'refund']),
    [TEMPLATES.signupSuccess, TEMPLATES.refund]);
  assert.deepStrictEqual(resolveTemplateIds(['nope']), []);
});

test('teamFormed 已随成团下线移除 → 视为未知 key 被过滤', () => {
  assert.deepStrictEqual(resolveTemplateIds(['teamFormed']), []);
  assert.strictEqual(TEMPLATES.teamFormed, undefined);
});

test('漫游召回模板未创建时在解析阶段跳过，不占用错误模板授权', () => {
  assert.deepStrictEqual(resolveTemplateIds(['roamRecall']), []);
  assert.strictEqual(TEMPLATES.roamRecall, '');
});

test('超过 3 个截前 3(防微信整体失败)', () => {
  const keys = ['signupSuccess', 'activityStart', 'refund', 'refundRejected'];
  const ids = resolveTemplateIds(keys);
  assert.strictEqual(ids.length, 3);
  assert.deepStrictEqual(ids, [TEMPLATES.signupSuccess, TEMPLATES.activityStart, TEMPLATES.refund]);
});

test('报名页实际请求的三项恰好 3 个、不被截掉 refund', () => {
  // 回归闸:此前是 ['signupSuccess','teamFormed','activityStart','refund'] 共 4 个,
  // 取前 3 把 refund 挤掉 ⇒ 退款到账通知从没被授权过。成团下线后必须恰好 3 个且含 refund。
  const ids = resolveTemplateIds(['signupSuccess', 'activityStart', 'refund']);
  assert.strictEqual(ids.length, 3);
  assert.ok(ids.indexOf(TEMPLATES.refund) >= 0, 'refund 必须在授权列表里');
});

test('空/缺参 → 空数组', () => {
  assert.deepStrictEqual(resolveTemplateIds([]), []);
  assert.deepStrictEqual(resolveTemplateIds(null), []);
  assert.deepStrictEqual(resolveTemplateIds(undefined), []);
});

test('顺序保留(调用方按重要性排序)', () => {
  const ids = resolveTemplateIds(['refund', 'signupSuccess']);
  assert.deepStrictEqual(ids, [TEMPLATES.refund, TEMPLATES.signupSuccess]);
});

test('授权成功返回业务 key 级的可判别结果', async (t) => {
  let phase = 'tap';
  replaceWx(t, {
    requestSubscribeMessage(options) {
      assert.strictEqual(phase, 'tap', '微信订阅 API 必须在 tap 的同步调用栈触发');
      options.success({ [TEMPLATES.coopInvited]: 'accept' });
    },
  });

  const pending = request(['coopInvited']);
  phase = 'after-tap';
  const result = await pending;
  assert.strictEqual(result.status, STATUS.ACCEPTED);
  assert.deepStrictEqual(result.acceptedKeys, ['coopInvited']);
  assert.deepStrictEqual(result.rejectedKeys, []);
});

test('用户拒绝与微信调用失败不会再压成同一个 null', async (t) => {
  replaceWx(t, {
    requestSubscribeMessage(options) {
      options.success({ [TEMPLATES.coopSettle]: 'reject' });
    },
  });
  const rejected = await request(['coopSettle']);
  assert.strictEqual(rejected.status, STATUS.REJECTED);
  assert.deepStrictEqual(rejected.rejectedKeys, ['coopSettle']);

  global.wx.requestSubscribeMessage = (options) => options.fail({ errCode: 500 });
  const failed = await request(['coopSettle']);
  assert.strictEqual(failed.status, STATUS.FAILED);
  assert.deepStrictEqual(failed.acceptedKeys, []);
});

test('接口不支持有独立结果，不会伪装成用户拒绝', async (t) => {
  replaceWx(t, undefined);
  const result = await request(['recruit']);
  assert.strictEqual(result.status, STATUS.UNSUPPORTED);
  assert.deepStrictEqual(result.requestedKeys, ['recruit']);
});

test('空模板跳过微信申请并且同一个 key 只告警一次', async (t) => {
  let requestCount = 0;
  const warnings = [];
  replaceWx(t, { requestSubscribeMessage() { requestCount += 1; } });
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  t.after(() => { console.warn = originalWarn; });

  const first = await request(['clubInterest', 'roamRecall']);
  const second = await request(['clubInterest', 'roamRecall']);

  assert.strictEqual(first.status, STATUS.NOT_CONFIGURED);
  assert.strictEqual(second.status, STATUS.NOT_CONFIGURED);
  assert.deepStrictEqual(first.unconfiguredKeys, ['clubInterest', 'roamRecall']);
  assert.strictEqual(requestCount, 0);
  assert.strictEqual(warnings.length, 1);
});
