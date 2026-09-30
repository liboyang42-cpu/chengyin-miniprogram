const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_PATH = path.join(__dirname, '../../pages/merchant/apply/index.js');

function submitBlock() {
  const source = fs.readFileSync(SOURCE_PATH, 'utf8');
  const start = source.indexOf('submit() {');
  const end = source.indexOf('\n  onReapply()', start);
  assert.ok(start >= 0 && end > start, 'merchant apply submit block must remain discoverable');
  return source.slice(start, end);
}

function assertMerchantRequestContract(submit) {
  assert.match(submit, /url:\s*['"]\/api\/merchant\/merchant_registration['"]/);
  assert.match(submit, /method:\s*['"]POST['"]/);
  assert.match(submit, /data:\s*JSON\.stringify\(payload\)/,
    '裸对象会被 request-client 序列化为 urlencoded，后端 @RequestBody 不会进入业务方法');
  assert.match(submit, /header:\s*\{[\s\S]*?['"]Content-Type['"]\s*:\s*['"]application\/json['"]/,
    '商家入驻请求缺 JSON header 会静默失败');
}

test('商家入驻 @RequestBody 请求固定使用 JSON body 与 Content-Type', () => {
  assertMerchantRequestContract(submitBlock());
});

test('商家入驻请求契约的变异负控确实能变红', () => {
  const submit = submitBlock()
    .replace(/data:\s*JSON\.stringify\(payload\)/, 'data: payload')
    .replace(/header:\s*\{[\s\S]*?\n\s*\}/, '');
  assert.throws(() => assertMerchantRequestContract(submit), /urlencoded|Content-Type|application\/json/);
});
