const REQUIRED_LEGAL_TEXTS = [
  '西安吾令文化传媒有限公司',
  '陕西省西安市高新区锦业路1号绿地领海B座6层604室A043号',
  '15229020419',
  '2026-08-12',
  '暂不面向未成年人提供注册和使用服务',
  '未满十八周岁',
];

function validateAgreementDocs(source) {
  if (/占位版本|占位文案|占位说明|正式条款以|最终发布版|法务\/律师最终版本/.test(source)) {
    return '用户协议或注销须知仍含占位/未定稿文案';
  }
  if (REQUIRED_LEGAL_TEXTS.some(text => !source.includes(text))) {
    return '用户协议缺少已确认的运营主体、地址、客服电话、生效日期或未成年人规则';
  }
  return '';
}

module.exports = { REQUIRED_LEGAL_TEXTS, validateAgreementDocs };
