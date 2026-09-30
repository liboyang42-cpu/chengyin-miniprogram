const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wxml = fs.readFileSync(path.join(__dirname, '../../pages/merchant/ledger/index.wxml'), 'utf8');

test('商家台账 WXML 是核销记录、结算和消息兼容三态，且没有信用评分页', () => {
  assert.match(wxml, /view === 'redemptions'/);
  assert.match(wxml, /view === 'settlement'/);
  // 2026-08-11 重排:状态从右列长句改成 cy-badge chip,右列只放金额位
  assert.match(wxml, /<cy-badge class="fin-row__chip" type="status" variant="\{\{item\.stateVariant\}\}" label="\{\{item\.stateText\}\}"/);
  assert.match(wxml, /收入明细/);
  assert.match(wxml, /对公结算/);
  assert.doesNotMatch(wxml, /tab===3|经营信用|合作评分/);
});
