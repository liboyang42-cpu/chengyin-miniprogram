// 网关错误页不得泄漏到用户界面(2026-07-31 用户截图实证:502 整页 HTML 被弹进 toast)。
// 根因:getRequestErrorMessage 对 string 型响应体,只在命中已知关键词时脱敏,
// 认不出的一律原样透传 —— nginx 的 502 页面一个关键词都不匹配。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeUserMessage: getErrorMessage } = require('../../utils/transport/safe-user-message.js');

const FALLBACK = '服务开小差了，请稍后重试';
const HTML502 = '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>';

test('网关整页 HTML 不得原样透传给用户', () => {
  for (const raw of [HTML502, '<!DOCTYPE html><html><body>504 Gateway Time-out</body></html>']) {
    const out = getErrorMessage(raw, FALLBACK);
    assert.ok(!/<\s*(html|head|body|h1|center|title|!doctype)/i.test(out), '仍含标记语言: ' + out.slice(0, 40));
    assert.notEqual(out, raw, '原样透传了响应体');
    assert.ok(out.length <= 60, 'toast 文案过长: ' + out.length);
  }
});

test('正常的后端短文案必须原样保留(不能被误伤)', () => {
  assert.equal(getErrorMessage('优惠券已被领完', FALLBACK), '优惠券已被领完');
  assert.equal(getErrorMessage('报名人数已满，无法继续', FALLBACK), '报名人数已满，无法继续');
});

test('已知需脱敏的技术细节照旧脱敏', () => {
  assert.equal(getErrorMessage('认证失败，无法访问系统资源', FALLBACK), '登录已过期，请重新进入');
  assert.equal(getErrorMessage('java.lang.ClassCastException: class java.lang.String', FALLBACK), FALLBACK);
});
