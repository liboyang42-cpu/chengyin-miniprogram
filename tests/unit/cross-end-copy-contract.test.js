const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validationMethodLabel, VALIDATION_METHOD_LABELS } = require('../../utils/validation-method-labels.js');
const { summarizeOrderState } = require('../../utils/order-status.js');

const root = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// 审核清单 §7「跨端不一致」:同一个码/状态在不同页面必须是同一句话,真源只有一份。
test('核验方式码表:0-6 全有标签,四个消费方都读同一张表,不再各留副本', () => {
  assert.equal(validationMethodLabel(6), '偏好题组', '码 6 以前在三处副本里是空串');
  assert.equal(validationMethodLabel(0), '无需验证');
  assert.equal(validationMethodLabel('4'), '到店扫码');
  assert.equal(validationMethodLabel(7), '传感器挑战', '后端 ValidationMethod.APP_SENSOR=7');
  assert.equal(validationMethodLabel(8, '核验方式待确认'), '核验方式待确认');
  assert.equal(validationMethodLabel(8), '');
  // 没配码 ≠ 无需验证:null/空串必须走 fallback,不能被 Number('') === 0 变成「无需验证」
  assert.equal(validationMethodLabel(null, '核验方式待确认'), '核验方式待确认');
  assert.equal(validationMethodLabel('', '核验方式待确认'), '核验方式待确认');
  assert.equal(validationMethodLabel(undefined), '');
  assert.deepEqual(Object.keys(VALIDATION_METHOD_LABELS).map(Number).sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
  for (const rel of [
    'pages/merchant/citynode/create/index.js',
    'components/cy/scene-roam-poi-detail/index.js',
    'pages/club/topic-story/index.js',
    'pages/topic/merchantinfo/merchantinfo.js',
  ]) {
    const src = read(rel);
    assert.match(src, /require\('[./]+\/utils\/validation-method-labels\.js'\)/, `${rel} 必须读共享码表`);
    assert.doesNotMatch(src, /'文字作答'|'文字暗号'|'文字问答'/, `${rel} 不许再留本地副本`);
  }
  // topic-story 传原值:没配码走后端 validationMethodStr,不能先 Number() 再传(null → 0 → 「无需验证」)
  assert.match(read('pages/club/topic-story/index.js'), /validationMethodLabel\(tpl\.validationMethod\)/);
});

test('报名状态 3=已取消、4=已过期(后端 CmsRegistration 口径),不再落「订单状态更新中」;退款终态同词', () => {
  assert.equal(summarizeOrderState({ registrationStatus: 3 }).text, '已取消');
  const s4 = summarizeOrderState({ registrationStatus: 4 });
  assert.equal(s4.key, 'expired');
  assert.equal(s4.text, '已过期', '状态 4 以前落到「订单状态更新中」');
  assert.match(read('subpackageMember/signup/index.js'), /status === 4 \? '票已过期' : '票已取消'/);
  const refunded = summarizeOrderState({ refundApplication: { payoutStatus: 1 } });
  assert.equal(refunded.text, '已退款');
  const detail = read('components/cy/scene-member-order-detail/index.js');
  assert.doesNotMatch(detail, /退款已完成/);
  assert.match(detail, /stateKey === 'refunded' \? '已退款'/);
});

test('活动时间文案的非时间态回落到 activity-status 真源,列表页与漫游任务列表不再各说各话', () => {
  for (const rel of ['pages/activity/list/index.js', 'components/cy/scene-roam-task-list/index.js']) {
    const src = read(rel);
    const fn = src.slice(src.indexOf('function timeText'), src.indexOf('\n}', src.indexOf('function timeText')));
    assert.match(fn, /activityStatusText\((?:e|item)\.status\) \|\| '时间待确认'/, `${rel} timeText 兜底`);
    assert.doesNotMatch(fn, /'报名中'|'尚未开放'/, `${rel} 不许硬编码状态 0 的文案`);
  }
});
