// cy-cover-fallback · 封面资产合同(ADA,2026-07-29)
//
// 列表卡的封面有三种"没图"的样子,页面此前各写各的:src 为空 / src 有值但加载失败 / 加载中。
// 前两种都必须落到同一个「主题名文字封面」——不是留一个黑洞,也不是塞一张灰色占位图。
// 本组件把这条合同收成一个组件:传 src + title,剩下的它管。
//
// 身份闸(照搬 mytemplate 已验证过的做法):失败态挂在「当前这条 src」上,
// src 变了就把 failed 清掉重试 —— 否则列表复用节点时,A 条的加载失败会让 B 条也永远显示兜底。
Component({
  properties: {
    src: { type: String, value: '' },
    title: { type: String, value: '' },
    // mode:透传给 <image>,列表卡默认 aspectFill
    mode: { type: String, value: 'aspectFill' },
  },
  data: {
    failed: false,
    _boundSrc: '',
  },
  observers: {
    src(next) {
      if (next !== this.data._boundSrc) {
        this.setData({ _boundSrc: next, failed: false });
      }
    },
  },
  methods: {
    onError() {
      this.setData({ failed: true });
      this.triggerEvent('covererror', { src: this.data.src });
    },
  },
});
