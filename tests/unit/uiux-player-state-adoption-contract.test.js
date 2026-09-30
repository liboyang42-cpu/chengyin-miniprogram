'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

function setPath(target, dotted, value) {
  const parts = dotted.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor[parts[index]] || (cursor[parts[index]] = {});
  }
  cursor[parts.at(-1)] = value;
}

function loadSearchResultPage() {
  const requests = [];
  let definition;
  global.getApp = () => ({
    globalData: {},
    getImgUrl(value) { return value || ''; },
    sendRequest(options) { requests.push(options); },
  });
  global.wx = { navigateTo() {}, showToast() {} };
  global.Page = value => { definition = value; };
  const modulePath = path.resolve(__dirname, '../../pages/search2/result/index.js');
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setPath(page.data, key, value));
    if (callback) callback();
  };
  return { page, requests };
}

function resolveSearchBatch(batch, failures) {
  batch.forEach((request, index) => {
    if (failures && failures.has(index)) request.fail({ errMsg: 'request:fail timeout' });
    else request.success({ code: 200, data: { rows: [{ id: index + 1, name: '结果-' + index }] } });
  });
}

function loadSearchMapPage() {
  let definition;
  global.getApp = () => ({ globalData: {}, sendRequest() {} });
  global.wx = { showToast() {} };
  global.Page = value => { definition = value; };
  const modulePath = path.resolve(__dirname, '../../pages/searchmap/index.js');
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setPath(page.data, key, value));
    if (callback) callback();
  };
  return page;
}

function loadTopicPage() {
  const requests = [];
  let definition;
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { requests.push(options); },
    getRequestErrorMessage(_response, fallback) { return fallback; },
  });
  global.wx = {};
  global.Page = value => { definition = value; };
  const modulePath = path.resolve(__dirname, '../../pages/topic/index/index.js');
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setPath(page.data, key, value));
    if (callback) callback();
  };
  page.getTabSectionPosition = () => {};
  page.getTabHeight = () => {};
  return { page, requests };
}

function loadOfficialDetailPage() {
  const requests = [];
  const navigations = [];
  let definition;
  global.getApp = () => ({
    globalData: {},
    sendRequest(options) { requests.push(options); },
  });
  global.wx = {
    showToast() {},
    getStorageSync() { return ''; },
    setNavigationBarColor() {},
    setBackgroundColor() {},
    redirectTo(options) { navigations.push({ type: 'redirect', url: options.url }); },
    reLaunch(options) { navigations.push({ type: 'relaunch', url: options.url }); },
  };
  global.Page = value => { definition = value; };
  const modulePath = path.resolve(__dirname, '../../pages/activity/official-detail/index.js');
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([key, value]) => setPath(page.data, key, value));
    if (callback) callback();
  };
  return { page, requests, navigations };
}

test('首页与城市事件刷新时保留旧内容，只有无旧内容才显示同构骨架', () => {
  const home = source('pages/index/index.wxml');
  const activity = source('pages/activity/list/index.wxml');

  assert.match(home, /listLoading\.recommendedTopicList\s*&&\s*!recoHero[\s\S]{0,180}<cy-skeleton[^>]*type="feed-card"/);
  assert.match(home, /listLoading\.nearbyActivityList\s*&&\s*!nearbyActivityList\.length[\s\S]{0,180}<cy-skeleton[^>]*type="feed-card"/);
  assert.match(home, /listLoading\.upcomingActivityList\s*&&\s*!upcomingActivityList\.length[\s\S]{0,180}<cy-skeleton[^>]*type="feed-card"/);
  // 2026-09-17 A-14-2:文案收窄到「常驻横幅」本义 —— 顶部各区(hero/推荐/附近/即将上线)
  // 刷新失败仍静默降级;底部信息流的「加载更多」失败属 #856 例外表里的用户主动动作,
  // 允许 sec-feed 之后挂 cy-inline-error 行内重试。
  const homeAboveFeed = home.slice(0, home.indexOf('id="sec-feed"'));
  assert.ok(homeAboveFeed.length > 0, '找不到 sec-feed 锚点(页面结构已改?)');
  assert.doesNotMatch(homeAboveFeed, /cy-inline-error/,
    '首页已有旧内容时刷新失败静默降级，不挂常驻横幅');
  assert.match(home, /v3-sec-sync/,
    '刷新中的轻量同步态保留 —— 与 activity/list、address 等同类页一致');

  assert.match(activity, /loading\s*&&\s*events\.length===0[^>]*>[\s\S]{0,100}<cy-skeleton[^>]*type="feed-card"/);
  assert.match(activity, /loading\s*&&\s*events\.length>0[^>]*aria-role="status"[^>]*aria-live="polite"/,
    '已有活动刷新时必须明确提示正在同步');
  assert.doesNotMatch(activity, /<cy-inline-error[^>]*curError/);
  assert.match(activity, /<view wx:if="\{\{events\.length>0\}\}" class="oe-list">/);
});

test('搜索同关键词重试保留旧结果，部分失败只显示局部错误', () => {
  const { page, requests } = loadSearchResultPage();
  page.setData({ keyword: '咖啡' });
  page.runSearch();
  resolveSearchBatch(requests.slice(0, 4));
  assert.equal(page.data.visibleResults.length, 4);

  page.runSearch();
  assert.equal(page.data.visibleResults.length, 4, '同关键词刷新开始时不能清空旧结果');
  resolveSearchBatch(requests.slice(4, 8), new Set([1, 2, 3]));

  assert.equal(page.data.visibleResults.length, 4, '失败分类继续展示上一次成功内容');
  assert.equal(page.data.searchError, '');
});

test('搜索部分分类失败且其余分类为空时必须显示未完成错误，不能谎报全站无结果', () => {
  const { page, requests } = loadSearchResultPage();
  page.setData({ keyword: '冷门关键词' });
  page.runSearch();

  requests.forEach((request, index) => {
    if (index === 0) request.fail({ errMsg: 'request:fail timeout' });
    else request.success({ code: 200, data: { rows: [] } });
  });

  assert.deepEqual(page.data.visibleResults, []);
  assert.match(page.data.searchError, /部分|未完成|重试/);
});

test('搜索当前 tab 恰好为空时，仍按全部分组判断是否存在旧结果', () => {
  const { page, requests } = loadSearchResultPage();
  page.setData({ keyword: '咖啡' });
  page.runSearch();
  resolveSearchBatch(requests.slice(0, 4));
  const previousGroups = page.data.resultGroups;
  page.setData({ activeResultType: 'missing-type', visibleResults: [] });

  page.runSearch();

  assert.deepEqual(page.data.resultGroups, previousGroups);
  assert.equal(page.data.activeResultType, 'missing-type');
});

test('搜索新关键词用 epoch 拒绝旧请求迟到回写', () => {
  const { page, requests } = loadSearchResultPage();
  page.setData({ keyword: '旧词' });
  page.runSearch();
  const oldBatch = requests.slice(0, 4);

  page.setData({ keyword: '新词' });
  page.runSearch();
  const freshBatch = requests.slice(4, 8);
  freshBatch.forEach((request, index) => request.success({ code: 200, data: { rows: [{ id: index + 20, name: '新结果-' + index }] } }));
  oldBatch.forEach((request, index) => request.success({ code: 200, data: { rows: [{ id: index + 40, name: '旧结果-' + index }] } }));

  assert.deepEqual(page.data.visibleResults.map(item => item.title), ['新结果-0', '新结果-1', '新结果-2', '新结果-3']);
});

test('搜索有旧结果时用局部错误而不是整页替换', () => {
  const wxml = source('pages/search2/result/index.wxml');
  assert.match(wxml, /showSearchSkeleton\s*&&\s*!visibleResults\.length[^>]*>[\s\S]{0,100}<cy-skeleton[^>]*type="feed-card"/);
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*searchPartialError/);
  assert.match(wxml, /<view class="result-list" wx:if="\{\{visibleResults\.length\}\}">/);
});

test('搜索首载骨架延迟 400ms，短请求不闪烁 loading', () => {
  const js = source('pages/search2/result/index.js');
  const wxml = source('pages/search2/result/index.wxml');
  assert.match(js, /showSearchSkeleton:\s*false/);
  assert.match(js, /setTimeout\([\s\S]{0,260},\s*400\)/,
    '首载骨架必须经过 400ms 防闪烁阈值');
  assert.match(wxml, /wx:if="\{\{showSearchSkeleton\s*&&\s*!visibleResults\.length\}\}"/);
  assert.doesNotMatch(wxml, /wx:if="\{\{searchLoading\s*&&\s*!visibleResults\.length\}\}"/);
});

test('地图翻页失败保留列表和 markers，并允许重试同一页', () => {
  const page = loadSearchMapPage();
  const list = [{ id: 7, name: '已加载活动' }];
  const markers = [{ id: 1, activityId: 0 }];
  page.setData({ pageNum: 2, list, markers, activityMarkers: markers, listState: 'ready', hasMore: true });

  page.setPageError('网络超时');

  assert.deepEqual(page.data.list, list);
  assert.deepEqual(page.data.markers, markers);
  assert.deepEqual(page.data.activityMarkers, markers);
  assert.equal(page.data.listState, 'ready');
  assert.equal(page.data.hasMore, true, '失败不能伪装成服务端已没有更多');
  assert.equal(page.data.pageError, '网络超时');
});

test('地图列表在已有内容翻页失败时显示局部重试', () => {
  const wxml = source('pages/searchmap/index.wxml');
  assert.match(wxml, /<cy-inline-error[^>]*pageError\s*&&\s*list\.length[^>]*bind:action="retryListPage"/);
  assert.match(wxml, /<cy-skeleton[^>]*type="map-card"/);
});

test('AI 起草只陈述不透明任务，不伪造阶段或百分比', () => {
  const wxml = source('pages/publish/simple/index.wxml');
  const progress = wxml.match(/<cy-progress-status[^>]*>/);
  assert.ok(progress, '生成请求需要紧凑任务态');
  assert.match(progress[0], /density="compact"/);
  assert.match(progress[0], /title="正在生成主题草稿"/);
  assert.match(progress[0], /sub="完成后仍需你确认地点"/);
  assert.doesNotMatch(progress[0], /\b(?:steps|current|percent)=/);
  assert.match(wxml,
    /<cy-progress-status\b[^>]*wx:if="\{\{aiGenerating\}\}"[\s\S]*?<cy-inline-error\b[^>]*wx:elif="\{\{aiError\}\}"/,
    'AI 失败必须与生成中互斥，不能在请求 complete 前短暂同屏');
  assert.doesNotMatch(wxml, /class="simple-ai__error"/);
});

test('主题详情只接受具备可渲染名称的数据', () => {
  const malformed = loadTopicPage();
  malformed.page.setData({ id: 7 });
  malformed.page.getData();
  malformed.requests[0].success({ code: 200, data: { id: 7, opaque: true } });
  assert.equal(malformed.page.data.topicLoaded, false);
  assert.equal(malformed.page.data.loadError, true);

  const valid = loadTopicPage();
  valid.page.setData({ id: 8 });
  valid.page.getData();
  valid.requests[0].success({ code: 200, data: { id: 8, name: '老城散步', chaptersList: [] } });
  assert.equal(valid.page.data.topicLoaded, true, '缺封面不应被误判成内容不可用');
  assert.deepEqual(valid.page.data.info.chaptersList, []);

  const missingNodes = loadTopicPage();
  missingNodes.page.setData({ id: 9 });
  missingNodes.page.getData();
  missingNodes.requests[0].success({ code: 200, data: { id: 9, name: '章节待配置', chaptersList: [{}] } });
  assert.equal(missingNodes.page.data.topicLoaded, true);
  assert.deepEqual(missingNodes.page.data.info.chaptersList[0].nodes, [],
    '章节缺 nodes 时应规范化为空数组，不能卡死在永久骨架');

  const malformedChapter = loadTopicPage();
  malformedChapter.page.setData({ id: 10 });
  malformedChapter.page.getData();
  malformedChapter.requests[0].success({ code: 200, data: { id: 10, name: '破损主题', chaptersList: [null] } });
  assert.equal(malformedChapter.page.data.topicLoaded, false);
  assert.equal(malformedChapter.page.data.loadError, true);
});

test('主题缺封面使用现有占位，路线无章节显示专属站点空态', () => {
  const wxml = source('pages/topic/index/index.wxml');
  assert.match(wxml, /src="\{\{\s*info\.imgUrl\s*\|\|\s*'\/pages\/topic\/images\/icon_line\.jpg'\s*\}\}"/);
  assert.match(wxml, /activeTab\s*==\s*'2'\s*&&\s*!info\.chaptersList\.length/);
  assert.match(wxml, /activeTab\s*==\s*'1'\s*&&\s*!info\.chaptersList\.length/,
    '路线节点 tab 不能在合法空数组时白屏');
  assert.match(wxml, /这条路线还没有节点/);
  // CU-M-190:标签是「路线」、副文案说「每一站」,标题却写「任务」—— 同一屏三个词。
  assert.match(wxml, /这条路线还没有站点/);
  assert.doesNotMatch(wxml, /这条路线还没有任务/);
  assert.match(wxml, /发布者完成路线配置后，这里会显示每一站/);
});

test('官方活动详情区分网络失败与内容不可用', () => {
  const network = loadOfficialDetailPage();
  network.page.setData({ id: 11 });
  network.page.fetch();
  network.requests[0].fail({ errMsg: 'request:fail timeout' });
  assert.equal(network.page.data.loadErrKind, 'network');
  assert.match(network.page.data.loadErrTitle, /网络/);

  const missing = loadOfficialDetailPage();
  missing.page.setData({ id: 12 });
  missing.page.fetch();
  missing.requests[0].success({ code: 404, msg: 'not found' });
  assert.equal(missing.page.data.loadErrKind, 'data');
  assert.match(missing.page.data.loadErrTitle, /内容/);

  const businessMissing = loadOfficialDetailPage();
  businessMissing.page.setData({ id: 12 });
  businessMissing.page.fetch();
  businessMissing.requests[0].success({ code: 500, msg: '活动不存在' });
  assert.equal(businessMissing.page.data.loadErrActionType, 'back',
    '真实 AjaxResult.error 响应必须识别为内容不存在');

  const server = loadOfficialDetailPage();
  server.page.setData({ id: 13 });
  server.page.fetch();
  server.requests[0].success({ code: 500, msg: '服务繁忙' });
  assert.equal(server.page.data.loadErrKind, 'data');
  assert.equal(server.page.data.loadErrActionType, 'retry', '服务异常不能误导为活动已下线');
  assert.equal(server.page.data.loadErrAction, '重试');
});

test('官方活动详情卸载后忽略请求的迟到回调', () => {
  const callbacks = {
    success(request) {
      request.success({ code: 200, data: { id: 31, title: '迟到活动', status: 2 } });
    },
    fail(request) {
      request.fail({ errMsg: 'request:fail timeout' });
    },
    complete(request) {
      request.complete();
    },
  };

  Object.entries(callbacks).forEach(([name, invoke]) => {
    const detail = loadOfficialDetailPage();
    detail.page.setData({ id: 31 });
    detail.page.fetch();
    const latePatches = [];
    detail.page.setData = patch => { latePatches.push(patch); };

    detail.page.onUnload();
    invoke(detail.requests[0]);

    assert.deepEqual(latePatches, [], `${name} 在页面卸载后不得 setData`);
  });
});

test('官方活动刷新失败保留旧详情并原位提供恢复动作', () => {
  const detail = loadOfficialDetailPage();
  detail.page.setData({ id: 21 });
  detail.page.fetch();
  detail.requests[0].success({ code: 200, data: { id: 21, title: '夜行计划', status: 2 } });
  assert.equal(detail.page.data.e.title, '夜行计划');

  detail.page.fetch();
  detail.requests[1].fail({ errMsg: 'request:fail timeout' });
  assert.equal(detail.page.data.e.title, '夜行计划');

  const wxml = source('pages/activity/official-detail/index.wxml');
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*loadErr/);
});

test('官方活动详情错误动作随错误类型变化，指标栏只保留一处状态文案', () => {
  const wxml = source('pages/activity/official-detail/index.wxml');
  assert.match(wxml, /class="theme-merchant od-root"/,
    '官方活动详情是商家工作域，必须固定使用商家浅色主题');
  assert.doesNotMatch(wxml, /theme-dark/);
  assert.match(wxml, /<cy-state-shell[^>]*kind="\{\{loadErrKind\}\}"[^>]*primary="\{\{loadErrAction\}\}"[^>]*bind:primary="onLoadErrorAction"/);
  assert.equal((wxml.match(/\{\{countdown\s*\|\|\s*e\._statusText\}\}/g) || []).length, 1);
  assert.doesNotMatch(wxml, /e\.status===1\?'即将开始'/);
});

function assertOfficialDetailMediaContrast(wxml, wxss, pageConfig) {
  assert.match(
    wxml,
    /tint="\{\{\(!e\s*\|\|\s*navScrolled\)\s*\?\s*'dark'\s*:\s*'light'\}\}"/,
    '封面态使用浅色返回箭头，滚动到商家实底导航后切换深色箭头',
  );
  for (const selector of ['od-refresh-state', 'od-hero-placeholder', 'od-organizer', 'od-card-state']) {
    assert.match(
      wxss,
      new RegExp(`\\.${selector}\\s*\\{[^}]*color:\\s*var\\(--cy-color-home-upcoming-text\\)`, 's'),
      `${selector} 压在图片/黑色蒙层上，必须使用固定浅色 on-image token`,
    );
  }
  assert.equal(pageConfig.navigationBarTextStyle, 'black', '商家态原生导航文字必须按浅色底配置');
  assert.equal(pageConfig.backgroundColor, '#F3F4F4', '商家态首帧不得先闪出玩家黑色背景');
}

test('官方活动详情的封面蒙层与商家浅色滚动导航始终可读', () => {
  assertOfficialDetailMediaContrast(
    source('pages/activity/official-detail/index.wxml'),
    source('pages/activity/official-detail/index.wxss'),
    JSON.parse(source('pages/activity/official-detail/index.json')),
  );
});

test('负控:图片蒙层退回主题反色字或商家首帧改暗时必须判红', () => {
  const wxml = source('pages/activity/official-detail/index.wxml');
  const wxss = source('pages/activity/official-detail/index.wxss');
  const pageConfig = JSON.parse(source('pages/activity/official-detail/index.json'));
  const unsafeCss = wxss.replace(
    'color: var(--cy-color-home-upcoming-text)',
    'color: var(--cy-color-text-inverse)',
  );
  assert.notEqual(unsafeCss, wxss, '负控必须真实改坏一处 on-image 前景色');
  assert.throws(
    () => assertOfficialDetailMediaContrast(wxml, unsafeCss, pageConfig),
    /固定浅色 on-image token/,
  );
  assert.throws(
    () => assertOfficialDetailMediaContrast(wxml, wxss, { ...pageConfig, backgroundColor: '#000000' }),
    /不得先闪出玩家黑色背景/,
  );
});

test('官方活动详情在新指标栏保留 V1 与 V2 的真实个人进度', () => {
  const detail = loadOfficialDetailPage();
  const legacy = detail.page._decorate({
    contractVersion: 1,
    myProgress: 4,
    activityStart: '2026-08-29 10:00:00',
    activityEnd: '2026-08-30 10:00:00',
  });
  const v2 = detail.page._decorate({
    contractVersion: 2,
    missions: [{ missionCode: 'A', complete: true }, { missionCode: 'B', complete: false }],
    activityStart: '2026-08-29 10:00:00',
    activityEnd: '2026-08-30 10:00:00',
  });
  assert.equal(legacy._progressText, '4');
  assert.equal(v2._progressText, '1/2');

  const wxml = source('pages/activity/official-detail/index.wxml');
  assert.match(wxml, /wx:if="\{\{e\.signed\}\}"[\s\S]*?\{\{e\._progressText\}\}/);
});

function assertOfficialShareContract(share) {
  assert.equal(share.title, '城市夜行计划');
  assert.equal(share.path, '/pages/activity/official-detail/index?id=event%2F42');
  assert.equal(share.imageUrl, 'https://img.example/cover.jpg');
}

test('官方活动详情分享卡携带当前活动 canonical 路由、标题与封面', () => {
  const detail = loadOfficialDetailPage();
  detail.page.setData({
    id: 'event/42',
    e: { title: '城市夜行计划', coverImg: 'https://img.example/cover.jpg' },
  });
  assertOfficialShareContract(detail.page.onShareAppMessage());
  assert.match(source('pages/activity/official-detail/index.wxml'), /<button[^>]*open-type="share"[^>]*aria-label="分享活动"/s);
});

test('负控:分享卡退回列表页或丢活动参数必须判红', () => {
  assert.throws(
    () => assertOfficialShareContract({
      title: '城市夜行计划',
      path: '/pages/activity/list/index',
      imageUrl: 'https://img.example/cover.jpg',
    }),
    /official-detail/,
  );
});

test('官方活动内容失效时主动作替换当前页，不把失效详情留在返回栈', () => {
  const missing = loadOfficialDetailPage();
  missing.page.setData({ id: 14 });
  missing.page.fetch();
  missing.requests[0].success({ code: 500, msg: '活动不存在' });

  missing.page.onLoadErrorAction();

  assert.deepEqual(missing.navigations, [
    { type: 'redirect', url: '/pages/activity/list/index' },
  ]);
});

test('漫游拒权使用显著权限状态，且不虚构手动选城次动作', () => {
  const wxml = source('pages/roam/index.wxml');
  const permissionState = wxml.match(/<cy-state-shell[^>]*wx:if="\{\{introError\}\}"[^>]*>/);
  assert.ok(permissionState, '拒绝定位后需要显著语义状态');
  assert.match(permissionState[0], /kind="no-permission"/);
  assert.match(permissionState[0], /primary="去设置"/);
  assert.match(permissionState[0], /bind:primary="openRoamLocationSetting"/);
  assert.doesNotMatch(permissionState[0], /secondary=/);
});

function assertRoamNoTrackState(wxml) {
  const map = wxml.match(/<view class="settle__map">[\s\S]*?<\/view>\s*<view class="settle__ctaw">/);
  assert.ok(map, '漫游结算地图结构锚点缺失');
  assert.match(map[0], /class="settle__track-empty"[^>]*wx:if="\{\{!polyline\.length\}\}"/,
    '真实无轨迹结算必须有独立可见状态，不能退回首屏或空白地图');
  assert.match(map[0], /aria-role="status"[^>]*aria-label="\{\{trackTip\}\}"/);
  assert.match(map[0], /<cy-icon\b[^>]*name="route"/);
  assert.match(map[0], /<text>\{\{trackTip\}\}<\/text>/);
}

test('漫游结束但没有记录到轨迹时，结算地图明确说明真实空轨迹状态', () => {
  assertRoamNoTrackState(source('pages/roam/index.wxml'));
});

test('负控：把无轨迹条件反成有轨迹时，结算状态契约必须判红', () => {
  const wxml = source('pages/roam/index.wxml');
  const mutated = wxml.replace('wx:if="{{!polyline.length}}"', 'wx:if="{{polyline.length}}"');
  assert.notEqual(mutated, wxml, '无轨迹条件负控锚点失效');
  assert.throws(() => assertRoamNoTrackState(mutated), /真实无轨迹结算/);
});

test('漫游据点失败只陈述据点未加载，不宣称系统离线', () => {
  const wxml = source('pages/roam/index.wxml');
  const js = source('pages/roam/index.js');
  // 2026-09-16 C-14:横幅条件扩成 poiOffline || merchantOffline(商家图层失败也进同一条横幅);
  // 文案与「不宣称系统离线」的口径不变。
  const poiBanner = wxml.match(/<view class="maptip maptip--offline" wx:if="\{\{\(poiOffline \|\| merchantOffline\)[^>]*>[\s\S]*?<\/view>/);
  assert.ok(poiBanner);
  assert.match(poiBanner[0], /据点没加载出来/);
  assert.doesNotMatch(poiBanner[0], /系统离线|当前离线|网络已断开/);
  assert.match(js, /readerLabel:\s*'据点没加载出来。本地足迹仍保留，点击重试。'/);
  // 两个图层各自的失败标记都要真的被写出来,横幅才不是空挂的
  assert.match(js, /merchantOffline: true/);
  assert.match(js, /poiOffline: true/);
});
