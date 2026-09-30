const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const PAGE_PATH = '../../pages/activity/baoming/baoming.js';
let config;
let requests;
let storage;
let userId;

beforeEach(() => {
  config = null;
  requests = [];
  storage = {};
  userId = 9;
  global.getApp = () => ({
    globalData: { user_id: userId, features: {} },
    getUserID: () => userId,
    sendRequest: options => { requests.push(options); },
    tips() {},
    recordConsent: () => Promise.resolve(),
    isDevEnv: () => false,
  });
  global.Page = value => { config = value; };
  global.wx = {
    getStorageSync: key => storage[key] || '',
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: key => { delete storage[key]; },
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showToast() {}, showModal() {}, showLoading() {}, hideLoading() {},
  };
});

function page() {
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  const vm = Object.assign({}, config);
  vm.data = JSON.parse(JSON.stringify(config.data));
  vm.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  return vm;
}

test('只按账号缓存参与人 ID，并从服务端当前列表求交，不缓存 PII 对象', () => {
  storage.selectedAddress = { id: 99, fullName: '旧姓名', mobilePhone: '13800138000' };
  storage.selectedAddressId_v1_9 = 2;
  const vm = page();
  vm.getAddressList();
  requests[0].success({ code: 200, data: { rows: [
    { id: 1, fullName: 'A', isDefault: 1 },
    { id: 2, fullName: 'B' },
  ] } });
  assert.equal(vm.data.selectedAddress.id, 2);
  assert.equal(storage.selectedAddress, undefined);
  assert.equal(storage.selectedAddressId_v1_9, 2);
  assert.equal(typeof storage.selectedAddressId_v1_9, 'number');
});

test('缓存 ID 已被服务端删除时清除陈旧选择并回退当前默认；换账号不串用', () => {
  storage.selectedAddressId_v1_9 = 99;
  storage.selectedAddressId_v1_10 = 7;
  const vm = page();
  vm.getAddressList();
  requests[0].success({ code: 200, data: { rows: [{ id: 1, fullName: '当前默认', isDefault: 1 }] } });
  assert.equal(vm.data.selectedAddress.id, 1);
  assert.equal(storage.selectedAddressId_v1_9, 1);

  userId = 10;
  requests = [];
  vm.getAddressList();
  requests[0].success({ code: 200, data: { rows: [{ id: 7, fullName: '另一账号' }] } });
  assert.equal(vm.data.selectedAddress.id, 7);
});
