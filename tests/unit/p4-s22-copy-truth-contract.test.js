// 4-10 (S22-a):营销页 Hero「累计报名」实际是窗口值。
//
// hero 的数字来自 analytics.stages(近 7/30 天完整自然日窗口),切窗口数字就变,
// 文案却写「累计」= 每个数字都在说假话。改成跟窗口一致的「近 N 天报名」。
// 收入口径与时区不统一那一项按台账要求不动。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PAGE_PATH = path.join(ROOT, 'pages/merchant/marketing/index.js');
const WXML_PATH = path.join(ROOT, 'pages/merchant/marketing/index.wxml');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pageDefinition;
let requests;
let memberId;

function setByPath(target, dataPath, value) {
  const parts = dataPath.split('.').filter(Boolean);
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
}

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44 },
  getUserID: () => memberId,
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request) },
});
global.wx = {
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  navigateTo() {},
  setNavigationBarColor() {},
  setBackgroundColor() {},
};
global.Page = (definition) => { pageDefinition = definition; };

function loadPage() {
  pageDefinition = null;
  requests = [];
  memberId = 'merchant-a';
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  const page = Object.assign({}, pageDefinition);
  page.data = JSON.parse(JSON.stringify(pageDefinition.data));
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([dataPath, value]) => setByPath(this.data, dataPath, value));
    if (callback) callback();
  };
  return page;
}

function analyticsPayload(windowDays, signupCount) {
  const day = 24 * 60 * 60 * 1000;
  const endExclusive = Date.parse('2026-08-23T16:00:00.000Z');
  const currentStartInclusive = endExclusive - windowDays * day;
  const previousStartInclusive = currentStartInclusive - windowDays * day;
  const stage = (code, label, count) => ({
    code, label, currentCount: count || 0, previousCount: 0, changeRate: null,
  });
  return {
    semantics: 'INDEPENDENT_EVENT_COUNTS',
    windowDays,
    window: {
      timezone: 'Asia/Shanghai', basis: 'COMPLETE_CALENDAR_DAYS',
      previousStartInclusive, currentStartInclusive, endExclusive,
    },
    stages: [
      stage('BROWSE', '浏览'), stage('SIGNUP', '报名', signupCount), stage('PAYMENT', '支付'),
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

function marketingResponse(windowDays, signupCount) {
  return {
    code: 200,
    data: {
      recruiting: { count: 0, items: [] },
      coupons: { couponCount: 0, received: 0, verified: 0 },
      content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
      analytics: analyticsPayload(windowDays, signupCount),
    },
  };
}

function startMarketing(page) {
  page.onLoad();
  page.onShow();
  const access = requests.find((request) => request.url === '/api/merchant/access/me');
  access.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:marketing:read'],
    },
  });
  return requests.filter((request) => request.url.startsWith('/api/merchant/marketing-home')).at(-1);
}

test('4-10 营销 Hero 固定使用近 30 天口径,不再暴露已删除的窗口切换', () => {
  const page = loadPage();
  const request = startMarketing(page);
  request.success(marketingResponse(30, 42));
  request.complete();

  assert.equal(page.data.hero.value, '42');
  assert.equal(page.data.hero.label, '近 30 天报名', '30 天窗口的数字不能标成累计');
  assert.match(page.data.hero.ariaLabel, /近 30 天报名/);

  assert.equal(page.selectWindow, undefined);
  assert.equal(requests.some((item) => item.url.includes('windowDays=7')), false);

  const wxml = read('pages/merchant/marketing/index.wxml');
  assert.doesNotMatch(wxml, /累计报名/, '「累计」这个口径在这页不成立,别再写');
  assert.match(wxml, /\{\{hero\.label\}\}/, '标题必须由 hero 真源给,不许写死');
});

test('4-10 负控:把标签写回累计,窗口口径契约必须判红', () => {
  const source = read('pages/merchant/marketing/index.js');
  const mutated = source.replace(
    /function heroWindowLabel\(windowDays\) \{[\s\S]*?\n\}/,
    "function heroWindowLabel(windowDays) { return '累计报名'; }");
  assert.notEqual(mutated, source, '负控锚点失效');

  pageDefinition = null;
  requests = [];
  memberId = 'merchant-a';
  const vm = require('node:vm');
  const module_ = { exports: {} };
  vm.runInNewContext(mutated, {
    Page: global.Page,
    getApp: global.getApp,
    wx: global.wx,
    require: (id) => require(path.resolve(path.dirname(PAGE_PATH), id)),
    module: module_,
    exports: module_.exports,
    console,
    Promise,
    Object,
    Array,
    Number,
    String,
    Math,
    Date,
    isFinite,
    isNaN,
    JSON,
    setImmediate,
    setTimeout,
    clearTimeout,
    RegExp,
    Error,
  }, { filename: PAGE_PATH });
  assert.ok(pageDefinition, '变异体没有注册 Page');
  const page = Object.assign({}, pageDefinition);
  page.data = JSON.parse(JSON.stringify(pageDefinition.data));
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([dataPath, value]) => setByPath(this.data, dataPath, value));
    if (callback) callback();
  };
  const request = startMarketing(page);
  request.success(marketingResponse(30, 42));
  request.complete();
  assert.equal(page.data.hero.label, '累计报名', '变异体确实把窗口值标成了累计');
  assert.throws(() => assert.equal(page.data.hero.label, '近 30 天报名'));
});
