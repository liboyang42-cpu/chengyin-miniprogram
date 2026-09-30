const app = getApp();

Component({
  options: { multipleSlots: true },
  properties: {
    show: { type: Boolean, value: false },
    variant: { type: String, value: 'full' }, // full(T3) | half(T1)
    theme: { type: String, value: 'player' }, // player | merchant
    title: { type: String, value: '' },
    canBack: { type: Boolean, value: false },
    closable: { type: Boolean, value: true },
    dirty: { type: Boolean, value: false },
    maskClosable: { type: Boolean, value: false },
    footer: { type: Boolean, value: false },
    zIndex: { type: Number, value: 1200 },
    reducedMotion: { type: Boolean, value: false },
  },
  data: {
    navTop: 0,
    navRight: 0,
    closeLabel: '关闭当前场景',
    panelTopPx: 0,
  },
  observers: {
    title(value) {
      this.setData({ closeLabel: value ? '关闭' + value : '关闭当前场景' });
    },
  },
  lifetimes: {
    attached() {
      const globalData = (app && app.globalData) || {};
      const menuButtonInfo = globalData.menuButtonInfo;
      const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const windowWidth = windowInfo.windowWidth || windowInfo.screenWidth || 375;
      const navTop = globalData.statusBarHeight || windowInfo.statusBarHeight || 20;
      const navRight = menuButtonInfo && menuButtonInfo.left
        ? Math.max(24, Math.round(windowWidth - menuButtonInfo.left + 12))
        : 100;
      // token 的 --cy-safe-top 用 env(safe-area-inset-top) 反算,但它在模拟器和无刘海
      // 真机上解析为 0 —— 面板顶会越过胶囊(2026-09-18 凭证码卡实拍)。以胶囊真实底边为准。
      let panelTopPx = 0;
      if (menuButtonInfo && Number.isFinite(Number(menuButtonInfo.bottom))) {
        panelTopPx = Number(menuButtonInfo.bottom) + 8;
      }
      this.setData({
        navTop,
        navRight,
        panelTopPx,
        closeLabel: this.data.title ? '关闭' + this.data.title : '关闭当前场景',
      });
    },
  },
  methods: {
    noop() {},
    onBack() { this.triggerEvent('back'); },
    onMask() {
      if (!this.data.maskClosable) return;
      this._requestClose('mask');
    },
    onClose() { this._requestClose('close'); },
    _requestClose(reason) {
      this.triggerEvent('requestclose', { reason });
      if (!this.data.dirty) this.triggerEvent('close', { reason });
    },
  },
});
