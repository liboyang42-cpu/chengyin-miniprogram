// Phase 1.3 统一请求通道。
//
// 把原 app.js sendRequest 的全部行为收口到纯模块,行为零变;唯一增强:认证头自动注入,
// 使页面不再手拼 'Authorization': app.getAuthorization()。认证模型采用安全默认值(见单测):
//   - GET/POST 默认自动 Authorization;公共请求必须显式 param.auth===false。
//   - POST 且无 param.header → urlencoded;其余方法默认 application/json。
//   - 提供 param.header → 自动补 Authorization(除非已显式带或 param.auth===false),content-type 保留。
//
// 依赖注入(便于单测,生产由 app.js 用 wx/会话装配):
//   - wxRequest(opts):      执行请求(success/fail/complete 回调),生产 = wx.request。
//   - getBaseUrl():          默认基础 URL(globalData.siteBaseUrl)。
//   - getAuthorization():    当前 token。
//   - reLogin(cb):           单航班静默重登,cb(ok)。
//   - showToast(msg)/hideToast()
//   - getErrorMessage(res, fallback) / shouldAutoToast(param, body):沿用 app.js 既有纯函数。

var sanitizeResponseMessage = require('./safe-user-message.js').sanitizeResponseMessage;

function createRequestClient(deps) {
  deps = deps || {};
  var wxRequest = deps.wxRequest;
  var getBaseUrl = deps.getBaseUrl;
  var getAuthorization = deps.getAuthorization || function () { return ''; };
  var reLogin = deps.reLogin || function (cb) { cb(false); };
  var showToast = deps.showToast || function () {};
  var hideToast = deps.hideToast || function () {};
  var getErrorMessage = deps.getErrorMessage || function (res, fb) { return fb; };
  var shouldAutoToast = deps.shouldAutoToast || function () { return false; };
  var scheduleRetry = deps.scheduleRetry || function (fn, ms) { setTimeout(fn, ms); };
  var defaultTimeoutMs = Math.max(1000, Number(deps.defaultTimeoutMs) || 12000);

  if (!wxRequest || !getBaseUrl) {
    throw new Error('request-client: 缺少 wxRequest/getBaseUrl 依赖');
  }

  // 解析最终请求头:复刻旧行为 + 认证自动注入。
  function buildHeader(param, method) {
    var header = param.header;
    if (!header) {
      header = method === 'POST'
        ? { 'content-type': 'application/x-www-form-urlencoded;' }
        : { 'content-type': 'application/json' };
    }
    // 所有方法默认补认证(不覆盖已显式带的,param.auth===false 才可关闭)。
    if (param.auth !== false && header.Authorization === undefined) {
      header = Object.assign({}, header, { 'Authorization': getAuthorization() });
    }
    return header;
  }

  function requestControl(state) {
    if (state.control) return state.control;
    state.control = {
      abort: function () {
        if (state.aborted) return;
        state.aborted = true;
        if (state.task && typeof state.task.abort === 'function') state.task.abort();
      }
    };
    return state.control;
  }

  function send(param, customSiteUrl, _state) {
    var method = (param.method || 'GET').toUpperCase();
    var requestUrl = (customSiteUrl || getBaseUrl()) + param.url;
    var header = buildHeader(param, method);
    // 重试守卫存于内部 state(不污染调用方 param;复用同一 param 的多次请求各自独立重登)。
    // task/aborted 让调用方能取消当前尝试和静默重登后的下一跳；同一个 state 只暴露一个 control。
    var state = _state || { retried: false, aborted: false, task: null, attempt: 0, transportRetryAttempt: 0 };
    var control = requestControl(state);
    if (state.aborted) return control;
    var attempt = (state.attempt || 0) + 1;
    state.attempt = attempt;
    // 静默重登窗口内抑制本次 wxRequest 的 complete;complete 改由最终一跳(重试成功)或重登失败分支触发一次。
    var suppressComplete = false;

    var requestOptions = {
      url: requestUrl,
      data: param.data || {},
      method: method,
      header: header,
      success: function (res) {
        if (state.aborted) return;
        if (res && res.data && typeof res.data === 'object') sanitizeResponseMessage(res.data, '操作失败');
        // 登录态失效(HTTP 401、RuoYi 业务 code=401 或历史 code=2)→ 静默重登并重试一次(内部 state.retried 防死循环)。
        var bodyCode = res.data && (res.data.code == null ? null : Number(res.data.code));
        var needReLogin = res.statusCode == 401 || bodyCode == 401 || bodyCode == 2;
        if (needReLogin && !state.retried) {
          state.retried = true;
          suppressComplete = true; // 本次被重试/重登失败接管,complete 不在此处双触发
          reLogin(function (ok) {
            if (state.aborted) return;
            if (ok) {
              send(param, customSiteUrl, state); // 用新 token 重试原请求(共享 state 防二次重登)
            } else {
              hideToast();
              if (typeof param.fail == 'function') {
                // HTTP 401 保留 HTTP status；HTTP 200 包裹业务 code=401/2 时保留业务鉴权码。
                // 若一律传外层 200，权限页会把重登失败误判为普通业务失败并保留旧敏感快照。
                var authFailureStatus = res && res.statusCode == 401
                  ? 401
                  : bodyCode;
                param.fail(res.data, authFailureStatus);
              } else if (!param.silentError) {
                showToast('登录已过期，请重新进入');
              }
              // 无重试:在此触发本次被抑制的 complete(一次),保证 fail 先于 complete。
              typeof param.complete == 'function' && param.complete(res && res.data ? res.data : res);
            }
          });
          return;
        }
        // HTTP 状态码异常(非可重试 401)。
        if (res.statusCode && res.statusCode != 200) {
          hideToast();
          if (typeof param.successStatusAbnormal == 'function') {
            // 第二个参数是 HTTP 状态码(纯追加,既有 137 处调用点忽略它即可)。
            // 没有它,调用方分不清「4xx 明确失败」与「5xx/408 结果未知」——
            // 写操作把网关超时当成业务失败告诉用户,是 P0-2 明令禁止的那类假结论。
            param.successStatusAbnormal(res.data, res.statusCode);
          } else if (typeof param.fail == 'function') {
            // 没挂 successStatusAbnormal 时回落到 fail。原先这里只 toast 就 return,success 与
            // fail 一个都不触发 —— 调用方挂在这两个回调里的「解锁提交态」永远不执行。
            // 全仓 349 处 sendRequest 里有 137 处正是这种形态(挂了 fail/complete、没挂
            // successStatusAbnormal),其中 baoming.js 补报价那处会把 isPaying 永久锁死:
            // 已 setData({isPaying:true}) + showLoading,然后 handlePayment() 再也不会被调用,
            // 用户既看不到结果也无法重试(731 行 isPaying 守卫挡住二次点击)。
            // 回落到 fail 而不是 success:HTTP 非 200 对调用方而言就是「这次没成功」。
            param.fail(res.data, res.statusCode);
          } else if (!param.silentError) {
            // HTTP 异常也必须经过统一错误映射，禁止把后端内部 API 路径透传到用户界面。
            showToast(getErrorMessage(res.data, '请求失败（' + res.statusCode + '）'));
          }
          return;
        }
        var body = res.data || {};
        if (shouldAutoToast(param, body)) {
          showToast(getErrorMessage(body, '操作失败'));
        }
        typeof param.success == 'function' && param.success(body);
      },
      fail: function (res) {
        if (state.aborted) return;
        // 传输层失败(断网/超时)可以原样重发:调用方显式声明 retry 才重试,
        // 而且只在这一支重试 —— code!=200 是业务结论,重试只会把同一个错误再问一遍。
        // ⚠️ 仅供只读请求声明。写请求重发 = 可能重复下单/重复核销。
        var left = Number(param.retry);
        if (Number.isFinite(left) && left > 0) {
          var next = Object.assign({}, param, { retry: left - 1 });
          state.transportRetryAttempt += 1;
          var attemptIndex = state.transportRetryAttempt;
          suppressComplete = true; // 这次失败交给重试那一跳收尾,complete 只在最后一跳触发一次
          scheduleRetry(function () {
            if (state.aborted) return;
            send(next, customSiteUrl, state);
          }, 400 * attemptIndex);
          return;
        }
        hideToast();
        var failData = res && res.data ? res.data : res;
        if (failData && typeof failData === 'object') sanitizeResponseMessage(failData, '网络异常，请稍后重试');
        if (typeof param.fail == 'function') {
          param.fail(failData);
        } else {
          showToast(getErrorMessage(failData, '网络异常，请稍后重试'));
        }
      },
      complete: function (res) {
        if (state.aborted) return;
        if (suppressComplete) return; // 被重登重试/失败分支接管,避免 complete 双触发或早于 fail
        typeof param.complete == 'function' && param.complete(res && res.data ? res.data : res);
      }
    };
    requestOptions.timeout = param.timeout != null ? param.timeout : defaultTimeoutMs;
    var task = wxRequest(requestOptions);
    // reLogin 在测试或某些实现里可能同步重入 send()；只让当前尝试登记自己的 task，
    // 避免外层同步返回后把重试那一跳的 RequestTask 覆盖掉。
    if (!state.aborted && state.attempt === attempt) state.task = task;
    return control;
  }

  return { send: send };
}

module.exports = { createRequestClient: createRequestClient };
