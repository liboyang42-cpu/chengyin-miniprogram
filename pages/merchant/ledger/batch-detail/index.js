const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');
const { isFinanceObjectPayload, money } = require('../../utils/merchant-finance.js');
const { isRecord, isRecordList } = require('../../../../utils/response-shape.js');
Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    batchId: '',
    detail: null,
    loadState: 'loading',
    errorKind: 'data',
    errorText: '',
  },
  onLoad(options) {
    const batchId = options && options.batchId ? String(options.batchId) : '';
    this.setData({ batchId, loadState: batchId ? 'loading' : 'missing-param', errorText: batchId ? '' : '缺少结算批次标识' });
    this.load();
  },
  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._loadEpoch = (this._loadEpoch || 0) + 1;
    this._loading = false;
    merchantTheme.merchantPageRestore();
  },
  onPullDownRefresh() { this.load(); },
  onNavBack() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.reLaunch({ url: '/pages/merchant/ledger/index?view=settlement' }); },
  load() {
    if (!this.data.batchId) {
      this.setData({ loadState: 'missing-param', errorKind: 'data', errorText: '缺少结算批次标识' });
      stopPullDownRefresh();
      return;
    }
    if (this._loading) {
      stopPullDownRefresh();
      return;
    }
    this._loading = true;
    const epoch = (this._loadEpoch || 0) + 1;
    this._loadEpoch = epoch;
    const hasDetail = Boolean(this.data.detail);
    this.setData({
      loadState: hasDetail ? 'refreshing' : 'loading',
      errorKind: 'data',
      errorText: '',
    });
    app.sendRequest({ hideLoading: true, autoErrorToast: false, url: '/api/merchant/finance/public-transfer-batch-detail', method: 'POST', data: JSON.stringify({ batchId: this.data.batchId }), header: { 'Content-Type': 'application/json' }, success: (res) => {
      if (epoch !== this._loadEpoch) return;
      const hasObjectEnvelope = isFinanceObjectPayload(res);
      if (!isBatchDetailPayload(res, this.data.batchId)) {
        if (!settleLoad(this, epoch)) return;
        if (isMissingRecordResponse(res)) {
          this.setData({
            detail: null,
            loadState: 'missing-record',
            errorKind: 'data',
            errorText: '这条结算批次不存在或已不可见',
          });
          return;
        }
        this.setData({
          loadState: hasDetail ? 'stale-error' : 'error',
          errorKind: 'data',
          errorText: hasObjectEnvelope
            ? '结算详情数据不完整，请重试'
            : ((res && res.msg) || '结算详情没加载出来'),
        });
        return;
      }
      const detail = Object.assign({}, res.data, { batch: formatBatch(res.data.batch), earningEntries: res.data.earningEntries.map(formatEntry), adjustments: res.data.adjustments.map(formatEntry) });
      detail.timeline = buildTimeline(detail.batch);
      if (!settleLoad(this, epoch)) return;
      this.setData({ detail, loadState: 'ready', errorKind: 'data', errorText: '' });
    }, fail: (error) => {
      const network = isTransportFailure(error);
      if (!settleLoad(this, epoch)) return;
      if (isMissingRecordResponse(error)) {
        this.setData({
          detail: null,
          loadState: 'missing-record',
          errorKind: 'data',
          errorText: '这条结算批次不存在或已不可见',
        });
        return;
      }
      this.setData({
        loadState: hasDetail ? 'stale-error' : 'error',
        errorKind: network ? 'network' : 'data',
        errorText: network
          ? '网络不稳定，请检查连接后重试'
          : ((error && (error.msg || error.message)) || '结算详情没加载出来'),
      });
    } });
  },
  retryLoad() { this.load(); },
  copyVoucher() {
    const voucher = this.data.detail && this.data.detail.batch && this.data.detail.batch.payVoucherNo;
    if (!voucher) return;
    wx.setClipboardData({ data: String(voucher) });
  },
});

function stopPullDownRefresh() {
  if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh();
}
function settleLoad(page, epoch) {
  if (epoch !== page._loadEpoch) return false;
  page._loading = false;
  stopPullDownRefresh();
  return true;
}
function isTransportFailure(error) {
  if (!error || typeof error !== 'object') return false;
  if (error.statusCode !== undefined || error.code !== undefined) return false;
  return /request:fail|timeout|network|网络|断网/i.test(String(error.errMsg || ''));
}
function isMissingRecordResponse(response) {
  return /记录(?:不可见|不存在)/.test(String(response && response.msg || ''));
}
function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}
function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}
function isBatchDetailPayload(response, expectedBatchId) {
  if (!isFinanceObjectPayload(response)
      || !isRecord(response.data.batch)
      || !isRecordList(response.data.earningEntries)
      || !isRecordList(response.data.adjustments)) return false;
  const batch = response.data.batch;
  const entries = response.data.earningEntries.concat(response.data.adjustments);
  return entries.every(isSettlementEntryPayload)
    && hasValue(batch.batchId)
    && String(batch.batchId) === expectedBatchId
    && hasValue(batch.periodYm)
    && hasOwn(batch, 'amountTotal')
    && hasValue(batch.netDirection)
    && hasValue(batch.paymentState)
    && hasValue(batch.invoiceState)
    && hasValue(batch.holdState);
}
function isSettlementEntryPayload(entry) {
  return hasValue(entry.entryKey)
    && hasValue(entry.entryKind)
    && hasValue(entry.source)
    && hasOwn(entry, 'signedAmount');
}

/**
 * 打款进度 timeline。⚠️ 未来节点只写状态名、不给日期、不写「预计」——
 * 资金域定稿附录 C:「预计打款日期」代码里不存在这条规则,凭空写是假承诺。
 * 只有服务端真给了时间戳的节点才带小字。
 */
function buildTimeline(batch) {
  if (!batch || !batch.showPaymentProgress) return [];
  const paidAt = batch.paidAtText || '';
  const nodes = [
    { label: '批次生成', at: batch.createdAt ? String(batch.createdAt).slice(0, 16).replace('T', ' ') : '' },
    { label: '对账确认', at: batch.confirmedAt ? String(batch.confirmedAt).slice(0, 16).replace('T', ' ') : '' },
    { label: '平台打款', at: paidAt && batch.payVoucherNo ? `${paidAt} · 凭证 ${batch.payVoucherNo}` : paidAt },
  ];
  // 按【业务事实】判断,不看时间戳:批次对象存在 ⇒ 批次生成这件事必然已发生,恒实心。
  // doneThrough=已发生的节点数;hasCurrent=下一个节点是不是「正在办」。
  const step = batch.paymentState === 'PAID'
    ? { doneThrough: nodes.length, hasCurrent: false }
    : (batch.paymentState === 'CONFIRMED'
      ? { doneThrough: 2, hasCurrent: true }   // 对账已确认,正在等打款
      : { doneThrough: 1, hasCurrent: true }); // 批次已生成,正在等对账
  return nodes.map((node, index) => Object.assign({}, node, {
    state: index < step.doneThrough ? 'done'
      : (step.hasCurrent && index === step.doneThrough ? 'now' : 'todo'),
  }));
}
function formatBatch(batch) {
  const item = Object.assign({}, batch);
  item.amountText = money(batch.amountTotal);
  item.amountDisplay = item.amountText == null ? null : `¥${item.amountText}`;
  item.amountFallback = '待定';
  item.paymentText = paymentText(item);
  item.invoiceText = { NONE: '未开票', ISSUED: '已开票', RED: '已红冲' }[item.invoiceState] || '发票状态待确认';
  item.isPaid = item.netDirection === 'PLATFORM_PAYS_MERCHANT' && item.paymentState === 'PAID';
  item.paidAtText = item.paidAt ? String(item.paidAt).slice(0, 16).replace('T', ' ') : '';
  item.showPaymentProgress = item.netDirection === 'PLATFORM_PAYS_MERCHANT';
  item.stateVariant = batch.displayState === 'LEDGER_ERROR' ? 'danger'
    : (item.netDirection === 'MERCHANT_OWES_PLATFORM' ? 'danger'
      : (item.paymentState === 'PAID' ? 'success' : (item.netDirection === 'ZERO' ? 'neutral' : 'warning')));
  return item;
}
function paymentText(batch) {
  if (batch.displayState === 'LEDGER_ERROR') return '结算数据对不上，请联系客服';
  if (batch.netDirection === 'ZERO') return '本期无需打款';
  if (batch.netDirection === 'MERCHANT_OWES_PLATFORM') return '调整待处理';
  if (batch.holdState === 'FROZEN') return '结算处理中';
  if (batch.paymentState === 'PAID') return '平台已打款';
  if (batch.paymentState === 'CONFIRMED') return '已确认';
  return '待对账';
}
function formatEntry(entry) {
  const item = Object.assign({}, entry);
  item.amountText = money(entry.signedAmount);
  item.amountDisplay = item.amountText == null
    ? '待定'
    : `${Number(item.amountText) > 0 ? '+' : ''}¥${item.amountText}`;
  item.sourceText = entry.entryKind === 'REVERSAL' ? '冲正' : (entry.entryKind === 'CLAWBACK' ? '扣划' : ({ REDEMPTION_FEE: '核销计酬', COOP_SHARE: '合作分润', ACTIVITY_SHARE: '活动分润' }[entry.source] || '调整项'));
  return item;
}
