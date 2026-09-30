/* ⚠️ error 与 data 的分界:**这件事做成了没有**。
   data = 页面上某一块没刷新出来,已有内容仍然可用(蓝色 ⓘ,提示语气);
   error = 用户刚才那个动作**失败了**,不重试就没有结果(红色 ⚠,失败语气)。
   2026-09-10 用户实拍指出:结算页支付失败也走了 data 档,一条蓝色 ⓘ「这次报名还没完成」
   看着像一句提示,而它其实是「钱没付成、票没出」。失败不能穿提示的衣服。 */
const KIND_DEFAULTS = {
  network: { glyph: 'warning', title: '网络没连上',       sub: '连接恢复后可继续' },
  data:    { glyph: 'info',    title: '这部分没更新成功', sub: '已有内容仍可查看' },
  error:   { glyph: 'warning', title: '这一步没有完成',   sub: '重试一次，或稍后再来' },
};

Component({
  properties: {
    kind: { type: String, value: 'data' },
    title: { type: String, value: '' },
    sub: { type: String, value: '' },
    // 单一局部恢复动作；空值时不渲染 CTA。
    action: { type: String, value: '' },
    aria: { type: String, value: '' },
  },
  data: {
    _glyph: 'info',
    _title: '这部分没更新成功',
    _sub: '已有内容仍可查看',
  },
  observers: {
    'kind, title, sub, aria': function (kind, title, sub, aria) {
      const defaults = KIND_DEFAULTS[kind] || KIND_DEFAULTS.data;
      const resolvedTitle = title || defaults.title;
      // 兜底文案只在调用方**什么都没说**时顶上去。给了自己的 title 就是在说一件具体的事,
      // 再补一句通用重试话术等于把无关解释挂上去(CU-C-140:必填校验被补成
      // 「重试一次，或稍后再来」;modal-host 甚至明写了 sub="" 要求没有副标题)。
      const resolvedSub = title ? sub : defaults.sub;
      this.setData({
        _glyph: defaults.glyph,
        _title: resolvedTitle,
        _sub: resolvedSub,
      });
    },
  },
  methods: {
    onAction() { this.triggerEvent('action'); },
  },
});
