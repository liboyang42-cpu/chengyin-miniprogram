// 历史记录深链统一落到银行卡提现记录，避免继续读取已停用的钱包记录接口。
// 跳转壳仍要有完整过场与失败恢复：redirectTo 失败时不能把用户留在空白页。
const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');

// 本壳只从商家侧进入:带 theme=merchant,目标页保持商家白底,不落回玩家黑底(2026-09-16 SMOKE/095)。
const RECORDS_URL = '/subpackageMember/tixianjilu/tixianjilu?theme=merchant';

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    state: 'redirecting',
    message: '',
  },

  onLoad() { this.redirectRecords(); },
  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._redirectEpoch = (this._redirectEpoch || 0) + 1;
    this._redirecting = false;
    merchantTheme.merchantPageRestore();
  },

  retryRedirect() { this.redirectRecords(); },

  redirectRecords() {
    // 锁必须在 setData / redirectTo 之前同步落下，连续点击才能真正 single-flight。
    if (this._redirecting) return;
    this._redirecting = true;
    const epoch = (this._redirectEpoch || 0) + 1;
    this._redirectEpoch = epoch;
    this.setData({ state: 'redirecting', message: '' });

    wx.redirectTo({
      url: RECORDS_URL,
      success: () => {
        if (epoch !== this._redirectEpoch) return;
        this._redirecting = false;
      },
      fail: () => {
        if (epoch !== this._redirectEpoch) return;
        this._redirecting = false;
        this.setData({
          state: 'error',
          message: '提现记录页面打开失败，请重试',
        });
      },
    });
  },
});
