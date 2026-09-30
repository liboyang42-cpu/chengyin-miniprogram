'use strict';

// A-01(P1):邀请冷启动整条链断在两处,缺一不可 ——
//   ① 分享端产 path '/pages/index/index?inviter=<uid>'(profile getSharePayload / myinvite onShareAppMessage),
//      落地页却只读 options.id ⇒ 全仓 options.inviter 零命中,setInviter 永不被调;
//   ② 即使键对上:典型被邀请人=新用户,onLoad 时还没有 currentUserId,handleInviter 的登录闸
//      直接挡掉且之后无人重试 ⇒ 邀请关系永久丢。
//
// 本契约同时钉住「读取端兼容 inviter/id 两个键(老卡片仍在流通)」与「登录落地后重试一次」,
// 并断言分享端产键落在读取端认的键里。负控:去掉任一兼容键 / 去掉重试,对应用例必须真红。

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_REL = 'pages/index/index.js';
const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function setupPage(options) {
  options = options || {};
  const storage = Object.assign({}, options.storage);
  const requests = [];
  const calls = [];
  let resolveReady;
  const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

  let pageConfig = null;
  global.Page = (config) => { pageConfig = config; };
  global.Component = () => {};
  global.wx = {
    getStorageSync: (key) => (key in storage ? storage[key] : ''),
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: (key) => { delete storage[key]; },
    hideTabBar() {},
    showTabBar() {},
    redirectTo() {},
    navigateTo() {},
    switchTab() {},
    showToast() {},
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
    pendingDoorScene: null,
    isDevEnv: () => false,
    sendRequest(opts) { requests.push(opts); },
    getUserID: () => storage.user_id || '',
    setUserType(v) { storage.user_type = v; },
    setUserRole() {},
    waitForAppReady: () => readyPromise,
  });

  const absolutePath = path.join(ROOT, PAGE_REL);
  const source = (options && options.source) || read(PAGE_REL);
  const vm = require('node:vm');
  vm.runInNewContext(source, {
    console,
    getApp: global.getApp,
    getCurrentPages: () => [page],
    Page: (config) => { pageConfig = config; },
    require: require('node:module').createRequire(absolutePath),
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    wx: global.wx,
  }, { filename: absolutePath });
  assert.ok(pageConfig, '首页没有注册 Page()');

  const page = Object.assign({}, pageConfig, {
    data: JSON.parse(JSON.stringify(pageConfig.data)),
  });
  page.setData = function (patch, cb) {
    Object.assign(page.data, patch);
    if (typeof cb === 'function') cb();
  };
  // 只桩掉与本契约无关的同步副作用;handleInviter 必须是真的(它才是被测行为)。
  ['_layoutChrome', 'startCountdownTimer', 'loadPageData', 'getFuzzyLocation']
    .forEach((name) => { page[name] = () => { calls.push(name); }; });

  global.getCurrentPages = () => [page];

  return { page, storage, requests, calls, landLogin: resolveReady };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setInviterRequest(ctx) {
  return ctx.requests.find((r) => r.url === '/api/user/setInviter');
}

test('新用户冷启动:?inviter= 在登录落地后补发,邀请关系落库', async () => {
  const ctx = setupPage({ storage: {} });
  ctx.page.onLoad({ inviter: '42' });
  assert.equal(setInviterRequest(ctx), undefined, '登录还没落地时不能发邀请请求(会被登录闸挡掉)');

  ctx.storage.user_id = 7;
  ctx.landLogin();
  await flush();

  const req = setInviterRequest(ctx);
  assert.ok(req, '登录落地后必须重试一次邀请写入 —— 否则新用户邀请永久丢失(A-01 根因②)');
  assert.equal(String(req.data.inviter_id), '42');
  req.success({ code: '200' });
  assert.equal(ctx.storage.has_inviter, true, '成功后必须记账,避免重复写入');
});

test('老分享卡片:?id= 仍能落地(读取端兼容两个键)', async () => {
  const ctx = setupPage({ storage: {} });
  ctx.page.onLoad({ id: '42' });
  ctx.storage.user_id = 7;
  ctx.landLogin();
  await flush();

  const req = setInviterRequest(ctx);
  assert.ok(req, '存量卡片产的是 ?id=,读取端只认 inviter 会把老卡片全部漏掉');
  assert.equal(String(req.data.inviter_id), '42');
});

test('已登录用户打开邀请卡:照常写入;已记过账的重复打开不重发', async () => {
  const warm = setupPage({ storage: { user_id: 7 } });
  warm.page.onLoad({ inviter: '42' });
  warm.landLogin();
  await flush();
  assert.ok(setInviterRequest(warm), '热启动(登录已在)也要落邀请关系');

  const recorded = setupPage({ storage: { user_id: 7, has_inviter: true } });
  recorded.page.onLoad({ inviter: '42' });
  recorded.landLogin();
  await flush();
  assert.equal(setInviterRequest(recorded), undefined, '已记过账的会话不得重复写邀请');
});

test('邀请人不等于自己:不给自己写邀请', async () => {
  const ctx = setupPage({ storage: { user_id: 7 } });
  ctx.page.onLoad({ inviter: '7' });
  ctx.landLogin();
  await flush();
  assert.equal(setInviterRequest(ctx), undefined);
});

test('分享端产键 ∩ 读取端认键 不为空(键名契约)', () => {
  const producers = ['components/cy/profile/index.js', 'subpackageMember/myinvite/myinvite.js'];
  const produced = new Set();
  for (const rel of producers) {
    const src = read(rel);
    for (const m of src.matchAll(/\/pages\/index\/index\?([A-Za-z_]+)=/g)) produced.add(m[1]);
    assert.match(src, /\/pages\/index\/index\?/, rel + ' 必须有邀请分享 path');
  }
  assert.deepEqual([...produced].sort(), ['inviter'], '分享端键名或新增了别的键,先更新本契约');

  const landing = read(PAGE_REL);
  const accepted = new Set();
  if (/return options\.inviter/.test(landing)) accepted.add('inviter');
  if (/options\.id/.test(landing)) accepted.add('id');
  for (const key of produced) {
    assert.ok(accepted.has(key), `分享端产的 ?${key}= 读取端不认 —— 邀请关系永远写不进去`);
  }
});

test('负控:读取端去掉 inviter 兼容(只认 id),新卡片用例真红', async () => {
  const original = read(PAGE_REL);
  const brokenSource = original.replace("return options.inviter || options.id || '';", "return options.id || '';");
  assert.notEqual(brokenSource, original, '负控锚点失效:inviter 兼容分支未命中');

  const ctx = setupPage({ storage: {}, source: brokenSource });
  ctx.page.onLoad({ inviter: '42' });
  ctx.storage.user_id = 7;
  ctx.landLogin();
  await flush();
  assert.equal(setInviterRequest(ctx), undefined, '负控必须真的把 inviter 键改掉');
});

test('负控:去掉登录后重试,冷启动新用户用例真红', async () => {
  const original = read(PAGE_REL);
  const brokenSource = original.replace('      that.retryPendingInviter();\n', '');
  assert.notEqual(brokenSource, original, '负控锚点失效:retryPendingInviter 调用点未命中');

  const ctx = setupPage({ storage: {}, source: brokenSource });
  ctx.page.onLoad({ inviter: '42' });
  ctx.storage.user_id = 7;
  ctx.landLogin();
  await flush();
  assert.equal(setInviterRequest(ctx), undefined, '负控必须真的把重试摘掉');
});
