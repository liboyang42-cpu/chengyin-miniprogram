const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function assertRedemptionEmptyValueContract(js, wxml) {
  // 2026-08-11 重排:右列统一成金额位,零现金渲染中性破折号;状态文案下沉成 chip。
  // 不变量不变:不得为 null/0 造出 ¥0,也不得把零现金说成「待主题结算」。
  assert.doesNotMatch(wxml, /fin-row__v[^>]*>\s*待主题结算/, '零现金不得被伪造成待主题结算');
  assert.match(wxml, /class="fin-row__v fin-row__v--\{\{item\.amountTone\}\}">\{\{item\.amountDisplay\}\}<\/text>/,
    '右列必须只渲染 amountDisplay(零现金由它给破折号)');
  assert.match(wxml, /label="\{\{item\.stateText\}\}"/, '状态必须展示服务端归因后的文案');
  assert.match(js, /row\.settlementAmount == null \|\| Number\(row\.settlementAmount\) === 0/, 'null 和已确认的 0 都不得生成金额显示模型');
  // v2:两种"没金额"要分开 —— 明确不产生现金给破折号,金额尚未成立给「待定」;都不得造 ¥0。
  assert.match(js, /item\.amountDisplay = item\.amountText != null \?/, '金额展示必须先判现金是否成立');
  assert.match(js, /NO_CASH_SETTLEMENT' \? '—' : '待定'/, "null 不得造 ¥0:零现金给破折号,未成立给「待定」");
  assert.doesNotMatch(wxml, /¥\{\{/, '所有金额符号必须包含在已校验的显示文本中');
  assert.doesNotMatch(wxml, /¥0\.00/, '待主题结算不得伪装成零金额');
}


test('核销记录的空值或零现金不生成裸 ¥ 或假 0', () => {
  assertRedemptionEmptyValueContract(read('pages/merchant/ledger/index.js'), read('pages/merchant/ledger/index.wxml'));
});

test('负控：把服务端展示态替成待主题结算必须判红', () => {
  const js = read('pages/merchant/ledger/index.js');
  const wxml = read('pages/merchant/ledger/index.wxml');
  const broken = wxml.replace(
    'class="fin-row__v fin-row__v--{{item.amountTone}}">{{item.amountDisplay}}</text>',
    'class="fin-row__v fin-row__v--{{item.amountTone}}">待主题结算</text>');
  assert.notEqual(broken, wxml, '负控锚点失效');
  assert.throws(() => assertRedemptionEmptyValueContract(js, broken), /零现金不得被伪造成待主题结算/);
});
