'use strict';

// 商家页入口的静默登录:已有会话直接复用(单航班管理器会短路),没有会话才真的走
// wx.login → /api/login/code。失败只回 false、不 toast —— 由调用页用页内的
// cy-inline-error 报错并给重试,不再整屏拦「登录后查看 / 去登录」(2026-09-16 裁决:
// 商家自己的账号进来看到登录闸只是添麻烦,玩家又没有商家入口)。
function ensureSession(app) {
  const instance = app || (typeof getApp === 'function' ? getApp() : null);
  if (!instance) return Promise.resolve(false);
  const manager = typeof instance.getSessionManager === 'function' ? instance.getSessionManager() : null;
  if (manager && typeof manager.ensureSession === 'function') {
    return Promise.resolve(manager.ensureSession()).then(
      function (result) { return !!(result && result.ok); },
      function () { return false; },
    );
  }
  return Promise.resolve(!!(typeof instance.getUserID === 'function' && instance.getUserID()));
}

module.exports = { ensureSession };
