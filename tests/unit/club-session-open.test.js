const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = '../../pages/club/detail/index.js';
let pageConfig;
let sent;
let navigated;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 41,
  getUserRole: () => 'club',
  getImgUrl: (url) => url,
  getAuthorization: () => 'token',
  sendRequest: (request) => { sent = request; },
});
global.wx = {
  showToast() {}, showModal() {}, showActionSheet() {}, showLoading() {}, hideLoading() {},
  stopPullDownRefresh() {}, navigateTo(options) { navigated = options.url; },
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  pageConfig = null;
  sent = null;
  navigated = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function page(data) {
  const instance = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) });
  instance.setData = (patch, callback) => {
    Object.keys(patch).forEach((key) => { instance.data[key] = patch[key]; });
    if (callback) callback();
  };
  Object.assign(instance.data, data || {});
  return instance;
}

test('只有主理人看到开一场入口，管理员不获得主动开团权限', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.wxml'), 'utf8');
  assert.match(wxml, /club\.isOwner[^>]*bindtap="onOpenClubSession"/,
    '入口必须绑定 owner 真源，不能沿用团码的 owner 或 admin 权限');
});

test('开一场统一进入活动运营并明确预选 ONCE，不再走旧建场接口', () => {
  const instance = page({ club: { id: 21, isOwner: true }, clubId: 21 });

  instance.onOpenClubSession();

  assert.equal(navigated, '/pages/club/event-ops/index?clubId=21&recurrence=ONCE');
  assert.equal(sent, null);
});

test('旧开场弹层和直接建 CmsActivity 的前端链路必须彻底退役', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.wxml'), 'utf8');
  assert.doesNotMatch(js, /\/api\/club\/open-session(?:-topics)?/);
  assert.doesNotMatch(js, /submitClubSession|sessionSheetShow/);
  assert.doesNotMatch(wxml, /submitClubSession|sessionSheetShow/);
});

test('非主理人不得从开一场入口进入运营页', () => {
  const instance = page({ club: { id: 21, isOwner: false }, clubId: 21 });
  instance.onOpenClubSession();
  assert.equal(navigated, null);
  assert.equal(sent, null);
});
