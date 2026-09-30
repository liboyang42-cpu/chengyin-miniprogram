'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}

function loadPage(source) {
  const requests = [];
  let networkHandler = null;
  let definition;
  global.getApp = () => ({
    globalData: {},
    sendRequest(options) { requests.push(options); },
  });
  global.wx = {
    showToast() {},
    getNetworkType(options) { options.success({ networkType: 'wifi' }); },
    onNetworkStatusChange(handler) { networkHandler = handler; },
    offNetworkStatusChange() {},
  };
  global.Page = (value) => { definition = value; };
  const modulePath = path.resolve(__dirname, '../../pages/searchmap/index.js');
  if (source) {
    // A-RPT-7 负控:按变异源码建模块,不污染 require 缓存
    const Module = require('node:module');
    const m = new Module(modulePath, module);
    m.filename = modulePath;
    m.paths = Module._nodeModulePaths(path.dirname(modulePath));
    m._compile(source, modulePath);
  } else {
    delete require.cache[require.resolve(modulePath)];
    require(modulePath);
  }

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
  });
  page.setData = function setData(patch, callback) {
    Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value));
    if (callback) callback();
  };
  page.createMarkersFromActivities = function createMarkersFromActivities(list) {
    this.setData({ activityMarkers: list.map((item) => ({ activityId: item.id })) });
  };
  // 2026-09-16 起 /api/city/nodes 只在「已定位或用户拖过地图」时才发;本文件测的是查询世代替换,
  // 统一按「已定位」建模,免得每条用例都要自己开闸。
  page._hasLocation = true;
  return { page, requests, getNetworkHandler: () => networkHandler };
}

function ok(request, rows) {
  request.success({ code: 200, data: { rows } });
}

test('新筛选开始后，旧分页成功回调不得追加到新结果', () => {
  const { page, requests } = loadPage();
  page.setData({
    pageNum: 2,
    list: [{ id: 1, name: '旧结果第一页' }],
    listState: 'ready',
    hasMore: true,
  });
  page.getList();
  const oldPagination = requests[0];

  page.setData({
    pageNum: 1,
    list: [],
    hasMore: true,
    'filterConditions.keyword': '新筛选',
  });
  page.getList();
  const freshQuery = requests[1];
  ok(freshQuery, [{ id: 20, name: '新结果' }]);
  ok(oldPagination, [{ id: 2, name: '迟到的旧分页' }]);

  assert.deepEqual(page.data.list.map((item) => item.id), [20]);
  assert.deepEqual(page.data.activityMarkers.map((item) => item.activityId), [20]);
  assert.equal(page.data.listState, 'ready');
  assert.equal(page.data.loadingMore, false, '新首屏必须收掉旧分页遗留的加载反馈');
});

test('新查询开始后，旧分页失败不得把新查询切成整页错误', () => {
  const { page, requests } = loadPage();
  page.setData({
    pageNum: 2,
    list: [{ id: 1, name: '旧结果第一页' }],
    listState: 'ready',
    hasMore: true,
  });
  page.getList();
  const oldPagination = requests[0];

  page.setData({
    pageNum: 1,
    list: [],
    hasMore: true,
    'filterConditions.keyword': '新筛选',
  });
  page.getList();
  const freshQuery = requests[1];
  ok(freshQuery, [{ id: 20, name: '新结果' }]);
  oldPagination.fail({ errMsg: 'request:fail timeout' });

  assert.deepEqual(page.data.list.map((item) => item.id), [20]);
  assert.equal(page.data.listState, 'ready');
  assert.equal(page.data.errorMsg, '');
  assert.equal(page.data.pageError, '');
});

test('连续两个首页查询时，只接受最后一次查询的响应', () => {
  const { page, requests } = loadPage();
  page.setData({ pageNum: 1, 'filterConditions.keyword': '旧词' });
  page.getList();
  const oldQuery = requests[0];

  page.setData({ pageNum: 1, 'filterConditions.keyword': '新词' });
  page.getList();
  const freshQuery = requests[1];
  ok(freshQuery, [{ id: 30, name: '新词结果' }]);
  ok(oldQuery, [{ id: 10, name: '旧词结果' }]);

  assert.deepEqual(page.data.list.map((item) => item.id), [30]);
});

test('切换搜索词后立即移除上一查询的活动与商家地图点', () => {
  const { page, requests } = loadPage();
  page.setData({
    list: [{ id: 1, name: '旧活动' }],
    activityMarkers: [{ id: 1, kind: 'activity', activityId: 0 }],
    merchantNodes: [{ poiId: 9, name: '旧商家' }],
    merchantMarkers: [{ id: 1000009, kind: 'merchant', poiId: 9 }],
    markers: [
      { id: 1, kind: 'activity', activityId: 0 },
      { id: 1000009, kind: 'merchant', poiId: 9 },
    ],
    'filterConditions.keyword': '新词',
  });

  page.performSearch();

  assert.deepEqual(page.data.list, []);
  assert.deepEqual(page.data.activityMarkers, []);
  assert.deepEqual(page.data.merchantNodes, []);
  assert.deepEqual(page.data.merchantMarkers, []);
  assert.equal(page.data.markers.some((marker) => marker.kind === 'activity' || marker.kind === 'merchant'), false);
  assert.deepEqual(requests.map((request) => request.url), ['/api/activity/list', '/api/city/nodes']);
});

test('清场后的 setData callback 执行前，旧活动与商家回包也不得写回地图', () => {
  const { page, requests } = loadPage();
  page.setData({ pageNum: 1, 'filterConditions.keyword': '旧词' });
  page.getList();
  page.getMerchantNodes();
  const oldActivityRequest = requests[0];
  const oldMerchantRequest = requests[1];

  const callbacks = [];
  page.setData = function deferredSetData(patch, callback) {
    Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value));
    if (callback) callbacks.push(callback);
  };
  page.runFreshQuery({ 'filterConditions.keyword': '新词' });

  ok(oldActivityRequest, [{ id: 10, name: '迟到的旧活动' }]);
  oldMerchantRequest.success({ code: 200, data: [{ poiId: 9, name: '迟到的旧商家', lat: 31, lng: 121 }] });

  assert.deepEqual(page.data.list, []);
  assert.deepEqual(page.data.activityMarkers, []);
  assert.deepEqual(page.data.merchantNodes, []);
  assert.deepEqual(page.data.merchantMarkers, []);

  callbacks.shift()();
  assert.deepEqual(requests.slice(2).map((request) => request.url), ['/api/activity/list', '/api/city/nodes']);
});

test('拖图、重新定位与筛选都会在新范围请求前清掉旧查询点位', () => {
  const seedOldQuery = (page) => page.setData({
    list: [{ id: 1, name: '旧活动' }],
    activityMarkers: [{ id: 1, kind: 'activity', activityId: 0 }],
    merchantNodes: [{ poiId: 9, name: '旧商家' }],
    merchantMarkers: [{ id: 1000009, kind: 'merchant', poiId: 9 }],
    markers: [
      { id: 1, kind: 'activity', activityId: 0 },
      { id: 1000009, kind: 'merchant', poiId: 9 },
    ],
  });
  const assertFresh = (page, requests, label) => {
    assert.deepEqual(page.data.activityMarkers, [], `${label} 未清旧活动点`);
    assert.deepEqual(page.data.merchantMarkers, [], `${label} 未清旧商家点`);
    assert.equal(page.data.markers.some((marker) => marker.kind === 'activity' || marker.kind === 'merchant'), false);
    assert.deepEqual(requests.map((request) => request.url), ['/api/activity/list', '/api/city/nodes']);
  };

  const moved = loadPage();
  seedOldQuery(moved.page);
  moved.page.mapContext = {
    getRegion({ success }) {
      success({ northLatitude: 31.3, southLatitude: 31.1, eastLongitude: 121.6, westLongitude: 121.4 });
    },
  };
  moved.page.onRegionChange({ type: 'end' });
  assertFresh(moved.page, moved.requests, '拖图');

  const located = loadPage();
  seedOldQuery(located.page);
  global.wx.getLocation = ({ success }) => success({ latitude: 30.6, longitude: 104.1 });
  located.page.moveToLocation();
  assertFresh(located.page, located.requests, '重新定位');

  const filtered = loadPage();
  seedOldQuery(filtered.page);
  filtered.page.searchFilter();
  assertFresh(filtered.page, filtered.requests, '筛选');
});

test('连续定位与拖图只接受最后一次空间输入，卸载后迟到回调全部失效', () => {
  const located = loadPage();
  const locationCallbacks = [];
  global.wx.getLocation = (options) => { locationCallbacks.push(options); };
  located.page.moveToLocation();
  located.page.moveToLocation();

  locationCallbacks[1].success({ latitude: 30.6, longitude: 104.1 });
  assert.equal(located.page.data.latitude, 30.6);
  assert.equal(located.page.data.longitude, 104.1);
  assert.deepEqual(located.requests.map((request) => request.url), ['/api/activity/list', '/api/city/nodes']);
  locationCallbacks[0].success({ latitude: 31.2, longitude: 121.4 });
  assert.equal(located.page.data.latitude, 30.6, '旧定位回调不得把地图反向拉回 A');
  assert.equal(located.page.data.longitude, 104.1);
  assert.equal(located.requests.length, 2, '旧定位回调不得再开启一轮 A 查询');

  const moved = loadPage();
  const regionCallbacks = [];
  moved.page.mapContext = { getRegion(options) { regionCallbacks.push(options); } };
  moved.page.onRegionChange({ type: 'end' });
  moved.page.onRegionChange({ type: 'end' });
  regionCallbacks[1].success({ northLatitude: 23, southLatitude: 21, eastLongitude: 115, westLongitude: 113 });
  regionCallbacks[0].success({ northLatitude: 33, southLatitude: 31, eastLongitude: 123, westLongitude: 121 });
  assert.equal(moved.page.data.regionInfo.latitude, 22);
  assert.equal(moved.page.data.regionInfo.longitude, 114);
  assert.equal(moved.requests.length, 2, '旧拖图回调不得追加过期范围请求');

  const unloaded = loadPage();
  const afterUnload = [];
  global.wx.getLocation = (options) => { afterUnload.push(options); };
  unloaded.page.moveToLocation();
  unloaded.page.onUnload();
  afterUnload[0].success({ latitude: 20, longitude: 110 });
  assert.equal(unloaded.requests.length, 0);
  assert.notEqual(unloaded.page.data.latitude, 20);
});

test('定位与拒权恢复动作具备按钮语义和不小于 88rpx 的命中区', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.wxss'), 'utf8');

  assert.match(wxml, /class="location-btn"[^>]*aria-role="button"[^>]*aria-label="定位到当前位置"/);
  assert.match(wxml, /class="smap-location-error__action"[^>]*aria-role="button"[^>]*aria-label="\{\{locationAction/);
  assert.match(wxss, /\.location-btn\s*\{[\s\S]*?width:\s*88rpx;[\s\S]*?height:\s*88rpx;/);
  assert.match(wxss, /\.smap-location-error__action\s*\{[^}]*min-height:\s*88rpx;/);
});

test('同一查询分页请求未完成时，连续触底不得并发下一页', () => {
  const { page, requests } = loadPage();
  page.setData({
    pageNum: 1,
    list: [{ id: 1, name: '第一页' }],
    listState: 'ready',
    pageSize: 1,
    hasMore: true,
  });

  page.onReachBottom();
  page.onReachBottom();

  assert.equal(requests.length, 1, '第 2 页在途时不能再发第 3 页');
  assert.equal(requests[0].data.pageNum, 2);
  assert.equal(page.data.pageNum, 2, '未发出请求时不能提前推进页码');

  ok(requests[0], [{ id: 2, name: '第二页' }]);
  page.onReachBottom();

  assert.equal(requests.length, 2);
  assert.equal(requests[1].data.pageNum, 3);
});

test('首页请求未完成时不得并发第 2 页并提前推进页码', () => {
  const { page, requests } = loadPage();
  page.setData({ pageNum: 1, list: [], hasMore: true });
  page.getList();
  page.onReachBottom();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].data.pageNum, 1);
  assert.equal(page.data.pageNum, 1);
});

test('结果 Sheet 提供显式加载更多入口，不依赖不可达的页面触底', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.wxml'), 'utf8');
  assert.match(wxml, /<cy-btn\b[^>]*wx:if="\{\{hasMore[^>]*bindtap="loadMoreResults"[^>]*loading="\{\{loadingMore\}\}"/);

  const { page, requests } = loadPage();
  page.setData({ pageNum: 1, pageSize: 1, list: [{ id: 1 }], listState: 'ready', hasMore: true });
  page.loadMoreResults();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].data.pageNum, 2);
});

test('A-RPT-7:刷新失败(pageErrorIsRefresh)不再连翻页一起禁掉', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.wxml'), 'utf8');
  // 刷新失败文案与翻页失败分开:刷新失败不该藏掉「加载更多」
  assert.match(wxml, /class="smap-more" wx:if="\{\{hasMore && \(!pageError \|\| pageErrorIsRefresh\)\}\}"/);

  const { page, requests } = loadPage();
  page.setData({ pageNum: 1, pageSize: 1, list: [{ id: 1 }], listState: 'ready', hasMore: true });
  page.setPageError('刷新失败，请重试', 1);
  assert.equal(page.data.pageErrorIsRefresh, true, '前置:这是刷新失败态');

  page.loadMoreResults();
  assert.equal(requests.length, 1, '刷新失败后「加载更多」必须仍能发请求');
  assert.equal(requests[0].data.pageNum, 2, '继续翻的是下一页');
});

test('A-RPT-7 负控:翻页自己的错误仍必须拦住加载更多', () => {
  const { page, requests } = loadPage();
  page.setData({ pageNum: 2, pageSize: 1, list: [{ id: 1 }], listState: 'ready', hasMore: true });
  page.setPageError('没能加载更多，请重试', 2);
  assert.equal(page.data.pageErrorIsRefresh, false, '前置:这是翻页失败态');

  page.loadMoreResults();
  assert.equal(requests.length, 0, '翻页失败时不该在没有重试的情况下继续叠请求');
});

test('A-RPT-7 负控:把刷新失败重新并回翻页闸,加载更多必须被拦 ⇒ 用例真红', () => {
  const fs = require('node:fs');
  const js = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.js'), 'utf8');
  const broken = js.replace(
    '(this.data.pageError && !this.data.pageErrorIsRefresh)',
    'this.data.pageError',
  );
  assert.notEqual(broken, js, '负控锚点失效:刷新失败豁免未命中');

  const { page, requests } = loadPage(broken);
  page.setData({ pageNum: 1, pageSize: 1, list: [{ id: 1 }], listState: 'ready', hasMore: true });
  page.setPageError('刷新失败，请重试', 1);
  page.loadMoreResults();
  assert.equal(requests.length, 0, '负控必须真的把刷新失败重新算进闸里');
});

test('商家点位也按查询 epoch 拒绝旧搜索的迟到成功和失败', () => {
  const { page, requests } = loadPage();
  page.setData({ 'filterConditions.keyword': 'A' });
  page.getMerchantNodes();
  const oldRequest = requests[0];

  page.setData({ 'filterConditions.keyword': 'B' });
  page.getMerchantNodes();
  const freshRequest = requests[1];
  freshRequest.success({ code: 200, data: [{ poiId: 2, name: 'B 店', lat: 31, lng: 121 }] });
  oldRequest.success({ code: 200, data: [{ poiId: 1, name: 'A 店', lat: 30, lng: 120 }] });
  oldRequest.fail();

  assert.deepEqual(page.data.merchantNodes.map((item) => item.name), ['B 店']);
  assert.deepEqual(page.data.merchantMarkers.map((item) => item.poiId), [2]);
});

test('商家点位刷新失败保留缓存并提供局部重试，不把部分失败伪装成空层', () => {
  const { page, requests } = loadPage();
  const cachedNode = { poiId: 3, name: '缓存店', lat: 31, lng: 121 };
  const cachedMarker = { poiId: 3, kind: 'merchant' };
  page.setData({ merchantNodes: [cachedNode], merchantMarkers: [cachedMarker] });

  page.getMerchantNodes();
  assert.equal(page.data.merchantNodesRefreshing, true);
  requests[0].fail({ errMsg: 'request:fail timeout' });

  assert.deepEqual(page.data.merchantNodes, [cachedNode]);
  assert.deepEqual(page.data.merchantMarkers, [cachedMarker]);
  assert.equal(page.data.merchantNodesRefreshing, false);
  // UI-14:图例错误胶囊删除后,商家图层失败维持静默降级(不再有 merchantNodeError 状态),
  // 缓存与刷新收圈是唯一可观察的判据;重试路径下一句继续验证。
  assert.equal(page.data.merchantNodeError, undefined, '死状态字段已随 UI 提示一起删除');

  page.getMerchantNodes();
  assert.equal(requests.length, 2);
});

test('活动与商家点位同时失败时，结果面板仍能打开并提供独立恢复路径', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.wxml'), 'utf8');
  const { page, requests } = loadPage();
  page.setData({
    listState: 'error',
    errorMsg: '活动暂未取回',
    bmShow: false,
  });

  page.openList();

  assert.equal(page.data.bmShow, true, '双失败时入口应打开结果面板，而不是只重试活动层');
  assert.equal(requests.length, 0, '打开面板不应隐式绑定任一接口的重试');
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*merchantNodeError/);  // 商家点位刷新失败静默降级
  assert.match(wxml, /listState === 'error'[\s\S]{0,240}bind:retry="onRetry"/);
});

test('离线时保留已有地图结果，恢复连接后原地刷新而不先清空', () => {
  const { page, requests } = loadPage();
  const cached = [{ id: 7, name: '已缓存活动' }];
  page.setData({ list: cached, listState: 'ready', pageNum: 3, hasMore: false });

  page.applyNetworkState(true);
  assert.equal(page.data.offline, true);
  assert.match(page.data.offlineMessage, /上次加载/);
  assert.deepEqual(page.data.list, cached);

  page.retryNetwork();
  assert.equal(page.data.offline, false);
  assert.equal(page.data.pageNum, 1);
  assert.deepEqual(page.data.list, cached, '重试开始时仍保留可用缓存');
  assert.equal(page.data.listState, 'ready', '刷新期间旧结果必须继续可见，不能被首载骨架遮住');
  assert.equal(page.data.listRefreshing, true);
  assert.equal(requests[0].url, '/api/activity/list');

  requests[0].fail({ errMsg: 'request:fail timeout' });
  assert.equal(page.data.listState, 'ready', '更新失败仍要保留旧结果');
  assert.deepEqual(page.data.list, cached);
  // A-08:原先这里是 pageError === '' 的静默降级 —— 用户会把旧结果当成新区域/新筛选的结果。
  // 现在必须挂内联错误条,并可原地重试(单列用例见 searchmap-filter-and-refresh-contract)。
  assert.notEqual(page.data.pageError, '', '有旧结果时刷新失败不再静默,必须挂内联错误条');
  assert.equal(page.data.pageErrorIsRefresh, true, '刷新失败文案与翻页失败区分');
  assert.equal(page.data.listRefreshing, false);
});

test('网络从离线恢复时自动刷新活动与商家两层', () => {
  const { page, requests, getNetworkHandler } = loadPage();
  page.setData({ list: [{ id: 7 }], listState: 'ready', hasMore: false });
  page.setupNetworkState();
  page.applyNetworkState(true);

  getNetworkHandler()({ isConnected: true, networkType: 'wifi' });

  assert.equal(page.data.offline, false);
  assert.equal(page.data.pageNum, 1);
  assert.deepEqual(requests.map((request) => request.url), ['/api/activity/list', '/api/city/nodes']);
  assert.deepEqual(page.data.list, [{ id: 7 }], '自动更新在新数据返回前必须保留缓存');
});

test('地图页使用共享离线标识并在卸载时解绑网络监听', () => {
  const fs = require('node:fs');
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.wxml'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.json'), 'utf8'));
  const js = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.js'), 'utf8');

  assert.match(wxml, /<cy-offline-banner\b[^>]*wx:if="\{\{offline\}\}"[^>]*cacheTime="\{\{lastListUpdatedText\}\}"/);
  assert.equal(json.usingComponents['cy-offline-banner'], '/components/cy/offline-banner/index');
  assert.match(wxml, /wx:if="\{\{listRefreshing && list\.length\}\}"[^>]*aria-role="status"/);
  assert.doesNotMatch(wxml, /<cy-inline-error[^>]*merchantNodeError/);  // 商家点位刷新失败静默降级
  assert.match(js, /wx\.onNetworkStatusChange\(this\._networkStatusHandler\)/);
  assert.match(js, /wx\.offNetworkStatusChange\(this\._networkStatusHandler\)/);
});
