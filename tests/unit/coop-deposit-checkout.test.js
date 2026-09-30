'use strict';

const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../pages/coop/list/index.js');
let pageConfig;
let requests;
let payments;
let toasts;

beforeEach(() => {
  pageConfig = null;
  requests = [];
  payments = [];
  toasts = [];
  global.getApp = () => ({
    globalData: {},
    sendRequest(options) { requests.push(options); return { abort() {} }; },
    getUserRole() { return 'merchant'; },
    getUserType() { return 2; }
  });
  global.Page = config => { pageConfig = config; };
  global.wx = {
    requestPayment(options) { payments.push(options); },
    showLoading() {},
    hideLoading() {},
    showToast(options) { toasts.push(options); },
    showModal() {},
    hideTabBar() {},
    getStorageSync() { return ''; },
    setNavigationBarColor() {},
    setBackgroundColor() {}
  };
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
});

function page() {
  const vm = Object.assign({}, pageConfig);
  vm.data = JSON.parse(JSON.stringify(pageConfig.data));
  vm.setData = function (patch, cb) { Object.assign(vm.data, patch); if (cb) cb(); };
  return vm;
}

for (const inviteId of [7, '9007199254740993']) test('保证金支付保留精确邀约ID并回读终态: ' + inviteId, () => {
  const vm = page();
  vm._initWorkflow();
  vm.payDeposit({ currentTarget: { dataset: { id: inviteId } } });

  assert.equal(requests[0].url, '/api/coop/deposit/create');
  assert.deepEqual(JSON.parse(requests[0].data), { inviteId: inviteId });
  requests[0].success({ code: '200', data: {
    timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's'
  } });
  assert.equal(payments.length, 1);
  payments[0].success();

  assert.equal(requests[1].url, '/api/coop/deposit/status');
  assert.deepEqual(JSON.parse(requests[1].data), { inviteId: inviteId });
  assert.equal(toasts.length, 0, 'SDK success 不能直接显示已缴纳');

  requests[1].success({ code: '200', data: { inviteId: inviteId, paymentStatus: 'success' } });
  assert.equal(toasts[0].title, '保证金已缴纳');
});


test('缺少可靠支付事实的 unknown 保留待确认且不自动重新缴款', () => {
  const originalNow = Date.now;
  let clock = 100;
  Date.now = () => clock;
  try {
    const vm = page();
    vm._initWorkflow();
    vm.payDeposit({ currentTarget: { dataset: { id: 7 } } });
    requests[0].success({ code: 200, data: {
      timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's'
    } });
    payments[0].success();
    clock = 21000;
    requests[1].success({ code: 200, data: { paymentStatus: 'unknown' } });
    assert.match(vm.data.actionError, /待确认.*暂不要重复缴纳/);
    assert.doesNotMatch(vm.data.actionError, /支付失败|已缴纳/);
    assert.equal(payments.length, 1);
    assert.equal(requests.filter(r => r.url === '/api/coop/deposit/create').length, 1);
    assert.equal(vm.data.actionReceipt, '');
  } finally { Date.now = originalNow; }
});
