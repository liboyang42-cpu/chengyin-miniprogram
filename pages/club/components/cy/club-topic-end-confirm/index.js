// cy-club-topic-end-confirm · J5 结束主题(T2 居中确认)。Figma node 164:118。
// T2 定义(见共用施工须知):没有顶栏、没有独立返回,只能点按钮 —— 直接是 cy-modal 的形状。
//   CU-C-154 之后右上角那颗 ✕ 由 cy-modal 统一规则提供(!loading 时常驻,走 cancel 出口),
//   不是本组件自己画的;所以这里不再重复声明"没有 ✕"。
//   不需要 cy-danger-confirm 的三段式(那套是给"后果清单 + 更轻替代方案分开摆"用的;
// 这里的替代方案「下架就够了」是一句话文案,已经写进正文,不是独立按钮)。
// 组件不发请求:真正调用哪个接口由宿主决定,组件只负责按 loading/errorText 摆样子。
//
// 正文承诺的退款 2026-09-09 已经兑现:宿主调 /api/club/topic-setting/end,
// 服务端先停售,再把这个主题名下所有在办场次逐场走 cancelOccurrence(退不了的走
// cancelActivityByClubOperator),两条都是全额原路退。含已核销票的整单退不了,
// 回包里的 manualOrders 会报出来,宿主要照实显示,不能吞。
Component({
  properties: {
    show: { type: Boolean, value: false },
    topicName: { type: String, value: '' },
    loading: { type: Boolean, value: false },
    errorText: { type: String, value: '' },
  },
  data: {
    bodyCopy: '停止售卖并把未核销的票原价退回。只是想让它不再露出的话，下架就够了。',
    contentText: '停止售卖并把未核销的票原价退回。只是想让它不再露出的话，下架就够了。',
  },
  // ⚠️ 正文的拼接放在 JS,不放 WXML。
  //    原来写的是 content="{{errorText ? bodyCopy + '\n' + errorText : bodyCopy}}",
  //    而 **WXML 表达式解析器不支持 '\n' 这类反斜杠转义** —— 微信开发者工具直接报
  //    「Bad attr `content` with message: error at token `$`」,**整个小程序编译不出来、
  //    模拟器起不来**(2026-09-02 用户实测日志坐实)。
  //    这类错单测和 DS 门禁都看不见:它们不编译 WXML。
  // CU-C-154:主题名不再拼进标题(长名会把标题撑成两行、还挤掉首屏正文),
  //    改成正文第一行的副信息 —— 标题只承担「结束主题」这一件事。
  observers: {
    'errorText, bodyCopy, topicName': function (errorText, bodyCopy, topicName) {
      const name = String(topicName || '').trim();
      const head = name ? '「' + name + '」\n' : '';
      this.setData({ contentText: head + (errorText ? bodyCopy + '\n' + errorText : bodyCopy) });
    },
  },
  methods: {
    onConfirm() {
      if (this.data.loading) return;
      this.triggerEvent('confirm');
    },
    onCancel() {
      if (this.data.loading) return;
      this.triggerEvent('cancel');
    },
  },
});
