'use strict';

// A-10(P3):别人发来的 ?scene=不存在 打开设置页,shezhi.onLoad 直接 openScene →
// getScene 对未知 id throw,且 openScene 没有 try/catch ⇒ 未捕获异常,页面卡在半初始化态、零提示。
// 口径对齐 scene-deep-link:catch + toast + 留在原页。
//
// 负控:摘掉 try/catch,未知 scene 用例必须真红(继续抛未捕获异常)。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_REL = 'pages/shezhi/shezhi.js';
const PAGE_PATH = path.resolve(__dirname, '../../pages/shezhi/shezhi.js');
const read = () => fs.readFileSync(PAGE_PATH, 'utf8');

function loadPage(source) {
  const toasts = [];
  const requests = [];
  let definition = null;
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    setUserRole() {},
    sendRequest(options) { requests.push(options); return { abort() {} }; },
  });
  global.Page = (config) => { definition = config; };
  global.wx = {
    getStorageSync: () => '',
    setNavigationBarColor() {},
    showToast(options) { toasts.push(options && options.title); },
    hideLoading() {},
  };
  delete require.cache[require.resolve(PAGE_PATH)];
  if (source) {
    const Module = require('node:module');
    const m = new Module(PAGE_PATH, null);
    m.filename = PAGE_PATH;
    m.paths = Module._nodeModulePaths(path.dirname(PAGE_PATH));
    m._compile(source, PAGE_PATH);
  } else {
    require(PAGE_PATH);
  }
  assert.ok(definition, 'shezhi 必须注册 Page');
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
  });
  page.setData = function setData(patch, cb) {
    Object.assign(this.data, patch);
    if (cb) cb();
  };
  return { page, toasts, requests };
}

test('未知 scene:不抛未捕获异常、给出可见提示、停在原页零残留面板', () => {
  const { page, toasts } = loadPage();
  assert.doesNotThrow(() => {
    page.onLoad({ scene: 'no-such-scene-0916' });
  }, '未知 scene 不得把 onLoad 炸掉(否则页面卡在半初始化态)');
  assert.deepEqual(toasts, ['场景暂时打不开'], '必须有可见提示,不能静默');
  assert.deepEqual(page.data.sceneStack, [], '坏深链不得压入任何场景');
  assert.equal(page.data.sceneCurrent, null);
});

test('已登记的 scene 照常打开(兼容键不受影响)', () => {
  const { page, toasts } = loadPage();
  page.onLoad({ scene: 'settings-deregister' });
  assert.deepEqual(toasts, [], '合法 scene 不该弹「打不开」');
  assert.equal(page.data.sceneStack.length, 1);
  assert.equal(page.data.sceneCurrent.id, 'settings-deregister');
});

test('负控:摘掉 try/catch,未知 scene 用例真红', () => {
  const source = read();
  const broken = source.replace(
    `    let next;
    try {
      next = getScene(id, params);
    } catch (e) {
      // A-10:深链 ?scene=不存在 时 getScene 会 throw,onLoad 里没有 try 会让页面卡在半初始化态。
      // 与 scene-deep-link 同一口径:toast + 留在原页(兜底返回)。
      toast('场景暂时打不开');
      return false;
    }`,
    '    const next = getScene(id, params);');
  assert.notEqual(broken, source, '负控锚点失效:try/catch 未命中');

  const { page } = loadPage(broken);
  assert.throws(() => {
    page.onLoad({ scene: 'no-such-scene-0916' });
  }, /unknown scene/, '负控必须真的把兜底摘掉');
});
