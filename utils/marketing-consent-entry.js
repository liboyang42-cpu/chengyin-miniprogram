'use strict';

/**
 * 商家营销消息同意入口(2026-09-17 用户拍板第 40 条 A:下单/核销成功后可选勾选)。
 *
 * 复用既有 GET/POST /api/merchant/crm/marketing-consents,不新造接口:
 *  · GET 返回的是服务端算好的可管理商家行(有真实报名关系、门店生效、同 owner 无多门店歧义),
 *    勾选行用的 merchantRowId / merchantOwnerMemberId 一律取服务端值;客户端只用订单/回执里
 *    已有的 owner memberId 做一致性匹配(口径见 docs/design/商家与俱乐部功能补全说明与施工TODO_20260823.md
 *    第 480 行:客户端 owner 只作一致性校验)。
 *  · 匹配不到、多行匹配(歧义)、已同意(inAppOptedIn === true)或接口失败,一律不出现 —— fail-closed。
 *  · 保存 requestId 幂等;同一次勾选意图(含失败重试)复用同一个 requestId,重放不会写第二条。
 */

function positiveSafeId(value) {
  const out = Number(value);
  return Number.isSafeInteger(out) && out > 0 ? out : null;
}

/**
 * 从 GET 行里挑出「这一单背后的商家」。ownerMemberId 来自订单/回执里已返回的
 * cmsTopic.memberId / cmsActivity.memberId;商家一方的 id 只认服务端下发的值。
 */
function pickOffer(rows, ownerMemberId) {
  if (!Array.isArray(rows)) return null;
  const owner = positiveSafeId(ownerMemberId);
  if (!owner) return null;
  const matches = rows.filter(function (row) {
    return row && positiveSafeId(row.merchantOwnerMemberId) === owner;
  });
  // 同一 owner 出现多行 = 归属有歧义(正常口径下服务端不会下发):宁可不展示,不赌一行。
  if (matches.length !== 1) return null;
  const row = matches[0];
  if (row.inAppOptedIn === true) return null;   // 已同意过的商家不再出现
  const merchantRowId = positiveSafeId(row.merchantRowId);
  if (!merchantRowId) return null;
  return {
    merchantRowId: merchantRowId,
    merchantOwnerMemberId: owner,
    merchantName: String(row.merchantName || '商家'),
  };
}

/**
 * 读「这单背后有没有可勾选的商家」。
 * 结果只有两种:offer 或 null —— 读不到就是 null(不出现),不把失败当空列表。
 * 2026-09-17 总控裁定(release-0917 第三阶段 C):这条读取静默失败(silentError)。它挂在「支付成功面板」
 * 与「订单详情」上,是非必要的附属请求:失败只隐藏可选的同意勾选行(fail-closed),主流程不受影响;
 * 支付刚成功就弹通道默认的「网络错误」,会让玩家以为没付成功。保存(optIn)仍不静默,见下。
 * U5 静默棘轮为此 25→26,这是总控点名的唯一放宽。
 */
function loadOffer(app, ownerMemberId, callback) {
  const done = typeof callback === 'function' ? callback : function () {};
  if (!positiveSafeId(ownerMemberId) || !app || typeof app.sendRequest !== 'function') {
    done(null);
    return;
  }
  app.sendRequest({
    hideLoading: true,
    silentError: true,
    url: '/api/merchant/crm/marketing-consents',
    method: 'GET',
    success: function (res) {
      if (!ok(res) || !Array.isArray(res.data)) { done(null); return; }
      done(pickOffer(res.data, ownerMemberId));
    },
    fail: function () { done(null); },
    successStatusAbnormal: function () { done(null); },
  });
}

/**
 * 勾选「接收该商家站内活动消息」。cb({ ok, message }) —— 失败文案由调用方在原位渲染并可重试。
 * 失败不静默:通道默认 toast 会给出一句可见提示,勾选行内再落一条错误 + 重试(同一件事不遮蔽)。
 */
function optIn(app, offer, requestId, callback) {
  const done = typeof callback === 'function' ? callback : function () {};
  if (!offer || !positiveSafeId(offer.merchantRowId) || !positiveSafeId(offer.merchantOwnerMemberId)) {
    done({ ok: false, message: '商家信息不完整，请稍后再试' });
    return;
  }
  app.sendRequest({
    hideLoading: true,
    url: '/api/merchant/crm/marketing-consents',
    method: 'POST',
    data: JSON.stringify({
      merchantRowId: offer.merchantRowId,
      merchantOwnerMemberId: offer.merchantOwnerMemberId,
      channel: 'IN_APP',
      optedIn: true,
      requestId: requestId,
    }),
    header: { 'Content-Type': 'application/json' },
    success: function (res) {
      if (ok(res)) { done({ ok: true, message: '' }); return; }
      done({ ok: false, message: requestError(app, res, '同意没有保存成功，请重试') });
    },
    fail: function () { done({ ok: false, message: '网络连接失败，请重试' }); },
    successStatusAbnormal: function (res) {
      done({ ok: false, message: requestError(app, res, '同意没有保存成功，请重试') });
    },
  });
}

// 与设置页同一形状(utils 后缀 [A-Za-z0-9._:-]{6,64} 的合法值),每次勾选生成一次,重试复用。
function newRequestId(kind) {
  return 'consent-' + (kind || 'opt-in') + '-'
    + Date.now().toString(36) + '-' + Math.floor(Math.random() * 0xFFFFFF).toString(36);
}

function ok(res) { return !!(res && (res.code === 200 || res.code === '200')); }

function requestError(app, res, fallback) {
  return (app && app.getRequestErrorMessage && app.getRequestErrorMessage(res, fallback)) || fallback;
}

module.exports = {
  loadOffer: loadOffer,
  optIn: optIn,
  newRequestId: newRequestId,
  pickOffer: pickOffer,
};
