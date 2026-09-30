// E-09(club/detail 三处失败态) + E-10/E-12/E-13(守卫与终态)的状态合同。
// 每条都对应 E 组报告里的一条 P2/P3,负控方式写在断言旁。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeWxStub(navigations) {
  const nav = navigations || [];
  const noop = () => {};
  return {
    showToast: noop, navigateTo(o) { nav.push(o.url); }, navigateBack() { nav.push('__back__'); },
    redirectTo(o) { nav.push(o.url); }, switchTab(o) { nav.push(o.url); },
    stopPullDownRefresh: noop, getStorageSync: () => '', setStorageSync: noop, removeStorageSync: noop,
    getSystemInfoSync: () => ({}), pageScrollTo: noop, showModal: noop, showShareMenu: noop,
    setNavigationBarColor: noop, setBackgroundColor: noop, showLoading: noop, hideLoading: noop,
  };
}

function loadSimplePage(rel, appOverrides) {
  const requests = [];
  const navigations = [];
  let definition;
  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(o) { requests.push(o); },
    tips() {}, getUserID: () => 1001, getUserRole: () => 'club', getUserType: () => 'club',
    getAvatar: () => '', getNickname: () => '测试',
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  }, appOverrides);
  global.getApp = () => app;
  global.wx = {
    showToast() {}, navigateTo(o) { navigations.push(o.url); }, navigateBack() { navigations.push('__back__'); },
    redirectTo(o) { navigations.push(o.url); }, switchTab(o) { navigations.push(o.url); },
    stopPullDownRefresh() {}, getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getSystemInfoSync: () => ({}),
  };
  const abs = path.resolve(ROOT, rel);
  delete require.cache[abs];
  try {
    require(abs);
  } catch (e) {
    throw new Error('load ' + rel + ' failed: ' + e.message);
  } finally {
    global.Page = global.Page;
  }
  definition = global.__lastPageDefinition;
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback.call(this); },
  });
  return { page, requests, navigations };
}

function mountWithLastPage(rel, appOverrides, extraRequires) {
  const requests = [];
  const navigations = [];
  const toasts = [];
  let definition;
  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(o) { requests.push(o); },
    tips() {}, getUserID: () => 1001, getUserRole: () => 'club', getUserType: () => 'club',
    getAvatar: () => '', getNickname: () => '测试',
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  }, appOverrides);
  const file = path.resolve(ROOT, rel);
  // 被 Node 真 require 的 utils(merchant-theme 等)读调用时的全局 getApp/wx
  global.getApp = () => app;
  global.wx = makeWxStub(navigations);
  vm.runInNewContext(read(rel), {
    getApp: () => app,
    Page(p) { definition = p; },
    Component(p) { definition = p; },
    getCurrentPages: () => [{}, {}],
    setTimeout(fn) { if (fn) fn(); return 1; },
    clearTimeout() {}, console, Set, Date, JSON,
    require(id) {
      if (extraRequires && extraRequires[id]) return extraRequires[id];
      if (/utils\/toast\.js$/.test(id)) {
        const noop = (title) => { toasts.push(title); };
        return Object.assign(noop, { success: noop, error: noop, info: noop, warning: noop, hide() {} });
      }
      if (/utils\/(loading|modal)\.js$/.test(id)) return { show() {}, hide() {} };
      return require(path.resolve(path.dirname(file), id));
    },
    wx: makeWxStub(navigations),
  }, { filename: rel });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback.call(this); },
  });
  return { page, requests, navigations, toasts };
}

// ───────── E-09:club/detail 三处失败不许渲染成空 ─────────
function loadClubDetail() {
  const requires = {
    '../../../utils/motion.js': require('../../utils/motion.js'),
    '../../../utils/motion-preference.js': require('../../utils/motion-preference.js'),
    '../../../utils/scene-registry.js': { getScene: () => ({}) },
    '../../../utils/datetime': { toTimestamp: (v) => Date.parse(String(v).replace(' ', 'T')) || 0 },
    '../../../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
    '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
    '../../../utils/group-code-session.js': { buildGroupCodeIssuePayload: () => ({}), listGroupCodeActivities: () => [] },
    '../../../utils/merchant-home-link.js': require('../../utils/merchant-home-link.js'),
    '../../../utils/ticket-source.js': require('../../utils/ticket-source.js'),
    '../../../utils/response-shape.js': require('../../utils/response-shape.js'),
    '../../../utils/coop-invite-view.js': require('../../utils/coop-invite-view.js'),
    '../utils/club-event-calendar.js': require('../../pages/club/utils/club-event-calendar.js'),
    '../../../utils/feed-play-card.js': require('../../utils/feed-play-card.js'),
  };
  return mountWithLastPage('pages/club/detail/index.js', {}, requires);
}

test('E-09 club/detail:帖子/榜单/商家加载失败都留错误态,不许渲染成「还没有…」', () => {
  const { page, requests } = loadClubDetail();
  page.setData({ clubId: 9, club: { isOwner: true } });
  page.loadPosts();
  requests.find((r) => r.url === '/api/club/post/list').success({ code: 500, msg: '帖子服务不可用' });
  assert.equal(page.data.postsLoaded, true);
  assert.match(page.data.postsError, /帖子服务不可用/);

  page.loadLeaderboard();
  requests.find((r) => r.url === '/api/club/leaderboard').fail({ errMsg: 'request:fail' });
  assert.match(page.data.leaderboardError, /网络/);

  page.loadMerchants();
  requests.find((r) => r.url === '/api/club/merchants').fail({ errMsg: 'request:fail' });
  assert.match(page.data.merchantsError, /网络/);

  const wxml = read('pages/club/detail/index.wxml');
  assert.match(wxml, /wx:elif="\{\{postsError\}\}"/);
  assert.match(wxml, /wx:elif="\{\{leaderboardError\}\}"/);
  assert.match(wxml, /wx:if="\{\{merchantsError\}\}"/);
});

// ───────── E-12:缺参/无权限的终态出路 ─────────
test('E-12 topic-detail:缺 topicId 是终态,重试=返回而不是再打一次必失败的请求', () => {
  const { page, requests, navigations } = mountWithLastPage('pages/club/topic-detail/index.js');
  page.onLoad({ clubId: '9' });
  assert.equal(page.data.missingParam, true);
  assert.equal(page.data.loadError, true);
  const before = requests.length;
  page.onRetry();
  assert.equal(requests.length, before, '缺参时不许重发请求');
  assert.deepEqual(navigations, ['__back__'], '出口是返回');
  assert.match(read('pages/club/topic-detail/index.wxml'), /missingParam \? '返回上一页' : '重新加载'/);
});

test('E-12 topic-story:缺 topicId 是终态,重试=回去而不是死循环', () => {
  const { page, requests, navigations } = mountWithLastPage('pages/club/topic-story/index.js');
  page.onLoad({});
  assert.equal(page.data.missingParam, true);
  const before = requests.length;
  page.onRetry();
  assert.equal(requests.length, before);
  assert.deepEqual(navigations, ['__back__']);
  assert.match(read('pages/club/topic-story/index.wxml'), /missingParam \? '返回' : '重试'/);
});

test('E-12 group-code:权限失败单列 no-permission 态,给「进入俱乐部管理」出路,重试不再空转', () => {
  const { page, requests } = mountWithLastPage('pages/club/group-code/index.js');
  page.onLoad({ activityId: '701' });
  requests.find((r) => r.url === '/api/verify/groupcode/issue')
    .success({ code: 500, msg: '您没有该场次的团码核销权限' });
  assert.equal(page.data.state, 'no-permission');
  const before = requests.length;
  page.onRetry();
  assert.equal(requests.length, before, '无权限时重试不许再打必失败的接口');
  const wxml = read('pages/club/group-code/index.wxml');
  assert.match(wxml, /wx:elif="\{\{state === 'no-permission'\}\}"/);
  assert.match(wxml, /state === 'no-permission'[\s\S]{0,400}bindtap="goManage"/, '必须带进入俱乐部管理的出路');
});

// ───────── E-10/E-13:守卫 need 与后端准入对齐 ─────────
test('E-10 编辑资料深链:need 不再要 club:write(老管理员没有它),后端 policy 里 CLUB_LEGACY_ADMIN 只有 club:read', () => {
  const wxml = read('pages/club/edit/index.wxml');
  assert.match(wxml, /kind="club" need="club:read"/);
  assert.doesNotMatch(wxml, /need="club:write"/);
  const policy = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/access/club/ClubPermissionPolicy.java');
  const legacy = policy.match(/CLUB_LEGACY_ADMIN, permissions\(([\s\S]*?)\)\);/)[1];
  assert.match(legacy, /ClubPermission\.CLUB_READ/, '老管理员必须有 club:read(否则深链仍被挡)');
  assert.doesNotMatch(legacy, /ClubPermission\.CLUB_WRITE/, '老管理员确实没有 club:write —— 这就是原守卫过严的证据');
});

test('E-13 客户页守卫与后端 canGovernClub(MEMBER_MANAGE)对齐,列表返回即刷新', () => {
  const listWxml = read('pages/club/customers/index.wxml');
  const detailWxml = read('pages/club/customer-detail/index.wxml');
  assert.match(listWxml, /kind="club" need="club:member:manage"/);
  assert.match(detailWxml, /kind="club" need="club:member:manage"/);
  assert.doesNotMatch(listWxml, /need="club:member:list:read"/);

  const listJs = read('pages/club/customers/index.js');
  assert.match(listJs, /onShow\(\)/, '列表必须有 onShow 重载');
  assert.match(listJs, /this\.data\.state === 'ready'/, '只在有内容时重拉,不去覆盖错误态');

  // 后端判据出处:ClubMemberServiceImpl.canGovernClub 只认 MEMBER_MANAGE
  const svc = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/ClubMemberServiceImpl.java');
  const govern = svc.match(/public boolean canGovernClub\(Club club, Long actorId\)([\s\S]*?)\n    }/)[1];
  assert.match(govern, /ClubPermission\.MEMBER_MANAGE/);
});

// ───────── E-15 P3:一两行就能改对的文案/视觉/确认名 ─────────
test('E-15d 入会申请行按钮 hover 三元写对:动作在途时禁按压,其余保持 cy-pressed', () => {
  const wxml = read('pages/club/join-requests/index.wxml');
  assert.doesNotMatch(wxml, /hover-class="\{\{actingMemberId \? true : false \? 'none' : 'cy-pressed'\}\}"/,
    '原来的三元解析成 true ? true : (false ? none : pressed),禁用态 hover-class="true" 是个不存在的类');
  assert.equal((wxml.match(/hover-class="\{\{actingMemberId \? 'none' : 'cy-pressed'\}\}"/g) || []).length, 2,
    '拒绝/通过两个按钮都要修');
});

test('E-15f 场次工具加载失败不再谎报「没有可管理的具体场次」', () => {
  const { page, requests, toasts } = loadClubDetail();
  page.setData({ clubId: 9, club: { isOwner: true } });
  page._activityToolsLoading = false;
  page.openActivityTools({ currentTarget: { dataset: { id: 31 } } });
  // 业务失败(HTTP 200 + code 500)走的是 success 回调 —— 原来它和「真的没有场次」共用一句话
  requests.find((r) => r.url === '/api/topic/info-to-user').success({ code: 500, msg: '主题服务不可用' });
  assert.ok(toasts.includes('场次加载失败，请稍后重试'), '业务失败要给失败文案,实得:' + JSON.stringify(toasts));
  assert.ok(!toasts.includes('这个项目还没有可管理的具体场次'), '失败不许说成「没有场次」');

  // 真·空场次仍给「没有场次」文案(别把两态又混回去)
  const empty = loadClubDetail();
  empty.page.setData({ clubId: 9, club: { isOwner: true } });
  empty.page._activityToolsLoading = false;
  empty.page.openActivityTools({ currentTarget: { dataset: { id: 31 } } });
  empty.requests.find((r) => r.url === '/api/topic/info-to-user').success({ code: 200, data: { activityList: [] } });
  assert.ok(empty.toasts.includes('这个项目还没有可管理的具体场次'));
});

test('E-15g 解散确认框带的是俱乐部真名,而不是回退成「这一项」', () => {
  let opened = null;
  const { page } = mountWithLastPage('components/cy/scene-club-edit/index.js', {}, {
    './danger-actions.js': { open() {} },
    '../../../utils/danger-actions.js': { open() {} },
  });
  // 组件的方法体直接跑:selectComponent 返回一个记录 open() 参数的替身
  const host = {
    data: { isOwner: true, dissolving: false, saving: false, name: '夜行团', form: undefined },
    setData(patch) { Object.assign(this.data, patch); },
    selectComponent() { return { open(action, meta) { opened = { action, meta }; } }; },
  };
  page.methods.dissolveClub.call(host);
  assert.ok(opened, '必须真的调到三段式确认框');
  assert.equal(opened.action, 'club.dissolve');
  assert.equal(opened.meta && opened.meta.name, '夜行团',
    'name 必须取 data.name(=this.data.form 在组件里不存在,取它文案会回退成「这一项」)');
});
