'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertLandingHealthy,
  assertRuntimeConfigured,
  expectedLandingRoute,
} = require('../automator/login-smoke.js');

test('登录烟测按真实身份合同判断首页落点', () => {
  assert.equal(expectedLandingRoute({ role: 'merchant', userType: 2, debugView: '' }), 'pages/merchant/index/index');
  assert.equal(expectedLandingRoute({ role: 'player', userType: 1, debugView: '' }), 'pages/index/index');
  assert.equal(expectedLandingRoute({ role: 'merchant', userType: 2, debugView: 'user' }), 'pages/index/index');
});

test('登录烟测在 develop 未配置 API 时 fail-closed 并给出明确原因', () => {
  assert.throws(
    () => assertRuntimeConfigured({ environment: 'develop', configured: false, apiBaseUrl: '' }),
    /develop API 环境未配置/,
  );
  assert.doesNotThrow(() => assertRuntimeConfigured({ environment: 'release', configured: true, apiBaseUrl: 'https://example.test/api' }));
});

test('登录烟测不得把工作台错误态或无限 loading 当成通过', () => {
  // 2026-09-16 去闸:失败态由页内 consoleError 表达,不再有整屏 consoleState。
  assert.throws(
    () => assertLandingHealthy({ consoleError: '网络好像出了点小差' }, 'pages/merchant/index/index'),
    /工作台错误态/,
  );
  assert.throws(
    () => assertLandingHealthy({ isLoading: true }, 'pages/index/index'),
    /卡在 loading 态/,
  );
  assert.doesNotThrow(() => assertLandingHealthy({ consoleError: '', isLoading: false }, 'pages/merchant/index/index'));
});
