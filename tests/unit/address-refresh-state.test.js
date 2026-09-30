const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../pages/address/address.js');
const VIEW_PATH = path.resolve(__dirname, '../../pages/address/address.wxml');
let sandbox;

beforeEach(() => {
  sandbox = { config: null, requests: [], pullStops: 0 };
  global.getApp = () => ({
    globalData: {},
    getRequestErrorMessage: (_res, fallback) => fallback,
    sendRequest(options) {
      sandbox.requests.push(options);
      return { abort() {} };
    },
  });
  global.Page = config => { sandbox.config = config; };
  global.wx = {
    stopPullDownRefresh() { sandbox.pullStops += 1; },
  };
});

test('参与人列表首载期间呈现列表骨架', () => {
  const vm = loadPage();

  vm.onLoad({});

  assert.equal(vm.data.loadState, 'loading');
  assert.equal(sandbox.requests.length, 1);
  const view = fs.readFileSync(VIEW_PATH, 'utf8');
  assert.match(view, /<cy-skeleton[^>]+wx:if="\{\{loadState === 'loading'\}\}"[^>]*type="list"/);
});

test('参与人列表刷新 502 保留旧数据并在请求 complete 后收起系统下拉动画', () => {
  const vm = loadPage();
  const previous = [{ id: 7, fullName: '原参与人', mobilePhone: '13800138000' }];
  vm.onLoad({});
  sandbox.requests[0].success({ code: '200', data: { rows: previous } });
  sandbox.requests[0].complete();

  vm.onPullDownRefresh();

  assert.deepEqual(vm.data.list, previous);
  assert.equal(vm.data.loadState, 'ready');
  assert.equal(vm.data.refreshing, true);
  assert.equal(sandbox.pullStops, 0);

  sandbox.requests[1].successStatusAbnormal({ statusCode: 502 });

  assert.deepEqual(vm.data.list, previous);
  assert.equal(vm.data.loadState, 'ready');
  assert.equal(vm.data.refreshing, false);
  assert.equal(sandbox.pullStops, 0);

  sandbox.requests[1].complete();

  assert.equal(sandbox.pullStops, 1);
  const view = fs.readFileSync(VIEW_PATH, 'utf8');
  assert.doesNotMatch(view, /<cy-inline-error[^>]*staleError/);
});

test('从编辑页返回时以 refreshing 保留参与人快照，不退回首载骨架', () => {
  const vm = loadPage();
  const previous = [{ id: 8, fullName: '已编辑参与人', mobilePhone: '13900139000' }];
  vm.onLoad({});
  vm.onShow();
  sandbox.requests[0].success({ code: '200', data: { rows: previous } });
  sandbox.requests[0].complete();

  vm.onShow();

  assert.equal(sandbox.requests.length, 2);
  assert.deepEqual(vm.data.list, previous);
  assert.equal(vm.data.loadState, 'ready');
  assert.equal(vm.data.refreshing, true);
  assert.equal(sandbox.pullStops, 0);
});

function loadPage() {
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  const vm = Object.assign({}, sandbox.config);
  vm.data = JSON.parse(JSON.stringify(sandbox.config.data));
  vm.setData = function (patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  };
  return vm;
}
