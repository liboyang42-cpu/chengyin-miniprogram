'use strict';

// C-02b:队长建队后没有任何前端入口把「公开招募」改回「仅邀请」。
// 后端 POST /api/team/join-mode 只认队长 + joinMode∈{1,2}(没有满员/进行中的状态闸),
// 队伍详情页只在 status=0(招募中)给这一行 —— 满员/已开始/已结束的队伍本就不在
// 「附近的队伍」里,切换对任何界面都没有效果。
//
// 契约:① 队长 + 招募中 → 开关按 team.joinMode 回显;
//      ② 切换发 POST /api/team/join-mode,body 带 teamId 与目标 joinMode;
//      ③ 失败/非 200 → 回滚回显,不本地假设成功;
//      ④ 行只对队长且 status=0 渲染。
// 负控:去掉提交与回滚,对应用例必须真红。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const PAGE_REL = 'pages/team/detail/index.js';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadPage(source) {
  const requests = [];
  const toasts = [];
  let definition = null;
  const absolutePath = path.join(ROOT, PAGE_REL);
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) { requests.push(options); return { abort() {}, aborted: false }; },
  };
  const wxApi = {
    stopPullDownRefresh() {}, navigateBack() {}, switchTab() {}, showToast() {},
  };
  vm.runInNewContext(source || read(PAGE_REL), {
    console,
    getApp: () => app,
    getCurrentPages: () => [{}],
    Page: (config) => { definition = config; },
    require(request) {
      // toast 出口:直接收进 toasts,不落到 wx 兜底
      if (request.indexOf('toast') !== -1) return (title) => { toasts.push(title); };
      return createRequire(absolutePath)(request);
    },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    wx: wxApi,
  }, { filename: PAGE_REL });
  assert.ok(definition, PAGE_REL + ' 必须注册 Page');
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.entries(patch).forEach(([key, value]) => {
        const parts = key.split('.');
        let cursor = this.data;
        parts.slice(0, -1).forEach((part) => { cursor = cursor[part] || (cursor[part] = {}); });
        cursor[parts.at(-1)] = value;
      });
      if (done) done.call(this);
    },
  });
  return { page, requests, toasts };
}

function teamFixture(overrides) {
  return Object.assign({
    id: 9, joinMode: 2, status: 0, title: '夜行小队', joinedCount: 2, maxMembers: 4,
    expireTime: '2099-01-01 10:00:00',
  }, overrides || {});
}

function openWithTeam(overrides, source) {
  const env = loadPage(source);
  env.page.onLoad({ teamId: '9' });
  env.page.load();
  const info = env.requests.find((r) => r.url === '/api/team/info');
  assert.ok(info, '进页必须读队伍详情');
  info.success({ code: '200', data: { team: teamFixture(overrides), members: [], joined: true, leader: true } });
  return env;
}

test('C-02b:招募中的队长把公开改成仅邀请,发 /api/team/join-mode 并回显服务端结果', () => {
  const { page, requests, toasts } = openWithTeam({ joinMode: 2 });
  assert.equal(page.data.leader, true);
  assert.equal(page.data.joinModePublic, true, '公开招募(joinMode=2)回显为开');

  page.onJoinModeChange({ detail: { value: false } });
  const update = requests.find((r) => r.url === '/api/team/join-mode');
  assert.ok(update, '切换必须发 join-mode 请求');
  assert.deepEqual(JSON.parse(update.data), { teamId: 9, joinMode: 1 }, '关 = 仅邀请(joinMode=1)');
  assert.equal(page.data.joinModeSaving, true, '提交中要禁用开关防重入');

  update.success({ code: '200', data: { joinMode: 1 } });
  assert.equal(page.data.joinModeSaving, false);
  assert.equal(page.data.joinModePublic, false);
  assert.equal(page.data.team.joinMode, 1, '回显以服务端返回为准');
  assert.equal(toasts.at(-1), '已改为仅邀请');
});

test('C-02b:反向切换回公开招募,body 带 joinMode=2', () => {
  const { page, requests } = openWithTeam({ joinMode: 1 });
  assert.equal(page.data.joinModePublic, false);

  page.onJoinModeChange({ detail: { value: true } });
  const update = requests.find((r) => r.url === '/api/team/join-mode');
  assert.deepEqual(JSON.parse(update.data), { teamId: 9, joinMode: 2 });
  update.success({ code: '200', data: { joinMode: 2 } });
  assert.equal(page.data.joinModePublic, true);
});

test('C-02b:提交失败回滚开关,不本地假设成功', () => {
  const { page, requests, toasts } = openWithTeam({ joinMode: 2 });
  page.onJoinModeChange({ detail: { value: false } });
  const update = requests.find((r) => r.url === '/api/team/join-mode');
  update.success({ code: 500, msg: '只有队长可以操作' });
  assert.equal(page.data.joinModePublic, true, '非 200 必须回滚回原来的公开态');
  assert.equal(page.data.joinModeSaving, false);
  assert.equal(toasts.at(-1), '只有队长可以操作');

  const network = openWithTeam({ joinMode: 2 });
  network.page.onJoinModeChange({ detail: { value: false } });
  network.requests.find((r) => r.url === '/api/team/join-mode').fail({ errMsg: 'request:fail timeout' });
  assert.equal(network.page.data.joinModePublic, true, '网络失败同样回滚');
  assert.equal(network.toasts.at(-1), '网络异常，请重试');
});

test('C-02b:入口只对队长且在招募中(status=0)渲染;负控去掉失败回滚必须真红', () => {
  const wxml = read('pages/team/detail/index.wxml');
  assert.match(wxml, /wx:if="\{\{leader && team\.status == 0\}\}"/, '行只给招募中的队长');
  assert.match(wxml, /<cy-switch[^>]*checked="\{\{joinModePublic\}\}"[^>]*disabled="\{\{joinModeSaving\}\}"[^>]*bindchange="onJoinModeChange"/);
  const json = JSON.parse(read('pages/team/detail/index.json'));
  assert.equal(json.usingComponents['cy-switch'], '/components/cy/switch/index');

  // 负控:去掉失败回滚,回滚用例必须能复现「开关留在错的一侧」
  const source = read(PAGE_REL);
  const broken = source.replace(
    "        that.setData({ joinModeSaving: false, joinModePublic: prevMode === 2 });\n        cyToast(app.getRequestErrorMessage(res, '切换失败，请重试'));",
    "        that.setData({ joinModeSaving: false });\n        cyToast(app.getRequestErrorMessage(res, '切换失败，请重试'));",
  );
  assert.notEqual(broken, source, '负控锚点失效:回滚分支未命中');
  const { page, requests } = openWithTeam({ joinMode: 2 }, broken);
  page.onJoinModeChange({ detail: { value: false } });
  requests.find((r) => r.url === '/api/team/join-mode').success({ code: 500 });
  assert.equal(page.data.joinModePublic, false, '负控必须复现「失败后开关留在仅邀请」');
});
