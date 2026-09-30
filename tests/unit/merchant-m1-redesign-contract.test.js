const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('M1 台账重设计已由资金域四页面接管，而不是旧 OMS 或 mybiz 页面', () => {
  const ledger = read('pages/merchant/ledger/index.js');
  const detail = read('pages/merchant/ledger/order-detail/index.js');
  const batch = read('pages/merchant/ledger/batch-detail/index.js');
  assert.match(ledger, /view: 'redemptions'/);
  assert.match(detail, /\/api\/merchant\/finance\/redemption-detail/);
  assert.match(batch, /\/api\/merchant\/finance\/public-transfer-batch-detail/);
  assert.doesNotMatch(`${ledger}\n${detail}\n${batch}`, /\/api\/merchant\/orders|mybiz/);
});
