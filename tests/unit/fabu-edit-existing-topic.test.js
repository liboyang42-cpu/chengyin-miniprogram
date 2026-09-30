// [B3b] publish/fabu 编辑既有主题 —— 行为测试,不看源码文本。
//
// 病:项目列表的「草稿 / 未通过」卡、模板页「使用此模板」三个入口都带 ?id= 跳进编辑器,
// 但页面从不读 options.id、保存又只调 /api/topic/create ⇒ 打开是空白表单、保存是再新建一条,
// 原草稿纹丝不动,重复主题越攒越多。整条链路上没有任何报错 —— 只有钉死请求形状才抓得到。
//
// 承重不变量:
//  - 带 id 进入 → 必须先拉 /api/topic/edit-detail 回填 formData(名字/章节/票都要落到位)
//  - 保存 → 必须打 /api/topic/update 且 payload 带 id;绝不能再打 /api/topic/create
//  - 不带 id(新建)→ 行为不变,仍打 /api/topic/create 且 payload 不带 id
//  - editScope=WHITELIST(已过审开卖)→ 上送体必须剔掉日期/章节结构/票,只留白名单文案与图
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../pages/publish/fabu/index.js';

let sent = [];
let storage = {};
let navigations = [];
let toasts = [];
let modals = [];

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (p) => { sent.push(p); },
  tips: (m) => { toasts.push(m); },
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  chooseImage: () => {},
  getUserID: () => 0,
  getUserInfo: () => null,
  getToken: () => '',
});
global.wx = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: (o) => { toasts.push(o && o.title); },
  showLoading: () => {}, hideLoading: () => {},
  showModal: (options) => { modals.push(options); if (options.success) options.success({ confirm: true }); },
  navigateTo: (options) => { navigations.push(options.url); },
  redirectTo: (options) => { navigations.push(options.url); },
  createMapContext: () => ({ getCenterLocation: () => {} }),
  pageScrollTo: () => {}, nextTick: (f) => f(),
};

let pageConfig = null;
global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  sent = [];
  storage = {};
  navigations = [];
  toasts = [];
  modals = [];
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
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = patch[k];
    });
    if (cb) cb();
  };
  return inst;
}

test('俱乐部异步列表到达后立即刷新发布按钮状态', () => {
  const page = makePage();
  page.data.formData.clubId = '';
  page.data.canPublish = true;
  page.refreshPrimaryActionState = function () {
    const needsClub = this.data.myClubs.length > 0;
    this.setData({ canPublish: !needsClub || !!this.data.formData.clubId });
  };

  page.loadMyClubs();
  assert.equal(sent.length, 1);
  sent[0].success({
    code: '200',
    data: { owned: [{ id: 11, status: 1 }, { id: 12, status: 1 }] }
  });

  assert.equal(page.data.myClubs.length, 2);
  assert.equal(page.data.canPublish, false);
})

function editDetailFixture(editScope) {
  return {
    editScope: editScope || 'FULL',
    topic: {
      id: 77,
      name: '午夜巴士',
      subtitle: '一条老线路',
      description: '沿着 71 路走一遍',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      imgUrl: 'cover.jpg',
      imgArr: 'a.jpg,b.jpg',
      categoryIds: '3,4',
      productType: 1,
      merchantStatus: 1,
      openClubPool: 0,
      publishMode: 'pro',
      selfPlay: 1,
      selfPlayPrice: 9.9,
      selfPlayQuota: 50,
      finishMedalName: '夜行者',
      finishMedalImg: 'https://cdn.example.com/medal-night.png',
      completeRewardCouponId: 12,
    },
    chapters: [{
      id: 5,
      name: '第一章',
      cmsTopicNodeList: [{ id: 51, name: '外滩', address: '中山东一路', nodeTime: 20 }],
    }],
    tickets: [{ id: 9, name: '早鸟票', price: 19.9, totalInventory: 100, startTime: '2026-09-01', endTime: '2026-09-30' }],
    collaboratorIds: [201, 202],
  };
}

/** 带 id 打开编辑器,并把 edit-detail 的响应喂回去。 */
function openForEdit(editScope) {
  const page = makePage();
  page.onLoad({ id: '77' });
  const detailReq = sent.find((r) => r.url === '/api/topic/edit-detail');
  assert.ok(detailReq, '带 id 进入必须去拉主题详情回填,否则编辑器就是个空白新建表单');
  assert.equal(detailReq.data.id, '77');
  detailReq.success({ code: '200', data: editDetailFixture(editScope) });
  return page;
}

test('带 id 进入:拉 edit-detail 并把内容回填到 formData', () => {
  const page = openForEdit('FULL');

  assert.equal(page.data.editingTopicId, '77');
  assert.equal(page.data.formData.name, '午夜巴士');
  assert.equal(page.data.formData.subtitle, '一条老线路');
  assert.equal(page.data.formData.startDate, '2026-09-01');
  assert.deepEqual(page.data.selectedCategoryIds, ['3', '4']);
  // 章节的节点在后端叫 cmsTopicNodeList,编辑器叫 nodes —— 这层落差漏了就是「编辑一次丢光路线」
  assert.equal(page.data.formData.chapters.length, 1);
  assert.equal(page.data.formData.chapters[0].nodes.length, 1);
  assert.equal(page.data.formData.chapters[0].nodes[0].name, '外滩');
  // 票的库存字段两边也不同名
  assert.equal(page.data.formData.tickets.length, 1);
  assert.equal(page.data.formData.tickets[0].totalStock, 100);
  // 通关勋章图:漏了回填映射的话,编辑既有主题会静默把已传的勋章图清空 —— 保存后才发现。
  assert.equal(page.data.formData.finishMedalImg, 'https://cdn.example.com/medal-night.png',
    '通关勋章图必须回填,否则编辑主题会静默丢图');
  assert.deepEqual(page.data.formData.collaboratorIds, [201, 202]);
  assert.equal(page.data.formData.openMerchantPool, true, 'merchantStatus=1 → 进商家池');
  assert.equal(page.data.formData.selfPlay, true);
  assert.deepEqual(page.data.imgArrList, ['a.jpg', 'b.jpg']);
});

test('编辑详情拒绝数组对象及畸形章节/票种，保留原表单', () => {
  const malformed = [
    [],
    { topic: {}, chapters: {}, tickets: [], collaboratorIds: [] },
    { topic: {}, chapters: [null], tickets: [], collaboratorIds: [] },
    { topic: {}, chapters: [{ cmsTopicNodeList: [null] }], tickets: [], collaboratorIds: [] },
    { topic: {}, chapters: [], tickets: [null], collaboratorIds: [] },
    { topic: {}, chapters: [], tickets: [], collaboratorIds: [null] },
    { topic: {}, chapters: [], tickets: [], collaboratorIds: [{}] },
    { topic: {}, chapters: [], tickets: [], collaboratorIds: ['not-an-id'] },
  ];
  for (const data of malformed) {
    const page = makePage();
    page.data.formData.name = '原主题';
    page.loadEditingTopic('77');
    const request = sent.at(-1);
    assert.doesNotThrow(() => request.success({ code: '200', data }));
    assert.equal(page.data.editLoaded, false);
    assert.equal(page.data.formData.name, '原主题');
    assert.match(page.data.editLoadError, /主题|打开|重试/);
    assert.deepEqual(toasts, [], '畸形 payload 应留在可重试错误态，不应只弹 toast');
  }
});

test('节点玩法选择器拒绝非数组和空元素，不生成可点击伪选项', () => {
  for (const rows of [{}, [null]]) {
    const page = makePage();
    page.getTempList();
    const request = sent.at(-1);
    assert.doesNotThrow(() => request.success({ code: '200', data: { rows } }));
    assert.deepEqual(page.data.tempList, []);
  }
});

test('保存:走 /api/topic/update 且带 id,绝不再打 create', () => {
  const page = openForEdit('FULL');
  sent = [];

  page._doSubmit();

  const req = sent.find((r) => r.url === '/api/topic/update');
  assert.ok(req, '编辑保存必须打 update;打 create 就是原 bug —— 每保存一次多一条重复主题');
  assert.equal(sent.filter((r) => r.url === '/api/topic/create').length, 0);
  const body = JSON.parse(req.data);
  assert.equal(body.id, '77', 'update 不带 id 后端不知道改谁');
  assert.equal(body.name, '午夜巴士');
  assert.equal(body.chapters.length, 1, 'FULL 档要整包上送,章节结构可改');
});

test('不带 id(新建):行为不变,仍走 create 且不带 id', () => {
  const page = makePage();
  page.onLoad({});

  assert.equal(page.data.editingTopicId, '');
  assert.equal(sent.filter((r) => r.url === '/api/topic/edit-detail').length, 0,
    '新建不该去拉详情');
  sent = [];
  page._doSubmit();

  const req = sent.find((r) => r.url === '/api/topic/create');
  assert.ok(req, '新建仍必须走 create');
  assert.equal(JSON.parse(req.data).id, undefined);
});

test('editScope=WHITELIST:上送体只剩白名单文案与图,日期/章节/票被剔掉', () => {
  const page = openForEdit('WHITELIST');
  sent = [];

  page._doSubmit();

  const req = sent.find((r) => r.url === '/api/topic/update');
  assert.ok(req);
  const body = JSON.parse(req.data);
  // 能改的
  assert.equal(body.name, '午夜巴士');
  assert.equal(body.imgArr, 'a.jpg,b.jpg');
  assert.equal(body.categoryIds, '3,4');
  // 不能改的:已开卖的主题改这三样是资损。后端会当场拒收,前端先剔掉免得每次保存都撞
  assert.equal(body.startDate, undefined, '已开卖不得上送开始日期');
  assert.equal(body.endDate, undefined, '已开卖不得上送结束日期');
  assert.equal(body.chapters, undefined, '已开卖不得上送章节站点结构');
  assert.equal(body.tickets, undefined, '已开卖不得上送票种与价格');
});

test('WHITELIST 档改了票价:必须当场说清楚,不许静默剔掉后报「已保存」', () => {
  const page = openForEdit('WHITELIST');
  // 用户在编辑器里把票价改了
  page.data.formData.tickets[0].price = 999;
  sent = [];
  modals = [];

  page._doSubmit();

  assert.equal(sent.length, 0, '改了锁定字段就不该发请求 —— 发了就等于「保存成功但没生效」');
  assert.equal(modals.length, 1, '必须给一条可识别的拒绝信息,而不是默默吞掉');
  assert.ok(/票种与价格|不能再改/.test(modals[0].content), modals[0].content);
});

test('WHITELIST 档只改文案:照常保存', () => {
  const page = openForEdit('WHITELIST');
  page.data.formData.name = '午夜巴士(改名版)';
  sent = [];
  modals = [];

  page._doSubmit();

  assert.equal(modals.length, 0, '只改文案不该被拦');
  const req = sent.find((r) => r.url === '/api/topic/update');
  assert.ok(req);
  assert.equal(JSON.parse(req.data).name, '午夜巴士(改名版)');
});

test('回填还没到位就点保存:拦住,别拿空表单去重建', () => {
  const page = makePage();
  page.onLoad({ id: '77' });   // 详情请求在途,success 没回来
  sent = [];

  page.submitForm();

  assert.equal(sent.length, 0, 'FULL 档保存会整体重建章节/票,空表单存下去等于把原主题删空');
  assert.ok(toasts.some((t) => /加载/.test(String(t))), '要告诉用户为什么点不动:' + JSON.stringify(toasts));
});
