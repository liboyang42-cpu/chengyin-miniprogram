const toast = require('../../utils/toast.js');
const app = getApp();

Page({
  data: {
    submitting: false,
    submitError: '',
    failedAction: '',
    pendingAuthorization: false,
    scrollInto: '',
    toc: [
      { id: 'sec-collect', title: '我们如何收集与使用信息' },
      { id: 'sec-official', title: '用户隐私保护指引' },
      { id: 'sec-roam', title: '漫游定位' },
      { id: 'sec-choice', title: '你的选择' },
    ],
  },

  onLoad() {
    this.setData({ pendingAuthorization: app.hasPendingPrivacyAuthorization() });
  },

  // ⚠️ 这是一个「伪弹窗」——它是被 navigateTo 压进来的独立页面,不是页内组件。
  // 后果:页面上那个「待决策态不给关闭叉号」的强制闸只挡得住叉号,挡不住**系统返回**
  // (左滑 / 物理返回键 / 微信胶囊返回)。系统退页时既不走 onClose 也不走同意按钮,
  // 于是 app._privacyResolvers 里的 resolve 一个都不会被调用 ⇒ 那个 Promise 永不 settle
  // ⇒ 之后所有需要隐私授权的接口静默挂起,无报错无提示。
  // 页内真弹窗没有这个出口,所以不存在这个洞;在迁成真弹窗之前,这里必须兜底。
  onUnload() {
    if (!app.hasPendingPrivacyAuthorization()) return;
    // 用户用系统返回离开了授权闸 = 没有作出同意。按「不同意」结算,让调用方拿到确定结果,
    // 而不是永远等下去。不同意不是猜测,是这个动作唯一安全的解释。
    app.resolvePrivacyAuthorization({ event: 'disagree', reason: 'page_unload' });
  },

  onTocTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ scrollInto: '' }, () => {
      this.setData({ scrollInto: id });
    });
  },

  // 撤回态弹窗右上角关闭:等价于原来 cy-nav-bar 默认返回箭头的行为,不触发任何同意/撤回记录
  onClose() {
    wx.navigateBack({
      fail() { wx.reLaunch({ url: '/pages/shezhi/shezhi' }); },
    });
  },

  openPrivacyContract() {
    wx.openPrivacyContract({
      fail() {
        toast('隐私保护指引暂不可用');
      },
    });
  },

  agreePrivacy(event) {
    if (this.data.submitting) return;
    this._lastPrivacyButtonId = event && event.detail && event.detail.buttonId;
    this.data.failedAction = '';
    this.setData({ submitting: true, submitError: '' });
    app.recordConsent({
      docType: 'privacy_policy',
      scene: 'app_launch',
      eventType: 'AGREE',
    }).then(() => {
      app.resolvePrivacyAuthorization({
        event: 'agree',
        buttonId: this._lastPrivacyButtonId,
      });
      wx.navigateBack({
        fail() { wx.switchTab({ url: '/pages/index/index' }); },
      });
    }).catch(() => {
      Object.assign(this.data, { failedAction: 'agree' });
      this.setData({
        submitting: false,
        submitError: '同意记录失败，请检查网络后重试',
      });
    });
  },

  disagreePrivacy() {
    // 防重复:按钮收编 cy-btn 后视觉 disabled 不拦点击,提交中须早退(原靠原生 <button disabled> 拦)
    if (this.data.submitting) return;
    app.resolvePrivacyAuthorization({ event: 'disagree' });
    wx.navigateBack({
      fail() { wx.switchTab({ url: '/pages/index/index' }); },
    });
  },

  withdrawRoamLocationConsent() {
    if (this.data.submitting) return;
    this.data.failedAction = '';
    this.setData({ submitting: true, submitError: '' });
    app.recordConsent({
      docType: 'privacy_policy',
      scene: 'roam_location',
      eventType: 'REVOKE',
    }).then(() => {
      try { wx.stopLocationUpdate(); } catch (e) {}
      toast('已撤回漫游定位同意');
      this.data.failedAction = '';
      this.setData({ submitting: false, submitError: '' });
    }).catch(() => {
      Object.assign(this.data, { failedAction: 'revoke' });
      this.setData({
        submitting: false,
        submitError: '撤回记录失败，请检查网络后重试',
      });
    });
  },

  retrySubmit() {
    if (this.data.submitting) return;
    if (this.data.failedAction === 'agree') {
      this.agreePrivacy({ detail: { buttonId: this._lastPrivacyButtonId } });
      return;
    }
    if (this.data.failedAction === 'revoke') this.withdrawRoamLocationConsent();
  },
});
