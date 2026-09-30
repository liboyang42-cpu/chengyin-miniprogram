const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 2026-09-16:候选池页下线,报名候选(商家报名承接我主题节点)+ 确认占槽收编进
// 协作列表「收到的」;2026-09-17 用户拍板退役婉拒报名(后端端点与前端入口一并删除,见本文件)。
// 本文件钉住:聚合端点载荷、行整形、写动作单飞与回读、二次邀约弹窗、婉拒已退役,
// 以及四个旧入口全部改指铃铛(负控各不相同)。

function mount(backend, autoUrls = ['/api/coop/candidates/received']) {
  let definition;
  const requests = [];
  const navigations = [];
  const modals = [];
  const app = {
    globalData: {},
    getUserID: () => 1,
    sendRequest(o) {
      requests.push(o);
      if (autoUrls.indexOf(o.url) < 0) return;
      const res = backend[o.url];
      if (res) o.success(res);
    },
  };
  const file = path.join(ROOT, 'pages/coop/list/index.js');
  vm.runInNewContext(read('pages/coop/list/index.js'), {
    Page: (p) => { definition = p; },
    getApp: () => app,
    wx: {
      stopPullDownRefresh() {},
      nextTick: (cb) => cb(),
      navigateTo(o) { navigations.push(o.url); if (o.complete) o.complete(); },
    },
    setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (id.includes('/toast')) return () => {};
      if (id.includes('/modal')) return { show: (o) => modals.push(o) };
      if (id.includes('/loading')) return { show() {}, hide() {} };
      if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (id.includes('checkout')) return {};
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  return {
    page,
    requests,
    navigations,
    modals,
    byUrl: (url) => requests.filter((r) => r.url === url),
  };
}

const ROWS_OK = {
  code: 200,
  data: {
    rows: [
      {
        id: 11, memberId: 42, auditStatus: 0, addressName: '中山公园站',
        topicId: 200, topicName: '苏州河夜行',
        merchantName: '漫步咖啡', merchantLogo: 'logo.png', merchantMeta: '长宁区愚园路',
      },
      {
        id: 12, memberId: 43, auditStatus: 2, address: '桥下',
        topicId: 201, topicName: '外滩晨跑', merchantName: '', merchantLogo: '',
      },
    ],
  },
};

const CONFIRM_EVENT = {
  currentTarget: { dataset: { id: 11, topicid: 200, memberid: 42, name: '漫步咖啡', logo: 'logo.png', meta: '长宁区愚园路' } },
};

test('承接报名聚合:请求带 scope(缺省 {})、行带主题名与调配态文案,历史行置灰', () => {
  const { page, byUrl } = mount({ '/api/coop/candidates/received': ROWS_OK });
  page.loadReceivedRegs();

  const req = byUrl('/api/coop/candidates/received')[0];
  assert.deepEqual(JSON.parse(req.data), {}, '无操作域不夹带 scope');
  assert.equal(req.method, 'POST');

  const rows = page.data.receivedRegs;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].auditText, '待调配');
  assert.equal(rows[0].badgeTone, 'pending');
  assert.equal(rows[0].topicTitle, '苏州河夜行');
  assert.equal(rows[0].name, '漫步咖啡');
  assert.equal(rows[0].meta, '长宁区愚园路');
  assert.equal(rows[0].placeText, '中山公园站');
  assert.equal(rows[0].dim, false);

  assert.equal(rows[1].auditText, '已落选');
  assert.equal(rows[1].dim, true, '已落选只做历史展示');
  assert.equal(rows[1].name, '商家 #43', '缺店名回落编号,不冒充具名商家');
  assert.equal(rows[1].placeText, '桥下');
  assert.equal(page.data.receivedRegState, 'ready');
});

test('?scope=MERCHANT 带来商家员工口径:聚合请求按 owner 口径转发', () => {
  const { page, byUrl } = mount({ '/api/coop/candidates/received': ROWS_OK });
  page.onLoad({ tab: 'received', scope: 'MERCHANT' });
  assert.equal(page._operationScope, 'MERCHANT');
  page.loadReceivedRegs();
  assert.deepEqual(JSON.parse(byUrl('/api/coop/candidates/received')[0].data), { scope: 'MERCHANT' });
});

test('确认占槽:单飞、写 registrationId、成功后回读并给二次发邀约', () => {
  const { page, modals, navigations, byUrl } = mount({
    '/api/coop/candidates/received': ROWS_OK,
    '/api/coop/candidates/confirm': { code: 200 },
  });
  page.loadReceivedRegs();
  page.confirmReg(CONFIRM_EVENT);
  page.confirmReg(CONFIRM_EVENT);
  assert.equal(modals.length, 1, '连点必须被 _beginAction 单飞挡住');

  modals[0].success({ confirm: true });
  const writes = byUrl('/api/coop/candidates/confirm');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].data), { registrationId: 11 });

  const readsBefore = byUrl('/api/coop/candidates/received').length;
  writes[0].success({ code: 200 });
  assert.match(page.data.actionReceipt, /已确认「漫步咖啡」占住候选位置/);
  assert.equal(byUrl('/api/coop/candidates/received').length, readsBefore + 1, '占槽成功必须权威回读');
  assert.equal(modals.length, 2, '占位后必须给带条款邀约的下一步');
  assert.match(modals[1].content, /分账条款/);

  modals[1].success({ confirm: true });
  assert.equal(navigations[0], '/pages/coop/invite/index?type=0&toId=42'
    + '&toName=' + encodeURIComponent('漫步咖啡')
    + '&toLogo=' + encodeURIComponent('logo.png')
    + '&toMeta=' + encodeURIComponent('长宁区愚园路')
    + '&topicId=200');
});

test('确认占槽结果未知:回读列表且不得冒充完成', () => {
  const { page, modals, byUrl } = mount({ '/api/coop/candidates/received': ROWS_OK });
  page.loadReceivedRegs();
  page.confirmReg(CONFIRM_EVENT);
  modals[0].success({ confirm: true });
  const readsBefore = byUrl('/api/coop/candidates/received').length;
  byUrl('/api/coop/candidates/confirm')[0].fail({ errMsg: 'request:fail timeout' });
  assert.match(page.data.actionError, /网络/);
  assert.equal(page.data.actionReceipt, '');
  assert.equal(byUrl('/api/coop/candidates/received').length, readsBefore + 1, '未知结果必须回读');
});

test('确认占槽 4xx 是确定失败:只报错,不伪造回读', () => {
  const { page, modals, byUrl } = mount({ '/api/coop/candidates/received': ROWS_OK });
  page.loadReceivedRegs();
  page.confirmReg(CONFIRM_EVENT);
  modals[0].success({ confirm: true });
  const readsBefore = byUrl('/api/coop/candidates/received').length;
  byUrl('/api/coop/candidates/confirm')[0].success({ code: 409, msg: '该竞争位已有中标商家' });
  assert.equal(page.data.actionError, '该竞争位已有中标商家');
  assert.equal(byUrl('/api/coop/candidates/received').length, readsBefore);
});

test('婉拒报名已按用户拍板退役:页面无入口、无处理函数、无端点调用', () => {
  const wxml = read('pages/coop/list/index.wxml');
  // 只锁「承接报名」这一处的按钮与处理函数;俱乐部申请的「拒绝=婉拒」是另一条业务,不动。
  assert.doesNotMatch(wxml, /rejectReg|reg-reject/);
  const page = read('pages/coop/list/index.js');
  assert.doesNotMatch(page, /rejectReg|candidates\/reject/);
  const registry = JSON.parse(read('scripts/danger-action-registry.json'));
  assert.equal(registry.sites.some((site) => site.endpoint === '/api/coop/candidates/reject'), false,
    '危险动作登记表里的过期条目必须一起删除(D1 反向检查)');
});

test('★负控:删掉占槽成功后的回读 → 「必须回读」判据会红', () => {
  const source = read('pages/coop/list/index.js');
  const mutated = source.replace(
    "that._finishAction(actionKey, '已确认「' + toName + '」占住候选位置', '');\n            that.loadReceivedRegs();",
    "that._finishAction(actionKey, '已确认「' + toName + '」占住候选位置', '');",
  );
  assert.notEqual(mutated, source, '负控锚点失效:占槽回读不存在');

  let definition;
  const requests = [];
  const modals = [];
  const app = { globalData: {}, getUserID: () => 1, sendRequest: (o) => requests.push(o) };
  vm.runInNewContext(mutated, {
    Page: (p) => { definition = p; },
    getApp: () => app,
    wx: { stopPullDownRefresh() {}, nextTick: (cb) => cb(), navigateTo() {} },
    setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (id.includes('/toast')) return () => {};
      if (id.includes('/modal')) return { show: (o) => modals.push(o) };
      if (id.includes('/loading')) return { show() {}, hide() {} };
      if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (id.includes('checkout')) return {};
      return require(path.resolve(path.dirname(path.join(ROOT, 'pages/coop/list/index.js')), id));
    },
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  page.confirmReg(CONFIRM_EVENT);
  modals[0].success({ confirm: true });
  const write = requests.find((r) => r.url === '/api/coop/candidates/confirm');
  const readsBefore = requests.filter((r) => r.url === '/api/coop/candidates/received').length;
  write.success({ code: 200 });
  const readsAfter = requests.filter((r) => r.url === '/api/coop/candidates/received').length;
  assert.equal(readsAfter, readsBefore,
    '负控必须复现「不回读」;正控那条 readsAfter === readsBefore + 1 会因此判红');
});

test('入口清零:四个旧跳转全改指铃铛「收到的」/附近商家,页路径与 goCandidates 全仓消失', () => {
  const listWxml = read('pages/coop/list/index.wxml');
  assert.doesNotMatch(listWxml, /goCandidates/);
  assert.match(listWxml, /catchtap="goInviteOthers"[^>]*data-topicid="\{\{item\.topicId\}\}"/);

  const listJs = read('pages/coop/list/index.js');
  assert.doesNotMatch(listJs, /goCandidates/);
  assert.match(listJs, /goInviteOthers[\s\S]{0,220}pages\/coop\/nearby\/index\?topicId=/);

  const hostWxml = read('pages/topic/components/project-host/index.wxml');
  assert.match(hostWxml, /data-act="goReceivedApplies">查看收到的申请/);
  assert.doesNotMatch(hostWxml, /goCandidates|查看候选池/);

  const hostJs = read('pages/topic/merchantinfo/merchantinfo.js');
  assert.doesNotMatch(hostJs, /goCandidates|查看候选池/);
  assert.match(hostJs, /goReceivedApplies\(\)[\s\S]{0,160}pages\/coop\/list\/index\?tab=received/);

  const myWxml = read('subpackageA/pages/myproject/index.wxml');
  assert.match(myWxml, /data-k="received"[\s\S]{0,120}收到的申请/);
  assert.doesNotMatch(myWxml, /data-k="candidates"|查看候选池/);

  const myJs = read('subpackageA/pages/myproject/index.js');
  assert.doesNotMatch(myJs, /goCandidates/);
  assert.match(myJs, /goReceivedApplies\(\)[\s\S]{0,160}pages\/coop\/list\/index\?tab=received/);

  const app = JSON.parse(read('app.json'));
  const routes = app.pages.concat(app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)));
  assert.equal(routes.some((route) => route.includes('coop/candidates')), false, 'app.json 登记必须清零');
});

test('★负控:project-host 底栏改回旧 data-act → 入口断言必须红', () => {
  const original = read('pages/topic/components/project-host/index.wxml');
  const mutated = original.replace('data-act="goReceivedApplies"', 'data-act="goCandidates"');
  assert.notEqual(mutated, original, '负控锚点失效:新 data-act 不存在');
  assert.throws(() => assert.match(mutated, /data-act="goReceivedApplies">查看收到的申请/), assert.AssertionError);
});
