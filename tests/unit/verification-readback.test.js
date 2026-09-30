const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

test('无法按目标事实关联时只打开核销记录，不得用页面加载事件解除 unknown 锁', () => {
  const { offerVerificationReadback } = require('../../utils/verification-readback.js');
  const resetKeys = [];
  let navigation;
  let modal;
  const offered = offerVerificationReadback('verify:T1', {
    reset(key) { resetKeys.push(key); },
  }, {
    showModal(options) { modal = options; },
    navigateTo(options) { navigation = options; },
  });

  assert.equal(offered, true);
  assert.equal(resetKeys.length, 0, '只弹提示时不得解锁');
  modal.success({ confirm: true });
  assert.equal(navigation.url, '/pages/merchant/ledger/index?view=redemptions');
  assert.equal(resetKeys.length, 0, '只打开页面仍不得解锁');
  assert.equal(navigation.events, undefined, '任意合法列表都不等于目标写事实，不能提供解锁事件');
  assert.deepEqual(resetKeys, []);
});

test('三个核销入口都提供记录查看，台账不得用任意成功列表伪造目标回读', () => {
  const files = [
    'pages/merchant/index/index.js',
    'components/cy/profile/index.js',
    'subpackageMember/components/scene-member-participation-detail/index.js',
  ];
  files.forEach(rel => {
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(source, /offerVerificationReadback\(key,\s*(?:that|this)\._verificationWorkflow\)/, rel);
  });
  const ledger = fs.readFileSync(path.join(ROOT, 'pages/merchant/ledger/index.js'), 'utf8');
  assert.doesNotMatch(ledger, /emitVerificationReadback|verificationReadbackComplete|readback=1/);
});
