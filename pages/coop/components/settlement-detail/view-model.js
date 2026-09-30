// 收款方文案与台账列表共用一份映射,别在两处各写一遍 —— 那样迟早漂移成
// 「列表说俱乐部、详情说商家」。
const { resolveSettlementPayee } = require('../../utils/merchant-ledger.js');

function canonicalStatus(value) {
  if (value === 0 || value === 1 || value === 2) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '0' || text === '1' || text === '2' ? Number(text) : null;
}

function money(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return `¥${value.toFixed(2)}`;
}

function numericValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function knownBoolean(value) {
  return value === true || value === false ? value : null;
}

function dateText(value) {
  return value ? String(value).slice(0, 16).replace('T', ' ') : '';
}

function line(key, label, value, strong) {
  if (value === null || value === undefined || value === '') return null;
  return { key, label, value: String(value), strong: strong === true };
}

function compact(items) {
  return items.filter(Boolean);
}

function shareRule(record) {
  const mode = canonicalStatus(record && record.shareMode);
  if (mode === 0) return '引流';
  if (mode === 1) {
    const rate = numericValue(record.shareRate);
    return rate === null ? '分成' : `分成 · ${rate}%`;
  }
  if (mode === 2) {
    const fee = money(record.fixedFee);
    return fee ? `固定 · ${fee}/人` : '固定';
  }
  return '';
}

function merchantStatus(record) {
  const status = canonicalStatus(record && record.status);
  if (status === 0) return { text: '待入账', variant: 'warning' };
  if (status === 1) return { text: '已入余额', variant: 'success' };
  if (status === 2) return { text: '已作废', variant: 'danger' };
  return { text: '状态待确认', variant: 'neutral' };
}

function buildMerchantTimeline(record, status) {
  const items = compact([
    line('created', '结算记录已创建', dateText(record.createTime)),
    line('settled', '合作已结算', dateText(record.settleTime)),
  ]);
  if (status.text === '待入账') {
    items.push(line('payable', '预计入账', dateText(record.payableTime)) || line('payable', '等待入账', '时间待确认'));
  } else if (status.text === '已入余额') {
    items.push(line('paid', '已入余额', dateText(record.payoutTime)) || line('paid', '已入余额', '到账时间待确认'));
  } else if (status.text === '已作废') {
    items.push(line('void', '结算已作废', dateText(record.updateTime) || '时间待确认'));
  } else if (!items.length) {
    items.push(line('unknown', '结算状态待确认', '请稍后刷新'));
  }
  return items;
}

function buildMerchantSettlementDetail(input) {
  const record = input || {};
  const status = merchantStatus(record);
  const amount = money(record.amount);
  const heads = numericValue(record.verifiedHeads);
  return {
    key: `mybiz:${record.id == null ? '' : record.id}`,
    title: record.topicName || (record.topicId ? `主题 #${record.topicId}` : '未命名主题'),
    perspective: '承接分润',
    amountLabel: '我的分润',
    amount: amount || '—',
    status: status.text,
    statusVariant: status.variant,
    lines: compact([
      // 列表行的首个 meta 已经标了收款方,详情页不能反而没有 —— 点进来就是要看清这笔钱的归属。
      line('payee', '收款方', resolveSettlementPayee(record.payeeType)),
      line('verifiedSales', '核销销售额', money(record.verifiedSales)),
      line('verifiedHeads', '核销人数', heads === null ? '' : `${heads} 人`),
      line('shareRule', '分润方式', shareRule(record)),
      line('income', '我的分润', amount || '—', true),
    ]),
    timeline: buildMerchantTimeline(record, status),
  };
}

function hostStatus(record, income) {
  const settled = knownBoolean(record && record.settled);
  if (settled === null) return { text: '状态待确认', variant: 'neutral' };
  if (settled === false) return { text: '待结算', variant: 'warning' };
  if (!income) return { text: '金额待确认', variant: 'neutral' };
  if (Number(record.myIncome) === 0) return { text: '无需入账', variant: 'neutral' };
  const arrived = record.myIncomeArrived === true || record.myIncomeArrived === 1 || record.myIncomeArrived === '1';
  if (arrived) return { text: '已入账', variant: 'success' };
  return { text: '待入账', variant: 'warning' };
}

function buildHostTimeline(record, status) {
  const settled = knownBoolean(record && record.settled);
  const items = [line('settled', settled === null
    ? '结算状态待确认'
    : (settled ? '主题已结算' : '主题待结算'), '当前状态')];
  if (status.text === '已入账') items.push(line('income', '我的分润已入账', '已到账'));
  else if (status.text === '待入账') items.push(line('income', '我的分润待入账', '等待到账'));
  else if (status.text === '无需入账') items.push(line('income', '本期无需入账', '分润为 0'));
  if (record.merchantPayableTime) items.push(line('merchantPayable', '商家应收可入账', dateText(record.merchantPayableTime)));
  if (record.merchantPayoutTime) items.push(line('merchantPaid', '商家应收已打款', dateText(record.merchantPayoutTime)));
  return compact(items);
}

function buildHostSettlementDetail(input) {
  const record = input || {};
  const income = money(record.myIncome);
  const settledIncome = knownBoolean(record.settled) === true ? income : null;
  const status = hostStatus(record, settledIncome);
  return {
    key: `finance:${record.topicId == null ? '' : record.topicId}`,
    title: record.topicName || (record.topicId ? `主题 #${record.topicId}` : '未命名主题'),
    perspective: '主办分润',
    amountLabel: '我的分润',
    amount: settledIncome || '—',
    status: status.text,
    statusVariant: status.variant,
    lines: compact([
      line('totalSales', '总销售额', money(record.totalSales)),
      line('verifiedSales', '核销销售额', money(record.verifiedSales)),
      line('platform', '平台服务费', money(record.platformAmount)),
      line('merchant', '商家应收', money(record.merchantTotal)),
      line('income', '我的分润', settledIncome || '—', true),
    ]),
    timeline: buildHostTimeline(record, status),
  };
}

// CU-C-41(用户裁决 A):俱乐部视角的结算明细 —— 同一主题在「俱乐部分润」里的那一行,
// 由 /api/club/settlement/summary 按 topicId 命中。金额字段是服务端已格式化的字符串
// (钱的显示口径只有后端一处真源),这里不重算、不补零;未知只显示「—」。
function clubStatus(row) {
  if (row && row.status === 'void') return { text: '已作废', variant: 'danger' };
  if (row && row.status === 'pending') return { text: '待入账', variant: 'warning' };
  if (!row || row.amountStatus === 'unverified') return { text: '待核验', variant: 'neutral' };
  if (row.status !== 'settled') return { text: '状态待确认', variant: 'neutral' };
  return { text: '已入账', variant: 'success' };
}

function clubAmountLabel(row) {
  if (!row || row.status === 'pending') return '待入账金额';
  if (row.status === 'void') return '作废前核算净额';
  return '已入账金额';
}

function buildClubSettlementDetail(input) {
  const record = input || {};
  const status = clubStatus(record);
  const amount = typeof record.amountText === 'string' && record.amountText.trim() !== '' ? record.amountText : null;
  return {
    key: `club:${record.topicId == null ? '' : record.topicId}`,
    title: record.name || (record.topicId ? `主题 #${record.topicId}` : '未命名主题'),
    perspective: '俱乐部分润',
    amountLabel: clubAmountLabel(record),
    amount: amount || '—',
    status: status.text,
    statusVariant: status.variant,
    lines: compact([
      line('original', '原始应结', record.originalAmountText),
      line('adjustment', '已执行调整', record.executedAdjustmentText),
      line('net', '核算净额', record.netAmountText, true),
    ]),
    timeline: compact([
      line('arrived', '到账时间', record.arrivedText),
      line('paid', '打款状态', record.paidText),
    ]),
  };
}

module.exports = {
  buildMerchantSettlementDetail,
  buildHostSettlementDetail,
  buildClubSettlementDetail,
};
