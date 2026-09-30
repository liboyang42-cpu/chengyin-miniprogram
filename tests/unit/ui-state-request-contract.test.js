'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sendUiStateRequest } = require('../../utils/ui-state-request');

function fakeApp() {
  const calls = [];
  return {
    calls,
    sendRequest(options) {
      calls.push(options);
      return { abort() {} };
    },
  };
}

test('只转发枚举端点，并强制统一静默层与调用方 fail handler', () => {
  const app = fakeApp();
  const fail = () => {};
  const task = sendUiStateRequest(app, '/api/user/deregister/status', {
    method: 'GET',
    data: { probe: true },
    fail,
  });

  assert.equal(typeof task.abort, 'function');
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].url, '/api/user/deregister/status');
  assert.equal(app.calls[0].hideLoading, true);
  assert.equal(app.calls[0].silentError, true);
  assert.equal(app.calls[0].fail, fail);
});

test('未知端点 fail closed，不得把运行时 URL 透传给 sendRequest', () => {
  const app = fakeApp();

  assert.throws(
    () => sendUiStateRequest(app, '/api/runtime/' + Date.now(), { fail() {} }),
    /未登记的 UI-state 请求端点/,
  );
  assert.equal(app.calls.length, 0);
});

test('缺 fail handler 必须在发请求前失败', () => {
  const app = fakeApp();

  assert.throws(
    () => sendUiStateRequest(app, '/api/coupon/publish', { method: 'POST' }),
    /必须提供 fail handler/,
  );
  assert.equal(app.calls.length, 0);
});
