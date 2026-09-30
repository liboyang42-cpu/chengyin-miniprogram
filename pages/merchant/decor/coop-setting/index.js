// 城瘾 · 承接设置(七页规范 §1:承接与经营那一组从主页面下沉为全屏子页,右上 Save / 左上返回)
// 读写沿用既有接口:/api/merchant/coop-profile 读、/api/merchant/coop-profile/save 存,不新增端点。
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
    editor:null, discardVisible:false, chargeOptions:['免费承接','收费承接'],
    statusBarHeight: 20,
    navBarHeight: 44,
    loadState: 'loading',   // loading | ok | error | empty
    refreshing: false,
    loadErrorKind: '',
    loadError: '',
    saving: false,
    saveErrorKind: '',
    saveError: '',
    saveReceipt: '',
    form: { capacity: '', availableTime: '', chargeType: null, demand: '' },
    // /save 是全量覆盖白名单:未在本页编辑但属同一接口的字段要原样带回,否则会被清空
    keep: { suitActivityTypes: '', coopOpen: null },
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44,
    });
    this.load();
  },

  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._loadEpoch = (this._loadEpoch || 0) + 1;
    this._saveEpoch = (this._saveEpoch || 0) + 1;
    this._loadInFlight = false;
    if (this._successTimer) clearTimeout(this._successTimer);
    merchantTheme.merchantPageRestore();
  },

  keepEditing() { this.setData({discardVisible:false}); },
  discardChanges() { if(this.data.discardEditor) return (Object.assign(this.data, {discardEditor:false}), this.setData({editor:null, discardVisible:false})); this._initialForm = JSON.stringify(this.data.form); this.setData({discardVisible:false}); this.onNavBack(); },
  editField(e) {
    if(this.data.saving || this.data.refreshing) return;
    const key=e.currentTarget.dataset.k, labels={capacity:'接待人数',availableTime:'可承接时间',demand:'合作诉求'};
    if (!labels[key]) return;
    this.setData({editor:{key,label:labels[key],value:this.data.form[key]}});
  },
  editInput(e) { this.setData({'editor.value':e.detail.value}); },
  closeEditor() {
    const editor=this.data.editor;
    if(editor && editor.value !== this.data.form[editor.key]) return (Object.assign(this.data, {discardEditor:true}), this.setData({discardVisible:true}));
    this.setData({editor:null});
  },
  applyEditor() {
    const {key,value}=this.data.editor;
    if (key === 'capacity' && value && !/^\d+$/.test(value)) return toast('接待人数要填非负整数');
    this.setData({['form.'+key]:value,editor:null});
  },
  onNavBack() {
    if(this.data.saving) return;
    if (this._initialForm && JSON.stringify(this.data.form) !== this._initialForm) return (Object.assign(this.data, {discardEditor:false}), this.setData({discardVisible:true}));
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/merchant/decor/index' });
  },

  load() {
    if (this._loadInFlight) return;
    const that = this;
    const epoch = (this._loadEpoch || 0) + 1;
    this._loadEpoch = epoch;
    this._loadInFlight = true;
    const hasOldContent = this.data.loadState === 'ok';
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
        that.setData({
          refreshing: false, loadState: 'permission', loadErrorKind: '', loadError: '',
          form: { capacity: '', availableTime: '', chargeType: null, demand: '' },
          keep: { suitActivityTypes: '', coopOpen: null },
        });
      } else if (hasOldContent) {
        if (!finish()) return;
        that.setData({ refreshing: false, loadState: 'ok', loadErrorKind: failure.kind, loadError: failure.text });
      } else {
        if (!finish()) return;
        that.setData({ refreshing: false, loadState: 'error', loadErrorKind: failure.kind, loadError: failure.text });
      }
    };
    this.setData({
      loadState: hasOldContent ? 'ok' : 'loading',
      refreshing: hasOldContent,
      loadErrorKind: '',
      loadError: '',
    });
    app.sendRequest({
      hideLoading: true, autoErrorToast: hasOldContent, url: '/api/merchant/coop-profile', method: 'POST',
      success(res) {
        if (!isCurrent()) return;
        const ok = res.code === '200' || res.code === 200;
        if (ok && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
          const m = res.data;
          const memberId = Number(m.memberId);
          if (!Number.isInteger(memberId) || memberId < 1) {
            return fail({ msg: '承接设置数据不完整' }, '承接设置数据不完整，请重试。');
          }
          const chargeType = m.chargeType === 0 || m.chargeType === '0'
            ? 0
            : (m.chargeType === 1 || m.chargeType === '1' ? 1 : null);
          if (!finish()) return;
          that.setData({
            refreshing: false, loadState: 'ok',
            loadErrorKind: '',
            loadError: '',
            form: {
              capacity: m.capacity == null ? '' : String(m.capacity),
              availableTime: m.availableTime || '',
              chargeType: chargeType,
              demand: m.demand || '',
            },
            keep: {
              suitActivityTypes: m.suitActivityTypes || '',
              coopOpen: m.coopOpen != null ? m.coopOpen : null,
            },
          });
          that._initialForm = JSON.stringify(that.data.form);
        } else if (ok) {
          fail({ msg: '承接设置数据不完整' }, '承接设置数据不完整，请重试。');
        } else {
          fail(res, '承接设置暂时没能加载，请重试。');
        }
      },
      fail(error) { fail(error, '承接设置暂时没能加载，请重试。'); },
    });
  },

  retryLoad() { this.load(); },

  onChargeType(e) {
    if (this.data.saving || this.data.refreshing) return;
    const form = Object.assign({}, this.data.form, { chargeType: parseInt(e.detail.value) });
    this.setData({ form: form });
  },
  goApply() { wx.redirectTo({ url: '/pages/merchant/apply/index' }); },

  // 右上 Save(§〇.2 全屏子页范式):存成功才回,失败留在页面上让人重试
  onSave() {
    if (this.data.loadState !== 'ok') return;
    if (this.data.saving || this.data.refreshing) return;
    if (this._loadInFlight) {
      this._loadEpoch = (this._loadEpoch || 0) + 1;
      this._loadInFlight = false;
    }
    const f = this.data.form;
    const capacity = String(f.capacity).trim();
    if (capacity !== '' && !(Number(capacity) >= 0)) {
      return toast('可容纳人数要填数字');
    }
    if (f.chargeType !== 0 && f.chargeType !== 1) {
      return toast('请选择收费方式');
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
      const failure = classifyFailure(error, '承接设置保存失败');
      that.setData({ saving: false, saveErrorKind: failure.kind, saveError: failure.text });
    };
    this.setData({ saving: true, refreshing: false, saveErrorKind: '', saveError: '', saveReceipt: '' });
    app.sendRequest({
      url: '/api/merchant/coop-profile/save', method: 'POST',
      data: JSON.stringify({
        capacity: capacity === '' ? null : parseInt(capacity),
        availableTime: f.availableTime || '',
        suitActivityTypes: this.data.keep.suitActivityTypes,
        chargeType: f.chargeType,
        demand: f.demand || '',
        coopOpen: this.data.keep.coopOpen,
        // 后端 null=不改;留空要显式声明清空,否则填过的人数永远清不掉(M-13)
        params: capacity === '' ? { clearCapacity: true } : undefined,
      }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!isCurrent()) return;
        if (res.code === '200' || res.code === 200) {
          that.setData({ saving: false, saveErrorKind: '', saveError: '', saveReceipt: '承接设置已保存' });
          that._initialForm = JSON.stringify(that.data.form);
          toast.success('已保存');
          that._successTimer = setTimeout(function () {
            if (isCurrent()) that.onNavBack();
          }, 500);
        } else {
          fail(res);
        }
      },
      fail(error) { fail(error); },
      complete() {
        if (isCurrent() && that.data.saving) that.setData({ saving: false });
      },
    });
  },
});
