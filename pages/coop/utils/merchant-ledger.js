const { toTimestamp, chinaDateKey } = require('../../../utils/datetime');
function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(toTimestamp(String(value)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesPeriod(value, period, now) {
  if (period === 'all') return true;
  const date = parseDate(value);
  if (!date) return false;
  // "今天/本月"是中国自然日/自然月的概念,必须用中国日历字段比对:
  // 单纯锚定瞬时还不够——手机在 UTC 时,getDate() 取的仍是本地日历,中国 7-26 02:00 会被当成 25 号。
  const currentTs = now ? (now instanceof Date ? now.getTime() : toTimestamp(now)) : Date.now();
  const key = chinaDateKey(date.getTime());
  const curKey = chinaDateKey(currentTs);
  if (!key || !curKey) return false;
  if (period === 'today') return key === curKey;
  return key.slice(0, 7) === curKey.slice(0, 7);
}

function matchesStatus(order, status) {
  if (status === 'pending') return Number(order.status) === 1;
  if (status === 'completed') return Number(order.status) === 4;
  if (status === 'aftersale') return Number(order.aftersaleStatus) > 1;
  return true;
}

function amountInCents(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function formatAmount(cents) {
  return (cents / 100).toFixed(2);
}

function resolveOrderFilter(status) {
  if (String(status) === '1') return 'pending';
  if (String(status) === '4') return 'completed';
  return 'all';
}

function buildLedgerView(orders, options) {
  const config = options || {};
  const period = config.period || 'month';
  const status = config.status || 'all';
  const rows = (Array.isArray(orders) ? orders : []).filter((order) => {
    return matchesPeriod(order.createTime, period, config.now) && matchesStatus(order, status);
  });
  const orderAmount = rows.reduce((total, order) => total + amountInCents(
    order.payAmount || order.orderTotalAmount || order.totalAmount || order.payableAmount
  ), 0);

  return {
    rows,
    summary: {
      orderCount: rows.length,
      orderAmount: formatAmount(orderAmount),
      aftersaleCount: rows.filter((order) => Number(order.aftersaleStatus) > 1).length
    }
  };
}

// 订单 tab 的区块标题跟随账期筛选,避免与页标题「经营台账」重名。
const PERIOD_TITLES = { today: '今日经营', month: '本月经营', all: '全部经营' };

function resolvePeriodTitle(period) {
  return PERIOD_TITLES[period] || PERIOD_TITLES.month;
}

// 结算状态码归一 —— 严格白名单,fail-closed:拿不准就说不知道。
// 只认两种形态:① number 且值精确为 0/1/2;② string 去掉首尾空白后恰好是 "0"/"1"/"2"。
// 其余(null、undefined、空串、纯空白、布尔、对象、数组、未知码)一律 null。
// ★不许用 Number() 兜底,它会顺手认下一堆不是规范状态码的东西:
//   Number(null) / Number('') / Number('  ') / Number([]) 都是 0;
//   Number('00') / Number('+0') / Number('-0') / Number('0.0') / Number('0e0') / Number('0x0') 也都是 0。
// 一旦接纳,这份来路不明的状态就会被渲染成确定的「待打款」+ 黄色带 —— 在对账页上
// 等于凭空向商家承诺一笔钱在路上。宁可显示「处理中」,也不替后端下结论。
const SETTLEMENT_CODE_TEXTS = ['0', '1', '2'];

function normalizeSettlementCode(status) {
  if (typeof status === 'number') {
    if (status === 0) return 0;
    if (status === 1) return 1;
    if (status === 2) return 2;
    return null;
  }
  if (typeof status !== 'string') return null;
  const index = SETTLEMENT_CODE_TEXTS.indexOf(status.trim());
  return index === -1 ? null : index;
}

// ADA 处方 H:结算批次卡左缘状态色带。状态码与 settlementStatusText 同源
// (0 待打款 / 1 已结算 / 2 已作废),未知码不装色带,避免拿默认色误导对账。
function resolveSettlementTone(status) {
  const code = normalizeSettlementCode(status);
  if (code === 0) return 'pending';
  if (code === 1) return 'settled';
  if (code === 2) return 'void';
  return '';
}

// 金额正负色:负数(退款/冲销)走 danger,其余走墨色。
// 注意判据是数值本身,不是字符串前缀 —— '-0.00' 这类格式化残留不算支出。
function resolveAmountTone(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'neutral';
  return amount < 0 ? 'negative' : 'neutral';
}

// 分润行的收款方。后端 CoopSettlement.payeeType:
//   club     = LEAD_FEE(俱乐部带队费)
//   merchant = MERCHANT_VERIFY(商家核销分成)
//   空值     = 旧数据,按商家算 —— mySettlements() 的过滤口径就是 {null, merchant, club}
//   initiator / platform 本不该出现在这个列表(前者走 clubFinance,后者不进任何一方视图)
// 认不出来的值返回空串:宁可不标,也别把一笔钱标到错的主体上。
function resolveSettlementPayee(payeeType) {
  const type = payeeType == null ? '' : String(payeeType).trim().toLowerCase();
  if (type === 'club') return '俱乐部分润';
  if (type === '' || type === 'merchant') return '商家分润';
  return '';
}

module.exports = {
  buildLedgerView, resolveOrderFilter, resolvePeriodTitle, resolveSettlementTone, resolveAmountTone,
  normalizeSettlementCode, resolveSettlementPayee,
};
