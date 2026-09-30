process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/* 走查 G4 · 协作面的两条:
   CU-C-75 「查看收到的申请」落点是全局协作列表(入口按本主题计数,却看不到本主题) →
           协作列表支持按 topicId 过滤,入口带上本主题;
   CU-M-92 已接受邀约的「进入项目」传 ?id=,被 merchantinfo 当招商浏览 → 改传 ?topicId=。 */

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const stripWxmlComments = (source) => source.replace(/<!--[\s\S]*?-->/g, '');

const navigations = [];
const requests = [];
const wxCalls = [];

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 7,
  getUserRole: () => 'merchant',
  getUserType: () => 2,
  sendRequest: (options) => { requests.push(options); return { abort() {} }; },
  tips: (msg) => wxCalls.push({ kind: 'tips', message: String(msg) }),
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
});
global.wx = {
  navigateTo: (options) => navigations.push(options),
  reLaunch: () => {},
  navigateBack: () => {},
  nextTick: (fn) => fn(),
  showToast: (options) => wxCalls.push({ kind: 'toast', message: String(options && options.title) }),
  showLoading: () => {}, hideLoading: () => {}, pageScrollTo: () => {},
  getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32, bottom: 56, right: 368, width: 87 }),
};

function loadPage(relativePath) {
  let config = null;
  global.Page = (value) => { config = value; };
  delete require.cache[require.resolve(path.join(ROOT, relativePath))];
  require(path.join(ROOT, relativePath));
  return config;
}

function makePage(config, overrides) {
  const page = Object.assign({}, config);
  page.data = Object.assign(JSON.parse(JSON.stringify(config.data)), overrides || {});
  page.setData = (patch, cb) => {
    Object.keys(patch).forEach((key) => {
      if (key.indexOf('.') < 0) { page.data[key] = patch[key]; return; }
      const parts = key.split('.');
      let cur = page.data;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = patch[key];
    });
    if (cb) cb();
  };
  return page;
}

function reset() {
  navigations.length = 0;
  requests.length = 0;
  wxCalls.length = 0;
}

function findRequest(url) {
  return requests.filter((r) => r.url === url)[0] || null;
}

test('RUN-010:商家合作入口保留操作范围，邀约查询所属商家的主题', () => {
  reset();
  const relation = makePage(loadPage('pages/merchant/relation/index.js'));
  relation.goClubCoop({ currentTarget: { dataset: { id: 7 } } });
  const options = Object.fromEntries(new URL(navigations[0].url, 'https://local.test').searchParams);
  const invite = makePage(loadPage('pages/coop/invite/index.js'));
  invite.onLoad(options);
  assert.equal(findRequest('/api/topic/list').data.scope, 'MERCHANT');
  assert.equal(invite.data.presetTarget.toId, '7');
  assert.equal(invite._invitePayload('7').scope, 'MERCHANT');
});

test('RUN-010:先浏览俱乐部资料再邀约也保留商家范围，普通入口不强加范围', () => {
  reset();
  const previousApp = global.getApp;
  global.getApp = () => Object.assign(previousApp(), { getUserRole: () => 'player', getUserType: () => 0 });
  try {
    const relation = makePage(loadPage('pages/merchant/relation/index.js'));
    relation.goClub({ currentTarget: { dataset: { id: 7 } } });
    const options = Object.fromEntries(new URL(navigations.at(-1).url, 'https://local.test').searchParams);
    for (const [input, expected] of [[options, 'MERCHANT'], [{ id: '7' }, null]]) {
      const club = makePage(loadPage('pages/club/detail/index.js'));
      club.loadAll = () => {};
      club.onLoad(input);
      assert.equal(club.data.isMerchantViewer, expected === 'MERCHANT', '员工商家上下文必须显示发起合作入口');
      club.goClubCoop();
      const query = new URL(navigations.at(-1).url, 'https://local.test').searchParams;
      assert.equal(query.get('scope'), expected);
    }
  } finally { global.getApp = previousApp; }
});

test('CU-C-75:协作列表按入口带来的 topicId 过滤,范围可撤', () => {
  reset();
  const config = loadPage('pages/coop/list/index.js');
  const page = makePage(config);
  page.onLoad({ tab: 'received', topicId: '990030', topicName: encodeURIComponent('隔离主题') });
  assert.equal(page._topicFilter, '990030');
  assert.match(page.data.topicScopeText, /隔离主题/, '范围要写在页面上,不是默默少几行');

  page.load();
  const listReq = findRequest('/api/coop/list');
  assert.ok(listReq, '还是要拉全量(过滤只换显示,不改后端契约)');
  listReq.success({
    code: 200,
    data: {
      received: [
        { id: 1, inviteId: 1, status: 0, inviteType: 0, topicId: 990030, topicName: '本主题' },
        { id: 2, inviteId: 2, status: 0, inviteType: 0, topicId: 990001, topicName: '别的主题' },
      ],
      sent: [
        { id: 3, inviteId: 3, status: 0, inviteType: 0, topicId: 990030, topicName: '本主题' },
        { id: 4, inviteId: 4, status: 0, inviteType: 0, topicId: 990001, topicName: '别的主题' },
      ],
    },
  });
  assert.deepEqual(page.data.received.map((r) => String(r.inviteId)), ['1'], '收到的只留本主题');
  assert.deepEqual(page.data.sent.map((r) => String(r.inviteId)), ['3'], '我发出的也只留本主题');
  assert.deepEqual(page._sentAll.map((r) => String(r.inviteId)), ['3', '4'], '回邀约挂接仍用未过滤的那一份');

  reset();
  page.clearTopicFilter();
  assert.equal(page._topicFilter, '');
  assert.equal(page.data.topicScopeText, '');
  assert.ok(findRequest('/api/coop/list'), '取消范围后重新拉一次全局列表');
});

test('商家范围的协作列表发起新邀约时继续保留范围，普通入口保持原样', () => {
  for (const [options, expected] of [[{ scope: 'MERCHANT' }, 'MERCHANT'], [{}, null]]) {
    reset();
    const list = makePage(loadPage('pages/coop/list/index.js'));
    list.onLoad(options);
    list.goInvite();
    const query = new URL(navigations.at(-1).url, 'https://local.test').searchParams;
    assert.equal(query.get('scope'), expected);
  }
});

test('CU-C-75:没有 topicId 的行(平台官方邀约)不属于「这条主题的申请」', () => {
  reset();
  const config = loadPage('pages/coop/list/index.js');
  const page = makePage(config);
  page.onLoad({ topicId: '990030' });
  assert.deepEqual(
    page.applyTopicFilter([{ topicId: '990030' }, { topicId: null }, { topicId: '1' }]).map((r) => String(r.topicId)),
    ['990030'],
  );
  // 没带筛选时原样返回:这一改不许影响从合作中心正常进来的全局列表
  const all = makePage(config);
  all.onLoad({});
  assert.equal(all.applyTopicFilter([{ topicId: '1' }, { topicId: '2' }]).length, 2);
});

test('CU-C-75:入口那条范围提示与「看全部」在同一处(wxml)', () => {
  const wxml = stripWxmlComments(read('pages/coop/list/index.wxml'));
  assert.match(wxml, /wx:if="\{\{topicScopeText\}\}"[\s\S]{0,240}bindtap="clearTopicFilter"/,
    '范围提示要带回到全局的出口');
  const js = read('pages/coop/list/index.js');
  assert.match(js, /_topicFilter = options && options\.topicId/, 'onLoad 要读入口带来的 topicId');
});

test('CU-M-92:邀约进项目走 topicId=,由后端判身份进承接视图(不再落浏览页)', () => {
  reset();
  const config = loadPage('pages/coop/invite-detail/index.js');
  const page = makePage(config);
  page.data.box = 'received';
  page.data.invite = { inviteId: 5, status: 1, inviteType: 0, topicId: '990030', legacyReadonly: false };
  page.openAcceptedProject();
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, '/pages/topic/merchantinfo/merchantinfo?topicId=990030&scope=MERCHANT');
  /* 走查第二轮曾退回 ?id=(浏览视图),因为 /api/project/home 对「既不是发布者、也没有承接记录」
     的调用人直接拒 ⇒ 刚接受邀约的商家拿不到任何东西,只能看浏览页。
     第三轮改回 topicId= 的前提是后端认下「已接受的协作邀约」这层关系
     (ProjectHomeReadServiceImpl#findAcceptedMerchantInvite)。这条断言守的是这个前提:
     两边必须同时成立,只剩一边就是死胡同。 */
  assert.match(read('pages/coop/invite-detail/index.js'), /ProjectHomeReadServiceImpl/,
    '这个决定的证据要留在代码里,否则下一个人会当成 bug 再改一遍');
  const wxml = stripWxmlComments(read('pages/coop/invite-detail/index.wxml'));
  assert.match(wxml, />进入项目</);
  assert.doesNotMatch(wxml, /进入项目 \/ 配置承接/, '文案不得承诺「配置承接」这一步:邀约不产生点位');
});

test('CU-M-92:merchantinfo 收到 topicId 才去问 /api/project/home 判身份', () => {
  reset();
  const config = loadPage('pages/topic/merchantinfo/merchantinfo.js');
  const withTopicId = makePage(config);
  withTopicId.onLoad({ topicId: '990030', scope: 'MERCHANT' });
  assert.ok(findRequest('/api/project/home'), 'topicId 入口必须由后端判 host/join');
  reset();
  const withId = makePage(config);
  withId.onLoad({ id: '990030', scope: 'MERCHANT' });
  assert.equal(findRequest('/api/project/home'), null, 'id 入口按招商浏览处理(既有分支,不动)');
  assert.ok(findRequest('/api/topic/info-to-user') || findRequest('/api/topic/info-to-merchant'),
    'id 入口读的是主题投影');
});

test('CU-C-64:邀请表单不再退化成裸编号,并写明这是整主题合作', () => {
  const wxml = stripWxmlComments(read('pages/coop/invite/index.wxml'));
  assert.doesNotMatch(wxml, /topicName \|\| \('#' \+ topicId\)/, '不许再显示「#990030」这种裸编号');
  assert.match(wxml, /整主题合作邀请，不针对某个点位/, '要写清这张单的范围');
});
