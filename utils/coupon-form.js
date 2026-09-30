// 优惠券创建表单:校验 + 提交 + 日期工具的单一真源。
// subpackageMember/couponInfo/couponInfo.js(独立页)和 pages/publish/components/reward-selector
// (发布流程内嵌半屏 sheet)都调这一份,不各自写一遍校验/提交逻辑。
const analytics = require('./analytics.js');
const { sendUiStateRequest } = require('./ui-state-request.js');

// 券类型单一真源:picker index 从 1 起(0=请选择),上送时 -1 换成后端 couponType
// 0 礼品券 / 1 9折券 / 2 8折券 / 3 体验卡。独立新建页、发布流 sheet、商家券列表共用。
const COUPON_TYPE_LABELS = ['请选择', '礼品券', '9折券', '8折券', '体验卡'];

function createDefaultFormData() {
  return {
    name: '',
    startTime: '',
    endTime: '',
    publishCount: 0,
    couponType: 0,
    description: '',
  };
}

// dirty 判据 = 6 个字段任一非空/非默认值
function isDirty(formData) {
  if (!formData) return false;
  return !!(
    formData.name ||
    formData.startTime ||
    formData.endTime ||
    (formData.publishCount && Number(formData.publishCount) > 0) ||
    (formData.couponType && Number(formData.couponType) > 0) ||
    formData.description
  );
}

function validate(formData) {
  if (!formData.name) return { ok: false, message: '请输入优惠券名称' };
  if (!formData.startTime || !formData.endTime) return { ok: false, message: '请选择优惠券日期' };
  if (formData.couponType === 0) return { ok: false, message: '请选择优惠券类型' };
  if (!formData.publishCount || parseInt(formData.publishCount, 10) <= 0) {
    return { ok: false, message: '请输入大于0的投放数量' };
  }
  return { ok: true };
}

// couponType 的 picker index 从 1 开始(0=请选择),后端要 0 起的类型值
function toSubmitPayload(formData) {
  return {
    name: formData.name,
    startTime: formData.startTime,
    endTime: formData.endTime,
    publishCount: formData.publishCount,
    couponType: formData.couponType - 1,
    description: formData.description,
  };
}

// submitCoupon:校验 + 提交 + 埋点一起做,调用方只用管 UI 态(loading/toast/关闭)
function submitCoupon(app, formData, { scope, onSuccess, onError, onComplete } = {}) {
  const check = validate(formData);
  if (!check.ok) {
    onError && onError(check.message);
    return;
  }
  const payload = toSubmitPayload(formData);
  if (scope === 'MERCHANT') payload.scope = 'MERCHANT';
  sendUiStateRequest(app, '/api/coupon/publish', {
    data: payload,
    method: 'POST',
    header: { 'Content-Type': 'application/json' },
    // 发布进度和失败都由表单自己承接，避免全局 loading/toast
    // 把 sheet 或独立页的上下文盖住。
    success(res) {
      if (res.code == '200') {
        analytics.track('coupon_verify', {
          bizType: 'coupon',
          bizId: res.data && res.data.id ? res.data.id : null,
          properties: {
            action: 'coupon_publish',
            name: payload.name,
            publishCount: payload.publishCount,
            couponType: payload.couponType,
          },
        });
        onSuccess && onSuccess(res, payload);
      } else {
        const message = app.getRequestErrorMessage
          ? app.getRequestErrorMessage(res, '发布失败')
          : ((res && res.msg) || '发布失败');
        onError && onError(message, 'response');
      }
    },
    successStatusAbnormal(res) {
      const message = app.getRequestErrorMessage
        ? app.getRequestErrorMessage(res, '发布失败，请重试')
        : '发布失败，请重试';
      onError && onError(message, 'response');
    },
    fail(err) {
      const extracted = app.getRequestErrorMessage
        ? app.getRequestErrorMessage(err, '网络错误，请重试')
        : '网络错误，请重试';
      const message = !extracted || /^request:fail\b/i.test(extracted)
        ? '网络错误，请重试'
        : extracted;
      onError && onError(message, 'network');
    },
    complete() {
      onComplete && onComplete();
    },
  });
}

// 11月26日 18:00 格式(页面展示用)
function formatDisplayTime(selectedDate, hour, minute) {
  const hourStr = hour.toString().padStart(2, '0');
  const minuteStr = minute.toString().padStart(2, '0');
  return `${selectedDate.month}月${selectedDate.day}日 ${hourStr}:${minuteStr}`;
}

module.exports = {
  COUPON_TYPE_LABELS,
  createDefaultFormData,
  isDirty,
  validate,
  toSubmitPayload,
  submitCoupon,
  formatDisplayTime,
};
