const toast = require('../../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');

function requestText(error, fallback) {
  if (app.getRequestErrorMessage) return app.getRequestErrorMessage(error, fallback);
  return error && error.msg ? String(error.msg) : fallback;
}

function classifyFailure(error, fallback) {
  const code = error && (error.statusCode !== undefined ? error.statusCode : error.code);
  const message = error && error.msg ? String(error.msg) : '';
  if (String(code) === '401' || String(code) === '403'
      || /仅.*商家|商家资格|无权限|没有权限|权限不足|审核通过.*商家/.test(message)) {
    return { kind: 'permission', text: '当前账号没有店铺编辑权限，请切换到已审核通过的商家账号。' };
  }
  const transportText = error && typeof error === 'object' ? String(error.errMsg || '') : '';
  if (code === undefined && /request:fail|timeout|network|网络|断网/i.test(transportText)) {
    return { kind: 'network', text: '网络连接失败，请检查网络后重试。' };
  }
  return { kind: 'data', text: requestText(error, fallback) };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loadState: 'loading',
    refreshing: false,
    loadErrorKind: '',
    loadError: '',
    gallery: [],
    saving: false,
    saveErrorKind: '',
    saveError: '',
    saveReceipt: '',
    discardVisible:false,
    dirty: false
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44
    });
    this.load();
  },
  onShow() { merchantTheme.merchantPageShow && merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore && merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._loadEpoch = (this._loadEpoch || 0) + 1;
    this._saveEpoch = (this._saveEpoch || 0) + 1;
    this._loadInFlight = false;
    if (this._successTimer) clearTimeout(this._successTimer);
    merchantTheme.merchantPageRestore && merchantTheme.merchantPageRestore();
  },

  keepEditing() { this.setData({discardVisible:false}); },
  discardChanges() { this.setData({dirty:false,discardVisible:false});this.onNavBack(); },
  onNavBack() {
    if(this.data.saving)return;
    if(this.data.dirty)return this.setData({discardVisible:true});
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/merchant/decor/index' });
  },

  load() {
    if (this._loadInFlight) return;
    const that = this;
    const epoch = (this._loadEpoch || 0) + 1;
    this._loadEpoch = epoch;
    this._loadInFlight = true;
    const hasOldContent = this.data.loadState === 'ready';
    const isCurrent = function () {
      if (epoch !== that._loadEpoch) return false;
      return true;
    };
    const finish = function () {
      if (!isCurrent()) return false;
      that._loadInFlight = false;
      return true;
    };
    const fail = function (error, fallback) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error, fallback);
      if (failure.kind === 'permission') {
        if (!finish()) return;
        that.setData({ refreshing: false, loadState: 'permission', loadErrorKind: '', loadError: '', gallery: [], dirty: false });
      } else if (hasOldContent) {
        if (!finish()) return;
        that.setData({ refreshing: false, loadState: 'ready', loadErrorKind: failure.kind, loadError: failure.text });
      } else {
        if (!finish()) return;
        that.setData({ refreshing: false, loadState: 'error', loadErrorKind: failure.kind, loadError: failure.text });
      }
    };
    this.setData({
      loadState: hasOldContent ? 'ready' : 'loading',
      refreshing: hasOldContent,
      loadErrorKind: '',
      loadError: '',
    });
    app.sendRequest({
      hideLoading: true, autoErrorToast: hasOldContent, url: '/api/merchant/coop-profile', method: 'POST',
      success(res) {
        if (!isCurrent()) return;
        const ok = res.code === '200' || res.code === 200;
        if (!ok) return fail(res, '门店相册暂时没能加载，请重试。');
        if (typeof res.data !== 'object' || Array.isArray(res.data)) {
          return fail({ msg: '相册数据不完整' }, '相册数据不完整，请重试。');
        }
        const memberId = Number(res.data.memberId);
        if (!Number.isInteger(memberId) || memberId < 1) {
          return fail({ msg: '相册数据不完整' }, '相册数据不完整，请重试。');
        }
        let gallery = [];
        try { gallery = res.data.gallery ? JSON.parse(res.data.gallery) : []; } catch (e) {
          return fail({ msg: '相册数据格式异常' }, '相册数据格式异常');
        }
        if (!Array.isArray(gallery)) return fail({ msg: '相册数据格式异常' }, '相册数据格式异常');
        if (!finish()) return;
        that.setData({ refreshing: false, gallery: gallery, loadState: 'ready', loadErrorKind: '', loadError: '', dirty: false });
      },
      fail(error) { fail(error, '门店相册暂时没能加载，请重试。'); }
    });
  },

  retryLoad() { this.load(); },
  goApply() { wx.redirectTo({ url: '/pages/merchant/apply/index' }); },

  addGallery() {
    if (this.data.saving || this.data.refreshing) return;
    const remain = 9 - this.data.gallery.length;
    if (remain <= 0) return toast('最多 9 张');
    const that = this;
    app.chooseImage(function (images) {
      if (!images || !images.length || that.data.saving || that.data.refreshing) return;
      that.setData({ gallery: that.data.gallery.concat(images).slice(0, 9), dirty: true });
    }, remain, { cropScale: '16:9' });
  },

  removeGallery(e) {
    if (this.data.saving || this.data.refreshing) return;
    const rawIndex = e && e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.index
      : undefined;
    const index = Number(rawIndex);
    if (rawIndex === undefined || rawIndex === null || rawIndex === ''
        || !Number.isInteger(index) || index < 0 || index >= this.data.gallery.length) {
      this.setData({ saveErrorKind: 'data', saveError: '没有找到要删除的图片，请重新选择。' });
      return;
    }
    const gallery = this.data.gallery.slice();
    gallery.splice(index, 1);
    this.setData({ gallery: gallery, dirty: true });
  },

  save() {
    if (this.data.saving || this.data.refreshing || !this.data.dirty) return;
    if (this._loadInFlight) {
      this._loadEpoch = (this._loadEpoch || 0) + 1;
      this._loadInFlight = false;
    }
    const that = this;
    const epoch = (this._saveEpoch || 0) + 1;
    this._saveEpoch = epoch;
    const isCurrent = function () {
      if (epoch !== that._saveEpoch) return false;
      return true;
    };
    const fail = function (error) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error, '相册保存失败');
      that.setData({ saving: false, saveErrorKind: failure.kind, saveError: failure.text });
    };
    this.setData({ saving: true, refreshing: false, saveErrorKind: '', saveError: '', saveReceipt: '' });
    app.sendRequest({
      url: '/api/merchant/decor/save', method: 'POST',
      data: JSON.stringify({ gallery: JSON.stringify(this.data.gallery) }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!isCurrent()) return;
        if (res.code === '200' || res.code === 200) {
          that.setData({ saving: false, dirty: false, saveErrorKind: '', saveError: '', saveReceipt: '门店相册已保存' });
          toast.success('相册已保存');
          that._successTimer = setTimeout(function () {
            if (isCurrent()) that.onNavBack();
          }, 400);
        } else {
          fail(res);
        }
      },
      fail(error) { fail(error); }
    });
  }
});
