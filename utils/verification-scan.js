/**
 * 将扫码内容路由到对应的核销端点。
 *
 * `v1.*` 只用 type 前缀决定调用哪个端点；真实性仍由服务端 HMAC 校验，前端绝不把它当鉴权依据。
 */
function resolveVerificationScan(raw) {
  const code = typeof raw === 'string' ? raw.trim() : '';
  if (!code) return invalid();

  if (code.indexOf('v1.') === 0) {
    const parts = code.split('.');
    const type = parts.length >= 3 ? parts[2] : '';
    if (type.indexOf('group_') === 0) {
      return route('group', code, '/api/verify/groupcode/redeem', '核销中...', '已记录接待该团');
    }
    if (type === 'activity' || type === 'topic') {
      // 类型与报名单归属由 scan_dynamic_code 在服务端验签后决定，不能信任客户端回传。
      return route('dynamic-ticket', code, '/api/registration/scan_dynamic_code', '验票中...', '验票成功');
    }
    if (type.indexOf('citynode_') === 0) {
      // 据点核销的归属/幂等校验在另一个端点,这张共享路由表**不能**收下它(护栏由
      // verification-scan.test.js 钉着)。但商家在这里看到的是「码不行」,而码是好的、
      // 只是入口不对 —— 给一句指路,并带上去哪里的出口。
      return invalid('这是据点核销码，请从「城市据点」页扫码核销', {
        path: '/pages/merchant/citynode/index',
        confirmText: '去据点页',
      });
    }
    return invalid('暂不支持此动态码');
  }

  // 券出示码 cq1.{historyId}.{epochSec}.{sig}：只按前缀和段数路由，真伪由服务端 HMAC 判定。
  if (code.indexOf('cq1.') === 0 && code.split('.').length === 4) {
    return route('coupon', code, '/api/coupon/verification', '核销中...', '核销成功');
  }

  try {
    const scanData = JSON.parse(code);
    if (!scanData || !scanData.type || !scanData.code) return invalid();
    if (scanData.type === 'coupon') {
      return route('coupon', scanData.code, '/api/coupon/verification', '核销中...', '核销成功');
    }
    if (scanData.type === 'activity' || scanData.type === 'topic') {
      return {
        kind: 'legacy-ticket',
        code: scanData.code,
        url: '/api/registration/scan_qr_code',
        data: { type: scanData.type, code: scanData.code },
        loadingTitle: '验票中...',
        successTitle: '验票成功',
      };
    }
  } catch (e) {
    // 非 JSON 的动态码已经在上面的 v1 分支处理；其余格式不进入任何核销端点。
  }
  return invalid();
}

function route(kind, code, url, loadingTitle, successTitle) {
  return { kind, code, url, data: { code }, loadingTitle, successTitle };
}

function invalid(message, extra) {
  return Object.assign({ kind: 'invalid', message: message || '二维码格式错误' }, extra || {});
}

/**
 * 服务端签发的动态核销码有效期(`ApiVerifyController.java:45 DYN_TTL_MS`)。
 * 出码页只在响应漏传 `ttlMs` 时用它兜底 —— 原来两处各写一份(300s / 60s,差 5 倍),
 * 兜底值一旦和真值分叉,表现为「码一直在换」而不是明确的错误。
 */
const DYN_TTL_MS = 300_000;

module.exports = { resolveVerificationScan, DYN_TTL_MS };
