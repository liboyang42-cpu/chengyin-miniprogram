'use strict';

// A-02(P1):地图搜索的日期/价格筛选原先只是「发参数」——后端 activityList 签名里根本没有
// min_price/max_price/date_type/start_date/end_date,参数被静默忽略,用户以为筛过了。
// 修法:删掉死参数 + 客户端用 search2/result 同一套 discover-search.matchesFilters 过滤。
//
// A-08(P2):首页刷新失败但屏上还有旧结果时原先静默降级(pageError 清空),
// 用户会把旧区域/旧筛选的结果当成新的。修法:保留旧结果 + 页内错误条 + 原地重试。
//
// 负控:去掉客户端过滤 / 改回静默清空 pageError,对应用例必须真红。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_REL = 'pages/searchmap/index.js';
const PAGE_PATH = path.resolve(__dirname, '../../pages/searchmap/index.js');
const read = () => fs.readFileSync(PAGE_PATH, 'utf8');

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
  let definition;
  global.getApp = () => ({
    globalData: {},
    sendRequest(options) { requests.push(options); return { abort() {} }; },
  });
  global.wx = {
    showToast() {},
    getNetworkType(options) { options.success({ networkType: 'wifi' }); },
    onNetworkStatusChange() {},
    offNetworkStatusChange() {},
  };
  global.Page = (value) => { definition = value; };
  delete require.cache[require.resolve(PAGE_PATH)];
  if (source) {
    const Module = require('node:module');
    const m = new Module(PAGE_PATH, null);
    m.filename = PAGE_PATH;
    m.paths = Module._nodeModulePaths(path.dirname(PAGE_PATH));
    m._compile(source, PAGE_PATH);
  } else {
    require(PAGE_PATH);
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
  return { page, requests };
}

const ok = (request, rows) => request.success({ code: 200, data: { rows } });

const ROWS = [
  { id: 1, name: '今天的百元活动', startDate: '2026-09-16 10:00:00', minAmout: 150, latitude: 31.2, longitude: 121.4 },
  { id: 2, name: '明天的免费活动', startDate: '2026-09-17 10:00:00', minAmout: 50, latitude: 31.3, longitude: 121.5 },
  { id: 3, name: '今天的便宜活动', startDate: '2026-09-16 18:00:00', minAmout: 50, latitude: 31.4, longitude: 121.6 },
];

test('筛选:日期「今天」在客户端过滤已返回列表,请求里不再带后端不消费的死参数', () => {
  const { page, requests } = loadPage();
  page.setData({
    'filterConditions.keyword': '跑',
    'filterConditions.startDate': '2026-09-16',
    'filterConditions.endDate': '2026-09-16',
  });
  page.getList();
  ok(requests[0], ROWS);

  assert.deepEqual(page.data.list.map((item) => item.id), [1, 3], '今天之外的场次必须被筛掉');
  assert.deepEqual(page.data.activityMarkers.map((item) => item.activityId), [1, 3], '地图点位与列表同口径');
  for (const dead of ['min_price', 'max_price', 'date_type', 'start_date', 'end_date']) {
    assert.equal(Object.prototype.hasOwnProperty.call(requests[0].data, dead), false,
      `${dead} 后端签名不消费,发过去就是死参数`);
  }
  // 2026-09-16 截图冒烟修复:没选分类时传空串,不能传 null/undefined 原样透出 ——
  // wx.request 会把 null 序列化成字面量 "null",后端 DiscoveryFilterContract 解析不出正整数
  // 直接 400「category_id 必须为正整数」。空串才是「未提供」的同义表达(后端 optionalRaw)。
  assert.equal(requests[0].data.category_id, '', '没选分类必须传空串,不许传会序列化成 "null" 的空值');
  assert.equal(requests[0].data.keyword, '跑');
});

test('筛选:价格区间在客户端过滤,最高价默认 1000 时不筛价', () => {
  const { page, requests } = loadPage();
  page.setData({ 'filterConditions.minPrice': 100, 'filterConditions.maxPrice': 1000 });
  page.getList();
  ok(requests[0], ROWS);
  assert.deepEqual(page.data.list.map((item) => item.id), [1], '低于最低价的活动必须被筛掉');

  const free = loadPage();
  free.page.setData({ 'filterConditions.minPrice': 0, 'filterConditions.maxPrice': 60 });
  free.page.getList();
  ok(free.requests[0], ROWS);
  assert.deepEqual(free.page.data.list.map((item) => item.id), [2, 3], '最高价设了才按上限筛');
});

test('筛选:面板选「今天」的真实路径必须把日期边界带进 filterConditions(否则客户端筛不了)', () => {
  const { page, requests } = loadPage();
  page.selectDate({ currentTarget: { dataset: { value: '1' } } });
  assert.match(page.data.startdate, /^\d{4}-\d{2}-\d{2}$/, '选「今天」必须落一个真实日期');

  page.searchFilter();
  assert.equal(page.data.filterConditions.startDate, page.data.startdate, '今天/明天也必须给客户端过滤写边界');
  assert.equal(page.data.filterConditions.endDate, page.data.enddate);

  ok(requests[0], [
    { id: 1, name: '今天', startDate: page.data.startdate + ' 10:00:00' },
    { id: 2, name: '别天', startDate: '2999-01-01 10:00:00' },
  ]);
  assert.deepEqual(page.data.list.map((item) => item.id), [1], '选今天只该留下今天的场次');
});

test('负控:把「今天」的日期边界改回空串,同一条断言真红', () => {
  const source = read();
  const broken = source.replace(
    "    filterConditions.startDate = isYmd(this.data.startdate) ? this.data.startdate : '';",
    "    filterConditions.startDate = '';");
  assert.notEqual(broken, source, '负控锚点失效:日期边界赋值未命中');

  const { page } = loadPage(broken);
  page.selectDate({ currentTarget: { dataset: { value: '1' } } });
  page.searchFilter();
  assert.throws(() => {
    assert.equal(page.data.filterConditions.startDate, page.data.startdate, '今天/明天也必须给客户端过滤写边界');
  }, assert.AssertionError, '负控:边界被抹掉后主用例必须真红');
});

test('筛选只影响展示:整页被筛掉时仍按原始行数保留继续翻页的能力', () => {
  const { page, requests } = loadPage();
  page.setData({ pageNum: 1, pageSize: 2, 'filterConditions.startDate': '2027-01-01', 'filterConditions.endDate': '2027-01-01' });
  page.getList();
  ok(requests[0], ROWS.slice(0, 2));
  assert.deepEqual(page.data.list, [], '今天没有匹配场次');
  assert.equal(page.data.hasMore, true, '原始返回满页 = 后面可能还有,不能因筛空一页就判到底');
});

test('A-08:首页刷新失败且屏上有旧结果 ⇒ 保留旧结果 + 页内错误条,可原地重试', () => {
  const { page, requests } = loadPage();
  const cached = [{ id: 7, name: '旧区域结果', latitude: 31, longitude: 121 }];
  page.setData({ list: cached, listState: 'ready', pageNum: 1, hasMore: true, pageError: '', pageErrorIsRefresh: false });

  page.getList();
  requests[0].fail({ errMsg: 'request:fail timeout' });

  assert.deepEqual(page.data.list, cached, '刷新失败必须保住旧列表');
  assert.equal(page.data.listState, 'ready');
  assert.notEqual(page.data.pageError, '', 'A-08:有旧结果时刷新失败不再静默,必须挂内联错误条');
  assert.equal(page.data.pageErrorIsRefresh, true, '刷新失败与翻页失败要能区分,文案不同');

  page.retryListPage();
  assert.equal(page.data.pageError, '', '重试开始先收掉错误条');
  ok(requests[1], cached);
  assert.equal(page.data.pageErrorIsRefresh, false);
  assert.deepEqual(page.data.list.map((item) => item.id), [7]);
});

test('负控:摘掉客户端过滤,日期筛选用例真红', () => {
  const source = read();
  const broken = source.replace("const newList = discoverSearch.filterRows('activity', rawList, requestFilters);", 'const newList = rawList;');
  assert.notEqual(broken, source, '负控锚点失效:客户端过滤调用点未命中');

  const { page, requests } = loadPage(broken);
  page.setData({
    'filterConditions.startDate': '2026-09-16',
    'filterConditions.endDate': '2026-09-16',
  });
  page.getList();
  ok(requests[0], ROWS);
  assert.notDeepEqual(page.data.list.map((item) => item.id), [1, 3], '去掉过滤后必须退回未筛的全量(负控生效)');
  assert.equal(page.data.list.length, 3);
});

test('负控:刷新失败改回静默清空,旧结果仍在但无任何提示 ⇒ 用例真红', () => {
  const source = read();
  const broken = source.replace("        pageError: msg || '刷新失败，请重试',", "        pageError: '',");
  assert.notEqual(broken, source, '负控锚点失效:刷新失败分支未命中');

  const { page, requests } = loadPage(broken);
  const cached = [{ id: 7, name: '旧区域结果' }];
  page.setData({ list: cached, listState: 'ready', pageNum: 1, hasMore: true });
  page.getList();
  requests[0].fail({ errMsg: 'request:fail timeout' });
  assert.equal(page.data.pageError, '', '负控必须真的把提示改回静默');
});
