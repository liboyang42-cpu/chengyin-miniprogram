const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('商家台账只读资金域接口，详情用 recordType 和 recordId 路由', () => {
  const js = read('pages/merchant/ledger/index.js');
  assert.match(js, /\/api\/merchant\/finance\/redemptions/);
  assert.match(js, /\/api\/merchant\/finance\/overview/);
  assert.match(js, /\/api\/merchant\/finance\/settlement-entries/);
  assert.match(js, /\/api\/merchant\/finance\/public-transfer-batches/);
  assert.match(js, /recordType=\$\{item\.recordType\}&recordId=\$\{item\.recordId\}/);
  assert.doesNotMatch(js, /loadLegacyOrders|\/api\/merchant\/orders/);
});

test('旧 tab 只在路由 shim 出现，未识别值不能默认进入资金页', () => {
  const route = read('pages/merchant/utils/merchant-finance.js');
  assert.match(route, /if \(view === 'redemptions' \|\| view === 'settlement' \|\| view === 'messages'\)/);
  assert.match(route, /return null;/);
  assert.match(route, /legacy === '0'.*redemptions/s);
  assert.match(route, /legacy === '2'.*settlement/s);
});
