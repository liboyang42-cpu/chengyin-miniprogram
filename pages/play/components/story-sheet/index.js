// cy-story-sheet · 剧情「全屏叙事页」外壳(两段式的第二段)
// 第一段是页面里的摘要卡(节点名 + 前 2 行 + 展开),点开后由本组件承接全文。
//
// 转场参照 13_剧情弹窗.mp4 的 Scale+Dim 档(视频里两档对照,取推荐的那档):
//   · 背景页缩到 0.94 并压暗,顶部还留一截圆角露在外面 —— 让人看出前景是「叠」在背景上,
//     不是背景整个消失。背景缩放由页面侧加 class 完成(组件够不到页面根节点),
//     本组件只负责前景面板与压暗层。
//   · 前景面板从下方放大展开,与背景缩放同一条时长/曲线,视觉上是一次连续的推拉。
// ⚠️ 只做外壳:剧情文案与顺序(含防剧透排序)一律由调用方算好传进来,组件不参与排序/裁剪。
Component({
  options: { multipleSlots: false },
  properties: {
    show: { type: Boolean, value: false },
    // 节点名/章节名,显示在全文上方
    title: { type: String, value: '' },
    // 小标签(如「我的第 3 步」),可为空
    step: { type: String, value: '' },
    // 剧情配图 hero;为空时不占位,不塞占位图
    cover: { type: String, value: '' },
    // 全文。按 \n 切段落后渲染,组件不改写内容
    text: { type: String, value: '' },
    reduced: { type: Boolean, value: false },
  },
  // panelTop / closeTop 为 null 时不下发内联 style,由 WXSS 里的兜底值接住(见 index.wxss)
  data: { paras: [], panelTop: null, closeTop: null },
  lifetimes: {
    attached() { this._layout(); },
  },
  observers: {
    text(v) {
      const raw = String(v == null ? '' : v);
      this.setData({ paras: raw.split('\n').filter((s) => s.trim() !== '') });
    },
  },
  methods: {
    // 面板顶 + 关闭钮顶一次算清,两者用同一套算术,不做任何 DOM 测量。
    //
    // ⚠️ 为什么不用 CSS 的 calc(env(safe-area-inset-top) + var(--cy-space-8)):
    //    实测 env(safe-area-inset-top) 在开发者工具 iPhone12/13 模拟器上解析成 0(而 statusBarHeight 报 47),
    //    面板顶只到 49px,而微信胶囊占 51~83px —— 关闭钮直接扎进胶囊里,纵向压 22px。
    // ⚠️ 为什么不用 createSelectorQuery 去量 .sts__panel 的真实位置再反推:
    //    试过 5 轮(含 .in(this) / nextTick / 隔帧重试),wx:if 刚渲染那一拍 boundingClientRect 一直拿不到,
    //    closeTop 每次都退回兜底值 —— 这条异步测量的路在本环境不可靠,不要再走。
    // 取舍:真机上 env(safe-area-inset-top) 本该等于安全区,这里统一用 statusBarHeight 近似,
    //       面板顶可能比原来低一点点,已确认可接受 —— 换来的是面板顶和关闭钮顶口径统一,不会各算各的。
    _layout() {
      const app = typeof getApp === 'function' ? getApp() : null;
      const g = (app && app.globalData) || {};
      let w = {};
      try { w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) { w = {}; }
      // rpx→px 换算口径与 WXSS 一致(设计稿 750rpx 宽)
      const winW = w.windowWidth || 375;
      const rpx = (v) => (v * winW) / 750;

      const statusBarHeight = g.statusBarHeight || w.statusBarHeight || 20;
      const panelTop = statusBarHeight + rpx(96);   // 对齐原 CSS 的 env(safe-area-inset-top) + --cy-space-8
      const baseInset = rpx(24);                    // 对齐原 CSS 的 --cy-space-3,也是拿不到胶囊时的兜底

      let mb = g.menuButtonInfo;
      if (!mb || typeof mb.bottom !== 'number') {
        try { mb = wx.getMenuButtonBoundingClientRect(); } catch (e) { mb = null; }
      }
      // closeTop 是相对面板顶的偏移,所以要减掉 panelTop;+8 是让开胶囊后仍留的呼吸量
      const closeTop = mb && typeof mb.bottom === 'number'
        ? Math.max(baseInset, mb.bottom + 8 - panelTop)
        : baseInset;

      this.setData({ panelTop, closeTop });
    },
    onClose() { this.triggerEvent('close'); },
    // 面板本身吞掉点击,避免点正文时被压暗层的关闭接住
    noop() {},
  },
});
