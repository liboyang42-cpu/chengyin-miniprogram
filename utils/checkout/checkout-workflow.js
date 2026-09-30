// Phase 3.2 结算支付状态机。
//
// 下单→支付时序与不变量。依赖注入,页面保留各自 UI
// (toast/loading/跳转/goBack 差异)。状态:idle → submitting → (payable?) paying → [verifying?] done : 免费成功 → done。
//
// 依赖:
//  - createOrder(payload, cb):创建订单(报名);cb({ ok, data, msg, ... })。
//  - requestPayment(orderData, cb):拉起微信支付;cb({ ok, cancelled, errMsg })。
//  - isPayable(orderData):是否需支付(默认 payableAmount > 0)。
//  - verifyPayment(data, cb):可选,支付成功后向服务端确认终态;cb({ ok })。
//
// submit(payload, handlers) 的 handlers(均可选):
//  onOrderFail(res) / onFreeSuccess(data) / onPayVerifying(data) / onPaySuccess(data) /
//  onPayCancel() / onPayFail(res) / onPayUnknown(res)。

var REQUIRED_PAYMENT_FIELDS = ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign'];
var safeUserMessage = require('../transport/safe-user-message.js').safeUserMessage;

// 2026-09-17 拍板 #21:旧幂等键不可用(单已过期/已取消)的机器判据。
// 两条来源,前端都识别,识别面只用于「自动换幂等键重建」,认错方向不会误重建正常单:
//   ① /pay 对过期待支付单的拒绝 —— 后端 ApiRegistrationController.pay/payApp 映射成业务
//      code 410(HTTP 仍是 200);文案兜底兼容尚未升级的 jar。
//   ② /create 对终态单(已取消3/已过期4)的拒绝 —— fix-be-0917(B-R2)起不再把终态单当重放
//      返回,改抛 409「该幂等键对应的报名已取消/已过期，请重新发起报名」;同码的
//      「价格已更新」是另一回事,由页面按文案区分。
var ORDER_EXPIRED_CODE = 410;
var ORDER_EXPIRED_TEXT = '订单已过期';
var TERMINAL_ORDER_CONFLICT_TEXT = '该幂等键对应的报名已';
// 页内信号:createOrder 回调检测到旧键不可用时用它把控制权交给 onOrderFail 的重建分支,
// 不作为用户可见文案(重建仍失败时页面给 ORDER_EXPIRED_USER_MESSAGE 或后端原文)。
var ORDER_REBUILD_REQUIRED = 'order_rebuild_required';
// 与后端拒绝原文逐字同源(CmsRegistrationServiceImpl.preparePaymentRetry),见跨端契约测试。
var ORDER_EXPIRED_USER_MESSAGE = '订单已过期,请重新报名';

function isOrderExpiredFailure(res) {
  if (!res || typeof res !== 'object') return false;
  if (res.code == ORDER_EXPIRED_CODE) return true;
  var raw = res.msg || res.message || res.errMsg || '';
  return String(raw).indexOf(ORDER_EXPIRED_TEXT) >= 0;
}

// /create 的 409 里,只有「该幂等键对应的报名已取消/已过期」这一类要换键重建;
// 「价格已更新，请重新确认」(RegistrationOrderCreateGateImpl) 维持页面的重报价逻辑。
function isTerminalOrderConflict(res) {
  if (!res || typeof res !== 'object') return false;
  if (!(res.code == 409)) return false;
  var raw = String(res.msg || res.message || '');
  return raw.indexOf(TERMINAL_ORDER_CONFLICT_TEXT) >= 0;
}

function safePaymentFailure(result, fallback) {
  var normalized = result && typeof result === 'object' ? Object.assign({}, result) : {};
  var raw = normalized.errMsg || normalized.msg;
  normalized.errMsg = safeUserMessage(raw, fallback || '支付失败，请重试');
  if (normalized.msg !== undefined) normalized.msg = safeUserMessage(normalized.msg, fallback || '支付失败，请重试');
  return normalized;
}

function hasCompletePaymentParams(data) {
  var params = data && data.payParams;
  if (!params || typeof params !== 'object') return false;
  return REQUIRED_PAYMENT_FIELDS.every(function (field) {
    var value = params[field];
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
}

function createCheckoutWorkflow(deps) {
  deps = deps || {};
  var createOrder = deps.createOrder;
  var requestPayment = deps.requestPayment;
  var isPayable = deps.isPayable || function (d) { return d && d.payableAmount > 0; };
  var verifyPayment = deps.verifyPayment; // 可选:支付成功后向服务端确认终态
  var validatePayment = deps.validatePayment; // 可选:页面按自己的支付参数形态做完整性校验

  if (!createOrder || !requestPayment) {
    throw new Error('checkout-workflow: 缺少 createOrder/requestPayment 依赖');
  }

  var state = 'idle'; // idle | submitting | paying | verifying | unknown | done
  var destroyed = false;
  var generation = 0;
  var activeControl = null;

  function call(fn, arg) { if (typeof fn === 'function') fn(arg); }
  function current(run) { return !destroyed && run === generation; }
  function remember(control) {
    if (control && (typeof control.abort === 'function' || typeof control.destroy === 'function')) {
      activeControl = control;
    }
  }
  function stopActive() {
    var control = activeControl;
    activeControl = null;
    if (!control) return;
    try {
      if (typeof control.destroy === 'function') control.destroy();
      else if (typeof control.abort === 'function') control.abort();
    } catch (e) {}
  }

  function submit(payload, handlers) {
    handlers = handlers || {};
    // 防重:仅 idle 可发起(submitting/paying/verifying 在途、done 已完成均忽略)。
    if (state !== 'idle') return false;
    state = 'submitting';
    var run = ++generation;

    var orderControl = createOrder(payload, function (orderRes) {
      if (!current(run)) return; // 销毁/新一代后不再回调,避免 setData after unload
      activeControl = null;
      if (!orderRes || !orderRes.ok) {
        state = 'idle'; // 创建失败可重试
        call(handlers.onOrderFail, orderRes);
        return;
      }
      var data = orderRes.data;
      if (!isPayable(data)) {
        state = 'done';
        call(handlers.onFreeSuccess, data);
        return;
      }
      if (validatePayment && !validatePayment(data)) {
        state = 'idle';
        call(handlers.onPayFail, safePaymentFailure(
          { ok: false, status: 'failed', errMsg: '支付参数不完整，请重新发起' },
          '支付参数不完整，请重新发起'
        ));
        return;
      }
      state = 'paying';
      var payControl = requestPayment(data, function (payRes) {
        if (!current(run)) return;
        activeControl = null;
        if (payRes && payRes.ok) {
          if (verifyPayment) {
            state = 'verifying';
            call(handlers.onPayVerifying, data);
            var verificationSettled = false;
            var verifyControl = verifyPayment(data, function (verifyRes) {
              verificationSettled = true;
              if (!current(run)) return;
              activeControl = null;
              if (verifyRes && verifyRes.ok) {
                state = 'done'; // 支付成功只可能进 done 一次
                call(handlers.onPaySuccess, data);
              } else if (verifyRes && verifyRes.status === 'unknown') {
                state = 'unknown'; // 结果不明时禁止重建订单，必须从订单页/服务端回读
                call(handlers.onPayUnknown, verifyRes);
              } else {
                state = 'idle'; // 验证失败可重试(如订单终态仍为非支付,用户可手动重查)
                call(handlers.onPayFail, safePaymentFailure(verifyRes, '支付确认失败，请稍后重试'));
              }
            });
            if (!verificationSettled) remember(verifyControl);
          } else {
            state = 'done'; // 支付成功只可能进 done 一次
            call(handlers.onPaySuccess, data);
          }
        } else {
          state = 'idle'; // 取消/失败可重试
          if (payRes && payRes.cancelled) call(handlers.onPayCancel);
          else call(handlers.onPayFail, safePaymentFailure(payRes, '支付失败，请重试'));
        }
      });
      if (state === 'paying') remember(payControl);
    });
    if (state === 'submitting') remember(orderControl);
    return true;
  }

  return {
    submit: submit,
    destroy: function () {
      destroyed = true;
      generation += 1;
      stopActive();
    },
    getState: function () { return state; },
    isBusy: function () { return state === 'submitting' || state === 'paying' || state === 'verifying'; },
  };
}

module.exports = {
  createCheckoutWorkflow: createCheckoutWorkflow,
  hasCompletePaymentParams: hasCompletePaymentParams,
  isOrderExpiredFailure: isOrderExpiredFailure,
  isTerminalOrderConflict: isTerminalOrderConflict,
  ORDER_REBUILD_REQUIRED: ORDER_REBUILD_REQUIRED,
  ORDER_EXPIRED_USER_MESSAGE: ORDER_EXPIRED_USER_MESSAGE,
};
