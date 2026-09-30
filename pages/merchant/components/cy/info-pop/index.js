// cy-info-pop · 说明文案收纳(商家侧七页统一规范 §〇.6)
// 页内成段的 scope 说明 / 教育文案不再占正文,收进标题旁一枚 ⓘ,点开才看。
// 对照 Shopify:它用蓝色 info banner(284)常驻正文,我们只做 icon + 弹出,正文一行都不占。
//
// 形态二选一(variant):
//   modal —— 短说明(默认)。居中弹窗,一句到几句话,看完即关。
//   sheet —— 长说明 / 带链接 / 分条目。半屏可滚,内容多也不至于把弹窗撑满屏。
// 纯文本传 content;富内容(链接、分条)走默认 slot。
// ⚠️ 两者都给时 **content 赢、slot 被丢掉**(cy-modal 也是这个规矩,保持一致):
//    模板是 `wx:if="{{content}}"` 渲文本、`wx:else` 才渲 slot。要用 slot 就别传 content。
//
// ⚠️⚠️ slot 富内容这条路目前【未经真机/模拟器验证】,七页对接时优先用 content。
//    原因:本组件把自己的 <slot> 放在了子组件(cy-modal / cy-sheet)的标签内部,
//    slot 要穿过两层组件边界才能落位。全仓扫过一遍,只有这里这么写,没有第二处先例可参照。
//    content 那条路是已经截图核实过的(modal / sheet 两个变体都渲染正常)。
//    谁第一次真用到 slot,请先在开发者工具里确认富内容确实渲染出来了,再把这段注释删掉。
//    (2026-08-01 本轮 DevTools 被并行 worktree 占满、模拟器进入 pageStack 无响应的降级态,
//     没能当场验成,如实留痕而不是默认它可用。)
//
// 开关状态是组件自持的:这个组件的意义就是「随手挂一个 ⓘ」,
// 若还要求每个调用页自己声明一个 show 变量,七个页面就要多七份样板状态。
// 需要联动的场合仍可监听 open / close 事件。
Component({
  properties: {
    // 弹出层标题;不传则不渲染标题行
    title: { type: String, value: '' },
    // 纯文本说明。有 slot 内容时以 slot 为准(见 wxml 的 content/slot 分支)
    content: { type: String, value: '' },
    // modal(短说明,默认) | sheet(长说明/带链接)
    variant: { type: String, value: 'modal' },
    // ⓘ 图标视觉尺寸(rpx)。DS §3.2 图标枚举 24/32/40/48;
    // 触控热区固定 88rpx,由 wxss 的 ::after 撑开,不随 size 变小而失去可点性。
    size: { type: Number, value: 32 },
    // 无障碍标签。默认「查看说明」,有 title 时自动带上,免得一屏多个 ⓘ 读起来都一样
    ariaLabel: { type: String, value: '' },
  },
  data: { _open: false, _a11y: '查看说明', _sheetTitle: '说明' },
  observers: {
    'ariaLabel, title'(ariaLabel, title) {
      const custom = String(ariaLabel || '').trim();
      const t = String(title || '').trim();
      this.setData({
        _a11y: custom || (t ? t + ' · 查看说明' : '查看说明'),
        // ⚠️ cy-sheet 的头部(连同那颗 88rpx 无障碍关闭钮)是 wx:if="{{title}}" 才渲染的。
        // 不传 title 的话 sheet 就只剩「点遮罩」这一个出口,键盘/读屏用户没有可聚焦的关闭控件。
        // 所以 sheet 变体一定要给个标题,调用方没给就兜一个中性的。
        // (modal 变体不受影响:它的「知道了」按钮无条件渲染。)
        _sheetTitle: t || '说明',
      });
    },
  },
  methods: {
    onOpen() {
      if (this.data._open) return;
      this.setData({ _open: true });
      this.triggerEvent('open');
    },
    onClose() {
      if (!this.data._open) return;
      this.setData({ _open: false });
      this.triggerEvent('close');
    },
  },
});
