const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const WXML = 'components/cy/profile/index.wxml';
const WXSS = 'components/cy/profile/index.wxss';
const JS = 'components/cy/profile/index.js';

// 「我的资产」是与「我的订单」「我的项目」并列的第三段(2026-08-08 用户定),
// 资金相关全部收进这里。三段必须都在同一个 isSelf 分支里 —— 余额不能出现在别人主页上。
test('我的资产与订单、项目并列成第三段，且整段只在自己主页渲染', () => {
  const wxml = read(WXML);
  const order = wxml.indexOf('我的订单');
  const project = wxml.indexOf('我的项目');
  const asset = wxml.indexOf('我的资产');
  assert.ok(order > 0 && project > 0 && asset > 0, '三段标题必须都在');
  assert.ok(order < project && project < asset, '我的资产必须排在订单、项目之后');

  const selfBlock = wxml.indexOf("<block wx:if=\"{{isSelf && activeTab === 'projects'}}\">");
  assert.ok(selfBlock >= 0, 'isSelf + projects 的分支写法变了,本契约需要同步');
  const blockEnd = wxml.indexOf('<!-- ===== TAB · 推文 ===== -->');
  assert.ok(blockEnd > selfBlock, '找不到 projects 分支的结束位置');
  assert.ok(asset > selfBlock && asset < blockEnd,
    '我的资产必须落在 isSelf 分支内,否则别人主页也会看到余额');
});

// 空值口径不自己另写一套:money.wxs 已经定死「空 → 「—」、0 照常渲」,
// 且有 blank-value-display-contract 覆盖。这里只断言确实走了它。
test('余额走 money.amount 的既有空值口径，不另起一套判断', () => {
  const wxml = read(WXML);
  assert.match(wxml, /<wxs src="\.\.\/\.\.\/\.\.\/utils\/wxs\/money\.wxs" module="money" \/>/,
    'profile 必须引入 money.wxs');
  assert.match(wxml, /class="pc-asset__value[^>]*>\{\{money\.amount\(balanceText\)\}\}</,
    '余额必须由 money.amount 渲染');
  // 反面:不许在资产卡里手写裸 ¥ 或自己判空 —— 那就是第二套口径
  const card = wxml.slice(wxml.indexOf('class="pc-asset"'), wxml.indexOf('pc-asset__arrow'));
  assert.doesNotMatch(card, /¥/, '资产卡不许手写币符,¥ 由 money.amount 负责');
});

// 余额来自 /api/user/info 已有响应(自己看自己返回整个 UmsMember,balance 无 @JsonIgnore),
// 加这一段不许多打一次接口 —— profile 里那条「补一次请求去凑 = 新增接口调用(禁)」仍然生效。
test('余额读现有 userInfo，不新增接口调用', () => {
  const js = read(JS);
  assert.match(js, /balanceText:\s*formatBalance\(res\.data\.balance\)/,
    '余额必须从 /api/user/info 的既有响应里取');
  const added = js.match(/url:\s*'\/api\/(withdrawal|member\/balance|user\/balance)[^']*'/g) || [];
  assert.deepEqual(added, [], `不许为这一段新增资金接口调用,实际新增:${added}`);
});

// formatBalance 只负责小数位(money.wxs 明确不管各页小数口径),0 必须如实渲成 0.00,
// 非数字必须退成 null 交给 money.amount 渲「—」。
test('formatBalance 只做小数位:0 照常 0.00，非数字退 null', () => {
  const js = read(JS);
  const body = js.match(/function formatBalance\([\s\S]*?\n\}/);
  assert.ok(body, 'formatBalance 不见了');
  assert.match(body[0], /toFixed\(2\)/, '金额必须两位小数');
  assert.match(body[0], /=== *''/, '空串要当没取到,不能被 Number 静默变成 0');
  assert.match(body[0], /isFinite/, '非数字必须退 null,不能渲成 NaN');
  assert.doesNotMatch(body[0], /\|\|\s*0\b/, '不许用 || 0 兜底 —— 那会把「没取到」变成「你没有钱」');
});

test('资产卡的金额走 --cy-type-data-xl(DS 里金额唯一那档),不按数值凑标题 token', () => {
  const wxss = read(WXSS);
  assert.match(wxss, /\.pc-asset__value \{[^}]*--cy-type-data-xl/);
  assert.doesNotMatch(wxss, /\.pc-asset__value \{[^}]*--cy-type-(card|page|section)-title/,
    '金额位不许借标题语义的字号 token');
});

// 负控:把 money.amount 换成裸绑定(退化成直接渲原值)必须判红,
// 否则上面那条「走 money.amount」是恒真断言。
test('负控:余额绕开 money.amount 直接渲原值必须判红', () => {
  const mutated = read(WXML).replace('{{money.amount(balanceText)}}', '{{balanceText}}');
  assert.doesNotMatch(mutated, /money\.amount\(balanceText\)/, '变异未生效,负控本身是假的');
  assert.throws(() => assert.match(mutated, /class="pc-asset__value[^>]*>\{\{money\.amount\(balanceText\)\}\}</));
});
