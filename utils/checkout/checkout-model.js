// Phase 3.2 结算模型(纯函数)。
//
// 结算不变量(原各重复 2 份、共 4 份，已收敛至此)。
// 不发网络、不读 Storage、不 setData,业务规则可脱离开发者工具单测。

const { isValidMobile } = require('../form-state.js');

// 积分抵扣:1 积分 = 0.02 元,最多抵 50 元,且不超过票面。精确复刻页面原算法(round/floor 取整一致)。
var MAX_DISCOUNT = 50;   // 最多抵扣金额(元)
var POINT_VALUE = 0.02;  // 1 积分价值(元)

function round2(n) { return Math.round(n * 100) / 100; }

function computeDiscount(input) {
  input = input || {};
  var basePrice = Number(input.basePrice) || 0;
  var userPoints = Number(input.userPoints) || 0;

  if (!input.useDiscount) {
    return { discountAmount: 0, usedPoints: 0, totalAmount: parseFloat(basePrice.toFixed(2)) };
  }

  // 理论可抵扣金额:min(积分价值, 封顶, 票面)
  var discountAmount = round2(Math.min(userPoints * POINT_VALUE, MAX_DISCOUNT, basePrice));

  // 实际使用积分:受理论积分/持有积分/封顶积分/票面积分四者约束
  var theoreticalPoints = Math.round(discountAmount / POINT_VALUE);
  var maxPointsFromDiscount = Math.floor(MAX_DISCOUNT / POINT_VALUE);
  var maxPointsFromPrice = Math.floor(basePrice / POINT_VALUE);
  var usedPoints = Math.min(theoreticalPoints, userPoints, maxPointsFromDiscount, maxPointsFromPrice);

  // 按实际积分回算抵扣金额
  discountAmount = round2(Math.min(usedPoints * POINT_VALUE, basePrice, MAX_DISCOUNT));

  var totalAmount = Math.max(0, basePrice - discountAmount);
  return {
    discountAmount: discountAmount,
    usedPoints: usedPoints,
    totalAmount: parseFloat(totalAmount.toFixed(2)),
  };
}

// 下单前校验链:票务→地址→协议→姓名→手机→手机格式。任一不过返回 {ok:false,error,focusAddress?}。
// 地址缺失文案各页不同(配送地址 / 个人信息),由调用方传入 addressMissingMsg。
function validateCheckout(input) {
  input = input || {};
  if (!input.hasTicket) return { ok: false, error: '请选择票务' };
  if (!input.hasAddress) return { ok: false, error: input.addressMissingMsg || '请选择地址', focusAddress: true };
  if (!input.agreementChecked) return { ok: false, error: '请阅读并同意相关协议' };
  if (!input.realName) return { ok: false, error: '请选择有效地址，需要包含收货人姓名', focusAddress: true };
  if (!input.phone) return { ok: false, error: '请选择有效地址，需要包含手机号码', focusAddress: true };
  if (!isValidMobile(input.phone)) return { ok: false, error: '地址中的手机号码格式不正确', focusAddress: true };
  return { ok: true };
}

module.exports = {
  computeDiscount: computeDiscount,
  validateCheckout: validateCheckout,
};
