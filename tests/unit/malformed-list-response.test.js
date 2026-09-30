const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '../..');

function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach(part => { cursor = cursor[part] || (cursor[part] = {}); });
  cursor[parts.at(-1)] = value;
}

function harness(relativePath, kind) {
  const requests = [];
  const toasts = [];
  let definition;
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: { left: 300 } },
    sendRequest(options) { requests.push(options); },
    getRequestErrorMessage(_res, fallback) { return fallback; },
    getUserID() { return 7; },
    getUserRole() { return 'player'; },
    getUserType() { return 1; },
    getPageSize() { return 10; },
    getTotalPage() { return 1; },
    setUserRole() {},
    getImgUrl(value) { return value || ''; },
  };
  global.getApp = () => app;
  global.wx = {
    getStorageSync() { return ''; },
    getAccountInfoSync() { return { miniProgram: { envVersion: 'release' } }; },
    showToast(options) { toasts.push(options && options.title); }, showLoading() {}, hideLoading() {},
    stopPullDownRefresh() {}, pageScrollTo() {},
  };
  global.Page = value => { definition = value; };
  global.Component = value => { definition = value; };
  global.Behavior = value => value;
  const modulePath = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const vm = kind === 'component'
    ? Object.assign({}, definition, definition.methods || {})
    : Object.assign({}, definition);
  vm.data = JSON.parse(JSON.stringify(definition.data || {}));
  vm.setData = function (patch, callback) {
    Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value));
    if (callback) callback();
  };
  vm.triggerEvent = function () {};
  return { vm, requests, toasts };
}

test('分润详情的 topics 非数组时进入错误态而不崩溃', () => {
  const h = harness('components/cy/scene-merchant-profit/index.js', 'component');
  h.vm.load();
  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: { topics: {} } }));
  assert.equal(h.vm.data.loadErr, true);
});

test('分润详情 topics 包含空元素时进入错误态而不崩溃', () => {
  const h = harness('components/cy/scene-merchant-profit/index.js', 'component');
  h.vm.load();
  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: { topics: [null] } }));
  assert.equal(h.vm.data.loadErr, true);
});

test('漫游任务任一列表载荷非数组时整体进入错误态', () => {
  const h = harness('components/cy/scene-roam-task-list/index.js', 'component');
  h.vm.load();
  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: {} }));
  h.requests[1].success({ code: 200, data: [] });
  assert.equal(h.vm.data.state, 'error');
});

test('漫游任务数组包含空元素时整体进入错误态而不崩溃', () => {
  const h = harness('components/cy/scene-roam-task-list/index.js', 'component');
  h.vm.load();
  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: [null] }));
  h.requests[1].success({ code: 200, data: [] });
  assert.equal(h.vm.data.state, 'error');
});

test('会话列表 200 非数组载荷进入错误态', () => {
  const h = harness('subpackageB/pages/im/list/index.js', 'page');
  h.vm.loadConversations();
  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: {} }));
  assert.equal(h.vm.data.error, true);
});

test('会话列表和消息数组包含空元素时进入错误态而不崩溃', () => {
  const list = harness('subpackageB/pages/im/list/index.js', 'page');
  list.vm.loadConversations();
  assert.doesNotThrow(() => list.requests[0].success({ code: 200, data: [null] }));
  assert.equal(list.vm.data.error, true);

  const chat = harness('subpackageB/pages/im/chat/index.js', 'page');
  chat.vm.data.conversationId = 1;
  chat.vm.loadMessages(true);
  assert.doesNotThrow(() => chat.requests[0].success({ code: 200, data: { list: [null] } }));
  assert.equal(chat.vm.data.loadState, 'error');
});

test('我的参与 200 非数组载荷不能冒充空态', () => {
  const h = harness('subpackageMember/mycanyu/mycanyu.js', 'page');
  h.vm.getList();
  assert.doesNotThrow(() => h.requests[0].success({ code: '200', data: {} }));
  assert.equal(h.vm.data.errorMsg, '参与记录加载失败，请重试');
});

test('店铺洞察推荐商家非数组时显式报错', () => {
  const h = harness('pages/merchant/marketing/ai-insight/index.js', 'page');
  h.vm.load();
  assert.doesNotThrow(() => h.requests[0].success({
    code: 200,
    data: { facts: { attribution: {} }, recommendedPartners: {} },
  }));
  assert.equal(h.vm.data.error, '店铺数据加载失败');
});

test('店铺洞察列表包含空元素时显式报错而不崩溃', () => {
  const h = harness('pages/merchant/marketing/ai-insight/index.js', 'page');
  h.vm.load();
  assert.doesNotThrow(() => h.requests[0].success({
    code: 200,
    data: { facts: { attribution: {} }, recommendedPartners: [null] },
  }));
  assert.equal(h.vm.data.error, '店铺数据加载失败');
});

test('官方活动列表 200 非数组载荷进入可重试错误态', () => {
  const h = harness('pages/activity/list/index.js', 'page');
  h.vm.fetchAll();
  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: {} }));
  assert.equal(h.vm.data.loadError, true);
});

test('官方邀约 200 非数组载荷进入错误态', () => {
  const h = harness('pages/activity/official-inbox/index.js', 'page');
  h.vm.fetch();
  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: {} }));
  assert.equal(h.vm.data.error, '邀约加载失败');
});

test('官方邀约数组包含空元素时进入错误态而不崩溃', () => {
  const h = harness('pages/activity/official-inbox/index.js', 'page');
  h.vm.fetch();
  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: [null] }));
  assert.equal(h.vm.data.error, '邀约加载失败');
});

test('承接报名聚合载荷非数组时进入可重试错误态', () => {
  const h = harness('pages/coop/list/index.js', 'page');
  h.vm.loadReceivedRegs();
  assert.doesNotThrow(() => h.requests[0].success({
    code: '200', data: { rows: {} },
  }));
  assert.equal(h.vm.data.receivedRegState, 'error');
  assert.ok(h.vm.data.receivedRegErrorText);
});

test('承接报名聚合列表包含空元素时进入错误态而不崩溃', () => {
  const h = harness('pages/coop/list/index.js', 'page');
  h.vm.loadReceivedRegs();
  assert.doesNotThrow(() => h.requests[0].success({
    code: '200', data: { rows: [null] },
  }));
  assert.equal(h.vm.data.receivedRegState, 'error');
});

test('俱乐部首页聚合列表类型异常时显式可重试，不冒充附近空态', () => {
  const h = harness('pages/talent/list/index.js', 'page');
  h.vm.loadClubHome();
  assert.doesNotThrow(() => h.requests[0].success({
    code: '200', data: { owned: {}, joined: [], nearby: [], leaderStatus: {} },
  }));
  assert.equal(h.vm.data.clubsError, true);
});

test('俱乐部首页聚合列表包含空元素时显式可重试且不崩溃', () => {
  const h = harness('pages/talent/list/index.js', 'page');
  h.vm.loadClubHome();
  assert.doesNotThrow(() => h.requests[0].success({
    code: '200', data: { owned: [null], joined: [], nearby: [], leaderStatus: {} },
  }));
  assert.equal(h.vm.data.clubsError, true);
});

test('报名参与人列表包含空元素时提示加载失败且不崩溃', () => {
  const h = harness('pages/activity/baoming/baoming.js', 'page');
  h.vm.getAddressList();
  assert.doesNotThrow(() => h.requests[0].success({ code: '200', data: { rows: [null] } }));
  assert.equal(h.toasts.at(-1), '参与人信息加载失败，请重试');
});

test('首页列表包含空元素时进入显式错误态且不崩溃', () => {
  const h = harness('pages/index/index.js', 'page');
  h.vm.getListData('recommendedTopicList', '/api/topic/list', {});
  assert.doesNotThrow(() => h.requests[0].success({ code: '200', data: { rows: [null] } }));
  assert.equal(h.vm.data.listErr.recommendedTopicList, true);
});

test('广场帖子和评论列表包含空元素时进入错误态且不崩溃', () => {
  const feed = harness('pages/square/list/index.js', 'page');
  feed.vm.getList();
  assert.doesNotThrow(() => feed.requests[0].success({ code: '200', data: { rows: [null], total: 1 } }));
  assert.equal(feed.vm.data.loadError, true);

  const detail = harness('pages/square/detail/index.js', 'page');
  detail.vm.data.id = 9;
  detail.vm.getList();
  assert.doesNotThrow(() => detail.requests[0].success({ code: '200', data: { rows: [null], total: 1 } }));
  assert.equal(detail.vm.data.commentLoadError, true);
});

test('首页底部主题和活动列表包含空元素时提示失败且不崩溃', () => {
  // A-14-2 后失败落「失败页」行内重试标记(wxml 底部 cy-inline-error),不再只弹 toast。
  const topics = harness('pages/index/index.js', 'page');
  topics.vm.loadBottomTopicList(1, true);
  assert.doesNotThrow(() => topics.requests[0].success({ code: '200', data: { rows: [null], total: 1 } }));
  assert.equal(topics.vm.data.bottomTopicFailedPage, 1);

  const activities = harness('pages/index/index.js', 'page');
  activities.vm.loadBottomActivityList(1, true);
  assert.doesNotThrow(() => activities.requests[0].success({ code: '200', data: { rows: [null], total: 1 } }));
  assert.equal(activities.vm.data.bottomActivityFailedPage, 1);
});

test('收藏列表包含空元素时进入错误态且不崩溃', () => {
  const h = harness('pages/mylike/mylike.js', 'page');
  h.vm.getTopicLikeList();
  assert.doesNotThrow(() => h.requests[0].success({ code: '200', data: { rows: [null] } }));
  assert.equal(h.vm.data.errorMsg, '喜欢列表加载失败');
});

// 2026-09-07:合作池整块删除(用户拍板),这条只剩俱乐部动态流那一半。
// 「列表含空元素 → 进错误态而不是冒充真实空态」这条不变量本身没变。
test('俱乐部动态流包含空元素时进入错误态', () => {
  const feed = harness('pages/talent/list/index.js', 'page');
  feed.vm.loadFeed();
  assert.doesNotThrow(() => feed.requests[0].success({ code: '200', data: { rows: [null], clubCount: 1 } }));
  assert.equal(feed.vm.data.feedState, 'error');
});

test('节点玩法分类非数组时安全收敛为空列表', () => {
  const h = harness('pages/template/index.js', 'page');
  h.vm.getHome();
  assert.doesNotThrow(() => h.requests[0].success({ code: '200', data: { categoryList: {} } }));
  assert.deepEqual(h.vm.data.home.categoryList, []);
});

test('节点玩法首页、分类和主题模板货架都拒绝空元素', () => {
  // 2026-08-26:分类切换改成纯前端重排(不再发请求),玩法列表走 /api/template/list。
  // 「拒绝空元素」这条不变量原样保留,只是挂到新的三个入口上。
  const home = harness('pages/template/index.js', 'page');
  home.vm.getHome();
  assert.doesNotThrow(() => home.requests[0].success({
    code: '200', data: { categoryList: [null], bannerList: [null] },
  }));
  assert.deepEqual(home.vm.data.home.categoryList, [], '分类里混进 null 应整条收敛为空');

  const game = harness('pages/template/index.js', 'page');
  // 2026-08-27:失败半边按当前 tab 闸 —— 错误上屏只在游戏 tab 下发生,测试站到该 tab 上验
  game.vm.data.tab = 'game';
  game.vm.getGameRows();
  assert.doesNotThrow(() => game.requests[0].success({
    code: '200', data: { rows: [null] },
  }));
  assert.equal(game.vm.data.errorMsg, '玩法模板加载失败');

  const shelf = harness('pages/template/index.js', 'page');
  shelf.vm.getTopicTemplates();
  assert.doesNotThrow(() => shelf.requests[0].success({ code: '200', data: [null] }));
  assert.deepEqual(shelf.vm._topicRows, []);
});

test('参与详情 200 空载荷进入加载错误而不解引用崩溃', () => {
  const h = harness('subpackageMember/components/scene-member-participation-detail/index.js', 'component');
  h.vm.data.id = 7;
  h.vm.getData();
  assert.doesNotThrow(() => h.requests[0].success({ code: '200', data: null }));
  assert.equal(h.vm.data.loadState, 'error');
});

test('选章、玩家名单和本地草稿都不对非数组直接调用列表方法', () => {
  const sources = [
    'pages/merchant/index/index.js',
    'components/cy/profile/index.js',
    'pages/topic/merchantinfo/merchantinfo.js',
    'pages/play/index.js',
    'pages/publish/simple/index.js',
    'pages/publish/fabu/index.js',
  ].map(rel => fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  assert.doesNotMatch(sources[0], /\(d\.chapterIds \|\| \[\]\)\.map/);
  assert.doesNotMatch(sources[1], /\(d\.chapterIds \|\| \[\]\)\.map/);
  assert.match(sources[2], /isRecordList\(d\.rows\)/);
  // 2026-09-19 审查 #14:简易页的本地草稿恢复(draft.stations)随整条零绑定的发布链路删掉了,
  // 那里现在只剩服务端 AI 响应这一个列表入口 —— 锚点跟着换成真还在的那道闸。
  assert.match(sources[4], /Array\.isArray\(draft\.nodes\)/);
  assert.match(sources[5], /Array\.isArray\(prepared\.nodes\)/);
});

test('活动详情 200 数组载荷不得被展开成伪正常对象', () => {
  const h = harness('components/cy/scene-play-activity-detail/index.js', 'component');
  h.vm.load('9');
  h.requests[0].success({ code: 200, data: [] });
  assert.equal(h.vm.data.state, 'error');
});

test('活动详情人物和分类列表包含空元素时进入错误态', () => {
  for (const patch of [
    { collaboratorsList: [null], sysCategoryList: [] },
    { collaboratorsList: [], sysCategoryList: [null] },
  ]) {
    const h = harness('components/cy/scene-play-activity-detail/index.js', 'component');
    h.vm.load('9');
    assert.doesNotThrow(() => h.requests[0].success({
      code: 200,
      data: Object.assign({ id: 9, omsTicketList: [] }, patch),
    }));
    assert.equal(h.vm.data.state, 'error');
  }
});

test('漫游商家分类列表畸形时进入错误态', () => {
  for (const sysCategoryList of [{}, [null]]) {
    const h = harness('components/cy/scene-roam-poi-detail/index.js', 'component');
    h.vm._loadMerchant(9);
    assert.doesNotThrow(() => h.requests[0].success({
      code: '200', data: { id: 9, sysCategoryList },
    }));
    assert.equal(h.vm.data.state, 'error');
  }
});

test('合作收发列表包含空元素时进入错误态', () => {
  const h = harness('pages/coop/list/index.js', 'page');
  h.vm.load();
  assert.doesNotThrow(() => h.requests[0].success({
    code: '200', data: { received: [null], sent: [], slots: {} },
  }));
  assert.equal(h.vm.data.listState, 'error');
});

test('聊天消息载荷内 list 非数组时进入错误态', () => {
  const h = harness('subpackageB/pages/im/chat/index.js', 'page');
  h.vm.data.conversationId = 1;
  h.vm.loadMessages(true);
  assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: { list: {} } }));
  assert.equal(h.vm.data.loadState, 'error');
});

// 2026-09-19:原来这条同时钉 decor/story 与 coop-setting 两页 —— story 子页整页零入口
// (没进 app.json,装修首页的品牌故事走内联弹层),随审查 #30 删除,锚点收到还剩的那一页。
test('商家承接设置拒绝数组型详情载荷', () => {
  for (const rel of ['pages/merchant/decor/coop-setting/index.js']) {
    const h = harness(rel, 'page');
    h.vm.load();
    h.requests[0].success({ code: 200, data: [] });
    assert.equal(h.vm.data.loadState, 'error', rel);
  }
});

test('个人主页拒绝数组型用户详情，不覆盖真实用户态', async () => {
  const h = harness('components/cy/profile/index.js', 'component');
  h.vm.data.isSelf = true;
  const before = h.vm.data.userInfo;
  const pending = h.vm.loadUserData();
  h.requests[0].success({ code: '200', data: [] });
  await pending;
  assert.deepEqual(h.vm.data.userInfo, before);
});

test('个人主页对非字符串案例图和非数组分类安全收敛', async () => {
  const h = harness('components/cy/profile/index.js', 'component');
  h.vm.data.isSelf = false;
  h.vm.data.userId = '9';
  const pending = h.vm.loadUserData();
  h.requests[0].success({ code: '200', data: { casePics: {}, sysCategoryList: {} } });
  await assert.doesNotReject(pending);
  assert.deepEqual(h.vm.data.categoryList, []);
  assert.deepEqual(h.vm.data.casePicsList, []);
});

test('个人资料编辑页对非字符串案例图和非数组分类不崩溃', () => {
  const h = harness('pages/gerenziliao/gerenziliao.js', 'page');
  h.vm.getUserData();
  assert.doesNotThrow(() => h.requests[0].success({ code: '200', data: { casePics: {}, sysCategoryList: {} } }));
  assert.deepEqual(h.vm.data.casePicsList, []);
});

test('主题详情的票务非数组时归一为空数组', () => {
  const h = harness('pages/topic/index/index.js', 'page');
  assert.deepEqual(h.vm.processTopicDate({ bad: true }), []);
});

test('漫游商家和印章列表含空元素时都进入错误态', () => {
  const discover = harness('components/cy/scene-roam-discover/index.js', 'component');
  discover.vm.load();
  assert.doesNotThrow(() => discover.requests[0].success({ code: '200', data: { rows: [null] } }));
  assert.equal(discover.vm.data.state, 'error');

  const stamps = harness('components/cy/scene-roam-stamp-album/index.js', 'component');
  stamps.vm._cellW = 80;
  stamps.vm._cellH = 100;
  stamps.vm.load();
  assert.doesNotThrow(() => stamps.requests[0].success({
    code: '200', data: { list: [null], total: 1 },
  }));
  assert.equal(stamps.vm.data.error, true);
});

test('商家经营看板和参与项目拒绝畸形列表', () => {
  const dashboard = harness('pages/merchant/index/index.js', 'page');
  dashboard.vm.loadDashboard();
  assert.doesNotThrow(() => dashboard.requests[0].success({
    code: '200', data: { revenue: 1, revenue7d: [null] },
  }));
  assert.equal(dashboard.vm.data.dashboardError, '经营数据加载失败');

  for (const rows of [{}, [null]]) {
    const join = harness('pages/merchant/index/index.js', 'page');
    join.vm.loadJoinList();
    assert.doesNotThrow(() => join.requests[0].success({ code: '200', data: { rows } }));
    assert.equal(join.vm.data.joinError, true);
  }
});

test('项目页内嵌玩法列表拒绝非数组和空元素', () => {
  for (const rows of [{}, [null]]) {
    const h = harness('subpackageA/pages/myproject/index.js', 'page');
    h.vm.loadTemplates();
    assert.doesNotThrow(() => h.requests[0].success({ code: '200', data: { rows } }));
    assert.equal(h.vm.data.tplErrorMsg, '节点玩法加载失败');
  }
});

test('章节节点表单拒绝空元素', () => {
  const form = harness('pages/topic/components/cy/chapter-node-form/index.js', 'component');
  form.vm.loadMyTemplates();
  assert.doesNotThrow(() => form.requests[0].success({ code: '200', data: { rows: [null] } }));
  assert.deepEqual(form.vm.data.templates, []);
});
