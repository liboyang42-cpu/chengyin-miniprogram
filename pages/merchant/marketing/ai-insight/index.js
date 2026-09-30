const app = getApp();
const merchantTheme = require('../../../../utils/merchant-theme.js');
const { merchantHomeUrl } = require('../../../../utils/merchant-home-link.js');
const { toTimestamp, chinaParts } = require('../../../../utils/datetime.js');

// 推荐主题 / 空态引导都去合作中心申请承接。
// 2026-09-18 UI-11:按用户稿删掉「建议活动」区块后,suggestion.type 路由表随之退场。
const COOP_CENTER_ROUTE = '/pages/merchant/coop-center/index';

// 店铺承接档案(容量/适合类型/诉求)的配置页 = 装修域现有「合作设置」页,不重复造表单
const PROFILE_SETUP_ROUTE = '/pages/merchant/decor/coop-setting/index';

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** CU-M-85:场次行只写到月日,与合作广场路线卡同一写法(coop-center/index.js 的 monthDay)。 */
function monthDay(value) {
  const timestamp = toTimestamp(value);
  const parts = timestamp ? chinaParts(timestamp) : null;
  return parts ? parts.month + '月' + parts.day + '日' : '';
}

function isAccessDenied(res) {
  const code = res && (res.code !== undefined ? res.code : res.statusCode);
  return String(code) === '401' || String(code) === '403';
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    loading: false,
    error: '',
    facts: null,          // 后端聚合事实包(必出层)
    ai: null,             // AI 解读(可为 null 的降级层)
    aiError: '',
    generatedAt: '',
    profile: null,        // 店铺承接档案(configured=false 时置顶配置引导);后端永远实时读
    profileText: '',      // 已配置时的摘要一行文案
    factState: 'unknown', // unknown=字段缺失 | empty=服务端明确全零 | ready=有真实事实
    valueCard: null,      // 首屏归因价值卡:城瘾为你带来 N 位玩家/M 次打卡/K 单核销 + 核销进度 + 环比
    metricCards: [],      // 核销率 / 复购率两张小卡:比率 + 说明行 + 分段胶囊进度条
    split: null,          // 新客 vs 回头客双段横条
    recentVisitors: [],   // Blackbird 式单客行(后端已格式化)
    recTopics: [],        // 推荐主题(真实招商中主题,可点去申请;AI 挂时无理由兜底)
    recPartners: [],      // 推荐联动商家(真实附近商家,可点看店铺)
  },

  onLoad() {
    this._skipNextShowReload = true;
    const gd = app.globalData || {};
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: gd.statusBarHeight || sys.statusBarHeight || 20,
      navBarHeight: gd.navBarHeight || 44,
    });
    this.load();
  },

  onShow() {
    merchantTheme.merchantPageShow();
    this._statusBarOnHero = false; // merchantPageShow 刚把状态栏刷回浅色
    this._syncStatusBar();
    // 首次 onShow 紧跟 onLoad，不重复请求；以后每次返回都让服务端重新确认商家资格。
    const memberId = String(typeof app.getUserID === 'function' ? (app.getUserID() || '') : '');
    const scopeChanged = this._dataMemberId !== undefined && this._dataMemberId !== memberId;
    if (scopeChanged) {
      this._skipNextShowReload = false;
      this.load();
      return;
    }
    if (this._skipNextShowReload) {
      this._skipNextShowReload = false;
      return;
    }
    this.load();
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._requestEpoch = (this._requestEpoch || 0) + 1;
    merchantTheme.merchantPageRestore();
  },

  onNavBack() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.reLaunch({ url: '/pages/merchant/marketing/index' }); },

  load() {
    const that = this;
    const requestEpoch = (this._requestEpoch || 0) + 1;
    this._requestEpoch = requestEpoch;
    const memberId = String(typeof app.getUserID === 'function' ? (app.getUserID() || '') : '');
    const scopeChanged = this._dataMemberId !== undefined && this._dataMemberId !== memberId;
    this._dataMemberId = memberId;
    const isCurrent = function () {
      const currentMemberId = String(typeof app.getUserID === 'function' ? (app.getUserID() || '') : '');
      return requestEpoch === that._requestEpoch && memberId === currentMemberId;
    };
    if (scopeChanged) that._clearSensitiveState('');
    that.setData({ loading: true, error: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/ai/merchant/insight',
      method: 'POST',
      success(res) {
        if (!isCurrent()) return;
        const listsValid = res && res.data && ['recentVisitors', 'recommendedTopics', 'recommendedPartners']
          .every(function (key) {
            return res.data[key] == null || (Array.isArray(res.data[key])
              && res.data[key].every(function (item) {
                return item && typeof item === 'object' && !Array.isArray(item);
              }));
          });
        if ((res.code === '200' || res.code === 200) && res.data && res.data.facts && listsValid) {
          const d = res.data;
          const attribution = d.facts.attribution || {};
          const attributionCounts = [attribution.visitors, attribution.checkins, attribution.redeems]
            .map(numberOrNull);
          const factsKnown = attributionCounts.every(function (value) { return value !== null; });
          const factState = !factsKnown ? 'unknown'
            : (attributionCounts.some(function (value) { return value > 0; }) ? 'ready' : 'empty');
          that.setData({
            facts: d.facts,
            ai: d.ai || null,
            aiError: d.ai ? '' : (d.aiError || '智能解读暂不可用'),
            generatedAt: d.generatedAt || '',
            profile: d.profile || null,
            profileText: that._buildProfileText(d.profile),
            factState,
            valueCard: that._buildValueCard(d.facts),
            metricCards: that._buildMetricCards(d.facts),
            split: that._buildSplit(d.facts),
            recentVisitors: Array.isArray(d.recentVisitors) ? d.recentVisitors : [],
            recTopics: that._decorateTopics(Array.isArray(d.recommendedTopics) ? d.recommendedTopics : []),
            recPartners: (Array.isArray(d.recommendedPartners) ? d.recommendedPartners : []).map(function (p) {
              const m = Number(p.distanceM);
              const distanceText = !Number.isFinite(m) || m <= 0 ? ''
                : (m < 1000 ? Math.round(m) + 'm' : (Math.round(m / 100) / 10) + 'km');
              return Object.assign({}, p, {
                // 稿 3:9「书店 · 450m」
                metaText: [p.category, distanceText].filter(Boolean).join(' · '),
                // 没有 logo 时圆形头像里放店名首字(稿 3:4)
                initial: String(p.name || '').trim().charAt(0),
              });
            }),
          });
          that._syncStatusBar();
        } else if (res && res.code !== '200' && res.code !== 200) {
          that._clearSensitiveState(app.getRequestErrorMessage(res, '商家资格已失效'));
        } else {
          that.setData({ error: app.getRequestErrorMessage(res, '店铺数据加载失败') });
        }
      },
      fail(res) {
        if (!isCurrent()) return;
        if (isAccessDenied(res)) {
          that._clearSensitiveState(app.getRequestErrorMessage(res, '商家资格已失效'));
        } else {
          that.setData({ error: app.getRequestErrorMessage(res, '店铺数据加载失败') });
        }
      },
      complete() { if (isCurrent()) that.setData({ loading: false }); },
    });
  },

  _clearSensitiveState(error) {
    this.setData({
      error: error || '',
      facts: null,
      ai: null,
      aiError: '',
      generatedAt: '',
      profile: null,
      profileText: '',
      factState: 'unknown',
      valueCard: null,
      metricCards: [],
      split: null,
      recentVisitors: [],
      recTopics: [],
      recPartners: [],
    });
    this._syncStatusBar();
  },

  retry() { this.load(); },

  // 2026-09-19 用户裁决(与营销页同口径):商家侧数字位一律是数,没有值就写 0,不放横杠。
  // 「算不出」这句实话由样本不足提示(facts.lowSample →「数据还少，以下解读仅供参考」)
  // 与「上期无基数」的环比位来说,数字位自己不再兼职表达状态。
  _pct(v) {
    const value = numberOrNull(v);
    return Math.round(value === null ? 0 : value * 100) + '%';
  },

  _countText(v) {
    const value = numberOrNull(v);
    return value === null ? '0' : String(value);
  },

  // 分段胶囊进度:10 枚,rate null(样本不足)→ 全空虚线胶囊,不冒充 0
  _segs(rate) {
    const value = numberOrNull(rate);
    const filled = value === null ? 0 : Math.max(0, Math.min(10, Math.round(value * 10)));
    const segs = [];
    for (let i = 0; i < 10; i++) segs.push({ on: i < filled });
    return segs;
  },

  // 稿 1:39 两张小卡:核销率(打卡数 · 平均等待) / 复购率(核销顾客数)。
  // CU-M-46 / CU-M-84(2026-09-23 用户裁决 A):两个比率各有自己的总体和时间窗,
  // 并排显示而不写清楚会被读成互相矛盾。「N 位回头」原本按**跨窗口**口径算
  // (窗口前也到过店),与百分比的分母(窗口内核销会员)根本不是一批人 ⇒ 从这张卡撤掉,
  // 跨窗口的回头客只留在下面「新客 vs 回头客」横条里。副行改用与百分比同一批人。
  _buildMetricCards(facts) {
    const c = (facts && facts.checkin) || {};
    const window = (facts && facts.window) || '近30天';
    const wait = numberOrNull(c.avgWaitMinutes);
    return [
      { key: 'redeem', name: '核销率', num: this._pct(c.redeemRate), segs: this._segs(c.redeemRate),
        sub: this._countText(c.total) + ' 次打卡' + (wait === null ? '' : ' · 平均等待 ' + wait + ' 分钟'),
        scope: '口径：已核销报名数 ÷ ' + window + '内报名数' },
      { key: 'repeat', name: '复购率', num: this._pct(c.repeatRate), segs: this._segs(c.repeatRate),
        sub: '基于 ' + this._countText(facts && facts.sampleMembers) + ' 位核销顾客',
        scope: '口径：核销≥2次的会员 ÷ ' + window + '内核销会员' },
    ];
  },

  // 首屏归因价值卡(调研共性规律#1:面板第一职责是「平台为你带来了什么」)
  _buildValueCard(facts) {
    const a = (facts && facts.attribution) || {};
    const cur = numberOrNull(a.visitors);
    const prev = numberOrNull(a.prevVisitors);
    let deltaText = '';
    if (prev !== null && cur !== null && prev > 0 && cur !== prev) {
      const d = cur - prev;
      deltaText = '比上期' + (d > 0 ? ' +' : ' ') + d + ' 位玩家';
    }
    // 上期无数据不显示环比(没有值 ≠ 值是 0)
    return {
      visitors: this._countText(a.visitors),
      checkins: this._countText(a.checkins),
      redeems: this._countText(a.redeems),
      // 稿 1:27 价值卡进度 = 核销占打卡的比例(34/42 ≈ 8 格)
      segs: this._segs(((facts && facts.checkin) || {}).redeemRate),
      deltaText,
    };
  },

  // 新客 vs 回头客双段横条(Square loyalty vs non-loyalty 的内部对比版)
  // CU-M-46:回头客是**跨窗口**口径(窗口内到店 ∩ 窗口前也到过店),这句话必须写在卡上 ——
  // 数字位本身看不出时间窗,同一张屏上的复购率又是别的总体。
  _buildSplit(facts) {
    const s = (facts && facts.split) || {};
    const window = (facts && facts.window) || '近30天';
    const n = numberOrNull(s.newVisitors);
    const r = numberOrNull(s.returningVisitors);
    if (n === null || r === null) return null;
    if (n + r === 0) return null;
    return {
      newVisitors: n,
      returningVisitors: r,
      newPct: Math.round(n / (n + r) * 100),
      scope: '口径：' + window + '内有到店的玩家，窗口前（全历史）也到过店的算回头客',
    };
  },

  _buildProfileText(profile) {
    if (!profile || !profile.configured) return '';
    const parts = [];
    if (profile.capacity) parts.push('可容纳 ' + profile.capacity + ' 人');
    if (profile.suitActivityTypes) parts.push('适合 ' + profile.suitActivityTypes);
    return parts.join(' · ');
  },

  // 配置页返回后 onShow 重拉,档案摘要即时刷新(后端 profile 不走缓存)
  goProfileSetup() { wx.navigateTo({ url: PROFILE_SETUP_ROUTE }); },

  // CU-M-85:同名主题(两期「探店日一期」)只靠名字分不出是哪一场。推荐池里的 cms_topic
  // 自带起止日期与主办方,合作广场的路线卡也是这么写的 —— 这里按同一写法补一行场次。
  _decorateTopics(list) {
    return (list || []).map(function (item) {
      const start = monthDay(item.startDate);
      const end = monthDay(item.endDate);
      const dateText = start && end && start !== end ? start + ' – ' + end : start;
      const hostText = item.hostName ? '主办 ' + item.hostName : '';
      return Object.assign({}, item, {
        metaText: [dateText, hostText].filter(Boolean).join(' · '),
      });
    });
  },

  // 推荐主题 → 合作中心申请承接;带 topicId 过去把对应条目定位出来(同名主题不必再认一遍)
  goRecTopic(e) {
    const topicId = String((e.currentTarget.dataset || {}).topicId || '').trim();
    if (!/^\d+$/.test(topicId)) return this.goCoopCenter();
    wx.navigateTo({ url: COOP_CENTER_ROUTE + '?topicId=' + topicId });
  },

  // 推荐商家 → canonical 商家主页(主体是 memberId,不是档案主键)
  goRecPartner(e) {
    const url = merchantHomeUrl((e.currentTarget.dataset || {}).memberId);
    if (url) wx.navigateTo({ url });
  },

  goCoopCenter() { wx.navigateTo({ url: COOP_CENTER_ROUTE }); },

  // 透明 nav 只在黑 Hero 上成立;滚过 Hero 顶部这一段就转实底。只在跨阈值时同步状态栏。
  onPageScroll(e) {
    const solid = e.scrollTop > 120;
    if (solid === !!this._navSolid) return;
    this._navSolid = solid;
    this._syncStatusBar();
  },

  // 状态栏字色跟着顶部走:黑 Hero 露出时白字,否则回商家浅色(merchantPageShow 的口径)。
  _syncStatusBar() {
    if (typeof wx.setNavigationBarColor !== 'function') return;
    const onHero = !!this.data.facts && !this._navSolid;
    if (onHero === this._statusBarOnHero) return;
    this._statusBarOnHero = onHero;
    if (onHero) wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: '#000000' }); /* ds-ok 原生状态栏只收 #fff/#000,黑 Hero 上要白字 */
    else merchantTheme.merchantPageShow();
  },
});
