'use strict';
// tests/helpers/ui-sandbox-vm.js —— node:vm 的同款出口,只多做一件事:
// 页面在沙箱里 require('<rel>/utils/toast.js' | '<rel>/utils/loading.js') 时,把真模块装进去。
//
// 这两个模块运行时读全局 wx / getCurrentPages。页面跑在 vm 上下文里、wx 是该上下文的 mock,
// 若用 Node 自己的 require 装模块,它读到的是 Node 全局(没有 wx → ReferenceError),
// 所以模块源码必须在页面所在的同一个上下文里求值,回落到 wx.showToast / wx.showLoading
// 时才打得到测试的桩。沙箱没有 require 的,补一个只认这两个模块的(其它一律 unexpected require)。
//
// 用法:把 `const vm = require('node:vm')` 换成 `const vm = require('../helpers/ui-sandbox-vm.js')`。
const fs = require('node:fs');
const path = require('node:path');
const nodeVm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const UI_MODULE = /utils\/(toast|loading|modal|datetime)\.js$/;
const INSTALLED = Symbol('ui-sandbox-vm');

function isUiModule(request) {
  return UI_MODULE.test(String(request));
}

// 在 context 里求值真模块;模块自己的 require(safe-user-message 等纯函数)走 Node 真 require。
function loadUiModule(request, context) {
  const file = path.join(ROOT, 'utils', UI_MODULE.exec(String(request))[1] + '.js');
  const source = '(function (module, exports, require) {' + fs.readFileSync(file, 'utf8') + '\n})';
  const wrapper = nodeVm.runInContext(source, context, { filename: file });
  const mod = { exports: {} };
  wrapper(mod, mod.exports, (id) => require(path.resolve(path.dirname(file), id)));
  return mod.exports;
}

function install(sandbox) {
  if (!sandbox || typeof sandbox !== 'object' || sandbox[INSTALLED]) return sandbox;
  sandbox[INSTALLED] = true;
  const inner = sandbox.require;
  const shim = function (request) {
    if (isUiModule(request)) return loadUiModule(request, sandbox);
    if (typeof inner !== 'function') throw new Error('unexpected require: ' + request);
    return inner.apply(this, arguments);
  };
  if (typeof inner === 'function') Object.assign(shim, inner);
  sandbox.require = shim;
  return sandbox;
}

module.exports = Object.assign({}, nodeVm, {
  isUiModule,
  loadUiModule,
  createContext(sandbox, options) {
    return nodeVm.createContext(install(sandbox), options);
  },
  runInNewContext(code, sandbox, options) {
    return nodeVm.runInNewContext(code, install(sandbox), options);
  },
  runInContext(code, context, options) {
    return nodeVm.runInContext(code, install(context), options);
  },
});
