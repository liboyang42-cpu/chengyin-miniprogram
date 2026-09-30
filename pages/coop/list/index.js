const modal = require('../../../utils/modal.js');
const subscribe = require('../../../utils/subscribe.js');
const cyLoading = require('../../../utils/loading.js');
const toast = require('../../../utils/toast.js');
const { toTimestamp } = require('../../../utils/datetime');
const app = getApp();
const policy = require('../../../utils/identity/identity-policy.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const { createCheckoutWorkflow, hasCompletePaymentParams } = require('../../../utils/checkout/checkout-workflow.js');
const { createPaymentVerifier } = require('../../../utils/checkout/payment-verifier.js');
const { isRecordList } = require('../../../utils/response-shape.js');

// 邀约整形与文案与详情页共用一份,见 utils/coop-invite-view.js —— 两处各写一份必漂
const { TYPE_LABEL, STATUS_LABEL, decorate, parseInviteId, INVITE_ID_ERROR } = require('../../../utils/coop-invite-view.js');

function identityKey() {
  const gd = app.globalData || {};
  const memberId = typeof app.getUserID === 'function' ? app.getUserID() : gd.user_id;
  const role = typeof app.getUserRole === 'function' ? app.getUserRole() : gd.role;
  const userType = typeof app.getUserType === 'function' ? app.getUserType() : gd.user_type;
  return [memberId == null ? '' : memberId, role || '', userType == null ? '' : userType].join('|');
}
function failureKind(value) {
  const code = value && (value.code != null ? value.code : value.statusCode);
  const message = String(value && (value.msg || value.message) || '');
  if (String(code) === '401' || String(code) === '403' || /请先登录|无权|仅.+可|资格|身份|主理人/.test(message)) return 'permission';
  if (/request:fail|timeout/i.test(String(value && value.errMsg || ''))) return 'network';
  return 'server';
}
function failureText(value, fallback) {
  if (failureKind(value) === 'network') return '网络不稳定，请检查连接后重试';
  return String(value && (value.msg || value.message) || fallback);
}
function stopPullDownRefresh() {
  if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh();
}

// 俱乐部承接申请(coop_club_apply)在收发件箱里的整形,见 utils/coop-invite-view.js
const { isApplyList, decorateApplies, badgeOf, INVITE_BADGE } = require('../../../utils/coop-invite-view.js');
// 官方邀约(平台→商家):原来只在合作中心「邀约我的」tab 处理,该 tab 按稿 234:276 删除后收进「收到的」
const officialChannel = require('../../../utils/merchant-official-channel.js');
function decorateOfficial(rows) {
  return rows.filter(function (it) { return it && it.inviteId != null && it.title; }).map(function (it) {
    const d = officialChannel.decorateInvite(it);
    return Object.assign({}, d, badgeOf(INVITE_BADGE[Number(it.status)]), {
      rowKey: 'official-' + it.inviteId, statusText: d.stage,
      titleText: d.title, subText: d.deadline, termsText: d.reward,
    });
  });
}

// 报名候选(商家承接报名)的调配态 → 徽章。与候选池页同口径:0 待调配 / 1 已中标 / 2 已落选
const REG_AUDIT = [
  { text: '待调配', badge: 'pending:clock' },
  { text: '已中标', badge: 'accepted:check' },
  { text: '已落选', badge: 'muted:close-sm' },
];
function decorateReg(it) {
  const audit = it && it.auditStatus != null && Number.isInteger(Number(it.auditStatus))
    ? Number(it.auditStatus) : null;
  const st = audit != null && REG_AUDIT[audit] ? REG_AUDIT[audit] : null;
  const badge = badgeOf(st ? st.badge : 'muted:close-sm');
  return Object.assign({}, it, {
    rowKey: 'reg-' + it.id,
    audit: audit,
    auditText: st ? st.text : '状态待确认',
    badgeTone: badge.badgeTone,
    badgeIcon: badge.badgeIcon,
    name: it.merchantName || (it.memberId ? '商家 #' + it.memberId : '未具名商家'),
    logo: it.merchantLogo || '',
    meta: it.merchantMeta || '商家候选',
    placeText: it.addressName || it.address || '',
    topicTitle: it.topicName || ('主题 #' + it.topicId),
    dim: audit === 2,
  });
}

// CU-M-38:主办方对带队申请「回邀约」后,申请行永远停在 status=3「已回邀约」,对方接受了也看不出来。
// 回出去的那张邀约带 originApplyId,在「我发出的」里;按它把申请行接到邀约的真实状态与详情。
function linkRepliedApplies(applies, sentInvites) {
  const byApply = {};
  (sentInvites || []).forEach(function (inv) {
    if (inv && inv.originApplyId != null && inv.inviteId) byApply[String(inv.originApplyId)] = inv;
  });
  return (applies || []).map(function (it) {
    if (!it || it.status !== 3) return it;
    const inv = byApply[String(it.applyId)];
    if (!inv) return it;
    return Object.assign({}, it, {
      linkedInviteId: inv.inviteId,
      statusText: inv.status === 1 ? '对方已接受' : '已回邀约',
    });
  });
}

Page({
  data: {
    // 自定义导航:顶栏高度 = 状态栏 + 导航条,页面自留同高占位
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    tab: 0,            // 0 收到的 / 1 我发出的。全站合作只有这两个入口(合作池 tab 已收编)
    listTabs: [
      { key: '0', label: '收到的' },
      { key: '1', label: '我发出的' },
    ],
    tabKey: '0',       // cy-tabs(ccc 标准)驱动用的字符串 key,与 tab 保持同步
    received: [],
    sent: [],
    // 俱乐部承接申请:一条申请 = 一条记录,发布者在「收到的」、申请俱乐部在「我发出的」
    // 两路各自结算、各自报错:收到的失败只写 receivedApply*,我发出的失败只写 sentApply*
    receivedApplies: [],
    sentApplies: [],
    receivedApplyState: 'loading',
    sentApplyState: 'loading',
    receivedApplyErrorText: '',
    sentApplyErrorText: '',
    // 承接报名(商家主动报名承接我主题的节点):跨主题聚合,原候选池页的「报名候选」收编
    receivedRegs: [],
    receivedRegState: 'loading',
    receivedRegErrorText: '',
    listState: 'loading',
    officialInvites: [],
    officialErrorText: '',
    listRefreshing: false,
    listErrorKind: '',
    listErrorText: '',
    actionPendingKey: '',
    actionReceipt: '',
    actionError: '',
    // CU-C-75:从某个主题的「查看收到的申请」进来时的范围提示(空=全局协作列表)
    topicScopeText: '',
  },

  // ?tab=sent 直达「我发出的」—— 初值写入必须延到下一时间片,不能同步写。
  // onLoad/onShow 跑在框架的 FLOW_INITIAL_CREATION 创建流程里(见 tests/unit/
  // render-flow-create-setdata-timing-contract.test.js 的机理注释);这里同步 setData 会当场
  // 记进尚未收口的流程:tab 翻转 wx:if 分支=FLOW_CREATE_NODE,tabKey 改 cy-tabs 的
  // active 属性又触发它 observers('tabs, active') 同步 setData=FLOW_DATA_OBSERVER ——
  // 渲染层两条实拍报错(expect FLOW_INITIAL_CREATION end but get FLOW_CREATE_NODE /
  // expect END descriptor with depth 0 but get FLOW_DATA_OBSERVER)就是这个配方。
  // 入口是活的:club/detail 的 goCooperation / goCoopSent 都带 ?tab=sent 进来。
  // 延后不改语义:手势切 tab(onTabChange/switchToReceived)仍走同步写 —— 那时没有创建流程。
  onLoad(options) {
    // 商家员工从主办主题页/我的项目带 scope=MERCHANT 进来:确认占槽/婉拒须按 owner 口径落权。
    // 只是请求口径、wxml 零引用 ⇒ 存实例字段,不进 data(也不掺进创建期 setData)。
    this._operationScope = options && options.scope === 'MERCHANT' ? 'MERCHANT' : '';
    /* CU-C-75:主办主题页的「查看收到的申请」按本主题的待处理数计数,落点却是全局协作列表 ——
       管理员看不出本主题到底有没有申请。入口带上 topicId,这里只显示这条主题的协作;
       清除后回到全局。过滤只作用于渲染,四路请求仍是全量(不为一个筛选改后端契约)。 */
    this._topicFilter = options && options.topicId ? String(options.topicId) : '';
    this._topicFilterName = options && options.topicName ? decodeURIComponent(String(options.topicName)) : '';
    if (this._topicFilter) {
      // 与下面 tab 的处理同因:onLoad 里同步写会当场记进未收口的创建流程(渲染层会报
      // expect FLOW_INITIAL_CREATION end but get FLOW_DATA_OBSERVER)。文案先算好,
      // nextTick 里只留一句纯赋值 —— render-flow 源码合同只认那一种形状。
      const scopeText = '只看「' + (this._topicFilterName || '#' + this._topicFilter) + '」的协作';
      wx.nextTick(() => this.setData({ topicScopeText: scopeText }));
    }
    if (options && options.tab === 'sent') {
      wx.nextTick(() => this.setData({ tab: 1, tabKey: '1' }));
    } else if (options && options.tab === 'received') {
      // 候选池页下线后,主办主题页/我的项目改从这里进「收到的」;显式写 0 只为语义完整,不是新落点
      wx.nextTick(() => this.setData({ tab: 0, tabKey: '0' }));
    }
  },

  onShow() {
    merchantTheme.merchantPageShow();
    this.load();
    this._initWorkflow();
  },

  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._listEpoch = (this._listEpoch || 0) + 1;
    this._applyEpoch = (this._applyEpoch || 0) + 1;
    this._listLoading = false;
    this._applyLoading = false;
    this._regEpoch = (this._regEpoch || 0) + 1;
    this._regLoading = false;
    this._officialEpoch = (this._officialEpoch || 0) + 1;
    this._officialLoading = false;
    this._actionPendingKey = '';
    this._navigating = false;
    if (this._workflow) this._workflow.destroy();
    clearTimeout(this._depositRefreshTimer);
    merchantTheme.merchantPageRestore();
  },

  load() {
    const that = this;
    const scope = identityKey();
    if (this._listLoading && this._listLoadingScope === scope) {
      this.loadApplies();
      this.loadOfficialInvites();
      this.loadReceivedRegs();
      return;
    }
    if (this._listLoading) this._listEpoch = (this._listEpoch || 0) + 1;
    const scopeChanged = this._listDataScope !== undefined && this._listDataScope !== scope;
    if (scopeChanged) {
      this._listLoadedScope = '';
      this.setData({ received: [], sent: [] });
    }
    this._listDataScope = scope;
    this._listLoading = true;
    this._listLoadingScope = scope;
    const epoch = (this._listEpoch || 0) + 1;
    this._listEpoch = epoch;
    const hadSnapshot = this._listLoadedScope === scope;
    // 后端 /api/coop/list 是 @RequestBody 端点,必须发 JSON;缺 header 会被当 urlencoded 导致 415 加载不出
    this.setData({
      listState: hadSnapshot ? 'ready' : 'loading', listRefreshing: hadSnapshot,
      listErrorKind: '', listErrorText: '',
    });
    const settle = function () {
      if (epoch !== that._listEpoch || scope !== identityKey()) return false;
      that._listLoading = false;
      that._listLoadingScope = '';
      that._stopRefreshWhenSettled();
      return true;
    };
    const fail = function (value) {
      if (!settle()) return;
      const kind = failureKind(value);
      const text = failureText(value, '协作邀请没加载出来');
      if (kind === 'permission') {
        that._listLoadedScope = '';
        that.setData({ received: [], sent: [], listState: 'permission', listRefreshing: false, listErrorKind: kind, listErrorText: text });
      } else if (hadSnapshot) {
        that.setData({ listState: 'ready', listRefreshing: false, listErrorKind: kind, listErrorText: text });
      } else {
        that.setData({ received: [], sent: [], listState: kind === 'permission' ? 'permission' : 'error', listRefreshing: false, listErrorKind: kind, listErrorText: text });
      }
    };
    app.sendRequest({
      hideLoading: true, silentError: true, url: '/api/coop/list', method: 'POST',
      data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.code != '200' || !res.data || !isRecordList(res.data.received) || !isRecordList(res.data.sent)) {
          fail(res);
          return;
        }
        const d = res.data;
        if (!settle()) return;
        that._listLoadedScope = scope;
        const sent = decorate(d.sent, d.slots);
        // 回邀约的挂接与过滤无关:过滤只换显示,状态真源留在实例上(未过滤的那一份)
        that._sentAll = sent;
        that.setData({
          received: that.applyTopicFilter(decorate(d.received, d.slots)),
          sent: that.applyTopicFilter(sent),
          receivedApplies: that.applyTopicFilter(linkRepliedApplies(that.data.receivedApplies, sent)),
          listState: 'ready', listRefreshing: false, listErrorKind: '', listErrorText: '',
        });
      },
      fail(value) { fail(value); }
    });
    this.loadApplies();
    this.loadOfficialInvites();
    this.loadReceivedRegs();
  },

  onPullDownRefresh() { this.load(); },

  _stopRefreshWhenSettled() {
    if (!this._listLoading && !this._applyLoading && !this._regLoading && !this._officialLoading) stopPullDownRefresh();
  },

  // 俱乐部承接申请的两路:发布者收到的(/pool/received)+ 我发出的(/pool/mine)。
  // 两路都含已处理/已锁价历史 —— 不读 /pool/list,那里只列仍开放的主题,锁价后记录会凭空消失。
  // ★两路各自结算、各自报错(2026-09-15 实拍):旧版共用一个 applyErrorText,
  //   先失败的 /pool/received 的错误会顶到「我发出的」tab 上(错误没有归属),
  //   且它一路的失败会把另一路的新数据一起丢掉。现在收到的失败只压收到的这一路。
  loadApplies() {
    const that = this;
    const scope = identityKey();
    if (this._applyLoading && this._applyLoadingScope === scope) return;
    if (this._applyLoading) this._applyEpoch = (this._applyEpoch || 0) + 1;
    if (this._applyDataScope !== undefined && this._applyDataScope !== scope) {
      this._receivedApplyLoadedScope = '';
      this._sentApplyLoadedScope = '';
      this.setData({ receivedApplies: [], sentApplies: [] });
    }
    this._applyDataScope = scope;
    this._applyLoading = true;
    this._applyLoadingScope = scope;
    const epoch = (this._applyEpoch || 0) + 1;
    this._applyEpoch = epoch;
    const receivedHadSnapshot = this._receivedApplyLoadedScope === scope;
    const sentHadSnapshot = this._sentApplyLoadedScope === scope;
    this.setData({
      receivedApplyState: receivedHadSnapshot ? 'ready' : 'loading',
      sentApplyState: sentHadSnapshot ? 'ready' : 'loading',
      receivedApplyErrorText: '', sentApplyErrorText: '',
    });
    let pending = 2;
    const finish = function () {
      if (--pending > 0) return;
      if (epoch !== that._applyEpoch || scope !== identityKey()) return;
      that._applyLoading = false;
      that._applyLoadingScope = '';
      that._stopRefreshWhenSettled();
    };
    const took = function (leg, res) {
      if (epoch !== that._applyEpoch || scope !== identityKey()) { finish(); return; }
      if (res && res.code == '200' && isApplyList(res.data)) {
        if (leg === 'received') {
          that._receivedApplyLoadedScope = scope;
          that.setData({
            receivedApplies: that.applyTopicFilter(
              linkRepliedApplies(decorateApplies(res.data, 'received'), that._sentAll || [])),
            receivedApplyState: 'ready', receivedApplyErrorText: '',
          });
        } else {
          that._sentApplyLoadedScope = scope;
          that.setData({
            sentApplies: that.applyTopicFilter(decorateApplies(res.data, 'sent')),
            sentApplyState: 'ready', sentApplyErrorText: '',
          });
        }
        finish();
        return;
      }
      // 失败:只清掉这一路的列表(没有旧快照时),只在这一路的 tab 上报错+保留旧快照
      const text = failureText(res, '申请带队记录没加载出来');
      if (leg === 'received') {
        that.setData({
          receivedApplyState: receivedHadSnapshot ? 'ready' : 'error',
          receivedApplyErrorText: text,
          receivedApplies: receivedHadSnapshot ? that.data.receivedApplies : [],
        });
      } else {
        that.setData({
          sentApplyState: sentHadSnapshot ? 'ready' : 'error',
          sentApplyErrorText: text,
          sentApplies: sentHadSnapshot ? that.data.sentApplies : [],
        });
      }
      finish();
    };
    app.sendRequest({
      hideLoading: true, silentError: true, url: '/api/coop/pool/received', method: 'POST',
      data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
      success(res) { took('received', res); },
      fail(value) { took('received', value); },
    });
    app.sendRequest({
      hideLoading: true, silentError: true, url: '/api/coop/pool/mine', method: 'POST',
      data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
      success(res) { took('sent', res); },
      fail(value) { took('sent', value); },
    });
  },

  // 收到的:商家报名承接我主题节点的「报名候选」(跨主题聚合,原候选池页报名 tab 收编)。
  // 单请求拿全量(E2 后端按发布者归属聚合,分页/上限在端点内);失败只压这一块,保留旧快照。
  loadReceivedRegs() {
    const that = this;
    const scope = identityKey();
    if (this._regLoading && this._regLoadingScope === scope) return;
    if (this._regLoading) this._regEpoch = (this._regEpoch || 0) + 1;
    if (this._regDataScope !== undefined && this._regDataScope !== scope) {
      this._regLoadedScope = '';
      this.setData({ receivedRegs: [] });
    }
    this._regDataScope = scope;
    this._regLoading = true;
    this._regLoadingScope = scope;
    const epoch = (this._regEpoch || 0) + 1;
    this._regEpoch = epoch;
    const hadSnapshot = this._regLoadedScope === scope;
    this.setData({
      receivedRegState: hadSnapshot ? 'ready' : 'loading',
      receivedRegErrorText: '',
    });
    const settle = function () {
      if (epoch !== that._regEpoch || scope !== identityKey()) return false;
      that._regLoading = false;
      that._regLoadingScope = '';
      that._stopRefreshWhenSettled();
      return true;
    };
    const fail = function (value) {
      if (!settle()) return;
      that.setData({
        receivedRegState: hadSnapshot ? 'ready' : 'error',
        receivedRegErrorText: failureText(value, '承接报名没加载出来'),
        receivedRegs: hadSnapshot ? that.data.receivedRegs : [],
      });
    };
    app.sendRequest({
      hideLoading: true, silentError: true, url: '/api/coop/candidates/received', method: 'POST',
      data: JSON.stringify(this._operationScope ? { scope: this._operationScope } : {}),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.code != '200' || !res.data || !isRecordList(res.data.rows)) { fail(res); return; }
        if (!settle()) return;
        that._regLoadedScope = scope;
        that.setData({
          receivedRegs: that.applyTopicFilter(res.data.rows.map(decorateReg)),
          receivedRegState: 'ready', receivedRegErrorText: '',
        });
      },
      fail(value) { fail(value); },
    });
  },

  // 官方邀约只发给审核通过的商家:后端对非商家下发稳定机器码 NOT_ACTIVE_MERCHANT = 本来就没有,不是加载失败。
  // 只认机器码,不按文案/泛 403 猜身份 —— 文案一改或别的 403 都会把真实故障吞成空列表。
  loadOfficialInvites() {
    const scope = identityKey();
    // 同身份在途不重发;身份变了(切账号)要作废旧航班并清掉旧身份的官方邀约
    if (this._officialLoading && this._officialLoadingScope === scope) return;
    if (this._officialDataScope !== undefined && this._officialDataScope !== scope) this.setData({ officialInvites: [] });
    this._officialDataScope = scope;
    const that = this;
    const epoch = (this._officialEpoch || 0) + 1;
    this._officialEpoch = epoch;
    this._officialLoading = true;
    this._officialLoadingScope = scope;
    this.setData({ officialErrorText: '' });
    const settle = function () {
      if (epoch !== that._officialEpoch || scope !== identityKey()) return false;
      that._officialLoading = false;
      that._stopRefreshWhenSettled();
      return true;
    };
    const fail = function (value) {
      if (!settle()) return;
      if (value && value.errorCode === 'NOT_ACTIVE_MERCHANT') that.setData({ officialInvites: [], officialErrorText: '' });
      else that.setData({ officialErrorText: failureText(value, '官方邀约没加载出来') });
    };
    app.sendRequest({
      hideLoading: true, silentError: true, url: '/api/official/merchant-invites', method: 'GET',
      success(res) {
        if (res.code != '200' || !isRecordList(res.data)) { fail(res); return; }
        if (!settle()) return;
        that.setData({ officialInvites: that.applyTopicFilter(decorateOfficial(res.data)), officialErrorText: '' });
      },
      fail(value) { fail(value); },
    });
  },

  acceptOfficialInvite(e) {
    const id = e.currentTarget.dataset.id;
    const terms = e.currentTarget.dataset.terms || '合作条款待确认';
    const that = this;
    const actionKey = 'official-accept:' + id;
    if (!this._beginAction(actionKey)) return;
    modal.show({
      title: '确认接受邀约',
      content: terms + '\n\n接受后条款即冻结，后续合作按此执行。', confirmText: '接受',
      success(r) { if (r.confirm) that._submitOfficialInvite(actionKey, id, 1, ''); else that._finishAction(actionKey, '', ''); },
      fail() { that._finishAction(actionKey, '', '操作确认没有打开，请重试'); },
    });
  },

  rejectOfficialInvite(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    const actionKey = 'official-reject:' + id;
    if (!this._beginAction(actionKey)) return;
    modal.show({
      danger: true, title: '拒绝邀约', editable: true, placeholderText: '请填写原因', confirmText: '拒绝', cancelText: '再想想',
      success(r) {
        if (!r.confirm) { that._finishAction(actionKey, '', ''); return; }
        const reason = String(r.content || '').trim();
        if (!reason) { that._finishAction(actionKey, '', '请填写拒绝原因'); return; }
        that._submitOfficialInvite(actionKey, id, 2, reason);
      },
      fail() { that._finishAction(actionKey, '', '操作确认没有打开，请重试'); },
    });
  },

  _submitOfficialInvite(actionKey, id, status, reason) {
    const that = this;
    let data;
    try { data = officialChannel.handlePayload(id, status, reason); } catch (error) {
      this._finishAction(actionKey, '', failureText(error, '邀约参数无效'));
      return;
    }
    app.sendRequest({
      url: '/api/coop/handle', method: 'POST', data: JSON.stringify(data),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.code == '200') {
          that._finishAction(actionKey, '官方邀约已处理', '');
          that.loadOfficialInvites();
        } else {
          that._finishAction(actionKey, '', failureText(res, '操作未完成'));
        }
      },
      fail(value) { that._finishAction(actionKey, '', failureText(value, '操作结果待确认，已刷新')); that.loadOfficialInvites(); },
    });
  },

  // 邀约提醒订阅(原合作中心「开启邀约提醒」):须在点击手势内请求
  enableInviteAlerts() {
    const that = this;
    return subscribe.request(['coopInvited']).then(function (result) {
      const accepted = result.acceptedKeys.indexOf('coopInvited') >= 0;
      that.setData({
        actionReceipt: accepted ? '已开启邀约提醒' : '',
        actionError: accepted ? '' : (result.status === subscribe.STATUS.UNSUPPORTED ? '当前微信版本不支持邀约提醒' : '未开启邀约提醒，可稍后再试'),
      });
    });
  },

  onTabChange(e) { this.setData({ tab: Number(e.detail.key), tabKey: e.detail.key }); },

  /* CU-C-75:显示层过滤。四路数据(收到的邀约 / 我发出的 / 带队申请 / 官方邀约)
     都已经全量在手,不为一个筛选再改后端契约;没有 topicId 的行(例如平台官方邀约)
     不属于「这条主题的申请」,一并排除。 */
  applyTopicFilter(rows) {
    const want = this._topicFilter;
    if (!want || !Array.isArray(rows)) return rows;
    return rows.filter(row => row && String(row.topicId == null ? '' : row.topicId) === want);
  },

  // 范围是可撤的:只看本主题的人也要能回到全局(同一页、不清栈)
  clearTopicFilter() {
    if (!this._topicFilter) return;
    this._topicFilter = '';
    this._topicFilterName = '';
    this.setData({ topicScopeText: '' });
    this.load();
  },

  _beginAction(key, inviteId) {
    if (arguments.length > 1 && !parseInviteId(inviteId)) {
      this.setData({ listErrorText: INVITE_ID_ERROR, listErrorKind: 'server' });
      return false;
    }
    if (this._actionPendingKey) return false;
    this._actionPendingKey = key;
    this.setData({ actionPendingKey: key, actionReceipt: '', actionError: '' });
    return true;
  },

  _finishAction(key, receipt, failure) {
    if (this._actionPendingKey !== key) return;
    this._actionPendingKey = '';
    this.setData({ actionPendingKey: '', actionReceipt: receipt || '', actionError: failure || '' });
  },

  // 接受字符串或 { url },与 wx.navigateTo 同形。给对象形是为了让目标路由能被
  // nav-route-exists 那条孤儿页门禁静态回读到(它只认 url: '/pages/...' 这种写法)。
  _navigateTo(target) {
    const url = typeof target === 'string' ? target : (target && target.url);
    if (!url) return;
    if (this._navigating) return;
    this._navigating = true;
    wx.navigateTo({ url: url, complete: () => { this._navigating = false; } });
  },

  // 我发出的:撤回待处理的申请带队(申请入口在俱乐部详情「可对接的活动」)
  withdrawApply(e) {
    const topicId = e.currentTarget.dataset.topicid;
    const that = this;
    const actionKey = 'withdraw:' + topicId;
    if (!this._beginAction(actionKey)) return;
    modal.show({
      title: '撤回申请',
      content: '撤回后商家将不再看到这条申请,之后可重新申请。',
      confirmText: '撤回',
      success(r) {
        if (!r.confirm) { that._finishAction(actionKey, '', ''); return; }
        app.sendRequest({
          url: '/api/coop/pool/withdraw', method: 'POST',
          data: JSON.stringify({ topicId: topicId }),
          header: { 'Content-Type': 'application/json' },
          success(res) {
            if (res.code == '200') {
              that._finishAction(actionKey, '已撤回承接申请', '');
              that.loadApplies();
            } else {
              that._finishAction(actionKey, '', failureText(res, '撤回失败'));
            }
          },
          fail(value) { that._finishAction(actionKey, '', failureText(value, '撤回失败')); },
        });
      },
      fail() { that._finishAction(actionKey, '', '操作确认没有打开，请重试'); },
    });
  },

  // 收到的:发布者婉拒俱乐部申请。/pool/decline 与 /pool/received 同一归属口径(登录人即发布者)。
  declineApply(e) {
    const applyId = e.currentTarget.dataset.applyid;
    const name = e.currentTarget.dataset.name || '该俱乐部';
    // 商家员工处理 owner 主题上的申请:/pool/received 行上带 scope=MERCHANT,原样回传给 /decline
    const merchantScope = e.currentTarget.dataset.scope === 'MERCHANT';
    const that = this;
    const actionKey = 'decline:' + applyId;
    if (!this._beginAction(actionKey)) return;
    modal.show({
      danger: true,
      title: '拒绝申请',
      content: '拒绝「' + name + '」的带队申请?对方会收到通知,之后仍可重新申请。',
      confirmText: '拒绝',
      cancelText: '再想想',
      success(r) {
        if (!r.confirm) { that._finishAction(actionKey, '', ''); return; }
        app.sendRequest({
          url: '/api/coop/pool/decline', method: 'POST',
          data: JSON.stringify(merchantScope ? { applyId: applyId, scope: 'MERCHANT' } : { applyId: applyId }),
          header: { 'Content-Type': 'application/json' },
          success(res) {
            if (res.code == '200') {
              that._finishAction(actionKey, '已拒绝「' + name + '」的申请', '');
              that.loadApplies();
            } else {
              that._finishAction(actionKey, '', failureText(res, '拒绝失败'));
            }
          },
          // 结果未知就回读列表,不让人对着旧状态再点一次
          fail(value) { that._finishAction(actionKey, '', failureText(value, '拒绝结果待确认，已刷新列表')); that.loadApplies(); },
        });
      },
      fail() { that._finishAction(actionKey, '', '操作确认没有打开，请重试'); },
    });
  },

  // 收到的:接受申请 = 回一张带条款的正式邀约(申请只表意向不成单,§3.6),同候选池 goInviteClub
  replyApplyInvite(e) {
    const ds = e.currentTarget.dataset;
    if (!ds.clubid || !ds.topicid || !ds.applyid) return;
    this._navigateTo({ url: '/pages/coop/invite/index?type=1&toId=' + ds.clubid
      + '&toName=' + encodeURIComponent(ds.name || '该俱乐部')
      + '&topicId=' + ds.topicid + '&originApplyId=' + ds.applyid
      + (ds.scope === 'MERCHANT' ? '&scope=MERCHANT' : '') });
  },

  // 我发出的:商家已回邀约 → 去「收到的」确认条款
  switchToReceived() { this.setData({ tab: 0, tabKey: '0' }); },

  // 顶部「+ 发起邀请」+ 两个空态 cta="去发起邀请" 共用:没有预选目标时进 coop/invite，
  // 仅展示现役 type1 俱乐部邀约对象列表。
  // 带 toId 直达对方主页的入口另有一批(俱乐部详情 / 商家主页 / 关系页 / 附近商家 / 候选人),
  // 那条路径更快但不是本页能提供的上下文——本页三处绑定原本就指这里,一度在某次 chore 提交
  // (34b6895c4)里被整体覆盖丢了方法定义,wxml 绑定原样留着,现补回。
  // 5-06(R9-09 残留):空态 CTA 原来写死 type=1(商家→俱乐部,后端要 COOP_MANAGE),
  // 主理人点进去再提交必被拒。按当前身份给对的 type:俱乐部侧走 type=0(邀商家),
  // 商家/玩家保持 type=1。身份解释与 pages/coop/invite/index.js 共用同一份策略。
  goInvite() {
    const snapshot = {
      role: typeof app.getUserRole === 'function' ? app.getUserRole() : '',
      userType: typeof app.getUserType === 'function' ? app.getUserType() : '',
    };
    const inviteType = policy.isClubView(snapshot) ? 0 : 1;
    this._navigateTo('/pages/coop/invite/index?type=' + inviteType
      + (this._operationScope ? '&scope=MERCHANT' : ''));
  },

  // Figma 02d:列表只放得下一行状态字。「已拒绝 / 已过期 / 已顶替」最该被看见的是
  // 对方给的理由和当时的条款快照,那些只有详情页装得下。
  goInviteDetail(e) {
    const id = e.currentTarget.dataset.id;
    const box = e.currentTarget.dataset.box === 'sent' ? 'sent' : 'received';
    if (!parseInviteId(id)) {
      this.setData({ listErrorText: INVITE_ID_ERROR, listErrorKind: 'server' });
      return;
    }
    this._navigateTo({ url: '/pages/coop/invite-detail/index?inviteId=' + id + '&box=' + box });
  },

  // goMybiz 已随顶部「结算」按钮一起删除(它是该按钮的唯一调用方)。
  // 「合作与结算」工作台仍可从 merchant/relation 进,页面没有变成孤儿。

  // 供给申报浮层与评价浮层已随动作搬进 pages/coop/invite-detail(协作详情页),
  // 本页只保留卡片级决策:接受/拒绝/撤回/取消(未接受)/保证金/退款重试。

  // 发件箱卡「再邀别人」:候选池页已下线,改为去附近商家挑人,topicId 一路带着(同 merchantinfo goInviteMerchant)
  goInviteOthers(e) {
    const topicId = e.currentTarget.dataset.topicid;
    if (!topicId) return;
    this._navigateTo('/pages/coop/nearby/index?topicId=' + topicId);
  },

  // 收到的:确认报名候选占槽(不成交 —— 附提示去发带条款邀约,与候选池页同语义、同一 confirm 端点)
  confirmReg(e) {
    const ds = e.currentTarget.dataset;
    const id = ds.id;
    const toId = ds.memberid;
    const toName = ds.name || '该商家';
    const toLogo = ds.logo || '';
    const toMeta = ds.meta || '';
    const topicId = ds.topicid;
    const that = this;
    const actionKey = 'reg-confirm:' + id;
    if (!this._beginAction(actionKey)) return;
    modal.show({
      title: '确认候选',
      content: '确认该商家占住这个地点?同地点其他待调配报名将自动落选。\n确认后需再向他发出带条款的合作邀约,他接受才成合作单。',
      confirmText: '确认',
      success(r) {
        if (!r.confirm) { that._finishAction(actionKey, '', ''); return; }
        app.sendRequest({
          url: '/api/coop/candidates/confirm', method: 'POST',
          data: JSON.stringify(that._operationScope
            ? { registrationId: id, scope: that._operationScope } : { registrationId: id }),
          header: { 'Content-Type': 'application/json' },
          success(res) {
            if (res.code != '200') { that._finishAction(actionKey, '', failureText(res, '确认失败')); return; }
            that._finishAction(actionKey, '已确认「' + toName + '」占住候选位置', '');
            that.loadReceivedRegs();
            // 占槽成功 → 直接引到发邀约,别让流程断在「中标了但没合同」
            modal.show({
              title: '已占位,接着发邀约',
              content: '现在给「' + toName + '」发一张带分账条款的邀约,他接受后才成合作单。',
              confirmText: '去发邀约', cancelText: '稍后',
              success(r2) {
                if (!r2.confirm || !toId) return;
                that._navigateTo({ url: '/pages/coop/invite/index?type=0&toId=' + toId
                  + '&toName=' + encodeURIComponent(toName)
                  + (toLogo ? '&toLogo=' + encodeURIComponent(toLogo) : '')
                  + (toMeta ? '&toMeta=' + encodeURIComponent(toMeta) : '')
                  + '&topicId=' + topicId
                  + (that._operationScope ? '&scope=MERCHANT' : '') });
              },
            });
          },
          // 结果未知就回读,不让人对着旧状态再点一次
          fail(value) {
            that._finishAction(actionKey, '', failureText(value, '确认结果待确认，已刷新列表'));
            that.loadReceivedRegs();
          },
        });
      },
      fail() { that._finishAction(actionKey, '', '操作确认没有打开，请重试'); },
    });
  },

  _initWorkflow() {
    if (this._workflow) return;
    const that = this;
    const verifyDeposit = createPaymentVerifier({
      requestStatus(ref, options, cb) {
        return app.sendRequest({
          url: '/api/coop/deposit/status',
          method: 'POST',
          data: JSON.stringify({ inviteId: ref.inviteId }),
          header: { 'Content-Type': 'application/json' },
          hideLoading: true,
          autoErrorToast: false,
          timeout: options.timeout,
          success(res) {
            cb((res.code == '200' || res.code == 200) && res.data
              ? res.data : { paymentStatus: 'unknown' });
          },
          successStatusAbnormal() { cb({ paymentStatus: 'unknown' }); },
          fail() { cb({ paymentStatus: 'unknown' }); }
        });
      },
      classify(res) { return res && res.paymentStatus || 'unknown'; },
      perRequestTimeoutMs: 5000,
      totalDeadlineMs: 20000,
      intervalMs: 1500
    });
    that._workflow = createCheckoutWorkflow({
      createOrder: function (payload, cb) {
        cyLoading.show('发起支付...');
        return app.sendRequest({
          url: '/api/coop/deposit/create',
          method: 'POST',
          data: JSON.stringify({ inviteId: payload.inviteId }),
          header: { 'Content-Type': 'application/json' },
          success: function (res) {
            cyLoading.hide();
            if (res.code == '200' && res.data) {
              cb({ ok: true, data: { inviteId: payload.inviteId, payParams: res.data } });
            } else {
              cb({ ok: false, msg: res.msg || '发起保证金失败' });
            }
          },
          fail: function () {
            cyLoading.hide();
            cb({ ok: false, msg: '网络异常，请重试' });
          }
        });
      },
      requestPayment: function (orderData, cb) {
        const payParams = orderData.payParams;
        wx.requestPayment({
          timeStamp: payParams.timeStamp,
          nonceStr: payParams.nonceStr,
          package: payParams.package,
          signType: payParams.signType,
          paySign: payParams.paySign,
          success: function () { cb({ ok: true }); },
          fail: function (res) {
            cb({ ok: false, cancelled: res.errMsg === 'requestPayment:fail cancel' });
          }
        });
      },
      isPayable: function () { return true; },
      validatePayment: hasCompletePaymentParams,
      verifyPayment: function (data, cb) {
        return verifyDeposit({ inviteId: data.inviteId }, cb);
      }
    });
  },

  // 锁价后的应缴方主动缴纳保证金;支付回调异步确认后刷新待缴态。
  payDeposit(e) {
    const inviteId = e.currentTarget.dataset.id;
    const that = this;
    const actionKey = 'deposit:' + inviteId;
    if (!this._beginAction(actionKey, inviteId)) return;

    var submitted = that._workflow.submit({ inviteId: inviteId }, {
      onOrderFail: function (res) {
        that._finishAction(actionKey, '', failureText(res, '发起保证金失败'));
      },
      onPaySuccess: function (data) {
        cyLoading.hide();
        that._finishAction(actionKey, '保证金已缴纳', '');
        toast.success('保证金已缴纳');
        that.load();
      },
      onPayVerifying: function () {
        cyLoading.show('确认支付结果...');
      },
      onPayCancel: function () {
        that._finishAction(actionKey, '已取消支付，仍可稍后缴纳', '');
      },
      onPayFail: function (res) {
        cyLoading.hide();
        that._finishAction(actionKey, '', failureText(res, '支付失败'));
      },
      onPayUnknown: function () {
        cyLoading.hide();
        modal.show({
          title: '支付结果待确认',
          content: '暂不要重复缴纳，请稍后刷新合作列表查看保证金状态。',
          showCancel: false
        });
        that._finishAction(actionKey, '', '支付结果待确认，暂不要重复缴纳，请稍后刷新');
      }
    });

    if (!submitted) {
      cyLoading.hide();
      that._finishAction(actionKey, '', '支付正在处理中，请勿重复提交');
    }
  },

  // 「联系合作方」已随已接受卡动作搬进 pages/coop/invite-detail(卡片最多两个按钮)。

  // 复制合作方电话(§3.3「点击复制」)。电话只有后端判定可给时才在 data 里。
  copyPartnerPhone(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    const actionKey = 'copy:' + phone;
    if (!this._beginAction(actionKey)) return;
    wx.setClipboardData({
      data: String(phone),
      success: () => this._finishAction(actionKey, '合作方电话已复制', ''),
      fail: (value) => this._finishAction(actionKey, '', failureText(value, '电话复制失败')),
    });
  },

  // ───────── 受邀方接受 / 拒绝(status 1 / 2)─────────
  // ⚠️ 这不是 merchant/coop-center 那份的重复实现,是**另一个角色**的同名动作。
  //    后端 handle 写死「接受/拒绝须受邀方本人」,而受邀方可以是商家、也可以是俱乐部。
  //    商家走 coop-center,俱乐部只有这一页 —— 在这之前俱乐部收到的邀约在小程序里
  //    根本没有可以点的地方,是条死路(Figma 02b 也把接受/拒绝画在「收件箱」)。
  _decideAsInvitee(id, accept) {
    const that = this;
    const actionKey = (accept ? 'accept:' : 'reject:') + id;
    if (!this._beginAction(actionKey, id)) return;
    const send = function (reason) {
      app.sendRequest({
        url: '/api/coop/handle', method: 'POST',
        data: JSON.stringify({ id: id, status: accept ? 1 : 2, handleReason: reason || '' }),
        header: { 'Content-Type': 'application/json' },
        success(res) {
          if (res.code == '200') {
            that._finishAction(actionKey, accept ? '已接受合作' : '已拒绝', '');
            that.load();
          } else {
            that._finishAction(actionKey, '', failureText(res, accept ? '接受失败' : '拒绝失败'));
          }
        },
        fail(value) { that._finishAction(actionKey, '', failureText(value, accept ? '接受失败' : '拒绝失败')); },
      });
    };
    if (accept) { send(''); return; }
    // 拒绝要给理由:对方拿着这句话才知道下一步该改什么(稿上「回复对方」那栏)
    // 走 utils/modal.js —— 全仓原生弹层已收编,生产 JS 不许再直接 wx.showModal
    modal.show({
      danger: true,
      title: '拒绝这条邀约',
      content: '',
      editable: true,
      placeholderText: '写下拒绝的理由，会连同决定一起发给对方',
      confirmText: '拒绝',
      cancelText: '再想想',
      // CU-M-49(同页同根因):空理由不关面板
      validate(r) { return typeof r === 'string' && r.trim() ? '' : '请填写拒绝理由'; },
      success(r) {
        if (!r.confirm) { that._finishAction(actionKey, '', ''); return; }
        const reason = (r.content || '').trim();
        if (!reason) { that._finishAction(actionKey, '', '请填写拒绝理由'); return; }
        send(reason);
      },
      fail() { that._finishAction(actionKey, '', '操作确认没有打开，请重试'); },
    });
  },

  acceptReceived(e) { this._decideAsInvitee(e.currentTarget.dataset.id, true); },
  rejectReceived(e) { this._decideAsInvitee(e.currentTarget.dataset.id, false); },

  // ───────── 发起方取消(status=3)。★这是本页保留 /api/coop/handle 的唯一理由 ─────────
  // 后端 ApiCoopController.handle 写死:「接受/拒绝须受邀方本人;取消须发起方本人」。
  // 所以 status 1/2(商家接受/拒绝)和 status 3(发起方取消)是**两个角色**的动作,
  // 不是同一件事的两份实现。1/2 已全部收敛到 merchant/coop-center;3 只能留在这里 ——
  // coop-center 是商家页,俱乐部进不去。
  //
  // 原先这两处走的是一个泛化的 handle(e) + data-status="3",跟商家侧那个同名同形,
  // 所以在「消费方去重」时长得像重复项。改成按角色命名,让它自己说清楚它是谁的动作。
  _cancelAsInitiator(id, opts) {
    const that = this;
    const actionKey = 'cancel:' + id;
    if (!this._beginAction(actionKey, id)) return;
    modal.show({
      title: opts.title,
      content: opts.content,
      editable: true,
      placeholderText: opts.placeholder,
      confirmText: opts.confirmText,
      cancelText: '再想想',
      // CU-M-49:空理由不关面板(原来弹窗先关、输入一起丢,只能重开重打)
      validate(r) { return typeof r === 'string' && r.trim() ? '' : opts.emptyTip; },
      success(r) {
        if (!r.confirm) { that._finishAction(actionKey, '', ''); return; }
        const reason = (r.content || '').trim();
        if (!reason) { that._finishAction(actionKey, '', opts.emptyTip); return; }
        app.sendRequest({
          url: '/api/coop/handle', method: 'POST',
          data: JSON.stringify({ id: id, status: 3, message: reason }),
          header: { 'Content-Type': 'application/json' },
          success(res) {
            if (res.code == '200') {
              that._finishAction(actionKey, opts.okTip, '');
              that.load();
            } else {
              that._finishAction(actionKey, '', failureText(res, '取消失败'));
            }
          },
          fail(value) { that._finishAction(actionKey, '', failureText(value, '取消失败')); },
        });
      },
      fail() { that._finishAction(actionKey, '', '操作确认没有打开，请重试'); },
    });
  },

  // 撤回还没被处理的邀约(status 0 → 3)。已接受合作的「取消合作」与「锁价置灰说明」
  // 随动作搬进 pages/coop/invite-detail —— 本页的 _cancelAsInitiator 只服务 status 0 撤回。
  cancelSent(e) {
    this._cancelAsInitiator(e.currentTarget.dataset.id, {
      title: '取消邀请',
      content: '对方还没处理,取消后这条邀约作废。',
      placeholder: '请填写取消理由(必填)',
      confirmText: '取消邀请',
      emptyTip: '请填写取消理由',
      okTip: '已取消邀请'
    });
  },

  retryDepositRefund(e) {
    const id = e.currentTarget.dataset.id;
    const that = this;
    const actionKey = 'refund:' + id;
    if (!this._beginAction(actionKey, id)) return;
    app.sendRequest({
      url: '/api/coop/deposit/refund/retry', method: 'POST',
      data: JSON.stringify({ inviteId: id }), header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res && res.code == '200' && res.data && typeof res.data.refundState === 'string'
            && typeof res.msg === 'string' && res.msg.trim()) {
          that._finishAction(actionKey, res.msg, '');
          that.load();
        } else {
          that._finishAction(actionKey, '', res && res.code != '200'
            ? failureText(res, '退款重试失败') : '退款结果暂无法确认，请先核对，勿重复提交');
        }
      },
      fail() { that._finishAction(actionKey, '', '退款结果暂无法确认，请先核对，勿重复提交'); },
      successStatusAbnormal() { that._finishAction(actionKey, '', '退款结果暂无法确认，请先核对，勿重复提交'); },
    });
  }
});
