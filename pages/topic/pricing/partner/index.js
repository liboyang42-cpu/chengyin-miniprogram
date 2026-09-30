// 定价页 · 合作方详情(阵容锁定后只读查看)
const toast = require('../../../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');
const { merchantHomeUrl } = require('../../../../utils/merchant-home-link.js');
const { readReducedMotion } = require('../../../../utils/motion-preference.js');

function termsFootnote(shareMode) {
  if (shareMode === 1) return '开售后条款冻结，按实际票款参与分成结算。';
  if (shareMode === 2) return '开售后条款冻结，按实际核销人头结算。';
  return '开售后阵容冻结；引流型合作不产生现金分成。';
}

function positiveInteger(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizedTerms(item) {
  if (!item || typeof item !== 'object') return null;
  const shareMode = Number(item.shareMode);
  if (![0, 1, 2].includes(shareMode)) return null;
  if (shareMode === 1) {
    const shareRate = Number(item.shareRate);
    if (item.shareRate == null || item.shareRate === '' || !Number.isFinite(shareRate)
        || shareRate < 0 || shareRate > 100) return null;
    return { shareMode: 1, shareRate: item.shareRate, fixedFee: '' };
  }
  if (shareMode === 2) {
    const fixedFee = Number(item.fixedFee);
    if (item.fixedFee == null || item.fixedFee === '' || !Number.isFinite(fixedFee) || fixedFee < 0) return null;
    return { shareMode: 2, shareRate: '', fixedFee: item.fixedFee };
  }
  return { shareMode: 0, shareRate: '', fixedFee: '' };
}

function requestError(error, fallback) {
  return app.getRequestErrorMessage ? app.getRequestErrorMessage(error, fallback) : fallback;
}

function displayText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(displayText).filter(Boolean).join(' · ');
  if (typeof value === 'object') {
    return displayText(value.name || value.title || value.label || value.address || value.categoryName);
  }
  return String(value).trim();
}

function buildClubDetails(c) {
  const items = [];
  if (displayText(c.description)) items.push({ block: true, v: displayText(c.description) });
  if (displayText(c.leaderName)) items.push({ k: '主理人', v: displayText(c.leaderName) });
  if (displayText(c.city || c.address)) items.push({ k: '所在城市', v: displayText(c.city || c.address) });
  if (displayText(c.clubType)) items.push({ k: '俱乐部类型', v: displayText(c.clubType) });
  if (displayText(c.memberCount)) items.push({ k: '成员数', v: displayText(c.memberCount) + ' 人' });
  if (displayText(c.levelText)) items.push({ k: '等级', v: displayText(c.levelText) });
  return items;
}

function buildMerchantDetails(m) {
  const items = [];
  if (displayText(m.description)) items.push({ block: true, v: displayText(m.description) });
  const cats = (m.sysCategoryList || []).map(function (c) { return displayText(c.categoryName); }).filter(Boolean).join(' · ');
  if (cats) items.push({ k: '品类', v: cats });
  if (displayText(m.capacity)) items.push({ k: '可容纳', v: displayText(m.capacity) + ' 人' });
  if (displayText(m.suitActivityTypes)) items.push({ k: '适合路线', v: displayText(m.suitActivityTypes) });
  if (displayText(m.availableTime)) items.push({ k: '可承接时段', v: displayText(m.availableTime) });
  if (m.chargeType != null) items.push({ k: '收费方式', v: m.chargeType == 1 ? '收费承接' : '免费承接' });
  if (displayText(m.demand)) items.push({ k: '合作诉求', v: displayText(m.demand) });
  if (displayText(m.businessTime)) items.push({ k: '营业时间', v: displayText(m.businessTime) });
  if (displayText(m.address)) items.push({ k: '门店地址', v: displayText(m.address), link: !!(m.latitude && m.longitude) });
  return items;
}

Page({
  data: {
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    reducedMotion: false,
    toType: '',
    toId: null,
    pageTitle: '合作方',
    shareMode: '',
    shareRate: '',
    fixedFee: '',
    termsFootnote: '',
    name: '',
    detailItems: [],
    merchant: null,
    loaded: false,
    invalidLink: false,
    loadError: '',
  },

  onLoad(options) {
    options = options || {};
    const toType = options.toType === 'club' || options.toType === 'merchant' ? options.toType : '';
    const toId = positiveInteger(options.toId);
    const topicId = positiveInteger(options.topicId);
    const pageTitle = toType === 'club' ? '合作俱乐部' : (toType === 'merchant' ? '承接商家' : '合作方');
    // 返回链路只需原始入参;请求参数一律走校验后的 _topicId,两者都不进响应式 data。
    this.topicId = options.topicId || null;
    this._topicId = topicId;
    this.setData({
      toType: toType,
      toId: toId,
      pageTitle: pageTitle,
    });
    if (!toType || !toId || !topicId) {
      this.setData({
        invalidLink: true,
        loaded: true,
        loadError: '合作链接无效或已失效，请从主题定价页重新进入。',
      });
      return;
    }
    this.loadProfile();
  },

  onShow() {
    merchantTheme.merchantPageShow();
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._loadEpoch = (this._loadEpoch || 0) + 1;
    this._loadPending = false;
    merchantTheme.merchantPageRestore();
  },

  loadProfile() {
    if (this._loadPending || this.data.invalidLink) return;
    const toType = this.data.toType;
    const toId = this.data.toId;
    const topicId = this._topicId;
    if (!toType || !toId || !topicId) return;
    const epoch = (this._loadEpoch || 0) + 1;
    this._loadEpoch = epoch;
    this._loadPending = true;
    this.setData({ loaded: false, loadError: '' });

    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/topic/pricing/preview',
      method: 'POST',
      data: JSON.stringify({ topicId: topicId, subType: 'self' }),
      header: { 'Content-Type': 'application/json' },
      success: (res) => {
        if (epoch !== this._loadEpoch) return;
        res = res || {};
        if (res.code != '200' || !res.data || !Array.isArray(res.data.lineup)) {
          this.finishLoad(epoch, {
            loadError: requestError(res, '合作条款加载失败，请稍后重试。'),
          });
          return;
        }
        const item = res.data.lineup.find(function (row) {
          return row && row.toType === toType && positiveInteger(row.toId) === toId;
        });
        if (!item) {
          this.finishLoad(epoch, { loadError: '该合作方不在当前主题的生效阵容中，条款无法展示。' });
          return;
        }
        const terms = normalizedTerms(item);
        if (!terms) {
          this.finishLoad(epoch, { loadError: '合作条款信息不完整，请稍后重试。' });
          return;
        }
        this.setData({
          shareMode: terms.shareMode,
          shareRate: terms.shareRate,
          fixedFee: terms.fixedFee,
          termsFootnote: termsFootnote(terms.shareMode),
        });
        this.loadPublicProfile(epoch);
      },
      fail: (error) => {
        this.finishLoad(epoch, {
          loadError: requestError(error, '合作条款加载失败，请稍后重试。'),
        });
      },
    });
  },

  loadPublicProfile(epoch) {
    const toType = this.data.toType;
    const toId = this.data.toId;
    const isClub = toType === 'club';
    const fallback = isClub
      ? '未能读取合作俱乐部资料，请稍后重试。'
      : '未能读取承接商家资料，请稍后重试。';
    const missingName = isClub
      ? '合作俱乐部资料缺少名称，请稍后重试。'
      : '承接商家资料缺少名称，请稍后重试。';

    app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: isClub ? '/api/club/detail' : '/api/merchant/public-detail',
        method: 'POST',
        data: JSON.stringify({ id: toId }),
        header: { 'Content-Type': 'application/json' },
        success: (res) => {
          if (epoch !== this._loadEpoch) return;
          res = res || {};
          const profile = res.data || {};
          const name = displayText(profile.name);
          if (res.code == '200' && name) {
            this.finishLoad(epoch, {
              name: name,
              detailItems: isClub ? buildClubDetails(profile) : buildMerchantDetails(profile),
              merchant: isClub ? null : profile,
              loadError: '',
            });
          } else {
            this.finishLoad(epoch, {
              loadError: res.code == '200' ? missingName : requestError(res, fallback),
            });
          }
        },
        fail: (error) => {
          this.finishLoad(epoch, { loadError: requestError(error, fallback) });
        },
      });
  },

  finishLoad(epoch, patch) {
    if (epoch !== this._loadEpoch) return;
    this._loadPending = false;
    this.setData({
      loaded: true,
      loadError: patch.loadError || '',
      name: patch.name || '',
      detailItems: patch.detailItems || [],
      merchant: patch.merchant || null,
    });
  },

  retryProfile() { this.loadProfile(); },

  goFullProfile() {
    const toType = this.data.toType;
    const toId = this.data.toId;
    if (!toId) return;
    if (toType === 'club') return wx.navigateTo({ url: '/pages/club/detail/index?id=' + toId });
    if (toType !== 'merchant') return;
    // toId 是 merchantId,统一主页要的是 memberId —— 只能用已加载的档案换,
    // 没加载成功就不放行(前端再补一次查询只会让入口更慢)。
    const url = merchantHomeUrl(this.data.merchant && this.data.merchant.memberId);
    if (url) wx.navigateTo({ url: url });
    else toast('商家资料还没加载好');
  },

  onDetailTap(e) {
    const idx = e.currentTarget.dataset.idx;
    const row = (this.data.detailItems || [])[idx];
    if (!row || !row.link) return;
    const m = this.data.merchant;
    if (!m || !m.latitude || !m.longitude) return;
    wx.openLocation({
      latitude: parseFloat(m.latitude),
      longitude: parseFloat(m.longitude),
      name: m.name || '商家',
      address: m.address || '',
      scale: 18,
    });
  },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    if (this.topicId) {
      wx.redirectTo({ url: '/pages/topic/pricing/index?topicId=' + this.topicId });
      return;
    }
    wx.switchTab({ url: '/pages/template/index' });
  },
});
