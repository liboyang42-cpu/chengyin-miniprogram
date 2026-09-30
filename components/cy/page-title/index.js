const app = getApp();
Component({
  options: { multipleSlots: true },
  properties: {
    title:    { type: String, value: '' },
    subtitle: { type: String, value: '' },     // 可选副标题(降灰)
    align:    { type: String, value: 'left' }, // left(L1 默认) | center
    safeTop:  { type: Boolean, value: true },  // true=自动让出 状态栏+导航 实高(custom 导航页顶格用);已有导航占位的页传 false
    // flush:父容器已经有横向内边距时传 true,关掉组件自带的 --cy-page-x,避免双倍缩进
    // (2026-07-31:全仓至少 8 个页面把本组件放进了带 padding 的容器里,标题被推成 64rpx 缩进)
    flush:    { type: Boolean, value: false },
  },
  data: {
    // env(safe-area-inset-top) 在模拟器上是 0 会让标题顶进导航区,改从 globalData 取实高(同 cy-nav-bar)
    safeTopPx: (app.globalData.statusBarHeight || 44) + (app.globalData.navBarHeight || 44),
  },
});
