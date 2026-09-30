'use strict';
// utils/loading.js —— 全屏阻塞加载遮罩的唯一出口(替代 wx.showLoading / wx.hideLoading)
//
// 调用:loading.show('提交中') … loading.hide()。渲染:栈顶页里的 <cy-loading-mask id="cy-loading" />。
// 页面没挂它时回落到原生 —— 这是全仓允许出现 wx.showLoading/hideLoading 的唯一位置。
//
// ⚠️ show 与 hide 之间页面栈可能已经换了(navigateTo 后在 complete 里 hide、或从没宿主的页跳到有宿主的页)。
// 所以 hide 不重新找宿主,而是关掉 show 时记住的那一个;原生 hideLoading 是全局的,这里等价地做成单例。
function hostMask() {
  if (typeof getCurrentPages !== 'function') return null;
  const pages = getCurrentPages();
  const page = pages && pages[pages.length - 1];
  if (!page || typeof page.selectComponent !== 'function') return null;
  const host = page.selectComponent('#cy-loading');
  return host && typeof host.show === 'function' ? host : null;
}

let active = null;   // { kind: 'host', host } | { kind: 'native' }
let depth = 0;

// 回落:全仓唯一的原生 showLoading 调用点(no-system-toast 契约钉住只许一处)
function nativeShow(text) { wx.showLoading({ title: text, mask: true }); }

function show(title) {
  const text = title || '加载中';
  if (active) {
    depth += 1;
    if (active.kind === 'host') active.host.show({ title: text });
    else nativeShow(text);   // 原生只有一层,再 show 一次只是换文案
    return active.kind === 'host';
  }
  const host = hostMask();
  depth = 1;
  if (host) { active = { kind: 'host', host }; host.show({ title: text }); return true; }
  active = { kind: 'native' };
  nativeShow(text);
  return false;
}

function hide() {
  if (!active) return false;
  depth = Math.max(0, depth - 1);
  if (active.kind === 'host') active.host.hide();
  if (depth > 0) return active.kind === 'host';
  const wasHost = active.kind === 'host';
  if (wasHost) active.host.hide(true); else wx.hideLoading();
  active = null;
  return wasHost;
}

module.exports = { show, hide };
