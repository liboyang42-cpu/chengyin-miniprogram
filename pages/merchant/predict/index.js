// 竞猜待答(商家侧)。玩家押一个,答案由商家事后给 —— 这一屏就是「给答案」的地方。
//
// 三条不能省的:
//   · **有期限**。超过 48 小时不给,那一轮由平台作废、谁都拿不到奖。所以每张卡都写「还剩几天」,
//     到了最后一天要红 —— 这不是装饰,是这一屏存在的理由。
//   · **只能结一次**,而且会按商家配的规则发券。所以要二次确认,并且把后果写在弹窗里。
//   · **服务端说了算**。结算成功与否只认接口回执,不拿本地状态冒充成功。

const app = getApp();
const cyToast = require('../../../utils/toast.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const { inactiveAccess, normalizeMerchantAccess } = require('../../../utils/merchant-access-policy.js');

const successObject = (res) => res && (res.code === 200 || res.code === '200');
const errorText = (res, fallback) => (res && res.msg) || fallback;

/** 一行待办 → 卡片要显示的文案。纯函数,供单测 */
function shapeRound(row) {
  const options = (row && row.options) || [];
  const days = Number((row && row.daysLeft) || 0);
  return {
    rid: String((row && row.nodeId) || '') + ':' + String((row && row.playDay) || ''),
    nodeId: (row && row.nodeId) || 0,
    playDay: (row && row.playDay) || '',
    nodeName: (row && row.nodeName) || '未命名点位',
    question: (row && row.question) || '',
    options: options,
    betCount: Number((row && row.betCount) || 0),
    betText: Number((row && row.betCount) || 0) > 0
      ? (row.betCount + ' 个人押了这一轮')
      : '这一轮还没有人押',
    optionText: options.length + ' 个选项',
    daysLeft: days,
    // 0 天不是「还剩 0 天」,是「今天不给就没了」—— 后者才让人现在就动手
    deadlineText: days > 0 ? ('还剩 ' + days + ' 天') : '今天不给就作废',
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    pageState: 'loading',
    errorMessage: '',
    items: [],
    openId: '',          // 展开选答案的那一行
    pickedKey: '',
    submitting: false,
    confirm: { show: false, rid: '', key: '', label: '', content: '' },
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._access = inactiveAccess();
    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      navBarHeight: (app.globalData && app.globalData.navBarHeight) || 44,
    });
    this.loadAccess();
  },
  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  onNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/merchant/index/index' });
  },

  _shapeRound: shapeRound,      // 纯算法出口,供单测

  loadAccess() {
    this.setData({ pageState: 'loading', errorMessage: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      success: (res) => {
        if (!successObject(res)) {
          this.setData({ pageState: 'error', errorMessage: errorText(res, '经营身份加载失败') });
          return;
        }
        const access = normalizeMerchantAccess(res.data);
        this._access = access;
        // 结算会发券,后端要的是项目管理权限 —— 前端这一闸只是别让人白跑一趟
        if (!access.active || !access.canManageProjects) {
          this.setData({ pageState: 'no-permission', items: [] });
          return;
        }
        this.loadInbox();
      },
      fail: () => this.setData({ pageState: 'error', errorMessage: '网络连接失败，请稍后重试' }),
    });
  },

  retry() {
    if (this._access && this._access.canManageProjects) this.loadInbox();
    else this.loadAccess();
  },

  loadInbox() {
    this.setData({ pageState: 'loading', errorMessage: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/predict/inbox',
      method: 'POST',
      success: (res) => {
        if (!successObject(res)) {
          this.setData({ pageState: 'error', errorMessage: errorText(res, '待答列表加载失败') });
          return;
        }
        const items = (res.data || []).map(shapeRound);
        this.setData({
          items: items,
          openId: '', pickedKey: '',
          pageState: items.length ? 'ready' : 'empty',
        });
      },
      fail: () => this.setData({ pageState: 'error', errorMessage: '网络连接失败，请稍后重试' }),
    });
  },

  onOpenRound(e) {
    const rid = e.currentTarget.dataset.rid;
    this.setData({ openId: rid, pickedKey: '' });
  },
  onCancelPick() { this.setData({ openId: '', pickedKey: '' }); },
  onPickOption(e) {
    this.setData({ pickedKey: e.currentTarget.dataset.key || '' });
  },

  onAskConfirm(e) {
    if (!this.data.pickedKey) return;
    const rid = e.currentTarget.dataset.rid;
    const row = this.data.items.filter((x) => x.rid === rid)[0];
    if (!row) return;
    const picked = (row.options || []).filter((o) => o.key === this.data.pickedKey)[0] || {};
    this.setData({
      confirm: {
        show: true, rid: rid, key: this.data.pickedKey, label: picked.label || '',
        /* 把后果写全:结算是一次性的,而且会按规则发券 —— 这两件事
           点下去之后都撤不回来,不能等玩家来问才发现。 */
        content: '押中的人会按你配的规则拿到奖励。这一轮只能公布一次,公布后不能改。',
      },
    });
  },
  onCancelConfirm() {
    if (this.data.submitting) return;
    this.setData({ 'confirm.show': false });
  },

  onConfirmSettle() {
    if (this.data.submitting) return;
    const confirm = this.data.confirm;
    const row = this.data.items.filter((x) => x.rid === confirm.rid)[0];
    if (!row) { this.setData({ 'confirm.show': false }); return; }
    this.setData({ submitting: true });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/predict/settle',
      method: 'POST',
      data: { nodeId: String(row.nodeId), playDay: row.playDay, settledOption: confirm.key },
      success: (res) => {
        this.setData({ submitting: false, 'confirm.show': false });
        if (!successObject(res)) {
          // 失败要说人话并且留在原地 —— 这一轮还没结,人得能再试
          cyToast(errorText(res, '结算失败，请重试'));
          return;
        }
        const summary = res.data || {};
        const winners = Number(summary.winners || 0);
        cyToast(winners > 0 ? ('已公布 · ' + winners + ' 人猜中') : '已公布 · 无人猜中');
        // 结完从列表里拿掉这一行,不重新拉整页 —— 别让人刚点完又看见它还在
        const left = this.data.items.filter((x) => x.rid !== confirm.rid);
        this.setData({
          items: left, openId: '', pickedKey: '',
          pageState: left.length ? 'ready' : 'empty',
        });
      },
      fail: () => {
        this.setData({ submitting: false, 'confirm.show': false });
        cyToast('网络连接失败，请稍后重试');
      },
    });
  },
});
