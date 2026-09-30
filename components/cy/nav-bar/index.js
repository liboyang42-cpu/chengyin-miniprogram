const app = getApp();
Component({
  options: { multipleSlots: true },
  properties: {
    title:    { type: String, value: '' },
    back:     { type: Boolean, value: true },
    overlay:  { type: Boolean, value: false },  // hero 详情页首屏透明
    scrolled: { type: Boolean, value: false },  // 页面 onPageScroll 驱动:滚过 hero → 实底
    pill:     { type: Boolean, value: false },  // hero 页返回钮套玻璃胶囊(封面大图上可见)
    customBack:{ type: Boolean, value: false }, // 返回逻辑由页面 bind:back 接管(不走组件内建 navigateBack)
    tint:     { type: String, value: '' },      // '' 随主题;'dark'/'light' 强制 nav 文字色(浅/暗 hero 与页面主题解耦)
    pillDark: { type: Boolean, value: false },  // 返回钮胶囊改深色 scrim(用户封面图等亮 hero 上白箭头可见)
    plain:    { type: Boolean, value: false }, // 素色模式:只留返回行,底色=页面底色,无边框无blur;大标题由页面用 cy-page-title 放内容顶部
  },
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    actionsRight: 96,   // px,attached 里按微信胶囊左缘算,避免右侧 action 被胶囊遮挡
    windowWidth: 375,   // px,attached 实测;标题槽算得下算不下要靠它
    // px,标题槽左右内距。**默认两侧同值 ⇒ 标题几何居中**(2026-07-29 复核阻塞项 1:
    // 旧实现 left=actionsRight / right=titleRight 左右不等,右 action 一宽标题就被推向左边)。
    // 仅在「对称收缩会把标题挤成 0 宽」这一种物理不可能的情况下才允许左右不等,见 _titleInsets。
    titleLeft: 96,
    titleRight: 96,
    // 可用标题槽窄于最小可读宽度时**不渲染** nav 标题(2026-07-29 裁决)。
    // 语义不丢:此时由页面自己的内容标题承担 —— 这比塞一个 0 宽/被截断到看不出词的标题诚实。
    showTitle: true,
    offline: false,
  },
  lifetimes: {
    attached() {
      if (app.networkStatus) this._offNetwork = app.networkStatus.subscribe((offline) => this.setData({ offline }));
      const mb = app.globalData.menuButtonInfo;
      if (mb && mb.left) {
        const w = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const sw = w.windowWidth || w.screenWidth || 375;
        const right = Math.max(24, Math.round(sw - mb.left + 12));
        this.setData(Object.assign({ actionsRight: right, windowWidth: sw },
          this._titleInsets(sw, right, 0)));
      }
    },
    detached() {
      if (this._offNetwork) this._offNetwork();
    },
    ready() {
      // 实测 action 槽宽度:宽 action(如"看公开主页"胶囊)时**左右同收**,标题仍几何居中且不与 action 重叠。
      // 图标/空 action 宽度≈0 → 退回基线内距,其它页零漂移。
      this.createSelectorQuery().select('.nav__actions').boundingClientRect(rect => {
        const w = rect && rect.width ? Math.round(rect.width) : 0;
        this.setData(this._titleInsets(this.data.windowWidth, this.data.actionsRight, w));
      }).exec();
    },
  },
  methods: {
    /**
     * 标题槽内距的唯一算法(纯函数,无副作用 —— 契约直接跑它做行为断言)。
     *
     * 三条约束在 375pt + 超宽 action 下互相打架:①几何居中 ②不与 action 重叠 ③标题可读。
     * 2026-07-29 裁决:①②不让步,③不满足时**不渲染标题**。
     * 于是 left/right 恒等(永远不会左偏),窄到读不出来就整个收掉,由页面内容标题承担语义。
     *
     * @returns {{titleLeft:number, titleRight:number, showTitle:boolean}}
     */
    _titleInsets(windowWidth, actionsRight, actionWidth) {
      const BASE_GUTTER = 96;   // px,返回钮命中区(88rpx)+ 呼吸;也是无 action 页的基线
      // px,低于此宽度的标题读不出词(≈4 个汉字 + 省略号),宁可不渲染。
      // ⚠️ 后果要清楚:微信胶囊本身就吃掉右侧 ~96px,对称居中等于左侧也让出 96px,
      //   375pt 屏只剩 ~183px;右 action 每宽 1px 就吃掉 2px。所以 375pt 上
      //   action 宽超过 ~24px(含多数图标钮)标题就会整个收掉,由页面内容标题承担语义。
      //   这是"居中 + 不重叠"两条硬约束在微信导航条宽度下的必然结果,不是阈值调小能绕开的。
      const MIN_TITLE_W = 88;
      // action 实测宽 ≈0(图标/空槽)时不加算,否则窄 action 会把标题反向收小 ⇒ 其它页零漂移
      const needed = actionWidth > 8 ? actionsRight + actionWidth + 24 : actionsRight;
      const gutter = Math.max(BASE_GUTTER, needed);
      const sw = windowWidth > 0 ? windowWidth : 375;
      // 左右恒同值:居中这条永不让步
      return { titleLeft: gutter, titleRight: gutter, showTitle: sw - gutter * 2 >= MIN_TITLE_W };
    },
    onBack() {
      this.triggerEvent('back');
      if (this.data.customBack) return;   // 页面接管返回
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack();
      else if (wx.exitMiniProgram) wx.exitMiniProgram();
    },
  },
});
