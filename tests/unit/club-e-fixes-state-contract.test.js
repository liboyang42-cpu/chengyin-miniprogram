// E-07/E-08/E-09(2026-09-16 整体检查 E 组 P2):俱乐部的「聚焦、刷新、失败态」三处状态契约。
//
// 病:① 从主题进名册/场次管理时 topicId 被目的地页丢掉 ⇒ 打开的是全俱乐部列表;
//     ② 核销详情清退退款后返回名册不刷新 ⇒ 可退款人数停在退款前;
//     ③ 帖子/榜单/商家/入会申请加载失败被渲染成「空」或完全静默。
// 负控:任一条改回旧行为,对应断言必须红。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function loadPage(rel, appOverrides) {
  let definition;
  const requests = [];
  const navigations = [];
  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { requests.push(options); },
    getUserID: () => 1001,
    getUserRole: () => 'club',
    getUserType: () => 'club',
    getAvatar: () => '',
    tips: () => {},
    getRequestErrorMessage: (res, fallback) => (res && (res.msg || res.message)) || fallback,
  }, appOverrides);
  const file = path.join(ROOT, rel);
  // 被 Node 真 require 的 utils(owner-action-guard 等)用调用时的全局 getApp/wx,先挂好
  global.getApp = () => app;
  global.wx = global.wx || { showToast() {} };
  vm.runInNewContext(read(rel), {
    getApp: () => app,
    Page(p) { definition = p; },
    getCurrentPages: () => [{}, {}],
    setTimeout(fn) { return fn ? 1 : 0; },
    clearTimeout() {},
    console,
    wx: {
      showToast() {}, navigateTo(o) { navigations.push(o.url); }, navigateBack() { navigations.push('__back__'); },
      redirectTo(o) { navigations.push(o.url); }, switchTab(o) { navigations.push(o.url); },
      stopPullDownRefresh() {}, getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    },
    require(id) {
      if (/utils\/(toast|loading|modal)\.js$/.test(id)) return { show() {}, hide() {} };
      return require(path.resolve(path.dirname(file), id));
    },
  }, { filename: rel });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      const flat = {};
      Object.keys(patch || {}).forEach((key) => { flat[key] = patch[key]; });
      Object.assign(this.data, flat);
      if (callback) callback.call(this);
    },
  });
  return { page, requests, navigations };
}

// ───────── E-07 名册聚焦 ─────────
test('E-07 名册:带 topicId 进来时到达即展开那一团并拉名单(不再落到全俱乐部列表)', () => {
  const { page, requests } = loadPage('pages/club/enroll/index.js');
  page.onLoad({ clubId: '9', topicId: '31' });
  assert.equal(page._focusTopicId, 31);
  requests.find((r) => r.url === '/api/club/detail').success({ code: 200, data: { isOwner: true } });
  const topics = requests.find((r) => r.url === '/api/club/topics');
  topics.success({ code: 200, data: [{ id: 30, name: '别的团' }, { id: 31, name: '目标团' }] });
  assert.equal(page.data.teams.length, 2, '不隐藏其他团');
  assert.equal(page.data.teams[1]._open, true, '目标团必须到达即展开');
  assert.ok(requests.some((r) => r.url === '/api/club/topic-registrations' && /"topicId":31/.test(r.data)),
    '展开的必须是目标团的名册请求');

  // 负控:不带 topicId 的老入口行为不变(不擅自展开)
  const plain = loadPage('pages/club/enroll/index.js');
  plain.page.onLoad({ clubId: '9' });
  assert.equal(plain.page._focusTopicId, null);
});

test('E-07 场次运营:带 topicId 进来时下拉预选到该主题', () => {
  const { page, requests } = loadPage('pages/club/event-ops/index.js');
  page.onLoad({ clubId: '9', topicId: '31' });
  const access = requests.find((r) => r.url === '/api/club/access/me');
  access.success({ code: 200, data: { active: true, club: { id: 9 }, permissions: ['club:activity:manage'] } });
  const topics = requests.find((r) => r.url === '/api/club/event-ops/topics');
  topics.success({ code: 200, data: [{ id: 30, name: '别的团' }, { id: 31, name: '目标团' }] });
  assert.equal(page.data.topicIndex, 1, '下拉必须预选到目标主题');
});

// ───────── E-08 退款后名册刷新 ─────────
test('E-08 进核销详情后返回名册必须重拉(可退款人数不落后于退款)', () => {
  const { page, requests } = loadPage('pages/club/enroll/index.js');
  page.onLoad({ clubId: '9' });
  requests.find((r) => r.url === '/api/club/detail').success({ code: 200, data: { isOwner: true } });
  requests.find((r) => r.url === '/api/club/topics').success({ code: 200, data: [{ id: 31, name: '目标团' }] });
  const before = requests.length;

  page.goCheckinDetail({ currentTarget: { dataset: { regid: 77 } } });
  assert.equal(page._refreshOnShow, true, '跳转前必须记下「回来要刷新」');
  page.onShow();
  const refetched = requests.slice(before).filter((r) => r.url === '/api/club/topics');
  assert.equal(refetched.length, 1, '返回必须重拉名册');

  // 负控:第二次 onShow 不该重复刷(一次性标记)
  const mark = requests.length;
  page.onShow();
  assert.equal(requests.slice(mark).filter((r) => r.url === '/api/club/topics').length, 0);
});

// ───────── E-09 失败 ≠ 空 ─────────
// 2026-09-17 用户拍板「要改的改好」:入会申请那一半(E-09 的第四处)已按「失败显示内联错误+重试」
// 补上,作为 2026-08-26「有旧内容时刷新失败一律静默降级」的唯一例外 —— 断言在
// club-roster-recovery-contract.test.js(本页旧的「不许出现 cy-inline-error+staleError」已随拍板改写)。
// 这里只测 club/detail 三处(club-e-fixes-gate-contract.test.js)。
