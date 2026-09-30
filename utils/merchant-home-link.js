// 商家主页的 canonical 地址。统一主页宿主是 pages/userinfo/userinfo,主体 ID 是 memberId
// (不是商家档案主键 merchantId,两者不可混用)。
//
// 9 个站内入口 + 旧页兼容壳共用这一份:手写拼串时最容易漏 tab=about、漏 encodeURIComponent
// 或把 topicName 二次编码,而这三样一旦上线就会被转发卡片和收藏固化(见设计文档 §3.4)。
//
// 稳定 canonical 不带主题上下文;只有从合作名单进入时才追加 topicId/topicName,
// 它是当次合作意图的展示快照,不参与主页身份。
const PROFILE_PATH = '/pages/userinfo/userinfo';

/**
 * @param {string|number} memberId 被看者的会员 ID
 * @param {{topicId?: string|number, topicName?: string}} [context] 合作上下文,给了 topicId 才生成 contextual deep link
 * @returns {string} 空 memberId 返回 ''，调用方据此判断「这家还不能进主页」
 */
function merchantHomeUrl(memberId, context) {
  if (memberId == null || memberId === '') return '';
  let url = PROFILE_PATH + '?userId=' + memberId + '&tab=about';
  const topicId = context && context.topicId;
  if (topicId) {
    url += '&topicId=' + topicId;
    // 没有名字就不发这个键。地址会被转发卡片和收藏固化,空 topicName= 是永久噪音。
    if (context.topicName) url += '&topicName=' + encodeURIComponent(context.topicName);
    if (context.scope === 'MERCHANT') url += '&scope=MERCHANT';
  }
  return url;
}

module.exports = { merchantHomeUrl: merchantHomeUrl };
