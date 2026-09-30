const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const PAGE = path.join(ROOT, 'pages/merchant/coop-center/index.js');
const VIEW = path.join(ROOT, 'pages/merchant/coop-center/index.wxml');

function marketingHome(items) {
  return {
    code: 200,
    data: {
      recruiting: { count: items.length, items },
      coupons: { couponCount: 0, received: 0, verified: 0 },
      content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
      funnel: [],
    },
  };
}

function loadPage() {
  const requests = [];
  let definition;
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { requests.push(options); },
    getRequestErrorMessage(res, fallback) { return (res && res.msg) || fallback; },
    tips() {},
  });
  global.getCurrentPages = () => [{ route: 'pages/merchant/coop-center/index' }];
  global.wx = {
    navigateBack() {}, navigateTo() {}, reLaunch() {}, showActionSheet() {},
    showLoading() {}, hideLoading() {}, showModal() {}, showToast() {},
  };
  global.Page = (config) => { definition = config; };
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return { page, requests };
}

test('路线刷新单飞，失败时保留已有卡片并暴露可重试错误', () => {
  const { page, requests } = loadPage();

  page.loadRoutes();
  page.loadRoutes();
  assert.equal(requests.length, 1, '同一加载中的路线请求不得重复发出');
  requests[0].success(marketingHome([{
    id: 7, name: '夜游苏河', productType: 1,
    recruitDeadline: '2099-01-01 00:00:00', remainingMerchantCount: 3,
  }]));

  page.loadRoutes();
  assert.equal(requests.length, 2, '上一轮结束后应允许刷新');
  assert.equal(page.data.routesLoading, true);
  assert.equal(page.data.routes.length, 1, '刷新中不能先清空已有路线');
  requests[1].fail({ msg: '网络开小差' });

  assert.equal(page.data.routesLoading, false);
  assert.equal(page.data.routes.length, 1, '刷新失败不能把已有路线伪装成空态');
  assert.equal(page.data.routes[0].title, '夜游苏河');
  assert.match(page.data.routesError, /网络开小差/);
});

test('官方活动刷新单飞，失败时保留已有活动', () => {
  const { page, requests } = loadPage();
  page.loadEvents();
  page.loadEvents();
  assert.equal(requests.length, 1);
  requests[0].success({ code: 200, data: [{
    id: 11, title: '城市搭子节', status: 1, fulfillmentPolicy: 'OPTIONAL_PARTNERS',
  }] });

  page.loadEvents();
  requests[1].fail({ msg: '活动暂未更新' });
  assert.equal(page.data.events.length, 1);
  assert.equal(page.data.events[0].title, '城市搭子节');
  assert.match(page.data.eventsError, /活动暂未更新/);
});


function assertProgressiveStates(source) {
  // 稿 234:276:官方活动 / 广场 两个 tab 各管一路,首载失败各自整块报错(不再有「两路都失败」的合并页错)
  assert.match(source, /routesLoading && !routes\.length/, '路线首载应显示骨架');
  assert.match(source, /routesLoading && routes\.length/, '路线刷新中应保留内容并显示进度');
  assert.match(source, /routesError && !routes\.length[^>]*bind:retry="loadRoutes"/, '路线首载失败应显示可重试的整块错误');
  assert.doesNotMatch(source, /<cy-inline-error[^>]*routesError && routes\.length/, '路线刷新失败静默降级,不挂局部可重试错误');
  assert.match(source, /eventsLoading && !events\.length/, '官方活动首载应显示骨架');
  assert.match(source, /eventsLoading && events\.length/, '官方活动刷新中应保留内容并显示进度');
  assert.match(source, /eventsError && !events\.length[^>]*bind:retry="loadEvents"/, '官方活动首载失败应显示可重试的整块错误');
  assert.match(source, /<cy-icon name="arrow-right"/, '跳转提示必须复用真实图标');
  assert.doesNotMatch(source, /›/, '不允许用文字箭头冒充图标');
}

test('合作中心区分首载、刷新、空态、整块错误和局部错误', () => {
  assertProgressiveStates(fs.readFileSync(VIEW, 'utf8'));
});

test('负控：把路线局部错误横幅加回来会被状态契约判红', () => {
  const source = fs.readFileSync(VIEW, 'utf8');
  const broken = source.replace('</view>',
    '<cy-inline-error wx:if="{{routesError && routes.length}}" bind:action="retryRoutes" /></view>');
  assert.notEqual(broken, source);
  assert.throws(() => assertProgressiveStates(broken), /静默降级/);
});

test('负控：摘掉某一路首载错误的重试会判红', () => {
  const source = fs.readFileSync(VIEW, 'utf8');
  const broken = source.replace('bind:retry="loadEvents"', '');
  assert.notEqual(broken, source);
  assert.throws(() => assertProgressiveStates(broken), /官方活动首载失败/);
});
