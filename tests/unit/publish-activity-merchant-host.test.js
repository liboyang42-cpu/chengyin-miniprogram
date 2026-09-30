// CU-M-05(9-25 裁决):商家可以主办单场活动。本文件钉死前端这一路的三件事 ——
// 判据换成岗位权限、主办身份跟着 scope 进 body、收款未落地前先只放开免费场。
// 真正的闸在服务端(ApiActivityController#resolveActivityPublisher),这里只保证
// 客户端不拿本地参数当放行依据,也不把「读不懂回包」说成「没权限」。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../pages/publish/activity/index.js';
const PROJECT_LIST = '/subpackageA/pages/myproject/index';
const FREE_ONLY = '商家主办活动还没开通收款，票价只能是 0';

let sent = [];
let navigations = [];
let toasts = [];
let pageConfig = null;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (p) => { sent.push(p); },
  tips: (m) => { toasts.push(m); },
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  chooseImage: () => {},
  getUserID: () => 9,
  getUserInfo: () => null,
  getToken: () => '',
});
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  showToast: (o) => { toasts.push(o && o.title); },
  showLoading: () => {},
  hideLoading: () => {},
  showModal: (o) => { if (o.success) o.success({ confirm: true }); },
  navigateTo: (o) => { navigations.push(o.url); },
  redirectTo: (o) => { navigations.push('redirect:' + o.url); },
  navigateBack: () => { navigations.push('back'); },
  pageScrollTo: () => {},
  nextTick: (f) => f(),
  previewImage: () => {},
};

global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  sent = [];
  navigations = [];
  toasts = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const inst = Object.assign({}, pageConfig);
  inst.data = JSON.parse(JSON.stringify(pageConfig.data));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let o = inst.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (o[parts[i]] == null) o[parts[i]] = {};
        o = o[parts[i]];
      }
      o[parts[parts.length - 1]] = patch[k];
    });
    if (cb) cb();
  };
  return inst;
}

function last(url) {
  return sent.filter((r) => r.url === url).pop();
}

function urlsSent() {
  return sent.map((r) => r.url);
}

const PROJECT_MANAGE = 'merchant:project:manage';

function merchantAccess(permissions) {
  return {
    active: true,
    merchant: { id: 5, name: '外滩茶室', logo: 'logo.jpg' },
    roleCode: 'MERCHANT_OWNER',
    permissions: permissions,
  };
}

function allowMerchant(page) {
  const access = last('/api/merchant/access/me');
  assert.ok(access, '商家态必须回读 /api/merchant/access/me');
  access.success({ code: '200', data: merchantAccess([PROJECT_MANAGE]) });
}

function filledTickets(tickets) {
  return {
    selectedCategoryIds: [1],
    'formData.name': '外滩夜行',
    'formData.addressName': '外滩',
    'formData.description': '简介',
    'formData.startDate': '2026-09-20 19:00:00',
    'formData.endDate': '2026-09-20 21:00:00',
    'formData.templateId': 5,
    'formData.imgUrl': 'cover.jpg',
    'formData.tickets': tickets,
  };
}

function openAsMerchant(tickets) {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  allowMerchant(page);
  page.setData(filledTickets(tickets));
  page.data.canContinue = true;
  page.data.step = 2;
  return page;
}

function existingFreeActivity() {
  return {
    id: 77,
    name: '外滩夜行',
    description: '沿江走一圈',
    imgUrl: 'cover.jpg',
    addressName: '外滩',
    longitude: '121.49',
    latitude: '31.24',
    address: '中山东一路',
    startDate: '2026-09-20 19:00:00',
    endDate: '2026-09-20 21:00:00',
    templateId: 5,
    categoryIds: '3',
    sysCategoryList: [{ id: 3, categoryName: '城市定向' }],
    omsTicketList: [{
      id: 88, name: '免费场', price: 0, totalInventory: 10, remainingInventory: 10,
    }],
  };
}

// ---- 判据:问哪个接口、认什么字段 ------------------------------------------

test('商家入口只读岗位权限接口,不再按俱乐部主理人判身份', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });

  assert.ok(last('/api/merchant/access/me'), '必须回读 /api/merchant/access/me');
  assert.equal(last('/api/publish/home'), undefined,
    '商家态还在读 /api/publish/home 就是拿俱乐部口径判商家,实际:' + JSON.stringify(urlsSent()));
  assert.equal(page.data.accessState, 'checking', '权威回包前不得出表单');
});

test('店主持「项目管理」→ 放行;回包缺这条权限 → 拒,且不发 publish', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success({
    code: '200',
    data: merchantAccess(['merchant:verify', 'merchant:crm:read']),
  });
  assert.equal(page.data.accessState, 'denied', '核销员/运营岗没有项目管理权');
  assert.match(page.data.deniedReason, /项目管理/,
    '被拒的话必须说清要哪条权限,实际:' + page.data.deniedReason);
  assert.equal(last('/api/activity/publish'), undefined);
});

test('回包脏到判不出身份 → 停在可重试错误态,不许说成「没权限」', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success({ code: '200', data: { permissions: [PROJECT_MANAGE] } });
  assert.equal(page.data.accessState, 'error',
    'active/主体/岗位任一层缺失是「读不懂」,与 club 线 role 非字符串同口径');
});

test('非商家(未申请)拿不到入口 → denied,不是错误态', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  last('/api/merchant/access/me').success({ code: '200', data: { active: false, applicationState: 'NONE' } });
  assert.equal(page.data.accessState, 'denied');
});

test('俱乐部线判据未受影响:仍读 /api/publish/home 认 role,不碰岗位权限接口', () => {
  const page = makePage();
  page.onLoad({});
  const home = last('/api/publish/home');
  assert.ok(home, '不带 scope 必须回读 /api/publish/home');
  assert.equal(last('/api/merchant/access/me'), undefined);
  home.success({ code: '200', data: { role: 'player' } });
  assert.equal(page.data.accessState, 'denied');
  assert.match(page.data.deniedReason, /俱乐部主理人/);
});

// ---- 归属:主办身份跟着 scope 进 body --------------------------------------

test('免费场发布:body 带 scope=MERCHANT,后端据此落到商家主体名下', () => {
  const page = openAsMerchant([{ name: '免费场', price: 0, totalStock: 10, description: '' }]);
  page.submitForm();

  const publish = last('/api/activity/publish');
  assert.ok(publish, '有项目管理权的店主必须发得出去');
  const payload = JSON.parse(publish.data);
  assert.equal(payload.scope, 'MERCHANT',
    '不带 scope 后端按登录人判主办,店员发的会记成店员个人');
});

test('编辑已有活动同样带 scope=MERCHANT', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT', id: '77' });
  allowMerchant(page);
  last('/api/activity/info').success({ code: '200', data: existingFreeActivity() });
  page.data.canContinue = true;
  page.data.step = 2;
  page.submitForm();

  const update = last('/api/activity/update');
  assert.ok(update, '商家续写自己的活动要走 update');
  const payload = JSON.parse(update.data);
  assert.equal(payload.id, 77);
  assert.equal(payload.scope, 'MERCHANT');
});

test('俱乐部主理人发布的 body 不得多出 scope(负控)', () => {
  const page = makePage();
  page.onLoad({});
  sent.filter((r) => r.url === '/api/publish/home').pop()
    .success({ code: '200', data: { role: 'club' } });
  page.setData(filledTickets([{ name: '标准票', price: 69, totalStock: 10, description: '' }]));
  page.data.canContinue = true;
  page.data.step = 2;
  page.submitForm();

  const publish = last('/api/activity/publish');
  assert.ok(publish);
  assert.equal(JSON.parse(publish.data).scope, undefined,
    '俱乐部那条路多带 scope 会被后端当商家主办解析,身份直接串台');
});

// ---- 收款缺口:商家这一路先只放开免费场 ----------------------------------

test('商家主办票价 > 0:当场挡住并说明,不发请求', () => {
  const page = openAsMerchant([{ name: '早鸟票', price: 69, totalStock: 10, description: '' }]);
  page.submitForm();

  assert.equal(last('/api/activity/publish'), undefined,
    '全仓没有 sub_mchid,付费场下单进的是平台商户号 —— 静默放过去等于替平台收钱');
  assert.ok(toasts.some((t) => String(t).indexOf(FREE_ONLY) >= 0),
    '必须给明确说明而不是静默失败,实际:' + JSON.stringify(toasts));
});

test('票价为字符串 "0" 不算付费(别把免费场误挡)', () => {
  const page = openAsMerchant([{ name: '免费场', price: '0', totalStock: 10, description: '' }]);
  page.submitForm();
  assert.ok(last('/api/activity/publish'), '"0" 必须发得出去');
});

test('多票种里任一票付费即挡(不能靠第一张蒙过去)', () => {
  const page = openAsMerchant([
    { name: '免费场', price: 0, totalStock: 10, description: '' },
    { name: '含茶位', price: 1, totalStock: 5, description: '' },
  ]);
  page.submitForm();
  assert.equal(last('/api/activity/publish'), undefined);
});

test('票面步常驻同一句免费场说明(toast 与页内说明单一真源)', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  assert.equal(page.data.merchantFreeOnlyMsg, FREE_ONLY);
});

// ---- 闭环:发完落回「我的项目」的商家那一份列表 ---------------- ----------

test('发布成功面板收掉 → 回「我的项目」必须带 scope=MERCHANT', () => {
  const page = makePage();
  page.onLoad({ scope: 'MERCHANT' });
  page.onResultSheetClose();

  assert.deepEqual(navigations, ['redirect:' + PROJECT_LIST + '?scope=MERCHANT'],
    '商家活动记在店主名下,不带 scope 回列表读的是个人/俱乐部那一份,刚发的那场不在里面');
});

test('俱乐部主理人发布后回列表不带 scope(负控)', () => {
  const page = makePage();
  page.onLoad({});
  page.onResultSheetClose();
  assert.deepEqual(navigations, ['redirect:' + PROJECT_LIST]);
});
