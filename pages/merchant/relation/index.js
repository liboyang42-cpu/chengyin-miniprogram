const toast = require('../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { normalizeRelationHome } = require('../utils/merchant-aggregate.js');
const { merchantHomeUrl } = require('../../../utils/merchant-home-link.js');
const { ensureSession } = require('../utils/session/ensure-session.js');
// CU-M-61:品类名取法与发现页共用一份(utils/category-icon.js),两页不再各写一套。
const { firstCategoryName } = require('../../../utils/category-icon.js');

function textOrDash(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback || '—';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return fallback || '—';
}

function assetUrl(value) {
  return typeof value === 'string' && value.trim() ? app.getImgUrl(value.trim()) : '';
}

function hasPositiveId(value) {
  const number = Number(value);
  return (typeof value === 'number' || typeof value === 'string')
    && Number.isInteger(number) && number > 0;
}

function resolveAccessFailure(res, status) {
  const candidates = [status, res && res.statusCode, res && res.code];
  for (let index = 0; index < candidates.length; index += 1) {
    const code = String(candidates[index] == null ? '' : candidates[index]);
    if (code === '401' || code === '2') return 'anonymous';
    if (code === '403') return 'denied';
  }
  return '';
}

function normalizeDiscoveryItem(item, typeName) {
  if (!item || typeof item !== 'object' || !hasPositiveId(item.id)) return null;
  if (typeName === '商家' && !hasPositiveId(item.memberId)) return null;
  const displayName = typeof item.name === 'string' ? item.name.trim() : textOrDash(item.name);
  if (!displayName || displayName === '—') return null;
  // 2026-08-20 卡片重设计:distance 后端回米;俱乐部 logo/cover 与 talent/list 同口径走 getImgUrl
  let distanceText = '';
  if (item.distance != null && isFinite(item.distance) && Number(item.distance) >= 0) {
    distanceText = item.distance < 1000
      ? Math.round(item.distance) + 'm'
      : (item.distance / 1000).toFixed(1) + 'km';
  }
  const displayStatus = item.businessStatus === 0 || item.businessStatus === '0'
    ? 'closed' : (item.businessStatus === 1 || item.businessStatus === '1' ? 'open' : 'none');
  const displayLocationVerified = item.locationVerified === 1 || item.locationVerified === '1'
    ? 1 : (item.locationVerified === 0 || item.locationVerified === '0' ? 0 : null);
  // CU-M-61:品类名以前读 item.categoryName —— 这一路后端只给 categoryId(数字外键),那个键永远是 undefined,
  // 于是无封面的商家卡不分书店花店,全显示同一只咖啡杯。现在按发现页同一份取法读 sysCategoryList。
  const categoryName = firstCategoryName(item);
  return Object.assign({}, item, {
    displayName,
    categoryName,
    displayDescription: textOrDash(item.address || categoryName || item.city, `查看${typeName}资料`),
    distanceText,
    displayStatus,
    displayLocationVerified,
    logoUrl: assetUrl(item.logo),
    coverUrl: assetUrl(typeName === '商家' ? item.coverImage : item.cover),
  });
}

function normalizeDiscoveryList(items, typeName) {
  const rows = items.map(item => normalizeDiscoveryItem(item, typeName)).filter(Boolean);
  return {
    rows,
    error: rows.length === items.length ? '' : `部分${typeName}资料暂无法显示`,
  };
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,   // 胶囊行高:cy-nav-bar 是 fixed,页面按 status+nav 让位
    refreshing: false,
    pageState: 'idle',
    error: '',
    merchantError: '',
    clubError: '',
    tabs: [{ key: 'merchant', label: '商家' }, { key: 'club', label: '俱乐部' }],
    activeTab: 'merchant',
    merchants: [],
    clubs: [],
    // 从项目详情「找俱乐部」进来时带着主题:一路带到俱乐部主页,
    // 在那儿发起合作时主题已经定了,不用再选一遍
    topicId: '',
    topicName: '',
  },

  onLoad(options) {
    this._destroyed = false;
    this._requestEpoch = 0;
    this._relationLoading = false;
    this._hasLoaded = false;
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: sys.statusBarHeight || 20,
      navBarHeight: (getApp().globalData && getApp().globalData.navBarHeight) || 44,
      activeTab: (options && options.tab === 'club') ? 'club' : this.data.activeTab,
      topicId: (options && options.topicId) || '',
      topicName: (options && options.topicName) ? decodeURIComponent(options.topicName) : '',
    });
    this.enterRelation(false);
  },

  // 入口:未登录先静默登录,成功自动加载;失败只留页内错误态(重试走 loadRelationHome)。
  enterRelation(authRetryUsed) {
    this._authRetryUsed = authRetryUsed === true;
    if (app.getUserID()) {
      this.loadRelationHome();
      return;
    }
    this.setData({ pageState: 'loading', error: '' });
    const that = this;
    ensureSession(app).then(function (ok) {
      if (that._destroyed) return;
      if (!ok || !app.getUserID()) {
        that.setData({ pageState: 'error', error: '登录失败，请重试', merchants: [], clubs: [] });
        return;
      }
      that.enterRelation(that._authRetryUsed);
    });
  },

  // 页内错误态上的「重新加载」:用户主动重试要重置自动重登次数,再走一遍入口链路。
  retryRelation() {
    this._authRetryUsed = false;
    this.enterRelation(false);
  },

  // 401:静默重登一次后自动重载;重登失败落页内错误态,不整屏「去登录」。
  recoverSession() {
    if (this._destroyed) return;
    if (this._authRetryUsed) {
      this.setData({ pageState: 'error', error: '登录已失效，请重新登录', merchants: [], clubs: [] });
      return;
    }
    this._authRetryUsed = true;
    const that = this;
    ensureSession(app).then(function (ok) {
      if (that._destroyed) return;
      if (!ok) {
        that.setData({ pageState: 'error', error: '登录失败，请重试', merchants: [], clubs: [] });
        return;
      }
      that._hasLoaded = false;
      that.loadRelationHome();
    });
  },

  onTabChange(e) {
    const key = e.detail && e.detail.key;
    if (key === 'merchant' || key === 'club') this.setData({ activeTab: key });
  },

  loadRelationHome() {
    if (this._destroyed || this._relationLoading) return;
    const that = this;
    const hasLoaded = this._hasLoaded;
    const epoch = ++this._requestEpoch;
    this._relationLoading = true;
    that.setData({
      refreshing: hasLoaded,
      pageState: hasLoaded ? 'ready' : 'loading',
      error: '',
    });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/relation-home',
      method: 'POST',
      data: JSON.stringify({ limit: 10 }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (that._destroyed || epoch !== that._requestEpoch) return;
        const home = (res && (res.code === '200' || res.code === 200))
          ? normalizeRelationHome(res.data) : null;
        if (!home) {
          that.applyLoadError(res);
          return;
        }
        const merchantResult = normalizeDiscoveryList(home.merchants, '商家');
        const clubResult = normalizeDiscoveryList(home.clubs, '俱乐部');
        that._hasLoaded = true;
        that.setData({
          merchants: merchantResult.rows,
          clubs: clubResult.rows,
          merchantError: merchantResult.error,
          clubError: clubResult.error,
          pageState: 'ready',
          error: '',
        });
      },
      fail(res, status) {
        if (that._destroyed || epoch !== that._requestEpoch) return;
        that.applyLoadError(res, status);
      },
      successStatusAbnormal(res, status) {
        if (that._destroyed || epoch !== that._requestEpoch) return;
        that.applyLoadError(res, status);
      },
      complete() {
        if (epoch !== that._requestEpoch) {
          if (that._destroyed && that._pullRefreshing) {
            that._pullRefreshing = false;
            wx.stopPullDownRefresh();
          }
          return;
        }
        that._relationLoading = false;
        if (that._pullRefreshing) {
          that._pullRefreshing = false;
          wx.stopPullDownRefresh();
        }
        if (that._destroyed) {
          return;
        }
        that.setData({ refreshing: false });
      },
    });
  },

  applyLoadError(res, status) {
    const accessFailure = resolveAccessFailure(res, status);
    if (accessFailure === 'anonymous') {
      this._hasLoaded = false;
      this.recoverSession();
      return;
    }
    if (accessFailure === 'denied') {
      this._hasLoaded = false;
      this.setData({ merchants: [], clubs: [], merchantError: '', clubError: '' });
      // 没有商家身份的账号本没有合作入口;深链误入就静默回会员中心,不摆整屏闸。
      wx.switchTab({ url: '/pages/member/index/index' });
      return;
    }
    // 有旧内容时刷新失败静默降级:退回 ready 让旧列表留在屏上,不挂横幅、不切整页错误。
    if (this._hasLoaded) {
      this.setData({
        pageState: 'ready',
      });
      return;
    }
    this.setData({
      pageState: 'error',
      error: app.getRequestErrorMessage(res, '合作数据加载失败'),
      merchants: [],
      clubs: [],
      merchantError: '',
      clubError: '',
    });
  },

  onPullDownRefresh() {
    if (this._relationLoading) {
      wx.stopPullDownRefresh();
      return;
    }
    this._pullRefreshing = true;
    this.loadRelationHome();
  },

  // 公开投影带 memberId(relation-home.discovery.merchants),直接进统一主页的「关于」
  goMerchant(e) {
    const url = merchantHomeUrl(e.currentTarget.dataset.memberid);
    if (url) wx.navigateTo({ url: url });
    else toast('该商家暂不可查看');
  },

  goClub(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    let url = '/pages/club/detail/index?id=' + id;
    if (this.data.topicId) {
      url += '&topicId=' + this.data.topicId
        + '&topicName=' + encodeURIComponent(this.data.topicName || '');
    }
    wx.navigateTo({ url: url + '&scope=MERCHANT' });
  },

  // 卡上按钮写「发起合作」就要直达邀约表单(CU-M-97);看资料仍走整卡 goClub → 俱乐部主页。
  // 与 club/detail goClubCoop 同参数,coop/invite 收到 presetTarget 后跳过选对象那一步。
  goClubCoop(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const club = (this.data.clubs || []).filter(function (c) {
      return String(c.id) === String(id);
    })[0];
    const metaParts = [];
    if (club) {
      if (club.memberCount != null) metaParts.push(club.memberCount + ' 位成员');
      if (club.city) metaParts.push(club.city);
    }
    let url = '/pages/coop/invite/index?type=1&toId=' + id + '&scope=MERCHANT';
    if (club && club.displayName) url += '&toName=' + encodeURIComponent(club.displayName);
    if (club && club.logoUrl) url += '&toLogo=' + encodeURIComponent(club.logoUrl);
    if (metaParts.length) url += '&toMeta=' + encodeURIComponent(metaParts.join(' · '));
    if (this.data.topicId) {
      url += '&topicId=' + this.data.topicId;
      if (this.data.topicName) url += '&topicName=' + encodeURIComponent(this.data.topicName);
    }
    wx.navigateTo({ url: url });
  },

  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._destroyed = true;
    this._requestEpoch += 1;
    this._relationLoading = false;
    merchantTheme.merchantPageRestore();
  },
});
