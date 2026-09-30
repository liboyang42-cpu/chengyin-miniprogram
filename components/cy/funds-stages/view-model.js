// 余额三段(2026-09-16 晚拍板第 5 条):待结算(活动未结束)→ 客诉期中(X月X日可提现)→ 可提现,
// 涉诉金额单列「客诉处理中」。数据源 /api/wallet/stages;金额口径全在后端,这里只做「如实」:
// 字段缺失/不是数 ⇒ 整块判「取不到」,绝不把缺失渲染成 0。
function num(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

function dateText(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  return m ? `${Number(m[2])}月${Number(m[3])}日` : null;
}

function buildFundsStages(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.complaintPeriod)) return null;
  const pending = num(data.pendingSettlement);
  const disputed = num(data.disputed);
  const withdrawable = num(data.withdrawable);
  if (pending === null || disputed === null || withdrawable === null) return null;
  const complaintPeriod = [];
  for (const item of data.complaintPeriod) {
    const amount = num(item && item.amount);
    const text = dateText(item && item.availableDate);
    if (amount === null || text === null) return null;
    if (amount > 0) complaintPeriod.push({ key: item.availableDate, label: `客诉期中 · ${text}可提现`, amount: amount.toFixed(2) });
  }
  return {
    pending: pending > 0 ? pending.toFixed(2) : '',
    complaintPeriod,
    disputed: disputed > 0 ? disputed.toFixed(2) : '',
    withdrawable: withdrawable.toFixed(2),
    amountsKnown: data.amountsKnown !== false,
  };
}

module.exports = { buildFundsStages };
