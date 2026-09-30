// 玩家订单状态的唯一读模型。退款终态只能取 refund_application.payout_status，不能由报名取消态猜测。
const { toTimestamp, chinaParts } = require('./datetime');

function sourceOf(row) {
  return row && (row.cmsActivity || row.cmsTopic) || {};
}

// 取值真源 = 后端 RefundApplication:status 0 待审核 / 1 批准 / 2 驳回;
// payout_status 建单即 5,批准后 6 派发中 → 0 微信已受理 → 1 到账 / 2 待人工 / 3 人工已退 / 4 复核完成。
// 不在 1–4 时只说真实走到的那一步,不给「预计 N 个工作日」这种没人兑现的承诺。
function payoutSummary(application) {
  if (!application) return null;
  const toCode = function (v) { return v === null || v === undefined || v === '' ? NaN : Number(v); };
  const payout = toCode(application.payoutStatus);
  if (payout === 1 || payout === 4) {
    return { key: 'refunded', text: '已退款', refundText: '退款已原路退回' };
  }
  if (payout === 2) {
    return { key: 'refunding', text: '退款处理中', refundText: '原路退款异常，平台正在人工处理' };
  }
  if (payout === 3) {
    return { key: 'refunding', text: '退款处理中', refundText: '人工退款已处理，等待复核确认' };
  }
  const amount = application.refundAmount;
  if (amount !== undefined && amount !== null && !(Number(amount) > 0)) return null;   // 零元单没有钱可退,不给在途承诺
  const status = toCode(application.status);
  if (status === 2) return null;   // 驳回:不是退款中,由 summarizeOrderState 回落到订单真实状态
  if (status === 0) {
    return { key: 'refunding', text: '退款审核中', refundText: '退款申请已提交，等待平台审核' };
  }
  if (payout === 0) {
    return { key: 'refunding', text: '退款处理中', refundText: '微信已受理原路退款，到账以微信退款通知为准' };
  }
  if (status === 1) {
    return { key: 'refunding', text: '退款处理中', refundText: '退款已批准，正在提交原路退款' };
  }
  return { key: 'refunding', text: '退款处理中', refundText: '退款进度更新中，请以微信退款通知为准' };
}

function summarizeOrderState(row, now) {
  const value = row || {};
  if (value.manualRefundCaseStatus) {
    return { key: 'manual_refund', text: '人工售后',
      refundText: value.refundInfo && value.refundInfo.reason || '请查看订单的人工处理进度' };
  }
  const refund = payoutSummary(value.refundApplication);
  if (refund) return refund;

  const registrationStatus = Number(value.registrationStatus);
  if (registrationStatus === 1) {
    return { key: 'pending_payment', text: '待支付', refundText: '完成支付后可使用' };
  }
  if (registrationStatus === 3) {
    return { key: 'cancelled', text: '已取消', refundText: '订单已关闭' };
  }
  if (registrationStatus === 4) {   // 后端 CmsRegistration:4=已过期(closeExpired 关单),以前落到「订单状态更新中」
    return { key: 'expired', text: '已过期', refundText: '超时未支付，订单已关闭' };
  }
  if (registrationStatus !== 2) {
    return { key: 'unknown', text: '订单状态更新中', refundText: '' };
  }

  if (Number(value.verificationStatus) === 1) {
    return { key: 'completed', text: '已完成', refundText: '已核销订单不可退款' };
  }

  const refundInfo = value.refundInfo || {};
  if (refundInfo.refundable === false) {
    return { key: 'non_refundable', text: '不可退款', refundText: refundInfo.reason || '当前订单不可自助退款' };
  }

  const source = sourceOf(value);
  const start = toTimestamp(source.startDate || source.startTime);
  const end = toTimestamp(source.endDate || source.endTime || source.startDate || source.startTime);
  const current = typeof now === 'number' ? now : Date.now();
  if (!Number.isNaN(end) && current > end) {
    return { key: 'completed', text: '已完成', refundText: '活动已结束' };
  }
  if (!Number.isNaN(start) && current < start) {
    return { key: 'not_started', text: '未开始', refundText: refundInfo.reason || '可在退款截止前申请原路退款' };
  }
  return { key: 'in_progress', text: '进行中', refundText: refundInfo.reason || '可在退款截止前申请原路退款' };
}

function formatRefundDeadline(value) {
  const date = chinaParts(value);
  if (!date) return '';
  const pad = function (number) { return String(number).padStart(2, '0'); };
  return date.year + '-' + pad(date.month) + '-' + pad(date.day)
    + ' ' + pad(date.hours) + ':' + pad(date.minutes);
}

module.exports = { summarizeOrderState, formatRefundDeadline };
