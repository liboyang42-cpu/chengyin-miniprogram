'use strict';

// A-04(P2):自己的评论删不掉 —— 后端 /api/comment/delete 早已存在且带 owner 校验,
// 小程序全仓零入口。本契约钉三件事:
//   ① 渲染层:本人评论行有删除入口(非本人只留举报);
//   ② 行为层:过确认闸后才发 /api/comment/delete,成功后本地摘行;
//   ③ 入口闸:别人的评论连确认框都不弹(后端仍会二次校验)。
// 负控:去掉归属闸 / 变异删除端点,对应断言必须真红。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('../helpers/ui-sandbox-vm.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAGE_REL = 'pages/square/detail/index.js';

function loadPage(opts) {
  const requests = [];
  const modalCalls = [];
  let definition;
  const absolutePath = path.join(ROOT, PAGE_REL);
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    getAvatar: () => '',
    getNickname: () => '',
    getPageSize: () => 10,
    getTotalPage: (total, size) => Math.ceil(Number(total || 0) / size),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) {
      requests.push(options);
      return { aborted: false, abort() { this.aborted = true; } };
    },
  };
  const wxApi = {
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 20, safeAreaInsets: { bottom: 0 } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 64 }),
    hideTabBar() {},
    navigateBack(options) { if (options && options.fail) options.fail(); },
    navigateTo() {},
    redirectTo() {},
    reLaunch() {},
    pageScrollTo() {},
    setClipboardData() {},
    previewImage() {},
    stopPullDownRefresh() {},
    showModal(options) {
      // 本文件的用例自己驱动「确认/取消」,沙箱里的弹层一律不自动确认
      modalCalls.push(options);
    },
    showToast() {}, hideToast() {}, showLoading() {}, hideLoading() {},
    createSelectorQuery: () => ({ select() { return this; }, selectViewport() { return this; }, boundingClientRect() { return this; }, fields() { return this; }, scrollOffset() { return this; }, exec(cb) { if (cb) cb([null]); } }),
  };
  const source = (opts && opts.source) || read(PAGE_REL);
  vm.runInNewContext(source, {
    console,
    getApp: () => app,
    Page: (config) => { definition = config; },
    require: createRequire(absolutePath),
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    wx: wxApi,
  }, { filename: absolutePath });

  assert.ok(definition, PAGE_REL + ' 必须注册 Page');
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.assign(this.data, patch);
      if (done) done.call(this);
    },
  });
  return { page, requests, modalCalls };
}

function readyWithComments(h, over) {
  h.page.onLoad({ id: '77' });
  const info = h.requests.find((r) => r.url === '/api/creativesquare/info');
  assert.ok(info, '详情必须先请求 info');
  info.success({ code: '200', data: Object.assign({ id: 77, memberId: 1, contents: '正文' }, over || {}) });
  const comments = h.requests.find((r) => r.url === '/api/comment/list');
  assert.ok(comments, '详情必须请求评论列表');
  comments.success({
    code: '200',
    data: {
      rows: [
        { id: 501, memberId: 1, memberNickname: '我自己', contents: '我的评论', likeCount: 0 },
        { id: 502, memberId: 2, memberNickname: '别人', contents: '别人的评论', likeCount: 0 },
      ],
      total: 2,
    },
  });
  assert.equal(h.page.data.list.length, 2);
}

test('渲染层:本人评论有删除入口,非本人只留举报', () => {
  const wxml = read('pages/square/detail/index.wxml');
  assert.match(wxml, /<button class="comment-report comment-delete"[^>]*wx:if="\{\{item\.memberId == userId\}\}"[^>]*bindtap="deleteComment"[^>]*aria-label="删除评论"/,
    '删除入口必须只对本人渲染且绑定 deleteComment');
  assert.match(wxml, /bindtap="reportComment"/, '举报入口不能被顶掉');
  const js = read(PAGE_REL);
  assert.match(js, /url: '\/api\/comment\/delete'/, '删除入口必须接后端已有端点');
});

test('行为层:走确认弹窗 → 发删除请求 → 成功后本地摘行', () => {
  const h = loadPage();
  readyWithComments(h);

  h.page.deleteComment({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(h.modalCalls.length, 1, '删除必须先过确认(不可逆动作)');
  assert.equal(h.requests.some((r) => r.url === '/api/comment/delete'), false, '未确认前不得发请求');

  h.modalCalls[0].success({ confirm: true });
  const del = h.requests.find((r) => r.url === '/api/comment/delete');
  assert.ok(del, '确认后必须发删除请求');
  assert.equal(String(del.data.id), '501', '删的必须是这一条');

  del.success({ code: '200' });
  assert.deepEqual(h.page.data.list.map((row) => row.id), [502], '删除成功后本地摘掉该行');
  assert.equal(h.page.data.nodata, false);
});

test('入口闸:别人的评论不弹确认也不发请求(后端另有 owner 校验)', () => {
  const h = loadPage();
  readyWithComments(h);

  h.page.deleteComment({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(h.modalCalls.length, 0, '别人的评论不该出现删除确认');
  assert.equal(h.requests.some((r) => r.url === '/api/comment/delete'), false);
});

test('负控:去掉归属闸,「别人的评论不弹确认」用例真红', () => {
  const source = read(PAGE_REL);
  const brokenSource = source.replace("    if (String(item.memberId) !== String(that.data.userId)) return; // 入口只给自己的评论;后端仍会再校验一次\n", '');
  assert.notEqual(brokenSource, source, '负控锚点失效:归属闸未命中');

  const h = loadPage({ source: brokenSource });
  readyWithComments(h);
  h.page.deleteComment({ currentTarget: { dataset: { index: 1 } } });
  assert.notEqual(h.modalCalls.length, 0, '负控必须真的把归属闸摘掉');
});

test('负控:变异删除端点,发请求用例真红', () => {
  const source = read(PAGE_REL);
  const brokenSource = source.replace("url: '/api/comment/delete'", "url: '/api/comment/report'");
  assert.notEqual(brokenSource, source, '负控锚点失效:删除端点未命中');

  const h = loadPage({ source: brokenSource });
  readyWithComments(h);
  h.page.deleteComment({ currentTarget: { dataset: { index: 0 } } });
  h.modalCalls[0].success({ confirm: true });
  assert.equal(h.requests.some((r) => r.url === '/api/comment/delete'), false, '负控必须真的把端点改掉');
});
