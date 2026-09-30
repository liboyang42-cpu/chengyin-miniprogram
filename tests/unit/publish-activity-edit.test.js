// 活动发布页复用为编辑：带 query id 则回填 /api/activity/info，保存走 /api/activity/update。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../pages/publish/activity/index.js';

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

function allowPublisher(page) {
  const home = last('/api/publish/home');
  assert.ok(home, '必须先回读身份');
  home.success({ code: '200', data: { role: 'club' } });
}

function activityInfoFixture() {
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
    categoryIds: '3,4',
    sysCategoryList: [
      { id: 3, categoryName: '城市定向' },
      { id: 4, categoryName: '夜行' },
    ],
    omsTicketList: [{
      id: 88,
      name: '早鸟票',
      price: 69,
      totalInventory: 30,
      remainingInventory: 30,
    }],
  };
}

test('带 id 进入：拉 /api/activity/info 回填表单，保存走 /api/activity/update 且带 id', () => {
  const page = makePage();
  page.onLoad({ id: '77' });
  allowPublisher(page);

  const info = last('/api/activity/info');
  assert.ok(info, '编辑必须先拉活动详情');
  info.success({ code: '200', data: activityInfoFixture() });

  assert.equal(page.data.formData.name, '外滩夜行');
  assert.equal(page.data.formData.tickets[0].id, 88);
  assert.equal(page.data.formData.tickets[0].totalStock, 30);
  assert.deepEqual(page.data.selectedCategoryIds, [3, 4]);

  page.data.canContinue = true;
  page.data.step = 2;
  page.submitForm();

  const update = last('/api/activity/update');
  assert.ok(update, '保存必须打 /api/activity/update');
  assert.equal(last('/api/activity/publish'), undefined, '编辑不得再打 publish');
  const payload = JSON.parse(update.data);
  assert.equal(payload.id, 77);
  assert.equal(payload.name, '外滩夜行');
  assert.equal(payload.tickets[0].id, 88);
});

test('不带 id：仍打 /api/activity/publish，payload 不带 id', () => {
  const page = makePage();
  page.onLoad({});
  allowPublisher(page);
  assert.equal(last('/api/activity/info'), undefined);

  page.setData({
    selectedCategoryIds: [1],
    'formData.name': '新活动',
    'formData.addressName': '外滩',
    'formData.description': '简介',
    'formData.startDate': '2026-09-20 19:00:00',
    'formData.endDate': '2026-09-20 21:00:00',
    'formData.templateId': 5,
    'formData.imgUrl': 'cover.jpg',
    'formData.tickets': [{ name: '标准票', price: 1, totalStock: 10, description: '' }],
  });
  page.data.canContinue = true;
  page.data.step = 2;
  page.submitForm();

  const publish = last('/api/activity/publish');
  assert.ok(publish, '新建仍走 publish');
  assert.equal(last('/api/activity/update'), undefined);
  const payload = JSON.parse(publish.data);
  assert.equal(payload.id, undefined);
});

test('封面上传失败时本地临时路径只能用于重试，不得进入发布请求', () => {
  const page = makePage();
  page.onLoad({});
  allowPublisher(page);
  page.setData({
    selectedCategoryIds: [1],
    'formData.name': '新活动',
    'formData.addressName': '外滩',
    'formData.description': '简介',
    'formData.startDate': '2026-09-20 19:00:00',
    'formData.endDate': '2026-09-20 21:00:00',
    'formData.templateId': 5,
    'formData.imgUrl': 'wxfile://tmp/failed-cover.jpg',
    'formData.tickets': [{ name: '标准票', price: 1, totalStock: 10, description: '' }],
    coverErrorIndexes: [0],
  });
  page.data.canContinue = true;
  page.data.step = 2;

  page.submitForm();

  assert.equal(last('/api/activity/publish'), undefined);
  assert.match(page.data.errors.imgUrl, /上传未完成/);
});


// CR-63(2026-09-15 裁决 15):已售出(有已支付报名)后时间与地点锁死。
// 前端只负责「点不动 + 说明原因」,真正的闸在服务端 /api/activity/update 与 /api/club/lead/edit-ops。
test('已售出(服务端 timeLocationLocked=true)：时间/地点点不动并说明原因', () => {
  const page = makePage();
  page.onLoad({ id: '77' });
  allowPublisher(page);
  const info = last('/api/activity/info');
  info.success({ code: '200', data: Object.assign(activityInfoFixture(), { timeLocationLocked: true }) });

  assert.equal(page.data.timeLocationLocked, true, '锁定态必须由服务端回包落地,前端不自己数报名');

  page.showStartTimePicker();
  assert.notEqual(page.data.timePicker.show, true, '已售出时不得打开时间面板');
  assert.ok(toasts.some((t) => String(t).includes('已售出')), '必须说明为什么点不动,实际:' + JSON.stringify(toasts));

  const before = toasts.length;
  page.choosePoiForNode();
  assert.ok(toasts.length > before, '地点同样点不动并说明原因');

  // 锁定只锁时间/地点:文字/图片照样能改并保存。
  page.setData({ 'formData.name': '改过的名字' });
  page.data.canContinue = true;
  page.data.step = 2;
  page.submitForm();
  const update = last('/api/activity/update');
  assert.ok(update, '已售出也要能保存文字修改');
  assert.equal(JSON.parse(update.data).name, '改过的名字');
});

test('未售出(服务端无锁定标记)：时间面板可正常打开', () => {
  const page = makePage();
  page.onLoad({ id: '77' });
  allowPublisher(page);
  last('/api/activity/info').success({ code: '200', data: activityInfoFixture() });

  assert.equal(page.data.timeLocationLocked, false);
  page.showStartTimePicker();
  assert.equal(page.data.timePicker.show, true, '未售出不得被误锁');
});

// ---------------------------------------------------------------------------
// 草稿续写落点:回填完不该恒从第 0 步重新点回去(#17 / F-DR-1)

function openEdit(override) {
  const page = makePage();
  page.onLoad({ id: '77' });
  allowPublisher(page);
  const info = last('/api/activity/info');
  const fixture = Object.assign(activityInfoFixture(), override || {});
  info.success({ code: '200', data: fixture });
  return page;
}

test('填完整的草稿:落在最后一屏(保存动作在那儿),不是第 0 步', () => {
  const page = openEdit();
  assert.equal(page.data.step, 2);
  assert.equal(page.data.canContinue, true, '最后一屏的完成判据要和落点判据同一份');
});

test('第 0 步还缺活动类型:留在第 0 步,不许越过没填完的那一屏', () => {
  const page = openEdit({ sysCategoryList: [], categoryIds: '' });
  assert.equal(page.data.step, 0);
});

test('第 0 步填齐、第 1 步缺封面:落在第 1 步', () => {
  const page = openEdit({ imgUrl: '' });
  assert.equal(page.data.step, 1);
});

test('缺起止时间的草稿:落在第 0 步且下一步置灰', () => {
  const page = openEdit({ startDate: '', endDate: '' });
  assert.equal(page.data.step, 0);
  assert.equal(page.data.canContinue, false);
});

test('只定位一次:用户自己翻回前面后,迟到的第二次回填不得把他拽走', () => {
  const page = openEdit({ imgUrl: '' });
  assert.equal(page.data.step, 1);

  page.goStep(0);
  page.applyExistingActivity(activityInfoFixture());

  assert.equal(page.data.step, 0, '回填是幂等的,落点不是');
});
