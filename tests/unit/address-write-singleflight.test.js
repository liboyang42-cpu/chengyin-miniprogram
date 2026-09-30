const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const LIST_PATH = path.resolve(__dirname, '../../pages/address/address.js');
const FORM_PATH = path.resolve(__dirname, '../../pages/addressinfo/addressinfo.js');
let sandbox;

beforeEach(() => {
  sandbox = { requests: [], aborts: 0, config: null, toasts: [] };
  global.getApp = () => ({
    globalData: {},
    getRequestErrorMessage: (_res, fallback) => fallback,
    sendRequest(options) {
      sandbox.requests.push(options);
      return { abort() { sandbox.aborts += 1; } };
    },
  });
  global.Page = config => { sandbox.config = config; };
  global.wx = {
    showLoading() {}, hideLoading() {}, showToast(options) { sandbox.toasts.push(options && options.title); },
    showModal(options) { if (options.success) options.success({ confirm: true }); },
    navigateBack() {}, navigateTo() {}, redirectTo() {}, switchTab() {}, stopPullDownRefresh() {},
  };
});

test('编辑参与人的 200 空载荷不得解引用崩溃', () => {
  const vm = load(FORM_PATH);
  vm.getAddressInfo('7');

  assert.doesNotThrow(() => sandbox.requests[0].success({ code: 200, data: null }));
  assert.equal(vm.data.bootstrapError, '参与人信息暂时不可用');
  assert.equal(vm.data.bootstrapErrorKind, 'data');
});

test('编辑参与人的字符串字段类型异常时不得在提交态计算中崩溃', () => {
  const vm = load(FORM_PATH);
  vm.getAddressInfo('7');

  assert.doesNotThrow(() => sandbox.requests[0].success({
    code: 200,
    data: { fullName: {}, mobilePhone: {}, province: '', detailAddress: '' },
  }));
  assert.equal(vm.data.bootstrapError, '参与人信息暂时不可用');
  assert.equal(vm.data.bootstrapErrorKind, 'data');
  assert.equal(vm.data.canSubmit, false);
});

function load(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  const vm = Object.assign({}, sandbox.config);
  vm.data = JSON.parse(JSON.stringify(sandbox.config.data));
  vm.setData = function (patch, cb) {
    Object.keys(patch).forEach(key => {
      if (key.indexOf('.') < 0) this.data[key] = patch[key];
      else {
        const parts = key.split('.');
        let target = this.data;
        parts.slice(0, -1).forEach(part => { target = target[part]; });
        target[parts[parts.length - 1]] = patch[key];
      }
    });
    if (cb) cb();
  };
  return vm;
}

test('新增参与人双击只发一次，携带稳定 requestId，complete 后可重试', () => {
  const vm = load(FORM_PATH);
  vm.data.form = { id: '', fullName: '测试', mobilePhone: '13800138000', isDefault: 0 };
  vm.data.canSubmit = true;
  vm.saveAddress();
  vm.saveAddress();
  assert.equal(sandbox.requests.length, 1);
  assert.match(sandbox.requests[0].data.requestId, /^[A-Za-z0-9_-]{16,64}$/);
  assert.equal(vm.data.saving, true);
  sandbox.requests[0].complete();
  vm.saveAddress();
  assert.equal(sandbox.requests.length, 2);
  assert.equal(sandbox.requests[1].data.requestId, sandbox.requests[0].data.requestId);
});

test('新增成功到返回列表之间保持锁定，不生成新 requestId 重复新增', () => {
  const vm = load(FORM_PATH);
  vm.data.form = { id: '', fullName: '测试', mobilePhone: '13800138000', isDefault: 0 };
  vm.data.canSubmit = true;
  vm.saveAddress();
  sandbox.requests[0].success({ code: 200, data: { id: 77 } });
  sandbox.requests[0].complete();

  vm.saveAddress();

  assert.equal(sandbox.requests.length, 1, '成功后延迟返回期间必须拒绝再次提交');
  assert.equal(vm._saveSucceeded, true);
  assert.equal(vm.data.saveSucceeded, true);
  assert.equal(vm.data.saving, false);
  assert.equal(vm.data.canSubmit, false);
});

test('深链单页栈保存成功后 navigateBack 失败会回落参与人列表', () => {
  const vm = load(FORM_PATH);
  vm.data.form = { id: '', fullName: '测试', mobilePhone: '13800138000', isDefault: 0 };
  vm.data.canSubmit = true;
  let leave;
  let redirected = '';
  const nativeSetTimeout = global.setTimeout;
  global.setTimeout = fn => { leave = fn; return 1; };
  global.wx.navigateBack = options => options.fail({ errMsg: 'navigateBack:fail cannot navigate back' });
  global.wx.redirectTo = options => { redirected = options.url; };

  try {
    vm.saveAddress();
    sandbox.requests[0].success({ code: 200, data: { id: 77 } });
    sandbox.requests[0].complete();
    leave();
  } finally {
    global.setTimeout = nativeSetTimeout;
  }

  assert.equal(redirected, '/pages/address/address');
});

test('同一参与人删除和设默认各自 single-flight，卸载 abort 全部在途请求', () => {
  const vm = load(LIST_PATH);
  vm._deleteAddress(7);
  vm._deleteAddress(7);
  vm.setDefault({ currentTarget: { dataset: { id: 8 } } });
  vm.setDefault({ currentTarget: { dataset: { id: 8 } } });
  assert.equal(sandbox.requests.length, 2);
  assert.equal(sandbox.requests[0].url, '/api/user/address/delete');
  assert.equal(sandbox.requests[1].url, '/api/user/address/setDefault');
  vm.onUnload();
  assert.equal(sandbox.aborts, 2);
});

test('列表首次 onLoad + onShow 只请求一次，旧响应被 epoch 屏蔽', () => {
  const vm = load(LIST_PATH);
  vm.onLoad({});
  vm.onShow();
  assert.equal(sandbox.requests.length, 1);
  vm.getList();
  assert.equal(sandbox.aborts, 1);
  sandbox.requests[0].success({ code: 200, data: { rows: [{ id: 'old' }] } });
  assert.deepEqual(vm.data.list, []);
});
