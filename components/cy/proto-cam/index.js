/* 原型取景面板。行为整段从 subpackageRoam/citystamp/index.js 抽出来:
   问一次相机授权 → 开预览 → 快门 takePhoto → 把 tempImagePath 交给宿主。
   组件只管「拍到一张」,拍完怎么用(写签 / 存集邮册 / 存足迹)由宿主决定。 */
Component({
  properties: {
    show: { type: Boolean, value: false, observer(v) { if (v) this._boot(); else this.setData({ camFull: false }); } },
  },
  data: {
    topSafe: 96,
    camReady: false,
    camFull: false,
    camFront: false,
    camErr: '',
  },
  lifetimes: {
    attached() {
      // 取景卡要避开微信胶囊那条带:和 citystamp 同一条算式,问不到就用稿上的 96。
      let topSafe = 96;
      try {
        const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const menu = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
        if (menu && menu.bottom) topSafe = Math.round(menu.bottom + 8);
        else if (sys && sys.statusBarHeight) topSafe = Math.round(sys.statusBarHeight + 52);
      } catch (e) { /* 拿不到就用默认值,不该因为这一条让取景卡开不出来 */ }
      this.setData({ topSafe });
      if (this.data.show) this._boot();
    },
  },
  methods: {
    _boot() {
      this.setData({ camErr: '' });
      wx.getSetting({
        success: (res) => {
          if (res.authSetting && res.authSetting['scope.camera'] === false) {
            this.setData({ camReady: false, camErr: '相机没授权，去设置里打开' });
            return;
          }
          this.setData({ camReady: true });
        },
        fail: () => this.setData({ camReady: true }),   // 问不到就先开,真不行由 binderror 兜
      });
    },
    onCamError() {
      this.setData({ camReady: false, camErr: '相机打不开，去设置里检查权限' });
    },
    onCamFull() { this.setData({ camFull: !this.data.camFull }); },
    onCamFlip() { this.setData({ camFront: !this.data.camFront }); },
    onCamClose() { this.setData({ camFull: false }); this.triggerEvent('close'); },
    onShoot() {
      if (!this.data.camReady) { this.onCamError(); return; }
      const ctx = wx.createCameraContext(this);
      ctx.takePhoto({
        quality: 'high',
        success: (res) => {
          this.setData({ camFull: false });
          this.triggerEvent('shot', { path: res.tempImagePath });
        },
        fail: () => this.onCamError(),
      });
    },
  },
});
