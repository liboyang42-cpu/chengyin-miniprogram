// CU-C-78:团码签发「有码图才算成功」契约的前端侧。
//
// 后端出图失败时已经回 500(见 GroupCodeIssueQrcodeContractTest),但契约还有另一半:
// 只要回执里没有可用 qrcodeUrl,消费方就不许进 ready —— 团码是一长串签名令牌,
// 现场只能靠扫图,原来 group-code 页在码区只落一句「出码失败」、页面却以为已出码。
// 对照已正确判空的 components/cy/scene-qr-group-code/index.js。
//
// 负控:删掉两处 `if (!data.qrcodeUrl)`,下面的断言立刻变红。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function makeApp(requests) {
  return {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(o) { requests.push(o); },
    tips() {}, getUserID: () => 1001, getUserRole: () => 'club', getUserType: () => 'club',
    getAvatar: () => '', getNickname: () => '测试',
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  };
}

function mountPage(rel, extraRequires) {
  const requests = [];
  const navigations = [];
  const app = makeApp(requests);
  const file = path.resolve(ROOT, rel);
  let definition;
  global.getApp = () => app;
  global.wx = {
    showToast() {}, navigateTo(o) { navigations.push(o.url); }, navigateBack() { navigations.push('__back__'); },
    redirectTo(o) { navigations.push(o.url); }, switchTab(o) { navigations.push(o.url); },
    stopPullDownRefresh() {}, getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getSystemInfoSync: () => ({}),
  };
  vm.runInNewContext(read(rel), {
    getApp: () => app,
    Page(p) { definition = p; },
    Component(p) { definition = p; },
    getCurrentPages: () => [{}, {}],
    setTimeout(fn) { if (fn) fn(); return 1; },
    setInterval() { return 1; },
    clearInterval() {}, clearTimeout() {}, console, Set, Date, JSON, Math, Object, String, Number, Array,
    require(id) {
      if (extraRequires && extraRequires[id]) return extraRequires[id];
      return require(path.resolve(path.dirname(file), id));
    },
    wx: global.wx,
  }, { filename: rel });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback.call(this); },
  });
  return { page, requests };
}

// club/detail 的依赖比团码页重,按 club-e-fixes-gate-contract.test.js 的既有做法逐个替换
function loadClubDetail() {
  return mountPage('pages/club/detail/index.js', {
    '../../../utils/motion.js': require('../../utils/motion.js'),
    '../../../utils/motion-preference.js': require('../../utils/motion-preference.js'),
    '../../../utils/scene-registry.js': { getScene: () => ({}) },
    '../../../utils/datetime': { toTimestamp: (v) => Date.parse(String(v).replace(' ', 'T')) || 0 },
    '../../../utils/mockData.js': { DEMO_NEARBY_CLUB_ID: -1 },
    '../utils/aiPlanToDraft.js': { aiPlanToDraft: () => ({}) },
    '../../../utils/group-code-session.js': { buildGroupCodeIssuePayload: () => ({ activityId: 30 }), listGroupCodeActivities: () => [] },
    '../../../utils/merchant-home-link.js': require('../../utils/merchant-home-link.js'),
    '../../../utils/ticket-source.js': require('../../utils/ticket-source.js'),
    '../../../utils/response-shape.js': require('../../utils/response-shape.js'),
    '../../../utils/coop-invite-view.js': require('../../utils/coop-invite-view.js'),
    '../utils/club-event-calendar.js': require('../../pages/club/utils/club-event-calendar.js'),
    '../../../utils/feed-play-card.js': require('../../utils/feed-play-card.js'),
  });
}

test('CU-C-78 group-code:回执成功但没有 qrcodeUrl 时落 error 态,不进 ready', () => {
  const { page, requests } = mountPage('pages/club/group-code/index.js');
  page.onLoad({ activityId: '30' });
  const issue = requests.find((r) => r.url === '/api/verify/groupcode/issue');
  assert.ok(issue, 'onLoad 后应发出签发请求');

  issue.success({ code: 200, data: { code: 'group_v1.SIGNED-TOKEN', qrcodeUrl: '', ttlMs: 300000 } });

  assert.equal(page.data.state, 'error', '没有码图就不是 ready');
  assert.equal(page.data.qrcodeUrl, '', '不留下不可用的码图');
  assert.match(page.data.errMsg, /二维码/, '错误文案要说明是二维码没生成出来');
  assert.equal(page._timer, undefined, '失败不许起倒计时');

  // 有码图时照旧进 ready —— 别把契约收得连正常路径都不通
  const ok = mountPage('pages/club/group-code/index.js');
  ok.page.onLoad({ activityId: '30' });
  ok.requests.find((r) => r.url === '/api/verify/groupcode/issue')
    .success({ code: 200, data: { code: 'group_v1.SIGNED-TOKEN', qrcodeUrl: 'https://oss.test/qr/a.png', ttlMs: 300000 } });
  assert.equal(ok.page.data.state, 'ready');
  assert.equal(ok.page.data.qrcodeUrl, 'https://oss.test/qr/a.png');
});

test('CU-C-78 group-code:后端真的回了失败回执时也是 error 态(端到端契约一致)', () => {
  const { page, requests } = mountPage('pages/club/group-code/index.js');
  page.onLoad({ activityId: '30' });
  requests.find((r) => r.url === '/api/verify/groupcode/issue')
    .success({ code: 500, msg: '团码二维码生成失败，请稍后重试' });
  assert.equal(page.data.state, 'error');
  assert.match(page.data.errMsg, /二维码/);
});

test('CU-C-78 club/detail:回执成功但没有 qrcodeUrl 时不进 ready,也不把签名令牌铺进码区', () => {
  const { page, requests } = loadClubDetail();
  page.setData({ groupCodeVisible: true, groupCodeActivityId: 30 });
  page.issueGroupCode();
  const issue = requests.find((r) => r.url === '/api/verify/groupcode/issue');
  assert.ok(issue, 'issueGroupCode 应发出签发请求');

  issue.success({ code: 200, data: { code: 'group_v1.SIGNED-TOKEN', qrcodeUrl: '', ttlMs: 300000 } });

  assert.equal(page.data.groupCodeState, 'error', '没有码图就不是 ready');
  assert.equal(page.data.groupCodeQrUrl, '', '不留下不可用的码图');
  assert.equal(page.data.groupCodeCode, '', '更不能把只能扫的签名令牌留在码区当文字');
  assert.match(page.data.groupCodeErrMsg, /二维码/);

  const ok = loadClubDetail();
  ok.page.setData({ groupCodeVisible: true, groupCodeActivityId: 30 });
  ok.page.issueGroupCode();
  ok.requests.find((r) => r.url === '/api/verify/groupcode/issue')
    .success({ code: 200, data: { code: 'group_v1.SIGNED-TOKEN', qrcodeUrl: 'https://oss.test/qr/a.png', ttlMs: 300000 } });
  assert.equal(ok.page.data.groupCodeState, 'ready');
  assert.equal(ok.page.data.groupCodeQrUrl, 'https://oss.test/qr/a.png');
});
