// RUN-43:订单卡「实付款」的唯一装配口径(拍板 9-18:实付款只写现金)。
// 0 是合法现金实付,回落链必须逐段判 null,不能 ||。
function isSet(v) {
  return v !== null && v !== undefined
}

function resolveActualPaidAmount(item) {
  if (!item || typeof item !== 'object') return null
  if (isSet(item.wechatPaymentAmount)) return Number(item.wechatPaymentAmount)
  if (isSet(item.payableAmount)) return Number(item.payableAmount)
  if (isSet(item.totalAmount)) return Number(item.totalAmount)
  return null
}

module.exports = { resolveActualPaidAmount }
