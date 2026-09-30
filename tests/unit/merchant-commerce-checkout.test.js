const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../pages/merchant/decor/index.js');
let sandbox;

beforeEach(() => {
  sandbox = { requests: [], payments: [], toasts: [], modals: [], aborts: 0 };
  global.getApp = () => ({
    globalData: { navBarHeight: 44 },
    sendRequest(options) {
      sandbox.requests.push(options);
      return { abort() { sandbox.aborts++; } };
    },
  });
  global.Page = (config) => { sandbox.config = config; };
  global.wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    requestPayment: (options) => sandbox.payments.push(options),
    showToast: (options) => sandbox.toasts.push(options.title),
    showModal: (options) => sandbox.modals.push(options),
    hideLoading() {},
    navigateTo() {},
  };
});

function page() {
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  const vm = Object.assign({}, sandbox.config);
  vm.data = Object.assign({}, sandbox.config.data, { chargeEnabled: true });
  vm.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  return vm;
}

function validOrder() {
  return {
    orderSn: 'TPLTM_1', paymentStatus: 'pending',
    timeStamp: '1', nonceStr: 'n', package: 'prepay_id=1', signType: 'RSA', paySign: 's',
  };
}

test('升级权益双击只创建一个带 requestId 的订单', () => {
  const vm = page();
  const event = { currentTarget: { dataset: { key: 'premium_template' } } };
  vm.tapTier(event);
  vm.tapTier(event);

  assert.equal(sandbox.requests.length, 1);
  assert.equal(sandbox.requests[0].url, '/api/merchant/commerce/order');
  const body = JSON.parse(sandbox.requests[0].data);
  assert.equal(body.bizType, 'premium_template');
  assert.match(body.requestId, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(vm.data.checkoutBusy, true);
});

test('微信支付 success 后必须查询服务端订单终态才显示到账', () => {
  const vm = page();
  vm.tapTier({ currentTarget: { dataset: { key: 'premium_template' } } });
  sandbox.requests[0].success({ code: 200, data: validOrder() });
  assert.equal(sandbox.payments.length, 1);

  sandbox.payments[0].success();
  assert.equal(sandbox.requests.length, 2);
  assert.equal(sandbox.requests[1].url, '/api/merchant/commerce/order/status');
  assert.equal(sandbox.toasts.includes('支付成功，权益已到账'), false);

  sandbox.requests[1].success({ code: 200, data: { paymentStatus: 'success' } });
  assert.ok(sandbox.toasts.includes('支付成功，权益已到账'));
  assert.equal(vm.data.checkoutBusy, false);
});

test('支付参数不完整时不得调用 requestPayment', () => {
  const vm = page();
  vm.tapTier({ currentTarget: { dataset: { key: 'premium_template' } } });
  const malformed = validOrder();
  delete malformed.paySign;
  sandbox.requests[0].success({ code: 200, data: malformed });

  assert.equal(sandbox.payments.length, 0);
  assert.equal(vm.data.checkoutBusy, false);
  assert.ok(sandbox.toasts.some((text) => /支付参数/.test(text)));
});

test('页面卸载必须 destroy workflow 并 abort 在途建单/终态请求', () => {
  const vm = page();
  vm.tapTier({ currentTarget: { dataset: { key: 'premium_template' } } });
  vm.onUnload();

  assert.equal(sandbox.aborts, 1);
  sandbox.requests[0].success({ code: 200, data: validOrder() });
  assert.equal(sandbox.payments.length, 0, '卸载后的迟到回调不能再拉起支付');
});

test('服务端确认旧订单已关闭后，重试必须生成新的 requestId', () => {
  const vm = page();
  const event = { currentTarget: { dataset: { key: 'premium_template' } } };
  vm.tapTier(event);
  const firstId = JSON.parse(sandbox.requests[0].data).requestId;
  sandbox.requests[0].success({
    code: 200,
    data: { orderSn: 'TPLTM_CLOSED', paymentStatus: 'failed' },
  });

  vm.tapTier(event);
  const secondId = JSON.parse(sandbox.requests[1].data).requestId;
  assert.notEqual(secondId, firstId);
  assert.ok(sandbox.toasts.includes('订单已关闭，请重新选择权益'));
});

test('用户取消支付后，同一权益重试必须复用 requestId 防止重复建单', () => {
  const vm = page();
  const event = { currentTarget: { dataset: { key: 'premium_template' } } };
  vm.tapTier(event);
  const firstId = JSON.parse(sandbox.requests[0].data).requestId;
  sandbox.requests[0].success({ code: 200, data: validOrder() });
  sandbox.payments[0].fail({ errMsg: 'requestPayment:fail cancel' });

  vm.tapTier(event);
  const secondId = JSON.parse(sandbox.requests[1].data).requestId;
  assert.equal(secondId, firstId);
});
