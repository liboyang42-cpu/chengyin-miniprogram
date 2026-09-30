const toast = require('../../../utils/toast.js');
const app = getApp();
// 视角身份复用 identity-policy(与 pages/shezhi/shezhi.js 同源),不自造判断
const policy = require('../../../utils/identity/identity-policy.js');
const merchantTheme = require('../../../utils/merchant-theme.js');

function getRuntimeVersion() {
  try {
    const accountInfo = wx.getAccountInfoSync();
    return (accountInfo && accountInfo.miniProgram && accountInfo.miniProgram.version) || '开发版本';
  } catch (error) {
    return '开发版本';
  }
}

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight || 20,
    navBarHeight: app.globalData.navBarHeight || 44,
    version: '',
    showAgreementSheet: false,
    // 关于页是共享页(商家也从设置进来),主题必须显式两分
    isMerchantView: false,
  },

  onLoad() {
    this.setData({ version: getRuntimeVersion() });
    this.syncViewTheme();
  },

  onShow() { this.syncViewTheme(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  syncViewTheme() {
    const isMerchantView = policy.isMerchantView({
      role: wx.getStorageSync('role'),
      userType: wx.getStorageSync('user_type'),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    this.setData({ isMerchantView });
    if (isMerchantView) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
  },

  onBack() {
    wx.navigateBack({
      fail() { wx.redirectTo({ url: '/pages/shezhi/shezhi' }); },
    });
  },

  explainQrPending() {
    toast('身份码开通后会自动出现');
  },

  openAgreement() {
    this.setData({ showAgreementSheet: true });
  },

  closeAgreement() {
    this.setData({ showAgreementSheet: false });
  },

});
