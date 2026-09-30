const app = getApp();
const { activityStatusText } = require('../../../utils/activity-status');
const policy = require('../../../utils/identity/identity-policy.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const { isRecord, isRecordList } = require('../../../utils/response-shape.js');

const BC_ST = { 0: '草稿', 1: '待发', 2: '已发', 3: '已撤' };
const ROLE = { player: '玩家', club: '俱乐部', merchant: '商家' };

function hasUsableId(value) {
  if (Number.isInteger(value)) return value > 0;
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function finiteCount(value) {
  return Number.isInteger(value) && value >= 0;
}

function nonBlank(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function validPayload(data) {
  return isRecord(data)
    && isRecordList(data.events)
    && isRecordList(data.broadcasts)
    && data.events.every(item => hasUsableId(item.id))
    && data.broadcasts.every(item => hasUsableId(item.id));
}

Page({
  data: {
    events: [],
    broadcasts: [],
    loading: true,
    refreshing: false,
    hasLoaded: false,
    error: '',
    isMerchantViewer: false,
  },

  onLoad() { this._unloaded = false; this.syncViewerTheme(); this.fetch(); },
  onShow() { this.syncViewerTheme(); if (this._loaded) this.fetch(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    merchantTheme.merchantPageRestore();
    this._unloaded = true;
    this._fetchSeq = (this._fetchSeq || 0) + 1;
  },

  syncViewerTheme() {
    const isMerchantViewer = policy.isMerchantView({
      role: app.getUserRole(),
      userType: app.getUserType(),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    this.setData({ isMerchantViewer });
    if (isMerchantViewer) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
  },

  onPullDownRefresh() { this.fetch(); },

  fetch() {
    const requestId = (this._fetchSeq || 0) + 1;
    this._fetchSeq = requestId;
    const hasLoaded = !!this.data.hasLoaded;
    if (hasLoaded) this.setData({ loading: false, refreshing: true });
    else this.setData({ loading: true, refreshing: false, error: '' });
    const isCurrent = () => !this._unloaded && requestId === this._fetchSeq;
    app.sendRequest({
      // 下拉刷新的收圈绑在真实完成上;非下拉场景下 stopPullDownRefresh 是 no-op
      complete() { wx.stopPullDownRefresh(); },
      url: '/api/official/my-published', method: 'GET', hideLoading: true, silentError: true,
      success: (res) => {
        if (!isCurrent()) return;
        const data = res && res.data;
        if (res && (res.code == 200 || res.code == '200') && validPayload(data)) {
          this.setData({
            events: data.events.map(this._decoEvent),
            broadcasts: data.broadcasts.map(this._decoBc),
            loading: false,
            refreshing: false,
            hasLoaded: true,
            error: '',
          });
          this._loaded = true;
        } else this._setFetchFailure(res, hasLoaded, requestId);
      },
      fail: (res) => this._setFetchFailure(res, hasLoaded, requestId),
    });
  },

  _setFetchFailure(res, hasLoaded, requestId) {
    if (this._unloaded || requestId !== this._fetchSeq) return;
    const message = app.getRequestErrorMessage(res, '发布记录加载失败');
    if (hasLoaded) this.setData({ loading: false, refreshing: false });
    else this.setData({ loading: false, refreshing: false, error: message });
  },

  _decoEvent(event) {
    const status = Number.isInteger(event.status) ? activityStatusText(event.status, 'owner') : '';
    return Object.assign({}, event, {
      _title: nonBlank(event.title, '未命名官方活动'),
      _city: nonBlank(event.city, '城市待确认'),
      _category: nonBlank(event.category, ''),
      _st: status || '状态待确认',
    });
  },

  _decoBc(b) {
    const audience = typeof b.audience === 'string'
      ? b.audience.split(',').map(item => item.trim()).filter(Boolean)
      : [];
    const audienceKnown = audience.length > 0 && audience.every(item => ROLE[item]);
    return Object.assign({}, b, {
      _title: nonBlank(b.title, '未命名官方通知'),
      _aud: audienceKnown ? audience.map(item => ROLE[item]).join(' / ') : '对象待确认',
      _mode: b.copyMode === 2 ? '分开发' : (b.copyMode === 1 ? '一起发' : '发送方式待确认'),
      _st: Number.isInteger(b.status) && BC_ST[b.status] ? BC_ST[b.status] : '状态待确认',
      _reach: finiteCount(b.reachedCount) ? '站内触达 ' + b.reachedCount + ' 人' : '站内触达人数待确认',
      _city: nonBlank(b.city, '范围待确认'),
    });
  },

  openEvent(e) {
    wx.navigateTo({ url: '/pages/activity/official-detail/index?id=' + e.currentTarget.dataset.id });
  },
});
