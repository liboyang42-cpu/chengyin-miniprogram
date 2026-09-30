'use strict';

// 支付后终态查询：把 per-request timeout、墙钟 deadline、重试 timer 与 abort 收在一个模块里。
// 外部只需提供 requestStatus(ref, { timeout }, cb) 和 classify(response)。
function createPaymentVerifier(deps) {
  deps = deps || {};
  var requestStatus = deps.requestStatus;
  var classify = deps.classify;
  if (typeof requestStatus !== 'function' || typeof classify !== 'function') {
    throw new Error('payment-verifier: 缺少 requestStatus/classify 依赖');
  }

  var now = deps.now || Date.now;
  var setTimer = deps.setTimer || setTimeout;
  var clearTimer = deps.clearTimer || clearTimeout;
  var perRequestTimeoutMs = Math.max(1, Number(deps.perRequestTimeoutMs) || 5000);
  var totalDeadlineMs = Math.max(perRequestTimeoutMs, Number(deps.totalDeadlineMs) || 20000);
  var intervalMs = Math.max(0, Number(deps.intervalMs) || 1500);

  return function verify(ref, callback) {
    var startedAt = now();
    var finished = false;
    var timer = null;
    var watchdog = null;
    var task = null;

    function stopTask() {
      var current = task;
      task = null;
      if (!current) return;
      try {
        if (typeof current.abort === 'function') current.abort();
        else if (typeof current.destroy === 'function') current.destroy();
      } catch (e) {}
    }

    function cleanup(abortTask) {
      if (timer !== null) clearTimer(timer);
      if (watchdog !== null) clearTimer(watchdog);
      timer = null;
      watchdog = null;
      if (abortTask) stopTask();
      else task = null;
    }

    function finish(status, raw) {
      if (finished) return;
      finished = true;
      cleanup(false);
      if (status === 'success') {
        callback({ ok: true, status: 'success', data: raw });
      } else if (status === 'failed') {
        callback({ ok: false, status: 'failed', data: raw,
          errMsg: raw && raw.errMsg || '支付未完成' });
      } else {
        callback({ ok: false, status: 'unknown', data: raw,
          errMsg: '支付结果未知，请到订单查看，暂不要重复支付' });
      }
    }

    function remaining() {
      return totalDeadlineMs - Math.max(0, now() - startedAt);
    }

    function scheduleNext() {
      if (finished) return;
      var left = remaining();
      if (left <= 0) { finish('unknown'); return; }
      timer = setTimer(run, Math.min(intervalMs, left));
    }

    function run() {
      if (finished) return;
      timer = null;
      var left = remaining();
      if (left <= 0) { finish('unknown'); return; }

      var settled = false;
      var timeoutMs = Math.min(perRequestTimeoutMs, left);
      watchdog = setTimer(function () {
        watchdog = null;
        if (finished || settled) return;
        settled = true;
        stopTask();
        if (remaining() <= 0) finish('unknown');
        else scheduleNext();
      }, timeoutMs);

      var returned;
      try {
        returned = requestStatus(ref, { timeout: timeoutMs }, function (response) {
          if (finished || settled) return;
          settled = true;
          if (watchdog !== null) clearTimer(watchdog);
          watchdog = null;
          task = null;
          var status;
          try { status = classify(response); } catch (e) { status = 'unknown'; }
          if (status === 'success' || status === 'failed') finish(status, response);
          else if (remaining() <= 0) finish('unknown', response);
          else scheduleNext();
        });
      } catch (e) {
        if (watchdog !== null) clearTimer(watchdog);
        watchdog = null;
        settled = true;
        if (remaining() <= 0) finish('unknown');
        else scheduleNext();
        return;
      }
      if (!settled) task = returned || null;
    }

    run();
    return {
      abort: function () {
        if (finished) return;
        finished = true;
        cleanup(true);
      },
      destroy: function () {
        if (finished) return;
        finished = true;
        cleanup(true);
      },
    };
  };
}

module.exports = { createPaymentVerifier: createPaymentVerifier };
