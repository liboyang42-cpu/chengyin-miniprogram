const toast = require('../../../utils/toast.js');
const app = getApp();

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    team: null,
    joined: false,
    loading: true,
    refreshing: false,
    joining: false,
    joinError: '',
    error: '',
    errorKind: 'network',
    errorSub: '',
    errorAction: '重新加载'
  },

  onLoad(options) {
    this.inviteCode = String(options.code || '');
    this.legacyTeamId = String(options.teamId || '');
    this.load();
  },

  load() {
    const that = this;
    if (!this.inviteCode) {
      this.setData({
        loading: false,
        refreshing: false,
        error: this.legacyTeamId ? '邀请链接已升级' : '邀请链接不完整',
        errorKind: 'missing-param',
        errorSub: this.legacyTeamId ? '请让队长重新分享新的邀请链接' : '请从队长分享的邀请重新进入',
        errorAction: '返回上一页'
      });
      return;
    }
    if (this._inviteLoading) return;
    this._inviteLoading = true;
    const hasTeam = !!this.data.team;
    this.setData({
      loading: !hasTeam,
      refreshing: hasTeam,
      error: '',
      errorSub: '',
      errorAction: '重新加载'
    });
    app.sendRequest({
      url: '/api/team/info', method: 'POST', hideLoading: true, autoErrorToast: hasTeam,
      data: JSON.stringify({ inviteCode: this.inviteCode }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        that._inviteLoading = false;
        if (res.code == '200' && res.data && res.data.team) {
          that.teamId = String(res.data.team.id);
          that.setData({
            loading: false,
            refreshing: false,
            team: res.data.team,
            joined: !!res.data.joined,
            error: '',
            errorSub: ''
          });
        } else that.setData({
          loading: false,
          refreshing: false,
          error: hasTeam ? '邀请状态暂未更新' : '邀请暂时不可用',
          errorKind: 'data',
          errorSub: app.getRequestErrorMessage(res, hasTeam ? '已保留上次确认的邀请信息' : '请让队长重新分享后再试'),
          errorAction: '重新加载'
        });
      },
      fail() {
        that._inviteLoading = false;
        that.setData({
          loading: false,
          refreshing: false,
          error: hasTeam ? '邀请状态暂未更新' : '网络没连上',
          errorKind: 'network',
          errorSub: hasTeam ? '已保留上次确认的邀请信息' : '检查网络连接后重试',
          errorAction: '重新加载'
        });
      }
    });
  },

  onErrorAction() {
    if (this.data.errorKind === 'missing-param') {
      wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/talent/list/index' }); } });
      return;
    }
    this.load();
  },

  join() {
    if (this.data.joining) return;
    const that = this;
    this.setData({ joining: true, joinError: '' });
    app.sendRequest({
      url: '/api/team/join', method: 'POST',
      data: JSON.stringify({ inviteCode: this.inviteCode }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        that.setData({ joining: false });
        if (res.code == '200') {
          that.setData({ joined: true, joinError: '' });
          toast('已加入队伍');
          setTimeout(function () { that.goDetail(); }, 500);
        } else that.setData({ joinError: res.msg || '邀请状态可能已变化，请重试' });
      },
      fail() { that.setData({ joining: false, joinError: '网络没连上，请检查后重试' }); }
    });
  },

  goDetail() {
    const pages = getCurrentPages();
    const previous = pages.length > 1 ? pages[pages.length - 2] : null;
    if (previous && previous.route === 'pages/team/detail/index') {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.redirectTo({ url: '/pages/team/detail/index?teamId=' + this.teamId });
  }
});
