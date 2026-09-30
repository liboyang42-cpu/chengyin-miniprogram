'use strict';
// C-26(拍板 2026-09-16):自玩没有/过期通行证时,不再说「你还没有报名这个场次」,
// 而是 needPass 空态 + 「获取通行证」按钮,出路是去主题详情获取通行证(自玩没有「报名」这个动作)。
// 后端 /api/play/nodes 自玩无有效通行证回 402(见 ApiPlaySelfPlayPassGateTest),前端必须把它落成 needPass。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PLAY_PAGE = '../../pages/play/index.js';
const PLAY_WXML = fs.readFileSync(path.resolve(__dirname, '../../pages/play/index.wxml'), 'utf8');

let requests;

global.getApp = () => ({
  globalData: { user_id: 9, features: {}, statusBarHeight: 20 },
  getUserID: () => '9',
  isDevEnv: () => false,
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request); },
});
global.wx = {
  getStorageSync: () => undefined,
  setStorageSync: () => {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20 }),
  getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 278, right: 365, width: 87, height: 32 }),
  showLoading() {},
  hideLoading() {},
  showToast() {},
};

let pageConfig;

function loadPlayPage() {
  delete require.cache[require.resolve(PLAY_PAGE)];
  require(PLAY_PAGE);
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) });
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  return page;
}

beforeEach(() => {
  requests = [];
  pageConfig = null;
  global.Page = (config) => { pageConfig = config; };
});

test('C-26 自玩无通行证 402 → needPass 空态,不再落「未报名」文案', async () => {
  const page = loadPlayPage();
  page.data.topicId = '73';

  page.loadData(true);
  assert.equal(requests.length, 1);
  requests[0].success({ code: 402, msg: '请先购买自玩通行证' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(page.data.loading, false);
  assert.equal(page.data.emptyKind, 'needPass', '必须落 needPass,不许落 signup');
  assert.match(page.data.emptyTip, /通行证/);
  assert.doesNotMatch(page.data.emptyTip, /报名/);
});

test('C-26 needPass 空态有「获取通行证」按钮,且跳主题详情(不跳报名)', () => {
  assert.match(PLAY_WXML, /emptyKind=='needPass'[\s\S]{0,200}?bindtap="goGetPass"/, 'needPass 必须有自己的按钮');
  assert.match(PLAY_WXML, /emptyKind=='needPass'[\s\S]{0,200}?>获取通行证</);

  const page = loadPlayPage();
  page.data.topicId = '73';
  const navigations = [];
  global.wx.navigateTo = (value) => { navigations.push(value.url); };
  page.goGetPass();
  assert.deepEqual(navigations, ['/pages/topic/index/index?id=73'], '出路是主题详情(通行证在那里买/续)');
});

test('C-26 场次报名(活动会话)的未报名文案保持不变', () => {
  assert.match(PLAY_WXML, /emptyKind=='signup'[\s\S]{0,200}?>去报名</, '活动场次的报名出路不许被本次改动误删');
});
