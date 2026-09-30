const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('退款售后列表和详情页已注册，台账退款条目直达售后详情', () => {
  // 2026-09-18 用户走查 UI-06:台账里「退款售后」不再单独一张卡片,
  // 退款条目并进 全部/待处理/已处理,点条目仍回售后详情。
  const app = JSON.parse(read('app.json'));
  const merchant = app.subPackages.find(item => item.root === 'pages/merchant');
  const ledgerWxml = read('pages/merchant/ledger/index.wxml');
  const ledgerJs = read('pages/merchant/ledger/index.js');

  assert.ok(merchant.pages.includes('aftercare/index'));
  assert.ok(merchant.pages.includes('aftercare/detail/index'));
  assert.doesNotMatch(ledgerWxml, /bindtap="goAftercare"/, '台账不得再渲染单独的退款售后卡片');
  assert.doesNotMatch(ledgerJs, /goAftercare\s*\(/, '台账不得再保留只服务那张卡的跳转方法');
  assert.match(ledgerJs, /\/api\/merchant\/access\/me/);
  assert.match(ledgerJs, /\/api\/merchant\/aftercare\/list\?bucket=/);
  assert.match(ledgerJs, /item\.recordType === 'aftercare'[\s\S]*?\/pages\/merchant\/aftercare\/detail\/index\?refundId=/);
});

test('商家工作台从更多菜单提供权限收口的退款售后入口', () => {
  const wxml = read('pages/merchant/index/index.wxml');
  const js = read('pages/merchant/index/index.js');

  assert.match(wxml, /wx:if="\{\{merchantAccess\.canReadAftercare\}\}"[^>]*data-action="aftercare"/);
  assert.match(wxml, /class="rv-aftercare-alert"[^>]*wx:if="\{\{merchantAccess\.canReadAftercare && !todoLoading && todo\.refundCount > 0\}\}"[^>]*bindtap="goAftercare"/,
    '有真实待回应售后时，必须在四个快捷操作下方直接显示高频待办');
  assert.match(wxml, /有 \{\{todo\.refundCount \|\| 0\}\} 笔售后待回应/);
  assert.match(js, /action === 'aftercare'[^\n]*goAftercare/);
  assert.match(js, /goAftercare\(\)[\s\S]*merchantAccess\.canReadAftercare[\s\S]*\/pages\/merchant\/aftercare\/index/);
});
