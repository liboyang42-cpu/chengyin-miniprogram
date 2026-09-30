const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function assertFinanceLoadingContract(js, wxml) {
  assert.match(wxml, /<cy-skeleton wx:elif="\{\{loading && !hasLoaded\}\}" type="merchant-metric"/,
    '结算视图首次加载只显示同构金额骨架');
  assert.match(wxml, /<view class="ledger-redemption-content"[^>]*>[\s\S]*?<cy-skeleton wx:if="\{\{loading && !hasLoaded\}\}" type="list"/,
    '核销筛选 shell 下必须只替换同构列表骨架');
  assert.match(wxml, /<cy-error wx:elif="\{\{error && !hasLoaded\}\}"[^>]*title="核销记录加载失败"/,
    '核销首载错误必须在局部内容区拦截');
  assert.match(wxml, /<cy-error wx:elif="\{\{error && !hasLoaded\}\}"[^>]*title="结算数据加载失败"/,
    '结算首载错误必须先于任何内容态拦截');
  assert.match(wxml, /<cy-inline-error wx:if="\{\{error && hasLoaded\}\}"/,
    '刷新失败必须保留已确认数据并给出局部恢复动作');
  assert.match(js, /this\.setData\(\{ loading: true, error: false \}\)/, '重试/加载必须先回到骨架态');
  assert.doesNotMatch(wxml, /加载中(?:…|\.\.\.)?|¥\s*(?:—|--)/, '加载中不许渲染伪金额');
}

test('资金域 loading 只使用骨架，错误不显示伪金额', () => {
  assertFinanceLoadingContract(read('pages/merchant/ledger/index.js'), read('pages/merchant/ledger/index.wxml'));
});

test('负控：移除首载或局部错误闸必须判红', () => {
  const js = read('pages/merchant/ledger/index.js');
  const wxml = read('pages/merchant/ledger/index.wxml');
  const noRedemptionError = wxml.replace(
    '<cy-error wx:elif="{{error && !hasLoaded}}" size="lg" fill title="核销记录加载失败"',
    '<view wx:elif="{{error && !hasLoaded}}" size="lg" fill title="核销记录加载失败"',
  );
  assert.notEqual(noRedemptionError, wxml, '核销首载错误负控锚点失效');
  assert.throws(() => assertFinanceLoadingContract(js, noRedemptionError), /核销首载错误/);

  const noSettlementError = wxml.replace(
    '<cy-error wx:elif="{{error && !hasLoaded}}" size="lg" fill title="结算数据加载失败"',
    '<view wx:elif="{{error && !hasLoaded}}" size="lg" fill title="结算数据加载失败"',
  );
  assert.notEqual(noSettlementError, wxml, '结算首载错误负控锚点失效');
  assert.throws(() => assertFinanceLoadingContract(js, noSettlementError), /结算首载错误/);

  const noInlineError = wxml.replace('<cy-inline-error', '<view');
  assert.notEqual(noInlineError, wxml, '局部错误负控锚点失效');
  assert.throws(() => assertFinanceLoadingContract(js, noInlineError), /局部恢复动作/);
});
