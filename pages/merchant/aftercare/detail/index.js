const toast = require('../../../../utils/toast.js');
const modal = require('../../../../utils/modal.js');
const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');
const { inactiveAccess, normalizeMerchantAccess } = require('../../../../utils/merchant-access-policy.js');
const {
  RESPONSE_FLOW,
  buildResponseDraft,
  createAftercareRequestId,
  isEvidenceObjectKey,
  shapeAftercareDetail,
  shapeAftercareRespondResult,
} = require('./view-model.js');

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    pageState: 'loading',
    errorMessage: '',
    pageTitle: '退款售后',
    pageSubtitle: '',
    detail: null,
    canRespond: false,
    allowedDecisionMap: { AGREE: false, REJECT: false, EVIDENCE: false },
    decision: '',
    content: '',
    evidenceKeys: [],
    evidencePreviewUrl: '',
    canSubmit: false,
    submitting: false,
    submitError: '',
    respondBlockedText: '',
    respondOpen: false,
    respondStep: 0,
    flow: {},
  },

  onLoad(options) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const refundId = positiveId(options && options.refundId);
    this._merchantAccess = inactiveAccess();
    this._refundId = refundId;
    // 详情只能从列表带真实 refundId 进入;缺参不再给「输入 ID 查询」表单,直接回列表。
    if (refundId == null) {
      wx.redirectTo({ url: '/pages/merchant/aftercare/index' });
      return;
    }
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      navBarHeight: app.globalData.navBarHeight || 44,
      pageState: 'loading',
    });
    this.loadAccess();
  },

  onShow() { merchantTheme.merchantPageShow(); },
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
        if (!isSuccessObject(res)) {
          this.setData({ pageState: 'error', errorMessage: app.getRequestErrorMessage(res, '经营身份加载失败') });
          return;
        }
        const access = normalizeMerchantAccess(res.data);
        this._merchantAccess = access;
        if (!access.active || !access.canReadAftercare) {
          this.setData({ pageState: 'no-permission' });
          return;
        }
        this.loadDetail();
      },
      fail: () => this.setData({ pageState: 'error', errorMessage: '网络连接失败，请稍后重试' }),
    });
  },

  loadDetail() {
    const refundId = positiveId(this._refundId);
    if (refundId == null || !this._merchantAccess.canReadAftercare) return;
    this.setData({ pageState: 'loading', errorMessage: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/aftercare/detail?refundId=${encodeURIComponent(refundId)}`,
      method: 'POST',
      success: (res) => {
        if (!isSuccessObject(res)) {
          this.setData({ pageState: 'error', errorMessage: app.getRequestErrorMessage(res, '退款售后加载失败') });
          return;
        }
        const detail = shapeAftercareDetail(res.data);
        if (!detail || detail.refundId !== refundId) {
          this.setData({
            detail: null,
            canRespond: false,
            allowedDecisionMap: { AGREE: false, REJECT: false, EVIDENCE: false },
            pageState: 'error',
            errorMessage: '退款售后数据不完整，请稍后重试',
          });
          return;
        }
        const allowedDecisionMap = decisionMap(detail.allowedDecisions);
        this.setData({
          // 金额未知时不把「金额待确认」放成黑色大字,大字回到页名,金额行在状态卡里弱色显示
          pageTitle: detail.hasRefundAmount ? detail.refundAmountText : '退款售后',
          pageSubtitle: detail.headSubtitle,
          detail,
          canRespond: this._merchantAccess.canRespondAftercare === true
            && detail.canRespond === true && detail.allowedDecisions.length > 0,
          allowedDecisionMap,
          respondBlockedText: this._merchantAccess.canRespondAftercare !== true
            || (detail.processing === 'WAITING_PLATFORM_REVIEW' && detail.allowedDecisions.length === 0)
            ? '当前岗位只有查看权限，请联系店主调整权限。'
            : '平台审核已结束，不能再追加商家意见。',
          pageState: 'ready',
        });
        this.refreshSubmitState();
      },
      fail: () => this.setData({ pageState: 'error', errorMessage: '网络连接失败，请稍后重试' }),
    });
  },

  onDecisionTap(event) {
    const decision = event && event.currentTarget && event.currentTarget.dataset
      ? event.currentTarget.dataset.decision : '';
    if (this.data.allowedDecisionMap[decision] !== true || this.data.submitting) return;
    // Revolut 314/315:意见在独立全屏面板里分「填写 → 确认」两步提交。
    // 换了意见就清空说明:给「不同意」写的原因不能被带进「同意」提交;已传凭证与意见无关,保留
    const content = decision === this.data.decision ? this.data.content : '';
    this.setData({ decision, content, flow: RESPONSE_FLOW[decision], respondOpen: true, respondStep: 0, submitError: '' });
    this.refreshSubmitState();
  },

  goRespondConfirm() {
    const draft = buildResponseDraft(this.data);
    if (!draft.valid) {
      this.setData({ submitError: draft.error });
      return;
    }
    this.setData({ respondStep: 1, submitError: '' });
  },

  onRespondBack() {
    if (this.data.submitting) return;
    this.setData({ respondStep: 0, submitError: '' });
  },

  // 关闭面板只收起,不清草稿:误触遮罩不丢已写的说明和已传凭证。
  onRespondClose() {
    if (this.data.submitting) return;
    this.setData({ respondOpen: false, respondStep: 0, submitError: '' });
  },

  copyRefundNo() {
    const text = this.data.detail && this.data.detail.refundNoText;
    if (!text) return;
    wx.setClipboardData({ data: String(text) });
  },

  onContentInput(event) {
    this.setData({ content: String((event && event.detail && event.detail.value) || ''), submitError: '' });
    this.refreshSubmitState();
  },

  chooseEvidence() {
    if (this.data.submitting) return;
    app.chooseImage((uploads) => {
      const item = Array.isArray(uploads) && uploads.length === 1 ? uploads[0] : null;
      const key = item && typeof item.fileName === 'string' ? item.fileName.trim() : '';
      const previewUrl = item && typeof item.url === 'string' ? item.url.trim() : '';
      if (!isEvidenceObjectKey(key) || !previewUrl) {
        this.setData({ evidenceKeys: [], evidencePreviewUrl: '', submitError: '凭证上传未返回有效文件，请重试' });
        this.refreshSubmitState();
        return;
      }
      this.setData({ evidenceKeys: [key], evidencePreviewUrl: previewUrl, submitError: '' });
      this.refreshSubmitState();
    }, 1, {
      bizType: 'merchant_aftercare_evidence',
      // 服务端按退款单校验门店并把门店+退款单写进凭证元数据:一张凭证只能用于这一单
      formData: () => ({ refundId: this._refundId == null ? '' : String(this._refundId) }),
      mapResult: (data, index, filePath) => ({
        url: filePath,
        fileName: data && data.fileName,
      }),
    });
  },

  previewEvidence() {
    const url = this.data.evidencePreviewUrl;
    if (!url) return;
    wx.previewImage({ current: url, urls: [url] });
  },

  removeEvidence() {
    if (this.data.submitting) return;
    this.setData({ evidenceKeys: [], evidencePreviewUrl: '', submitError: '' });
    this.refreshSubmitState();
  },

  retry() {
    if (this._merchantAccess.canReadAftercare && this._refundId != null) this.loadDetail();
    else this.loadAccess();
  },

  previewResponseEvidence(event) {
    const rawIndex = event && event.currentTarget && event.currentTarget.dataset
      ? event.currentTarget.dataset.index : null;
    const index = rawIndex === null || rawIndex === '' ? -1 : Number(rawIndex);
    const responses = this.data.detail && Array.isArray(this.data.detail.responses)
      ? this.data.detail.responses : [];
    const item = Number.isInteger(index) && index >= 0 ? responses[index] : null;
    const url = item && item.hasEvidence === true ? String(item.evidenceUrl || '') : '';
    if (!url) return;
    wx.previewImage({ current: url, urls: [url] });
  },

  refreshSubmitState() {
    const draft = buildResponseDraft(this.data);
    this.setData({ canSubmit: this.data.canRespond === true && this.data.submitting !== true && draft.valid });
  },

  submitResponse() {
    if (!this.data.canRespond || this.data.submitting) return;
    const draft = buildResponseDraft(this.data);
    if (!draft.valid) {
      this.setData({ submitError: draft.error, canSubmit: false });
      return;
    }
    // 2026-09-17 总控裁定:「不同意」提交前走已登记危险确认(scripts/danger-action-registry.json trigger=payload);
    // 「同意」「补充凭证」不走。取消 = 什么都不发。
    if (draft.payload.decision === 'REJECT') {
      modal.show({
        dangerKey: 'merchant.aftercare.reject',
        success: (result) => { if (result && result.confirm) this.sendResponse(); },
      });
      return;
    }
    this.sendResponse();
  },

  sendResponse() {
    if (!this.data.canRespond || this.data.submitting) return;
    const draft = buildResponseDraft(this.data);
    if (!draft.valid) {
      this.setData({ submitError: draft.error, canSubmit: false });
      return;
    }
    const fingerprint = JSON.stringify(draft.payload);
    if (!this._submitRequestId || this._submitFingerprint !== fingerprint) {
      this._submitSequence = (this._submitSequence || 0) + 1;
      this._submitRequestId = createAftercareRequestId(Date.now(), Math.random(), this._submitSequence);
      this._submitFingerprint = fingerprint;
    }
    const payload = Object.assign({}, draft.payload, { requestId: this._submitRequestId });
    this.setData({ submitting: true, canSubmit: false, submitError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: `/api/merchant/aftercare/respond?refundId=${encodeURIComponent(this._refundId)}`,
      method: 'POST',
      data: JSON.stringify(payload),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (!isSuccessObject(res)) {
          this.setData({ submitting: false, submitError: app.getRequestErrorMessage(res, '售后意见提交失败') });
          this.refreshSubmitState();
          return;
        }
        const receipt = shapeAftercareRespondResult(
          res.data, this._refundId, payload.decision);
        if (!receipt) {
          this.setData({ submitting: false, submitError: '售后意见提交结果不完整，请重试' });
          this.refreshSubmitState();
          return;
        }
        this._submitRequestId = '';
        this._submitFingerprint = '';
        this.setData({
          submitting: false,
          respondOpen: false,
          respondStep: 0,
          decision: '',
          content: '',
          evidenceKeys: [],
          evidencePreviewUrl: '',
          submitError: '',
        });
        toast(payload.decision === 'EVIDENCE' ? '凭证已提交，等待平台处理' : '意见已提交，等待平台处理');
        this.loadDetail();
      },
      fail: () => {
        this.setData({ submitting: false, submitError: '网络连接失败，请重试' });
        this.refreshSubmitState();
      },
    });
  },
});

function positiveId(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isSuccessObject(res) {
  return !!(res && (res.code === 200 || res.code === '200')
    && res.data && typeof res.data === 'object' && !Array.isArray(res.data));
}

function decisionMap(values) {
  const allowed = Array.isArray(values) ? values : [];
  return {
    AGREE: allowed.indexOf('AGREE') >= 0,
    REJECT: allowed.indexOf('REJECT') >= 0,
    EVIDENCE: allowed.indexOf('EVIDENCE') >= 0,
  };
}
