/**
 * CU-M-51 / CU-M-86(2026-09-23 用户裁决 A)· 「N 张在投放」只数当前在发的券。
 *
 * 走查现象:营销页写「2 张券在投放」,点进去两张券里一张已停发、一张次日才生效;
 * 另一个样本写 3 张在投放,券管理页其中一张是已停发。后端两处聚合只剔 del_flag=2,
 * 把「已停发(4)/未开始(0)/已结束(2)」都算进了「在投放」。
 *
 * 裁决:只统计 status=1 且在有效期内的券;数字位与卡面文案对齐。
 * 前端这一侧负责两件事:① couponTotal 归一化(老 jar 不传时退回旧口径);
 * ② 空态只能按**券总数**判 —— 只剩停发券的商家不许被画成「还没有优惠券」。
 *
 * 负控在测试内联:空态判据改回只看 couponCount,第一条断言必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const PAGE_PATH = 'pages/merchant/marketing/index.js';
const PAGE_JS = fs.readFileSync(path.join(ROOT, PAGE_PATH), 'utf8');

function loadMarketingPage(source) {
  let definition = null;
  const requests = [];
  const app = {
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    getUserID: () => 'merchant-a',
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: (request) => { requests.push(request) },
    getSessionManager: () => ({ ensureSession: () => Promise.resolve({ ok: true }) }),
  };
  const file = path.join(ROOT, PAGE_PATH);
  vm.runInNewContext(source, {
    Page: (value) => { definition = value; },
    getApp: () => app,
    wx: {
      getSystemInfoSync: () => ({ statusBarHeight: 44 }),
      navigateTo() {}, setNavigationBarColor() {}, setBackgroundColor() {},
    },
    console,
    setTimeout, clearTimeout,
    require: (id) => require(path.resolve(path.dirname(file), id)),
  });
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach((key) => {
      const tokens = key.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
      let cursor = this.data;
      tokens.slice(0, -1).forEach((token) => {
        if (cursor[token] === undefined || cursor[token] === null) cursor[token] = {};
        cursor = cursor[token];
      });
      cursor[tokens[tokens.length - 1]] = patch[key];
    });
    if (typeof callback === 'function') callback();
  };
  page.data.merchantAccess.canReadMarketing = true;
  return { page, requests };
}

function analyticsPayload(windowDays = 30) {
  const day = 24 * 60 * 60 * 1000;
  const endExclusive = Date.parse('2026-08-23T16:00:00.000Z');
  const currentStartInclusive = endExclusive - windowDays * day;
  const previousStartInclusive = currentStartInclusive - windowDays * day;
  const stage = (code, label) => ({ code, label, currentCount: 0, previousCount: 0, changeRate: null });
  return {
    semantics: 'INDEPENDENT_EVENT_COUNTS',
    windowDays,
    window: {
      timezone: 'Asia/Shanghai', basis: 'COMPLETE_CALENDAR_DAYS',
      previousStartInclusive, currentStartInclusive, endExclusive,
    },
    stages: [
      stage('BROWSE', '浏览'), stage('SIGNUP', '报名'), stage('PAYMENT', '支付'),
      stage('VERIFY', '核销'), stage('REFUND_APPLY', '退款申请'),
    ],
    touchpoints: {
      coverage: 'PARTIAL', attributed: false,
      items: [
        { code: 'IN_APP_TOPIC', label: '主题入口', eventCount: 0 },
        { code: 'IN_APP_ACTIVITY', label: '活动入口', eventCount: 0 },
        { code: 'UNATTRIBUTED', label: '未归因', eventCount: 0 },
      ],
    },
  };
}

function marketingResponse(coupons, overrides) {
  return {
    code: 200,
    data: Object.assign({
      recruiting: { count: 0, items: [] },
      coupons,
      content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
      analytics: analyticsPayload(30),
    }, overrides || {}),
  };
}

function render(source, coupons, overrides) {
  const { page, requests } = loadMarketingPage(source);
  page.loadMarketingHome();
  const request = requests.filter((r) => r.url.indexOf('/api/merchant/marketing-home') === 0).pop();
  assert.ok(request, '必须读一次 marketing-home 聚合');
  request.success(marketingResponse(coupons, overrides));
  return page;
}

test('只剩已停发/未生效券:券堆仍在,写 0 张在投放,不画成「还没有优惠券」', () => {
  const page = render(PAGE_JS, { couponCount: 0, couponTotal: 3, received: 8, verified: 3 });
  assert.notEqual(page.data.couponCard, null, '有券(只是不在投放)的商家不许看到「还没有优惠券」');
  assert.equal(page.data.couponCard.title, '0 张在投放');
  assert.equal(page.data.couponCard.sub, '领取 8 · 核销 3');
  assert.equal(page.data.deckGhosts, 0, '零张在投放就不摆影卡');
  assert.equal(page.data.marketingDataState, 'ready', '有券的账号不是空态账号');
});

test('真的一张券都没有:才是空态', () => {
  const page = render(PAGE_JS, { couponCount: 0, couponTotal: 0, received: 0, verified: 0 });
  assert.equal(page.data.couponCard, null);
  assert.equal(page.data.deckGhosts, 0);
});

test('在投放的张数驱动标题与影卡;停发的券只进总数', () => {
  const two = render(PAGE_JS, { couponCount: 2, couponTotal: 3, received: 8, verified: 3 });
  assert.equal(two.data.couponCard.title, '2 张在投放');
  assert.equal(two.data.deckGhosts, 1);

  const many = render(PAGE_JS, { couponCount: 4, couponTotal: 9, received: 1, verified: 1 });
  assert.equal(many.data.couponCard.title, '4 张在投放');
  assert.equal(many.data.deckGhosts, 2);
});

test('老 jar 不传 couponTotal:归一化退回旧口径,卡面不因此判空', () => {
  const { normalizeMarketingHome } = require('../../pages/merchant/utils/merchant-aggregate.js');
  const legacy = normalizeMarketingHome({
    recruiting: { count: 0, items: [] },
    coupons: { couponCount: 3, received: 8, verified: 3 },
    content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
    analytics: analyticsPayload(30),
  });
  assert.equal(legacy.coupons.couponTotal, 3, '缺 couponTotal 时退回 couponCount(两端可分别发布)');
  const page = render(PAGE_JS, { couponCount: 3, received: 8, verified: 3 });
  assert.equal(page.data.couponCard.title, '3 张在投放');
});

test('负控:空态判据改回只看 couponCount 时,第一条断言必须真红', () => {
  const regressed = PAGE_JS.replace(
    'if (!count && !total) return { couponCard: null, deckGhosts: 0, couponRate: \'\' };',
    "if (!count) return { couponCard: null, deckGhosts: 0, couponRate: '' };"
  );
  assert.notEqual(regressed, PAGE_JS, '负控锚点失效:空态判据已改名,扫描口径需同步');
  const page = render(regressed, { couponCount: 0, couponTotal: 3, received: 8, verified: 3 });
  assert.equal(page.data.couponCard, null);
  assert.throws(() => assert.notEqual(page.data.couponCard, null), assert.AssertionError);
});
