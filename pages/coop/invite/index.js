// 城瘾 · 发起协作邀请(type0 主题发布者→商家 / type1 商家→俱乐部)
// 类型1 商家→俱乐部:邀俱乐部成员来参加我的经典定向主题
// 自审核握手:发起即 status=0,受邀方在 coop/list 接受。后端 /api/coop/invite
const toast = require('../../../utils/toast.js');
const app = getApp();
/* 结果面板终态停留时长(cy-result-sheet 的 duration 默认也是 2000)。
   成功后要跳走,跳转挂在面板的 close 上,时长只此一处。 */
const RESULT_SHEET_MS = 2000;
const subscribe = require('../../../utils/subscribe.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const { isRecordList } = require('../../../utils/response-shape.js');
const { toTimestamp, chinaParts } = require('../../../utils/datetime.js');
const RECRUIT_CLOSED_TEXT = '主题不在招商期,暂不能发起邀约';

// 主题日期的短标签:后端下发不带时区的中国时间串,统一锚上海日历再取月日。
function topicDateText(raw) {
  if (!raw) return '';
  const ts = toTimestamp(String(raw));
  const parts = ts ? chinaParts(ts) : null;
  if (!parts) return String(raw).slice(0, 10);
  return parts.month + '月' + parts.day + '日';
}

// 「识别主题」的三级信息,按从轻到重排:主题日期 → 集合地点 → 主题编号。
const TOPIC_IDENTIFIERS = ['date', 'place', 'code'];

// CU-C-113:同名主题在下拉里逐字重复(两条「E2E 探店日一期（不在招商期）」分别指向
// 990028 与 990027),选到哪条全凭运气,邀约又只能发给一条。这里从「只有主题名」起逐级
// 加深识别信息,直到列表里没有两条读起来一样为止 —— 单个主题时不啰嗦,真撞名才加长。
function buildTopicOptions(rows) {
  const items = rows.map(function (t) {
    const place = typeof t.addressName === 'string' ? t.addressName.trim() : '';
    return {
      id: t.id,
      name: t.name,
      closed: t.inviteWindowOpen === false,
      parts: {
        date: topicDateText(t.startDate),
        place: place,
        code: '#' + t.id,
      },
      short: '',
      label: '',
    };
  });
  for (let used = 0; used <= TOPIC_IDENTIFIERS.length; used++) {
    const taken = used === 0 ? [] : TOPIC_IDENTIFIERS.slice(0, used);
    items.forEach(function (item) {
      const detail = taken.map(function (key) { return item.parts[key]; }).filter(Boolean).join(' · ');
      // short 是选完之后回显在触发器上的那行(不带招商期标记,那半句下面已有专门的提示行);
      // label 是下拉里的选项,额外标出「不在招商期」。
      item.short = item.name + (detail ? ' · ' + detail : '');
      item.label = item.short + (item.closed ? '（不在招商期）' : '');
    });
    const counts = {};
    items.forEach(function (item) { counts[item.label] = (counts[item.label] || 0) + 1; });
    if (items.every(function (item) { return counts[item.label] === 1; })) break;
  }
  return items;
}

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
  if (String(code) === '401' || String(code) === '403' || /请先登录|无权|仅.+可|资格|身份/.test(message)) return 'permission';
  if (/request:fail|timeout/i.test(String(value && value.errMsg || ''))) return 'network';
  return 'server';
}

function failureText(value, fallback) {
  if (failureKind(value) === 'network') return '网络不稳定，请检查连接后重试';
  return String(value && (value.msg || value.message) || fallback);
}

function routeText(value) {
  if (!value) return '';
  try { return decodeURIComponent(value); } catch (error) { return String(value); }
}

function stopPullDownRefresh() {
  if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh();
}

function isNamedRecordList(value, idKey) {
  return isRecordList(value) && value.every(function (item) {
    return item[idKey] != null && item[idKey] !== ''
      && typeof item.name === 'string' && item.name.trim() !== '';
  });
}

/**
 * CU-M-98 · shareMode=2 的计价口径只有一个真源。
 *
 * 后端走的是 FIXED_PER_FULFILLMENT(CoopSettlementContract.java:39-45:每一条已核销的报名
 * 各结一次 fixedFee),即**按核销人头计费**,不是整场一口价。此前俱乐部侧选项名叫「固定带队费」、
 * 金额行又挂着「/ 每核销 1 人」,一句里两种互斥条款;确认弹层的 termsText 还把单位省掉,
 * 双方点确认时看到的根本不是同一条约定。名称与单位在这里定义一次,选项行 / 金额行 / 确认条款三处同源。
 */
function feeTerms(activeType) {
  return Number(activeType) === 1
    ? { feeName: '按核销人头付带队费', feeUnit: '/ 每核销 1 人' }
    : { feeName: '按核销付费', feeUnit: '/ 人' };
}

Page({
  data: {
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    activeType: 1,        // 0 主题发布者→商家 / 1 商家→俱乐部
    feeName: feeTerms(1).feeName,   // CU-M-98:条款名称与单位随 activeType 定,展示三处同源
    feeUnit: feeTerms(1).feeUnit,
    presetTarget: null,
    originApplyId: null,  // P0-4 候选池申请的可信溯源,仅 type1 预填俱乐部时提交
    topicId: null,        // 关联的我方主题(必填)
    topicName: '',
    // 选中后回显在触发器上的那行:同名主题要带识别信息(topicName 仍是纯名,它要传给下游页与结果面板)
    topicPick: '',
    topicClosed: false,
    resultSheet: { show: false, kind: 'success', title: '', sub: '', meta: '', pill: '',
      why: '', primaryText: '', secondaryText: '', duration: 2000 },
    operationScope: '',
    myTopics: [],         // 我发布的主题(无 topicId 时供选择)
    topicIndex: -1,
    clubs: [],            // 类型1 目标:可对接俱乐部
    merchants: [],        // 类型0 目标:可合作商家
    topicsState: 'loading',
    targetsState: 'loading',
    topicsRefreshing: false,
    topicsErrorKind: '',
    topicsErrorText: '',
    targetsRefreshing: false,
    targetsErrorKind: '',
    targetsErrorText: '',
    message: '',
    submitting: false,
    selected: [],
    selectedMap: {},
    inviteModal: { show: false, targetText: '', targetLogo: '', targetMeta: '', termsText: '' },
    sendResult: '',
    sendReceipt: '',
    // 创作者侧不提供分成选择；普通 /invite 服务端也会重建为非官方路径。
    shareMode: 0,
    shareRate: null,
    fixedFee: null,
  },

  onLoad(options) {
    options = options || {};
    this._topicFromRoute = !!options.topicId;
    const t = options.type != null ? Number(options.type) : 1;
    const invalidLegacyType = t === 2;
    const activeType = t === 0 ? 0 : 1;
    // type=0(主题发布者邀商家):从候选池带入指定商家;type=1:从候选池/俱乐部主页带入指定俱乐部(P0-4)。
    const presetTarget = !invalidLegacyType && options.toId
      ? {
        toId: options.toId,
        name: options.toName ? routeText(options.toName) : (activeType === 1 ? '该俱乐部' : '该商家'),
        logo: routeText(options.toLogo),
        meta: routeText(options.toMeta) || (activeType === 1 ? '俱乐部 · 已选定合作对象' : '商家 · 已选定合作对象'),
      }
      : null;
    this.setData({
      activeType: activeType,
      feeName: feeTerms(activeType).feeName,
      feeUnit: feeTerms(activeType).feeUnit,
      presetTarget: presetTarget,
      originApplyId: invalidLegacyType ? null : (options.originApplyId || null),
      topicId: options.topicId || null,
      topicName: options.topicName ? decodeURIComponent(options.topicName) : '',
      operationScope: options.scope === 'MERCHANT' ? 'MERCHANT' : '',
      topicsState: options.topicId ? 'ready' : 'loading',
      targetsState: presetTarget ? 'ready' : 'loading',
    });
    this._dataIdentity = identityKey();
    if (presetTarget) this._setSelected([presetTarget]);
    if (!this.data.topicId) this.loadMyTopics();
    this.loadTargets();
  },

  onShow() {
    merchantTheme.merchantPageShow();
    const currentIdentity = identityKey();
    if (this._dataIdentity !== undefined && this._dataIdentity !== currentIdentity) {
      this._invalidateRequests();
      this._dataIdentity = currentIdentity;
      this._topicsLoadedScope = '';
      this._targetsLoadedScope = '';
      const preset = this.data.presetTarget;
      if (!this._topicFromRoute) this.setData({ topicId: null, topicName: '', topicPick: '', topicClosed: false });
      this.setData({
        myTopics: [], clubs: [], merchants: [], topicIndex: -1,
        topicsState: this._topicFromRoute ? 'ready' : 'loading',
        targetsState: preset ? 'ready' : 'loading',
        topicsErrorText: '', targetsErrorText: '', sendResult: '', sendReceipt: '',
      });
      this._setSelected(preset ? [preset] : []);
      if (!this._topicFromRoute) this.loadMyTopics();
      this.loadTargets();
    }
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._invalidateRequests();
    this._submitting = false;
    this._navigating = false;
    merchantTheme.merchantPageRestore();
  },

  onPullDownRefresh() {
    let requested = false;
    if (!this.data.topicId) { requested = true; this.loadMyTopics(true); }
    if (!this.data.presetTarget) { requested = true; this.loadTargets(true); }
    if (!requested) stopPullDownRefresh();
  },

  _invalidateRequests() {
    this._topicsEpoch = (this._topicsEpoch || 0) + 1;
    this._targetsEpoch = (this._targetsEpoch || 0) + 1;
    this._submitEpoch = (this._submitEpoch || 0) + 1;
    this._topicsLoading = false;
    this._targetsLoading = false;
  },

  _topicsScope() { return 'topics|' + identityKey(); },
  _targetsScope() { return 'targets|' + this.data.activeType + '|' + identityKey(); },
  _submitScope() { return [this.data.activeType, this.data.topicId, identityKey()].join('|'); },

  _stopRefreshWhenSettled() {
    if (!this._topicsLoading && !this._targetsLoading) stopPullDownRefresh();
  },

  _setSelected(list) {
    const map = {};
    list.forEach(function (target) { map[String(target.toId)] = true; });
    this.setData({ selected: list, selectedMap: map });
  },

  toggleTarget(e) {
    if (this.data.presetTarget) return;
    const toId = e.currentTarget.dataset.toid;
    if (toId === undefined || toId === null || toId === '') return;
    const key = String(toId);
    const next = this.data.selected.filter(function (target) { return String(target.toId) !== key; });
    if (next.length === this.data.selected.length) next.push({
      toId: toId,
      name: e.currentTarget.dataset.name || '对方',
      logo: e.currentTarget.dataset.logo || '',
      meta: e.currentTarget.dataset.meta || '',
    });
    this._setSelected(next);
  },

  switchShareMode(e) {
    const mode = Number(e.detail && e.detail.key !== undefined ? e.detail.key : e.currentTarget.dataset.mode);
    if (mode !== 0 && mode !== 2) return;
    this.setData({ shareMode: mode });
  },

  onFeeInput(e) {
    const value = Number(e.detail.value);
    this.setData({ fixedFee: Number.isFinite(value) && value > 0 ? value : null });
  },

  loadMyTopics(force) {
    const that = this;
    const scope = this._topicsScope();
    if (this._topicsLoading && this._topicsLoadingScope === scope) return;
    if (this._topicsLoading) this._topicsEpoch = (this._topicsEpoch || 0) + 1;
    this._topicsLoading = true;
    this._topicsLoadingScope = scope;
    const epoch = (this._topicsEpoch || 0) + 1;
    this._topicsEpoch = epoch;
    const hadSnapshot = this._topicsLoadedScope === scope && (force || this.data.topicsState === 'ready');
    this.setData({
      topicsState: hadSnapshot ? 'ready' : 'loading', topicsRefreshing: hadSnapshot,
      topicsErrorKind: '', topicsErrorText: '',
    });
    const settle = function () {
      if (epoch !== that._topicsEpoch || scope !== that._topicsScope()) return false;
      that._topicsLoading = false;
      that._topicsLoadingScope = '';
      that._stopRefreshWhenSettled();
      return true;
    };
    const fail = function (value) {
      if (!settle()) return;
      const kind = failureKind(value);
      const text = failureText(value, '主题没加载出来');
      if (kind === 'permission') {
        that._topicsLoadedScope = '';
        that.setData({ myTopics: [], topicsState: 'permission', topicsRefreshing: false, topicsErrorKind: kind, topicsErrorText: text });
      } else if (hadSnapshot) {
        that.setData({ topicsState: 'ready', topicsRefreshing: false, topicsErrorKind: kind, topicsErrorText: text });
      } else {
        that.setData({ myTopics: [], topicsState: kind === 'permission' ? 'permission' : 'error', topicsRefreshing: false, topicsErrorKind: kind, topicsErrorText: text });
      }
    };
    app.sendRequest({
      hideLoading: true, silentError: true, url: '/api/topic/list', method: 'POST',
      // CU-M-29:让后端按本页的邀约方向回填 inviteWindowOpen(与写闸同一判据),选的时候就能看出哪条不在招商期
      data: { is_my: 1, scope: this.data.operationScope, invite_target: this.data.activeType === 1 ? 'club' : 'merchant' },
      success(res) {
        if (res.code != '200' || !res.data || !isNamedRecordList(res.data.rows, 'id')) {
          fail(res);
          return;
        }
        if (!settle()) return;
        that._topicsLoadedScope = scope;
        const myTopics = buildTopicOptions(res.data.rows);
        // 刷新后已选主题的招商状态可能变了(比如刚过截止),按新回包重算,别沿用旧标记
        const picked = myTopics.filter(function (t) { return String(t.id) === String(that.data.topicId); })[0];
        that.setData({
          myTopics: myTopics,
          topicClosed: !!(picked && picked.closed),
          topicsState: 'ready', topicsRefreshing: false, topicsErrorKind: '', topicsErrorText: '',
        });
      },
      fail(value) { fail(value); },
    });
  },

  onTopicChange(e) {
    const idx = Number(e.detail.value);
    const t = this.data.myTopics[idx];
    if (!t) return;
    this.setData({ topicIndex: idx, topicId: t.id, topicName: t.name, topicPick: t.short || t.name, topicClosed: !!t.closed });
  },

  onMessageInput(e) { this.setData({ message: e.detail.value }); },

  loadTargets(force) {
    const that = this;
    if (this.data.presetTarget) { this.setData({ targetsState: 'ready' }); return; }
    const scope = this._targetsScope();
    if (this._targetsLoading && this._targetsLoadingScope === scope) return;
    if (!force && this._targetsLoadedScope === scope) { this.setData({ targetsState: 'ready' }); return; }
    if (this._targetsLoading) this._targetsEpoch = (this._targetsEpoch || 0) + 1;
    this._targetsLoading = true;
    this._targetsLoadingScope = scope;
    const epoch = (this._targetsEpoch || 0) + 1;
    this._targetsEpoch = epoch;
    const hadSnapshot = this._targetsLoadedScope === scope;
    this.setData({
      targetsState: hadSnapshot ? 'ready' : 'loading', targetsRefreshing: hadSnapshot,
      targetsErrorKind: '', targetsErrorText: '',
    });
    const settle = function () {
      if (epoch !== that._targetsEpoch || scope !== that._targetsScope()) return false;
      that._targetsLoading = false;
      that._targetsLoadingScope = '';
      that._stopRefreshWhenSettled();
      return true;
    };
    const fail = function (value) {
      if (!settle()) return;
      const kind = failureKind(value);
      const text = failureText(value, '合作对象没加载出来');
      if (kind === 'permission') {
        that._targetsLoadedScope = '';
        that.setData({ clubs: [], merchants: [], targetsState: 'permission', targetsRefreshing: false, targetsErrorKind: kind, targetsErrorText: text });
      } else if (hadSnapshot) {
        that.setData({ targetsState: 'ready', targetsRefreshing: false, targetsErrorKind: kind, targetsErrorText: text });
      } else if (that.data.activeType === 1) {
        that.setData({ clubs: [], targetsState: kind === 'permission' ? 'permission' : 'error', targetsRefreshing: false, targetsErrorKind: kind, targetsErrorText: text });
      } else {
        that.setData({ merchants: [], targetsState: kind === 'permission' ? 'permission' : 'error', targetsRefreshing: false, targetsErrorKind: kind, targetsErrorText: text });
      }
    };
    if (this.data.activeType === 1) {
      // 后端 /api/merchant/clubs 是 @RequestBody 端点,必须发 JSON;缺 header 会被当 urlencoded 导致列表加载不出
      // (@RequestBody(required=false) 不豁免:Content-Type 存在即走转换器,照样 415)
      app.sendRequest({
        hideLoading: true, silentError: true, url: '/api/merchant/clubs', method: 'POST',
        data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
        success(res) {
          if (res.code != '200' || !isNamedRecordList(res.data, 'id')) { fail(res); return; }
          if (!settle()) return;
          that._targetsLoadedScope = scope;
          that.setData({ clubs: res.data, targetsState: 'ready', targetsRefreshing: false, targetsErrorKind: '', targetsErrorText: '' });
        },
        fail(value) { fail(value); },
      });
    } else {
      // 后端 /api/club/merchants 是 @RequestBody 端点,必须发 JSON;缺 header 会被当 urlencoded 导致列表加载不出
      app.sendRequest({
        hideLoading: true, silentError: true, url: '/api/club/merchants', method: 'POST',
        data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
        success(res) {
          if (res.code != '200' || !isNamedRecordList(res.data, 'memberId')) { fail(res); return; }
          if (!settle()) return;
          that._targetsLoadedScope = scope;
          that.setData({ merchants: res.data, targetsState: 'ready', targetsRefreshing: false, targetsErrorKind: '', targetsErrorText: '' });
        },
        fail(value) { fail(value); },
      });
    }
  },

  retryTopics() { this.loadMyTopics(true); },
  retryTargets() { this.loadTargets(true); },

  sendInvite() {
    if (this.data.submitting) return;
    if (this.data.topicsState !== 'ready' || this.data.targetsState !== 'ready') {
      toast('请先恢复主题与合作对象列表');
      return;
    }
    if (!this.data.topicId) {
      toast('请先选择关联主题');
      return;
    }
    if (this.data.topicClosed) {
      toast(RECRUIT_CLOSED_TEXT);
      return;
    }
    if (!this.data.selected.length) {
      toast('请先勾选邀请对象');
      return;
    }
    if (Number(this.data.shareMode) === 2
        && !(Number.isFinite(Number(this.data.fixedFee)) && Number(this.data.fixedFee) > 0)) {
      toast('固定合作费用必须大于 0');
      return;
    }
    // 授权:发起方后续会收到「邀约状态变更」通知(对方接受/拒绝)。须在点击手势内请求。
    subscribe.request(['coopStatus']).then((result) => {
      this._coopStatusSubscribeStatus = result.status;
    });
    const targetText = this.data.selected.length === 1
      ? this.data.selected[0].name
      : (this.data.selected[0].name + ' 等 ' + this.data.selected.length + ' 个对象');
    const firstTarget = this.data.selected[0] || {};
    // CU-M-98:确认弹层里这条条款必须和表单里读到的一模一样,单位尤其不能省
    const terms = feeTerms(this.data.activeType);
    const termsText = this.data.shareMode === 2
      ? (terms.feeName + ' · ¥' + Number(this.data.fixedFee || 0).toFixed(2) + ' ' + terms.feeUnit)
      : '引流合作 · 不产生现金结算';
    this.setData({
      inviteModal: {
        show: true,
        targetText: targetText,
        targetLogo: firstTarget.logo || '',
        targetMeta: firstTarget.meta || (this.data.activeType === 1 ? '俱乐部合作对象' : '商家合作对象'),
        termsText: termsText,
      },
      sendResult: '',
      sendReceipt: '',
    });
  },

  closeInviteModal() { if (!this._submitting) this.setData({ 'inviteModal.show': false }); },

  goNearby() { this._navigateTo('/pages/coop/nearby/index'
    + (this.data.topicId ? '?topicId=' + this.data.topicId
      + '&topicName=' + encodeURIComponent(this.data.topicName || '')
      + (this.data.operationScope ? '&scope=MERCHANT' : '') : '')); },

  goCreateTopic() {
    this._navigateTo('/pages/publish/fabu/index'
      + (this.data.operationScope ? '?scope=MERCHANT' : ''));
  },

  // 发送被驳时的出路:票价与主题内容都在专业编辑器里改,保存后回主题工作台再重发邀约
  goEditTopic() {
    if (!this.data.topicId) return;
    this.setData({ 'inviteModal.show': false });
    this._navigateTo('/pages/publish/fabu/index?id=' + this.data.topicId
      + (this.data.operationScope ? '&scope=MERCHANT' : ''));
  },

  confirmInvite() {
    if (this._submitting) return;
    if (Number(this.data.shareMode) === 2
        && !(Number.isFinite(Number(this.data.fixedFee)) && Number(this.data.fixedFee) > 0)) {
      this.setData({ 'inviteModal.show': false });
      toast('固定合作费用必须大于 0');
      return;
    }
    const targets = this.data.selected.slice();
    if (!targets.length) return;
    const that = this;
    const okNames = [];
    const failed = [];
    const failedTargets = [];
    const submitScope = this._submitScope();
    const submitEpoch = (this._submitEpoch || 0) + 1;
    this._submitEpoch = submitEpoch;
    this._submitting = true;
    let recruitClosed = false;
    that.setData({ submitting: true, sendResult: '', sendReceipt: '', sendRecruitClosed: false });

    function isCurrent() {
      return submitEpoch === that._submitEpoch && submitScope === that._submitScope();
    }

    function step(i) {
      if (!isCurrent()) return;
      if (i >= targets.length) return finish();
      const target = targets[i];
      app.sendRequest({
        url: '/api/coop/invite', method: 'POST',
        data: JSON.stringify(that._invitePayload(target.toId)),
        header: { 'Content-Type': 'application/json' },
        success(res) {
          if (!isCurrent()) return;
          if (res && res.code == '200') okNames.push(target.name);
          else {
            const msg = (res && res.msg) || '发起失败';
            // RecruitmentWindowPolicy 的拒绝原文带内部字段(lifecycle/recruitDeadline),且改票价救不回来。
            const closed = /^招商写入已关闭/.test(msg);
            if (closed) recruitClosed = true;
            failed.push(target.name + ':' + (closed ? RECRUIT_CLOSED_TEXT : msg));
            failedTargets.push(target);
          }
        },
        fail(value) {
          if (!isCurrent()) return;
          failed.push(target.name + ':' + failureText(value, '发起失败'));
          failedTargets.push(target);
        },
        complete() { step(i + 1); }
      });
    }

    function finish() {
      if (!isCurrent()) return;
      that._submitting = false;
      that.setData({ submitting: false });
      if (!failed.length) {
        const receipt = '已发起 ' + okNames.length + ' 条,等待对方确认';
        const one = okNames.length === 1 ? okNames[0] : (okNames.length + ' 个对象');
        const toClub = that.data.activeType === 1;
        // 结果面板取代原来的 toast + 800ms 硬等:跳转改挂在面板收掉之后,
        // 时长归面板一处管,不再有「toast 还没读完就跳走」这种两个数字各说各话。
        that.setData({
          'inviteModal.show': false,
          sendReceipt: receipt,
          resultSheet: {
            show: true, kind: 'success', title: '协作邀请已发送',
            sub: '已发给「' + one + '」,对方接受后即可' + (toClub ? '带团' : '承接站点') + '。',
            meta: that.data.topicName ? ('关联主题 · ' + that.data.topicName) : '',
            pill: '等待对方确认', why: '', primaryText: '', secondaryText: '', duration: RESULT_SHEET_MS,
          },
        });
        return;
      }
      that._setSelected(failedTargets);
      /* 失败不关邀约弹层 —— 里面已经被置成「待重试 N 个对象」,那是重试出口。
         结果面板叠在它上面只负责把这一刻讲清楚,2s 后自己收掉,正好露出待重试态。
         页内 sendResult 仍然是持久的那份,面板消失后它还在。 */
      that.setData({
        resultSheet: {
          show: true, kind: 'fail', title: '邀请没发出去',
          sub: recruitClosed ? '这个主题现在不在招商期,重试也发不出去;换一个招商中的主题再发。' : '协作邀请未能送达,可以直接重试。',
          meta: that.data.topicName ? ('关联主题 · ' + that.data.topicName) : '',
          pill: '', why: failed[0] || '服务暂时不可用,请稍后重试。',
          primaryText: '', secondaryText: '', duration: RESULT_SHEET_MS,
        },
      });
      that.setData({
        'inviteModal.targetText': failedTargets.length === 1 ? failedTargets[0].name : ('待重试 ' + failedTargets.length + ' 个对象'),
        'inviteModal.targetLogo': failedTargets[0] && failedTargets[0].logo || '',
        'inviteModal.targetMeta': failedTargets[0] && failedTargets[0].meta || (that.data.activeType === 1 ? '俱乐部合作对象' : '商家合作对象'),
        sendResult: (okNames.length ? '已发起 ' + okNames.length + ' 条;' : '') + '失败:' + failed.join('、'),
        sendRecruitClosed: recruitClosed,
      });
    }

    step(0);
  },

  /* 面板收掉才跳走(成功态)。失败态收掉只是露出仍开着的邀约弹层,不跳。 */
  onResultSheetClose() {
    const wasSuccess = this.data.resultSheet.kind === 'success';
    this.setData({ 'resultSheet.show': false });
    // CU-C-85:刚发出的邀约在「我发出的」;原来落到默认的「收到的」,看不到新卡就以为没发出去、再发一遍。
    // redirectTo 顶掉本页:从协作列表进来时 navigateTo 会叠成 列表→邀约→列表,一返回又是填好的邀约页,照样能重发。
    if (wasSuccess) wx.redirectTo({ url: '/pages/coop/list/index?tab=sent' });
  },

  _navigateTo(url) {
    if (this._navigating) return;
    this._navigating = true;
    wx.navigateTo({ url: url, complete: () => { this._navigating = false; } });
  },

  _invitePayload(toId) {
    const data = this.data;
    // 即使运行时 data 被篡改，也只允许生成现役 type0/type1 payload。
    const inviteType = Number(data.activeType) === 0 ? 0 : 1;
    const shareMode = Number(data.shareMode) === 2 ? 2 : 0;
    const defMsg = inviteType === 1 ? '邀请贵俱乐部来参加活动' : '邀请贵店承接本主题合作';
    const payload = {
      inviteType: inviteType,
      toType: inviteType === 1 ? 'club' : 'merchant',
      toId: toId,
      topicId: data.topicId,
      shareMode: shareMode,
      message: data.message || defMsg
    };
    if (data.operationScope) payload.scope = data.operationScope;
    if (inviteType === 1 && this.data.originApplyId) payload.originApplyId = this.data.originApplyId;
    if (shareMode === 2) payload.fixedFee = data.fixedFee;
    return payload;
  },

});
