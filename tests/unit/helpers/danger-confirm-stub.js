'use strict';

/**
 * cy-danger-confirm 的单测替身。
 *
 * 危险动作在 2026-08-27 从 wx.showModal 换成了 <cy-danger-confirm>(三段式:确认 → 执行 → 结果卡),
 * 原来靠 `modals[0].success({ confirm: true })` 驱动确认的用例需要一个等价的钩子。
 * 这个替身把「用户点了危险键 / 点了取消 / 点了更轻替代」还原成三个可调用的方法,
 * 所以合同断言的意思一字不变:**没确认就不许发请求**。
 *
 * 用法:
 *   const { attachDangerConfirm } = require('./helpers/danger-confirm-stub');
 *   const page = makePage();
 *   const dc = attachDangerConfirm(page, { confirmHandler: 'onConfirmWithdrawApplication' });
 *   page.withdrawChapterApplication(evt);
 *   assert.equal(dc.opens.length, 1);        // 弹了确认
 *   assert.equal(requests.length, 0);        // 确认前不发请求
 *   dc.cancel();                             // 用户取消
 *   assert.equal(requests.length, 0);        // 仍然不发
 *   dc.confirm();                            // 用户确认 → 页面才发请求
 *
 * ⚠ 替身的 open() 会真的走 utils/danger-actions.js 取文案,key 没登记就抛 —— 这样
 *   「页面传了个不存在的 key」不会在单测里假绿。
 */
const { getDangerAction } = require('../../../utils/danger-actions.js');

function attachDangerConfirm(page, options) {
  const opts = typeof options === 'string' ? { id: options } : (options || {});
  const tagId = opts.id || '#dc';
  // 每个危险动作有自己的确认回调名(不做统一 onDangerConfirm 派发,见 build-action-ledger 的理由),
  // 所以替身要知道该调哪个方法。
  const confirmHandler = opts.confirmHandler || 'onDangerConfirm';
  const altHandler = opts.altHandler || 'onDangerAlt';
  const cancelHandler = opts.cancelHandler || 'onDangerCancel';
  const stub = {
    opens: [],        // [{ key, params, action }] 每次弹确认的记录
    busyCount: 0,     // busyOn() 被调用次数(执行中锁死)
    doneCalls: [],    // done(text) 的实参
    failedCalls: [],  // failed(text) 的实参
    closed: 0,

    open(key, params, opts) {
      const action = getDangerAction(key, params);
      if (!action) throw new Error('危险动作 key 未在 utils/danger-actions.js 登记: ' + key);
      if (opts && opts.hideAlt) action.alt = null;
      stub.opens.push({ key, params: params || {}, action });
      return true;
    },
    busyOn() { stub.busyCount += 1; },
    done(text) { stub.doneCalls.push(text); },
    failed(text) { stub.failedCalls.push(text); },
    close() { stub.closed += 1; },

    /** 模拟用户点了危险键(默认针对最后一次弹出的确认)。 */
    confirm(index) {
      const at = stub.opens[index === undefined ? stub.opens.length - 1 : index];
      if (!at) throw new Error('还没有弹出过确认弹窗,confirm() 无从谈起');
      page[confirmHandler]({ detail: { key: at.key, params: at.params } });
    },
    /** 模拟用户点了取消:页面不应该发出任何请求。 */
    cancel(index) {
      const at = stub.opens[index === undefined ? stub.opens.length - 1 : index];
      if (!at) throw new Error('还没有弹出过确认弹窗,cancel() 无从谈起');
      if (typeof page[cancelHandler] === 'function') {
        page[cancelHandler]({ detail: { key: at.key } });
      }
      // 页面没有 cancel 回调是正常的 —— 取消就是什么都不做。
    },
    /** 模拟用户选了更轻的替代方案。 */
    alt(index) {
      const at = stub.opens[index === undefined ? stub.opens.length - 1 : index];
      if (!at) throw new Error('还没有弹出过确认弹窗,alt() 无从谈起');
      page[altHandler]({ detail: { key: at.key, params: at.params } });
    },
  };

  const prev = page.selectComponent;
  page.selectComponent = function (selector) {
    if (selector === tagId) return stub;
    return typeof prev === 'function' ? prev.call(page, selector) : null;
  };
  return stub;
}

module.exports = { attachDangerConfirm };
