'use strict'

// 旧版本只有固定成功文案，不能据此确认现金到账或积分返还。
module.exports = function cancellationFeedback(response) {
  const facts = response && response.data
  if (facts && facts.cancellationStatus && facts.cashRefundStatus
      && typeof response.msg === 'string' && response.msg.trim()) return response.msg
  return '取消请求已受理，请刷新订单查看结果'
}
