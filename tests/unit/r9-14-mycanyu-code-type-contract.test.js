// R9-14(P1):我的参与页打不开 —— /api/registration/my-joined 返回数字 200,页面只认字符串 '200'。
//
// 审查复现(第九轮 R9-14):我的参与页报「参与记录没能打开 / 操作成功」,真实接口
// 返回 code=200(数字)及非空记录。页面 subpackageMember/mycanyu/mycanyu.js 的成功判定
// 写成 `res.code === '200'`,数字 200 落入失败分支。
//
// 契约(只钉结果类型判断这一处数据契约):字符串与数字两种 200 都必须渲染列表;
// 非 200 与服务端异常仍必须保留原来的错误呈现(该呈现方式归 T4,本测试不锁样式)。
const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../subpackageMember/mycanyu/mycanyu.js');
let sandbox;

beforeEach(() => {
  sandbox = { config: null, requests: [] };
  global.getApp = () => ({
    globalData: {},
    getRequestErrorMessage: (_res, fallback) => fallback,
    sendRequest(options) {
      sandbox.requests.push(options);
      return { abort() {} };
    },
  });
  global.Page = config => { sandbox.config = config; };
  global.wx = { stopPullDownRefresh() {} };
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

const RECORD = {
  id: 88,
  ownerType: 1,
  purchaseKind: 3,
  registrationStatus: 2,
  cmsTopic: { name: '真实主题', startDate: '2099-01-01', endDate: '2099-01-02' },
};

test('RED 锚点:接口返回数字 200 时我的参与必须渲染记录,而不是进错误态', () => {
  const vm = loadPage();
  vm.onLoad();
  sandbox.requests[0].success({ code: 200, data: [RECORD] });

  assert.equal(vm.data.firstLoading, false);
  assert.equal(vm.data.errorMsg, '');
  assert.equal(vm.data.list.length, 1);
  assert.equal(vm.data.list[0].sourceName, '真实主题');
});

test('字符串 200 的既有契约不回归', () => {
  const vm = loadPage();
  vm.onLoad();
  sandbox.requests[0].success({ code: '200', data: [RECORD] });
  assert.equal(vm.data.list.length, 1);
  assert.equal(vm.data.errorMsg, '');
});

test('非 200 与非数组载荷仍进错误态,不能被宽松判定放行', () => {
  const vm = loadPage();
  vm.onLoad();
  sandbox.requests[0].success({ code: 500, data: [RECORD] });
  assert.equal(vm.data.list.length, 0);
  assert.equal(vm.data.firstLoading, false);

  const bad = loadPage();
  bad.onLoad();
  sandbox.requests[1].success({ code: 200, data: { rows: [RECORD] } });
  assert.equal(bad.data.list.length, 0);
  assert.equal(bad.data.firstLoading, false);
});
