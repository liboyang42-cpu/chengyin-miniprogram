const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMerchantFinanceRoute, isFinancePagePayload } = require('../../pages/merchant/utils/merchant-finance.js');

test('legacy tabs normalize once while unknown values are business errors', () => {
  assert.deepEqual(normalizeMerchantFinanceRoute({ tab: '0' }), { view: 'redemptions', source: '' });
  assert.deepEqual(normalizeMerchantFinanceRoute({ tab: '2' }), { view: 'settlement', source: '' });
  assert.deepEqual(normalizeMerchantFinanceRoute({ tab: '3' }), { view: 'settlement', source: 'coop' });
  assert.deepEqual(normalizeMerchantFinanceRoute({ tab: '1' }), { view: 'messages', source: '' });
  assert.equal(normalizeMerchantFinanceRoute({ view: 'bad' }), null);
  assert.equal(normalizeMerchantFinanceRoute({ tab: '99' }), null);
});

test('only a complete finance page payload may render and neither error shape is legacy data', () => {
  assert.equal(isFinancePagePayload({ code: 500, data: { rows: [] } }), false);
  assert.equal(isFinancePagePayload({ code: 200, data: {} }), false);
  assert.equal(isFinancePagePayload({ code: 200, data: { rows: [], total: 0 } }), true);
});
