const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { safeUserMessage, sanitizeResponseMessage } = require('../../utils/transport/safe-user-message.js');

test('string/msg/message/errMsg 全部走同一脱敏规则', () => {
  const dangerous = [
    '<html><body>502 Bad Gateway</body></html>',
    'java.lang.NullPointerException\n at com.chengyin.Api.run(Api.java:42)',
    'at com.acme.Foo.bar',
    'select * from sys_user where mobile = 13800138000',
    'internal endpoint https://admin.example.com/api/user/7',
    'token=eyJhbGciOiJIUzI1NiJ9.secret', // gitleaks:allow -- unusable redaction fixture
    '联系 dev@example.com 处理',
  ];
  for (const raw of dangerous) {
    for (const input of [raw, { msg: raw }, { message: raw }, { errMsg: raw }]) {
      const output = safeUserMessage(input, '操作失败');
      assert.notEqual(output, raw);
      assert.ok(output.length <= 60);
    }
  }
});

test('保留短业务文案，响应对象原地净化使旧页面 res.msg 也安全', () => {
  assert.equal(safeUserMessage({ msg: '库存不足' }, '操作失败'), '库存不足');
  // 开发者口径的业务 msg 不放行:用户看不懂「参数错误」,只需要知道下一步
  for (const raw of ['参数错误', '参数异常', '发布状态参数错误', '订单数据异常', '系统错误', 'UNKNOWN', 'res.errMsg undefined']) {
    assert.equal(safeUserMessage({ msg: raw }, '操作失败'), '操作失败', raw);
  }
  // 带下一步的多句业务文案是给用户看的,不能被吞成通用兜底
  for (const raw of ['票务库存数据异常，请先核对后再调整', '章节数据异常,请稍后重试', '轨迹停靠点数据异常,无法转为路线']) {
    assert.equal(safeUserMessage({ msg: raw }, '操作失败'), raw, raw);
  }
  const body = { code: 500, msg: '<html>secret</html>', data: { id: 1 } };
  sanitizeResponseMessage(body, '操作失败');
  assert.equal(body.msg, '操作失败');
  assert.deepEqual(body.data, { id: 1 });
});

test('微信传输层错误不得把请求类型或接口路径展示给用户', () => {
  const fallback = '网络异常，请稍后重试';
  for (const raw of [
    'request:fail invalid url "/api/merchant/public-home"',
    'request:fail network unavailable',
    'uploadFile:fail socket closed',
    'downloadFile:fail domain not configured',
    'chooseImage:fail authorize no response',
    'chooseMessageFile:fail internal error',
  ]) {
    assert.equal(safeUserMessage({ errMsg: raw }, fallback), fallback);
  }
});

test('身份与会话标识不得作为业务文案原样展示', () => {
  for (const raw of [
    'openid=oABC123456789',
    'unionid: oUNION123456789',
    'cookie=sessionid=abc123456789',
    'session=abc123456789',
  ]) {
    assert.equal(safeUserMessage(raw, '操作失败'), '操作失败', raw);
  }
});

test('图片和文件选择失败不得把微信原始 errMsg 写进弹窗', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  assert.doesNotMatch(appSource, /content:\s*['"]?\s*\+\s*res\.errMsg/);
  assert.match(appSource, /safeUserMessage\(res,\s*'无法选择图片，请稍后重试'\)/);
  assert.match(appSource, /safeUserMessage\(res,\s*'无法选择文件，请稍后重试'\)/);
});

test('登录失败提示同样不得直接展示后端 msg', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  assert.doesNotMatch(appSource, /:\s*\(r\.msg\s*\|\|\s*'登录失败，请稍后重试'\)/);
  assert.match(appSource, /safeUserMessage\(r,\s*'登录失败，请稍后重试'\)/);
});

test('成功体里单独一条 11 位号是绑定手机 payload,不得改成操作失败', () => {
  const body = { code: 200, msg: '13800000000', data: '13800000000' };
  sanitizeResponseMessage(body, '操作失败');
  assert.equal(body.msg, '13800000000');
  assert.equal(body.data, '13800000000');

  const stringCode = { code: '200', msg: '13912345678' };
  sanitizeResponseMessage(stringCode, '操作失败');
  assert.equal(stringCode.msg, '13912345678');

  const nested = { code: 200, msg: '操作成功', data: { phone: '13800001111' } };
  sanitizeResponseMessage(nested, '操作失败');
  assert.equal(nested.data.phone, '13800001111');
});

test('失败体里的 11 位号仍消毒,成功体夹带号码的诊断文案也消毒', () => {
  const failed = { code: 500, msg: '13800000000' };
  sanitizeResponseMessage(failed, '操作失败');
  assert.equal(failed.msg, '操作失败');

  const leak = { code: 200, msg: '联系 13800000000 处理' };
  sanitizeResponseMessage(leak, '操作失败');
  assert.equal(leak.msg, '操作失败');
});
