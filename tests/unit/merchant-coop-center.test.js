const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const PAGE = path.join(ROOT, 'pages/merchant/coop-center/index.js');
const VIEW = path.join(ROOT, 'pages/merchant/coop-center/index.wxml');

function loadPage() {
  const requests = [];
  const modals = [];
  const navigations = [];
  const toasts = [];
  let definition;
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { requests.push(options); },
    getRequestErrorMessage(res, fallback) { return (res && res.msg) || fallback; },
    tips() {},
  });
  global.getCurrentPages = () => [{ route: 'pages/merchant/coop-center/index' }];
  global.wx = {
    navigateBack() {},
    navigateTo(options) { navigations.push(options.url); },
    reLaunch() {},
    showActionSheet() {},
    showLoading() {},
    hideLoading() {},
    showModal(options) { modals.push(options); },
    showToast(options) { toasts.push(options); },
  };
  global.Page = (config) => { definition = config; };
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return { page, requests, modals, navigations, toasts };
}

// 稿 234:276 + 用户裁决(2026-09-15)「全站只有收到的/我发出的两个入口」:
//   合作中心只剩 官方活动 / 广场 两个发现 tab,邀约处理整体在协作邀请页;
//   卡上申请承接挪到「看详情」(merchantinfo 持有同一套章节申请 + chapter-node-form)。
function assertInboxEntry(source) {
  assert.match(source, /bindtap="goInbox"/, '右上角铃铛必须进协作邀请(收到的/我发出的)');
}

test('合作中心首屏只读两个发现来源,不再自己拉邀约', () => {
  const { page, requests } = loadPage();
  page.onLoad({});
  assert.deepEqual(requests.map((request) => request.url), [
    '/api/merchant/marketing-home',
    '/api/official/events',
  ]);
  assert.deepEqual(page.data.tabs.map((t) => t.label), ['官方活动', '广场']);
  assert.equal(page.data.activeTab, 'plaza');
});

test('铃铛进协作邀请页,看详情进主题承接页(申请承接在那里)', () => {
  const { page, navigations } = loadPage();
  page.goInbox();
  page.openTopic({ currentTarget: { dataset: { id: 71 } } });
  assert.deepEqual(navigations, [
    '/pages/coop/list/index',
    '/pages/topic/merchantinfo/merchantinfo?id=71&scope=MERCHANT',
  ]);
  const detail = fs.readFileSync(path.join(ROOT, 'pages/topic/merchantinfo/merchantinfo.js'), 'utf8');
  assert.match(detail, /\/api\/merchant\/chapter-application\/apply/, '去掉卡上申请前提:详情页仍能申请承接');
});

test('铃铛入口在视图里', () => {
  assertInboxEntry(fs.readFileSync(VIEW, 'utf8'));
});

test('负控：摘掉铃铛绑定会命中入口契约', () => {
  const source = fs.readFileSync(VIEW, 'utf8');
  const broken = source.replace('bindtap="goInbox"', '');
  assert.notEqual(broken, source);
  assert.throws(() => assertInboxEntry(broken), /铃铛/);
});
