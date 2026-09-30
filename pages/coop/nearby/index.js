const toast = require('../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { merchantHomeUrl } = require('../../../utils/merchant-home-link.js');

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

function stopPullDownRefresh() {
  if (typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh();
}

function positiveTopicId(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeText(value) {
  try { return decodeURIComponent(value || ''); } catch (e) { return String(value || ''); }
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validChapterNames(value) {
  return value == null || (Array.isArray(value) && value.every(nonEmptyText));
}

function validNearbyRow(row) {
  return !!(row && typeof row === 'object' && !Array.isArray(row)
    && nonEmptyText(row.name)
    && ((row.memberId != null && row.memberId !== '') || (row.id != null && row.id !== ''))
    && validChapterNames(row.chapterNames));
}

function validInvitableRow(row) {
  return !!(row && typeof row === 'object' && !Array.isArray(row)
    && row.memberId != null && row.memberId !== ''
    && nonEmptyText(row.name)
    && nonEmptyText(row.chapterName)
    && validChapterNames(row.chapterNames));
}

function isLocationPermissionFailure(value) {
  const message = String(value && value.errMsg || '');
  return /auth deny|authorize|permission denied|权限|拒绝授权/i.test(message);
}

/**
 * 找商家(原「附近商家」)。
 *
 * 2026-08-10 合并:原先「邀请商家承接」(coop/chapter-invite)与本页是两个页面 ——
 * 一个按章节品类列可承接的商家、一个按地理列附近的商家,主办方要在两处找同一批人。
 * 现在合成一份名单,统一按直线距离从近到远排,「可承接 X 章节」降为行内副标题。
 *
 * 行内不再直接发邀请:动线是「项目详情 → 商家名单 → 商家主页 → 发起合作」,
 * 发起合作要看得到对方的承接档案再决定。电话联系留在行内 —— 那是联系未入驻商家,
 * 不是合作。
 */
Page({
  data: {
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    merchants: [],
    pageState: 'loading',
    pageTitle: '附近商家',
    refreshing: false,
    refreshErrorKind: '',
    refreshErrorText: '',
    errorKind: '',
    errorText: '',
    actionPendingKey: '',
    actionReceipt: '',
    actionError: '',
    // 从某个项目页进来时带着主题,进商家主页后发起合作不用再选一遍
    topicId: '',
    topicName: '',
    operationScope: '',
  },

  onShow() {
    merchantTheme.merchantPageShow();
    const currentIdentity = identityKey();
    if (this._dataIdentity !== undefined && this._dataIdentity !== currentIdentity) {
      this._invalidateRequests();
      this._loadedScope = '';
      this.setData({ merchants: [], pageState: 'loading', refreshing: false });
      this.locate();
    }
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._invalidateRequests();
    this._actionPendingKey = '';
    this._navigating = false;
    merchantTheme.merchantPageRestore();
  },

  // 页内隐私弹窗:没有它 app.js 会回退到 navigateTo(/pages/privacy/index),

  // 把本页整个盖住 —— 审计里那批「route 回读为隐私页、节点数 0」就是这么来的。

  showPrivacyGate() {

    this.setData({ privacyGateShow: true });

  },

  onPrivacyGateSettled() {

    this.setData({ privacyGateShow: false });

  },


  onLoad(options) {
    const hasTopicParam = !!(options && Object.prototype.hasOwnProperty.call(options, 'topicId'));
    const parsedTopicId = hasTopicParam ? positiveTopicId(options.topicId) : null;
    if (hasTopicParam && parsedTopicId == null) {
      this.setData({
        topicId: '', topicName: decodeText(options.topicName), pageTitle: '找商家承接',
        pageState: 'missing-param', errorKind: 'missing-param', errorText: '主题参数无效，无法查询可承接商家',
      });
      return;
    }
    const topicId = parsedTopicId == null ? '' : String(parsedTopicId);
    this.setData({
      topicId: topicId,
      topicName: (options && options.topicName) ? decodeText(options.topicName) : '',
      operationScope: options && options.scope === 'MERCHANT' ? 'MERCHANT' : '',
      pageTitle: topicId ? '找商家承接' : '附近商家',
    });
    this.locate();
  },

  onPullDownRefresh() { this.locate(); },

  _scope() { return String(this.data.topicId || '') + '|' + identityKey(); },

  _invalidateRequests() {
    this._locationEpoch = (this._locationEpoch || 0) + 1;
    this._fetchEpoch = (this._fetchEpoch || 0) + 1;
    this._locating = false;
    this._fetching = false;
  },

  _setFailure(value, hadSnapshot) {
    const kind = failureKind(value);
    const text = failureText(value, '附近商家没加载出来');
    if (kind === 'permission') {
      this._loadedScope = '';
      this.setData({
        merchants: [], pageState: 'permission', refreshing: false,
        refreshErrorKind: '', refreshErrorText: '', errorKind: kind, errorText: text,
      });
      return;
    }
    if (hadSnapshot) {
      this.setData({
        pageState: 'ready', refreshing: false,
        refreshErrorKind: kind, refreshErrorText: text,
      });
      return;
    }
    this.setData({
      pageState: kind === 'permission' ? 'permission' : 'error', refreshing: false,
      errorKind: kind, errorText: text,
    });
  },

  locate() {
    const that = this;
    if (this.data.pageState === 'missing-param') {
      stopPullDownRefresh();
      return;
    }
    const scope = this._scope();
    if (this._locating && this._locationScope === scope) {
      stopPullDownRefresh();
      return;
    }
    if (this._locating || this._fetching) this._invalidateRequests();
    this._locating = true;
    this._locationScope = scope;
    this._dataIdentity = identityKey();
    const epoch = (this._locationEpoch || 0) + 1;
    this._locationEpoch = epoch;
    const hadSnapshot = this._loadedScope === scope;
    this.setData({
      pageState: hadSnapshot ? 'ready' : 'loading', refreshing: hadSnapshot,
      refreshErrorKind: '', refreshErrorText: '', errorKind: '', errorText: '',
    });
    wx.getLocation({
      type: 'gcj02',
      success(res) {
        if (epoch !== that._locationEpoch || scope !== that._scope()) return;
        that._locating = false;
        that.fetch(res.longitude, res.latitude);
      },
      fail(value) {
        if (epoch !== that._locationEpoch || scope !== that._scope()) return;
        that._locating = false;
        const failure = isLocationPermissionFailure(value)
          ? Object.assign({}, value, { code: 403, msg: '需要定位权限才能找附近商家' })
          : Object.assign({}, value, { msg: '定位服务暂时不可用，请稍后重试' });
        that._setFailure(failure, hadSnapshot);
        stopPullDownRefresh();
      },
    });
  },

  fetch(lng, lat) {
    const that = this;
    const scope = this._scope();
    if (this._fetching && this._fetchScope === scope) return;
    if (this._fetching) this._fetchEpoch = (this._fetchEpoch || 0) + 1;
    this._fetching = true;
    this._fetchScope = scope;
    const epoch = (this._fetchEpoch || 0) + 1;
    this._fetchEpoch = epoch;
    const hadSnapshot = this._loadedScope === scope;
    this.setData({
      pageState: hadSnapshot ? 'ready' : 'loading', refreshing: hadSnapshot,
      refreshErrorKind: '', refreshErrorText: '', errorKind: '', errorText: '',
    });
    // 带主题时两份名单都要:附近(含未入驻,可电话)+ 可承接章节的同品类商家。
    // 后者可能落在 5km 外,不能只取附近那份。
    const jobs = [this.fetchNearby(lng, lat)];
    if (this.data.topicId) jobs.push(this.fetchInvitable(lng, lat));
    Promise.all(jobs).then(function (parts) {
      if (epoch !== that._fetchEpoch || scope !== that._scope()) return;
      that._fetching = false;
      stopPullDownRefresh();
      // fail-closed:任一份挂了都判错误。少一份就少一批商家,
      // 渲染成「附近就这么几家」= 用空态冒充失败态,主办方会以为真没人可邀。
      const failure = parts.find(function (part) { return !part.ok; });
      if (failure) {
        that._setFailure(failure.value, hadSnapshot);
        return;
      }
      const list = that.merge(parts[0].rows, parts[1] ? parts[1].rows : []);
      that._loadedScope = scope;
      that.setData({
        merchants: list, pageState: 'ready', refreshing: false,
        refreshErrorKind: '', refreshErrorText: '', errorKind: '', errorText: '',
      });
    });
  },

  fetchNearby(lng, lat) {
    return new Promise(function (resolve) {
      app.sendRequest({
        hideLoading: true, silentError: true,
        url: '/api/merchant/nearby',
        method: 'POST',
        data: { longitude: lng, latitude: lat, radius: 5000, limit: 30 },
        success(res) {
          if (res.code != '200' || !Array.isArray(res.data) || !res.data.every(validNearbyRow)) {
            return resolve({ ok: false, value: res });
          }
          resolve({ ok: true, rows: res.data });
        },
        fail(value) { resolve({ ok: false, value: value || {} }); },
      });
    });
  },

  fetchInvitable(lng, lat) {
    const topicId = this.data.topicId;
    const that = this;
    return new Promise(function (resolve) {
      const payload = that.data.operationScope
        ? { topicId: Number(topicId), longitude: lng, latitude: lat, scope: that.data.operationScope }
        : { topicId: Number(topicId), longitude: lng, latitude: lat };
      app.sendRequest({
        hideLoading: true, silentError: true,
        url: '/api/merchant/chapter-application/invitable',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: JSON.stringify(payload),
        success(res) {
          if (res.code != '200' || !Array.isArray(res.data) || !res.data.every(validInvitableRow)) {
            return resolve({ ok: false, value: res });
          }
          resolve({ ok: true, rows: res.data });
        },
        fail(value) { resolve({ ok: false, value: value || {} }); },
      });
    });
  },

  /**
   * 一行一商家:同一商家在 invitable 里可能匹配到多个章节,聚合成 chapterText。
   * 合并键用 memberId(未入驻商家没有 memberId,用 'lead-' + id 兜住,不会互相顶掉)。
   */
  merge(nearby, invitable) {
    const byKey = {};
    const order = [];
    const put = function (key, row) {
      if (!byKey[key]) { byKey[key] = row; order.push(key); return byKey[key]; }
      const exist = byKey[key];
      // 缺什么补什么:附近那份有电话/canCall,可承接那份有章节
      for (const k in row) {
        if (exist[k] == null || exist[k] === '') exist[k] = row[k];
      }
      return exist;
    };
    nearby.forEach(function (m) {
      const key = m.memberId ? 'm' + m.memberId : 'lead-' + m.id;
      put(key, Object.assign({}, m));
    });
    invitable.forEach(function (r) {
      const row = put('m' + r.memberId, Object.assign({}, r, { canInvite: true }));
      row.chapterNames = (row.chapterNames || []).concat([r.chapterName]);
    });
    const list = order.map(function (k) { return byKey[k]; });
    list.forEach(function (m) {
      m.distanceText = (m.distance != null) ? Math.round(m.distance) : null;
      m.chapterText = (m.chapterNames && m.chapterNames.length)
        ? '可承接 · ' + m.chapterNames.join('、') : '';
    });
    // 无距离(没坐标 / 不在附近半径内)一律垫底,不占前排
    list.sort(function (a, b) {
      if (a.distance == null && b.distance == null) return 0;
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });
    return list;
  },

  // 未注册/已注册商家均可直接拨号(canCall 时展示)
  callMerchant(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return;
    const key = 'call:' + phone;
    if (!this._beginAction(key)) return;
    wx.makePhoneCall({
      phoneNumber: String(phone),
      success: () => this._finishAction(key, '已打开拨号界面', ''),
      fail: (value) => this._finishAction(key, '', failureText(value, '电话暂时没有拨出')),
    });
  },

  /** 点整行进商家主页,合作在那儿发起 —— 先看承接档案再决定条款。
   *  未入驻的 lead 没有 memberId,也就没有主页主体,只能留电话这条路。 */
  openMerchant(e) {
    const url = merchantHomeUrl(e.currentTarget.dataset.memberid, {
      topicId: this.data.topicId, topicName: this.data.topicName,
      scope: this.data.operationScope,
    });
    if (!url) {
      toast('这家还没在平台建档，先电话联系');
      return;
    }
    if (this._navigating) return;
    this._navigating = true;
    wx.navigateTo({ url: url, complete: () => { this._navigating = false; } });
  },

  retry() {
    this.locate();
  },

  goBack() { wx.navigateBack({ fail() { wx.reLaunch({ url: '/pages/merchant/index/index' }); } }); },

  openLocationSettings() {
    const key = 'location-settings';
    if (!this._beginAction(key)) return;
    wx.openSetting({
      success: () => {
        this._finishAction(key, '定位设置已更新，正在重试', '');
        this.locate();
      },
      fail: (value) => this._finishAction(key, '', failureText(value, '设置暂时没打开，请稍后重试')),
    });
  },

  _beginAction(key) {
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
});
