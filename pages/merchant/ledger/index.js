const toast = require('../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const subscribe = require('../../../utils/subscribe.js');
const { normalizeMerchantFinanceRoute, isFinancePagePayload, isFinanceObjectPayload, money } = require('../utils/merchant-finance.js');
const { normalizeMerchantAccess } = require('../../../utils/merchant-access-policy.js');
// UI-06(2026-09-18 用户走查):退款售后不再单独一张卡,并进核销记录的 全部/待处理/已处理 三个 tab。
// 复用售后列表页的同一份行解析,不在台账里再写一套字段兜底。
const { shapeAftercareListPage } = require('../aftercare/detail/view-model.js');

const PAGE_SIZE = 20;
// 售后三个 bucket 都要拉:待处理 = 待回应 + 处理中,已处理 = 已完成。
const REFUND_BUCKETS = ['PENDING', 'PROCESSING', 'COMPLETED'];

function currentMemberId() {
  if (typeof app.getUserID !== 'function') return '';
  const memberId = app.getUserID();
  return memberId === null || memberId === undefined ? '' : String(memberId);
}

function isAccessDenied(res) {
  const code = res && (res.code !== undefined ? res.code : res.statusCode);
  return String(code) === '401' || String(code) === '403';
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    view: 'redemptions',
    source: '',
    // CU-M-184:UI-06 把退款并进这本列表后,标题只写「核销记录」会让人以为 3 笔含退款。
    pageTitle: '核销与退款',
    routeError: false,
    loading: true,
    error: false,
    hasLoaded: false,
    merchantAccess: { canReadAftercare: false },
    redemptions: [],
    redemptionGroups: [],
    summary: null,
    redemptionFilter: 'all',
    redemptionTabs: [
      { key: 'all', label: '全部' },
      { key: 'pending', label: '待处理' },
      { key: 'handled', label: '已处理' },
      { key: 'no_cash', label: '不结现金' }
    ],
    overview: null,
    entries: [],
    batches: [],
    settlementErrors: { overview: '', entries: '', batches: '' },
    settlementLoading: { overview: false, entries: false, batches: false },
    settleAlertsEnabled: false,
    settleAlertsLoading: false,
  },

  onLoad(options) {
    this._unloaded = false;
    this._skipNextShowReload = true;
    this._scopeMemberId = currentMemberId();
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sys.statusBarHeight || 20, navBarHeight: app.globalData.navBarHeight || 44 });
    const route = normalizeMerchantFinanceRoute(options);
    if (!route) {
      this.setData({ routeError: true, loading: false, error: false, pageTitle: '结算' });
      return;
    }
    this.setData({ view: route.view, source: route.source, pageTitle: route.view === 'redemptions' ? '核销与退款' : (route.view === 'settlement' ? '结算' : '消息与动态') });
    this.revalidateCurrentView();
  },

  onShow() {
    merchantTheme.merchantPageShow();
    if (this.data.view === 'settlement') this.syncCoopSettleAlertSetting();
    const memberId = currentMemberId();
    if (this._scopeMemberId === undefined) {
      this._scopeMemberId = memberId;
      return;
    }
    if (memberId !== this._scopeMemberId) {
      this._skipNextShowReload = false;
      this._resetMemberScope(memberId);
      if (!this.data.routeError) this.revalidateCurrentView();
      return;
    }
    if (this._skipNextShowReload) {
      this._skipNextShowReload = false;
      return;
    }
    if (!this.data.routeError) this.revalidateCurrentView();
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._unloaded = true;
    merchantTheme.merchantPageRestore();
    this._invalidateScopedRequests();
  },
  _invalidateScopedRequests() {
    this._identityEpoch = (this._identityEpoch || 0) + 1;
    this._redemptionEpoch = (this._redemptionEpoch || 0) + 1;
    const epochs = this._settlementSectionEpoch || {};
    ['overview', 'entries', 'batches'].forEach((section) => { epochs[section] = (epochs[section] || 0) + 1; });
    this._settlementSectionEpoch = epochs;
  },
  onNavBack() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.reLaunch({ url: '/pages/merchant/index/index' }); },
  retry() { this.revalidateCurrentView(); },

  _resetMemberScope(memberId) {
    this._scopeMemberId = memberId;
    this._invalidateScopedRequests();
    this._clearScopedData(true, false);
  },

  _clearScopedData(loading, error) {
    this._redemptionRows = [];
    this._refundRows = [];
    this.setData({
      loading,
      error,
      hasLoaded: false,
      redemptions: [],
      redemptionGroups: [],
      summary: null,
      overview: null,
      entries: [],
      batches: [],
      settlementErrors: { overview: '', entries: '', batches: '' },
      settlementLoading: { overview: false, entries: false, batches: false },
    });
  },

  _denyMerchantAccess() {
    this._invalidateScopedRequests();
    this._clearScopedData(false, true);
  },

  _isCurrentMemberScope(memberId) {
    return !this._unloaded
      && memberId === this._scopeMemberId
      && memberId === currentMemberId();
  },

  request(url, data, done) {
    app.sendRequest({
      hideLoading: true, url, method: 'POST', data: JSON.stringify(data || {}), header: { 'Content-Type': 'application/json' },
      success: done,
      fail: (error) => done(error || null),
    });
  },

  _verifyMerchantAccess(onAllowed) {
    const memberId = this._scopeMemberId === undefined
      ? currentMemberId()
      : this._scopeMemberId;
    this._scopeMemberId = memberId;
    // 同页不同区块允许并行重试；generation 只在换主体、拒权或卸载时递增。
    this._identityEpoch = this._identityEpoch || 0;
    const identityEpoch = this._identityEpoch;
    const isCurrent = () => identityEpoch === this._identityEpoch
      && this._isCurrentMemberScope(memberId);
    this.setData({ loading: true, error: false });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      success: (res) => {
        if (!isCurrent()) return;
        const access = (res && (res.code === '200' || res.code === 200))
          ? normalizeMerchantAccess(res.data) : { active: false };
        const allowed = access.active && (this.data.view === 'settlement'
          ? access.canReadFinance
          : (this.data.view === 'redemptions' ? access.canReadVerifyRecords : access.canReadBasic));
        if (!allowed) {
          this._denyMerchantAccess();
          return;
        }
        if (this.data.view === 'redemptions' && !access.canReadFinance) {
          this.setData({
            merchantAccess: access,
            redemptionFilter: 'all',
            redemptions: [],
            redemptionGroups: [],
            summary: null,
            hasLoaded: false,
          });
        } else {
          this.setData({ merchantAccess: access });
        }
        onAllowed();
      },
      fail: (error) => {
        if (!isCurrent()) return;
        if (isAccessDenied(error)) this._denyMerchantAccess();
        else this.setData({ loading: false, error: true });
      },
    });
  },

  revalidateCurrentView() {
    // 整页重验（含筛选切换）每次推进代次：旧身份探针即使迟到拒绝，也不能清掉
    // 新筛选已经确认的资金态。三个 settlement 局部重试仍直接走 _verifyMerchantAccess，
    // 不推进这里的代次，因此不同区块可以并行完成。
    this._identityEpoch = (this._identityEpoch || 0) + 1;
    this._verifyMerchantAccess(() => this.loadCurrentView());
  },

  loadCurrentView() {
    if (this.data.view === 'messages') { this.setData({ loading: false, error: false }); return; }
    if (this.data.view === 'settlement') return this.loadSettlement();
    this.loadRedemptions();
  },

  loadRedemptions() {
    const scopeMemberId = this._scopeMemberId === undefined
      ? currentMemberId()
      : this._scopeMemberId;
    this._scopeMemberId = scopeMemberId;
    const epoch = (this._redemptionEpoch || 0) + 1;
    this._redemptionEpoch = epoch;
    const canReadFinance = Boolean(this.data.merchantAccess.canReadFinance);
    const filter = canReadFinance ? this.data.redemptionFilter : 'all';
    this._redemptionRows = [];
    this._refundRows = [];
    this.setData({ loading: true, error: false });
    this.request('/api/merchant/finance/redemptions', { pageNum: 1, pageSize: PAGE_SIZE, filter }, (res) => {
      if (!this._isCurrentMemberScope(scopeMemberId)
        || epoch !== this._redemptionEpoch
        || filter !== (this.data.merchantAccess.canReadFinance ? this.data.redemptionFilter : 'all')) return;
      if (isAccessDenied(res)) { this._denyMerchantAccess(); return; }
      if (!isFinancePagePayload(res)) { this.setData({ loading: false, error: true }); return; }
      this._redemptionRows = res.data.rows.map((row) => this.redemptionRow(row, canReadFinance));
      // 汇总条只认服务端聚合:前端拿到的 rows 只是当前页,自己求和分页后必错且错得静默。
      this._applyRedemptionView({
        summary: summaryView(res.data.summary, canReadFinance),
        loading: false, error: false, hasLoaded: true,
      });
      if (this.data.merchantAccess.canReadAftercare) this._loadRefundRows(scopeMemberId, epoch, canReadFinance);
    });
  },

  // 售后退款行并进同一份列表(UI-06):待处理 = PENDING + PROCESSING,已处理 = COMPLETED。
  // 三个 bucket 并发拉,全到齐才重排一次,避免逐 bucket 追加造成顺序闪跳。
  _loadRefundRows(scopeMemberId, epoch, canReadFinance) {
    let pending = REFUND_BUCKETS.length;
    let failed = false;
    const items = [];
    const finish = () => {
      pending -= 1;
      if (pending > 0) return;
      if (!this._isCurrentMemberScope(scopeMemberId) || epoch !== this._redemptionEpoch) return;
      this._refundRows = items.map((item) => this.refundRow(item, canReadFinance));
      this._applyRedemptionView(failed ? { error: true } : {});
    };
    REFUND_BUCKETS.forEach((bucket) => {
      this.request(`/api/merchant/aftercare/list?bucket=${bucket}&pageNum=1&pageSize=${PAGE_SIZE}`, {}, (res) => {
        if (isAccessDenied(res)) { failed = true; finish(); return; }
        const shaped = res && (res.code === 200 || res.code === '200')
          ? shapeAftercareListPage(res.data, bucket) : null;
        if (!shaped) { failed = true; finish(); return; }
        items.push.apply(items, shaped.items);
        finish();
      });
    });
  },

  // 把核销 base 行与退款行合成最终视图;退款只在 全部/待处理/已处理 出现,不结现金 tab 不掺退款。
  // setData 逐字段静态写，便于门禁核对消费关系。
  _applyRedemptionView(patch) {
    const source = patch || {};
    const filter = this.data.merchantAccess.canReadFinance ? this.data.redemptionFilter : 'all';
    const refunds = filter === 'no_cash' ? [] : (this._refundRows || []).filter((row) => {
      if (filter === 'pending') return row.refundBucket !== 'COMPLETED';
      if (filter === 'handled') return row.refundBucket === 'COMPLETED';
      return true;
    });
    const rows = (this._redemptionRows || []).concat(refunds);
    rows.sort((a, b) => String(b.sortKey || '').localeCompare(String(a.sortKey || '')));
    const has = (key) => Object.prototype.hasOwnProperty.call(source, key);
    this.setData({
      redemptions: rows,
      redemptionGroups: groupByDay(rows),
      summary: has('summary') ? source.summary : this.data.summary,
      loading: has('loading') ? source.loading : this.data.loading,
      error: has('error') ? source.error : this.data.error,
      hasLoaded: has('hasLoaded') ? source.hasLoaded : this.data.hasLoaded,
    });
  },

  loadSettlement() {
    this._loadSettlementSections(['overview', 'entries', 'batches']);
  },

  retrySettlementOverview() { this._verifyMerchantAccess(() => this._loadSettlementSections(['overview'])); },
  retrySettlementEntries() { this._verifyMerchantAccess(() => this._loadSettlementSections(['entries'])); },
  retrySettlementBatches() { this._verifyMerchantAccess(() => this._loadSettlementSections(['batches'])); },

  _loadSettlementSections(sections) {
    const scopeMemberId = this._scopeMemberId === undefined
      ? currentMemberId()
      : this._scopeMemberId;
    this._scopeMemberId = scopeMemberId;
    const sectionEpochs = this._settlementSectionEpoch || {};
    const requestEpochs = {};
    sections.forEach((section) => {
      requestEpochs[section] = (sectionEpochs[section] || 0) + 1;
      sectionEpochs[section] = requestEpochs[section];
    });
    this._settlementSectionEpoch = sectionEpochs;
    const loadingState = Object.assign({}, this.data.settlementLoading);
    const errorState = Object.assign({}, this.data.settlementErrors);
    sections.forEach((section) => {
      loadingState[section] = true;
      errorState[section] = '';
    });
    this.setData({ loading: true, error: false, settlementLoading: loadingState, settlementErrors: errorState });

    const errorCopy = {
      overview: '结算概览暂未取回',
      entries: '收入明细暂未取回',
      batches: '对公结算暂未取回',
    };
    let pending = sections.length;
    let anySuccess = false;

    const finishOne = (patch) => {
      pending -= 1;
      const nextLoading = patch.settlementLoading || this.data.settlementLoading;
      const nextErrors = patch.settlementErrors || this.data.settlementErrors;
      let loading = this.data.loading;
      let error = this.data.error;
      let hasLoaded = this.data.hasLoaded;
      hasLoaded = this.data.hasLoaded || anySuccess;
      if (pending === 0) {
        loading = Object.keys(nextLoading).some((key) => Boolean(nextLoading[key]));
        error = Object.keys(nextErrors).some((key) => Boolean(nextErrors[key]));
      }
      this.setData({
        settlementLoading: nextLoading,
        settlementErrors: nextErrors,
        loading,
        error,
        hasLoaded,
        overview: Object.prototype.hasOwnProperty.call(patch, 'overview') ? patch.overview : this.data.overview,
        entries: Object.prototype.hasOwnProperty.call(patch, 'entries') ? patch.entries : this.data.entries,
        batches: Object.prototype.hasOwnProperty.call(patch, 'batches') ? patch.batches : this.data.batches,
      });
    };

    sections.forEach((section) => {
      const acceptResponse = (res) => {
        if (!this._isCurrentMemberScope(scopeMemberId)) return;
        if (isAccessDenied(res)) { this._denyMerchantAccess(); return; }
        if (requestEpochs[section] !== (this._settlementSectionEpoch || {})[section]) {
          finishOne({});
          return;
        }
        const valid = section === 'overview' ? isFinanceObjectPayload(res) : isFinancePagePayload(res);
        const nextErrors = Object.assign({}, this.data.settlementErrors, {
          [section]: valid ? '' : errorCopy[section],
        });
        const nextLoading = Object.assign({}, this.data.settlementLoading, { [section]: false });
        const patch = { settlementErrors: nextErrors, settlementLoading: nextLoading };

        if (valid) {
          anySuccess = true;
          if (section === 'overview') {
            patch.overview = this.overviewRow(res.data);
          } else if (section === 'entries') {
            patch.entries = res.data.rows.map(this.entryRow);
          } else {
            patch.batches = res.data.rows.map(this.batchRow);
          }
        }

        finishOne(patch);
      };
      if (section === 'overview') {
        this.request('/api/merchant/finance/overview', {}, acceptResponse);
      } else if (section === 'entries') {
        this.request('/api/merchant/finance/settlement-entries', {
          pageNum: 1, pageSize: PAGE_SIZE, source: this.data.source || 'all',
        }, acceptResponse);
      } else if (section === 'batches') {
        this.request('/api/merchant/finance/public-transfer-batches', {
          pageNum: 1, pageSize: PAGE_SIZE,
        }, acceptResponse);
      }
    });
  },

  overviewRow(row) {
    const rawNet = row.personalArrivedThisMonthNet;
    const net = rawNet === null || rawNet === undefined || rawNet === '' ? null : Number(rawNet);
    const netLabel = net === null || !Number.isFinite(net) ? '状态待定' : (net < 0 ? '净调整' : '净入账');
    return Object.assign({}, row, {
      netLabel,
      hasAdjustmentPending: Number(row.adjustmentPending) > 0,
      hasPersonalAdjustment: Number(row.personalExecutedAdjustmentsThisMonth) !== 0,
      personalNetDisplay: moneyDisplay(row.personalArrivedThisMonthNet),
      publicPendingDisplay: moneyDisplay(row.publicPayablePending),
      personalGrossDisplay: moneyDisplay(row.personalArrivedThisMonthGross),
      personalAdjustmentDisplay: moneyDisplay(row.personalExecutedAdjustmentsThisMonth),
      adjustmentPendingDisplay: moneyDisplay(row.adjustmentPending),
    });
  },

  // 退款行(UI-06):复用售后列表的字段,只加台账需要的排序/分组/跳转字段。
  // 标题与状态都带「退款」前缀 —— 混在核销记录里必须一眼看出这是退款,点进售后详情。
  refundRow(row, canReadFinance) {
    const item = Object.assign({}, row);
    const amount = row.amountCents == null ? null : (row.amountCents / 100).toFixed(2);
    const title = row.titleText || row.refundNoText || ('#' + row.refundId);
    return Object.assign(item, {
      recordKey: 'aftercare:' + row.refundId,
      recordType: 'aftercare',
      recordId: row.refundId,
      refundBucket: row.bucket,
      title: '退款 · ' + title,
      customerDisplayName: row.activityTitleText || row.sourceText || '',
      timeText: row.timeText,
      dayKey: row.dateKey,
      sortKey: row.createTimeText,
      stateText: '退款 · ' + (row.statusText || '状态待确认'),
      stateVariant: row.statusTone || 'neutral',
      amountText: amount,
      amountDisplay: canReadFinance === false ? null : (amount == null ? '待定' : '¥' + amount),
      amountTone: amount == null ? 'mute' : 'neg',
    });
  },
  redemptionRow(row, canReadFinance) {
    const financeVisible = canReadFinance !== false;
    const item = Object.assign({}, row);
    item.amountText = row.settlementAmount == null || Number(row.settlementAmount) === 0 ? null : money(row.settlementAmount);
    item.amountPrefix = item.amountText != null && Number(item.amountText) >= 0 ? '+' : '';
    // 右列只放金额,一列一语义;金额未成立也占位,右缘才有稳定对齐线。
    // 两种未成立要分开:明确不产生现金 → 破折号;金额尚未成立(①②待主题结算)→「待定」。
    item.amountDisplay = item.amountText != null ? `${item.amountPrefix}¥${item.amountText}`
      : (row.displayState === 'NO_CASH_SETTLEMENT' ? '—' : '待定');
    item.amountTone = item.amountText == null ? 'mute' : (Number(item.amountText) < 0 ? 'neg' : 'pos');
    item.dayKey = row.occurredAt ? String(row.occurredAt).slice(0, 10) : '';
    item.timeText = row.occurredAt ? String(row.occurredAt).slice(11, 16) : '';
    item.sortKey = row.occurredAt ? String(row.occurredAt).slice(0, 16) : '';
    item.title = [row.topicName, row.chapterName].filter(Boolean).join(' · ') || '核销记录';
    if (!financeVisible) {
      item.amountText = null;
      item.amountPrefix = '';
      item.amountDisplay = null;
      item.amountTone = 'mute';
      item.stateText = row.fulfillmentState === 'REVERSED'
        ? '核销已撤销' : (row.fulfillmentState === 'ACTIVE' ? '核销有效' : '核销状态待确认');
      item.stateVariant = row.fulfillmentState === 'ACTIVE' ? 'success' : 'neutral';
      return item;
    }
    // 状态从副文里拿出来变 chip:副文只留「谁 · 几点」,长句不再和金额抢右对齐位。
    item.stateText = financeStateText(row);
    item.stateVariant = stateVariant(row.displayState);
    return item;
  },
  entryRow(row) {
    const item = Object.assign({}, row);
    item.amountText = money(row.signedAmount);
    item.amountPrefix = item.amountText != null && Number(item.amountText) >= 0 ? '+' : '';
    item.amountDisplay = item.amountText == null ? '待定' : `${item.amountPrefix}¥${item.amountText}`;
    item.amountTone = item.amountText == null ? 'mute' : (Number(item.amountText) < 0 ? 'neg' : 'pos');
    item.timeText = row.occurredAt ? String(row.occurredAt).slice(5, 10) : '';
    item.sourceText = { REDEMPTION_FEE: '核销计酬', COOP_SHARE: '合作分润', ACTIVITY_SHARE: '活动分润', MERCHANT_CLAWBACK: '已执行扣划' }[row.source] || '调整';
    item.stateText = financeStateText(row);
    item.stateVariant = stateVariant(row.displayState);
    return item;
  },
  batchRow(row) {
    const item = Object.assign({}, row);
    item.amountText = money(row.amountTotal);
    item.amountDisplay = item.amountText == null ? '待定' : `¥${item.amountText}`;
    item.tone = row.displayState === 'LEDGER_ERROR' ? 'void' : (row.paymentState === 'PAID' ? 'settled' : 'pending');
    item.stateText = row.displayState === 'LEDGER_ERROR' ? '结算数据对不上，请联系客服' : (row.netDirection === 'ZERO' ? '本期无需打款' : (row.netDirection === 'MERCHANT_OWES_PLATFORM' ? '调整待处理' : batchStateText(row)));
    item.stateVariant = row.displayState === 'LEDGER_ERROR' ? 'danger'
      : (row.paymentState === 'PAID' ? 'success' : 'warning');
    item.invoiceText = { NONE: '未开票', ISSUED: '已开票', RED: '已红冲' }[row.invoiceState] || '';
    return item;
  },

  onRedemptionFilter(event) {
    if (!this.data.merchantAccess.canReadFinance) {
      if (this.data.redemptionFilter !== 'all') this.setData({ redemptionFilter: 'all' });
      return;
    }
    // 筛选值在身份探针返回前就已变化；先推进 epoch，避免 all → pending → all
    // 快速往返时，最早那次 all 响应因 key 再次相同而误写回新视图。
    this._redemptionEpoch = (this._redemptionEpoch || 0) + 1;
    this.setData({
      loading: true,
      error: false,
      redemptionFilter: event.detail.key,
      hasLoaded: false,
      redemptions: [],
      redemptionGroups: [],
      summary: null,
    });
    this.revalidateCurrentView();
  },
  goRedemptionDetail(event) {
    const item = event.currentTarget.dataset.item;
    if (!item) return;
    // 退款条目仍回原来的售后详情页(UI-06),不能拿退款单号去查核销详情。
    if (item.recordType === 'aftercare') {
      if (!item.refundId) return;
      wx.navigateTo({ url: `/pages/merchant/aftercare/detail/index?refundId=${item.refundId}` });
      return;
    }
    if (!item.recordType || !item.recordId) return;
    wx.navigateTo({ url: `/pages/merchant/ledger/order-detail/index?recordType=${item.recordType}&recordId=${item.recordId}` });
  },
  goBatchDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (id === null || id === undefined || id === '') return;
    wx.navigateTo({ url: `/pages/merchant/ledger/batch-detail/index?batchId=${id}` });
  },
  goAssets() { wx.navigateTo({ url: '/subpackageA/pages/assetcenter/earnings/index' }); },
  goInbox() { wx.navigateTo({ url: '/subpackageB/pages/im/list/index' }); },
  syncCoopSettleAlertSetting() {
    const templateId = subscribe.TEMPLATES && subscribe.TEMPLATES.coopSettle;
    if (!templateId || typeof wx.getSetting !== 'function') return;
    wx.getSetting({
      withSubscriptions: true,
      success: (res) => {
        const settings = res && res.subscriptionsSetting;
        const itemSettings = settings && settings.itemSettings;
        this.setData({
          settleAlertsEnabled: !!(settings && settings.mainSwitch !== false
            && itemSettings && itemSettings[templateId] === 'accept'),
        });
      },
    });
  },
  enableCoopSettleAlerts(event) {
    const enabled = !!(event && event.detail && event.detail.value);
    if (!enabled) {
      this.setData({ settleAlertsLoading: true });
      if (typeof wx.openSetting !== 'function') {
        this.setData({ settleAlertsLoading: false });
        return;
      }
      wx.openSetting({
        withSubscriptions: true,
        success: () => this.syncCoopSettleAlertSetting(),
        complete: () => this.setData({ settleAlertsLoading: false }),
      });
      return;
    }
    this.setData({ settleAlertsLoading: true });
    return subscribe.request(['coopSettle']).then((result) => {
      if (result && Array.isArray(result.acceptedKeys) && result.acceptedKeys.includes('coopSettle')) {
        this.setData({ settleAlertsEnabled: true });
        toast('已开启到账提醒');
      } else {
        this.setData({ settleAlertsEnabled: false });
      }
      return result;
    }).finally(() => this.setData({ settleAlertsLoading: false }));
  },
});

/** displayState → chip 语义色。1:1 映射,不含业务判断(零现金的具体原因仍由服务端 noCashReason 给)。 */
function stateVariant(displayState) {
  return {
    PENDING_SETTLEMENT: 'warning',
    SETTLED: 'success',
    ADJUSTMENT_PENDING: 'danger',
    ADJUSTED: 'neutral',
    REVERSED_BEFORE_SETTLEMENT: 'neutral',
    NO_CASH_SETTLEMENT: 'neutral',
    LEDGER_ERROR: 'danger',
  }[displayState] || 'neutral';
}

/** 按自然日分组(一组一卡),日期取服务端下发的 occurredAt 前 10 位,不在前端做时区换算。 */
function groupByDay(rows) {
  const groups = [];
  let current = null;
  rows.forEach((row) => {
    if (!current || current.dayKey !== row.dayKey) {
      current = { dayKey: row.dayKey, dayLabel: dayLabel(row.dayKey), rows: [] };
      groups.push(current);
    }
    current.rows.push(row);
  });
  return groups;
}
function dayLabel(dayKey) {
  if (!dayKey) return '未标注日期';
  const parts = String(dayKey).split('-');
  return parts.length === 3 ? `${parts[1]} 月 ${parts[2]} 日` : dayKey;
}

/** 汇总条:只渲染服务端算好的三个数,缺字段就整条不显示(不猜、不用当前页求和)。 */
function summaryView(summary, canReadFinance) {
  if (!summary) return null;
  const count = Number(summary.count);
  if (!Number.isInteger(count) || count < 0) return null;
  if (!canReadFinance) return { countText: `${count} 笔` };
  const pending = money(summary.pendingAmount);
  const arrived = money(summary.arrivedAmount);
  if (pending == null || arrived == null) return null;
  return {
    countText: `${count} 笔`,
    pendingDisplay: `¥${pending}`,
    arrivedDisplay: `¥${arrived}`,
  };
}

function moneyDisplay(value) {
  const amount = money(value);
  return amount == null ? '待定' : `¥${amount}`;
}

function financeStateText(item) {
  if (item.displayState === 'NO_CASH_SETTLEMENT') {
    if (item.noCashReason) return item.noCashReason;
    console.warn('资金域零现金记录缺少 noCashReason');
    return '本次不产生现金结算';
  }
  return {
    PENDING_SETTLEMENT: item.settlementRoute === 'COOP_ORDER' ? '待主题结算' : '待结算',
    SETTLED: item.destination === 'PERSONAL_ACCOUNT' ? '已入个人账户' : '平台已打款',
    ADJUSTMENT_PENDING: '调整中', ADJUSTED: '已调整', REVERSED_BEFORE_SETTLEMENT: '核销已撤销', LEDGER_ERROR: '结算数据对不上，请联系客服',
  }[item.displayState] || '状态待确认';
}
function batchStateText(batch) {
  if (batch.holdState === 'FROZEN') return '结算处理中';
  if (batch.paymentState === 'PAID') return batch.invoiceState === 'ISSUED' ? '平台已打款 · 已开票' : '平台已打款 · 未开票';
  if (batch.paymentState === 'CONFIRMED') return '已确认';
  return '待对账';
}
