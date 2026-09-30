const app = getApp();
const { decideMerchantGate, decideClubGate } = require('../../../utils/access-gate.js');

// 页面级守卫:放一个标签进页面,读 access/me,没权限就整屏盖住,弹零按钮 fail 半屏讲原因,2s 自动出去。
// 页面自己的请求照常发(后端本来就拦),这里只负责别让用户对着一屏 toast 干瞪眼。
Component({
  properties: {
    kind: { type: String, value: 'merchant' },   // merchant | club
    need: { type: String, value: '' },           // merchant: canXxx 字段名;club: club:xxx 权限串
    clubId: { type: null, value: '' },
    activityId: { type: null, value: '' },
  },
  data: { state: 'checking', reason: '', top: 0, _sheet: false },
  observers: {
    'clubId, activityId'() { if (this.data.kind === 'club') this.check(); },
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      this._page = pages[pages.length - 1];
      const g = app.globalData || {};
      this.setData({ top: (g.statusBarHeight || 0) + (g.navBarHeight || 0) });
      if (this.data.kind === 'merchant') this.check();
    },
  },
  methods: {
    check() {
      const kind = this.data.kind;
      if (kind === 'club' && !this.data.clubId && !this.data.activityId) return;   // 还没拿到范围,等 observer
      const epoch = (this._epoch || 0) + 1;
      this._epoch = epoch;
      const that = this;
      const settle = (decision) => {
        if (epoch !== that._epoch) return;
        const denied = decision.state === 'deny';
        // 面板先随盖层渲染出来,再把 show 翻成 true —— 不赌初值能不能触发 result-sheet 的 2s 计时
        that.setData({
          state: denied ? 'deny' : (decision.state === 'allow' ? 'allow' : 'unknown'),
          reason: denied ? decision.reason : '',
          _sheet: false,
        }, () => { if (denied) that.setData({ _sheet: true }); });
      };
      // 两条分支各自写死 /api 字面量:UI-GATE-0 的 U1 要能枚举出请求路径,变量拼的核不了。
      // 不传 silentError:request-client 的静默分支都是「没挂 fail 才弹」,本组件 fail 与
      // successStatusAbnormal 都挂了;autoErrorToast:false 关掉业务失败自动 toast,
      // 可见反馈由本组件的 deny 屏承担(unknown 时刻意不拦,后端仍然拦)。
      const onMerchant = (res) => settle(decideMerchantGate(res, that.data.need));
      const onClub = (res) => settle(decideClubGate(res, that.data.clubId, that.data.need));
      // request-client 静默重登失败时以 fail(data, 401) 交回;那不是「响应坏了」,是真的没身份,
      // 必须拦并给去处(审核清单 §6.6「401 后给去处」)。其余失败仍判 unknown,不误锁人。
      const onFail = (data, statusCode) => settle(Number(statusCode) === 401
        ? { state: 'deny', reason: '登录已过期，请重新进入' }
        : { state: 'unknown' });
      if (kind === 'club') {
        app.sendRequest({
          url: '/api/club/access/me',
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: JSON.stringify({ clubId: this.data.clubId || undefined, activityId: this.data.activityId || undefined }),
          hideLoading: true,
          autoErrorToast: false,
          success: onClub,
          successStatusAbnormal: onClub,
          fail: onFail,
        });
        return;
      }
      app.sendRequest({
        url: '/api/merchant/access/me',
        method: 'POST',
        hideLoading: true,
        autoErrorToast: false,
        success: onMerchant,
        successStatusAbnormal: onMerchant,
        fail: onFail,
      });
    },
    onExit() {
      // 到点收起与点遮罩可能先后到;同页 cy-error auto-back 也可能同时在弹 —— 按页只走一次
      const page = this._page || {};
      if (page.__cyAutoBacked) return;
      page.__cyAutoBacked = true;
      const pages = getCurrentPages();
      if (pages.length > 1) { wx.navigateBack(); return; }
      wx.reLaunch({ url: this.data.kind === 'club' ? '/pages/index/index' : '/pages/merchant/index/index' });
    },
  },
});
