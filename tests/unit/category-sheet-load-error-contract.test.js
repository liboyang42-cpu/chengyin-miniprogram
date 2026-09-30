'use strict';

// A-08(P2):分类弹层请求失败时显示空列表,和「这个类型下真没有分类」无法区分。
// 修法:失败落弹层内 cy-inline-error + 重试;服务端确认空数组仍走既有空态。
// 同时给该请求上 silentError(弹层自带恢复动作,不再叠通道 toast)。
//
// 负控:把失败分支的 loadError 改回空串,失败用例必须真红。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const COMPONENT_REL = 'components/cy/category-sheet/index.js';
const COMPONENT_PATH = path.join(ROOT, COMPONENT_REL);
const read = () => fs.readFileSync(COMPONENT_PATH, 'utf8');

function loadComponent(source) {
  const requests = [];
  let definition = null;
  global.getApp = () => ({
    globalData: {},
    getRequestErrorMessage: (res, fallback) => (res && (res.msg || res.errMsg)) || fallback,
    sendRequest(options) { requests.push(options); return { abort() {} }; },
  });
  global.Component = (config) => { definition = config; };
  global.wx = { showToast() {} };
  delete require.cache[require.resolve(COMPONENT_PATH)];
  if (source) {
    const Module = require('node:module');
    const m = new Module(COMPONENT_PATH, null);
    m.filename = COMPONENT_PATH;
    m.paths = Module._nodeModulePaths(path.dirname(COMPONENT_PATH));
    m._compile(source, COMPONENT_PATH);
  } else {
    require(COMPONENT_PATH);
  }
  assert.ok(definition, 'category-sheet 必须注册 Component');
  const vm = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    properties: { show: true, type: 2, num: 0, ids: '' },
  });
  vm.setData = function setData(patch, cb) {
    Object.assign(this.data, patch);
    if (cb) cb();
  };
  return { vm, requests };
}

test('失败:落弹层内 loadError + 重试,不与「真·无分类」混淆', () => {
  const { vm, requests } = loadComponent();
  vm.getCategoryList();
  requests[0].fail({ errMsg: 'request:fail timeout' });

  assert.equal(vm.data.loaded, false, '失败不能当加载完成');
  assert.notEqual(vm.data.loadError, '', '失败必须有可见原因,不能显示成空列表');
  assert.deepEqual(vm.data.categoryList, []);

  // 重试:同一个方法再拉一次即可(弹层内 action 绑定它)
  vm.getCategoryList();
  assert.equal(vm.data.loadError, '', '重试开始先收掉错误条');
  requests[1].success({ code: '200', data: [{ id: 3, categoryName: '夜跑' }] });
  assert.deepEqual(vm.data.categoryList.map((item) => item.id), [3]);
  assert.equal(vm.data.loaded, true);
  assert.equal(vm.data.loadError, '');
});

test('非 200 也算失败(服务端报错不能长成空列表)', () => {
  const { vm, requests } = loadComponent();
  vm.getCategoryList();
  requests[0].success({ code: '500', msg: '服务开小差' });

  assert.equal(vm.data.loaded, false);
  assert.match(vm.data.loadError, /服务开小差/);
});

test('服务端确认空数组:走既有空态,不挂错误条', () => {
  const { vm, requests } = loadComponent();
  vm.getCategoryList();
  requests[0].success({ code: '200', data: [] });

  assert.equal(vm.data.loaded, true);
  assert.equal(vm.data.loadError, '', '「没有分类」不是错误');
  assert.deepEqual(vm.data.categoryList, []);
});

test('渲染与接线:错误条用 cy-inline-error,action 指回 getCategoryList;请求压掉通道 toast', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'components/cy/category-sheet/index.wxml'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(ROOT, 'components/cy/category-sheet/index.json'), 'utf8'));
  const js = read();

  assert.match(wxml, /<cy-inline-error[^>]*wx:elif="\{\{loadError\}\}"[^>]*bind:action="getCategoryList"/);
  assert.equal(json.usingComponents['cy-inline-error'], '/components/cy/inline-error/index');
  assert.match(js, /silentError: true/);
});

test('负控:失败分支改回不记录原因,失败用例真红', () => {
  const source = read();
  const broken = source.replace(
    "        fail(res) {\n          that.setData({\n            categoryList: [],\n            loaded: false,\n            loadError: app.getRequestErrorMessage(res, '分类没能加载出来'),\n          });",
    "        fail(res) {\n          that.setData({ categoryList: [], loaded: false, loadError: '' });");
  assert.notEqual(broken, source, '负控锚点失效:fail 分支未命中');

  const { vm, requests } = loadComponent(broken);
  vm.getCategoryList();
  requests[0].fail({ errMsg: 'request:fail timeout' });
  assert.throws(() => {
    assert.notEqual(vm.data.loadError, '', '失败必须有可见原因,不能显示成空列表');
  }, assert.AssertionError, '负控:去掉失败原因后,主用例断言必须真红');
});
