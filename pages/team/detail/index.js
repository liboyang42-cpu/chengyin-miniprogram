const cyToast = require('../../../utils/toast.js');
const app = getApp();

const STATUS_TEXT = ['招募中', '已满员', '进行中', '已结束', '已解散'];

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    team: null,
    members: [],
    joined: false,
    leader: false,
    // C-02b:队长切换公开招募/仅邀请的回显与提交中状态。
    joinModePublic: false,
    joinModeSaving: false,
    statusText: '',
    expireText: '',
    loading: true,
    refreshing: false,
    error: '',
    errorKind: 'network',
    errorSub: '',
    errorAction: '重新加载'
  },

  onLoad(options) {
    this.teamId = String(options.teamId || '');
    if (!this.teamId) {
      this.setData({
        loading: false,
        refreshing: false,
        error: '队伍链接不完整',
        errorKind: 'missing-param',
        errorSub: '请从活动、订单或队长分享的邀请重新进入',
        errorAction: '返回上一页'
      });
    }
  },
  onShow() { if (this.teamId) this.load(); },
  onPullDownRefresh() { this.load(true); },

  load(fromPull) {
    const that = this;
    if (!this.teamId) {
      if (fromPull) wx.stopPullDownRefresh();
      this.onLoad({});
      return;
    }
    if (this._teamLoading) return;
    this._teamLoading = true;
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
      data: JSON.stringify({ teamId: Number(this.teamId) }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        that._teamLoading = false;
        if (fromPull) wx.stopPullDownRefresh();
        if (res.code == '200' && res.data && res.data.team) {
          const team = res.data.team;
          that.setData({
            loading: false,
            refreshing: false,
            team: team,
            members: res.data.members || [],
            joined: !!res.data.joined,
            leader: !!res.data.leader,
            statusText: STATUS_TEXT[team.status] || '状态未知',
            expireText: that.formatTime(team.expireTime),
            joinModePublic: team.joinMode == 2,
            error: '',
            errorSub: ''
          });
        } else {
          that.setData({
            loading: false,
            refreshing: false,
            error: hasTeam ? '队伍状态暂未更新' : '队伍暂时不可用',
            errorKind: 'data',
            errorSub: app.getRequestErrorMessage(res, hasTeam ? '已保留上次确认的队伍信息' : '请稍后重新加载'),
            errorAction: '重新加载'
          });
        }
      },
      fail() {
        that._teamLoading = false;
        if (fromPull) wx.stopPullDownRefresh();
        that.setData({
          loading: false,
          refreshing: false,
          error: hasTeam ? '队伍状态暂未更新' : '网络没连上',
          errorKind: 'network',
          errorSub: hasTeam ? '已保留上次确认的队伍信息' : '检查网络连接后重试',
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

  // C-02b:队长改「公开招募 / 仅邀请」。后端 POST /api/team/join-mode 只认队长 +
  // joinMode∈{1,2}(没有满员/进行中的状态闸),所以 UI 只在队伍还在招募中(status=0)时
  // 给这一行:满员/已开始/已结束的队伍本就不在「附近的队伍」里,切换对任何界面都没有效果。
  // 提交失败按服务端文案回滚开关,不本地假设成功。
  onJoinModeChange(e) {
    const that = this;
    const team = this.data.team || {};
    const prevMode = team.joinMode == 2 ? 2 : 1;
    const nextMode = (e && e.detail && e.detail.value) ? 2 : 1;
    if (!this.data.leader || team.status !== 0 || this._joinModeSaving) {
      this.setData({ joinModePublic: prevMode === 2 });
      return;
    }
    if (nextMode === prevMode) return;
    this._joinModeSaving = true;
    this.setData({ joinModeSaving: true, joinModePublic: nextMode === 2 });
    app.sendRequest({
      url: '/api/team/join-mode', method: 'POST', hideLoading: true,
      data: JSON.stringify({ teamId: Number(this.teamId), joinMode: nextMode }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        that._joinModeSaving = false;
        if (res && res.code == '200' && res.data) {
          const applied = Number(res.data.joinMode) === 2 ? 2 : 1;
          that.setData({
            joinModeSaving: false,
            joinModePublic: applied === 2,
            'team.joinMode': applied,
          });
          cyToast(applied === 2 ? '已改为公开招募' : '已改为仅邀请');
          return;
        }
        that.setData({ joinModeSaving: false, joinModePublic: prevMode === 2 });
        cyToast(app.getRequestErrorMessage(res, '切换失败，请重试'));
      },
      fail() {
        that._joinModeSaving = false;
        that.setData({ joinModeSaving: false, joinModePublic: prevMode === 2 });
        cyToast('网络异常，请重试');
      }
    });
  },

  formatTime(value) {
    if (!value) return '';
    const date = new Date(String(value).replace(/-/g, '/'));
    if (isNaN(date.getTime())) return String(value);
    const pad = n => n < 10 ? '0' + n : String(n);
    return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  },

  goJoin() {
    if (!this.data.team || !this.data.team.inviteCode) {
      cyToast('邀请已失效');
      return;
    }
    wx.navigateTo({ url: '/pages/team/join/index?code=' + encodeURIComponent(this.data.team.inviteCode) });
  },

  // 三段式第一段:三个危险动作都先过确认弹窗。文案(含后果与「此操作不可撤销」)
  // 在 utils/danger-actions.js,这里只给 key。
  quit() {
    const dc = this.selectComponent && this.selectComponent('#dcQuit');
    if (dc) dc.open('team.quit', {});
  },

  kick(e) {
    const dc = this.selectComponent && this.selectComponent('#dcKick');
    if (dc) dc.open('team.kick', { name: e.currentTarget.dataset.name || '这名队员', id: Number(e.currentTarget.dataset.id) });
  },

  disband() {
    const dc = this.selectComponent && this.selectComponent('#dcDisband');
    if (dc) dc.open('team.disband', {});
  },

  // 三段式第二段:一个危险动作一个确认组件实例、一个确认回调。
  // 不做「一个 onDangerConfirm 按 key 派发」—— 那会让一个控件同时写三个接口,
  // 动作台账(scripts/uiaudit)没法把控件和它真正写的那个接口对上。
  onConfirmQuit() { this.action('/api/team/quit', { teamId: Number(this.teamId) }, '#dcQuit'); },
  onConfirmKick(e) { this.action('/api/team/kick', { teamId: Number(this.teamId), memberId: e.detail.params.id }, '#dcKick'); },
  onConfirmDisband() { this.action('/api/team/disband', { teamId: Number(this.teamId) }, '#dcDisband'); },

  /** 解散的更轻替代:改成只退出,队伍留给最早加入的队员(Revolut 185 的 Freeze 位)。 */
  onDisbandAlt() { this.quit(); },

  action(url, data, dcId) {
    const that = this;
    const dc = this.selectComponent && this.selectComponent(dcId);
    if (dc) dc.busyOn();
    app.sendRequest({
      url: url, method: 'POST', data: JSON.stringify(data),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        // 三段式第三段:结果确认卡,不再用 toast 一闪而过
        if (res.code == '200') { if (dc) dc.done(res.msg || ''); that.load(); }
        else if (dc) dc.failed(res.msg || '操作失败');
      },
      fail() { if (dc) dc.failed('网络异常，请重试'); }
    });
  },

  onShareAppMessage() {
    if (!this.data.team || !this.data.team.inviteCode) {
      return { title: '队伍邀请已失效', path: '/pages/index/index' };
    }
    return {
      title: this.data.team.title || '来和我一起组队出发',
      path: '/pages/team/join/index?code=' + encodeURIComponent(this.data.team.inviteCode)
    };
  }
});
