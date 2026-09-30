const app = getApp();

// 旧 workbench 只服务外部直达/历史深链；站内管理体已合并到俱乐部详情第四个 tab。
Page({
  data: {
    statusBarHeight: (app.globalData || {}).statusBarHeight || 44,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    state: 'loading',
    target: '',
    errorText: '',
  },
  onLoad(options) {
    const clubId = options && (options.id || options.clubId);
    const target = clubId
      ? '/pages/club/detail/index?id=' + encodeURIComponent(clubId) + '&tab=manage'
      : '/pages/club/detail/index?owner=1&tab=manage';
    this.data.target = target;
    this.retryRedirect();
  },
  retryRedirect() {
    const target = this.data.target;
    if (!target) return;
    const that = this;
    this.setData({ state: 'loading', errorText: '' });
    wx.redirectTo({
      url: target,
      fail() {
        that.setData({
          state: 'error',
          errorText: '暂时无法进入俱乐部管理，请重试或返回俱乐部。',
        });
      },
    });
  },
  onBack() {
    wx.navigateBack({
      delta: 1,
      fail() { wx.switchTab({ url: '/pages/talent/list/index' }); },
    });
  },
});
