// Phase 2 roleGuard 回归 —— 委托 identity-policy + reachedLimit fail-closed(TDD RED)。
//
// roleGuard 仍负责拉取/缓存(load/clear/role/permission/usage),能力解释委托 identity-policy。
// 关键变更:reachedLimit 无权限快照时 fail-closed;新增 hasSnapshot()。对外 API 其余不变。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const store = {};
global.wx = {
  getStorageSync: (k) => store[k],
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
};
let sent = [];
let identity = { userId: '7', token: 'token-a' };
global.getApp = () => ({
  sendRequest: (param) => { sent.push(param); },
  getUserID: () => identity.userId,
  getAuthorization: () => identity.token,
});

const PATH = '../../utils/roleGuard.js';
let roleGuard;
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  sent = [];
  identity = { userId: '7', token: 'token-a' };
  delete require.cache[require.resolve(PATH)];
  roleGuard = require(PATH);
});

test('role 默认 player;load 成功后写缓存并回调最新', () => {
  assert.equal(roleGuard.role(), 'player');
  let got;
  roleGuard.load((d) => { got = d; });
  assert.equal(sent[0].url, '/api/role/info');
  sent[0].success({ code: '200', data: { role: 'merchant', permission: { canCreateTheme: true, maxThemes: 3 }, usage: { themes: 1 } } });
  assert.equal(got.role, 'merchant');
  assert.equal(roleGuard.role(), 'merchant');
});

test('同一身份并发 load 只发送一次权限请求，并把结果分发给全部调用方', () => {
  const received = [];
  roleGuard.load((data) => { received.push(['first', data && data.role]); });
  roleGuard.load((data) => { received.push(['second', data && data.role]); });

  assert.equal(sent.length, 1, '同一身份并发加载权限必须 single-flight');
  sent[0].success({
    code: '200',
    data: { role: 'merchant', permission: { canCreateTheme: true }, usage: {} },
  });
  assert.deepEqual(received, [['first', 'merchant'], ['second', 'merchant']]);
});

test('can 委托 policy:布尔位 + 列表位', () => {
  roleGuard.load(() => {});
  sent[0].success({ code: '200', data: { role: 'club', permission: { canBranch: true, nodeTypes: ['scan'] }, usage: {} } });
  assert.equal(roleGuard.can('canBranch'), true);
  assert.equal(roleGuard.can('canGameMechanic'), false);
  assert.equal(roleGuard.can('nodeTypes', 'scan'), true);
  assert.equal(roleGuard.can('nodeTypes', 'gps'), false);
});

test('reachedLimit:无权限快照 → fail-closed(true)', () => {
  assert.equal(roleGuard.hasSnapshot(), false);
  assert.equal(roleGuard.reachedLimit('maxThemes', 'themes'), true);
});

test('reachedLimit:已加载:null 不限 false、used>=max true', () => {
  roleGuard.load(() => {});
  sent[0].success({ code: '200', data: { role: 'merchant', permission: { maxThemes: null, maxCoupons: 2 }, usage: { coupons: 2 } } });
  assert.equal(roleGuard.hasSnapshot(), true);
  assert.equal(roleGuard.reachedLimit('maxThemes', 'themes'), false); // null=不限
  assert.equal(roleGuard.reachedLimit('maxCoupons', 'coupons'), true); // 2>=2
});

test('load 失败回落本地缓存', () => {
  roleGuard.load(() => {});
  sent[0].success({ code: '200', data: { role: 'club', permission: { canBranch: true }, usage: {} } });
  delete require.cache[require.resolve(PATH)];
  roleGuard = require(PATH);
  let got;
  roleGuard.load((d) => { got = d; });
  sent[1].fail();
  assert.equal(got.role, 'club');
  assert.equal(roleGuard.can('canBranch'), true);
});

test('换账号或 token 后旧权限缓存立即失效，旧请求迟到也不得污染新身份', () => {
  roleGuard.load(() => {});
  const oldRequest = sent[0];
  identity = { userId: '8', token: 'token-b' };
  assert.equal(roleGuard.hasSnapshot(), false);
  assert.equal(roleGuard.role(), 'player');

  oldRequest.success({ code: '200', data: { role: 'merchant', permission: { canCreateTheme: true }, usage: {} } });
  assert.equal(roleGuard.can('canCreateTheme'), false);
  assert.equal(store['role_permission_cache_v1'], undefined);
});

test('身份切换时新旧权限请求彼此隔离，旧响应不会截断新身份单航班', () => {
  const received = [];
  roleGuard.load((data) => { received.push(['old', data && data.role]); });
  const oldRequest = sent[0];

  identity = { userId: '8', token: 'token-b' };
  roleGuard.load((data) => { received.push(['new', data && data.role]); });
  const newRequest = sent[1];
  assert.equal(sent.length, 2, '身份已切换时必须为新账号发独立请求');

  oldRequest.success({ code: '200', data: { role: 'merchant', permission: { canCreateTheme: true }, usage: {} } });
  roleGuard.load((data) => { received.push(['new-joined', data && data.role]); });
  assert.equal(sent.length, 2, '旧响应不得清掉新身份的在途锁');

  newRequest.success({ code: '200', data: { role: 'club', permission: { canBranch: true }, usage: {} } });
  assert.deepEqual(received, [['old', null], ['new', 'club'], ['new-joined', 'club']]);
  assert.equal(roleGuard.role(), 'club');
});

test('clear 清模块缓存 + storage', () => {
  roleGuard.load(() => {});
  sent[0].success({ code: '200', data: { role: 'merchant', permission: { canCreateTheme: true }, usage: {} } });
  assert.equal(roleGuard.hasSnapshot(), true);
  roleGuard.clear();
  assert.equal(roleGuard.hasSnapshot(), false);
  assert.equal(store['role_permission_cache_v1'], undefined);
});
