'use strict';
// M2 nightWarning 契约:自玩(topicId 会话)在 22:00–06:00 打卡/推进成功时,
// 后端在回执里带 nightWarning:true(ApiPlayProgressController isNightNow :2592)。
// 前端必须在结果时刻出一句**不阻断**的提示(不吃点击、不弹窗挡路),白天不许出现。
const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const WXML = read('pages/play/index.wxml');
const WXSS = read('pages/play/index.wxss').replace(/\/\*[\s\S]*?\*\//g, '');
const JS = read('pages/play/index.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pageConfig;
let toasts;
beforeEach(() => { pageConfig = null; toasts = []; });

global.getApp = () => ({
  getUserID: () => '9', globalData: { user_id: 9 }, isDevEnv: () => false, sendRequest: () => {},
});
global.wx = {
  getStorageSync: () => '', setStorageSync() {}, getWindowInfo: () => ({ statusBarHeight: 20, screenHeight: 844 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }), showToast: (o) => { toasts.push(o); }, hideToast() {},
  vibrateShort() {}, showLoading() {}, hideLoading() {}, getLocation: () => {},
};
global.Page = (c) => { pageConfig = c; };

function setByPath(target, dataPath, value) {
  const parts = dataPath.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
}

function loadPage() {
  delete require.cache[require.resolve('../../pages/play/index.js')];
  require('../../pages/play/index.js');
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) });
  page.setData = (patch, callback) => {
    Object.entries(patch).forEach(([dataPath, value]) => setByPath(page.data, dataPath, value));
    if (callback) callback();
  };
  page.data.nodes = [{ nodeId: 7, points: 12 }];
  page.data.mode = 2;
  page.data.nextNode = null;
  page.data.showJournal = false;
  page.clearArrivalError = () => {};
  page.clearGameNetworkError = () => {};
  page.stopNav = () => {};
  page.rebuild = () => {};
  page.markJustWrote = () => {};
  return page;
}

test('夜里完成(nightWarning:true):结果时刻出非阻断提示', () => {
  const page = loadPage();
  page.onComplete(7, { nightWarning: true });
  assert.equal(page.data.nightHint, true, '夜间提示必须随结果出现');
  assert.equal(toasts.filter((t) => /夜深/.test(t.title || '')).length, 0, '不许用 toast 一闪而过');
});

test('白天完成 / 后端不带该字段:不出夜间提示', () => {
  for (const data of [{}, { nightWarning: false }]) {
    const page = loadPage();
    page.onComplete(7, data);
    assert.notEqual(page.data.nightHint, true);
  }
});

test('提示节点非阻断:纯展示、不吃点击(ds-ok 用 lockhint 同款瞬时层)', () => {
  const node = WXML.match(/<view class="nighthint"[\s\S]*?<\/view>/);
  assert.ok(node, 'wxml 必须有 .nighthint 节点');
  assert.match(node[0], /wx:if="\{\{nightHint\}\}"/);
  assert.doesNotMatch(node[0], /bindtap|catchtap|bind:|\sdata-/, '提示不许可点');
  const css = WXSS.match(/\.nighthint\s*\{[^}]*\}/);
  assert.ok(css, '.nighthint 必须有样式');
  assert.match(css[0], /pointer-events\s*:\s*none/, '非阻断:不吃点击');
});
