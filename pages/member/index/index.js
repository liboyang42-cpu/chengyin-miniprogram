const { readPageStyle } = require('../../../utils/font-scale.js');

Page({
  data: { privacyGateShow: false, fontScaleStyle: '' },
  /* Dynamic Type:放 onShow 而非 onLoad —— 用户可能切到微信设置改完字号再切回来 */
  onShow() {
    this.setData({ fontScaleStyle: readPageStyle() });
  },
  // 一级 tab 页原本一个都不能下拉刷新。本页正文全在 cy-profile 里,
  // 收圈绑 refreshAll 返回的 Promise,不用定时器猜。
  onPullDownRefresh() {
    var profile = this.selectComponent('#profile');
    if (!profile) { wx.stopPullDownRefresh(); return; }
    var done = profile.refreshAll(true);
    if (done && typeof done.then === 'function') {
      done.then(function () { wx.stopPullDownRefresh(); },
                function () { wx.stopPullDownRefresh(); });
    } else {
      wx.stopPullDownRefresh();
    }
  },
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },
  onShareAppMessage: function (res) {
    var profile = this.selectComponent('#profile');
    return profile ? profile.getSharePayload(res || {}) : {
      title: '城瘾 · 城市探索',
      path: '/pages/member/index/index'
    };
  }
});
