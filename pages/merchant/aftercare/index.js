const toast = require('../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { inactiveAccess, normalizeMerchantAccess } = require('../../../utils/merchant-access-policy.js');
const {
  filterAftercareItems,
  groupAftercareItems,
  shapeAftercareListPage,
} = require('./detail/view-model.js');

const TABS = [
  { key: 'PENDING', label: '待回应' },
  { key: 'PROCESSING', label: '处理中' },
  { key: 'COMPLETED', label: '已完成' },
];

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    tabs: TABS,
    bucket: 'PENDING',
    pageState: 'loading',
    errorMessage: '',
    items: [],
    groups: [],
    keyword: '',
    pageNum: 1,
    pageSize: 20,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._merchantAccess = inactiveAccess();
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44,
    });
    this.loadAccess();
  },

  onShow() {
    merchantTheme.merchantPageShow();
    if (this._refreshAfterDetail) {
      this._refreshAfterDetail = false;
      this.loadList(true);
    }
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  onNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/merchant/index/index' });
  },

  loadAccess() {
    this.setData({ pageState: 'loading', errorMessage: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      success: (res) => {
        if (!successObject(res)) {
          this.setData({ pageState: 'error', errorMessage: errorText(res, '经营身份加载失败') });
          return;
        }
        const access = normalizeMerchantAccess(res.data);
        this._merchantAccess = access;
        if (!access.active || !access.canReadAftercare) {
          this.setData({ pageState: 'no-permission', items: [], groups: [], hasMore: false });
          return;
        }
        this.loadList(true);
      },
      fail: () => this.setData({ pageState: 'error', errorMessage: '网络连接失败，请稍后重试' }),
    });
  },

  switchBucket(event) {
    const bucket = event && event.detail && event.detail.key;
    if (!TABS.some(item => item.key === bucket) || bucket === this.data.bucket) return;
    this.setData({ bucket, items: [], groups: [], pageNum: 1, hasMore: false });
    this.loadList(true);
  },

  retry() {
    if (this._merchantAccess && this._merchantAccess.canReadAftercare) this.loadList(true);
    else this.loadAccess();
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.loadList(false);
  },

  loadList(reset) {
    if (!this._merchantAccess || !this._merchantAccess.canReadAftercare) return;
    const bucket = this.data.bucket;
    const pageNum = reset ? 1 : this.data.pageNum + 1;
    if (reset) this.setData({ pageState: 'loading', errorMessage: '', loadingMore: false });
    else this.setData({ loadingMore: true });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/aftercare/list?bucket=${bucket}&pageNum=${pageNum}&pageSize=${this.data.pageSize}`,
      method: 'POST',
      success: (res) => {
        if (!successObject(res)) {
          this.handleListFailure(reset, errorText(res, '售后列表加载失败'));
          return;
        }
        const shaped = shapeAftercareListPage(res.data, bucket);
        if (!shaped || shaped.pageNum !== pageNum) {
          this.handleListFailure(reset, '售后列表数据不完整，请稍后重试');
          return;
        }
        const items = reset ? shaped.items : this.data.items.concat(shaped.items);
        this.setData({
          items,
          groups: groupAftercareItems(filterAftercareItems(items, this.data.keyword), new Date()),
          pageNum: shaped.pageNum,
          hasMore: shaped.hasMore,
          pageState: items.length ? 'ready' : 'empty',
          errorMessage: '',
          loadingMore: false,
        });
      },
      fail: () => this.handleListFailure(reset, '网络连接失败，请稍后重试'),
    });
  },

  onSearchInput(event) {
    const keyword = String((event && event.detail && event.detail.value) || '');
    this.setData({
      keyword,
      groups: groupAftercareItems(filterAftercareItems(this.data.items, keyword), new Date()),
    });
  },

  clearSearch() {
    this.onSearchInput({ detail: { value: '' } });
  },

  handleListFailure(reset, message) {
    if (reset) this.setData({ pageState: 'error', errorMessage: message, loadingMore: false });
    else {
      this.setData({ loadingMore: false });
      toast(message);
    }
  },

  openDetail(event) {
    const refundId = positiveId((event.currentTarget.dataset || {}).refundid);
    if (refundId == null) return;
    this._refreshAfterDetail = true;
    wx.navigateTo({ url: `/pages/merchant/aftercare/detail/index?refundId=${refundId}` });
  },
});

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function successObject(res) {
  return !!(res && (res.code === 200 || res.code === '200')
    && res.data && typeof res.data === 'object' && !Array.isArray(res.data));
}

function errorText(res, fallback) {
  return (app.getRequestErrorMessage && app.getRequestErrorMessage(res, fallback)) || fallback;
}
