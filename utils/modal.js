'use strict';
// utils/modal.js —— 命令式确认弹窗的唯一出口(替代 wx.showModal,2026-09-06 原生弹层全删批次)
//
// 调用:modal.show({ title, content, confirmText, cancelText, showCancel, editable, placeholderText, danger, success, fail, complete })
// 参数与回调形状和 wx.showModal 完全一致(success 收 {confirm, cancel, content}),所以调用点只换名字。
// 额外可选字段 validate(content) → '' | '错误文案':校验不过时不结算,把文案回给用户重填。
// 渲染:栈顶页里的 <cy-modal-host id="cy-modal-host" />。没有宿主(历史页/单测沙箱)时回落到 wx.showModal ——
// 这是全仓允许出现 wx.showModal 的唯一位置(no-system-toast 契约钉住)。
const { getDangerAction } = require('./danger-actions.js');

// 全仓唯一的 wx.showModal 调用形态(validate 重开也走这里)
function openNative(opts) { wx.showModal(opts); }

function hostModal() {
  if (typeof getCurrentPages !== 'function') return null;
  const pages = getCurrentPages();
  const page = pages && pages[pages.length - 1];
  if (!page || typeof page.selectComponent !== 'function') return null;
  const host = page.selectComponent('#cy-modal-host');
  return host && typeof host.open === 'function' ? host : null;
}

function show(options) {
  const opts = options || {};
  const host = hostModal();
  if (host) { host.open(opts); return true; }
  // 回落:唯一的原生 showModal 调用点。已登记危险写(dangerKey)在无宿主时也要有像样的文案,
  // 从 danger-actions 取 title/content/confirmText,后果清单压成正文。
  let native = opts;
  if (opts.dangerKey) {
    const action = getDangerAction(opts.dangerKey, opts.dangerParams || {});
    if (action) {
      const consequences = (action.consequences || []).map(function (c) { return c.text; }).join('\n');
      native = Object.assign({}, opts, {
        title: action.title,
        content: [action.content, consequences].filter(Boolean).join('\n'),
        confirmText: action.confirmText,
        cancelText: opts.cancelText || '取消',
      });
    }
  }
  // validate:无宿主时原生弹窗也认这个字段 —— 校验不过就用同一份参数重开,把文案顶在正文里。
  // (原生弹窗不能预填输入,只能重打;有宿主时走 modal-host 的原位提示,输入不丢)
  if (typeof opts.validate === 'function') {
    function guarded(res) {
      const tip = res && res.confirm ? String(opts.validate(res.content) || '') : '';
      if (tip) { rerun(tip); return; }
      if (typeof opts.success === 'function') opts.success(res);
    }
    function rerun(tip) {
      // 可编辑弹窗的 content 就是输入框预填值:提示塞进去,用户再点一次确认就把提示当成理由交了。
      // 所以可编辑时提示走 placeholderText、输入框清空重填;不可编辑时才拼进正文。
      const retry = native.editable
        ? { content: '', placeholderText: tip }
        : { content: [native.content, tip].filter(Boolean).join('\n') };
      openNative(Object.assign({}, native, retry, { success: guarded }));
    }
    native = Object.assign({}, native, { success: guarded });
  }
  openNative(native);
  return false;
}

module.exports = { show };
