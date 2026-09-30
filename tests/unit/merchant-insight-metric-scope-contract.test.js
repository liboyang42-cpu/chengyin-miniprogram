/**
 * CU-M-46 / CU-M-84(2026-09-23 用户裁决 A)· 复购率与回头客口径混用。
 *
 * 走查现象:店铺参谋同一张屏上写着「复购率 50%」和「0 位回头」,读起来自相矛盾。
 * 实际是三个不同总体被并排在一张卡里:
 *   · 复购率 = 窗口内核销≥2次会员 ÷ 窗口内核销会员(MerchantInsightServiceImpl:repeatRate)
 *   · 副行「N 位顾客」= 窗口内 checkin 或 redeem 的 distinct(与百分比不同批人)
 *   · 副行「M 位回头」= **跨窗口**口径(窗口前也到过店),窗口内一个回头都没有也能是 50%
 *
 * 裁决 A:两个指标各加一行口径说明(分子/分母/时间窗);同卡三个口径不再并排混用。
 * 本契约跑真代码:把后端 facts 喂进页面的两个 builder,看卡面到底吐出哪几个数。
 *
 * 负控在测试内联:把副行改回旧的「N 位顾客 · M 位回头」,同一断言必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const PAGE_JS_PATH = 'pages/merchant/marketing/ai-insight/index.js';
const PAGE_JS = fs.readFileSync(path.join(ROOT, PAGE_JS_PATH), 'utf8');

/** 只 require 页面拿 definition,不跑 onLoad —— 桩只要 Page/getApp/wx。 */
function loadPageDefinition() {
  let definition = null;
  const file = path.join(ROOT, PAGE_JS_PATH);
  vm.runInNewContext(PAGE_JS, {
    Page: (value) => { definition = value; },
    getApp: () => ({ globalData: {}, getUserID: () => 'merchant-a', sendRequest() {}, getRequestErrorMessage: () => '' }),
    wx: { getSystemInfoSync: () => ({ statusBarHeight: 44 }), setNavigationBarColor() {} },
    console,
    require: (id) => require(path.resolve(path.dirname(file), id)),
  });
  return definition;
}

/** 走查那一刻的后端事实包:窗口内核销会员 2 人、其中 1 人核销≥2 次 ⇒ 50%;跨窗口回头 0 人。 */
const FACTS = {
  window: '近30天',
  sampleMembers: 2,
  lowSample: true,
  checkin: { total: 5, redeemRate: 2 / 5, avgWaitMinutes: 12, repeatRate: 0.5 },
  crowd: { members: 7, sexRatio: {}, ageBuckets: {}, levelBuckets: {}, interestTop: [] },
  split: { newVisitors: 2, returningVisitors: 0 },
};

test('复购率副行与百分比同一批人:核销顾客数,不再并排别的总体', () => {
  const page = loadPageDefinition();
  const repeat = page._buildMetricCards(FACTS).filter((card) => card.key === 'repeat')[0];
  assert.equal(repeat.num, '50%');
  assert.equal(repeat.sub, '基于 2 位核销顾客', '副行必须是百分比的分母那批人(facts.sampleMembers)');
  assert.doesNotMatch(JSON.stringify(repeat), /位顾客\s*·/, '「N 位顾客(到店或核销)」不是这个比率的分母,不许留在副行');
  assert.doesNotMatch(JSON.stringify(repeat), /位回头/, '跨窗口回头人数不属于这张卡(与百分比不同口径)');
});

test('两个指标各有一行口径:分子/分母/时间窗都写出来', () => {
  const page = loadPageDefinition();
  const cards = page._buildMetricCards(FACTS);
  const redeem = cards.filter((card) => card.key === 'redeem')[0];
  assert.match(redeem.scope, /^口径：/, '核销率缺口径行');
  assert.match(redeem.scope, /已核销报名数/, '口径必须写清分子');
  assert.match(redeem.scope, /近30天.*内报名数/, '口径必须写清分母与时间窗');
  assert.match(cards.filter((card) => card.key === 'repeat')[0].scope, /核销≥2次的会员/, '口径必须写清分子');
  assert.match(cards.filter((card) => card.key === 'repeat')[0].scope, /近30天内核销会员/, '口径必须写清分母与时间窗');
});

test('跨窗口回头客只在横条里出现,并带上自己的口径', () => {
  const page = loadPageDefinition();
  const split = page._buildSplit(FACTS);
  assert.equal(split.returningVisitors, 0);
  assert.equal(split.newVisitors, 2);
  assert.match(split.scope, /近30天内有到店的玩家/);
  assert.match(split.scope, /窗口前（全历史）也到过店的算回头客/, '跨窗口这件事必须写在卡上');
});

test('窗口文案跟着后端下发走,不写死近30天', () => {
  const page = loadPageDefinition();
  const cards = page._buildMetricCards(Object.assign({}, FACTS, { window: '近7天' }));
  assert.match(cards[0].scope, /近7天内报名数/);
  assert.match(cards[1].scope, /近7天内核销会员/);
});

test('负控:副行改回旧的「N 位顾客 · M 位回头」时必须判红', () => {
  const regressed = PAGE_JS.replace(
    "sub: '基于 ' + this._countText(facts && facts.sampleMembers) + ' 位核销顾客',",
    "sub: this._countText((facts && facts.crowd || {}).members) + ' 位顾客' + ' · ' + this._countText((facts && facts.split || {}).returningVisitors) + ' 位回头',"
  );
  assert.notEqual(regressed, PAGE_JS, '负控锚点失效:副行写法已改名,扫描口径需同步');
  const file = path.join(ROOT, PAGE_JS_PATH);
  let definition = null;
  vm.runInNewContext(regressed, {
    Page: (value) => { definition = value; },
    getApp: () => ({ globalData: {}, getUserID: () => 'merchant-a', sendRequest() {}, getRequestErrorMessage: () => '' }),
    wx: { getSystemInfoSync: () => ({ statusBarHeight: 44 }), setNavigationBarColor() {} },
    console,
    require: (id) => require(path.resolve(path.dirname(file), id)),
  });
  const repeat = definition._buildMetricCards(FACTS).filter((card) => card.key === 'repeat')[0];
  assert.throws(() => assert.equal(repeat.sub, '基于 2 位核销顾客'), assert.AssertionError);
  assert.match(repeat.sub, /位回头/);
});
