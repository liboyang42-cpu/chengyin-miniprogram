const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('结算首屏展示两条去向和单轨守恒，不展示提现或两去向合计', () => {
  const js = read('pages/merchant/ledger/index.js');
  const wxml = read('pages/merchant/ledger/index.wxml');
  assert.match(js, /personalNetDisplay/);
  assert.match(js, /personalGrossDisplay/);
  assert.match(js, /personalAdjustmentDisplay/);
  assert.match(wxml, /本月个人账户/);
  assert.match(wxml, /待对公结算/);
  assert.doesNotMatch(wxml, /可提现余额|提现|合计/);
});
