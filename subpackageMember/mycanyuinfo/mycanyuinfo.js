// 深链兼容壳。详情与取消报名逻辑在 subpackageMember/components/scene-member-participation-detail。
const app = getApp();
const merchantTheme = require('../../utils/merchant-theme.js');

Page({
  data: {
    // 自定义导航:壳自留同高占位,内容不被 fixed 顶栏压住
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    id: '',
  },
  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index) 把本页盖住。
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  onLoad(options) { this.setData({ id: (options && options.id) || '' }); },
  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },
  noop() {},
  // 组件在弹窗里发 back/close 是「回上一层」;壳里没有场景栈,退回页面导航。
  backToList() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.redirectTo({ url: '/subpackageMember/mycanyu/mycanyu' });
  },
});
