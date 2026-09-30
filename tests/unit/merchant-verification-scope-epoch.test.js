const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const PAGE_PATH = '../../pages/merchant/index/index.js';

let app;
let pageConfig;
let requests;
let userId;
let loadingVisible;
let abortCount;

beforeEach(() => {
  requests = [];
  userId = 11;
  loadingVisible = false;
  abortCount = 0;
  pageConfig = null;
  app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => userId,
    setUserRole() {},
    setUserType() {},
    getRequestErrorMessage: (response, fallback) => (response && response.msg) || fallback,
    sendRequest(request) {
      requests.push(request);
      return { abort() { abortCount += 1; } };
    },
  };
  global.getApp = () => app;
  global.getCurrentPages = () => [];
  global.wx = {
    scanCode({ success }) {
      success({ result: JSON.stringify({ type: 'topic', code: 'OLD-TICKET' }) });
    },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    setNavigationBarColor() {},
    setBackgroundColor() {},
    showLoading() { loadingVisible = true; },
    hideLoading() { loadingVisible = false; },
    showToast() {},
    switchTab() {},
    navigateTo() {},
    reLaunch() {},
  };
  global.Page = (config) => { pageConfig = config; };
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  };
  page._dataEpoch = 1;
  page._merchantScopeKey = '11:101';
  page.data.chapterSheet = { show: true, code: 'OLD-TICKET', items: [{ id: 7, name: '旧商家章节' }] };
  page.data.stationSheet = {
    show: true,
    code: 'OLD-TICKET',
    items: [{ registrationMerchantId: 9, name: '旧商家据点' }],
  };
  page.data.verificationResult = { show: true, state: 'success', title: '旧回执', message: '旧商家核销成功' };
  return page;
}

function startVerificationThenSwitchMerchant(page) {
  page.goScanQR();
  const verificationRequest = requests.find((request) => request.url === '/api/registration/scan_qr_code');
  assert.ok(verificationRequest, '扫码后必须发起核销请求');

  userId = 22;
  page.onShow();
  const identityRequest = requests.find((request) => request.url === '/api/merchant/access/me');
  assert.ok(identityRequest, '切换账号后必须重新确认商家身份');
  identityRequest.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 202, name: '新店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:profile:write', 'merchant:project:manage'],
    },
  });
  assert.equal(page._merchantScopeKey, '22:202');
  assert.equal(page.data.sceneCurrent, null, '切换主体时先清空旧场景');
  assert.equal(loadingVisible, false, '旧核销作废时必须收起全局 loading');
  return verificationRequest;
}

test('切换商家后，旧核销响应不得打开上一商家的选章或结果场景', () => {
  const lateResponses = [
    {
      code: 500,
      msg: '请选择要核销的章节',
      data: { needChapterChoice: true, chapters: [{ id: 7, name: '旧商家章节' }] },
    },
    { code: 200, msg: '旧商家核销成功', data: {} },
  ];

  for (const response of lateResponses) {
    requests = [];
    userId = 11;
    const page = makePage();
    const verificationRequest = startVerificationThenSwitchMerchant(page);

    verificationRequest.success(response);

    assert.equal(page.data.sceneCurrent, null, '迟到回调不能在新账号上打开场景');
    assert.deepEqual(page.data.chapterSheet.items, [], '不得泄漏上一商家的候选章节');
    assert.deepEqual(page.data.stationSheet.items, [], '不得泄漏上一商家的候选据点');
    assert.equal(page.data.verificationResult.show, false, '不得显示上一商家的核销回执');
  }
});

test('同一商家开始新一轮页面数据后，上一轮核销回调也必须失效', () => {
  const page = makePage();
  page.data.chapterSheet = { show: false, code: '', items: [] };
  page.data.stationSheet = { show: false, code: '', items: [] };
  page.data.verificationResult = { show: false, state: '', title: '', message: '' };

  page.goScanQR();
  const verificationRequest = requests.find((request) => request.url === '/api/registration/scan_qr_code');
  assert.ok(verificationRequest);

  page.onShow();
  const identityRequest = requests.find((request) => request.url === '/api/merchant/access/me');
  identityRequest.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 101, name: '原店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:profile:write', 'merchant:project:manage'],
    },
  });
  assert.equal(page._merchantScopeKey, '11:101');

  verificationRequest.success({ code: 200, msg: '上一轮核销成功', data: {} });

  assert.equal(page.data.sceneCurrent, null, '旧 epoch 的回调不能覆盖新一轮页面状态');
  assert.equal(page.data.verificationResult.show, false);
});

test('仅刷新经营读数据不得静默丢弃在途核销回执', () => {
  const page = makePage();
  page.data.verificationResult = { show: false, state: '', title: '', message: '' };

  page.goScanQR();
  const verificationRequest = requests.find((request) => request.url === '/api/registration/scan_qr_code');
  page._reloadAll();
  verificationRequest.success({ code: 200, msg: '刷新期间核销成功', data: {} });

  assert.equal(page.data.sceneCurrent.id, 'merchant-verification-result');
  assert.equal(page.data.verificationResult.state, 'success');
});

test('当前商家当前数据轮次的核销回执仍可正常打开', () => {
  const page = makePage();
  page.data.verificationResult = { show: false, state: '', title: '', message: '' };

  page.goScanQR();
  const verificationRequest = requests.find((request) => request.url === '/api/registration/scan_qr_code');
  verificationRequest.success({ code: 200, msg: '核销成功', data: {} });

  assert.equal(page.data.sceneCurrent.id, 'merchant-verification-result');
  assert.equal(page.data.verificationResult.state, 'success');
});

test('核销请求在途时离页必须中止请求并收掉全局 loading', () => {
  const page = makePage();
  page.goScanQR();
  assert.equal(loadingVisible, true);

  page.onUnload();

  assert.equal(abortCount, 1, '离页必须中止在途核销请求');
  assert.equal(loadingVisible, false, 'destroy 后回调不会再执行，页面必须主动 hideLoading');
});

// #20 / F-RM-1:据点码在这颗扫码口必须被挡下,但挡下以后要给出能点过去的指路。
test('据点码在首页扫码口:不发任何核销请求，但弹窗指路且真的跳得过去', () => {
  const page = makePage();
  const modals = [];
  const jumps = [];
  global.wx.scanCode = ({ success }) => success({ result: 'v1.900.citynode_55.1999999999999.7.signature' });
  global.wx.showModal = (opts) => { modals.push(opts); };
  global.wx.navigateTo = (opts) => { jumps.push(opts.url); };

  page.goScanQR();

  assert.equal(requests.length, 0, '据点码不得被送进首页这张共享核销路由表');
  assert.equal(modals.length, 1, '护栏不能是哑巴 —— 要弹窗指路,不是 2 秒就消失的 toast');
  assert.match(modals[0].content, /城市据点/);
  assert.equal(modals[0].confirmText, '去据点页');

  modals[0].success({ confirm: true, cancel: false });
  assert.deepEqual(jumps, ['/pages/merchant/citynode/index']);
});
