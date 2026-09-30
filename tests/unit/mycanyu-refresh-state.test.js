const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../subpackageMember/mycanyu/mycanyu.js');
const VIEW_PATH = path.resolve(__dirname, '../../subpackageMember/mycanyu/mycanyu.wxml');
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

test('我的参与刷新失败不回到首屏骨架，并保留筛选与旧列表直到 complete', () => {
  const vm = loadPage();
  vm.onLoad();
  sandbox.requests[0].success({
    code: '200',
    data: [{
      id: 21,
      ownerType: 1,
      purchaseKind: 3,
      registrationStatus: 2,
      cmsTopic: { name: '原参与主题', startDate: '2099-01-01', endDate: '2099-01-02' },
    }],
  });
  sandbox.requests[0].complete();
  vm.switchTab({ detail: { key: 'not_started' }, currentTarget: { dataset: {} } });
  const previous = vm.data.list;

  vm.onPullDownRefresh();

  assert.equal(vm.data.firstLoading, false);
  assert.equal(vm.data.refreshing, true);
  assert.equal(vm.data.activeTab, 'not_started');
  assert.deepEqual(vm.data.list, previous);
  assert.equal(sandbox.pullStops, 0);

  sandbox.requests[1].successStatusAbnormal({ statusCode: 502 });

  assert.equal(vm.data.firstLoading, false);
  assert.equal(vm.data.refreshing, false);
  assert.equal(vm.data.activeTab, 'not_started');
  assert.deepEqual(vm.data.list, previous);
  assert.equal(vm.data.errorMsg, '');
  assert.equal(sandbox.pullStops, 0);

  sandbox.requests[1].complete();

  assert.equal(sandbox.pullStops, 1);
  const view = fs.readFileSync(VIEW_PATH, 'utf8');
  assert.doesNotMatch(view, /<cy-inline-error[^>]*staleError/);
  assert.match(view, /<cy-tabs[^>]+active="\{\{activeTab\}\}"/);
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
