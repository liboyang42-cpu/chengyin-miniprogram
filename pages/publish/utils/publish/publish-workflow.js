// Phase 3.1 发布提交状态机。
//
// 抽取 publish/activity 与 publish/fabu 共享的提交时序与不变量。依赖注入,页面保留各自
// UI(submitting 标志/analytics/toast/跳转、url 差异)。状态:idle → submitting → 成功 done / 失败回 idle。
//
// 依赖:
//  - request(payload, cb):执行发布网络请求;cb({ ok, data?, msg?, networkError? })。
//      ok=true → 业务成功;ok=false → 业务失败(带 msg)或网络失败(networkError=true)。
//
// submit(payload, handlers) 的 handlers(均可选):
//  onSuccess(data) / onFail(res)。

function createPublishWorkflow(deps) {
  deps = deps || {};
  var request = deps.request;
  if (!request) {
    throw new Error('publish-workflow: 缺少 request 依赖');
  }

  var state = 'idle'; // idle | submitting | done
  var destroyed = false;

  function call(fn, arg) { if (typeof fn === 'function') fn(arg); }

  function submit(payload, handlers) {
    handlers = handlers || {};
    // 防重:仅 idle 可发起(submitting 在途、done 已完成均忽略)。
    if (state !== 'idle') return false;
    state = 'submitting';

    request(payload, function (res) {
      if (destroyed) return; // 销毁后不再回调,避免 setData / redirect after unload
      if (res && res.ok) {
        state = 'done'; // 发布成功只可能进 done 一次
        call(handlers.onSuccess, res.data);
      } else {
        state = 'idle'; // 业务/网络失败均可重试
        call(handlers.onFail, res);
      }
    });
    return true;
  }

  return {
    submit: submit,
    destroy: function () { destroyed = true; },
    getState: function () { return state; },
    isBusy: function () { return state === 'submitting'; },
  };
}

module.exports = { createPublishWorkflow: createPublishWorkflow };
