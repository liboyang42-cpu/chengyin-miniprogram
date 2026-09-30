const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('合作分润降级为结算来源筛选，tab=3 只保留兼容归一化', () => {
  const route = read('pages/merchant/utils/merchant-finance.js');
  const ledger = read('pages/merchant/ledger/index.wxml');
  assert.match(route, /legacy === '3'.*view: 'settlement', source: 'coop'/s, '旧 tab=3 必须归一化为结算的 coop 来源');
  assert.doesNotMatch(ledger, /经营信用|合作评分|提现/, '已撤销的合作资金中心不得留在页面');
});
