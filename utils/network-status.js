'use strict';
// 全局网络状态(审核清单 §6.5):app 启动时装一次,cy-nav-bar 订阅后在标题栏下挂 cy-offline-banner。
// 纯函数式:wxApi 注入,契约直接喂假 wx 断言行为。
function createNetworkStatus(wxApi) {
  const listeners = new Set();
  const state = { offline: false };
  function apply(offline) {
    offline = !!offline;
    if (state.offline === offline) return;   // 同态不重复广播
    state.offline = offline;
    listeners.forEach((fn) => fn(offline));
  }
  if (wxApi && typeof wxApi.getNetworkType === 'function') {
    wxApi.getNetworkType({ success: (r) => apply(r && r.networkType === 'none') });
  }
  if (wxApi && typeof wxApi.onNetworkStatusChange === 'function') {
    wxApi.onNetworkStatusChange((r) => apply(!(r && r.isConnected)));
  }
  return {
    // 订阅时立即回放当前态,页面进入时就能拿到;返回退订函数给 detached 用
    subscribe(fn) { listeners.add(fn); fn(state.offline); return () => listeners.delete(fn); },
  };
}
module.exports = { createNetworkStatus };
