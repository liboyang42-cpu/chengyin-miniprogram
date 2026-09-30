const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('C05 资金页统一以严格合同错误态收口，已退役的合作分润资金中心不复活', () => {
  const js = read('pages/merchant/ledger/index.js');
  const wxml = read('pages/merchant/ledger/index.wxml');
  assert.match(js, /isFinancePagePayload\(res\)/, '列表响应必须经过严格合同校验');
  assert.match(js, /section === 'overview' \? isFinanceObjectPayload\(res\) : isFinancePagePayload\(res\)/,
    '概览与列表独立请求后仍必须分别经过严格合同校验');
  assert.match(js, /fail: \(error\) => done\(error \|\| null\)/,
    '网络与 HTTP 权限错误必须保留错误对象并进入同一错误路径');
  assert.match(wxml, /<cy-error/, '错误态必须有显式重试组件');
  assert.doesNotMatch(`${js}\n${wxml}`, /\/api\/coop\/mybiz|creditSummary|合作评分|可提现余额/, '结算页不得恢复已撤销的信用、评分或提现中心');
});

test('C05 负控：将严格页合同换回 legacy 订单请求必须判红', () => {
  const js = read('pages/merchant/ledger/index.js');
  const noFallback = value => assert.doesNotMatch(value, /\/api\/merchant\/orders/, '错误回落不得读 OMS 订单');
  noFallback(js);
  assert.throws(() => noFallback(`${js}\n/api/merchant/orders`), /OMS 订单/);
});
