'use strict';

var isValidMobile = require('../form-state.js').isValidMobile;

function extractMessage(input) {
  if (typeof input === 'string') return input;
  if (!input || typeof input !== 'object') return '';
  if (typeof input.msg === 'string') return input.msg;
  if (typeof input.message === 'string') return input.message;
  if (typeof input.errMsg === 'string') return input.errMsg;
  return '';
}

function safeUserMessage(input, fallback) {
  var safeFallback = fallback || '请求失败，请稍后重试';
  var raw = extractMessage(input).trim();
  if (!raw) return safeFallback;
  if (raw.indexOf('认证失败') >= 0 || raw.indexOf('无法访问系统资源') >= 0) {
    return '登录已过期，请重新进入';
  }
  if (/timeout/i.test(raw) && /request|network|gateway|timed?\s*out|超时/i.test(raw)) {
    return '请求超时，请稍后重试';
  }
  if (/Error querying database|SQLSyntaxErrorException|bad SQL grammar|nested exception/i.test(raw)) {
    return '当前数据暂不可用，请稍后重试';
  }
  if (/class java\.|java\.lang\.|\b[A-Za-z]+Exception\b|cannot be cast to|\bat\s+[\w$]+(?:\.[\w$]+)+(?:\([^)]*\))?/i.test(raw)) {
    return '服务开小差了，请稍后重试';
  }
  // 开发者口径的单句业务 msg(「参数错误」「订单数据异常」这种没有下一步的)对用户没有信息量,退回场景兜底;
  // 带下一步的多句业务文案(「票务库存数据异常，请先核对后再调整」)照常放行(审核清单 §6.3)
  if (/^[^，,。;；]*(?:参数错误|参数异常|数据异常|系统错误|系统异常|UNKNOWN|undefined)[^，,。;；]*$/i.test(raw) || /\berrMsg\b/.test(raw)) {
    return safeFallback;
  }
  var unsafe = raw.length > 60
    || /[\r\n\t]/.test(raw)
    // 微信网络 API 的 errMsg 属于诊断信息，不是可展示的业务文案。
    || /^[A-Za-z][\w.]*:fail\b/i.test(raw)
    || /<\s*\/?\s*(!doctype|html|head|body|center|h[1-6]|title|script|style)\b/i.test(raw)
    || /https?:\/\/|\b\/api\/|\b[a-zA-Z]:\\|\/(Users|home|var|etc|opt)\//i.test(raw)
    || /\b(select|insert|update|delete)\b[\s\S]+\b(from|into|set|where)\b/i.test(raw)
    || /\b(bearer|authorization|token|access[_-]?token|refresh[_-]?token|password|secret)\b\s*[:=]/i.test(raw)
    || /\b(openid|unionid|cookie|session(?:id)?|sid)\b\s*[:=]/i.test(raw)
    || /\b(trace|request|span|correlation)[_-]?id\b\s*[:=(=]/i.test(raw)
    || /\b1[3-9]\d{9}\b/.test(raw)
    || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(raw);
  return unsafe ? safeFallback : raw;
}

function isSuccessCode(code) {
  return code == 200 || code == '200';
}

function sanitizeResponseMessage(body, fallback) {
  if (!body || typeof body !== 'object') return body;
  var successPayload = isSuccessCode(body.code);
  ['msg', 'message', 'errMsg'].forEach(function (field) {
    if (typeof body[field] !== 'string') return;
    // 成功体里单独一条 11 位号是绑定手机等接口的 payload,不是诊断泄漏;失败体仍消毒
    if (successPayload && isValidMobile(body[field].trim())) return;
    body[field] = safeUserMessage(body[field], fallback);
  });
  return body;
}

module.exports = {
  safeUserMessage: safeUserMessage,
  sanitizeResponseMessage: sanitizeResponseMessage
};
