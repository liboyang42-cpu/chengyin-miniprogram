const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { normalizeMarketingHome } = require('../utils/merchant-aggregate.js');
const officialChannel = require('../../../utils/merchant-official-channel.js');
const { toTimestamp, chinaParts } = require('../../../utils/datetime.js');

// 稿 234:276 合作中心:tab = 官方活动 / 广场,右上角铃铛进协作邀请(收到的 / 我发出的)。
// 2026-09-15 用户裁决「全站只有收到的/我发出的两个入口」:原「邀约我的」tab 删除,
//   商家收到的协作邀约、俱乐部带队申请、官方邀约都在 pages/coop/list「收到的」处理;
//   原卡上「申请承接」挪到「看详情」(pages/topic/merchantinfo 有同一套章节申请 + chapter-node-form)。

const PRODUCT_TYPE_TEXT = { 1: '城市定向', 2: '自由探索' };
// 章节档位 CmsTopicChapter.termsMode;economics 口径见 MerchantAggregateReadServiceImpl.recruitTermsEconomics
const TERMS_MODE_TEXT = { PERK: '权益核销', REVSHARE: '分润计酬', TRAFFIC: '引流合作 · 无结算' };

function hasValue(value) {
  return (typeof value === 'string' || typeof value === 'number') && !!String(value).trim();
}

function monthDay(value) {
  const timestamp = toTimestamp(value);
  const parts = timestamp ? chinaParts(timestamp) : null;
  return parts ? parts.month + '月' + parts.day + '日' : '';
}

// 余席:remainingMerchantCount null = 不招商或不限名额(TopicMerchantCapacity 注释:调用方不得渲染成已满)→ 不写。
// 阈值:0 = 已满、1 = 最后一席(琥珀)、≥2 绿。1 是唯一「再有一家申请就关门」的值,与稿例 3→绿 / 1→琥珀一致。
function seatOf(remaining) {
  if (remaining == null || remaining === '' || !Number.isFinite(Number(remaining))) return { seatText: '', seatTone: '' };
  const n = Number(remaining);
  if (n <= 0) return { seatText: '已满', seatTone: 'tight' };
  return { seatText: '余 ' + n + ' 席', seatTone: n === 1 ? 'tight' : 'ok' };
}

function termsLine(item) {
  const modes = Array.isArray(item.termsModes) ? item.termsModes.filter((m) => TERMS_MODE_TEXT[m]) : [];
  if (modes.length !== 1) return modes.map((m) => TERMS_MODE_TEXT[m].split(' ·')[0]).join(' / ');
  const mode = modes[0];
  if (mode === 'PERK' && item.perkMinValue != null) return TERMS_MODE_TEXT.PERK + ' · 权益不低于 ¥' + item.perkMinValue;
  if (mode === 'REVSHARE' && item.maxPerHeadFee != null) return TERMS_MODE_TEXT.REVSHARE + ' · 人头费上限 ¥' + item.maxPerHeadFee + '/人次';
  return TERMS_MODE_TEXT[mode];
}

function routeCards(items) {
  return (items || []).filter((item) => item && hasValue(item.id) && hasValue(item.name)).map((item) => {
    const deadline = toTimestamp(item.recruitDeadline || item.merchantSignUpEndDate);
    const start = monthDay(item.startDate);
    const end = monthDay(item.endDate);
    const meta = [item.cityKeyword, item.locationCount ? item.locationCount + ' 站' : ''].filter(hasValue);
    return Object.assign({
      id: item.id,
      key: 'route-' + item.id,
      title: item.name,
      cover: item.imgUrl || '',
      modeText: PRODUCT_TYPE_TEXT[item.productType] || '',
      dateText: start && end && start !== end ? start + ' – ' + end : start,
      metaText: meta.join(' · '),
      termsText: termsLine(item),
      // 已截止也展示(稿上有「已截止」态):决定权在商家,不替他藏
      deadlineText: !deadline ? '' : (deadline > Date.now() ? '招商截止 ' + monthDay(deadline) : '已截止'),
    }, seatOf(item.remainingMerchantCount));
  });
}

/**
 * CU-M-133:广场一次只排 10 张,过去不交代剩余 —— 商家以为屏幕上这些就是全部商机,
 * 而真正还没截止的那几条可能被挤出整张列表。有剩余就在列表尾写明「共 N · 当前列出 M」。
 */
function routeScopeText(recruiting) {
  if (!recruiting || recruiting.hasMoreOpen !== true) return '';
  const shown = recruiting.shownCount >= 0 ? recruiting.shownCount : (recruiting.items || []).length;
  return '共 ' + recruiting.openCount + ' 个开放商机 · 当前列出前 ' + shown + ' 个';
}

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight || 20,
    navBarHeight: app.globalData.navBarHeight || 44,
    tabs: [
      { key: 'official', label: '官方活动' },
      { key: 'plaza', label: '广场' },
    ],
    activeTab: 'plaza',
    routes: [],
    routeScopeText: '',
    events: [],
    routesLoading: true,
    eventsLoading: true,
    routesError: '',
    eventsError: '',
  },

  onLoad(options) {
    if (options && options.tab === 'official') this.setData({ activeTab: 'official' });
    // CU-M-85:参谋页推荐卡带 ?topicId= 进来 —— 同名主题(两期「探店日一期」)在广场里是
    // 两条不同日期的招商,进来后必须直接定位到对应那条,不能让用户再认一遍。
    this._focusTopicId = options && options.topicId ? String(options.topicId).trim() : '';
    this.loadAvailable();
  },

  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  onNavBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/merchant/marketing/index' });
  },

  onTabChange(e) { this.setData({ activeTab: e.detail.key }); },

  // 右上角铃铛:协作邀请(收到的 / 我发出的)是全站唯一的合作收发入口
  goInbox() { wx.navigateTo({ url: '/pages/coop/list/index' }); },

  loadAvailable() {
    this.loadRoutes();
    this.loadEvents();
  },

  loadRoutes() {
    if (this._routesLoading) return;
    this._routesLoading = true;
    this.setData({ routesLoading: true, routesError: '' });
    app.sendRequest({
      url: '/api/merchant/marketing-home', method: 'POST', hideLoading: true, silentError: true,
      success: (res) => {
        const home = res && (res.code == 200 || res.code == '200') ? normalizeMarketingHome(res.data) : null;
        if (!home) {
          this._routesLoading = false;
          this.setData({ routeScopeText: '', routesError: app.getRequestErrorMessage(res, '路线加载失败'), routesLoading: false });
          return;
        }
        this._routesLoading = false;
        this.setData({
          routes: routeCards(home.recruiting.items),
          routeScopeText: routeScopeText(home.recruiting),
          routesLoading: false,
        }, () => this._locateFocusTopic());
      },
      fail: (res) => {
        this._routesLoading = false;
        this.setData({ routesError: app.getRequestErrorMessage(res, '路线加载失败'), routesLoading: false });
      },
    });
  },

  loadEvents() {
    if (this._eventsLoading) return;
    this._eventsLoading = true;
    this.setData({ eventsLoading: true, eventsError: '' });
    app.sendRequest({
      url: '/api/official/events', method: 'GET', hideLoading: true, silentError: true,
      success: (res) => {
        if (!res || (res.code != 200 && res.code != '200') || !Array.isArray(res.data)) {
          this._eventsLoading = false;
          this.setData({ eventsError: app.getRequestErrorMessage(res, '官方活动加载失败'), eventsLoading: false });
          return;
        }
        // F21:关键承接方缺失(recruitmentBlocked)必须在卡面标出来,由商家决定补位;标缺口不撤下
        const events = res.data.filter((item) => item && hasValue(item.id) && hasValue(item.title))
          .filter(officialChannel.isMerchantRecruitableEvent)
          .map(officialChannel.decorateRecruitableEvent);
        this._eventsLoading = false;
        this.setData({ events, eventsLoading: false });
      },
      fail: (res) => {
        this._eventsLoading = false;
        this.setData({ eventsError: app.getRequestErrorMessage(res, '官方活动加载失败'), eventsLoading: false });
      },
    });
  },

  // 定位带过来的主题:命中才标记并滚过去;不在本页(已下架/名额已满未进池)就安静停在列表 ——
  // 广场本来就该是完整的一屏,不为一条找不到的推荐把整页判失败。
  _locateFocusTopic() {
    const id = this._focusTopicId;
    if (!id) return;
    const index = (this.data.routes || []).findIndex((item) => String(item.id) === id);
    if (index < 0) return;
    this.setData({ ['routes[' + index + '].focus']: true }, () => {
      if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ selector: '#cc-route-' + id, duration: 300 });
    });
  },

  openTopic(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/topic/merchantinfo/merchantinfo?id=' + id + '&scope=MERCHANT' });
  },

  openEvent(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/activity/official-detail/index?id=' + id });
  },

  onRouteCoverError(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const index = Number(dataset.index);
    const item = Number.isInteger(index) ? this.data.routes[index] : null;
    if (!item || !hasValue(item.id) || String(item.id) !== String(dataset.id) || item._coverFailed) return;
    this.setData({ ['routes[' + index + ']._coverFailed']: true });
  },
});
