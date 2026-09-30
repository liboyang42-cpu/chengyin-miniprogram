const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 商家 AI 店铺参谋(真源 = vault04《商家AI店铺参谋_打卡分析与活动建议_20260820》)的前端契约:
// ① 营销页有入口且 go() 有对应分支;② 页面注册进 subpackageMerchant;
// ③ type→路由映射与后端 sanitize 白名单一致(三枚举,无 self_event);
// ④ AI 降级不连坐数据区;⑤ 数字位一律是数:null 指标写 0(2026-09-19 用户裁决),
//    「算不出」这句实话改由 lowSample 提示承担,不再由数字位的横杠承担。

const MARKETING_JS = fs.readFileSync(path.join(__dirname, '../../pages/merchant/marketing/index.js'), 'utf8');
const PAGE_JS = fs.readFileSync(path.join(__dirname, '../../pages/merchant/marketing/ai-insight/index.js'), 'utf8');
const PAGE_WXML = fs.readFileSync(path.join(__dirname, '../../pages/merchant/marketing/ai-insight/index.wxml'), 'utf8');
const APP_JSON = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));

test('营销页 entries 有 AI 店铺参谋入口,go() 跳转到 ai-insight 页', () => {
  assert.match(MARKETING_JS, /action:\s*'aiInsight'/);
  assert.match(MARKETING_JS, /\/pages\/merchant\/marketing\/ai-insight\/index/);
});

test('店铺参谋入口与页面门禁按 MARKETING_READ(P4 #17-3),无此权限的岗位看不到也进不去', () => {
  assert.match(MARKETING_JS, /action:\s*'aiInsight'[^}]*permission:\s*'canReadMarketing'/,
    '运营/店长有 MARKETING_READ 才显示店铺参谋图标;核销员/财务没有,不许显示死入口');
  assert.match(PAGE_WXML, /<cy-access-gate[^>]*need="canReadMarketing"/,
    '页面门禁必须与后端 require(MARKETING_READ) 对齐,否则无权限岗位点进来吃 403');
});

test('ai-insight 页已注册进 pages/merchant 分包(tabBar 页在主包铁律不受影响:这是 navigateTo 子页)', () => {
  const merchant = APP_JSON.subPackages.find((sp) => sp.root === 'pages/merchant');
  assert.ok(merchant.pages.includes('marketing/ai-insight/index'));
});

test('跳转只走前端写死的路由,不 navigateTo 接口给的任意 url', () => {
  // 2026-09-18 UI-11:按用户稿 el3kyfRxhlH5i8AvQ6zCqF 1:2 删掉「建议活动」区块,
  // suggestion.type→路由表随之退场;推荐主题/空态只去合作中心。
  assert.match(PAGE_JS, /COOP_CENTER_ROUTE = '\/pages\/merchant\/coop-center\/index'/);
  assert.doesNotMatch(PAGE_JS, /self_event/, 'P0 不设自办活动枚举(链路未上线),别把它接回来');
  assert.doesNotMatch(PAGE_JS, /navigateTo\(\{\s*url:\s*(item|e\.|res|d\.)/, '路由不许由接口数据拼接');
});

test('页面调用 /api/ai/merchant/insight 且不携带任何商家 id 参数', () => {
  assert.match(PAGE_JS, /url:\s*'\/api\/ai\/merchant\/insight'/);
  assert.doesNotMatch(PAGE_JS, /merchantId|merchantMemberId/,
    '接口按登录态取商家身份,前端传 id = 给越权留口子');
});

test('AI 降级不连坐:ai 为空时数据区照常、降级卡有说明文案', () => {
  assert.match(PAGE_WXML, /wx:else class="ai-card ai-card--down"/);
  assert.match(PAGE_WXML, /数据不受影响/);
});

test('数字位一律是数:null 指标写 0,不放横杠(2026-09-19 用户裁决,与营销页同口径)', () => {
  assert.match(PAGE_JS, /function numberOrNull\(value\)[\s\S]*?value === null \|\| value === undefined \|\| value === ''[\s\S]*?return null/);
  assert.match(PAGE_JS, /_countText\(v\)[\s\S]*?value === null \? '0'/);
  assert.doesNotMatch(PAGE_JS, /(['"])—+\1/, 'js 字符串字面量里不许再有破折号占位');
  // 数字位不再兼职表达状态 ⇒ 状态必须另有出口,否则「算不出」就被画成「真的是 0」
  assert.match(PAGE_WXML, /wx:if="\{\{\s*facts\.lowSample\s*\}\}"/,
    '样本不足提示是本页唯一的「这不是零」出口,删掉它 0 就成了谎话');
});

test('店铺档案:未配置置顶引导,配置页复用装修域合作设置(不重复造表单)', () => {
  assert.match(PAGE_JS, /PROFILE_SETUP_ROUTE = '\/pages\/merchant\/decor\/coop-setting\/index'/);
  assert.match(PAGE_WXML, /profile && !profile\.configured/);
  assert.match(PAGE_WXML, /先配置店铺档案/); // 2026-09-18 UI-11:引导收进 Hero 档案胶囊(稿 1:9)
});

test('实体推荐:推荐主题去合作中心申请,推荐商家走 canonical 商家主页(merchantHomeUrl/memberId)', () => {
  assert.match(PAGE_WXML, /为你推荐的主题/);
  assert.match(PAGE_WXML, /推荐联动的商家/);
  assert.match(PAGE_JS, /merchantHomeUrl\(/, '必须用统一的 merchantHomeUrl,不许手拼商家主页地址');
  assert.doesNotMatch(PAGE_JS, /merchant\/profile\/index/, '旧「承接商家」页已退役,不许再链过去');
});

// 跑真代码而不是读源码:把「后端全回 null」喂进页面自己的两个 builder,
// 看数字位到底吐出什么。只 require 页面、不调 onLoad,所以桩只需 Page/getApp。
function loadPageDefinition() {
  let definition = null;
  const previousPage = global.Page;
  const previousGetApp = global.getApp;
  const previousWx = global.wx;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({
    globalData: {},
    getUserID: () => 'merchant-a',
    sendRequest: () => {},
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  });
  global.wx = { getSystemInfoSync: () => ({ statusBarHeight: 44 }), setNavigationBarColor() {} };
  try {
    require(path.join(__dirname, '../../pages/merchant/marketing/ai-insight/index.js'));
  } finally {
    global.Page = previousPage;
    global.getApp = previousGetApp;
    global.wx = previousWx;
  }
  return definition;
}

test('后端全回 null 时,页面 builder 真的产出 0 而不是横杠(跑真代码)', () => {
  const page = loadPageDefinition();
  const facts = {
    window: '近30天',
    lowSample: true,
    attribution: { visitors: null, checkins: null, redeems: null },
    checkin: { total: null, redeemRate: null },
    crowd: { members: null, repeatRate: null, interestTop: [] },
    supply: { activeOffers: null, quotaUsedRate: null },
    sources: [],
  };
  const cards = page._buildMetricCards(facts);
  assert.deepEqual(cards.map((card) => card.num), ['0%', '0%']);
  assert.deepEqual(cards.map((card) => card.name), ['核销率', '复购率']);
  const valueCard = page._buildValueCard(facts);
  assert.deepEqual([valueCard.visitors, valueCard.checkins, valueCard.redeems], ['0', '0', '0']);
  // 环比仍然要「没有上期就不说上期」—— 这条不是数字位,不许拿 0 冒充可比
  assert.equal(valueCard.deltaText, '', '上期无基数时环比留空,不是 +0');

  // 负控:把 null 改回横杠,上面这些判据必须转红
  const regressed = PAGE_JS.replace("return value === null ? '0' : String(value);",
    "return value === null ? '—' : String(value);");
  assert.notEqual(regressed, PAGE_JS, '负控锚点失效:_countText 字面量已改名,扫描口径需同步');
  assert.match(regressed, /(['"])—+\1/);
});
