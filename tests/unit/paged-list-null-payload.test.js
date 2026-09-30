const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function setPath(target, dotted, value) {
  const parts = dotted.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cursor = cursor[parts[i]] || (cursor[parts[i]] = {});
  }
  cursor[parts[parts.length - 1]] = value;
}

function loadPage(relativePath) {
  const requests = [];
  let definition;
  global.getApp = () => ({
    globalData: {},
    getImgUrl: name => '/images/' + name,
    getPageSize: () => 10,
    getTotalPage: (total, size) => Math.ceil(Number(total || 0) / size),
    getUserID: () => 7,
    getAvatar: () => '',
    getNickname: () => '',
    getRequestErrorMessage: (_response, fallback) => fallback,
    sendRequest(options) { requests.push(options); },
  });
  global.wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    stopPullDownRefresh() {},
    showToast() {},
  };
  global.Page = value => { definition = value; };
  const modulePath = path.resolve(__dirname, '../..', relativePath);
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value));
    if (callback) callback();
  };
  return { page, requests };
}

test('票夹两类分页接口 200 空 payload 都进入错误态', () => {
  const topic = loadPage('subpackageMember/signup/index.js');
  topic.page.getTopicList();
  assert.doesNotThrow(() => topic.requests[0].success({ code: 200, data: null }));
  // 2026-09-09 票夹合并两个 tab 后,错误态由这条支线自己的 state 表达
  // (topicError 布尔与它重复,已删;两条支线的原料不进 data,见 U4 死数据字段门禁)。
  // 钉的性质没变:200 + 空 payload 必须进**错误态**,不能装成「你没有票」。
  assert.equal(topic.page._topic.state, 'error');

  const activity = loadPage('subpackageMember/signup/index.js');
  activity.page.getActivityList();
  assert.doesNotThrow(() => activity.requests[0].success({ code: 200, data: null }));
  assert.equal(activity.page._activity.state, 'error');
});

test('我的模板接口 200 空 payload 不得抛异常或清成真空态', () => {
  const { page, requests } = loadPage('subpackageMember/mytemplate/mytemplate.js');
  page.getList();

  assert.doesNotThrow(() => requests[0].success({ code: 200, data: null }));
  requests[0].complete();

  assert.equal(page.data.loading, false);
  assert.equal(page.data.errorMsg, '玩法草稿加载失败');
});

test('我的模板接口 rows 含空元素不得生成伪模板卡片', () => {
  const { page, requests } = loadPage('subpackageMember/mytemplate/mytemplate.js');
  page.getList();
  assert.doesNotThrow(() => requests[0].success({ code: 200, data: { rows: [null], total: 1 } }));
  requests[0].complete();
  assert.equal(page.data.errorMsg, '玩法草稿加载失败');
  assert.deepEqual(page.data.list, []);
});

test('广场列表 200 空 payload 进入错误态，不得抛异常', () => {
  const { page, requests } = loadPage('pages/square/list/index.js');
  page.getList();

  assert.doesNotThrow(() => requests[0].success({ code: 200, data: null }));
  requests[0].complete();

  assert.equal(page.data.loadError, true);
  assert.equal(page.data.listLoading, false);
});

test('动态详情评论 200 空 payload 进入可重试错误态', () => {
  const { page, requests } = loadPage('pages/square/detail/index.js');
  page.data.id = 9;
  page.getList();

  assert.doesNotThrow(() => requests[0].success({ code: 200, data: null }));
  assert.equal(page.data.commentLoadError, true);
});
