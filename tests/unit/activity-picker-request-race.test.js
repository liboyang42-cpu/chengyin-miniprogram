const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const COMPONENT_PATH = path.resolve(__dirname, '../../pages/square/components/activity-picker/index.js');
let sandbox;

beforeEach(() => {
  sandbox = { requests: [], uploads: [] };
  global.getApp = () => ({
    sendRequest(options) {
      sandbox.requests.push(options);
      return { abort() {} };
    },
    getUploadClient() {
      return {
        uploadAll(paths) {
          sandbox.uploads.push(paths);
          return { destroy() {} };
        },
      };
    },
  });
  global.Component = definition => { sandbox.definition = definition; };
});

function component() {
  delete require.cache[require.resolve(COMPONENT_PATH)];
  require(COMPONENT_PATH);
  const vm = Object.assign({}, sandbox.definition.methods);
  vm.data = JSON.parse(JSON.stringify(sandbox.definition.data));
  vm.setData = function (patch) { Object.assign(this.data, patch); };
  vm.triggerEvent = function () {};
  return vm;
}

test('活动选择器加载中重复打开只允许一个列表请求', () => {
  const vm = component();

  vm.fetchList();
  vm.fetchList();

  assert.equal(sandbox.requests.length, 1);
});

test('活动列表失败后保留错误态并允许重试', () => {
  const vm = component();

  vm.fetchList();
  sandbox.requests[0].fail();
  sandbox.requests[0].complete();

  assert.equal(vm.data.loaded, false);
  assert.equal(vm.data.loading, false);
  assert.equal(vm.data.errorMsg, '活动列表加载失败，请重试');

  vm.fetchList();
  assert.equal(sandbox.requests.length, 2);
});

test('活动列表包含空元素时进入错误态，不渲染空白活动', () => {
  const vm = component();

  vm.fetchList();
  assert.doesNotThrow(() => sandbox.requests[0].success({ code: '200', data: [null] }));

  assert.equal(vm.data.loaded, false);
  assert.equal(vm.data.errorMsg, '活动列表加载失败，请重试');
});

test('关闭选择器后迟到的路线截图不得启动上传', async () => {
  const vm = component();
  let resolveSnapshot;
  vm._pending = { id: 1, topicId: 9 };
  vm.selectComponent = () => ({
    snapshotRoute: () => new Promise(resolve => { resolveSnapshot = resolve; }),
  });

  vm.onRouteReady();
  vm.onClose();
  resolveSnapshot('/tmp/late.png');
  await Promise.resolve();

  assert.equal(sandbox.uploads.length, 0);
});

test('同一选择周期重复 route-ready 只允许一次截图和上传', async () => {
  const vm = component();
  let resolveSnapshot;
  let snapshots = 0;
  vm._generation = 1;
  vm._pending = { id: 1, topicId: 9 };
  vm.selectComponent = () => ({
    snapshotRoute: () => {
      snapshots += 1;
      return new Promise(resolve => { resolveSnapshot = resolve; });
    },
  });

  vm.onRouteReady();
  vm.onRouteReady();
  assert.equal(snapshots, 1);
  resolveSnapshot('/tmp/route.png');
  await Promise.resolve();

  assert.equal(sandbox.uploads.length, 1);
});
