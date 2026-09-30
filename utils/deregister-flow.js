const modal = require('./modal.js');
const app = getApp();
const { sendUiStateRequest } = require('./ui-state-request.js');
const { bizFailureMessage } = require('./response-shape.js');
const { formatRefundDeadline } = require('./order-status.js');

const STATUS_AFTER_APPLICATION = ['NORMAL', 'CANCELLED', 'FAILED'];

function requestId() {
  return 'deregister-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function isOk(res) {
  return !!(res && (res.code === 200 || res.code === '200'));
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function blockerList(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) return null;
  return value.map((item) => item.trim());
}

// 1-39:后端 Date 无 @JsonFormat,Spring Boot 默认下发 ISO 串("2026-09-24T10:30:00.000+08:00");
// ISO/epoch 一律格式化成中国时区,解析不了的字符串才原样显示。
function executeAfterText(value) {
  const text = formatRefundDeadline(value);
  return text || (typeof value === 'string' ? value : '');
}

function initialData() {
  return {
    status: 'LOADING',
    statusError: '',
    blockers: [],
    executeAfter: '',
    phone: '',
    phoneMasked: '',
    smscode: '',
    confirmed: false,
    canApply: false,
    showNoticeSheet: false,
    smsSending: false,
    smsSent: false,
    smsError: '',
    submitting: false,
    applyError: '',
    canceling: false,
    cancelError: '',
  };
}

const methods = {
  _statusFailure(message) {
    this.setData({ status: 'ERROR', statusError: message || '没能确认注销条件，请稍后重试。', blockers: [] });
  },

  loadStatus() {
    const token = (this._statusToken || 0) + 1;
    this._statusToken = token;
    this.setData({ status: 'LOADING', statusError: '', blockers: [], cancelError: '' });
    sendUiStateRequest(app, '/api/user/deregister/status', {
      method: 'GET',
      success: (res) => {
        if (token !== this._statusToken) return;
        const data = isOk(res) && isRecord(res.data) ? res.data : null;
        if (!data || typeof data.status !== 'string') {
          this._statusFailure(bizFailureMessage(res, '注销状态暂时无法读取，请重试。'));
          return;
        }
        if (data.status === 'PENDING') {
          this.setData({ status: 'PENDING', executeAfter: executeAfterText(data.executeAfter), statusError: '' });
          return;
        }
        if (STATUS_AFTER_APPLICATION.includes(data.status)) {
          this.loadPrecheck(token);
          return;
        }
        this._statusFailure('账号注销状态待确认，请稍后重试。');
      },
      fail: () => { if (token === this._statusToken) this._statusFailure('网络异常，注销状态没有读取成功。'); },
      successStatusAbnormal: () => { if (token === this._statusToken) this._statusFailure('服务暂时不可用，请稍后重试。'); },
    });
  },

  loadPrecheck(existingToken) {
    const token = existingToken == null ? (this._statusToken || 0) + 1 : existingToken;
    this._statusToken = token;
    if (existingToken == null) this.setData({ status: 'LOADING', statusError: '', blockers: [] });
    sendUiStateRequest(app, '/api/user/deregister/precheck', {
      method: 'POST',
      success: (res) => {
        if (token !== this._statusToken) return;
        const data = isOk(res) && isRecord(res.data) ? res.data : null;
        const blockers = data ? blockerList(data.blockers) : null;
        if (!data || (data.status !== 'ELIGIBLE' && data.status !== 'BLOCKED') || blockers === null
          || (data.status === 'ELIGIBLE' && blockers.length) || (data.status === 'BLOCKED' && !blockers.length)) {
          this._statusFailure(bizFailureMessage(res, '注销条件返回异常，请稍后重试。'));
          return;
        }
        this.setData({ status: data.status, blockers, statusError: '', canceling: false, cancelError: '' });
      },
      fail: () => { if (token === this._statusToken) this._statusFailure('网络异常，注销条件没有核验成功。'); },
      successStatusAbnormal: () => { if (token === this._statusToken) this._statusFailure('服务暂时不可用，请稍后重试。'); },
    });
  },

  goCancellationNotice() { this.setData({ showNoticeSheet: true }); },
  closeNoticeSheet() { this.setData({ showNoticeSheet: false }); },
  inputCode(event) {
    this.setData({ smscode: event.detail.value || '', applyError: '' }, () => this.refreshApplyState());
  },
  toggleConfirmed(event) {
    this.setData({ confirmed: !!event.detail.value.length, applyError: '' }, () => this.refreshApplyState());
  },

  refreshApplyState() {
    const canApply = this.data.confirmed && !!(this.data.smscode || '').trim();
    if (canApply !== this.data.canApply) this.setData({ canApply });
  },

  sendSms() {
    if (this.data.smsSending) return;
    const token = (this._smsToken || 0) + 1;
    this._smsToken = token;
    this.setData({ smsSending: true, smsSent: false, smsError: '' });
    sendUiStateRequest(app, '/api/user/info', {
      method: 'POST', data: { member_id: app.getUserID() },
      success: (res) => {
        if (token !== this._smsToken) return;
        const phone = isOk(res) && isRecord(res.data) && typeof res.data.phone === 'string' ? res.data.phone.trim() : '';
        if (!phone) {
          this.setData({ smsSending: false, smsSent: false, smsError: bizFailureMessage(res, '请先绑定手机号后再获取验证码。') });
          return;
        }
        sendUiStateRequest(app, '/api/sms/send', {
          method: 'POST', data: { phone },
          success: (smsRes) => {
            if (token !== this._smsToken) return;
            if (isOk(smsRes)) {
              this.setData({ phone, phoneMasked: phone.slice(-4), smsSending: false, smsSent: true, smsError: '' });
              return;
            }
            this.setData({ smsSending: false, smsSent: false, smsError: (smsRes && smsRes.msg) || '验证码发送失败，请重试。' });
          },
          fail: () => { if (token === this._smsToken) this.setData({ smsSending: false, smsSent: false, smsError: '网络异常，验证码没有发送。' }); },
          successStatusAbnormal: () => { if (token === this._smsToken) this.setData({ smsSending: false, smsSent: false, smsError: '服务暂时不可用，验证码没有发送。' }); },
        });
      },
      fail: () => { if (token === this._smsToken) this.setData({ smsSending: false, smsSent: false, smsError: '网络异常，手机号没有读取成功。' }); },
      successStatusAbnormal: () => { if (token === this._smsToken) this.setData({ smsSending: false, smsSent: false, smsError: '服务暂时不可用，手机号没有读取成功。' }); },
    });
  },

  apply() {
    if (this.data.submitting) return;
    const smscode = (this.data.smscode || '').trim();
    if (!this.data.confirmed) {
      this.setData({ applyError: '请先确认已阅读并理解注销后果。' });
      return;
    }
    if (!smscode) {
      this.setData({ applyError: '请输入短信验证码。' });
      return;
    }
    const token = (this._applyToken || 0) + 1;
    this._applyToken = token;
    this.setData({ submitting: true, applyError: '' });
    Promise.resolve().then(() => app.recordConsent({
      docType: 'account_cancellation_notice', scene: 'account_cancel', eventType: 'AGREE',
    })).then(() => {
      if (token !== this._applyToken) return;
      sendUiStateRequest(app, '/api/user/deregister/apply', {
        method: 'POST',
        data: { smscode, requestId: requestId() },
        success: (res) => {
          if (token !== this._applyToken) return;
          const data = isOk(res) && isRecord(res.data) ? res.data : null;
          if (data && data.status === 'PENDING') {
            this.setData({ status: 'PENDING', executeAfter: executeAfterText(data.executeAfter), submitting: false, applyError: '' });
            return;
          }
          const blockers = data && data.status === 'BLOCKED' ? blockerList(data.blockers) : null;
          if (blockers && blockers.length) {
            this.setData({ status: 'BLOCKED', blockers, submitting: false, applyError: '' });
            return;
          }
          this.setData({ submitting: false, applyError: bizFailureMessage(res, '注销申请没有提交成功，请重试。') });
        },
        fail: () => { if (token === this._applyToken) this.setData({ submitting: false, applyError: '网络异常，验证码和确认状态已保留，请重试。' }); },
        successStatusAbnormal: () => { if (token === this._applyToken) this.setData({ submitting: false, applyError: '服务暂时不可用，验证码和确认状态已保留，请重试。' }); },
      });
    }).catch(() => {
      if (token === this._applyToken) this.setData({ submitting: false, applyError: '同意记录失败，请重试。' });
    });
  },

  cancel() {
    if (this.data.canceling) return;
    const token = (this._cancelToken || 0) + 1;
    this._cancelToken = token;
    this.setData({ canceling: true, cancelError: '' });
    modal.show({
      dangerKey: 'account.deregister.cancel',   // 三段式文案在 utils/danger-actions.js
      success: (result) => {
        if (token !== this._cancelToken) return;
        if (!result.confirm) {
          this.setData({ canceling: false });
          return;
        }
        sendUiStateRequest(app, '/api/user/deregister/cancel', {
          method: 'POST',
          success: (res) => {
            if (token !== this._cancelToken) return;
            const data = isOk(res) && isRecord(res.data) ? res.data : null;
            if (data && data.status === 'CANCELLED') {
              this.setData({ canceling: false, cancelError: '' });
              this.loadPrecheck();
              return;
            }
            this.setData({ canceling: false, cancelError: bizFailureMessage(res, '撤销申请没有完成，请重试。') });
          },
          fail: () => { if (token === this._cancelToken) this.setData({ canceling: false, cancelError: '网络异常，撤销申请没有完成。' }); },
          successStatusAbnormal: () => { if (token === this._cancelToken) this.setData({ canceling: false, cancelError: '服务暂时不可用，撤销申请没有完成。' }); },
        });
      },
      fail: () => { if (token === this._cancelToken) this.setData({ canceling: false, cancelError: '撤销确认没有打开，请重试。' }); },
    });
  },

  dispose() {
    this._statusToken = (this._statusToken || 0) + 1;
    this._smsToken = (this._smsToken || 0) + 1;
    this._applyToken = (this._applyToken || 0) + 1;
    this._cancelToken = (this._cancelToken || 0) + 1;
  },
};

module.exports = { initialData, methods };
