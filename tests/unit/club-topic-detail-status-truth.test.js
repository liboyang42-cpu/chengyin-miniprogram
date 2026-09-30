// P0(2026-09-05 审核):俱乐部活动详情页的状态真值。
//
// 病:/api/topic/info-to-user 不返回 preparingAt/startedAt/endedAt/selfPublished(后端全库零命中),
//     resolveStateKey 恒落 confirmed ⇒ 「开始活动」永不出现;而且从俱乐部页进来不带 activityId,
//     导演台状态机根本不启动,九个入口全是 notReady。
// 治:① 主题下只有一场时,拿 activityList 里那一场自动进导演台;② projection.status 回写页面六态;
//     ③ goStory 真跳 topic-story 而不是 notReady 桩。这里装真页面跑方法,不看源码字符串。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../pages/club/topic-detail/index.js');

function loadPage() {
  const requests = [];
  const navigations = [];
  const toasts = [];
  let pageConfig = null;
  const previous = { getApp: global.getApp, Page: global.Page, wx: global.wx, getCurrentPages: global.getCurrentPages };
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: (options) => { requests.push(options); },
    tips: (m) => toasts.push(m),
  });
  global.Page = (config) => { pageConfig = config; };
  global.getCurrentPages = () => [{}];
  global.wx = {
    showToast: (o) => toasts.push(o.title),
    navigateTo: (o) => navigations.push(o.url),
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    getSystemInfoSync: () => ({}),
  };
  delete require.cache[PAGE_PATH];
  try { require(PAGE_PATH); } finally { global.getApp = previous.getApp; global.Page = previous.Page; }
  const vm = Object.assign({}, pageConfig, { setData(patch) { Object.assign(this.data, patch); } });
  vm.data = Object.assign({}, pageConfig.data);
  // 导演台 loadProjection 走适配器发请求;这里只验宿主页的状态回写,把它桩掉
  vm.loadProjection = function () { vm._projectionLoads = (vm._projectionLoads || 0) + 1; };
  // 拍板1(2026-09-17):管理身份由 /api/club/crm/topic-manage-stats 的三个身份字段下发;本文件钉的是主理人视角
  vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true };
  return { vm, requests, navigations, toasts };
}

// E-06(2026-09-16):审核态真源是 status(0 待审/1 通过/2 未通过);isOwner 是 VO 真字段,
// 管理身份(核销区/导演台/管理主键)靠它收口 —— 这两个字段都按后端真实返回写。
const RAW_CONFIRMED = { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702, name: '第一场', startTime: '2026-09-10 10:00:00' }] };

test('从俱乐部页只带 topicId/clubId 进来:主题下唯一一场自动进导演台', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm.applyDetail.call(vm, RAW_CONFIRMED);
  assert.equal(vm._directorActivityId, 702);
  assert.equal(vm.data.directorActive, true);
  assert.equal(vm._projectionLoads, 1, 'initDirector 必须真的去拉 projection');
});

test('没有 clubId(玩家视角)或多场时不擅自进导演台', () => {
  const a = loadPage(); a.vm._topicId = 88;
  a.vm.applyDetail.call(a.vm, RAW_CONFIRMED);
  assert.equal(a.vm.data.directorActive, false);
  const b = loadPage(); b.vm._topicId = 88; b.vm._clubId = 9;
  b.vm.applyDetail.call(b.vm, { status: 1, isOwner: 1, activityList: [{ id: 1, startTime: '2026-09-10 10:00:00' }, { id: 2, startTime: '2026-09-11 10:00:00' }] });
  assert.equal(b.vm.data.directorActive, false);
});

test('projection.status 驱动六态:PREPARING→准备中/开始活动,RUNNING→进行中/结束活动,FINISHED→已结束', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm.applyDetail.call(vm, RAW_CONFIRMED);
  assert.equal(vm.data.statusKey, 'confirmed');
  vm.applyProjectionStatus.call(vm, 'PREPARING');
  assert.equal(vm.data.statusKey, 'preparing');
  assert.equal(vm.data.primary.text, '开始活动');
  vm.applyProjectionStatus.call(vm, 'RUNNING');
  assert.equal(vm.data.statusKey, 'running');
  assert.equal(vm.data.showVerify, true);
  // 写成功后宿主 fetchDetail 重新 applyDetail,不得把 projection 状态冲回 confirmed
  vm.applyDetail.call(vm, RAW_CONFIRMED);
  assert.equal(vm.data.statusKey, 'running', 'raw 推断不能覆盖导演台真值');
  vm.applyProjectionStatus.call(vm, 'FINISHED');
  assert.equal(vm.data.statusKey, 'ended');
  vm.applyProjectionStatus.call(vm, 'CANCELLED');
  assert.equal(vm.data.statusKey, 'ended');
  assert.equal(vm.data.statusText, '已取消');
  assert.equal(vm.data.showVerify, false, '取消场不开核销区');
});

test('审核中/未通过仍以审核态为准,导演台状态不覆盖', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm.applyDetail.call(vm, { status: 0, isOwner: 1, activityList: [{ id: 702, startTime: '2026-09-10 10:00:00' }] });
  vm.applyProjectionStatus.call(vm, 'RUNNING');
  assert.equal(vm.data.statusKey, 'reviewing');
});

test('剧情与玩法入口真跳 topic-story,不再是 notReady 桩', () => {
  const { vm, navigations, toasts } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm.goStory.call(vm);
  assert.deepEqual(navigations, ['/pages/club/topic-story/index?topicId=88&clubId=9']);
  assert.deepEqual(toasts, []);
});

// info-to-user uses Spring request parameters, not @RequestBody.
test('主办详情和重试提交可绑定的主题参数，保留加载与失败恢复', () => {
  const { vm, requests } = loadPage();
  vm.onLoad({ topicId: '990049', clubId: '7001' });
  const first = requests.find((r) => r.url === '/api/topic/info-to-user');
  const contentType = first.header && first.header['Content-Type'];
  assert.equal(contentType, 'application/x-www-form-urlencoded');
  assert.deepEqual(first.data, { id: 990049 });
  first.fail({ errMsg: 'request:fail timeout' });
  assert.equal(vm.data.loadError, true);
  vm.onRetry();
  const retry = requests.filter((r) => r.url === '/api/topic/info-to-user').at(-1);
  assert.deepEqual(retry.data, { id: 990049 });
  retry.success({ code: 200, data: { status: 1, isOwner: 1, name: '城市主题', activityList: [] } });
  // 拍板1:俱乐部视角要等管理向统计到了才渲染
  requests.filter((r) => r.url === '/api/club/crm/topic-manage-stats').at(-1)
    .success({ code: 200, data: { canDirect: true, canManageSessions: true, canViewVerify: true } });
  assert.equal(vm.data.loadError, false);
  assert.equal(vm.data.topic.name, '城市主题');
});
