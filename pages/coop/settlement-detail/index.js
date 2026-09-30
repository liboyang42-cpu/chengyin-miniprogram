const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const {
  buildMerchantSettlementDetail,
  buildHostSettlementDetail,
  buildClubSettlementDetail,
} = require('../components/settlement-detail/view-model.js');

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value) {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isCanonicalStatus(value) {
  return value === 0 || value === 1 || value === 2
    || value === '0' || value === '1' || value === '2';
}

function isMerchantSettlement(record) {
  if (!isRecord(record) || !isPositiveInteger(record.id)
      || !isNonNegativeNumber(record.verifiedSales)
      || !isNonNegativeInteger(record.verifiedHeads)
      || !isNonNegativeNumber(record.amount)
      || !isCanonicalStatus(record.status)
      || !isCanonicalStatus(record.shareMode)) {
    return false;
  }
  const shareMode = Number(record.shareMode);
  if (shareMode === 1) {
    return isNonNegativeNumber(record.shareRate) && Number(record.shareRate) <= 100;
  }
  if (shareMode === 2) return isNonNegativeNumber(record.fixedFee);
  return true;
}

function isHostSettlement(record) {
  if (!isRecord(record) || !isPositiveInteger(record.topicId)
      || typeof record.settled !== 'boolean'
      || typeof record.myIncomeArrived !== 'boolean') {
    return false;
  }
  const knownAmounts = ['totalSales', 'verifiedSales', 'platformAmount', 'merchantTotal'];
  if (!knownAmounts.every(function (key) { return isNonNegativeNumber(record[key]); })) return false;
  return record.settled ? isNonNegativeNumber(record.myIncome) : record.myIncome == null;
}

// CU-C-41(用户裁决 A):俱乐部分润行的明细来自 /api/club/settlement/summary ——
// 金额全部是服务端已格式化字符串,这里只判「齐不齐」,不做任何金额运算/兜底。
function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isClubSettlement(record) {
  if (!isRecord(record) || !isPositiveInteger(record.topicId) || !isNonEmptyText(record.name)) return false;
  if (record.status !== 'pending' && record.status !== 'settled' && record.status !== 'void') return false;
  const texts = ['originalAmountText', 'executedAdjustmentText', 'netAmountText', 'arrivedText', 'paidText'];
  if (!texts.every(function (key) { return isNonEmptyText(record[key]); })) return false;
  // 未核验的金额只允许出现在已结算行,且必须明确是 null(不能是 0,也不能缺字段)
  if (record.amountStatus === 'unverified') return record.status === 'settled' && record.amountText === null;
  if (record.amountStatus !== 'verified' || !isNonEmptyText(record.amountText)) return false;
  return true;
}

function isSettlementList(value, source) {
  if (!Array.isArray(value)) return false;
  const valid = source === 'finance' ? isHostSettlement : (source === 'club' ? isClubSettlement : isMerchantSettlement);
  return value.every(valid);
}

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    source: '',
    recordId: '',
    detail: null,
    // loading / refreshing / ready / stale-error / error / missing-param / missing-record
    loadState: 'loading',
    errorKind: 'data',
    errorText: '',
  },

  onLoad(options) {
    // CU-C-41(用户裁决 A):来源三档 —— ledger(商家台账 /api/coop/mybiz)、
    // finance(主办分润 /api/coop/finance)、club(俱乐部分润 /api/club/settlement/summary)。
    const raw = options && options.source;
    const source = raw === 'finance' || raw === 'club' ? raw : 'ledger';
    // 俱乐部汇总是「一条 coop_settlement 一行」,同一主题可能多行 ⇒ 有 id 就按 id 取(topicId 只作旧链接兜底)
    const clubById = source === 'club' && options && options.id != null && options.id !== '';
    this._recordKey = source === 'ledger' || clubById ? 'id' : 'topicId';
    const recordId = source === 'ledger' || clubById ? (options && options.id) : (options && options.topicId);
    const clubId = source === 'club' ? Number(options && options.clubId) : null;
    const hasClubId = clubId !== null && isPositiveInteger(clubId);
    this.setData({
      source,
      recordId: recordId == null ? '' : String(recordId),
    });
    this._clubId = hasClubId ? clubId : '';   // 只给请求与返回路径用,不进视图
    // 俱乐部视角没有 clubId 取不到数(后端按 clubId 做范围校验),别发注定失败的请求
    if (recordId == null || recordId === '' || (source === 'club' && !hasClubId)) {
      this.setData({ loadState: 'missing-param', errorText: '缺少结算记录标识' });
      return;
    }
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

  onNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else if (this.data.source === 'club') wx.reLaunch({ url: '/pages/club/settlement/index?clubId=' + this._clubId });
    else wx.reLaunch({ url: this.data.source === 'finance' ? '/pages/coop/finance/index' : '/pages/merchant/ledger/index?view=settlement&source=coop' });
  },

  retryLoad() { this.load(); },

  settleLoad(epoch) {
    if (epoch !== this._loadEpoch) return false;
    this._loading = false;
    wx.stopPullDownRefresh();
    return true;
  },

  load() {
    if (!this.data.recordId) {
      this.setData({ loadState: 'missing-param', errorKind: 'data', errorText: '缺少结算记录标识' });
      wx.stopPullDownRefresh();
      return;
    }
    if (this._loading) {
      wx.stopPullDownRefresh();
      return;
    }
    this._loading = true;
    const epoch = (this._loadEpoch || 0) + 1;
    this._loadEpoch = epoch;
    const source = this.data.source;
    const finance = source === 'finance';
    const club = source === 'club';
    const hasDetail = Boolean(this.data.detail);
    this.setData({
      loadState: hasDetail ? 'refreshing' : 'loading',
      errorKind: 'data',
      errorText: '',
    });
    app.sendRequest({
      hideLoading: true,
      url: club ? '/api/club/settlement/summary' : (finance ? '/api/coop/finance' : '/api/coop/mybiz'),
      method: 'POST',
      data: club ? JSON.stringify({ clubId: this._clubId }) : JSON.stringify({}),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        const key = this._recordKey || (source === 'ledger' ? 'id' : 'topicId');
        const rows = res && res.data ? (source === 'ledger' ? res.data.settlements : res.data.topics) : null;
        if (!(res && (res.code == '200' || res.code == 200) && res.data)
            || !isSettlementList(rows, source)) {
          if (!this.settleLoad(epoch)) return;
          this.setData({
            loadState: hasDetail ? 'stale-error' : 'error',
            errorKind: 'data',
            errorText: (res && res.msg) || '结算详情没加载出来',
          });
          return;
        }
        const record = (Array.isArray(rows) ? rows : []).find((item) => item && String(item[key]) === this.data.recordId);
        if (!record) {
          if (!this.settleLoad(epoch)) return;
          this.setData({
            detail: null,
            loadState: 'missing-record',
            errorKind: 'data',
            errorText: '这条结算记录不存在或已不可见',
          });
          return;
        }
        if (!this.settleLoad(epoch)) return;
        this.setData({
          detail: club ? buildClubSettlementDetail(record)
            : (finance ? buildHostSettlementDetail(record) : buildMerchantSettlementDetail(record)),
          loadState: 'ready',
          errorKind: 'data',
          errorText: '',
        });
      },
      fail: (error) => {
        const network = isTransportFailure(error);
        if (!this.settleLoad(epoch)) return;
        this.setData({
          loadState: hasDetail ? 'stale-error' : 'error',
          errorKind: network ? 'network' : 'data',
          errorText: network
            ? '网络不稳定，请检查连接后重试'
            : ((error && (error.msg || error.message)) || '结算详情没加载出来'),
        });
      },
    });
  },
});

function isTransportFailure(error) {
  return /request:fail|timeout/i.test(String(error && error.errMsg || ''));
}
