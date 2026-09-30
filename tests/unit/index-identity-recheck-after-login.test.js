'use strict';

// 2026-08-10 用户真机(iPhone 15 Pro Max / 体验版)实测:刷新小程序先进玩家首页,
// 手动切到别的页面再回来才变成商家首页。
//
// 机制:首页判玩家/商家读的是 storage 里的角色快照,而这份快照要等异步登录回来
// (applySession)才写。冷缓存冷启动时 onLaunch 的 restore() 拿不到,onLoad/onShow 的
// 同步判定都跑在登录落地之前 —— 之后没有任何人通知已渲染的首页"身份现在知道了",
// 于是商家一直停在玩家首页,直到下一次 onShow。开发者工具 storage 跨编译常驻、
// 永远命中同步分支,所以只有真机/体验版报。
//
// 本测试按真实生命周期(onLoad → onShow → 登录落地)驱动,断言的是"有没有真的跳转"
// 和"跳转前有没有先去拉数据/弹定位授权",不是源码长相。

const assert = require('assert');
const test = require('node:test');

const MERCHANT_HOME = '/pages/merchant/index/index';

function setupPage(options) {
  options = options || {};
  const storage = Object.assign({}, options.storage);
  const redirects = [];
  const calls = [];
  const toasts = [];
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  let pageConfig = null;
  global.Page = (config) => { pageConfig = config; };
  global.Component = () => {};
  global.wx = {
    getStorageSync: (key) => (key in storage ? storage[key] : ''),
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: (key) => { delete storage[key]; },
    hideTabBar() {},
    showTabBar() {},
    redirectTo: (opts) => { redirects.push(opts.url); },
    navigateTo() {},
    switchTab() {},
    showToast(options) { toasts.push(options.title); },
    hideLoading() {},
    stopPullDownRefresh() {},
    setNavigationBarColor() {},
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 430 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 430 }),
    getMenuButtonBoundingClientRect: () => ({ top: 4, height: 32, width: 87, right: 423 }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'trial' } }),
    nextTick: (fn) => fn(),
    createSelectorQuery: () => ({
      select: () => ({ boundingClientRect: () => ({ exec: (cb) => cb([null]) }) }),
      in: function () { return this; },
    }),
  };
  global.getApp = () => ({
    globalData: { user_id: 0, features: {} },
    isDevEnv: () => false,
    sendRequest() {},              // 冷启动时后端兜底不该被指望,这里保持沉默
    getUserID: () => storage.user_id || '',
    setUserType(v) { storage.user_type = v; },
    setUserRole() {},
    waitForAppReady: () => readyPromise,
  });

  delete require.cache[require.resolve('../../pages/index/index.js')];
  require('../../pages/index/index.js');
  assert.ok(pageConfig, '首页没有注册 Page()');

  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = function (patch, cb) {
    Object.assign(page.data, patch);
    if (typeof cb === 'function') cb();
  };
  // onLoad 尾部的同步副作用与 ready 回调里的数据加载,全部换成可观测的桩
  ['_layoutChrome', 'startCountdownTimer', 'handleInviter', 'loadPageData', 'getFuzzyLocation']
    .forEach((name) => { page[name] = () => { calls.push(name); }; });

  global.getCurrentPages = () => [page];

  return { page, storage, redirects, calls, toasts, landLogin: resolveReady, failLogin: rejectReady };
}

// 让挂在 waitForAppReady 上的 then 回调跑完
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('冷缓存冷启动:登录落地后首页自己复判身份并跳商家首页(不必手动切走再回来)', async () => {
  // 冷缓存 = storage 里没有角色快照,正是真机首次进入/体验版的状态
  const ctx = setupPage({ storage: {} });

  ctx.page.onLoad({});
  ctx.page.onShow();
  assert.deepStrictEqual(ctx.redirects, [], '登录还没落地时不该跳转,应先渲染玩家首页');

  // 登录回来了:applySession 把角色写进 storage,然后 appReadyPromise resolve
  ctx.storage.role = 'merchant';
  ctx.storage.user_type = 2;
  ctx.storage.user_id = 42;
  ctx.landLogin();
  await flush();

  assert.deepStrictEqual(
    ctx.redirects,
    [MERCHANT_HOME],
    '登录落地后没有复判身份 ⇒ 商家会一直停在玩家首页,直到手动切走再切回(2026-08-10 真机复现的就是这个)',
  );
});

test('复判判出商家时不许先去拉数据/弹定位授权,再把人跳走', async () => {
  const ctx = setupPage({ storage: {} });
  ctx.page.onLoad({});
  ctx.storage.role = 'merchant';
  ctx.storage.user_id = 42;
  ctx.landLogin();
  await flush();

  assert.deepStrictEqual(ctx.redirects, [MERCHANT_HOME]);
  assert.ok(!ctx.calls.includes('getFuzzyLocation'), '商家不该先被弹一次定位授权框再被跳走');
  assert.ok(!ctx.calls.includes('loadPageData'), '要跳走了就别再拉玩家首页的数据');
});

test('登录落地后仍是玩家:不许乱跳,照常拉数据', async () => {
  const ctx = setupPage({ storage: {} });
  ctx.page.onLoad({});
  ctx.page.onShow();
  ctx.storage.role = 'player';
  ctx.storage.user_id = 7;
  ctx.landLogin();
  await flush();

  assert.deepStrictEqual(ctx.redirects, [], '玩家不该被弹去商家首页');
  assert.ok(ctx.calls.includes('loadPageData'), '玩家路径的数据加载不能被复判挡掉');
  assert.ok(ctx.calls.includes('getFuzzyLocation'), '玩家路径的定位不能被复判挡掉');
});

test('热缓存:同步分支直接命中,复判不产生第二次跳转', async () => {
  const ctx = setupPage({ storage: { role: 'merchant', user_type: 2, user_id: 42 } });
  ctx.page.onLoad({});
  assert.deepStrictEqual(ctx.redirects, [MERCHANT_HOME], '热缓存应当在 onLoad 同步分支就跳走');
  ctx.landLogin();
  await flush();
  assert.deepStrictEqual(ctx.redirects, [MERCHANT_HOME], '不许因为复判又跳一次');
});

test('复判时用户已经切走:不许把人从别的页面拽回商家首页', async () => {
  const ctx = setupPage({ storage: {} });
  ctx.page.onLoad({});
  ctx.storage.role = 'merchant';
  ctx.storage.user_id = 42;
  global.getCurrentPages = () => [ctx.page, { route: 'pages/other/index' }]; // 用户已经进了别的页
  ctx.landLogin();
  await flush();
  assert.deepStrictEqual(ctx.redirects, [], '本页已不是栈顶,复判不该抢导航');
});

test('appReady 拒绝必须给出可见错误，不能因页面时序分支静默吞掉', async () => {
  const ctx = setupPage({ storage: {} });
  ctx.page.onLoad({});
  global.getCurrentPages = () => [ctx.page, { route: 'pages/other/index' }];
  ctx.failLogin(new Error('bootstrap failed'));
  await flush();

  assert.deepStrictEqual(ctx.toasts, ['加载失败，请重试']);
});

test('首页卸载后 appReady 迟到回调不得 setData、加载数据或触发定位', async () => {
  const ctx = setupPage({ storage: {} });
  let postUnloadWrites = 0;
  const originalSetData = ctx.page.setData;
  ctx.page.setData = function (patch, cb) {
    postUnloadWrites += 1;
    originalSetData.call(this, patch, cb);
  };
  ctx.page.onLoad({});
  ctx.page.onUnload();
  postUnloadWrites = 0;

  ctx.storage.role = 'player';
  ctx.storage.user_id = 7;
  ctx.landLogin();
  await flush();

  assert.equal(postUnloadWrites, 0);
  assert.ok(!ctx.calls.includes('loadPageData'));
  assert.ok(!ctx.calls.includes('getFuzzyLocation'));
});

test('跳商家首页必须带 fail 回调(导航被丢时不能零信号)', () => {
  const ctx = setupPage({ storage: { role: 'merchant', user_type: 2, user_id: 42 } });
  let failHandler = null;
  global.wx.redirectTo = (opts) => { failHandler = opts.fail; };
  ctx.page.onLoad({});
  assert.strictEqual(
    typeof failHandler,
    'function',
    'redirectTo 没有 fail 回调 ⇒ 跳转被框架丢掉时完全没有信号,分不清是没判出商家还是判出了没跳成',
  );
});
