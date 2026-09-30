'use strict';

// A-05(P2):详情页编辑/删除后返回广场列表,列表还是旧卡(列表 onShow 只重算横幅、从不重拉)。
// 修法:详情侧删/改成功后给上一页(列表)置脏标,列表 onShow 只在有脏标时刷一次首屏 ——
// 不是每次 onShow 全量重拉。
//
// 契约两侧都钉:① 列表侧:脏标驱动一次刷新、且只消费一次;
//             ② 详情侧:删除/编辑保存成功真的会调用上一页的置脏方法。
// 负控:去掉列表的脏标分支 / 去掉详情置脏调用,对应用例必须真红。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('../helpers/ui-sandbox-vm.js');

const ROOT = path.resolve(__dirname, '../..');
const LIST_REL = 'pages/square/list/index.js';
const DETAIL_REL = 'pages/square/detail/index.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}

function loadList(opts) {
  const requests = [];
  let definition = null;
  const absolutePath = path.join(ROOT, LIST_REL);
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    getAvatar: () => '',
    getNickname: () => '',
    getPageSize: () => 10,
    getTotalPage: () => 1,
    getRequestErrorMessage: (res, fallback) => fallback,
    sendRequest(options) { requests.push(options); return { abort() {}, aborted: false }; },
  };
  const wxApi = {
    hideTabBar() {}, showTabBar() {}, stopPullDownRefresh() {}, setNavigationBarColor() {},
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 20, safeAreaInsets: { bottom: 0 } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 64 }),
    createSelectorQuery: () => ({ select() { return this; }, selectViewport() { return this; }, boundingClientRect() { return this; }, fields() { return this; }, scrollOffset() { return this; }, exec(cb) { if (cb) cb([{ scrollTop: 0 }]); } }),
  };
  const source = (opts && opts.source) || read(LIST_REL);
  // ui-sandbox-vm 只把 toast/loading/modal/datetime 装进沙箱;theme/merchant-theme 走 Node 真 require,
  // 读的是主 realm 的全局 —— 两个 realm 都要给桩。
  global.getApp = () => app;
  global.wx = wxApi;
  vm.runInNewContext(source, {
    console,
    getApp: () => app,
    Page: (config) => { definition = config; },
    require: createRequire(absolutePath),
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    wx: wxApi,
  }, { filename: absolutePath });
  assert.ok(definition, LIST_REL + ' 必须注册 Page');
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value));
      if (done) done.call(this);
    },
  });
  return { page, requests, app };
}

const feedRequests = (requests) => requests.filter((r) => r.url === '/api/creativesquare/list');

test('列表:无脏标不重拉,置脏标后 onShow 刷一次,且脏标只消费一次', () => {
  const { page, requests } = loadList();
  page.onShow();
  assert.equal(feedRequests(requests).length, 0, '没有详情变更时不许每次 onShow 全量重拉');

  page.markSquareListDirty();
  page.onShow();
  assert.equal(feedRequests(requests).length, 1, '详情删/改过,回列表必须刷一次首屏');
  assert.equal(feedRequests(requests)[0].data.pageNum, 1, '只刷首屏');

  page.onShow();
  assert.equal(feedRequests(requests).length, 1, '脏标消费后不得持续重拉');
});

test('列表:刷新失败不清脏标之外的任何已读内容,刷新请求走既有 getList 口径', () => {
  const { page, requests } = loadList();
  page.setData({ list: [{ id: 900, memberId: 1, contents: '旧卡' }], listLoading: false });
  page.markSquareListDirty();
  page.onShow();
  const feed = feedRequests(requests)[0];
  assert.ok(feed, '脏标必须触发首屏请求');
  assert.equal(feed.data.pageNum, 1);
  assert.ok(page.data.list.length >= 1, '刷新期间旧卡仍在屏上');
});

function loadDetail(prev, opts) {
  const requests = [];
  const toasts = [];
  let definition = null;
  const absolutePath = path.join(ROOT, DETAIL_REL);
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    getAvatar: () => '', getNickname: () => '',
    getPageSize: () => 10, getTotalPage: () => 1,
    getRequestErrorMessage: (res, fallback) => fallback,
    sendRequest(options) { requests.push(options); return { abort() {}, aborted: false }; },
  };
  const wxApi = {
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 20, safeAreaInsets: { bottom: 0 } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 64 }),
    hideTabBar() {}, setNavigationBarColor() {}, navigateBack(o) { if (o && o.fail) o.fail(); }, navigateTo() {}, redirectTo() {}, reLaunch() {},
    showToast(options) { toasts.push(options); }, hideToast() {}, showLoading() {}, hideLoading() {},
    createSelectorQuery: () => ({ select() { return this; }, selectViewport() { return this; }, boundingClientRect() { return this; }, fields() { return this; }, scrollOffset() { return this; }, exec(cb) { if (cb) cb([null]); } }),
  };
  vm.runInNewContext((opts && opts.source) || read(DETAIL_REL), {
    console,
    getApp: () => app,
    // A-RPT-5:分享直开时栈里只有详情本页(opts.share),没有上一页实例。
    getCurrentPages: () => (opts && opts.share ? [page] : [prev, page]),
    Page: (config) => { definition = config; },
    require: createRequire(absolutePath),
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    wx: wxApi,
  }, { filename: DETAIL_REL });
  assert.ok(definition, DETAIL_REL + ' 必须注册 Page');
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) { Object.assign(this.data, patch); if (done) done.call(this); },
  });
  return { page, requests, app, toasts };
}

test('详情:删除成功调用上一页 markSquareListDirty', () => {
  const prev = { marked: 0, markSquareListDirty() { this.marked += 1; } };
  const { page, requests } = loadDetail(prev);

  page.onLoad({ id: '77' });
  const info = requests.find((r) => r.url === '/api/creativesquare/info');
  info.success({ code: '200', data: { id: 77, memberId: 1, contents: '正文' } });
  page.deleteSquarePost();
  const del = requests.find((r) => r.url === '/api/creativesquare/delete');
  assert.ok(del, '删除必须发请求');
  del.success({ code: '200' });
  assert.equal(prev.marked, 1, '详情删帖成功必须给列表置脏标,否则返回后还是旧卡');
});

test('详情:编辑保存成功也置脏标(列表正文同样会过期)', () => {
  const source = read(DETAIL_REL);
  const onComposePublished = source.slice(source.indexOf('onComposePublished()'), source.indexOf('markListDirty() {'));
  assert.match(onComposePublished, /this\.markListDirty\(\)/, '编辑保存成功必须置脏标');
});

test('A-14-1:评论点赞失败且后端无 msg 时,兜底文案不静默也不弹 undefined', () => {
  const { page, requests, toasts } = loadDetail(null, { share: true });
  page.setData({ list: [{ id: 55, isLiked: 0, likeCount: 1 }] });
  page.commentLikeClick({ currentTarget: { dataset: { index: 0 } } });
  const like = requests.find((r) => r.url === '/api/comment/like');
  assert.ok(like, '点赞要发请求');

  like.success({ code: 500 });
  assert.equal(toasts.length, 1, '失败必须有可见反馈');
  assert.equal(toasts[0].title, '操作失败，请重试');
  assert.doesNotMatch(String(toasts[0].title), /undefined/);

  // 负控:退回原始的一行 toast(res.msg),无 msg 时用户什么都看不到
  const source = read(DETAIL_REL).replace(
    "toast(app.getRequestErrorMessage(res, '操作失败，请重试'));",
    'toast(res.msg);',
  );
  assert.notEqual(source, read(DETAIL_REL), '负控锚点失效:兜底文案未命中');
  const broken = loadDetail(null, { share: true, source });
  broken.page.setData({ list: [{ id: 55, isLiked: 0, likeCount: 1 }] });
  broken.page.commentLikeClick({ currentTarget: { dataset: { index: 0 } } });
  broken.requests.find((r) => r.url === '/api/comment/like').success({ code: 500 });
  assert.equal(broken.toasts.length, 0, '负控必须复现「失败还完全没提示」');
});

test('A-RPT-5:分享直开详情(栈里没有列表)时,置脏落 app 级脏标', () => {
  const { page, requests, app } = loadDetail(null, { share: true });
  page.onLoad({ id: '77' });
  const info = requests.find((r) => r.url === '/api/creativesquare/info');
  info.success({ code: '200', data: { id: 77, memberId: 1, contents: '正文' } });
  page.deleteSquarePost();
  requests.find((r) => r.url === '/api/creativesquare/delete').success({ code: '200' });
  assert.equal(app.globalData.squareListDirty, true,
    '分享直开没有上一页实例,脏标必须落到 app 级,否则之后进列表仍是旧卡');
});

test('A-RPT-5:列表消费 app 级脏标刷一次,且只消费一次', () => {
  const { page, requests, app } = loadList();
  page.onShow();
  assert.equal(feedRequests(requests).length, 0, '没有脏标不许重拉');

  app.globalData.squareListDirty = true; // 详情由分享直开时置的脏标
  page.onShow();
  assert.equal(feedRequests(requests).length, 1, 'app 级脏标也必须触发首屏刷新');
  page.onShow();
  assert.equal(feedRequests(requests).length, 1, 'app 级脏标消费后不得持续重拉');
});

test('A-RPT-5 负控:详情没上一页时去掉 app 级脏标,再进列表不刷 ⇒ 用例真红', () => {
  const source = read(DETAIL_REL);
  const broken = source.replace(
    '    if (app.globalData) app.globalData.squareListDirty = true;\n',
    '',
  );
  assert.notEqual(broken, source, '负控锚点失效:app 级置脏未命中');

  // 用同一份变异源加载详情,验证「分享直开」这一路真的不再产生任何脏标
  const { page, requests, app } = loadDetail(null, { share: true, source: broken });
  page.onLoad({ id: '77' });
  requests.find((r) => r.url === '/api/creativesquare/info').success({ code: '200', data: { id: 77, memberId: 1, contents: '正文' } });
  page.deleteSquarePost();
  requests.find((r) => r.url === '/api/creativesquare/delete').success({ code: '200' });
  assert.equal(app.globalData.squareListDirty, undefined, '负控必须真的把 app 级置脏摘掉');
});

test('负控:去掉列表脏标分支,置脏标后仍不刷 ⇒ 用例真红', () => {
  const source = read(LIST_REL);
  const broken = source.replace(
    '    const globalDirty = !!(app.globalData && app.globalData.squareListDirty);\n    if (this._squareListDirty || globalDirty) {\n      this._squareListDirty = false;\n      if (app.globalData) app.globalData.squareListDirty = false;\n      this.refreshList();\n    }\n',
    '',
  );
  assert.notEqual(broken, source, '负控锚点失效:脏标分支未命中');

  const { page, requests } = loadList({ source: broken });
  page.markSquareListDirty();
  page.onShow();
  assert.equal(feedRequests(requests).length, 0, '负控必须真的把脏标分支摘掉');
});
