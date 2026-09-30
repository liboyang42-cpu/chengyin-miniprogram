// 旧提现入口保留给历史路由；2026-09-15 起不再进银行卡表单，改弹平台客服微信线下处理。
const merchantTheme = require('../../../utils/merchant-theme.js');
const withdrawCs = require('../../../utils/withdraw-cs.js');

Page({
  data: {
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
  },

  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  goBankWithdraw() { withdrawCs.showWithdrawCsPopup(); },
  goBack() { wx.navigateBack({ delta: 1 }); },
});
