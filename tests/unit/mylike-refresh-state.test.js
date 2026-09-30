const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../pages/mylike/mylike.js');
const VIEW_PATH = path.resolve(__dirname, '../../pages/mylike/mylike.wxml');
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
    // #810 起 onLoad 会同步一次视图主题;本用例只验刷新态,给个空读即可。
    getStorageSync() { return ''; },
    setNavigationBarColor() {},
  };
});

test('帖文收藏刷新 502 保留旧卡片与操作，并在 complete 后停止下拉动画', () => {
  const vm = loadPage();
  const previous = [{ id: 11, name: '原收藏', imgUrl: 'cover.jpg' }];
  vm.onLoad({});
  sandbox.requests[0].success({ code: '200', data: { rows: previous } });
  sandbox.requests[0].complete();

  vm.onPullDownRefresh();

  assert.deepEqual(vm.data.postList, previous);
  assert.equal(vm.data.loading, true);
  assert.equal(vm.data.refreshing, true);
  assert.equal(vm.data.errorMsg, '');
  assert.equal(sandbox.pullStops, 0);

  sandbox.requests[1].successStatusAbnormal({ statusCode: 502 });

  assert.deepEqual(vm.data.postList, previous);
  assert.equal(vm.data.refreshing, false);
  assert.equal(vm.data.errorMsg, '');
  assert.equal(sandbox.pullStops, 0);

  sandbox.requests[1].complete();

  assert.equal(vm.data.loading, false);
  assert.equal(sandbox.pullStops, 1);
  const view = fs.readFileSync(VIEW_PATH, 'utf8');
  assert.doesNotMatch(view, /<cy-inline-error[^>]*staleError/);
  assert.match(view, /bind:detail="goPost"/);
  assert.match(view, /bind:favorite="postUnlike"/);
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

test('并发取消收藏按 ID 删除，顺序或逆序回包均保留未取消项', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const vm = loadPage();
    sandbox.requests.length = 0;
    vm.data.postList = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    vm.postUnlike({ detail: { index: 0 } });
    vm.postUnlike({ detail: { index: 1 } });
    order.forEach(index => sandbox.requests[index].success({ code: '200' }));
    assert.deepEqual(vm.data.postList.map(item => item.id), ['C']);
  }
});
