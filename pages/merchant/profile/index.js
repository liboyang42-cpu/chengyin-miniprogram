// 城瘾 · 旧「承接商家」页 —— 兼容壳(设计文档 §3.2)
//
// 这个页面不再承载界面:商家资料并进统一主页 components/cy/profile 的「关于」,
// 据点任务归 subpackageRoam/poi-detail。这里只剩「把历史链接送到最终落点」。
// 留着它是因为已发出的转发卡片和微信收藏改不了,不是站内长期导航方案 ——
// 站内 9 个入口已经直接生成 canonical。
//
// ★ 本页**不实现 onShareTimeline**:平台只允许朋友圈分享自定义 query、不允许自定义 path,
//   落点路径恒等于「用户当时站在哪一页」。从本壳发朋友圈 = 持续把旧路径再播出去,
//   与「旧链接收口」直接冲突。onShareAppMessage 能自定义 path,所以它输出新 canonical。
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { merchantHomeUrl } = require('../../../utils/merchant-home-link.js');

const POI_HOST = '/subpackageRoam/poi-detail/index';
const UNAVAILABLE_MSG = '商家不存在或未开放';

Page({
  data: {
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    skeletonItems: [1, 2, 3],
    // loading 正在解析 / redirecting 已发出跳转 / invalid 参数猜不出目的地 /
    // business-unavailable 商家不存在或未开放 / network-error 可重试
    // 网络失败不能显示成「商家不存在」——那是把「没查到」伪装成真实业务状态。
    state: 'loading',
    message: '',
    canBack: false,
    // 网络失败要能原样重试,所以保留进来时的 query
    id: '',
    topicId: '',
    topicName: '',
    memberId: '',
  },

  onLoad(options) {
    const opts = options || {};
    const id = opts.id || '';
    const poiId = opts.poiId || '';
    this.setData({
      id: id,
      topicId: opts.topicId || '',
      topicName: opts.topicName ? decodeURIComponent(opts.topicName) : '',
      canBack: typeof getCurrentPages === 'function' && getCurrentPages().length > 1,
    });

    // 两种主体 ID 同时出现,或一个都没有:不猜目的地。
    // 猜错会把人送到别人的主页,比停在这儿说清楚更糟。
    if (id && poiId) return this.setInvalid();
    if (poiId) return this.redirect(POI_HOST + '?poiId=' + poiId);
    if (!id) return this.setInvalid();
    this.resolveMerchant();
  },

  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  // 旧 merchantId 只用来换取 memberId;统一主页的主体 ID 只能是 memberId。
  resolveMerchant() {
    const that = this;
    this.setData({ state: 'loading', message: '' });
    app.sendRequest({
      hideLoading: true, autoErrorToast: false, url: '/api/merchant/public-home', method: 'POST',
      data: JSON.stringify({ id: that.data.id }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        const ok = res && (res.code == '200' || res.code === 200);
        const memberId = ok && res.data ? res.data.memberId : null;
        if (memberId != null && memberId !== '') {
          that.setData({ memberId: String(memberId) });
          return that.redirect(merchantHomeUrl(memberId, {
            topicId: that.data.topicId, topicName: that.data.topicName,
          }));
        }
        // 未开放 / 已删除 / 拿不到会员主体:统一给一句话,不暴露审核状态。
        // 但只有后端明确判定不可公开才算业务空态 —— 其它失败是「没查到」,
        // 归可重试的错误态,不能伪装成「这家不存在」。
        // ⚠️ 这道分流目前只能认后端的这句文案(public-home 的不可公开合同就是它)。
        //    文案一改,真实的「不存在」会退化成可重试错误 —— 等有稳定错误码后换成认码。
        if (ok || (res && res.msg === UNAVAILABLE_MSG)) {
          return that.setData({ state: 'business-unavailable', message: '' });
        }
        that.setData({
          state: 'network-error',
          message: app.getRequestErrorMessage
            ? app.getRequestErrorMessage(res, '商家资料加载失败')
            : ((res && res.msg) || '商家资料加载失败'),
        });
      },
      fail(res) {
        that.setData({
          state: 'network-error',
          message: app.getRequestErrorMessage
            ? app.getRequestErrorMessage(res, '网络异常，请稍后重试')
            : '网络异常，请稍后重试',
        });
      },
    });
  },

  // 重试要接着上次那一步走:落点已经算出来了就重发跳转(poiId 那支压根没有解析这一步),
  // 还没算出来才重新解析。否则 poiId 链接跳转失败后会被误报成「链接参数无效」。
  retryLoad() {
    if (this._pendingRedirect) this.redirect(this._pendingRedirect);
    else if (this.data.id) this.resolveMerchant();
    else this.setInvalid();
  },

  setInvalid() { this.setData({ state: 'invalid', message: '' }); },

  redirect(url) {
    this._pendingRedirect = url;
    this.setData({ state: 'redirecting' });
    const that = this;
    wx.redirectTo({
      url: url,
      // 落不了地就别停在空壳上装作成功
      fail() { that.setData({ state: 'network-error', message: '页面打开失败，请重试' }); },
    });
  },

  goHome() { wx.switchTab({ url: '/pages/index/index' }); },

  goBack() { wx.navigateBack({ delta: 1 }); },

  onBack() {
    if (this.data.canBack) this.goBack();
    else this.goHome();
  },

  // 站在旧壳上转发,也只把新 canonical 发出去,不再复制旧路径
  onShareAppMessage() {
    const url = merchantHomeUrl(this.data.memberId);
    return { title: '城瘾 · 商家主页', path: url || '/pages/index/index' };
  },
});
