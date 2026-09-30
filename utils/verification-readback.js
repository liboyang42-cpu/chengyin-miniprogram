'use strict';

// unknown 不是失败：写入可能已在服务端提交。当前台账没有能关联“这一次请求”的
// 服务端事实键，所以只能打开记录供人工核对，绝不能拿任意第一页成功响应释放业务锁。
function offerVerificationReadback(key, workflow, adapters) {
  key = String(key || '');
  if (!key || !workflow) return false;
  adapters = adapters || {};
  // 默认走全站出口 utils/modal.js(与 wx.showModal 同形),不直接依赖原生
  var showModal = adapters.showModal || require('./modal.js').show;
  var navigateTo = adapters.navigateTo || wx.navigateTo;
  showModal({
    title: '核销结果待确认',
    content: '请打开核销记录核对结果；若没有本次记录，请退出当前页面重新进入后再试。',
    confirmText: '查看记录',
    cancelText: '稍后处理',
    success: function (result) {
      if (!result || !result.confirm) return;
      navigateTo({
        url: '/pages/merchant/ledger/index?view=redemptions'
      });
    }
  });
  return true;
}

module.exports = {
  offerVerificationReadback: offerVerificationReadback,
};
