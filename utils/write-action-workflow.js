'use strict';

function createWriteActionWorkflow(options) {
  options = options || {};
  var setTimer = options.setTimer || setTimeout;
  var clearTimer = options.clearTimer || clearTimeout;
  var deadlineMs = Math.max(1000, Number(options.deadlineMs) || 15000);
  var destroyed = false;
  var active = {};

  function stop(entry) {
    if (!entry) return;
    if (entry.timer !== null) clearTimer(entry.timer);
    try { if (entry.task && typeof entry.task.abort === 'function') entry.task.abort(); } catch (e) {}
  }

  function run(key, start, callback) {
    key = String(key || '');
    if (destroyed || !key || active[key]) return false;
    var entry = { task: null, timer: null, settled: false };
    active[key] = entry;

    function finish(result) {
      if (destroyed || entry.settled || active[key] !== entry) return;
      entry.settled = true;
      if (entry.timer !== null) clearTimer(entry.timer);
      entry.timer = null;
      var finalResult = result || { status: 'failed' };
      // unknown 表示服务端可能已经写入；在权威回读前保持业务键锁定，
      // 否则用户立即重点会把“结果未知”变成重复核销。
      if (finalResult.status !== 'unknown') delete active[key];
      callback(finalResult);
    }

    entry.timer = setTimer(function () {
      if (entry.settled || active[key] !== entry) return;
      var task = entry.task;
      entry.task = null;
      finish({ status: 'unknown', errMsg: '操作结果待确认，请勿重复提交' });
      try { if (task && typeof task.abort === 'function') task.abort(); } catch (e) {}
    }, deadlineMs);
    try {
      var task = start(finish);
      if (!entry.settled) entry.task = task || null;
    } catch (e) {
      finish({ status: 'failed', errMsg: '操作失败，请稍后重试' });
    }
    return true;
  }

  return {
    run: run,
    isBusy: function (key) { return !!active[String(key || '')]; },
    // 页面被系统回收后，持久化的 unknown 需要重新占住同一业务键；这里只恢复锁，
    // 不重放写请求、不创建计时器，必须等权威 receipt readback 后 reset。
    hold: function (key) {
      var normalized = String(key || '');
      if (destroyed || !normalized) return false;
      if (!active[normalized]) active[normalized] = { task: null, timer: null, settled: true };
      return true;
    },
    // 只能在服务端权威回读后显式释放 unknown；也可无参清理全部。
    reset: function (key) {
      if (key !== undefined && key !== null) {
        var normalized = String(key || '');
        stop(active[normalized]);
        delete active[normalized];
        return;
      }
      Object.keys(active).forEach(function (activeKey) { stop(active[activeKey]); });
      active = {};
    },
    destroy: function () {
      destroyed = true;
      Object.keys(active).forEach(function (key) { stop(active[key]); });
      active = {};
    }
  };
}

module.exports = { createWriteActionWorkflow: createWriteActionWorkflow };
