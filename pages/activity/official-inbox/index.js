const modal = require('../../../utils/modal.js');
const { chinaParts } = require('../../../utils/datetime.js');
const toast = require('../../../utils/toast.js');
const app = getApp();
const policy = require('../../../utils/identity/identity-policy.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const TARGET_LABEL = { NODE: '指定站点职责', ROUTE: '指定路线职责', CHAPTER: '指定章节职责' };

const STATUS = { INVITED: '待你确认', ACCEPTED: '已接受', ACTIVE: '履约中' };
const ROLE = {
  ORGANIZER: '主办方', CO_ORGANIZER: '协办方', FULFILLMENT_MERCHANT: '商家履约',
  FULFILLMENT_CLUB: '俱乐部履约', SPONSOR: '支持方', PROMOTION_PARTNER: '推广伙伴'
};

Page({
  data: {
    loading: true,
    refreshing: false,
    error: '',
    invites: [],
    actionBusyPartyKey: '',
    actionBusyAction: '',
    actionErrorPartyKey: '',
    actionErrorKind: 'data',
    actionError: '',
    failedAction: null,
    isMerchantViewer: false,
  },

  onLoad() { this._unloaded = false; this.syncViewerTheme(); this.fetch(); },
  onShow() { this.syncViewerTheme(); if (this._loaded) this.fetch(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    merchantTheme.merchantPageRestore();
    this._unloaded = true;
    this._fetchSeq = (this._fetchSeq || 0) + 1;
  },

  syncViewerTheme() {
    const isMerchantViewer = policy.isMerchantView({
      role: app.getUserRole(),
      userType: app.getUserType(),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    this.setData({ isMerchantViewer });
    if (isMerchantViewer) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
  },

  onPullDownRefresh() { this.fetch(); },

  fetch() {
    const requestId = (this._fetchSeq || 0) + 1;
    this._fetchSeq = requestId;
    const hasSnapshot = !!this._loaded || !!(this.data.invites && this.data.invites.length);
    if (hasSnapshot) this.setData({ loading: false, refreshing: true });
    else this.setData({ loading: true, refreshing: false, error: '' });
    const isCurrent = () => !this._unloaded && requestId === this._fetchSeq;
    app.sendRequest({
      // 下拉刷新的收圈绑在真实完成上;非下拉场景下 stopPullDownRefresh 是 no-op
      complete() { wx.stopPullDownRefresh(); },
      url: '/api/official/v2/party-inbox', method: 'GET', hideLoading: true, silentError: true,
      success: (res) => {
        if (!isCurrent()) return;
        if (res && (res.code == 200 || res.code == '200') && Array.isArray(res.data)
            && res.data.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
          const invites = res.data.map((item) => {
            const role = ROLE[item.role] || item.role || '职责待确认';
            return Object.assign({}, item, {
              _partyKey: String(item.partyId == null ? '' : item.partyId),
              _status: STATUS[item.status] || item.status || '状态待确认',
              _role: role,
              _window: this.timeRange(item.windowStart, item.windowEnd),
              _display: {
                eventTitle: item.eventTitle || '未命名官方活动',
                // CU-C-14:city=NULL 是全国活动(详情页写「全国」),不是「未设城市」;
                // 内部 targetType/targetId(EVENT #99002302)不给用户看。
                cityRole: (item.city || '全国') + ' · ' + role,
                scope: !item.targetType || item.targetType === 'EVENT'
                  ? '本场整体职责'
                  : (TARGET_LABEL[item.targetType] || '指定范围职责')
              }
            });
          });
          this._loaded = true;
          this.setData({ invites, error: '', loading: false, refreshing: false });
        } else setInboxFetchFailure(this, res, hasSnapshot, requestId);
      },
      fail: (res) => setInboxFetchFailure(this, res, hasSnapshot, requestId),
    });
  },

  _submitAction(context) {
    const { partyId, action, organizerInvite, isAccept } = context;
    const reason = isAccept ? '' : (action === 'decline' ? '主体拒绝本场邀约' : '主体退出本场职责');
    const url = organizerInvite
      ? '/api/official/v2/organizer-invites/' + partyId + '/' + (action === 'accept' ? 'accept' : 'decline')
      : '/api/official/v2/parties/' + partyId + '/' + action.toUpperCase();
    // URL 只来自上面的两组已登记官方动作端点；partyId 来自当前服务端邀约行，
    // action 也已在 act 入口收敛为 accept / decline / withdraw，不能由外部拼任意路径。
    // 保留两个路由字面量，供 API 存在性门禁逐条核对后端 Mapping。

    app.sendRequest({
      method: 'POST',
      data: { reason },
      header: { 'content-type': 'application/json' },
      url,
      hideLoading: true, silentError: true,
      success: (res) => {
        if (res && (res.code == 200 || res.code == '200')) {
          this._clearActionBusy(true);
          toast.success(isAccept ? '已接受' : '已更新');
          this.fetch();
        } else this._setActionFailure(context, app.getRequestErrorMessage(res, '操作未完成'), 'data');
      },
      fail: () => this._setActionFailure(context, '网络异常，请重试', 'network'),
    });
  },

  // CU-C-14:后端下发 ISO「2026-09-22T09:00:00」,旧写法 Number(ISO)=NaN 后原样回显整串、窄卡硬折行。
  timeRange(start, end) {
    if (!start && !end) return '未限定服务时段';
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    const f = (value) => {
      if (!value) return '不限';
      const p = chinaParts(/^\d+$/.test(String(value)) ? Number(value) : value);
      return p ? p.month + '月' + p.day + '日 ' + pad(p.hours) + ':' + pad(p.minutes) : '时间待确认';
    };
    return f(start) + ' — ' + f(end);
  },

  act(e) {
    const partyId = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    if (!partyId || !['accept', 'decline', 'withdraw'].includes(action) || this._actionBusy || this.data.refreshing) return;
    const invite = (this.data.invites || []).find(item => String(item.partyId) === String(partyId));
    if (!invite) return;
    const organizerInvite = invite && invite.partyType === 'OFFICIAL' && invite.role === 'ORGANIZER';
    if (organizerInvite && action === 'withdraw') {
      toast('主办需先完成转交才能退出');
      return;
    }
    const isAccept = action === 'accept';
    const context = { partyId, action, organizerInvite, isAccept };
    this._actionBusy = true;
    this.data.failedAction = null;
    this.setData({
      actionBusyPartyKey: String(partyId),
      actionBusyAction: action,
      actionErrorPartyKey: '',
      actionError: '',
    });
    modal.show({
      title: isAccept ? (organizerInvite ? '接受主办邀约' : '接受本场职责') : (action === 'decline' ? '拒绝本场邀约' : '退出本场职责'),
      content: organizerInvite
        ? (isAccept ? '接受后会成为本场唯一主办，或成为已接受的候任主办等待受控转交。' : '拒绝会保留在活动审计中。')
        : (isAccept ? '接受后会计入活动履约覆盖。' : '该决定会留在活动审计中，并重新计算履约缺口。'),
      confirmText: isAccept ? '确认接受' : '确认',
      success: (result) => {
        if (!result.confirm) {
          this._clearActionBusy();
          return;
        }
        this._submitAction(context);
      },
      fail: () => this._setActionFailure(context, '未能打开确认窗口，请重试', 'data'),
    });
  },

  retryAction() {
    const context = this.data.failedAction;
    if (!context || this._actionBusy) return;
    const invite = (this.data.invites || []).find(item => String(item.partyId) === String(context.partyId));
    if (!invite) {
      this.data.failedAction = null;
      this.setData({ actionErrorPartyKey: '', actionError: '' });
      return;
    }
    this._actionBusy = true;
    this.setData({
      actionBusyPartyKey: String(context.partyId),
      actionBusyAction: context.action,
      actionErrorPartyKey: '',
      actionError: '',
    });
    this._submitAction(context);
  },

  _clearActionBusy(clearFailed) {
    this._actionBusy = false;
    if (clearFailed) {
      this.data.failedAction = null;
      this.setData({
        actionBusyPartyKey: '', actionBusyAction: '',
        actionErrorPartyKey: '', actionError: '',
      });
    } else this.setData({ actionBusyPartyKey: '', actionBusyAction: '' });
  },

  _setActionFailure(context, message, kind) {
    this._actionBusy = false;
    this.data.failedAction = context;
    this.setData({
      actionBusyPartyKey: '',
      actionBusyAction: '',
      actionErrorPartyKey: String(context.partyId),
      actionErrorKind: kind || 'data',
      actionError: message,
    });
  },
});

function setInboxFetchFailure(page, res, hasSnapshot, requestId) {
  if (page._unloaded || requestId !== page._fetchSeq) return;
  const message = app.getRequestErrorMessage(res, '邀约加载失败');
  if (hasSnapshot) page.setData({ loading: false, refreshing: false });
  else page.setData({ loading: false, refreshing: false, error: message });
}
