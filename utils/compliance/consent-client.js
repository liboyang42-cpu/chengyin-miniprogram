function createConsentClient(options) {
  const sendRequest = options && options.sendRequest;
  const now = (options && options.now) || Date.now;
  const random = (options && options.random) || function () {
    return Math.random().toString(36).slice(2, 10);
  };
  // 兜底截止:本 Promise 只在 success/fail 回调时 settle,而 sendRequest 走的是通用请求通道 ——
  // 撞上隐私授权闸时那两个回调一个都不会来(见 app.js openPrivacyAuthorizationPage 的注释:
  // 系统返回退页时没有任何 resolve 被调用 ⇒ 后续接口静默挂起),于是 Promise 永不 settle。
  // 全站 8 个 recordConsent 调用方里 6 个把关键 UX 挂在它 resolve 上(privacy-gate 挂了整个 app
  // 进不去、deregister 申请永不发出、漫游点了「同意并出发」连定位弹窗都不出来),所以兜底放在
  // 这一处,而不是让每个调用方各自设防。超时按 reject 走:调用方的 .catch 已有「请检查网络后重试」
  // 提示,而 resolve 会谎称同意已落库 —— 合规记录上那比卡住更坏。
  const settleTimeoutMs = (options && options.settleTimeoutMs) || 10000;

  function record(input) {
    const docType = input && input.docType;
    const scene = input && input.scene;
    const eventType = input && input.eventType;
    if (!docType || !scene || (eventType !== 'AGREE' && eventType !== 'REVOKE')) {
      return Promise.reject(new Error('同意事件不合法'));
    }
    const requestId = 'consent-' + now() + '-' + random();
    return new Promise(function (resolve, reject) {
      let settled = false;
      const settle = function (fn, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(function () {
        settle(reject, new Error('同意记录超时'));
      }, settleTimeoutMs);
      sendRequest({
        // 后端 /api/compliance/consents 是 @RequestBody 端点,必须发 JSON;缺 header 会被当 urlencoded,
        // 后端抛 HttpMediaTypeNotSupportedException 被全局兜成 200+code500,同意记录静默不落库
        url: '/api/compliance/consents',
        method: 'POST',
        data: JSON.stringify({ docType: docType, scene: scene, eventType: eventType, requestId: requestId }),
        header: { 'Content-Type': 'application/json' },
        hideLoading: true,
        autoErrorToast: false,
        success: function (res) {
          if (res && (res.code === 200 || res.code === '200')) {
            settle(resolve, { requestId: requestId, response: res });
            return;
          }
          settle(reject, new Error((res && res.msg) || '同意记录失败'));
        },
        fail: function () {
          settle(reject, new Error('同意记录失败'));
        },
      });
    });
  }

  return { record: record };
}

module.exports = { createConsentClient: createConsentClient };
