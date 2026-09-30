const toast = require('../../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');
const { isRecordList } = require('../../../../utils/response-shape.js');
const { chinaDateKey } = require('../../../../utils/datetime.js');
const PERK_TYPES = ['礼品', '优惠券', '折扣'];

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

function isValidAmount(value, allowZero) {
  const text = String(value == null ? '' : value).trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) return false;
  const amount = Number(text);
  return Number.isFinite(amount) && (allowZero ? amount >= 0 : amount > 0);
}

function isUsableTemplate(template) {
  const quota = template && template.quota;
  const perkType = template && template.perkType;
  return Number.isInteger(perkType) && perkType >= 0 && perkType < PERK_TYPES.length
    && isValidAmount(template && template.retailValue, false)
    && Number.isInteger(quota) && quota > 0;
}

function isPerkTemplateList(value) {
  return isRecordList(value) && value.every(function (template) {
    return Number.isInteger(template.id) && template.id > 0
      && typeof template.name === 'string'
      && template.name.trim().length > 0;
  });
}

function shapePerkTemplates(value) {
  if (!isPerkTemplateList(value)) return null;
  return value.map(function (p) {
    const typeIndex = Number.isInteger(p.perkType) ? p.perkType : -1;
    return Object.assign({}, p, {
      usable: isUsableTemplate(p),
      typeText: PERK_TYPES[typeIndex] || '权益',
      typeVariant: typeIndex === 1 ? 'success' : 'neutral',
      // CU-M-172:分隔点不再写进这条字符串 —— 卡片元信息改成一档一个不换行事实的
      // flex 行,间距由 layout 供给(与其余三档 retailValue/unitCost/validText 同为裸值)。
      // 留着「 · 」前缀会让这一档单独换行时以点开头。
      quotaText: Number.isInteger(p.quota) && p.quota >= 0 ? '可接待 ' + p.quota + ' 份' : '',
      validText: p.validEnd ? String(p.validEnd).slice(0, 10) : ''
    });
  });
}

function matchesSavedPerk(row, expected) {
  if (!row || !expected) return false;
  const actualValidEnd = row.validEnd ? String(row.validEnd).slice(0, 10) : '';
  const expectedValidEnd = expected.validEnd || '';
  const actualUnitCost = row.unitCost === null || row.unitCost === undefined ? null : Number(row.unitCost);
  return Number(row.id) === expected.id
    && Number(row.perkType) === expected.perkType
    && String(row.name || '').trim() === expected.name
    && Number(row.retailValue) === expected.retailValue
    && actualUnitCost === expected.unitCost
    && Number(row.quota) === expected.quota
    && actualValidEnd === expectedValidEnd;
}

Page({
  data: {
    calendarOpen:false,discardVisible:false,
    statusBarHeight: 20,
    navBarHeight: 44,
    loadState: 'loading',
    refreshing: false,
    loadError: '',
    perks: [],
    perkTypes: PERK_TYPES,
    formVisible: false,
    saving: false,
    saveReadbackPending: false,
    saveErrorKind: '',
    saveError: '',
    saveReceipt: '',
    deleteId: null,
    deleting: false,
    deleteErrorKind: '',
    deleteError: '',
    canSave: false,
    // CU-M-79:日历下限与保存闸都用它(中国时区的明天,'YYYY-MM-DD')。
    // 有效期存当日 00:00,下游按「晚于此刻」判在售 ⇒ 选今天等于一建就过期。
    minValidEnd: '',
    form: { perkType: 0, name: '', retailValue: '', unitCost: '', quota: '', validEnd: '' }
  },

  onLoad() {
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44,
      minValidEnd: chinaDateKey(Date.now() + 86400000),
    });
    this.load();
  },
  onShow() { merchantTheme.merchantPageShow && merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore && merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._loadEpoch = (this._loadEpoch || 0) + 1;
    this._saveEpoch = (this._saveEpoch || 0) + 1;
    this._deleteEpoch = (this._deleteEpoch || 0) + 1;
    this._loadInFlight = false;
    this._pendingSaveReadback = null;
    merchantTheme.merchantPageRestore && merchantTheme.merchantPageRestore();
  },

  onNavBack() {
    if (this.data.formVisible) return this.closeForm();
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
        that.setData({ refreshing: false, loadState: 'permission', loadError: '', perks: [] });
      } else if (hasOldContent) {
        if (!finish()) return;
        that.setData({ refreshing: false, loadState: 'ready', loadError: failure.text });
      } else {
        if (!finish()) return;
        that.setData({ refreshing: false, loadState: 'error', loadError: failure.text });
      }
    };
    this.setData({
      loadState: hasOldContent ? 'ready' : 'loading',
      refreshing: hasOldContent,
      loadError: '',
    });
    app.sendRequest({
      hideLoading: true, autoErrorToast: hasOldContent, url: '/api/coop/perk-template/list', method: 'POST',
      data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!isCurrent()) return;
        if (!(res.code === '200' || res.code === 200)) return fail(res, '常备权益暂时没能加载，请重试。');
        if (!isPerkTemplateList(res.data)) return fail({ msg: '常备权益数据格式异常' }, '常备权益数据格式异常');
        const perks = shapePerkTemplates(res.data);
        if (!finish()) return;
        that.setData({ refreshing: false, perks: perks, loadState: 'ready', loadError: '' });
      },
      fail(error) { fail(error, '常备权益暂时没能加载，请重试。'); }
    });
  },

  retryLoad() { this.load(); },

  openForm() {
    if (!this.data.deleting) {
      this._formAtOpen=JSON.stringify(this.data.form);
      this.setData({ formVisible: true, saveErrorKind: '', saveError: '' });
    }
  },
  closeForm() {
    if(this.data.saving || this.data.saveReadbackPending)return;
    if(JSON.stringify(this.data.form)!==this._formAtOpen)return this.setData({discardVisible:true});
    this.setData({formVisible:false});
  },
  keepForm(){this.setData({discardVisible:false});},
  discardForm(){this.setData({form:JSON.parse(this._formAtOpen),discardVisible:false,formVisible:false});this.refreshSaveState();},
  onTypeChange(e) { this.pickType({currentTarget:{dataset:{value:e.detail.value}}}); },
  pickType(e) {
    if (this.data.saving || this.data.refreshing || this.data.saveReadbackPending) return;
    const form = Object.assign({}, this.data.form, { perkType: Number(e.currentTarget.dataset.value) });
    this.setData({ form: form });
  },
  onInput(e) {
    if (this.data.saving || this.data.refreshing || this.data.saveReadbackPending) return;
    const key = e.currentTarget.dataset.key;
    if (['name', 'retailValue', 'unitCost', 'quota'].indexOf(key) < 0) return;
    const form = Object.assign({}, this.data.form);
    form[key] = e.detail.value;
    this.setData({ form: form }, () => this.refreshSaveState());
  },
  openCalendar(){this.setData({calendarOpen:true});},
  closeCalendar(){this.setData({calendarOpen:false});},
  onDate(e) {
    if (this.data.saving || this.data.refreshing || this.data.saveReadbackPending) return;
    const form = Object.assign({}, this.data.form, { validEnd: e.detail.value });
    this.setData({ form: form });
  },

  refreshSaveState() {
    const form = this.data.form;
    const quota = Number(form.quota);
    const canSave = !!(form.name || '').trim()
      && isValidAmount(form.retailValue, false)
      && (form.unitCost === '' || isValidAmount(form.unitCost, true))
      && Number.isInteger(quota) && quota > 0;
    if (canSave !== this.data.canSave) this.setData({ canSave });
  },

  save() {
    if (this.data.saveReadbackPending) return this.retrySaveReadback();
    if (!this.data.canSave || this.data.saving || this.data.deleting || this.data.refreshing) return;
    if (this._loadInFlight) {
      this._loadEpoch = (this._loadEpoch || 0) + 1;
      this._loadInFlight = false;
    }
    const form = this.data.form;
    if (!(form.name || '').trim()) return toast('请填写权益名称');
    if (!isValidAmount(form.retailValue, false)) return toast('零售价最多8位整数和2位小数');
    if (form.unitCost !== '' && !isValidAmount(form.unitCost, true)) return toast('成本价最多8位整数和2位小数');
    if (!Number.isInteger(Number(form.quota)) || Number(form.quota) <= 0) return toast('请填写正整数可接待份数');
    // CU-M-79:过期权益模板不得创建(后端同口径重校)。选择器有下限,这里兜住跨天与旧草稿。
    if (form.validEnd && form.validEnd < this.data.minValidEnd) return toast('有效期至少要到明天');
    const that = this;
    const epoch = (this._saveEpoch || 0) + 1;
    this._saveEpoch = epoch;
    const isCurrent = function () {
      if (epoch !== that._saveEpoch) return false;
      return true;
    };
    const fail = function (error) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error, '权益保存失败');
      that.setData({ saving: false, saveErrorKind: failure.kind, saveError: failure.text });
    };
    const payload = {
      perkType: form.perkType,
      name: form.name.trim(),
      retailValue: Number(form.retailValue),
      unitCost: form.unitCost ? Number(form.unitCost) : null,
      quota: Number(form.quota),
      validEnd: form.validEnd || null
    };
    this.setData({ saving: true, refreshing: false, saveReadbackPending: false,
      saveErrorKind: '', saveError: '', saveReceipt: '' });
    app.sendRequest({
      url: '/api/coop/perk-template/save', method: 'POST',
      data: JSON.stringify(payload),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!isCurrent()) return;
        const savedId = res && res.data && res.data.id;
        if ((res.code === '200' || res.code === 200)
            && Number.isInteger(savedId) && savedId > 0) {
          that._pendingSaveReadback = Object.assign({ id: savedId, epoch }, payload);
          that.setData({ saveReadbackPending: true });
          that.retrySaveReadback();
        } else {
          fail({ msg: requestText(res, '权益保存结果未确认，请刷新查看') });
        }
      },
      fail(error) { fail(error); }
    });
  },

  retrySave() {
    if (this.data.saveReadbackPending) this.retrySaveReadback();
    else this.save();
  },

  retrySaveReadback() {
    const pending = this._pendingSaveReadback;
    if (!pending || pending.epoch !== this._saveEpoch || this.data.deleting) return;
    const that = this;
    const isCurrent = function () {
      return pending === that._pendingSaveReadback && pending.epoch === that._saveEpoch;
    };
    const failReadback = function (error, fallback) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error, fallback || '还没确认保存成功，请重新查询');
      if (failure.kind === 'permission') {
        that._pendingSaveReadback = null;
        that.setData({ saving: false, saveReadbackPending: false, formVisible: false,
          loadState: 'permission', perks: [], saveErrorKind: '', saveError: '' });
        return;
      }
      that.setData({ saving: false, saveReadbackPending: true,
        saveErrorKind: failure.kind, saveError: failure.text });
    };
    this.setData({ saving: true, saveReadbackPending: true, saveErrorKind: '', saveError: '' });
    app.sendRequest({
      hideLoading: true, url: '/api/coop/perk-template/list', method: 'POST',
      data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!isCurrent()) return;
        if (!(res && (res.code === '200' || res.code === 200))) {
          failReadback(res, '还没确认保存成功，请重新查询');
          return;
        }
        const perks = shapePerkTemplates(res.data);
        if (!perks) {
          failReadback({ msg: '保存结果读取数据格式异常，请重新查询' });
          return;
        }
        if (!perks.some((row) => matchesSavedPerk(row, pending))) {
          failReadback({ msg: '还没确认保存成功，请重新查询' });
          return;
        }
        that._pendingSaveReadback = null;
        that.setData({
          saving: false,
          saveReadbackPending: false,
          formVisible: false,
          canSave: false,
          perks,
          loadState: 'ready',
          refreshing: false,
          loadError: '',
          saveErrorKind: '',
          saveError: '',
          saveReceipt: '常备权益已保存',
          form: { perkType: 0, name: '', retailValue: '', unitCost: '', quota: '', validEnd: '' }
        });
      },
      fail(error) { failReadback(error, '还没确认保存成功，请重新查询'); }
    });
  },

  askDelete(e) {
    if (this.data.saving || this.data.deleting) return;
    const name = String(e.currentTarget.dataset.name || '该权益');
    this.setData({
      deleteId: e.currentTarget.dataset.id,
      deleteErrorKind: '',
      deleteError: ''
    });
    // 三段式第一段:确认。原来只有一句「删除后无法恢复」,现在按登记表列后果。
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.open('perk.delete', { name: name });
  },
  cancelDelete() {
    if (!this.data.deleting) this.setData({ deleteId: null });
  },
  confirmDelete() {
    if (this.data.saving || this.data.deleting) return;
    const id = this.data.deleteId;
    if (id === undefined || id === null || id === '') {
      return this.setData({ deleteErrorKind: 'data', deleteError: '没有找到要删除的权益，请重新选择。' });
    }
    if (this._loadInFlight) {
      this._loadEpoch = (this._loadEpoch || 0) + 1;
      this._loadInFlight = false;
    }
    const that = this;
    const epoch = (this._deleteEpoch || 0) + 1;
    this._deleteEpoch = epoch;
    const isCurrent = function () {
      if (epoch !== that._deleteEpoch) return false;
      return true;
    };
    const fail = function (error) {
      if (!isCurrent()) return;
      const failure = classifyFailure(error, '权益删除失败');
      that.setData({ deleting: false, deleteErrorKind: failure.kind, deleteError: failure.text });
      const dcFail = that.selectComponent && that.selectComponent('#dc');
      if (dcFail) dcFail.failed(failure.text);
    };
    this.setData({ deleting: true, deleteErrorKind: '', deleteError: '', saveReceipt: '' });
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.busyOn();
    app.sendRequest({
      url: '/api/coop/perk-template/delete', method: 'POST',
      data: JSON.stringify({ id: id }), header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!isCurrent()) return;
        if (res.code === '200' || res.code === 200) {
          that.setData({ deleting: false, deleteId: null, deleteErrorKind: '', deleteError: '', saveReceipt: '常备权益已删除' });
          // 三段式第三段:结果确认卡
          if (dc) dc.done();
          that._loadInFlight = false;
          that._loadEpoch = (that._loadEpoch || 0) + 1;
          that.load();
        } else {
          fail(res);
        }
      },
      fail(error) { fail(error); }
    });
  },

  retryDelete() { this.confirmDelete(); }
});
