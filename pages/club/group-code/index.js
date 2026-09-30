// 团核销码:主理人/管理员出示给合作商家扫码。码过期后自动换新，权限与团归属只由服务端判定。
const app = getApp();
const { buildGroupCodeIssuePayload, listGroupCodeActivities } = require('../../../utils/group-code-session.js');
const { bizFailureMessage } = require('../../../utils/response-shape.js');

// E-12(2026-09-16):无权限是终态。原来 403/「没有权限」落进通用「出码失败」,只有重试,
// 重试永远失败且没有出路 —— 单列一态,把「进入俱乐部管理」给它。
// 后端 issue 拒绝文案是「您没有该场次的团码核销权限」(GroupCodeServiceImpl),
// 与前端既有 pages/coop/invite 的权限判据同口径。
function isPermissionDenial(res) {
  const code = Number(res && (res.code != null ? res.code : res.statusCode));
  const msg = String((res && (res.msg || res.message)) || '');
  return code === 403 || /权限|无权/.test(msg);
}

Page({
  data: {
    privacyGateShow: false,
    statusBarHeight: app.globalData.statusBarHeight || 20,
    navBarHeight: app.globalData.navBarHeight || 44,
    topicId: null,
    activityId: null,
    title: '本团',
    activityOptions: [],
    qrcodeUrl: '',
    state: 'loading', // loading | ready | error | selecting | empty | invalid | no-permission
    errMsg: '',
  },

  // 隐私授权闸:app.js 优先调这里(真弹窗),没有这个方法的页面才回退到
  // /pages/privacy 路由页 —— 那会把出码界面整个盖住。
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  onLoad(options) {
    const activityId = options && options.activityId;
    const topicId = options && options.topicId;
    if (!activityId && !topicId) {
      this.nextRequestEpoch();
      this.clearTimer();
      this.setData({ state: 'invalid', errMsg: '缺少路线或场次信息' });
      return;
    }
    this.setData({
      topicId,
      activityId,
      title: options.activityName ? decodeURIComponent(options.activityName)
        : (options.topicName ? decodeURIComponent(options.topicName) : '本团'),
    });
    if (buildGroupCodeIssuePayload(activityId)) {
      this.issue();
      return;
    }
    this.selectActivity();
  },

  onUnload() {
    this.nextRequestEpoch();
    this.clearTimer();
  },

  onHide() {
    // 到点补码的定时器不许在后台空转烧码:离页即停,回来交给 onShow 重出。
    this.clearTimer();
  },

  onShow() {
    // 团码有 TTL:切走时留在屏上的可能已过期,回来要出示的不能是旧码 —— 直接重出一张。
    if (this.data.state === 'ready' && this.data.activityId) this.issue();
  },

  nextRequestEpoch() {
    this._requestEpoch = (this._requestEpoch || 0) + 1;
    return this._requestEpoch;
  },

  clearTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  },

  issue() {
    const that = this;
    const epoch = this.nextRequestEpoch();
    const payload = buildGroupCodeIssuePayload(this.data.activityId);
    if (!payload) {
      this.setData({ state: 'error', errMsg: '请选择具体场次' });
      return;
    }
    this.clearTimer();
    this._countdown = 0;
    this.setData({ state: 'loading', errMsg: '', qrcodeUrl: '' });
    app.sendRequest({
      url: '/api/verify/groupcode/issue',
      method: 'POST',
      data: payload,
      hideLoading: true,
      success(res) {
        if (epoch !== that._requestEpoch) return;
        const data = res && res.data;
        if (res && (res.code === '200' || res.code === 200) && data && data.code) {
          // CU-C-78:没有码图的团码不能当成功 —— 码是一长串签名令牌,现场只能靠扫图,
          // 原来只看 data.code 就置 ready,码区于是只剩一句「出码失败」,页面却以为已出码。
          if (!data.qrcodeUrl) {
            that.setData({ qrcodeUrl: '', state: 'error', errMsg: '团码二维码生成失败，请稍后重试' });
            return;
          }
          that.setData({ qrcodeUrl: data.qrcodeUrl, state: 'ready' });
          that.startCountdown(Math.floor((data.ttlMs || 300000) / 1000));
          return;
        }
        if (isPermissionDenial(res)) {
          that.setData({ state: 'no-permission', errMsg: (res && res.msg) || '当前账号没有出码权限' });
          return;
        }
        that.setData({ state: 'error', errMsg: (res && res.msg) || '出码失败' });
      },
      fail() {
        if (epoch !== that._requestEpoch) return;
        that.setData({ state: 'error', errMsg: '网络异常，请重试' });
      },
      successStatusAbnormal(res) {
        if (epoch !== that._requestEpoch) return;
        if (isPermissionDenial(res)) {
          that.setData({ state: 'no-permission', errMsg: (res && res.msg) || '当前账号没有出码权限' });
          return;
        }
        that.setData({ state: 'error', errMsg: (res && res.msg) || '出码失败' });
      },
    });
  },

  selectActivity() {
    const that = this;
    const epoch = this.nextRequestEpoch();
    if (!this.data.topicId) {
      this.clearTimer();
      this.setData({ state: 'invalid', errMsg: '缺少路线或场次信息' });
      return;
    }
    this.clearTimer();
    this._countdown = 0;
    this.setData({ state: 'loading', errMsg: '', activityOptions: [], qrcodeUrl: '' });
    app.sendRequest({
      url: '/api/topic/info-to-user',
      method: 'POST',
      data: { id: this.data.topicId },
      hideLoading: true,
      success(res) {
        if (epoch !== that._requestEpoch) return;
        const ok = res && (res.code === '200' || res.code === 200);
        const raw = res && res.data && res.data.activityList;
        if (!ok || !Array.isArray(raw)) {
          that.setData({ state: 'error', activityOptions: [], errMsg: bizFailureMessage(res, '场次加载失败') });
          return;
        }
        if (raw.length === 0) {
          that.setData({ state: 'empty', activityOptions: [], errMsg: '' });
          return;
        }
        const activities = listGroupCodeActivities(raw);
        if (!activities.length) {
          that.setData({ state: 'error', errMsg: bizFailureMessage(res, '暂无可出示团码的场次') });
          return;
        }
        if (activities.length === 1) {
          that.setData({ activityId: activities[0].id, title: activities[0].name }, () => {
            if (epoch === that._requestEpoch) that.issue();
          });
          return;
        }
        that.setData({ state: 'selecting', activityOptions: activities });
      },
      fail() {
        if (epoch !== that._requestEpoch) return;
        that.setData({ state: 'error', errMsg: '网络异常，请重试' });
      },
      successStatusAbnormal(res) {
        if (epoch !== that._requestEpoch) return;
        that.setData({ state: 'error', errMsg: (res && res.msg) || '场次加载失败' });
      },
    });
  },

  onSelectActivity(e) {
    const activityId = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name || '本团';
    if (!buildGroupCodeIssuePayload(activityId)) return;
    this.setData({ activityId, title: name }, () => this.issue());
  },

  // 倒计时只用来「到期自动重出码」,不上屏 —— 稿 335:1275 没画剩余时间。
  // 所以它是纯内部态:留在 data 里每秒 setData 一次,传过去没有任何东西渲染。
  startCountdown(seconds) {
    const that = this;
    this._countdown = seconds;
    this._timer = setInterval(function () {
      that._countdown -= 1;
      if (that._countdown <= 0) {
        that.issue();
      }
    }, 1000);
  },

  onRetry() {
    // invalid(缺参)/ no-permission(无权限)都是终态:重试必失败,出路是 goManage。
    if (this.data.state === 'invalid' || this.data.state === 'no-permission') return;
    if (buildGroupCodeIssuePayload(this.data.activityId)) this.issue();
    else this.selectActivity();
  },

  goManage() {
    wx.redirectTo({
      url: '/pages/club/detail/index?owner=1&tab=manage',
      fail() { wx.switchTab({ url: '/pages/talent/list/index' }); },
    });
  },

  onClose() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/talent/list/index' });
  },
});
