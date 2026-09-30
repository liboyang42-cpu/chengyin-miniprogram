'use strict';

// 回归:#750 把 `const bgTracker = require(...)` 插进了 req() 函数体,模块作用域没有 bgTracker,
// _startReal → startLocation 一调就 ReferenceError —— 漫游实时定位整条静默死掉
// (真机零报错:雾不揭、玩家不动、目标卡永远停在「开启定位」)。
// 本测试从真实入口调 _startReal,任何把 bgTracker 移出模块作用域的改动都会在这里变红。

const assert = require('node:assert/strict');
const test = require('node:test');

let pageConfig;
global.getApp = () => ({
  globalData: { user_id: 9, features: {} },
  isDevEnv: () => false,
  sendRequest() {},
  recordConsent: () => Promise.resolve(),
});
global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 20 }),
  getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  createSelectorQuery: () => ({
    select: () => ({ fields: () => ({ exec: (cb) => cb([{ node: null }]) }) }),
  }),
};
global.Page = (config) => { pageConfig = config; };

function loadRoamPage() {
  delete require.cache[require.resolve('../../pages/roam/index.js')];
  delete require.cache[require.resolve('../../utils/location/bg-tracker.js')];
  require('../../pages/roam/index.js');
  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = (patch, cb) => { Object.assign(page.data, patch); if (cb) cb(); };
  return page;
}

test('_startReal 真实入口能走到定位开启(bgTracker 必须在模块作用域)', () => {
  const calls = { bgStart: 0, fgStart: 0, onChange: 0 };
  // 后台定位 API 缺失 → bg-tracker 应降级前台并成功
  global.wx.startLocationUpdateBackground = undefined;
  global.wx.startLocationUpdate = (o) => { calls.fgStart++; o.success && o.success(); };
  global.wx.onLocationChange = () => { calls.onChange++; };
  global.wx.setKeepScreenOn = () => {};
  global.wx.showToast = () => {};

  const page = loadRoamPage();
  page._syncGoal = () => {};
  // consentAlreadyRecorded=true 直通 startLocation —— #750 的 ReferenceError 就在这一步爆
  page._startReal(true);

  assert.strictEqual(calls.fgStart, 1, 'wx.startLocationUpdate 应被真正调用(说明 bgTracker.acquire 没有炸)');
  assert.strictEqual(calls.onChange, 1, '定位回调应已挂上');
  assert.ok(page._realOn, '_realOn 应为 true');
  assert.strictEqual(page.data.locErr, false, '定位开启后应清掉可见定位错误态');
});
