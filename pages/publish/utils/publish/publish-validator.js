// Phase 3.1 发布校验共享原语(纯函数)。
//
// 抽取 publish/activity 与 publish/fabu 共享的校验积累机制与共有规则:
//  - createErrorBag:errors 映射(供 wxml 字段内联回显)+ order(供聚焦首个错误)。两页原各自手搓。
//  - nonEmpty:空值/占位哨兵('开始时间'/'开始日期'…)判空。
// 不含页面专有规则(templateId/chapters/stock/price/mode/票务文案与逐票交错顺序),也不 setData/不发网络
// —— 票务名称等与页面专有规则交错的校验、文案、聚焦 UX 仍由各页用 bag.require 自行编排,保持顺序零变。

function createErrorBag() {
  var errors = {};   // key → 字段内联文案(供 wxml 回显)
  var order = [];    // 出现顺序(供聚焦首个错误)
  var messages = []; // 面向 toast 的有序文案,可与字段文案不同(如 fabu 票务"第N个"前缀);省略时回退字段文案
  function add(key, message, toastMessage) {
    errors[key] = message;
    order.push(key);
    messages.push(toastMessage === undefined ? message : toastMessage);
  }
  return {
    errors: errors,
    order: order,
    messages: messages,
    add: add,
    // 条件不满足时记一条错误(key→message),并保留出现顺序;toastMessage 可选。
    require: function (cond, key, message, toastMessage) {
      if (!cond) add(key, message, toastMessage);
      return this;
    },
    firstKey: function () { return order[0]; },
    firstMessage: function () { return messages[0]; },
    isValid: function () { return order.length === 0; },
  };
}

// 非空判定:空串/null/undefined 为空;给定 sentinel 时,等于占位文案也算空。0/false 视为有效值。
function nonEmpty(value, sentinel) {
  if (value === '' || value === null || value === undefined) return false;
  if (sentinel !== undefined && value === sentinel) return false;
  return true;
}

module.exports = {
  createErrorBag: createErrorBag,
  nonEmpty: nonEmpty,
};
