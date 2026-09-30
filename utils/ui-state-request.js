'use strict';

function sendKnown(app, url, options) {
  return app.sendRequest({
    url,
    method: options.method,
    data: options.data,
    header: options.header,
    hideLoading: true,
    silentError: true,
    retry: options.retry,
    timeout: options.timeout,
    auth: options.auth,
    success: options.success,
    successStatusAbnormal: options.successStatusAbnormal,
    fail: options.fail,
    complete: options.complete,
  });
}

function sendUiStateRequest(app, endpoint, options) {
  if (!app || typeof app.sendRequest !== 'function') {
    throw new TypeError('UI-state request 缺少 app.sendRequest');
  }
  if (!options || typeof options.fail !== 'function') {
    throw new TypeError('UI-state request 必须提供 fail handler');
  }

  // ⚠️ 别把这张表折成 Set + sendKnown(app, endpoint, options)「简化」掉。
  // 每个 case 里重复写一遍字面量,正是 UI-GATE-0 的 U1 能把这 14 条判成「静态路径」
  // 的原因;换成变量后它们会掉进「变量路径」,每条都要单独写豁免理由。
  // 这份重复是承重的,不是坏味。
  switch (endpoint) {
    case '/api/activity/publish': return sendKnown(app, '/api/activity/publish', options);
    case '/api/activity/update': return sendKnown(app, '/api/activity/update', options);
    case '/api/topic/update': return sendKnown(app, '/api/topic/update', options);
    case '/api/topic/create': return sendKnown(app, '/api/topic/create', options);
    case '/api/comment/list': return sendKnown(app, '/api/comment/list', options);
    case '/api/medal/wall': return sendKnown(app, '/api/medal/wall', options);
    case '/api/badge/wall-v2': return sendKnown(app, '/api/badge/wall-v2', options);
    case '/api/coupon/publish': return sendKnown(app, '/api/coupon/publish', options);
    case '/api/user/deregister/status': return sendKnown(app, '/api/user/deregister/status', options);
    case '/api/user/deregister/precheck': return sendKnown(app, '/api/user/deregister/precheck', options);
    case '/api/user/info': return sendKnown(app, '/api/user/info', options);
    case '/api/sms/send': return sendKnown(app, '/api/sms/send', options);
    case '/api/user/deregister/apply': return sendKnown(app, '/api/user/deregister/apply', options);
    case '/api/user/deregister/cancel': return sendKnown(app, '/api/user/deregister/cancel', options);
    default: throw new RangeError('未登记的 UI-state 请求端点: ' + String(endpoint));
  }
}

module.exports = { sendUiStateRequest };
