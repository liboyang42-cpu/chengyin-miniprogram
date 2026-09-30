// 深链兼容壳。分润取数与展示在 components/cy/scene-merchant-profit。
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
  },
  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail() { wx.redirectTo({ url: '/subpackageA/pages/assetcenter/earnings/index' }); },
    });
  },
});
