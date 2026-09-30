const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// app.js 顶层直接调用全局 App({...}) 注册配置,不能用普通 require 拿到配置对象,
// 用 vm 跑真源码、拦下传给 App() 的那个对象,和 tests/unit/merchant-ledger.test.js
// 载入真页面 Page() 配置用的是同一手法。
function loadApp() {
  const root = path.join(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  let config = null;
  const sandbox = {
    App: (c) => { config = c; },
    getApp: () => ({}),
    wx: {},
    require: (request) => (request.startsWith('.') ? require(path.join(root, request)) : require(request)),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'app.js' });
  assert.ok(config, 'app.js App() 配置载入失败');
  return config;
}

test('getRequestErrorMessage 把未捕获的 Java 异常/堆栈 归一化为通用文案，不直出给用户', () => {
  const app = loadApp();
  const raw = 'class java.math.BigDecimal cannot be cast to class java.lang.Double (java.math.BigDecimal and java.lang.Double are in module java.base of loader \'bootstrap\')';
  assert.equal(app.getRequestErrorMessage({ msg: raw }, '加载失败'), '服务开小差了，请稍后重试');
  assert.equal(app.getRequestErrorMessage({ msg: 'java.lang.NullPointerException: xxx' }, '加载失败'), '服务开小差了，请稍后重试');
});

test('getRequestErrorMessage 已知友好文案与既有 SQL 归一化规则不受影响（无回归）', () => {
  const app = loadApp();
  assert.equal(app.getRequestErrorMessage({ msg: '库存不足' }, '加载失败'), '库存不足');
  assert.equal(app.getRequestErrorMessage({ msg: 'Error querying database' }, '加载失败'), '当前数据暂不可用，请稍后重试');
  assert.equal(app.getRequestErrorMessage({ msg: '认证失败' }, '加载失败'), '登录已过期，请重新进入');
  assert.equal(app.getRequestErrorMessage(null, '加载失败'), '加载失败');
});
