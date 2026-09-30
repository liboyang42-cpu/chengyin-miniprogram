// CU-M-184(2026-09-24 走查):UI-06 起退款售后与核销并列在同一张列表里,
// 标题只写「核销记录」会让人把顶部「本月核销 3 笔」读成含退款、把「待处理」读成待核销。
// 锁两件事:标题与空态覆盖两类记录;汇总标签仍点名核销(它数的是服务端核销口径)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('CU-M-184:核销台账标题覆盖退款，汇总仍点名核销口径', () => {
  const js = read('pages/merchant/ledger/index.js');
  const wxml = read('pages/merchant/ledger/index.wxml');

  assert.match(js, /pageTitle: '核销与退款'/, '默认标题要覆盖列表里两类记录');
  assert.match(js, /route\.view === 'redemptions' \? '核销与退款'/, '按路由复位时也不能退回只说核销');
  assert.match(wxml, /aria-label="核销与退款"/, '读屏的区域名与可见标题一致');
  assert.match(wxml, /<text class="fin-summary__k">本月核销<\/text>/,
    '汇总标签点名核销,数字才不会被读成含退款');
  assert.match(wxml, /title="还没有记录" sub="顾客到店核销或发起退款后会显示在这里"/,
    '空态要说清这里会出现两类记录');

  const reverted = js.replace(/pageTitle: '核销与退款'/, "pageTitle: '核销记录'");
  assert.notEqual(reverted, js, '负控锚点失效:标题写法变了');
  assert.doesNotMatch(reverted, /pageTitle: '核销与退款'/, '标题退回「核销记录」必须判红');
});
