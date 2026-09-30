'use strict';
// utils/toast.js —— 全站唯一的轻提示出口(2026-09-06 三端审核「原生弹层全删」批次)
//
// 调用:toast('已保存') / toast.success('已复制') / toast.error('网络没连上') / toast('…', { duration: 3000 })
// 渲染:栈顶页里的 <cy-toast id="cy-toast" />。页面没挂它(历史页/单测沙箱)时回落到 wx.showToast ——
// 这是全仓允许出现 wx.showToast 的唯一位置(no-system-toast 契约钉住),别在别处再写。
const { safeUserMessage } = require('./transport/safe-user-message.js');

function hostToast() {
  if (typeof getCurrentPages !== 'function') return null;
  const pages = getCurrentPages();
  const page = pages && pages[pages.length - 1];
  if (!page || typeof page.selectComponent !== 'function') return null;
  const host = page.selectComponent('#cy-toast');
  return host && typeof host.show === 'function' ? host : null;
}

function show(title, options) {
  const opts = options || {};
  // 空文案不弹:原生 showToast 会弹一个空白框,这是历史上「toast 一闪没内容」的来源
  if (title == null || String(title).trim() === '') return false;
  // codemod 从 wx.showToast 搬过来的调用点会把原 icon 表达式透传成 opts.icon(可能是三元),这里统一折成 kind
  const kind = opts.kind || (opts.icon === 'success' ? 'success' : (opts.icon === 'error' ? 'error' : 'info'));
  // safeUserMessage 是给「可能是后端异常原文」的失败文案用的(过滤 Java 栈/SQL/URL/手机号/超 60 字);
  // 成功提示是我们自己写的字面量,不该被它兜底成「操作失败」
  const text = kind === 'success' ? String(title) : safeUserMessage(title, opts.fallback || '操作失败');
  if (!text) return false;
  const host = hostToast();
  if (host) {
    host.show({ title: text, kind: kind, duration: opts.duration });
    return true;
  }
  // 回落:唯一的原生 toast 调用点
  wx.showToast({
    title: text,
    icon: kind === 'success' ? 'success' : 'none',
    duration: opts.duration || 2000,
    mask: !!opts.mask,
  });
  return false;
}

function toast(title, options) { return show(title, options); }
toast.success = function (title, options) { return show(title, Object.assign({}, options, { kind: 'success' })); };
toast.error = function (title, options) { return show(title, Object.assign({}, options, { kind: 'error' })); };
toast.show = show;
// 主动收起(上传/长任务完成时用)。宿主没有就收原生的 —— 与 show 的回落对称
toast.hide = function () {
  const host = hostToast();
  if (host && typeof host.hide === 'function') { host.hide(); return true; }
  wx.hideToast();
  return false;
};

module.exports = toast;
