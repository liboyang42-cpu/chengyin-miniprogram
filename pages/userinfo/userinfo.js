Page({
  data: {
    userId: '',
    // canonical 深链:tab=about 指定落地 tab。
    initialTab: '',
    missingUser: false,
    topicId: '',
    topicName: '',
    operationScope: '',
    previewSelf: false
  },

  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),

  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。

  showPrivacyGate() {

    this.setData({ privacyGateShow: true });

  },

  onPrivacyGateSettled() {

    this.setData({ privacyGateShow: false });

  },


  onLoad: function (options) {
    options = options || {};
    var userId = String(options.userId || options.id || '').trim();
    this.setData({
      userId: userId,
      initialTab: String(options.tab || ''),
      missingUser: !userId,
      topicId: String(options.topicId || ''),
      topicName: options.topicName ? decodeURIComponent(options.topicName) : '',
      operationScope: options.scope === 'MERCHANT' ? 'MERCHANT' : '',
      previewSelf: options.preview === '1'
    });
  },

  onBack: function () {
    wx.navigateBack({
      fail: function () { wx.switchTab({ url: '/pages/member/index/index' }); }
    });
  },

  goMemberHome: function () {
    wx.switchTab({ url: '/pages/member/index/index' });
  },

  onShareAppMessage: function (res) {
    var profile = this.selectComponent('#profile');
    return profile ? profile.getSharePayload(res || {}) : {
      title: '城瘾 · 城市探索',
      path: this.data.userId
        ? '/pages/userinfo/userinfo?userId=' + this.data.userId
        : '/pages/member/index/index'
    };
  }
});
