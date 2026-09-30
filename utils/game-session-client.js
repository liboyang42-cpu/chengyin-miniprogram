'use strict';

var ROLE_PERSPECTIVES = {
  player: 'PLAYER',
  merchant: 'MERCHANT',
  club: 'CLUB'
};

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sameId(left, right) {
  return left !== undefined && left !== null && right !== undefined && right !== null
    && String(left) === String(right);
}

function validActivityId(activityId) {
  return /^\d+$/.test(String(activityId || '')) && Number(activityId) > 0;
}

function validRevision(revision) {
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0;
}

function validProjectionIdentity(data, perspective) {
  if (!validRevision(data && data.revision)) return false;
  var notPreparedClub = perspective === 'CLUB'
    && data.status === 'NOT_PREPARED'
    && (data.sessionId === undefined || data.sessionId === null);
  return notPreparedClub || validActivityId(data && data.sessionId);
}

function validTerminalReceipt(receipt) {
  return validActivityId(receipt && receipt.receiptId) && validRevision(receipt && receipt.revision);
}

function validNodeId(nodeId) {
  return nodeId === undefined || nodeId === null || nodeId === ''
    || (/^\d+$/.test(String(nodeId)) && Number(nodeId) > 0);
}

function validRequestId(requestId) {
  return /^[A-Za-z0-9_-]{8,64}$/.test(String(requestId || ''));
}

function safeEntryText(value, maxLength) {
  if (typeof value !== 'string') return '';
  var text = value.trim();
  return text && text.length <= maxLength ? text : '';
}

function safeOptionalText(value, maxLength) {
  if (typeof value !== 'string') return null;
  var text = value.trim();
  return text.length <= maxLength ? text : null;
}

function nonNegativeInteger(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validDateTimeSeconds(value) {
  if (typeof value !== 'string') return false;
  var match = value.match(/^(\d{4})-(\d{2})-(\d{2}) ([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/);
  if (!match) return false;
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

function normalizeIntegerFields(raw, fields) {
  if (!isObject(raw)) return null;
  var result = {};
  for (var i = 0; i < fields.length; i += 1) {
    var value = nonNegativeInteger(raw[fields[i]]);
    if (value === null) return null;
    result[fields[i]] = value;
  }
  return result;
}

function normalizeRecapMetric(raw) {
  if (!isObject(raw)) return null;
  var key = safeEntryText(raw.key, 64).toUpperCase();
  var label = safeEntryText(raw.label, 120);
  var value = nonNegativeInteger(raw.value);
  var unit = safeOptionalText(raw.unit, 32);
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(key) || !label || value === null || unit === null) return null;
  return { key: key, label: label, value: value, unit: unit };
}

function normalizeRecapStation(raw) {
  if (!isObject(raw) || !validActivityId(raw.nodeId)) return null;
  var nodeName = safeEntryText(raw.nodeName, 120);
  var counts = normalizeIntegerFields(raw, [
    'arrivedPlayers', 'submissionCount', 'normalCompletedCount',
    'fallbackCompletedCount', 'rejectedCount', 'pauseEventCount'
  ]);
  if (!nodeName || !counts) return null;
  return {
    nodeId: Number(raw.nodeId),
    nodeName: nodeName,
    arrivedPlayers: counts.arrivedPlayers,
    submissionCount: counts.submissionCount,
    normalCompletedCount: counts.normalCompletedCount,
    fallbackCompletedCount: counts.fallbackCompletedCount,
    rejectedCount: counts.rejectedCount,
    pauseEventCount: counts.pauseEventCount
  };
}

function normalizeClubRecap(raw) {
  if (!isObject(raw) || raw.schemaVersion !== 'GAME_RECAP_V1'
    || !validDateTimeSeconds(raw.generatedAt) || typeof raw.exportAvailable !== 'boolean'
    || !Array.isArray(raw.metrics) || !Array.isArray(raw.stations)) return null;

  var metrics = raw.metrics.map(normalizeRecapMetric);
  var stations = raw.stations.map(normalizeRecapStation);
  if (metrics.some(function (item) { return !item; })
    || stations.some(function (item) { return !item; })) return null;
  var metricKeys = metrics.map(function (item) { return item.key; });
  var stationIds = stations.map(function (item) { return String(item.nodeId); });
  if (new Set(metricKeys).size !== metrics.length || new Set(stationIds).size !== stations.length) return null;

  var funnel = normalizeIntegerFields(raw.funnel, [
    'paidPlayers', 'arrivedPlayers', 'taskSubmitters',
    'normalCompleters', 'fallbackCompleters', 'finishedTeams'
  ]);
  var hints = normalizeIntegerFields(raw.hints, ['level1Uses', 'level2Uses', 'answerReveals']);
  var incidents = normalizeIntegerFields(raw.incidents, [
    'merchantPauseEvents', 'merchantFallbackCompletions', 'playerRejectedSubmissions'
  ]);
  var collaboration = normalizeIntegerFields(raw.collaboration, ['eligibleTeams', 'completedTeams', 'ratePercent']);
  var takeovers = normalizeIntegerFields(raw.takeovers, ['count']);
  if (!funnel || !hints || !incidents || !collaboration || !takeovers
    || collaboration.ratePercent > 100 || collaboration.completedTeams > collaboration.eligibleTeams) return null;

  return {
    schemaVersion: 'GAME_RECAP_V1',
    generatedAt: raw.generatedAt,
    metrics: metrics,
    funnel: funnel,
    hints: hints,
    incidents: incidents,
    collaboration: collaboration,
    takeovers: takeovers,
    stations: stations,
    exportAvailable: raw.exportAvailable
  };
}

function normalizeClubRecapExport(raw, activityId) {
  if (!isObject(raw) || raw.schemaVersion !== 'GAME_RECAP_EXPORT_V1'
    || !validDateTimeSeconds(raw.generatedAt) || !sameId(raw.activityId, activityId)
    || !validActivityId(raw.sessionId)) return null;
  var recap = normalizeClubRecap(raw.recap);
  if (!recap) return null;
  return {
    schemaVersion: 'GAME_RECAP_EXPORT_V1',
    generatedAt: raw.generatedAt,
    activityId: Number(raw.activityId),
    sessionId: Number(raw.sessionId),
    recap: recap
  };
}

function normalizeMerchantEntry(raw) {
  if (!isObject(raw) || !validActivityId(raw.activityId) || !validActivityId(raw.topicId)) return null;
  var activityName = safeEntryText(raw.activityName, 120);
  var stationCount = Number(raw.stationCount);
  if (!activityName || !Number.isSafeInteger(stationCount) || stationCount <= 0) return null;
  var startAt = raw.startAt == null ? '' : safeEntryText(raw.startAt, 32);
  var endAt = raw.endAt == null ? '' : safeEntryText(raw.endAt, 32);
  if ((raw.startAt != null && !startAt) || (raw.endAt != null && !endAt)) return null;
  return {
    activityId: Number(raw.activityId),
    topicId: Number(raw.topicId),
    activityName: activityName,
    startAt: startAt,
    endAt: endAt,
    stationCount: stationCount
  };
}

function defaultRequestId() {
  return 'game_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
}

function safeMessage(body, fallback) {
  var message = body && typeof body.msg === 'string' ? body.msg.trim() : '';
  if (!message || message.length > 80 || /(?:\/api\/|exception|\.java\b|\bselect\b)/i.test(message)) {
    return fallback;
  }
  return message;
}

function safeReceiptReason(value) {
  var reason = typeof value === 'string' ? value.trim() : '';
  if (!reason || reason.length > 300 || /(?:\/api\/|exception|\.java\b|\bselect\b)/i.test(reason)) return '';
  return reason;
}

function businessResult(body, fallback, requestId) {
  var detail = isObject(body && body.data) ? body.data : {};
  var result = {
    status: 'business-error',
    message: safeMessage(body, fallback)
  };
  if (requestId) result.requestId = requestId;
  if (detail.reasonCode) result.reasonCode = String(detail.reasonCode);
  if (detail.revision !== undefined && detail.revision !== null) result.revision = detail.revision;
  return result;
}

function receiptFailureResult(receipt, fallback, requestId) {
  var resultData = isObject(receipt && receipt.result) ? receipt.result : {};
  var rawReason = typeof resultData.reason === 'string'
    ? resultData.reason
    : (typeof (receipt && receipt.reason) === 'string' ? receipt.reason : '');
  var reason = safeReceiptReason(rawReason);
  var result = {
    status: 'business-error',
    requestId: requestId,
    message: reason || fallback,
    receipt: receipt
  };
  if (receipt.reasonCode) result.reasonCode = String(receipt.reasonCode);
  if (reason) result.reason = reason;
  if (receipt.revision !== undefined && receipt.revision !== null) result.revision = receipt.revision;
  return result;
}

function attachAbort(promise, getTask) {
  promise.abort = function () {
    var task = getTask();
    if (task && typeof task.abort === 'function') task.abort();
  };
  return promise;
}

function createGameSessionClient(options) {
  options = options || {};
  var sendRequest = options.sendRequest;
  var makeRequestId = options.makeRequestId || defaultRequestId;

  if (typeof sendRequest !== 'function') {
    throw new Error('game-session-client: 缺少 sendRequest 依赖');
  }

  function perspectiveOf(role) {
    return ROLE_PERSPECTIVES[String(role || '').toLowerCase()] || '';
  }

  function loadProjection(role, activityId) {
    var perspective = perspectiveOf(role);
    if (!perspective || !validActivityId(activityId)) {
      return Promise.resolve({ status: 'business-error', message: '活动或身份参数无效' });
    }

    var task = null;
    var promise = new Promise(function (resolve) {
      task = sendRequest({
        url: '/api/game/session/view',
        method: 'GET',
        data: { activityId: activityId, perspective: perspective },
        retry: 1,
        autoErrorToast: false,
        success: function (res) {
          if (Number(res && res.code) !== 200) {
            resolve(businessResult(res, '暂时无法读取游戏状态'));
            return;
          }
          var data = res && res.data;
          if (!isObject(data) || data.perspective !== perspective || !sameId(data.activityId, activityId)
            || !validProjectionIdentity(data, perspective)) {
            resolve({ status: 'business-error', message: '游戏状态数据无效' });
            return;
          }
          resolve({ status: 'ready', data: data });
        },
        fail: function () {
          resolve({ status: 'network-error', message: '网络异常，请稍后重试' });
        },
        successStatusAbnormal: function () {
          resolve({ status: 'network-error', message: '网络异常，请稍后重试' });
        }
      });
    });
    return attachAbort(promise, function () { return task; });
  }

  function loadMerchantEntries() {
    var task = null;
    var promise = new Promise(function (resolve) {
      task = sendRequest({
        url: '/api/game/session/merchant/entries',
        method: 'GET',
        retry: 1,
        autoErrorToast: false,
        success: function (res) {
          if (Number(res && res.code) !== 200) {
            resolve(businessResult(res, '暂时无法读取本站入口'));
            return;
          }
          if (!Array.isArray(res && res.data)) {
            resolve({ status: 'business-error', message: '本站入口数据无效' });
            return;
          }
          var entries = res.data.map(normalizeMerchantEntry);
          if (entries.some(function (entry) { return !entry; })) {
            resolve({ status: 'business-error', message: '本站入口数据无效' });
            return;
          }
          resolve({ status: 'ready', data: entries });
        },
        fail: function () {
          resolve({ status: 'network-error', message: '网络异常，请稍后重试' });
        },
        successStatusAbnormal: function () {
          resolve({ status: 'network-error', message: '网络异常，请稍后重试' });
        }
      });
    });
    return attachAbort(promise, function () { return task; });
  }

  function loadClubRecapExport(activityId) {
    if (!validActivityId(activityId)) {
      return Promise.resolve({ status: 'business-error', message: '活动参数无效' });
    }
    var task = null;
    var promise = new Promise(function (resolve) {
      task = sendRequest({
        url: '/api/game/session/recap/export',
        method: 'GET',
        data: { activityId: activityId },
        retry: 1,
        autoErrorToast: false,
        success: function (res) {
          if (Number(res && res.code) !== 200) {
            resolve(businessResult(res, '暂时无法导出复盘数据'));
            return;
          }
          var data = normalizeClubRecapExport(res && res.data, activityId);
          if (!data) {
            resolve({ status: 'business-error', message: '复盘导出数据无效' });
            return;
          }
          resolve({ status: 'ready', data: data });
        },
        fail: function () {
          resolve({ status: 'network-error', message: '网络异常，请稍后重试' });
        },
        successStatusAbnormal: function () {
          resolve({ status: 'network-error', message: '网络异常，请稍后重试' });
        }
      });
    });
    return attachAbort(promise, function () { return task; });
  }

  function submitAction(role, input) {
    input = input || {};
    var perspective = perspectiveOf(role);
    var requestId = input.requestId || makeRequestId();
    var expectedRevision = input.expectedRevision;
    var action = String(input.action || '');
    if (!perspective || !validActivityId(input.activityId) || !validNodeId(input.nodeId)
      || !validRequestId(requestId) || !validRevision(expectedRevision)
      || !/^[A-Z][A-Z0-9_]{2,63}$/.test(action) || !isObject(input.payload || {})) {
      return Promise.resolve({
        status: 'business-error',
        requestId: validRequestId(requestId) ? requestId : '',
        message: '操作参数无效'
      });
    }

    var body = {
      activityId: input.activityId,
      nodeId: input.nodeId === undefined || input.nodeId === '' ? null : input.nodeId,
      requestId: requestId,
      expectedRevision: expectedRevision,
      action: action,
      payload: input.payload || {}
    };
    var task = null;
    var promise = new Promise(function (resolve) {
      task = sendRequest({
        url: '/api/game/session/command',
        method: 'POST',
        header: { 'content-type': 'application/json' },
        data: body,
        autoErrorToast: false,
        success: function (res) {
          if (Number(res && res.code) !== 200) {
            resolve(businessResult(res, '操作未能完成', requestId));
            return;
          }
          var receipt = res && res.data;
          if (!isObject(receipt) || !sameId(receipt.activityId, input.activityId)
            || receipt.requestId !== requestId || receipt.action !== action) {
            resolve({
              status: 'unknown',
              requestId: requestId,
              message: '操作结果待确认，请勿重复提交'
            });
            return;
          }
          if (receipt.outcome === 'FAILED') {
            if (!validTerminalReceipt(receipt)) {
              resolve({
                status: 'unknown', requestId: requestId, message: '操作结果待确认，请勿重复提交'
              });
              return;
            }
            resolve(receiptFailureResult(receipt, '操作未能完成', requestId));
            return;
          }
          if (receipt.outcome !== 'APPLIED' || !validTerminalReceipt(receipt)) {
            resolve({
              status: 'unknown',
              requestId: requestId,
              message: '操作结果待确认，请勿重复提交'
            });
            return;
          }
          resolve({ status: 'success', requestId: requestId, receipt: receipt });
        },
        fail: function () {
          resolve({
            status: 'unknown',
            requestId: requestId,
            message: '操作结果待确认，请勿重复提交'
          });
        },
        successStatusAbnormal: function () {
          resolve({
            status: 'unknown',
            requestId: requestId,
            message: '操作结果待确认，请勿重复提交'
          });
        }
      });
    });
    return attachAbort(promise, function () { return task; });
  }

  function readReceipt(activityId, requestId) {
    if (!validActivityId(activityId) || !validRequestId(requestId)) {
      return Promise.resolve({
        status: 'business-error', requestId: String(requestId || ''), message: '操作记录参数无效'
      });
    }

    var task = null;
    var promise = new Promise(function (resolve) {
      task = sendRequest({
        url: '/api/game/session/receipt',
        method: 'GET',
        data: { activityId: activityId, requestId: requestId },
        retry: 1,
        autoErrorToast: false,
        success: function (res) {
          if (Number(res && res.code) !== 200) {
            resolve(businessResult(res, '暂时无法读取操作结果', requestId));
            return;
          }
          var receipt = res && res.data;
          if (!isObject(receipt) || !sameId(receipt.activityId, activityId)
            || receipt.requestId !== requestId) {
            resolve({ status: 'invalid-response', requestId: requestId, message: '操作结果无效' });
            return;
          }
          if (receipt.outcome === 'PENDING') {
            resolve({ status: 'pending', requestId: requestId, receipt: receipt });
            return;
          }
          if (receipt.outcome === 'FAILED') {
            if (!validTerminalReceipt(receipt)) {
              resolve({ status: 'invalid-response', requestId: requestId, message: '操作结果不完整' });
              return;
            }
            resolve(receiptFailureResult(receipt, '操作未能完成', requestId));
            return;
          }
          if (receipt.outcome !== 'APPLIED' || !validTerminalReceipt(receipt)) {
            resolve({ status: 'invalid-response', requestId: requestId, message: '操作状态无效' });
            return;
          }
          resolve({ status: 'matched', requestId: requestId, receipt: receipt });
        },
        fail: function () {
          resolve({ status: 'network-error', requestId: requestId, message: '网络异常，请稍后重试' });
        },
        successStatusAbnormal: function () {
          resolve({ status: 'network-error', requestId: requestId, message: '网络异常，请稍后重试' });
        }
      });
    });
    return attachAbort(promise, function () { return task; });
  }

  return {
    loadMerchantEntries: loadMerchantEntries,
    loadClubRecapExport: loadClubRecapExport,
    loadProjection: loadProjection,
    submitAction: submitAction,
    readReceipt: readReceipt
  };
}

function appClient() {
  var app = getApp();
  return createGameSessionClient({
    sendRequest: app.sendRequest.bind(app)
  });
}

function loadProjection(role, activityId) {
  return appClient().loadProjection(role, activityId);
}

function submitAction(role, input) {
  return appClient().submitAction(role, input);
}

function loadClubRecapExport(activityId) {
  return appClient().loadClubRecapExport(activityId);
}

function readReceipt(activityId, requestId) {
  return appClient().readReceipt(activityId, requestId);
}

module.exports = {
  createGameSessionClient: createGameSessionClient,
  loadClubRecapExport: loadClubRecapExport,
  normalizeClubRecap: normalizeClubRecap,
  normalizeClubRecapExport: normalizeClubRecapExport,
  loadProjection: loadProjection,
  submitAction: submitAction,
  readReceipt: readReceipt
};
