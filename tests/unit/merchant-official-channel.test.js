const assert = require('node:assert/strict');
const test = require('node:test');

const channel = require('../../utils/merchant-official-channel.js');

test('邀约视图按后端状态回显承接阶段', () => {
  assert.equal(channel.decorateInvite({ status: 0 }).stage, '待你确认');
  assert.equal(channel.decorateInvite({ status: 1, auditStatus: 0 }).stage, '待后台确认');
  assert.equal(channel.decorateInvite({ status: 1, auditStatus: 1 }).stage, '已中标承接');
  assert.equal(channel.decorateInvite({ status: 2 }).stage, '已拒绝');
});

test('邀约报酬只从结构化合同生成，不从留言猜测', () => {
  assert.equal(channel.decorateInvite({ shareMode: 1, shareRate: 12.5, message: '固定补贴 999' }).reward, '分成 12.5%');
  assert.equal(channel.decorateInvite({ shareMode: 2, fixedFee: 30 }).reward, '固定 ¥30/人');
  assert.equal(channel.decorateInvite({ shareMode: 0 }).reward, '资源支持');
  assert.equal(channel.decorateInvite({ message: '固定补贴 999' }).reward, '报酬待官方确认');
});

test('拒绝动作必须携带用户填写的原因', () => {
  assert.deepEqual(channel.handlePayload(18, 2, '  档期冲突  '), {
    id: 18,
    status: 2,
    handleReason: '档期冲突',
  });
  assert.throws(() => channel.handlePayload(18, 2, '  '), /原因/);
});

test('可承接区只展示招募期且明确需要合作方的官方活动', () => {
  assert.equal(channel.isMerchantRecruitableEvent({ status: 1, fulfillmentPolicy: 'OPTIONAL_PARTNERS' }), true);
  assert.equal(channel.isMerchantRecruitableEvent({ status: 2, fulfillmentPolicy: 'REQUIRED_FULFILLMENT' }), true);
  assert.equal(channel.isMerchantRecruitableEvent({ status: 3, fulfillmentPolicy: 'REQUIRED_FULFILLMENT' }), false);
  assert.equal(channel.isMerchantRecruitableEvent({ status: 1, fulfillmentPolicy: 'SELF_RUN' }), false);
  assert.equal(channel.isMerchantRecruitableEvent({ status: 1 }), false);
});
