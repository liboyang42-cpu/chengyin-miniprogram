const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeProperties } = require('../../utils/analytics');

test('埋点属性仅保留非敏感标量，移除身份、联系方式、地址和用户内容', () => {
  const properties = sanitizeProperties({
    action: 'coupon_publish',
    publishCount: 3,
    phone: '13800138000',
    bankAccount: '6222021234567890',
    address: '上海市黄浦区',
    keyword: '用户输入的搜索词',
    name: '用户创建的活动名',
    openid: 'oAbc123',
    nested: { email: 'user@example.com' }
  });

  assert.deepEqual(properties, { action: 'coupon_publish', publishCount: 3 });
});

test('埋点属性拒绝疑似手机号、邮箱和长卡号文本值', () => {
  assert.deepEqual(sanitizeProperties({ note: '13800138000', code: '6222021234567890', label: 'user@example.com' }), {});
});
