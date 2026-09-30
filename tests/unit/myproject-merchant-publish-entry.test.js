// CU-M-05(9-25 裁决):商家在「我的项目·活动」也要看到「发布单场活动」入口。
// 判据从「本地 role 缓存 == club」换成店主的「项目管理」岗位权限,且往下三次跳转
// (新建 / 编辑 / 待审核卡续写)必须带 scope=MERCHANT —— 不带就是按俱乐部口径判身份,
// 商家自己发的活动反而被发布页拦回门外。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../subpackageA/pages/myproject/index.js';
const PROJECT_MANAGE = 'merchant:project:manage';

let sent = [];
let toasts = [];
let navigations = [];
let pageConfig = null;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (p) => { sent.push(p); },
  getUserID: () => 1,
  getAuthorization: () => 'tk-1',
  getToken: () => 'tk-1',
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
});
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast: (o) => { toasts.push(o && o.title); },
  showLoading: () => {},
  hideLoading: () => {},
  showModal: (o) => { if (o.success) o.success({ confirm: true }); },
  navigateTo: (o) => { navigations.push(o.url); },
  redirectTo: (o) => { navigations.push('redirect:' + o.url); },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  nextTick: (f) => f(),
  setNavigationBarColor: () => {},
  setNavigationBarTitle: () => {},
};

global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  sent = [];
  toasts = [];
  navigations = [];
  pageConfig = null;
  // roleGuard 是模块级单例,在途请求会跨用例粘连(上一条没回包的 flight 让下一条根本不发请求);
  // 连缓存一起重新 require,才测得到「每个用例都从干净的本地身份起步」。
  delete require.cache[require.resolve('../../utils/roleGuard.js')];
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const inst = Object.assign({}, pageConfig);
  inst.data = JSON.parse(JSON.stringify(pageConfig.data));
  inst.setData = function (patch) { Object.assign(inst.data, patch); };
  return inst;
}

function last(url) {
  return sent.filter((r) => r.url === url).pop();
}

function urlsSent() {
  return sent.map((r) => r.url);
}

function merchantAccess(permissions) {
  return {
    code: '200',
    data: {
      active: true,
      merchant: { id: 5, name: '外滩茶室', logo: 'logo.jpg' },
      roleCode: 'MERCHANT_OWNER',
      permissions: permissions,
    },
  };
}

function activityRow(overrides) {
  return Object.assign({
    id: 301,
    bizType: 'activity',
    title: '外滩夜行',
    projectTypeText: '商家活动',
    state: 'pending',
    stateText: '待审核',
    ownerType: 'member',
    signupCount: 0,
    viewCount: 12,
  }, overrides);
}

function loadActivities(page, rows) {
  page.setData({ typeTab: 'activity' });
  page.loadProjects();
  last('/api/project/my').success({ code: '200', data: { rows: rows, total: rows.length } });
}

// ---- 入口判据 --------------------------------------------------------------

test('商家态读岗位权限接口决定入口,不读本地 role 缓存', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });

  assert.ok(last('/api/merchant/access/me'), '必须回读 /api/merchant/access/me');
  assert.equal(last('/api/role/info'), undefined,
    '商家能不能发看项目管理权,不是全局 role;读缓存会把店长/核销员一视同仁,实际:' + JSON.stringify(urlsSent()));
  assert.equal(page.data.canPublishActivity, false, '回包前 fail-closed,入口先不出');
});

test('店主持「项目管理」→ 出现「发布单场活动」入口', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success(merchantAccess([PROJECT_MANAGE]));
  assert.equal(page.data.canPublishActivity, true);
});

test('核销员岗(active 但没有项目管理权)→ 不出入口', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success(merchantAccess(['merchant:verify', 'merchant:order:read']));
  assert.equal(page.data.canPublishActivity, false,
    '「进过商家页」不等于「能发活动」,否则核销员也能代表店铺发出去');
});

test('权限接口读失败 → 入口不出(fail-closed,不拿缓存兜一个 true)', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').fail({ msg: '网络异常' });
  assert.equal(page.data.canPublishActivity, false);
});

test('权限接口断网或 HTTP 异常 → 明确提示读取失败且撤掉旧权限', () => {
  const page = makePage();
  for (const response of [{ errMsg: 'request:fail' }, { msg: '服务暂不可用' }]) {
    page.setData({ canPublishActivity: true });
    page.loadMerchantPublishEntry();
    last('/api/merchant/access/me').fail(response);
    assert.equal(page.data.canPublishActivity, false);
  }
  assert.deepEqual(toasts, ['发布权限没能读取，请重试', '服务暂不可用']);
});

test('回包脏(缺 active/主体)→ 入口不出', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success({ code: '200', data: { permissions: [PROJECT_MANAGE] } });
  assert.equal(page.data.canPublishActivity, false);
});

test('俱乐部态仍走 roleGuard,不碰商家权限接口(负控)', () => {
  const page = makePage();
  page.onLoad({});
  assert.ok(last('/api/role/info'), '主理人那条路的判据没被换掉');
  assert.equal(last('/api/merchant/access/me'), undefined);
});

// ---- 往下跳转必须带 scope --------------------------------------------------

test('商家态新建活动带 scope=MERCHANT', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success(merchantAccess([PROJECT_MANAGE]));
  page.goCreateActivity();
  assert.equal(navigations[0], '/pages/publish/activity/index?scope=MERCHANT');
});

test('商家态编辑带 id + scope=MERCHANT', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success(merchantAccess([PROJECT_MANAGE]));
  loadActivities(page, [activityRow({ state: 'notStarted', stateText: '未开始' })]);

  const card = page.data.list[0];
  assert.equal(card._canEdit, true);
  page.editActivity({ currentTarget: { dataset: { item: card } } });
  assert.equal(navigations[0], '/pages/publish/activity/index?id=301&scope=MERCHANT');
});

test('商家态待审核卡直接进编辑器也要带 scope', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success(merchantAccess([PROJECT_MANAGE]));
  loadActivities(page, [activityRow({ state: 'pending' })]);

  page.onCardTap({ currentTarget: { dataset: { item: page.data.list[0] } } });
  assert.equal(navigations[0], '/pages/publish/activity/index?id=301&scope=MERCHANT');
});

test('俱乐部态三处跳转都不带 scope(负控:参数串台会被后端当商家主办)', () => {
  const page = makePage();
  page.onLoad({});
  last('/api/role/info').success({ code: '200', data: { role: 'club' } });
  loadActivities(page, [activityRow({ state: 'pending' })]);

  page.goCreateActivity();
  page.editActivity({ currentTarget: { dataset: { item: page.data.list[0] } } });
  page.onCardTap({ currentTarget: { dataset: { item: page.data.list[0] } } });

  assert.deepEqual(navigations, [
    '/pages/publish/activity/index',
    '/pages/publish/activity/index?id=301',
    '/pages/publish/activity/index?id=301',
  ], '实际:' + JSON.stringify(navigations));
});

test('列表请求跟着 scope 走,商家主办的那一份才回得来', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success(merchantAccess([PROJECT_MANAGE]));
  page.loadProjects();
  assert.equal(last('/api/project/my').data.scope, 'MERCHANT');
});
