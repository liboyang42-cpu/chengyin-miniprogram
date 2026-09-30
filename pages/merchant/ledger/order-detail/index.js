const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');
const { isFinanceObjectPayload, money } = require('../../utils/merchant-finance.js');

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    recordType: '',
    recordId: '',
    detail: null,
    loadState: 'loading',
    errorKind: 'data',
    errorText: '',
  },
  onLoad(options) {
    const recordType = options && options.recordType === 'redemption' ? 'redemption' : '';
    const recordId = options && options.recordId ? String(options.recordId) : '';
    this.setData({
      recordType,
      recordId,
      loadState: recordType && recordId ? 'loading' : 'missing-param',
      errorText: recordType && recordId ? '' : '缺少核销记录标识',
    });
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
  onNavBack() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.reLaunch({ url: '/pages/merchant/ledger/index?view=redemptions' }); },
  load() {
    if (!this.data.recordType || !this.data.recordId) {
      this.setData({ loadState: 'missing-param', errorKind: 'data', errorText: '缺少核销记录标识' });
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
    app.sendRequest({ hideLoading: true, autoErrorToast: false, url: '/api/merchant/finance/redemption-detail', method: 'POST', data: JSON.stringify({ recordType: this.data.recordType, recordId: this.data.recordId }), header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (epoch !== this._loadEpoch) return;
        const hasObjectEnvelope = isFinanceObjectPayload(res);
        if (!isRedemptionDetailPayload(res, this.data.recordType, this.data.recordId)) {
          if (!settleLoad(this, epoch)) return;
          if (isMissingRecordResponse(res)) {
            this.setData({
              detail: null,
              loadState: 'missing-record',
              errorKind: 'data',
              errorText: '这条核销记录不存在或已不可见',
            });
            return;
          }
          this.setData({
            loadState: hasDetail ? 'stale-error' : 'error',
            errorKind: 'data',
            errorText: hasObjectEnvelope
              ? '核销详情数据不完整，请重试'
              : ((res && res.msg) || '核销详情没加载出来'),
          });
          return;
        }
        const canReadFinance = hasFinanceProjection(res.data);
        const amountText = canReadFinance ? settlementAmountText(res.data) : null;
        const detail = Object.assign({}, res.data, {
          canReadFinance,
          amountText,
          amountDisplay: amountText == null ? null : `¥${amountText}`,
          title: [res.data.topicName, res.data.chapterName].filter(Boolean).join(' · ') || '核销记录',
          stateText: canReadFinance ? stateText(res.data) : fulfillmentStateText(res.data.fulfillmentState),
          stateVariant: canReadFinance
            ? stateVariant(res.data.displayState)
            : (res.data.fulfillmentState === 'ACTIVE' ? 'success' : 'neutral'),
          refundText: refundText(res.data.refundState),
          amountFallback: canReadFinance
            ? (res.data.displayState === 'NO_CASH_SETTLEMENT' ? '—' : '待定') : '',
          occurredAtText: res.data.occurredAt ? String(res.data.occurredAt).slice(0, 16).replace('T', ' ') : '',
          accrualRuleText: canReadFinance ? accrualRuleText(res.data) : '',
          timeline: canReadFinance ? buildTimeline(res.data) : [],
        });
        if (!settleLoad(this, epoch)) return;
        this.setData({ detail, loadState: 'ready', errorKind: 'data', errorText: '' });
      },
      fail: (error) => {
        const network = isTransportFailure(error);
        if (!settleLoad(this, epoch)) return;
        if (isMissingRecordResponse(error)) {
          this.setData({
            detail: null,
            loadState: 'missing-record',
            errorKind: 'data',
            errorText: '这条核销记录不存在或已不可见',
          });
          return;
        }
        this.setData({
          loadState: hasDetail ? 'stale-error' : 'error',
          errorKind: network ? 'network' : 'data',
          errorText: network
            ? '网络不稳定，请检查连接后重试'
            : ((error && (error.msg || error.message)) || '核销详情没加载出来'),
        });
      },
    });
  },
  retryLoad() { this.load(); },
  goAssets() { wx.navigateTo({ url: '/subpackageA/pages/assetcenter/earnings/index' }); },
});
function settlementAmountText(detail) {
  if (detail.displayState === 'NO_CASH_SETTLEMENT') return null;
  return money(detail.settlementAmount);
}
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
function hasFinanceProjection(detail) {
  return hasValue(detail.settlementState)
    && hasValue(detail.settlementRoute)
    && hasValue(detail.displayState);
}
function hasRedactedFinanceProjection(detail) {
  return !hasValue(detail.settlementState)
    && !hasValue(detail.settlementRoute)
    && !hasValue(detail.displayState)
    && !hasValue(detail.settlementAmount)
    && !hasValue(detail.publicSettlement);
}
function isRedemptionDetailPayload(response, expectedType, expectedId) {
  if (!isFinanceObjectPayload(response)) return false;
  const detail = response.data;
  return detail.recordType === expectedType
    && hasValue(detail.recordId)
    && String(detail.recordId) === expectedId
    && hasValue(detail.recordKey)
    && hasValue(detail.fulfillmentState)
    && (hasFinanceProjection(detail) || hasRedactedFinanceProjection(detail));
}
function fulfillmentStateText(state) {
  if (state === 'ACTIVE') return '核销有效';
  if (state === 'REVERSED') return '核销已撤销';
  return '核销状态待确认';
}
/** displayState → chip 语义色(1:1 映射,不含业务判断)。 */
function stateVariant(displayState) {
  return {
    PENDING_SETTLEMENT: 'warning', SETTLED: 'success', ADJUSTMENT_PENDING: 'danger',
    ADJUSTED: 'neutral', REVERSED_BEFORE_SETTLEMENT: 'neutral', NO_CASH_SETTLEMENT: 'neutral', LEDGER_ERROR: 'danger',
  }[displayState] || 'neutral';
}

/** 计提规则:只有服务端给了单价与人头才拼,拼不出就整行不渲染(不猜)。 */
function accrualRuleText(detail) {
  const unitFee = money(detail.unitFee);
  const hasHeadCount = detail.headCount !== null
    && detail.headCount !== undefined
    && detail.headCount !== ''
    && Number.isFinite(Number(detail.headCount));
  if (unitFee == null || !hasHeadCount) return '';
  return `¥${unitFee}/人 × ${detail.headCount}`;
}

/**
 * 结算进度 + 事件记录合成一条竖向 timeline。
 * ⚠️ 未来节点只写状态名,不给日期、不写「预计」——资金域定稿附录 C 明令:
 *    「预计打款日期」代码里不存在这条规则,凭空写是假承诺。
 */
function buildTimeline(detail) {
  if (detail.settlementRoute !== 'CHAPTER_OFFER') return [];
  const at = detail.occurredAt ? String(detail.occurredAt).slice(0, 16).replace('T', ' ') : '';
  const paidAt = detail.publicSettlement && detail.publicSettlement.paidAt
    ? String(detail.publicSettlement.paidAt).slice(0, 16).replace('T', ' ') : '';
  const nodes = [
    { label: '核销成功', at },
    { label: '生成结算单', at: '' },
    { label: '对账确认', at: '' },
    { label: '平台打款', at: paidAt },
  ];
  const step = progressStep(detail, nodes.length);
  return nodes.map((node, index) => Object.assign({}, node, {
    state: index < step.doneThrough ? 'done'
      : (step.hasCurrent && index === step.doneThrough ? 'now' : 'todo'),
  }));
}

function stateText(detail) {
  if (detail.displayState === 'NO_CASH_SETTLEMENT') {
    if (detail.noCashReason) return detail.noCashReason;
    console.warn('资金域零现金记录缺少 noCashReason');
    return '本次不产生现金结算';
  }
  return { PENDING_SETTLEMENT: '随主题结算发放至个人账户', SETTLED: detail.settlementRoute === 'CHAPTER_OFFER' ? '平台已打款' : '已入个人账户', ADJUSTMENT_PENDING: '调整中', ADJUSTED: '已调整', REVERSED_BEFORE_SETTLEMENT: '核销已撤销', LEDGER_ERROR: '结算数据对不上，请联系客服' }[detail.displayState] || '状态待确认';
}
function refundText(state) { return { REVIEWING: '审核中', REJECTED: '已驳回', REFUNDING: '退款中', REFUNDED: '已退款' }[state] || ''; }
/**
 * 按【业务事实】判断进度,不看「有没有时间戳」——时间戳只证明服务端给了这个字段,
 * 不证明那件事发生了(异常态下服务端照样可能带 paidAt)。
 *
 * doneThrough = 已经发生的节点数(画实心);
 * hasCurrent  = 第 doneThrough+1 个节点是不是「正在办」(画空心环)。
 * 流程终止的状态没有「正在办」的节点 —— 给空心环会读成「在办」,是假承诺。
 */
function progressStep(detail, total) {
  switch (detail.settlementState) {
    // ADJUSTMENT_PENDING 是「原款已结,负向调整尚未在后续去向完成」(定稿 §5.3):
    // 打款这件事已经发生,待办的是另一条去向,不在这条进度上。
    case 'SETTLED': case 'ADJUSTED': case 'ADJUSTMENT_PENDING':
      return { doneThrough: total, hasCurrent: false };
    case 'PENDING':
      return { doneThrough: 1, hasCurrent: true };
    // NOT_APPLICABLE / ERROR:核销确实发生过(实心),但后续节点不会再推进。
    default:
      return { doneThrough: 1, hasCurrent: false };
  }
}
