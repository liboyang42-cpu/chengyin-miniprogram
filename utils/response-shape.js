'use strict';

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRecordList(value) {
  return Array.isArray(value) && value.every(isRecord);
}

/**
 * 这次请求业务上到底成没成。
 *
 * ⚠️ 为什么需要它:统一请求层对 **HTTP 200 + 业务 code != 200** 仍然走 `success()`
 * (utils/transport/request-client.js:136-140)。也就是说 `success()` 被调用
 * **不等于**这件事做成了 —— 后端 `AjaxResult.error(...)` 也是 HTTP 200。
 * 调用方在 success 里直接改本地状态 / 弹「已完成」,就会给出假回执。
 *
 * code 有字符串和数字两种形态(后端不同路径构造方式不同),两种都认。
 */
function isBizOk(res) {
  return !!(res && (res.code === 200 || res.code === '200'));
}

/**
 * 错误文案能不能用后端 msg —— 只有**业务失败**(code != 200)才行。
 *
 * ⚠️ HTTP 200 + code 200 的成功体,msg 是「操作成功」(RuoYi AjaxResult.success() 默认值);
 * 数据形状校验失败时把它当错误原因,页面就会显示「xx失败 · 操作成功」或「结算数据暂不可用 · 操作成功」
 * (2026-09-17 用户拍板修 settlement 时实证)。code=200 但校验不过时一律用场景兜底文案。
 */
function bizFailureMessage(res, fallback) {
  var fixed = fallback || '数据暂时不可用，请稍后重试';
  if (isBizOk(res)) return fixed;
  return (res && res.msg) || fixed;
}

module.exports = { isRecord: isRecord, isRecordList: isRecordList, isBizOk: isBizOk, bizFailureMessage: bizFailureMessage };
