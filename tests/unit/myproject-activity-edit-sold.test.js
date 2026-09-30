// 我的项目：未开卖已发布活动给出「编辑」；已开卖只保留上下架/取消，点编辑留在本页说明。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../subpackageA/pages/myproject/index.js';

let sent = [];
let toasts = [];
let navigations = [];
let pageConfig = null;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (p) => { sent.push(p); },
  getUserID: () => 1,
  getToken: () => '',
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
});
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  showToast: (o) => { toasts.push(o && o.title); },
  showLoading: () => {},
  hideLoading: () => {},
  showModal: (o) => { if (o.success) o.success({ confirm: true }); },
  navigateTo: (o) => { navigations.push(o.url); },
  redirectTo: (o) => { navigations.push(o.url); },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  nextTick: (f) => f(),
  setNavigationBarColor: () => {},
  setNavigationBarTitle: () => {},
};

global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  sent = [];
  toasts = [];
  navigations = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const inst = Object.assign({}, pageConfig);
  inst.data = JSON.parse(JSON.stringify(pageConfig.data));
  inst.setData = function (patch) { Object.assign(inst.data, patch); };
  return inst;
}

function activityRow(overrides) {
  return Object.assign({
    id: 301,
    bizType: 'activity',
    title: '外滩夜行',
    projectTypeText: '俱乐部活动',
    state: 'running',
    stateText: '进行中',
    ownerType: 'club',
    signupCount: 0,
    viewCount: 12,
  }, overrides);
}

function loadActivities(page, rows) {
  page.setData({ typeTab: 'activity' });
  page.loadProjects();
  sent[0].success({ code: '200', data: { rows: rows, total: rows.length } });
}

test('未开卖已发布活动显示编辑，点编辑进发布页带 id', () => {
  const page = makePage();
  loadActivities(page, [activityRow({ signupCount: 0, state: 'notStarted' })]);

  const card = page.data.list[0];
  assert.equal(card._canEdit, true);
  assert.equal(card._sold, false);

  page.editActivity({ currentTarget: { dataset: { item: card } } });
  assert.equal(navigations[0], '/pages/publish/activity/index?id=301');
});

test('已开卖活动点编辑留在本页并说明，不进表单；上下架仍在', () => {
  const page = makePage();
  loadActivities(page, [activityRow({ signupCount: 2, state: 'running' })]);

  const card = page.data.list[0];
  assert.equal(card._canEdit, true, '已售仍显示编辑，点下去才说明不能改');
  assert.equal(card._canToggle, true);
  assert.equal(card._sold, true);

  page.editActivity({ currentTarget: { dataset: { item: card } } });
  assert.equal(navigations.length, 0, '已开卖不得打开编辑表单');
  assert.ok(toasts.some((t) => t && String(t).indexOf('已有人买票，不能再改这场活动') >= 0),
    '必须留在本页并说明原因，实际:' + JSON.stringify(toasts));
});
