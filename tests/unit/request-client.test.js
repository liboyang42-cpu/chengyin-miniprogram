// Phase 1.3 请求通道 request-client —— 先写失败测试(TDD RED)。
//
// 目标:把 app.js sendRequest 的全部行为抽进纯模块,行为零变,并增加一项能力——
// 认证头自动注入,使页面不必再手拼 'Authorization': app.getAuthorization()。
//
// 不可破坏契约(摘自 current-api-inventory.md):
//  - 基础 URL:默认 globalData.siteBaseUrl + param.url;customSiteUrl 覆盖。
//  - 认证模型(行为兼容旧页面):
//      · GET 且无 param.header → 默认自动 Authorization；公共接口必须显式 auth:false。
//      · POST 且无 param.header → urlencoded + 自动 Authorization;param.auth===false 时不带 Authorization。
//      · 提供了 param.header → 自动补 Authorization(除非已显式带或 param.auth===false);
//        页面原有的 content-type 保留。页面已显式带 Authorization 时不覆盖(旧形态零变)。
//  - HTTP 401、业务 code==401 或历史 code==2 → 静默重登并重试一次(内部 state 重试守卫防死循环,不污染 param)。
//  - 重登失败 → 调 param.fail(res.data, statusCode)(无则 toast 登录过期)。
//  - statusCode 非 200(且非可重试 401)→ successStatusAbnormal 回调或失败 toast。
//  - 业务错误 toast 归一(shouldAutoToast)+ success(body)。
//  - 网络 fail → param.fail(failData)。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRequestClient } = require('../../utils/transport/request-client.js');

function makeClient(over) {
  const calls = [];
  const toasts = [];
  let auth = 'TOK';
  const deps = {
    wxRequest: (opts) => { calls.push(opts); },          // 测试手动驱动 opts.success/fail/complete
    getBaseUrl: () => 'https://base',
    getAuthorization: () => auth,
    reLogin: (cb) => { cb(true); },                        // 默认重登成功
    showToast: (m) => { toasts.push(m); },
    hideToast: () => {},
    // 与 app.js getRequestErrorMessage 的 normalize 逻辑保持一致(至少复刻鉴权失败这一支),
    // 否则本文件对"后端原文不得透传"的负控测的是一个从没启用过滤的假实现,毫无意义。
    getErrorMessage: (res, fb) => {
      const msg = res && res.msg;
      if (!msg) return fb;
      if (msg.indexOf('认证失败') >= 0 || msg.indexOf('无法访问系统资源') >= 0) {
        return '登录已过期，请重新进入';
      }
      return msg;
    },
    shouldAutoToast: (param, body) =>
      !(param && param.silentError) && !!(body && body.code && body.code != 200),
  };
  const client = createRequestClient(Object.assign(deps, over));
  return { client, calls, toasts, setAuth: (v) => { auth = v; } };
}

test('GET 无 header:私有请求默认注入 Authorization', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/official/my-events', method: 'GET' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://base/api/official/my-events');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].header['content-type'], 'application/json');
  assert.equal(calls[0].header.Authorization, 'TOK');
});

test('所有请求有产品级默认 timeout，调用方短 timeout 可覆盖', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/a', method: 'GET' });
  client.send({ url: '/api/b', method: 'POST', timeout: 2345 });
  assert.equal(calls[0].timeout, 12000);
  assert.equal(calls[1].timeout, 2345);
});

test('GET 无 header 且 auth=false:公共请求不注入 Authorization', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/topic/list', method: 'GET', auth: false });
  assert.equal(calls[0].header.Authorization, undefined);
});

test('POST 无 header:urlencoded + 自动注入 Authorization', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/x', method: 'POST', data: { a: 1 } });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].header['content-type'], 'application/x-www-form-urlencoded;');
  assert.equal(calls[0].header.Authorization, 'TOK');
});

test('POST 无 header 且 auth=false:公共接口不注入 Authorization', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/activity/list', method: 'POST', auth: false, data: { pageNum: 1 } });
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].header['content-type'], 'application/x-www-form-urlencoded;');
  assert.equal(calls[0].header.Authorization, undefined);
});

test('提供 header 但无 Authorization(迁移后形态):自动注入,保留 content-type', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/x', method: 'POST', header: { 'Content-Type': 'application/json' } });
  assert.equal(calls[0].header['Content-Type'], 'application/json');
  assert.equal(calls[0].header.Authorization, 'TOK');
});

test('页面已显式带 Authorization:不覆盖(旧形态零变)', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/x', method: 'POST', header: { 'Content-Type': 'application/json', 'Authorization': 'PAGE_TOKEN' } });
  assert.equal(calls[0].header.Authorization, 'PAGE_TOKEN');
});

test('param.auth===false:即使有 header 也不注入', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/x', method: 'POST', header: { 'Content-Type': 'application/json' }, auth: false });
  assert.equal(calls[0].header.Authorization, undefined);
});

test('customSiteUrl 覆盖默认基础 URL', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/x', method: 'GET' }, 'https://other');
  assert.equal(calls[0].url, 'https://other/api/x');
});

test('成功 200:success(body) 被调用', () => {
  const { client, calls } = makeClient();
  let got;
  client.send({ url: '/api/x', method: 'GET', success: (b) => { got = b; } });
  calls[0].success({ statusCode: 200, data: { code: 200, data: { v: 1 } } });
  assert.deepEqual(got, { code: 200, data: { v: 1 } });
});

test('业务错误 code!=200:自动 toast + 仍回调 success(body)', () => {
  const { client, calls, toasts } = makeClient();
  let got;
  client.send({ url: '/api/x', method: 'GET', success: (b) => { got = b; } });
  calls[0].success({ statusCode: 200, data: { code: 500, msg: '操作失败' } });
  assert.deepEqual(toasts, ['操作失败']);
  assert.equal(got.code, 500);
});

test('silentError:业务错误不 toast', () => {
  const { client, calls, toasts } = makeClient();
  client.send({ url: '/api/x', method: 'GET', silentError: true, success: () => {} });
  calls[0].success({ statusCode: 200, data: { code: 500, msg: 'x' } });
  assert.equal(toasts.length, 0);
});

test('401 → 重登成功 → 用新 token 重试一次', () => {
  const { client, calls, setAuth } = makeClient({
    reLogin: (cb) => { setAuth('NEWTOK'); cb(true); },
  });
  let got;
  client.send({ url: '/api/x', method: 'POST', success: (b) => { got = b; } });
  assert.equal(calls.length, 1);
  calls[0].success({ statusCode: 401, data: {} });   // 触发重登 + 重试
  assert.equal(calls.length, 2, '应重试一次');
  assert.equal(calls[1].header.Authorization, 'NEWTOK', '重试用新 token');
  calls[1].success({ statusCode: 200, data: { code: 200 } });
  assert.equal(got.code, 200);
});

test('业务 code==401 同样触发重登重试', () => {
  const { client, calls, setAuth } = makeClient({
    reLogin: (cb) => { setAuth('NEWTOK'); cb(true); },
  });
  client.send({ url: '/api/x', method: 'POST', success: () => {} });
  calls[0].success({ statusCode: 200, data: { code: 401, msg: '认证失败，无法访问系统资源' } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].header.Authorization, 'NEWTOK');
});

test('业务 code==2 同样触发重登重试', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/x', method: 'GET', success: () => {} });
  calls[0].success({ statusCode: 200, data: { code: 2 } });
  assert.equal(calls.length, 2);
});

test('重登失败 → 调 param.fail(res.data),不死循环', () => {
  const { client, calls } = makeClient({ reLogin: (cb) => cb(false) });
  let failData, failStatus;
  client.send({ url: '/api/x', method: 'POST', fail: (d, status) => { failData = d; failStatus = status; } });
  calls[0].success({ statusCode: 401, data: { code: 401, msg: '过期' } });
  assert.equal(calls.length, 1, '重登失败不重试');
  assert.deepEqual(failData, { code: 401, msg: '过期' });
  assert.equal(failStatus, 401, '即使 body 为空，调用方也必须知道这是 HTTP 401');
});

test('重登失败且 401 body 为空时，fail 仍保留 HTTP status', () => {
  const { client, calls } = makeClient({ reLogin: (cb) => cb(false) });
  let failData, failStatus;
  client.send({ url: '/api/x', method: 'POST', fail: (d, status) => { failData = d; failStatus = status; } });
  calls[0].success({ statusCode: 401, data: {} });
  assert.deepEqual(failData, {});
  assert.equal(failStatus, 401);
});

test('HTTP 200 业务鉴权码重登失败时，fail 第二参数保留 401/2 语义', () => {
  for (const businessCode of [401, 2]) {
    const { client, calls } = makeClient({ reLogin: (cb) => cb(false) });
    let failStatus;
    client.send({ url: '/api/x', method: 'POST', fail: (_data, status) => { failStatus = status; } });
    calls[0].success({ statusCode: 200, data: { code: businessCode } });
    assert.equal(failStatus, businessCode,
      `业务 code=${businessCode} 不得被外层 HTTP 200 覆盖`);
  }
});

test('重试后仍 401:不再无限重试', () => {
  const { client, calls } = makeClient();
  client.send({ url: '/api/x', method: 'POST', success: () => {} });
  calls[0].success({ statusCode: 401, data: {} });   // 第一次:重登+重试
  assert.equal(calls.length, 2);
  calls[1].success({ statusCode: 401, data: {} });   // 第二次仍 401:_retried 已置,不再重登
  assert.equal(calls.length, 2, '不应有第三次请求');
});

// 重登后仍 401,落到「statusCode 非 200」分支,把 Spring Security 的原始报文
// 直接 toast 给终端用户(含内部接口路径)。真实报文取自生产:
//   HTTP 401 {"msg":"请求访问：/api/merchant/subscription，认证失败，无法访问系统资源","code":401}
const PROD_401 = {
  statusCode: 401,
  data: { code: 401, msg: '请求访问：/api/merchant/subscription，认证失败，无法访问系统资源' },
};

test('重登后仍 401:不得把后端原始报文/接口路径 toast 给用户', () => {
  const { client, calls, toasts } = makeClient();
  client.send({ url: '/api/merchant/subscription', method: 'POST', success: () => {} });
  calls[0].success(PROD_401);
  calls[1].success(PROD_401);
  const leaked = toasts.filter((t) => /请求访问|无法访问系统资源|\/api\//.test(t));
  assert.deepEqual(leaked, [], '不应泄露后端原文,实际 toast:' + JSON.stringify(toasts));
});

test('重登后仍 401 的背景请求(silentError):不弹任何 toast', () => {
  const { client, calls, toasts } = makeClient();
  client.send({ url: '/api/merchant/subscription', method: 'POST', silentError: true, success: () => {} });
  calls[0].success(PROD_401);
  calls[1].success(PROD_401);
  assert.deepEqual(toasts, [], '声明静默的请求不应弹 toast');
});

test('statusCode 非 200(非401):successStatusAbnormal 回调', () => {
  const { client, calls } = makeClient();
  let abn;
  client.send({ url: '/api/x', method: 'GET', successStatusAbnormal: (d) => { abn = d; } });
  calls[0].success({ statusCode: 500, data: { msg: '服务器错误' } });
  assert.deepEqual(abn, { msg: '服务器错误' });
});

test('statusCode 非 200 且未挂 successStatusAbnormal:回落到 fail(不再掉黑洞)', () => {
  // 回归 2026-08-01:原先这里只 toast 就 return,success/fail 都不触发。全仓 137 处
  // sendRequest 是「挂了 fail、没挂 successStatusAbnormal」的形态,其中 baoming.js
  // 补报价那处因此把 isPaying 永久锁死(已 setData isPaying:true + showLoading,
  // 而 handlePayment() 再也不会被调用)。
  const { client, calls, toasts } = makeClient();
  let failed, failedStatus, succeeded;
  client.send({
    url: '/api/x', method: 'GET',
    success: (d) => { succeeded = d; },
    fail: (d, status) => { failed = d; failedStatus = status; },
  });
  calls[0].success({ statusCode: 500, data: { msg: '服务器错误' } });
  assert.deepEqual(failed, { msg: '服务器错误' }, 'fail 必须收到 5xx,否则调用方的提交锁永不复位');
  assert.equal(failedStatus, 500, 'HTTP fallback 不得丢失 statusCode');
  assert.equal(succeeded, undefined, '5xx 不能当成功');
  assert.deepEqual(toasts, [], '已交给 fail 处理,不该再重复弹 toast');
});

test('挂了 successStatusAbnormal 时仍走它,不回落 fail(既有契约不变)', () => {
  const { client, calls } = makeClient();
  let abn, failed;
  client.send({
    url: '/api/x', method: 'GET',
    successStatusAbnormal: (d) => { abn = d; },
    fail: (d) => { failed = d; },
  });
  calls[0].success({ statusCode: 500, data: { msg: 'boom' } });
  assert.deepEqual(abn, { msg: 'boom' });
  assert.equal(failed, undefined, '两个出口不能同时触发');
});

test('statusCode 非 200 无回调时不向用户透传内部 API 路径', () => {
  const { client, calls, toasts } = makeClient({
    getErrorMessage: (res, fb) => {
      const msg = res && res.msg;
      if (msg && (msg.includes('请求访问') || msg.includes('/api/'))) return '登录已过期，请重新进入';
      return msg || fb;
    },
  });
  client.send({ url: '/api/x', method: 'GET' });
  calls[0].success({
    statusCode: 502,
    data: { msg: '请求访问：/api/user/points/statistics，认证失败，无法访问系统资源' },
  });
  assert.deepEqual(toasts, ['登录已过期，请重新进入']);
  assert.equal(toasts[0].includes('/api/'), false);
  assert.equal(toasts[0].includes('请求访问'), false);
});

test('网络 fail:调 param.fail(failData)', () => {
  const { client, calls } = makeClient();
  let failData;
  client.send({ url: '/api/x', method: 'GET', fail: (d) => { failData = d; } });
  calls[0].fail({ errMsg: 'request:fail timeout' });
  assert.deepEqual(failData, { errMsg: '请求超时，请稍后重试' });
});

test('complete 透传 res.data', () => {
  const { client, calls } = makeClient();
  let done;
  client.send({ url: '/api/x', method: 'GET', complete: (d) => { done = d; } });
  calls[0].complete({ statusCode: 200, data: { code: 200 } });
  assert.deepEqual(done, { code: 200 });
});

// —— A2-1 / A2-3 回归:401 静默重登期间 complete 语义与 _retried 隔离 ——

test('A2-1 401 重登成功:param.complete 只触发一次(最终响应),不带 401 body', () => {
  const { client, calls, setAuth } = makeClient({ reLogin: (cb) => { setAuth('NEWTOK'); cb(true); } });
  const completes = [];
  client.send({ url: '/api/x', method: 'POST', complete: (d) => completes.push(d) });
  // 真机:原请求 success 后 complete 必触发一次
  calls[0].success({ statusCode: 401, data: { code: 401 } });
  calls[0].complete({ statusCode: 401, data: { code: 401 } });
  assert.equal(calls.length, 2, '应重试一次');
  // 重试请求 200,同样 success→complete
  calls[1].success({ statusCode: 200, data: { code: 200, ok: 1 } });
  calls[1].complete({ statusCode: 200, data: { code: 200, ok: 1 } });
  assert.equal(completes.length, 1, 'complete 只应触发一次');
  assert.equal(completes[0].code, 200, 'complete 应带最终 200 响应,而非 401 body');
});

test('A2-3 401 重登失败(异步):complete 不早于 fail,且各一次', () => {
  let reloginCb = null;
  const { client, calls } = makeClient({ reLogin: (cb) => { reloginCb = cb; } }); // 异步:先不回调
  const events = [];
  client.send({ url: '/api/x', method: 'POST', fail: () => events.push('fail'), complete: () => events.push('complete') });
  calls[0].success({ statusCode: 401, data: { code: 401 } });
  calls[0].complete({ statusCode: 401, data: { code: 401 } }); // 真机 complete 紧跟 success,早于异步重登回调
  assert.deepEqual(events, [], '重登在途时不应过早 fail/complete');
  reloginCb(false); // 重登异步失败
  assert.deepEqual(events, ['fail', 'complete'], 'fail 应先于 complete,各一次');
});

test('A2-3 _retried 不污染 param:复用同一 param 二次请求仍能各自重登', () => {
  const { client, calls, setAuth } = makeClient({ reLogin: (cb) => { setAuth('NEWTOK'); cb(true); } });
  const param = { url: '/api/x', method: 'POST', success: () => {} };
  client.send(param);
  calls[0].success({ statusCode: 401, data: {} });      // 第一次:重登+重试
  assert.equal(calls.length, 2);
  calls[1].success({ statusCode: 200, data: { code: 200 } });
  client.send(param);                                   // 复用同一 param 再请求
  assert.equal(calls.length, 3);
  calls[2].success({ statusCode: 401, data: {} });      // 仍应能重登+重试
  assert.equal(calls.length, 4, '复用 param 的二次请求仍应能重登重试');
});

// —— Phase 3 漫游 NPC Chat:请求可被页面生命周期取消，取消后的迟到回调绝不能落 UI ——

test('abort 转发给当前 RequestTask，迟到 success/fail/complete 不再触达调用方', () => {
  const calls = [];
  let aborts = 0;
  const task = { abort: () => { aborts++; } };
  const client = createRequestClient({
    wxRequest: (opts) => { calls.push(opts); return task; },
    getBaseUrl: () => 'https://base',
  });
  const events = [];

  const control = client.send({
    url: '/api/ai/npc/chat', method: 'POST',
    success: () => events.push('success'), fail: () => events.push('fail'), complete: () => events.push('complete'),
  });
  control.abort();
  calls[0].success({ statusCode: 200, data: { code: 200 } });
  calls[0].fail({ errMsg: 'request:fail abort' });
  calls[0].complete({ statusCode: 200, data: { code: 200 } });

  assert.equal(aborts, 1);
  assert.deepEqual(events, [], 'abort 后的迟到回调必须被 transport 隔离');
});

test('abort 在异步重登期间阻止重试，避免离开页面后又发出一条旧请求', () => {
  const calls = [];
  let reLoginCb;
  const task = { abort: () => {} };
  const client = createRequestClient({
    wxRequest: (opts) => { calls.push(opts); return task; },
    getBaseUrl: () => 'https://base',
    reLogin: (cb) => { reLoginCb = cb; },
  });

  const control = client.send({ url: '/api/ai/npc/chat', method: 'POST', success: () => {} });
  calls[0].success({ statusCode: 401, data: { code: 401 } });
  control.abort();
  reLoginCb(true);

  assert.equal(calls.length, 1, '取消后重登回调不可重试旧请求');
});

test('retry 只对传输层失败生效,重试期间不重复触发 complete', () => {
  const calls = [];
  const timers = [];
  const client = createRequestClient({
    getBaseUrl: () => 'https://x',
    scheduleRetry: (fn) => timers.push(fn),
    wxRequest: (opts) => {
      calls.push(opts.url);
      opts.fail({ errMsg: 'request:fail timeout' });
      opts.complete({});
      return { abort() {} };
    },
  });

  let failed = 0;
  let completed = 0;
  client.send({ url: '/api/x', retry: 2, fail: () => { failed++; }, complete: () => { completed++; } });
  assert.equal(calls.length, 1);
  assert.equal(failed, 0, '还有重试机会时不许先把失败报给调用方');
  assert.equal(completed, 0, '重试期间 complete 不许触发');

  timers.shift()();
  timers.shift()();
  assert.equal(calls.length, 3, '一共三跳:首发 + 两次重试');
  assert.equal(failed, 1, '重试用尽才报失败,且只报一次');
  assert.equal(completed, 1, 'complete 只在最后一跳触发一次');
});

test('传输层重试逐次退避，不在网络抖动时固定 400ms 密集重发', () => {
  const calls = [];
  const timers = [];
  const client = createRequestClient({
    getBaseUrl: () => 'https://x',
    scheduleRetry: (fn, ms) => timers.push({ fn, ms }),
    wxRequest: (opts) => {
      calls.push(opts);
      return { abort() {} };
    },
  });

  client.send({ url: '/api/x', retry: 2, fail: () => {} });
  calls[0].fail({ errMsg: 'request:fail timeout' });
  assert.equal(timers[0].ms, 400);
  timers[0].fn();
  calls[1].fail({ errMsg: 'request:fail timeout' });
  assert.equal(timers[1].ms, 800);
});

test('负控:业务错误(code!=200)不走重试,免得把同一个错误问三遍', () => {
  const calls = [];
  const client = createRequestClient({
    getBaseUrl: () => 'https://x',
    scheduleRetry: (fn) => fn(),
    wxRequest: (opts) => {
      calls.push(opts.url);
      opts.success({ statusCode: 200, data: { code: '500', msg: '库存不足' } });
      return { abort() {} };
    },
  });

  // 业务失败(HTTP 200 + code!=200)本来就走 success,由调用方自己判 code ——
  // 关键是它一次都不该重试:重试只会把「库存不足」这种确定性结论再问两遍。
  let succeeded = 0;
  client.send({ url: '/api/y', retry: 2, success: () => { succeeded++; } });
  assert.equal(calls.length, 1, '业务失败只发一次');
  assert.equal(succeeded, 1);
});

test('绑定手机成功:走真实 sendRequest 后 11 位号仍在 data/msg,不得改成操作失败', () => {
  const { client, calls } = makeClient();
  let got;
  client.send({
    url: '/api/getwxbindphone',
    method: 'POST',
    success: (b) => { got = b; },
  });
  calls[0].success({
    statusCode: 200,
    data: { code: 200, msg: '13800000000', data: '13800000000' },
  });
  assert.equal(got.msg, '13800000000');
  assert.equal(got.data, '13800000000');
});

test('绑定手机成功:号码只在 data 时,消毒器不得改写 data', () => {
  const { client, calls } = makeClient();
  let got;
  client.send({
    url: '/api/getwxbindphone',
    method: 'POST',
    success: (b) => { got = b; },
  });
  calls[0].success({
    statusCode: 200,
    data: { code: 200, msg: '操作成功', data: '13800000000' },
  });
  assert.equal(got.msg, '操作成功');
  assert.equal(got.data, '13800000000');
});

test('失败体里的 11 位号仍消毒,不能当业务文案透出', () => {
  const { client, calls } = makeClient();
  let got;
  client.send({
    url: '/api/x',
    method: 'GET',
    silentError: true,
    success: (b) => { got = b; },
  });
  calls[0].success({
    statusCode: 200,
    data: { code: 500, msg: '13800000000' },
  });
  assert.equal(got.msg, '操作失败');
});
