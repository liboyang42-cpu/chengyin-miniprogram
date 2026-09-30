const cyModal = require('../../../../utils/modal.js');
const toast = require('../../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');
const { inactiveAccess, normalizeMerchantAccess } = require('../../../../utils/merchant-access-policy.js');
const {
  buildNoteDraft,
  latestNoteText,
  buildTagDraft,
  createNoteRequestId,
  createTagRequestId,
  positiveId,
  shapeCustomerDetail,
} = require('./view-model.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    pageState: 'loading',
    errorMessage: '',
    detail: null,
    canEdit: false,
    noteContent: '',
    noteError: '',
    noteSubmitting: false,
    correctsNoteId: null,
    noteHidingId: null,
    tagName: '',
    tagError: '',
    tagSubmitting: false,
    editorOpen: false,
    hasTags: false,
    latestNoteText: '',
    noteHistory: [],
  },

  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._customerMemberId = positiveId(options && options.customerMemberId);
    this._merchantAccess = inactiveAccess();
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44,
    });
    if (this._customerMemberId == null) {
      this.setData({ pageState: 'error', errorMessage: '客户ID无效' });
      return;
    }
    this.loadAccess();
  },

  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  onNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/merchant/customer/index' });
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
        if (!access.active || !access.canReadCrm) {
          this.setData({ pageState: 'no-permission', detail: null, canEdit: false });
          return;
        }
        this.setData({ canEdit: access.canSegmentCrm === true });
        this.loadDetail();
      },
      fail: () => this.setData({ pageState: 'error', errorMessage: '网络连接失败，请稍后重试' }),
    });
  },

  /* silent=true:弹窗里加/删标签、写完备注后的重载。不许把 pageState 打回 loading ——
   * 弹窗还开着,背后会闪一层骨架屏;失败时也不能整页翻错误态把弹窗架空,改用 toast。 */
  loadDetail(silent) {
    if (!this._merchantAccess.canReadCrm) return;
    if (!silent) this.setData({ pageState: 'loading', errorMessage: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/crm/customers/${this._customerMemberId}/detail`,
      method: 'POST',
      success: (res) => {
        if (!successObject(res)) {
          const message = errorText(res, '客户详情加载失败');
          if (silent) { toast.error(message, { fallback: '客户详情刷新失败' }); return; }
          this.setData({ pageState: 'error', errorMessage: message });
          return;
        }
        const detail = shapeCustomerDetail(res.data, this._customerMemberId);
        if (!detail) {
          if (silent) { toast.error('客户详情数据不完整，请稍后重试'); return; }
          this.setData({ pageState: 'error', errorMessage: '客户详情数据不完整，请稍后重试' });
          return;
        }
        this.setData({
          detail,
          pageState: 'ready',
          errorMessage: '',
          hasTags: detail.systemTags.length > 0 || detail.merchantTags.length > 0,
          latestNoteText: latestNoteText(detail.timeline),
          noteHistory: detail.history,
        });
      },
      fail: () => this.setData({ pageState: 'error', errorMessage: '网络连接失败，请稍后重试' }),
    });
  },

  openEditor() {
    if (!this.data.canEdit) return;
    this.setData({ editorOpen: true });
  },

  closeEditor() {
    /* ⚠️ 只收弹窗与错误文案,**不许**清 _noteRequestId / _noteFingerprint / correctsNoteId。
     * 这三个是备注写入的幂等键与目标指向:requestId 原本只在成功后清(见 submitNote 的 success),
     * 好让「提交超时但服务端已落库 → 重试」复用同一个 key 而不产生第二条备注。
     * 关弹窗就清 = 换新 key,而 noteContent 还留着 —— 关掉再打开点保存就是重复写入;
     * 顺手清 correctsNoteId 还会把一次「更正」静默降级成一条新备注(原文不再被指向)。
     * 要主动放弃更正有独立出口:cancelCorrection。 */
    this.setData({ editorOpen: false, noteError: '', tagError: '' });
  },

  retry() {
    if (this._merchantAccess && this._merchantAccess.canReadCrm) this.loadDetail();
    else this.loadAccess();
  },

  onNoteInput(event) {
    this.setData({ noteContent: (event.detail && event.detail.value) || '', noteError: '' });
  },

  submitNote() {
    if (!this.data.canEdit || this.data.noteSubmitting) return;
    // 标签是即时提交的;只改了标签就点保存时没有备注正文要写,直接收起弹窗,
    // 别拿「请填写跟进备注」把一次成功的编辑说成失败。
    if (!this.data.noteContent.trim() && this.data.correctsNoteId == null) { this.closeEditor(); return; }
    const draft = buildNoteDraft(this.data.noteContent);
    if (!draft.valid) { this.setData({ noteError: draft.error }); return; }
    const fingerprint = `${this.data.correctsNoteId || ''}|${draft.content}`;
    if (!this._noteRequestId || this._noteFingerprint !== fingerprint) {
      this._noteSequence = (this._noteSequence || 0) + 1;
      this._noteRequestId = createNoteRequestId(Date.now(), Math.random(), this._noteSequence);
      this._noteFingerprint = fingerprint;
    }
    this.setData({ noteSubmitting: true, noteError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/crm/customers/${this._customerMemberId}/notes`,
      method: 'POST',
      data: JSON.stringify({ content: draft.content, requestId: this._noteRequestId,
        correctsNoteId: this.data.correctsNoteId || null }),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (!successObject(res)) {
          this.setData({ noteSubmitting: false, noteError: errorText(res, '跟进备注保存失败') });
          return;
        }
        this._noteRequestId = '';
        this._noteFingerprint = '';
        this.setData({ noteSubmitting: false, noteContent: '', noteError: '', correctsNoteId: null, editorOpen: false });
        this.loadDetail(true);
      },
      fail: () => this.setData({ noteSubmitting: false, noteError: '网络连接失败，请稍后重试' }),
    });
  },

  startCorrection(event) {
    if (!this.data.canEdit) return;
    const noteId = positiveId(event.currentTarget.dataset && event.currentTarget.dataset.noteid);
    if (noteId == null) return;
    this._noteRequestId = '';
    this._noteFingerprint = '';
    this.setData({ correctsNoteId: noteId, noteContent: '', noteError: '' });
  },

  cancelCorrection() {
    this._noteRequestId = '';
    this._noteFingerprint = '';
    this.setData({ correctsNoteId: null, noteContent: '', noteError: '' });
  },

  hideNote(event) {
    if (!this.data.canEdit || this.data.noteHidingId) return;
    const data = event.currentTarget.dataset || {};
    const noteId = positiveId(data.noteid);
    const version = Number(data.version);
    if (noteId == null || !Number.isSafeInteger(version) || version < 0) return;
    cyModal.show({
      title: '隐藏跟进记录',
      content: '原文会保留在审计记录中，客户时间线不再显示。',
      success: (modal) => { if (modal.confirm) this._hideNote(noteId, version); },
    });
  },

  _hideNote(noteId, version) {
    this.setData({ noteHidingId: noteId });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/crm/customers/${this._customerMemberId}/notes/hide`,
      method: 'POST',
      data: JSON.stringify({ noteId, expectedVersion: version,
        requestId: createNoteRequestId(Date.now(), Math.random(), (this._noteSequence || 0) + 1) }),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        this.setData({ noteHidingId: null });
        if (!successWrite(res)) { toast(errorText(res, '隐藏跟进失败')); return; }
        this.loadDetail(true);
      },
      fail: () => { this.setData({ noteHidingId: null }); toast('网络连接失败，请稍后重试'); },
    });
  },

  onTagInput(event) {
    this.setData({ tagName: (event.detail && event.detail.value) || '', tagError: '' });
  },

  submitTag() {
    if (!this.data.canEdit || this.data.tagSubmitting) return;
    const draft = buildTagDraft(this.data.tagName, '#2E6D5A');
    if (!draft.valid) { this.setData({ tagError: draft.error }); return; }
    const fingerprint = `${draft.tagName}|${draft.tagColor}`;
    if (!this._tagRequestId || this._tagFingerprint !== fingerprint) {
      this._tagSequence = (this._tagSequence || 0) + 1;
      this._tagRequestId = createTagRequestId(Date.now(), Math.random(), this._tagSequence);
      this._tagFingerprint = fingerprint;
    }
    this.setData({ tagSubmitting: true, tagError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/crm/customers/${this._customerMemberId}/tags`,
      method: 'POST',
      data: JSON.stringify({ tagName: draft.tagName, tagColor: draft.tagColor, requestId: this._tagRequestId }),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (!successObject(res)) {
          this.setData({ tagSubmitting: false, tagError: errorText(res, '客户标签保存失败') });
          return;
        }
        this._tagRequestId = '';
        this._tagFingerprint = '';
        this.setData({ tagSubmitting: false, tagName: '', tagError: '' });
        this.loadDetail(true);
      },
      fail: () => this.setData({ tagSubmitting: false, tagError: '网络连接失败，请稍后重试' }),
    });
  },

  removeTag(event) {
    if (!this.data.canEdit) return;
    const tagId = positiveId(event.currentTarget.dataset && event.currentTarget.dataset.tagid);
    if (tagId == null) return;
    cyModal.show({
      title: '移除标签',
      content: '只会移除当前客户与该标签的关系。',
      success: (modal) => { if (modal.confirm) this._removeTag(tagId); },
    });
  },

  _removeTag(tagId) {
    this._removeRequestIds = this._removeRequestIds || {};
    if (!this._removeRequestIds[tagId]) {
      this._tagSequence = (this._tagSequence || 0) + 1;
      this._removeRequestIds[tagId] = createTagRequestId(Date.now(), Math.random(), this._tagSequence);
    }
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/crm/customers/${this._customerMemberId}/tags/remove`,
      method: 'POST',
      data: JSON.stringify({ tagId, requestId: this._removeRequestIds[tagId] }),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (!successWrite(res)) { toast(errorText(res, '标签移除失败')); return; }
        delete this._removeRequestIds[tagId];
        this.loadDetail(true);
      },
      fail: () => toast('网络连接失败，请稍后重试'),
    });
  },
});

function successObject(res) {
  return !!(res && (res.code === 200 || res.code === '200') && res.data !== undefined && res.data !== null);
}
/* R9-32:写回执按真实契约判收 —— hide/remove 服务端只返回 success(msg)、不带 data,
 * 用 successObject 会把成功判成失败,提前 return 且不刷新详情。读接口仍走 successObject。 */
function successWrite(res) {
  return !!(res && (res.code === 200 || res.code === '200'));
}
function errorText(res, fallback) {
  return (app.getRequestErrorMessage && app.getRequestErrorMessage(res, fallback)) || fallback;
}
