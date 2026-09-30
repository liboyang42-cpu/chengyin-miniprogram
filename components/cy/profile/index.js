const modal = require('../../../utils/modal.js');
const cyLoading = require('../../../utils/loading.js');
const cyToast = require('../../../utils/toast.js');
const motion = require('../../../utils/motion.js');
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const { toTimestamp } = require('../../../utils/datetime');
const app = getApp();
const roleGuard = require('../../../utils/roleGuard.js');
const policy = require('../../../utils/identity/identity-policy.js');
const mockData = require('../../../utils/mockData.js');
const { applyTheme } = require('../../../utils/theme.js');
const { resolveVerificationScan } = require('../../../utils/verification-scan.js');
const { completionReceiptMessage, resolveVerificationResult } = require('../../../utils/merchant-verification.js');
const { getScene } = require('../../../utils/scene-registry.js');
const { pushScene, popScene, currentScene, exitDecision } = require('../../../utils/scene-stack.js');
const { createWriteActionWorkflow } = require('../../../utils/write-action-workflow.js');
const { offerVerificationReadback } = require('../../../utils/verification-readback.js');
const { isRecord, isRecordList } = require('../../../utils/response-shape.js');
const { inactiveAccess, normalizeMerchantAccess } = require('../../../utils/merchant-access-policy.js');
const { isEndedProject, statusLabelOf } = require('../../../utils/merchant-workbench.js');
const THEME_EMOJI = ['🍜', '❤️', '📚', '☕', '🌸', '🎮', '📷', '🏯'];
const MEDAL_EMOJI = {
  ramen: '🍜', coffee: '☕', book: '📚', history: '🏯', spring: '🌸',
  couple: '❤️', story: '🎮', photo: '📷', streak: '🔥', explore: '🧭'
};

const TAB_LABELS = {
  projects: '我的',
  posts: '推文',
  achievements: '成就',
  about: '关于'
};
// cy-tabs 组件用:[{key,label}],由 TAB_LABELS 派生,保持 Tab 标签单一真源
const MEMBER_TABS = Object.keys(TAB_LABELS).map(function (k) { return { key: k, label: TAB_LABELS[k] }; });
const PUBLIC_TABS = MEMBER_TABS.filter(function (tab) { return tab.key !== 'projects'; });
const PROFILE_METRIC_SOURCES = ['user', 'growth', 'history', 'points'];

function buildBenefits(p) {
  p = p || {};
  var max = p.maxThemes;
  return [
    { text: '发布路线 · 上限 ' + (max == null ? '不限' : (max || 0)), unlocked: (max == null || max > 0) },
    { text: '发布优惠券', unlocked: p.canPublishCoupon === true },
    { text: '到店核销', unlocked: p.canRedeemCoupon === true },
    { text: '分支 / 条件玩法', unlocked: p.canBranch === true },
    { text: '博弈机制（竞速/对抗/协作）', unlocked: p.canGameMechanic === true },
    { text: '开放门店为城市节点', unlocked: p.canOpenAsNode === true },
    { text: '勋章设计', unlocked: p.canDesignMedal === true },
    { text: '建群', unlocked: p.canCreateGroup === true },
    { text: '我的收益', unlocked: p.withdrawable === true, route: '/subpackageA/pages/assetcenter/earnings/index' }
  ];
}

function req(url, data) {
  return new Promise(function (resolve) {
    app.sendRequest({
      url: url,
      method: 'POST',
      data: data || {},
      hideLoading: true,
      success: function (res) { resolve(res || {}); },
      fail: function () { resolve({ code: 'fail' }); }
    });
  });
}

// 商家公开资料里 gallery / tags 是字符串(JSON 串或逗号分隔),口径与旧
// pages/merchant/profile 的 parseDisplayList 保持同一套,别在这另起一份解析。
function displayText(value, keys) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value !== 'object') return '';
  var candidates = keys || ['name', 'label', 'title', 'value', 'text'];
  for (var i = 0; i < candidates.length; i++) {
    var text = displayText(value[candidates[i]]);
    if (text) return text;
  }
  return '';
}

function parseDisplayList(raw, keys) {
  if (!raw) return [];
  var values = raw;
  if (typeof raw === 'string') {
    try { values = JSON.parse(raw); }
    catch (e) { values = raw.split(/[,，]/); }
  }
  if (!Array.isArray(values)) values = [values];
  return values.map(function (item) { return displayText(item, keys); }).filter(Boolean);
}

/**
 * 商家坐标 —— ★字段名是 locationLat / locationLng。
 *
 * 实体真源:MmsMerchant.locationLat / locationLng(Double),库列 location_lat /
 * location_lng。旧 pages/merchant/profile 读的 m.latitude / m.longitude 在实体上
 * **根本不存在** ⇒ 那处「点击地址导航」自上线起就在 `if (!m.latitude ...) return`
 * 静默早退,一次都没通过电。照抄它就是继承同一个哑弹,别抄。
 *
 * wx.openLocation 的入参才叫 latitude / longitude —— 那是 API 层,和实体字段名
 * 是两层东西,转换只在 goMerchantLocation 里做一次。
 *
 * 有效判据:必须是有限数、非 0、且落在合法经纬度范围内。null / 空串 / NaN 自不必说;
 * 0 也要挡 —— (0,0) 是几内亚湾不是店铺,放行等于给一条点下去跳大西洋的假链接。
 */
function toCoordinate(value, limit) {
  if (value === null || value === undefined || value === '') return null;
  var n = Number(value);
  if (!isFinite(n) || n === 0 || Math.abs(n) > limit) return null;
  return n;
}

function merchantCoordinate(merchant) {
  var m = merchant || {};
  var lat = toCoordinate(m.locationLat, 90);
  var lng = toCoordinate(m.locationLng, 180);
  if (lat === null || lng === null) return null;
  return { latitude: lat, longitude: lng };
}

/**
 * 招牌主推卡(4-12/R9-33):后端 public-home 的 featured 只会是活动(类型 1)或券(类型 2)
 * 的白名单卡,归属/公开态每次读取都重新核验过。判据与据点页
 * components/cy/scene-roam-poi-detail 同一份:类型必须是已知数字,活动还要有正整数 id ——
 * 两者缺一卡片仍显示(信息可信),但不标成可点,不给一个点下去没反应的假按钮。
 * 卡是可选装饰:坏数据只丢这张卡,不抛异常。
 */
function shapeFeaturedCard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  var type = typeof raw.featuredType === 'number' ? raw.featuredType : null;
  var id = Number(raw.featuredId);
  var featuredId = isFinite(id) && id > 0 ? id : null;
  return {
    featuredType: type,
    featuredId: featuredId,
    titleText: displayText(raw.name) || displayText(raw.title) || '主推内容',
    imageUrl: displayText(raw.imgUrl) || displayText(raw.coverImg) || displayText(raw.img) || '',
    actionable: (type === 1 && featuredId !== null) || type === 2
  };
}

// initialTab 只接受**当前视角真实存在**的 tab key:他人视角没有 projects,
// 传了也不能激活一个渲染不出内容的 tab。非法值返回空串,由调用方走原默认规则。
function resolveInitialTab(raw, tabs) {
  var key = String(raw || '');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].key === key) return key;
  }
  return '';
}

function pct(done, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((done || 0) * 100 / total));
}

function fmtKm(v) {
  var n = Number(v || 0);
  if (n >= 100) return Math.round(n);
  return n.toFixed(1);
}

function metricNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  var number = Number(value);
  return isFinite(number) && number >= 0 ? number : null;
}

function resolveProfileMetricState(sourceStates, sourceSignals) {
  var hasLoading = false;
  for (var i = 0; i < PROFILE_METRIC_SOURCES.length; i++) {
    var source = PROFILE_METRIC_SOURCES[i];
    if (sourceStates[source] === 'error') return 'error';
    if (sourceStates[source] !== 'ready') hasLoading = true;
  }
  if (hasLoading) return 'loading';

  for (var key in sourceSignals) {
    if (!Object.prototype.hasOwnProperty.call(sourceSignals, key)) continue;
    var values = sourceSignals[key] || [];
    for (var j = 0; j < values.length; j++) {
      if (values[j] > 0) return 'ready';
    }
  }
  return 'empty';
}

function pickEmoji(name, list, idx) {
  if (!name) return list[idx % list.length];
  var code = 0;
  for (var i = 0; i < name.length; i++) code += name.charCodeAt(i);
  return list[code % list.length];
}

// 城市名只认服务端明确给的 city 字段。
// ⚠️ 原来在 city 缺失时会拿「工作地点」字段兜底，匹配不到城市名还会 slice(0, 6)
// 把那个地址的前 6 个字直接显示出来。自己看自己无妨，但这套逻辑统一到组件后
// 对他人主页也跑 —— 契约 member-public-contract 明令他人主页不消费工作地点。
// 组件是两个视角共用的，所以这里根本不去读那个字段：拿不到 city 就返回空，
// 由调用方决定显示什么。想从工作地点推城市的兜底，留在「只有自己能看」的页面里做。
// （注释里也刻意不写出那个字段名 —— 契约是纯文本匹配，写出来同样会判红。）
function parseCity(userInfo) {
  var u = userInfo || {};
  return u.city || '';
}

function formatJoinDate(str) {
  if (!str) return '—';
  return String(str).slice(0, 10).replace(/-/g, '.');
}

// 余额格式化。拿不到/不是数就返回 null,模板渲染「—」——
// 资金位上写 0.00 是在断言「你没有钱」,而没查到只说明这次没取到。
function formatBalance(value) {
  if (value === null || value === undefined || value === '') return null;
  var amount = Number(value);
  return isFinite(amount) ? amount.toFixed(2) : null;
}

function withDevPreview(list, getter) {
  if (list && list.length) return list;
  if (app.isDevEnv && app.isDevEnv()) return getter();
  return list || [];
}

function pickProjectCover(item) {
  if (!item) return '/images/route_free_cover.png';
  var raw = item.imgArr || item.imgUrl || item.pics || item.cover || '';
  if (Array.isArray(raw)) raw = raw[0] || '';
  // pics 用 ';' 分隔,imgArr 用 ',' 分隔(见 publish/fabu 的 _setImgArr),两者都要取首张
  if (raw) raw = String(raw).split(/[,;]/)[0];
  return raw || '/images/route_free_cover.png';
}

function fmtShortDate(str) {
  if (!str) return '';
  return String(str).slice(0, 10).replace(/-/g, '.');
}

function calcTimeProgress(startDate, endDate) {
  if (!startDate || !endDate) return { percent: 0, label: '未设置项目时间' };
  var start = toTimestamp(String(startDate));
  var end = toTimestamp(String(endDate));
  var label = fmtShortDate(startDate) + ' - ' + fmtShortDate(endDate);
  if (!start || !end || end <= start) return { percent: 0, label: label };
  var now = Date.now();
  if (now <= start) return { percent: 0, label: label };
  if (now >= end) return { percent: 100, label: label };
  return { percent: Math.min(100, Math.round((now - start) * 100 / (end - start))), label: label };
}

function normalizeProjectPreview(item) {
  var time = calcTimeProgress(item.startDate, item.endDate);
  // 2026-09-17 用户拍板第 38 条:状态章原来把「未开始」也写成「进行中」,与商家工作台
  // 的 statusLabelOf 不一致。状态文案与「已结束」判据共用同一真源(utils/merchant-workbench.js),
  // 档期未知时 statusLabelOf 返回空串 —— 宁可空着,也不编一个状态。
  var statusText = statusLabelOf(item.startDate, item.endDate);
  var ended = statusText === '已结束';
  var sales = item.salesAmout != null ? Number(item.salesAmout) : 0;
  return {
    id: item.id,
    name: item.name || item.title || '未命名路线',
    cover: pickProjectCover(item),
    pointVal: isNaN(sales) ? 0 : Math.round(sales),
    viewCount: item.viewCount || 0,
    timePercent: time.percent,
    timeLabel: time.label,
    // 2026-08-20 项目卡 v2:卡上只渲染状态章(未开始/进行中/已结束,空态不渲染);
    // pointVal/viewCount/timePercent 字段保留给其他消费方,不随 UI 一起删。
    // 「已结束」与商家工作台同一判据(都出自 statusLabelOf,按日历日),不另算一套:
    // 否则结束当天(未被过滤、仍在预览里)工作台说进行中、这里却写已结束,两处口径打架。
    statusDone: ended,
    statusText: statusText
  };
}

// 主页「我的项目」只是预览:与商家工作台同一规则隐藏已结束项目(判据唯一真源 isEndedProject);
// 「管理全部」进去的 myproject 完整列表不过滤。
function isLiveProject(item) {
  return !isEndedProject(item && item.startDate, item && item.endDate);
}

function demoProjectPreviewList() {
  return mockData.getDemoMyProjects().filter(isLiveProject).map(normalizeProjectPreview);
}

Component({
  // app.wxss 的主题 token 与页面导入的 merchant-light-scope 必须能匹配组件内主题根节点。
  options: { styleIsolation: 'apply-shared' },
  properties: {
    viewer: { type: String, value: 'self' },
    userId: {
      type: String,
      value: '',
      observer: function () {
        if (this._profileAttached) this.initializeProfile();
      }
    },
    // canonical 深链 ?tab=about。变化时也要重新初始化 —— 组件被复用时
    // 不重算就会停在上一次的 tab 上。
    initialTab: {
      type: String,
      value: '',
      observer: function () {
        if (this._profileAttached) this.initializeProfile();
      }
    },
    topicId: { type: String, value: '' },
    topicName: { type: String, value: '' },
    operationScope: { type: String, value: '' },
    // CU-M-09:商家从品牌中心「看公开主页」进来 = 以访客视角预览自己,不走本人的玩家探索态。
    previewSelf: {
      type: Boolean,
      value: false,
      observer: function () {
        if (this._profileAttached) this.initializeProfile();
      }
    }
  },

  data: {
    // [P0-2] ③ 选章核销面板:交集 ≥2 时装候选章节,商家选完调 scan_qr_code_chapter
    chapterSheet: { show: false, code: '', items: [] },
    stationSheet: { show: false, code: '', items: [] },
    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    heroImg: '/images/mer1.jpg',
    userInfo: {},
    categoryList: [],
    casePicsList: [],
    joinInfo: { id: 0 },

    // D-10 入口治理:未上线功能入口隐藏,功能就绪后置 true 恢复

    // 三份身份状态,真源各不相同,不许互相顶替(设计文档 §3.5):
    //  · hostSelf        宿主壳能力(tabBar / hideTabBar),由 viewer 属性决定;
    //  · isSelf          effectiveIsSelf = 当前登录 memberId == 目标 userId。
    //                    商家本人从 canonical 链接进来仍停在 userinfo 宿主,
    //                    只看 viewer 会把本人误判成他人 ⇒ 必须自己算;
    //  · viewerIsMerchant 观看者 RBAC 身份,不参与被看者身份判断;
    //  · subjectIsMerchant 被看者是不是商家(public-home 探测),决定「关于」渲染
    //                    哪一套 + 商家主题。URL 里的 tab/merchantId 只是查询提示,
    //                    绝不能当商家身份真源。
    hostSelf: true,
    isSelf: true,
    viewerIsMerchant: false,
    merchantAccess: inactiveAccess(),
    merchantAccessState: 'idle',
    merchantTeamEntryValue: '',
    _avatarSrc: '',
    _avatarInitial: '',
    subjectIsMerchant: false,
    subjectMerchant: null,
    // 门店 NPC 对话:开关 + 面板可见性。
    // ★ 开关从 globalData.features 读(app.js 启动时拉 /api/config/features 覆盖,
    //   拉失败保持默认全关)。缺省 false —— 失败方向是关。
    merchantNpcChatOn: !!(getApp().globalData.features || {}).merchantNpcChat,
    merchantNpcChatShow: false,
    // loading / merchant / not-merchant / network-error 四态互斥。
    // 网络失败绝不回退成玩家 About 或「商家未完善」——那是把「没查到」伪装成业务事实。
    merchantState: 'not-merchant',
    merchantGallery: [],
    merchantTags: [],
    merchantCategories: [],
    merchantHasGeo: false,
    // 招牌主推卡:null = 未设置/已下架/已易主/坏数据,整块不渲染
    featured: null,
    activeTab: 'projects',
    memberTabs: MEMBER_TABS,
    tabLabels: TAB_LABELS,

    role: 'player',
    isClubLeader: false,
    benefits: buildBenefits({}),
    clubOwnedCount: 0,
    pointsStat: { weekPoints: 0, rankPercentage: 0 },
    pointsSheet: { show: false, loading: false, loaded: false, failed: false, tasks: [] },

    growthLevel: 1,
    streakDays: 0,
    exploreValue: 0,
    cityName: '上海',
    // 2026-09-18 用户走查 UI-04:数字统计没取到就显示 0,不再显示横杠「—」。
    // 仍不能是 null —— WXML 文本插值会把 null **原样打印成字面「null」**
    // (2026-08-19 A42 实拍:好友「—」、关注「null」、粉丝「null」)。0 是唯一既非空
    // 又不撒谎的初值:接口回来前/看别人主页走别的取数路径时,这三位是「暂无数字」。
    friendNum: 0,
    followNum: 0,
    fansNum: 0,
    profilePoint: null,
    profileMetricState: 'loading',
    slogan: '寻找下一条城市路线',
    primaryCta: '开始探索',
    followSubmitting: false,
    followReceipt: false,
    reducedMotion: readReducedMotion(),
    isMerchantView: false,

    identityCard: { shops: 0, themes: 0, routes: 0, km: '0', medals: 0, cities: 1 },
    rankDisplay: { no: 0, delta: '' },
    exploreStat: { shops: 0, weekExp: 0 },
    todayStats: { shops: 0, km: '0', exp: 0 },
    themeProgress: [],
    aiTip: { area: '附近街区', matchCount: 0, themeName: '' },
    medals: [],
    medalCount: 0,
    joinDate: '—',

    list: [],
    page_no: 1,
    hasMore: false,
    nodata: false,
    orderPreviewList: [],
    projectPreviewList: [],

    // 错误 ≠ 空态(DS §7 / 施工图 §8.1):四条链路各自可见,失败不再退成 nodata / 空数组,
    // 否则页面会拿「还没有动态 / 还没有项目 / 暂无订单」冒充「你本来就没有」= 对用户撒谎。
    orderErr: false,
    projectErr: false,
    projectAllEnded: false,
    feedErr: false,
    medalErr: false,
    sceneStack: [],
    sceneCurrent: null,
    sceneConfirm: { show: false, action: null, pending: null }
  },

  observers: {
    // 头像位真源:商家主体走 logo,没有就落店名首字;玩家走 avatar,没有才用默认头像那张图。
    // 首字在 js 里算 —— WXML 表达式不支持 charAt。
    'subjectIsMerchant, subjectMerchant, userInfo': function (isMerchant, merchant, user) {
      var m = merchant || {};
      var u = user || {};
      var name = (m.name || '').trim();
      this.setData({
        _avatarSrc: isMerchant ? (m.logo || '') : (u.avatar || '/images/d_profile.png'),
        _avatarInitial: isMerchant ? (name ? name.charAt(0) : '店') : '',
      });
    },
    // 商家版没有「成就」tab(2026-08-20 用户拍板)。isMerchantView 有两个写入点
    // (被看者探测 probeSubjectMerchant / 观看者角色 syncMerchantView),observer 一处兜住全部。
    'isMerchantView, isSelf': function (isMerchant, isSelf) {
      var tabs = isSelf ? MEMBER_TABS : PUBLIC_TABS;
      if (isMerchant) tabs = tabs.filter(function (t) { return t.key !== 'achievements'; });
      // 写成对象字面量而不是累积 patch:U4 门禁要能静态看出写了哪些顶层字段,
      // 累积式 this.setData(patch) 它读不出来,会变成一条新的动态 setData 债务(棘轮只许变小)。
      var tabsChanged = JSON.stringify(tabs) !== JSON.stringify(this.data.memberTabs);
      var resetActive = isMerchant && this.data.activeTab === 'achievements';
      if (tabsChanged && resetActive) this.setData({ memberTabs: tabs, activeTab: 'about' });
      else if (tabsChanged) this.setData({ memberTabs: tabs });
      else if (resetActive) this.setData({ activeTab: 'about' });
    },
  },

  lifetimes: {
    attached: function () {
      this._profileAttached = true;
      this._syncProfileReducedMotion();
      this.initializeProfile();
    },
    detached: function () {
      this._profileAttached = false;
      this._following = false;
      this._followEpoch = (this._followEpoch || 0) + 1;
      if (this._verificationWorkflow) this._verificationWorkflow.destroy();
    }
  },

  pageLifetimes: {
    show: function () {
      if (!this._profileAttached) return;
      this._syncProfileReducedMotion();
      if (!this._profileShown) {
        this._profileShown = true;
        return;
      }
      // 登录态可能在页面存续期变化(登录 / 退出 / 换号)⇒ 每次 onShow 重算
      // effectiveIsSelf 与观看者身份;身份变了就整块重来。
      this.syncViewerIdentity();
      if (this.computeIsSelf() !== this.data.isSelf) {
        this.initializeProfile();
        return;
      }
      if (this.data.hostSelf) {
        this.syncMerchantView();
        wx.hideTabBar();
        this.refreshAll(true);
        return;
      }
      // 他人宿主:主题由**被看者**定,不随观看者角色变色
      applyTheme(this.data.subjectIsMerchant ? 'light' : 'dark');
      if (this.data.isSelf) this.refreshAll(true);
      else this.refreshPublicProfile(true);
    },
    // 商家被看者会把原生导航栏切成日间;离开时必须还原,否则下一页(不自己
    // applyTheme 的那些)会顶着一条白导航栏 —— 旧 merchant/profile 页用
    // merchantPageRestore 处理的就是这件事,收编后这层责任跟着搬过来。
    hide: function () {
      if (!this.data.hostSelf && this.data.subjectIsMerchant) applyTheme('dark');
    }
  },

  methods: {
    _syncProfileReducedMotion: function () {
      var reducedMotion = readReducedMotion();
      if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion: reducedMotion });
    },

    _submitVerification: function (key, loadingTitle, options, callback) {
      var that = this;
      if (!this._verificationWorkflow) this._verificationWorkflow = createWriteActionWorkflow({ deadlineMs: 15000 });
      if (this._verificationWorkflow.isBusy(key)) {
        cyToast('核销处理中，请勿重复提交');
        return false;
      }
      cyLoading.show(loadingTitle);
      var submitted = this._verificationWorkflow.run(key, function (done) {
        return app.sendRequest(Object.assign({}, options, {
          autoErrorToast: false,
          success: function (res) { done({ status: 'success', response: res }); },
          fail: function () { done({ status: 'failed', response: { code: 500, msg: '网络错误，请重试' } }); },
          successStatusAbnormal: function (res) {
            done({ status: 'failed', response: { code: 500, msg: (res && res.msg) || '核销失败，请重试' } });
          }
        }));
      }, function (result) {
        cyLoading.hide();
        if (result.status === 'unknown') {
          callback({ code: 202, msg: '核销结果待确认，请勿重复核销；请先查看核销记录' });
          offerVerificationReadback(key, that._verificationWorkflow);
          return;
        }
        callback(result.response);
      });
      if (!submitted) cyLoading.hide();
      return submitted;
    },
  // effectiveIsSelf:宿主 viewer 只是提示,真源是「当前登录 memberId == 目标 userId」。
  computeIsSelf: function () {
    if (this.data.viewer !== 'other') return true;
    if (this.data.previewSelf) return false;
    var loginId = String(app.getUserID() || '');
    var targetId = String(this.data.userId || '');
    return !!loginId && loginId === targetId;
  },

  // 观看者 RBAC 不参与被看者身份与主题。
  syncViewerIdentity: function () {
    var viewerIsMerchant = this.data.merchantAccessState === 'ready'
      ? this.data.merchantAccess.active
      : policy.isMerchantView({ role: app.getUserRole(), userType: app.getUserType() });
    if (viewerIsMerchant !== this.data.viewerIsMerchant) this.setData({ viewerIsMerchant: viewerIsMerchant });
  },

  initializeProfile: function () {
    var hostSelf = this.data.viewer !== 'other';
    var isSelf = this.computeIsSelf();
    var userId = hostSelf ? String(app.getUserID() || '') : String(this.data.userId || '');
    var memberTabs = isSelf ? MEMBER_TABS : PUBLIC_TABS;
    var initialTab = resolveInitialTab(this.data.initialTab, memberTabs);
    var profileKey = (isSelf ? 'self:' : 'other:') + userId + '|' + initialTab;
    if (this._profileKey === profileKey) return;
    this._profileKey = profileKey;
    this._following = false;
    this._followEpoch = (this._followEpoch || 0) + 1;
    this._profileShown = false;
    this.setData({
      hostSelf: hostSelf,
      isSelf: isSelf,
      viewerIsMerchant: policy.isMerchantView({ role: app.getUserRole(), userType: app.getUserType() }),
      merchantAccess: inactiveAccess(),
      merchantAccessState: 'idle',
      merchantTeamEntryValue: '',
      isClubLeader: false,
      clubOwnedCount: 0,
      subjectIsMerchant: false,
      subjectMerchant: null,
      merchantState: hostSelf ? 'not-merchant' : 'loading',
      merchantGallery: [],
      merchantTags: [],
      merchantCategories: [],
      merchantHasGeo: false,
      // 合法 initialTab 优先;非法值回退原规则(自己 projects、别人 posts)
      activeTab: initialTab || (isSelf ? 'projects' : 'posts'),
      memberTabs: memberTabs,
      isMerchantView: false,
      primaryCta: isSelf ? '开始探索' : '关注',
      followSubmitting: false,
      followReceipt: false,
      list: [],
      page_no: 1,
      hasMore: false,
      nodata: false,
      feedErr: false
    });
    if (!hostSelf && !userId) {
      this.setData({ merchantState: 'not-merchant' });
      return;
    }
    if (hostSelf) {
      this.syncMerchantView();
      wx.hideTabBar();
      this.loadBanner();
      this.refreshAll();
      return;
    }
    // 他人宿主:先按玩家夜间起手,商家探测回来再由**被看者**决定主题
    applyTheme('dark');
    this.loadBanner();
    this.probeSubjectMerchant();
    if (isSelf) this.refreshAll();
    else this.refreshPublicProfile();
  },

  /**
   * 被看者是不是商家 —— 唯一真源是 public-home 按 memberId 查得到一条可公开记录。
   * 三条分支必须分得开:成功 / 业务性「不是商家或未开放」/ 网络没查到。
   * 把第三种收敛进第二种,就是拿「没查到」冒充「他不是商家」。
   */
  probeSubjectMerchant: function () {
    var that = this;
    var memberId = String(this.data.userId || '');
    if (!memberId) {
      this.setData({ merchantState: 'not-merchant' });
      return;
    }
    this.setData({ merchantState: 'loading' });
    app.sendRequest({
      url: '/api/merchant/public-home',
      method: 'POST',
      hideLoading: true,
      silentError: true,
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ memberId: Number(memberId) || memberId }),
      success: function (res) {
        if (res && res.code == '200' && res.data) {
          that.applySubjectMerchant(res.data);
          return;
        }
        if (res && res.msg === '商家不存在或未开放') {
          that.clearSubjectMerchant('not-merchant');
          return;
        }
        that.clearSubjectMerchant('network-error');
      },
      fail: function () { that.clearSubjectMerchant('network-error'); }
    });
  },

  clearSubjectMerchant: function (state) {
    this.setData({
      merchantState: state,
      subjectIsMerchant: false,
      subjectMerchant: null,
      merchantGallery: [],
      merchantTags: [],
      merchantCategories: [],
      merchantHasGeo: false,
      featured: null,
      isMerchantView: false
    });
    applyTheme('dark');
  },

  applySubjectMerchant: function (raw) {
    var m = Object.assign({}, raw);
    m.businessStatusText = m.businessStatus == null ? '—' : (m.businessStatus == 0 ? '已打烊' : '营业中');
    // capacity 是 Integer;拼单位在 JS 里做,模板不做「插值紧贴单位」的写法
    m.capacityText = (m.capacity == null || m.capacity === '') ? '' : (m.capacity + ' 人');
    var hasGeo = merchantCoordinate(m) !== null;
    this.setData({
      merchantState: 'merchant',
      subjectIsMerchant: true,
      subjectMerchant: m,
      merchantNpcChatOn: !!(getApp().globalData.features || {}).merchantNpcChat,
      merchantGallery: parseDisplayList(m.gallery, ['url', 'src', 'imgUrl', 'image']),
      merchantTags: parseDisplayList(m.tags),
      merchantCategories: m.sysCategoryList || [],
      merchantHasGeo: hasGeo,
      featured: shapeFeaturedCard(m.featured),
      // 商家公开身份接管身份头:品牌名 / 头像 / 主页封面 / 城市角色 / 品牌口号
      heroImg: m.coverImage || this.data.heroImg,
      isMerchantView: true
    });
    // 商家主题由被看者决定,与观看者角色无关
    applyTheme('light');
  },

  retryMerchantProbe: function () { this.probeSubjectMerchant(); },

  refreshPublicProfile: function (silent) {
    var that = this;
    if (!silent) {
      this.setData({ page_no: 1, list: [], hasMore: false, nodata: false, feedErr: false });
    }
    return this.loadUserData().then(function () {
      if (!silent && that.data.activeTab === 'posts') that.getCreativesquareList();
    });
  },

  syncMerchantView: function () {
    var isMerchant = this.data.merchantAccessState === 'ready'
      ? this.data.merchantAccess.active
      : policy.isMerchantView({ role: app.getUserRole(), userType: app.getUserType() });
    this.setData({ isMerchantView: isMerchant });
    applyTheme(isMerchant ? 'light' : 'dark');
  },

  loadMerchantAccess: function () {
    var that = this;
    if (!this.data.isSelf || !app.getUserID()) {
      this.setData({ merchantAccess: inactiveAccess(), merchantAccessState: 'ready', merchantTeamEntryValue: '' });
      return Promise.resolve();
    }
    this.setData({ merchantAccessState: 'loading' });
    return req('/api/merchant/access/me', {}).then(function (res) {
      if (res.code != '200' || !isRecord(res.data)) {
        that.setData({ merchantAccess: inactiveAccess(), merchantAccessState: 'error', merchantTeamEntryValue: '' });
        return;
      }
      var access = normalizeMerchantAccess(res.data);
      that.setData({
        merchantAccess: access,
        merchantAccessState: 'ready',
        merchantTeamEntryValue: access.active
          ? (access.canManageOperators ? access.roleName + ' · 管理' : access.roleName + ' · 查看')
          : '',
        viewerIsMerchant: access.active,
        isMerchantView: access.active
      });
      if (that.data.hostSelf) applyTheme(access.active ? 'light' : 'dark');
    });
  },

  resetProfileMetricState: function () {
    this._profileMetricSourceStates = {};
    this._profileMetricSignals = {};
    for (var i = 0; i < PROFILE_METRIC_SOURCES.length; i++) {
      this._profileMetricSourceStates[PROFILE_METRIC_SOURCES[i]] = 'loading';
    }
    this.setData({ profileMetricState: 'loading' });
  },

  recordProfileMetricSource: function (source, status, signals) {
    if (!this._profileMetricSourceStates || !this._profileMetricSignals) {
      this.resetProfileMetricState();
    }
    this._profileMetricSourceStates[source] = status;
    this._profileMetricSignals[source] = status === 'ready' ? (signals || []) : [];
    var next = resolveProfileMetricState(this._profileMetricSourceStates, this._profileMetricSignals);
    if (next !== this.data.profileMetricState) this.setData({ profileMetricState: next });
  },

  refreshAll: function (silent) {
    var that = this;
    if (!silent) this.setData({ page_no: 1, list: [], hasMore: false, nodata: false, feedErr: false });
    this.resetProfileMetricState();
    // ⚠️ 按视角分流，不能无条件拉全部：下面这些接口要么用 app.getUserID()（当前登录用户）、
    // 要么只对「自己」有意义（订单/项目/积分/加入信息）。他人主页调它们既白跑一轮请求，
    // 拿回来的还是**自己的**数据 —— 契约 member-public-contract 盯的就是这件事。
    var shared = [
      this.loadUserData(),
      this.loadRoleInfo(),
      this.loadGrowthBundle(),
      this.loadThemes(),
      this.loadMedals()
    ];
    var selfOnly = this.data.isSelf ? [
      this.loadMerchantAccess(),
      this.loadJoinData(),
      this.loadRecommendations(),
      this.loadPointsStat(),
      this.loadOrderPreview(),
      this.loadProjectPreview(),
      this.loadProjectPending()
    ] : [];
    // 返回 Promise:宿主页(我的 tab)要把下拉刷新的收圈绑在真实完成上,而不是定时器。
    return Promise.all(shared.concat(selfOnly)).then(function () {
      that.buildDerivedState();
      if (!silent && that.data.activeTab === 'posts') that.getCreativesquareList();
    });
  },

  loadBanner: function () {
    var that = this;
    var local = this.data.isSelf ? wx.getStorageSync('member_hero_bg') : '';
    if (local) {
      that.setData({ heroImg: local });
      return;
    }
    req('/api/common/banner', { showType: 2 }).then(function (res) {
      if (res.code == '200' && isRecordList(res.data) && res.data.length) {
        that.setData({ heroImg: res.data[0].picUrl || that.data.heroImg });
      }
    });
  },

  loadUserData: function () {
    var that = this;
    var memberId = this.data.isSelf ? app.getUserID() : this.data.userId;
    var followEpoch = this._followEpoch || 0;
    var followStateVersion = this._followStateVersion || 0;
    var followMutationPending = Boolean(this._following);
    // 他人主页走匿名可读的公开白名单接口:/api/user/info 会先强制登录,历史分享
    // 冷启动就只剩一个没有头信息的空壳。判据用 effectiveIsSelf 而不是宿主传入的
    // viewer —— 否则本人从 canonical 进来会误走公开分支。
    var url = this.data.isSelf ? '/api/user/info' : '/api/user/public-info';
    return req(url, { member_id: memberId }).then(function (res) {
      // 换了被看者后，旧资料响应整包作废；同一被看者若在请求期间完成关注写入，
      // 资料仍可补齐，但不能用请求发出前的 isFollow 把服务端已确认回执倒灌回去。
      if (followEpoch !== (that._followEpoch || 0)) return;
      if (res.code != '200' || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) {
        if (that.data.isSelf) that.recordProfileMetricSource('user', 'error');
        return;
      }
      if (that.data.isSelf) {
        app.setUserRole(res.data.role);
      }
      var pics = [];
      if (typeof res.data.casePics === 'string' && res.data.casePics.trim()) {
        pics = res.data.casePics.split(';').filter(function (u) { return u.trim(); });
      }
      var followNum = metricNumber(res.data.followNum);
      var fansNum = metricNumber(res.data.fansNum);
      var topicNum = metricNumber(res.data.topicNum);
      var activityNum = metricNumber(res.data.activityNum);
      var likeNum = metricNumber(res.data.likeNum);
      var friendNum = metricNumber(res.data.friendNum);
      // role 不在这里写:它与 loadRoleInfo 同在一个 Promise.all 里,两处都写 data.role
      // 谁后返回谁赢 = 俱乐部入口显示与否不确定。roleGuard 是权限单一事实源(utils/roleGuard.js
      // 头注释),role 只由 loadRoleInfo 写;app 级角色仍由上面的 app.setUserRole 同步。
      var followStateChanged = !that.data.isSelf
        && (followMutationPending || followStateVersion !== (that._followStateVersion || 0));
      var responseUserInfo = res.data;
      if (followStateChanged) {
        responseUserInfo = Object.assign({}, res.data, {
          isFollow: that.data.userInfo && that.data.userInfo.isFollow
        });
      }
      var profilePatch = {
        userInfo: responseUserInfo,
        // 余额来自 /api/user/info 自己看自己那条分支(返回整个 UmsMember,balance 无 @JsonIgnore),
        // 不是新增请求 —— 「探索与更多」那句「钱包余量在现有接口里没有字段」对余额而言不成立。
        // 拿不到就给 null 让模板显示「—」:资金位上 0.00 是个断言,没查到不等于没有钱。
        balanceText: formatBalance(res.data.balance),
        cityName: parseCity(res.data) || '—',
        categoryList: isRecordList(res.data.sysCategoryList) ? res.data.sysCategoryList : [],
        casePicsList: pics,
        joinDate: formatJoinDate(res.data.createTime),
        // /api/user/info 当前没有 friendNum 契约。缺字段按 UI-04(2026-09-18 用户走查)落 0,
        // 不再落「—」。⚠️ metricNumber 缺值返回 null,而 WXML 的文本插值会把 null **原样
        // 打印成字面「null」**(2026-08-18 实测 A37/A42),所以展示层兜底必须给具体值。
        // 下面 userSignals 用的仍是数值原值,兜底只发生在展示层,不影响 ready/error 判定。
        friendNum: friendNum == null ? 0 : friendNum,
        followNum: followNum == null ? 0 : followNum,
        fansNum: fansNum == null ? 0 : fansNum
      };
      if (!that.data.isSelf && !followStateChanged) {
        profilePatch.growthLevel = res.data.levelId || 1;
        profilePatch.primaryCta = res.data.isFollow == 1 ? '已关注' : '关注';
      }
      that.setData(profilePatch);
      if (that.data.isSelf) {
        var userSignals = [followNum, fansNum, topicNum, activityNum, likeNum];
        var userSourceReady = userSignals.every(function (value) { return value != null; });
        that.recordProfileMetricSource('user', userSourceReady ? 'ready' : 'error', userSignals);
      }
    });
  },

  loadRoleInfo: function () {
    var that = this;
    return new Promise(function (resolve) {
      roleGuard.load(function (data) {
        if (data && data.role) {
          var isClubLeader = data.isClubLeader === true || data.role === 'club';
          that.setData({
            role: data.role,
            isClubLeader: isClubLeader,
            clubOwnedCount: Array.isArray(data.ownedClubs) ? data.ownedClubs.length : 0,
            benefits: buildBenefits(data.permission || {})
          });
          if (isClubLeader) that.loadClubSummary();
        }
        resolve();
      });
    });
  },

  loadClubSummary: function () {
    var that = this;
    req('/api/club/my', {}).then(function (res) {
      var owned = (res.code == '200' && res.data && res.data.owned) || [];
      if (owned && !Array.isArray(owned)) owned = [owned];
      that.setData({ clubOwnedCount: owned.length });
    });
  },

  loadGrowthBundle: function () {
    var that = this;
    return Promise.all([req('/api/play/growth', {}), req('/api/growth/center', {})]).then(function (arr) {
      var playOk = arr[0].code == '200' && arr[0].data;
      var centerOk = arr[1].code == '200' && arr[1].data && arr[1].data.growth;
      if (!playOk || !centerOk) {
        that.recordProfileMetricSource('growth', 'error');
        return;
      }
      var play = arr[0].data;
      var center = arr[1].data;
      var growth = center.growth;
      var level = metricNumber(play.level != null ? play.level : growth.levelNo);
      var exp = metricNumber(growth.expValue);
      var points = metricNumber(center.points);
      var shops = metricNumber(play.totalCheckins);
      var mileage = metricNumber(play.totalMileage);
      var streak = metricNumber(play.streakDays);
      if ([level, exp, points, shops, mileage, streak].some(function (value) { return value == null; })) {
        that.recordProfileMetricSource('growth', 'error');
        return;
      }
      var km = fmtKm(mileage);
      that.setData({
        growthLevel: Math.max(1, Math.round(level)),
        streakDays: streak,
        exploreValue: exp,
        profilePoint: points,
        identityCard: {
          shops: shops,
          themes: that.data.identityCard.themes,
          routes: (that.data.userInfo.topicNum || 0) + (that.data.userInfo.activityNum || 0),
          km: km,
          medals: that.data.identityCard.medals, // BE-01 勋章单真源:勋章数只由 loadMedals(/api/medal/wall)写,growth 不再返 badgeCount
          cities: 1
        },
        todayStats: {
          shops: Math.min(shops, streak > 0 ? 1 : 0),
          km: km,
          exp: Math.round(streak * 20)
        },
        'exploreStat.shops': shops
      });
      // 是否开始过只看历史参与信号(totalCheckins / my-completed),绝不拿里程是否为 0 判断。
      // 这样已完成节点但真实里程为 0.0km 的老用户仍进入 ready,不会被错藏成首访。
      that.recordProfileMetricSource('growth', 'ready', [shops, exp, points]);
    });
  },

  loadJoinData: function () {
    var that = this;
    return req('/api/registration/join_info', { member_id: app.getUserID() }).then(function (res) {
      if (res.code == '200' && res.data) that.setData({ joinInfo: res.data });
    });
  },

  loadThemes: function () {
    var that = this;
    return req('/api/play/my-completed', {}).then(function (res) {
      if (res.code != '200' || !isRecordList(res.data)) {
        that.recordProfileMetricSource('history', 'error');
        return;
      }
      var completed = res.data;
      var rows = completed.slice(0, 8).map(function (item, idx) {
        var total = item.total || 0;
        var done = item.doneCount || total;
        return {
          id: item.activityId,
          topicId: item.topicId,
          name: item.name || '城市主题',
          emoji: pickEmoji(item.name, THEME_EMOJI, idx),
          doneCount: done,
          total: total,
          percent: pct(done, total),
          completed: true
        };
      });
      that.setData({ themeProgress: rows, 'identityCard.themes': completed.length });
      // my-completed 还覆盖「已核销但没有节点打卡」的历史参与,补足 totalCheckins 的盲区。
      that.recordProfileMetricSource('history', 'ready', [completed.length]);
    });
  },

  loadRecommendations: function () {
    var that = this;
    return req('/api/recommendation/list', { candidate_type: 'topic', limit: 5 }).then(function (res) {
      var raw = (res.code == '200' && res.data) ? res.data : [];
      if (!Array.isArray(raw)) raw = raw.rows || raw.list || [];
      if (!isRecordList(raw)) raw = [];
      var list = raw.slice(0, 5).map(function (item) {
        return {
          id: item.id || item.topicId || item.candidateId,
          name: item.name || item.title || item.topicName || '推荐路线'
        };
      });
      that.setData({
        aiTip: {
          area: that.data.cityName || '附近街区',
          matchCount: list.length,
          themeName: list[0] ? list[0].name : ''
        }
      });
    });
  },

  loadMedals: function () {
    var that = this;
    return req('/api/medal/wall', {}).then(function (res) {
      // 原码失败即 return,medals 停在 [] → 渲染「完成城市节点即可点亮勋章」= 把失败说成没勋章
      if (res.code != '200' || !isRecord(res.data)
          || (res.data.medals != null && !isRecordList(res.data.medals))) {
        that.setData({ medalErr: true });
        return;
      }
      var medals = (res.data.medals || []).map(function (m) {
        var code = (m.badgeCode || m.medalCode || '').toLowerCase();
        return {
          templateId: m.templateId || m.medalId || m.badgeCode,
          medalName: m.medalName || m.badgeName || '城市勋章',
          medalImg: m.medalImg || m.iconUrl,
          emoji: MEDAL_EMOJI[code] || '🏅'
        };
      });
      that.setData({
        medalErr: false,
        medals: medals,
        medalCount: res.data.count || medals.length,
        'identityCard.medals': res.data.count || medals.length
      });
    });
  },

  loadPointsStat: function () {
    var that = this;
    return req('/api/user/points/statistics', {}).then(function (res) {
      if (res.code != '200' || !res.data) {
        that.recordProfileMetricSource('points', 'error');
        return;
      }
      var weekPoints = metricNumber(res.data.weekPoints);
      var rankPercentage = res.data.rankPercentage;
      if (weekPoints == null || typeof rankPercentage !== 'string' || !rankPercentage.trim()) {
        that.recordProfileMetricSource('points', 'error');
        return;
      }
      that.setData({
        pointsStat: {
          weekPoints: weekPoints,
          rankPercentage: rankPercentage
        },
        // shops 来自 play.totalCheckins = 历史累计签到,不是本周;exp 才是周值(weekPoints)。
        // 故此块按各自真实口径分别标注,别用一个「本周」把两种口径盖在一起。
        'exploreStat.weekExp': weekPoints,
        rankDisplay: {
          no: rankPercentage,
          delta: res.data.rankDelta ? ('上升 ' + res.data.rankDelta) : ''
        }
      });
      that.recordProfileMetricSource('points', 'ready', [weekPoints]);
    });
  },

  loadOrderPreview: function () {
    var that = this;
    return req('/api/registration/list', {
      pageNum: 1,
      pageSize: 8,
      owner_type: 3,
      status: '0'
    }).then(function (res) {
      // 原码把失败和「200 但没有订单」都收敛成 list=[] → 渲染「暂无订单」
      if (res.code != '200' || !res.data) {
        that.setData({ orderErr: true });
        return;
      }
      var rows = res.data.rows || [];
      if (!isRecordList(rows)) {
        that.setData({ orderErr: true });
        return;
      }
      var list = rows.slice(0, 8).map(function (item) {
        var topic = item.cmsActivity || item.cmsTopic || {};
        var pics = topic.pics ? String(topic.pics).split(';').filter(function (u) { return u.trim(); }) : [];
        var title = topic.name || item.topicName || '探索订单';
        var sub = item.createTime ? String(item.createTime).slice(0, 16).replace('T', ' ') : '报名订单';
        return { id: item.id, title: title, sub: sub, cover: topic.imgUrl || pics[0] || '' };
      });
      that.setData({ orderErr: false, orderPreviewList: withDevPreview(list, mockData.getDemoOrderPreviews) });
    });
  },

  // UI-7:预览原来只取第一页 8 条,这 8 条全结束时预览就是空的 —— 第二页的进行中项目
  // 用户永远看不到。接口(is_my=1)没有「未结束」过滤参数,所以这里按页取够:只在
  // 「本页零进行中且还有下一页」时继续翻,拿到 8 条进行中或翻完为止(接口口径不变)。
  // MAX_PAGES 是兜底:预览不值得为一个老账号翻几十页,5 页内没有进行中的就如实收起。
  loadProjectPreview: function () {
    var that = this;
    var PAGE_SIZE = 8;
    var MAX_PAGES = 5;
    var live = [];
    var fetched = 0;
    var sawRow = false;

    function render() {
      var list = live.slice(0, PAGE_SIZE).map(normalizeProjectPreview);
      // 取过项目、但一条未结束的都没有 ≠「还没有项目」:空态只说「已结束的收起了」,
      // 也不拿演示数据顶替。
      var allEnded = sawRow && list.length === 0;
      that.setData({
        projectErr: false,
        projectAllEnded: allEnded,
        projectPreviewList: allEnded ? [] : withDevPreview(list, demoProjectPreviewList)
      });
    }

    function fetchPage(pageNum) {
      return req('/api/topic/list', {
        is_my: 1,
        pageNum: pageNum,
        pageSize: PAGE_SIZE
      }).then(function (res) {
        // 原码失败也走 withDevPreview:生产退成 [] → 渲染「还没有项目」;dev 还会拿演示数据
        // 顶上去,把失败演成「有数据」= 比空态更坏。失败一律进错误态,不喂演示数据。
        if (res.code != '200' || !res.data) {
          that.setData({ projectErr: true });
          return;
        }
        var rows = res.data.rows || [];
        if (!isRecordList(rows)) {
          that.setData({ projectErr: true });
          return;
        }
        fetched += 1;
        if (rows.length) sawRow = true;
        rows.forEach(function (item) {
          if (live.length >= PAGE_SIZE) return;
          if (isLiveProject(item)) live.push(item);
        });
        var total = Number(res.data.total);
        var hasNextPage = rows.length >= PAGE_SIZE
          && (Number.isFinite(total) ? fetched * PAGE_SIZE < total : true);
        if (live.length >= PAGE_SIZE || !hasNextPage || fetched >= MAX_PAGES) {
          render();
          return;
        }
        return fetchPage(pageNum + 1);
      });
    }

    return fetchPage(1);
  },

  buildDerivedState: function () {
    var join = this.data.joinInfo || {};
    var activeName = '';

    if (join.id > 0) {
      var topic = join.ownerType == 1 ? join.cmsTopic : join.cmsActivity;
      activeName = topic && topic.name ? topic.name : '';
      var actId = join.ownerType == 2 && join.cmsActivity ? join.cmsActivity.id : join.activityId;
      var existing = this.data.themeProgress.slice();
      if (activeName && !existing.some(function (t) { return t.id == actId; })) {
        existing.unshift({
          id: actId,
          name: activeName,
          emoji: pickEmoji(activeName, THEME_EMOJI, 0),
          doneCount: 0,
          total: 0,
          percent: 0,
          completed: false
        });
      }
      this.setData({ themeProgress: existing });
    }

    this.setData({
      primaryCta: this.data.isMerchantView ? '核销' : '开始探索'
    });
  },

  // cy-tabs 切换:组件 change 事件带 { key }
  onTabChange: function (e) {
    var tab = e.detail.key;
    if (!tab || tab === this.data.activeTab) return;
    this.setData({ activeTab: tab });
    if (tab === 'posts' && this.data.list.length === 0) {
      this.setData({ page_no: 1 });
      this.getCreativesquareList();
    }
  },

  // 积分任务弹窗:静态说明文案升级为动态任务列表(/api/points/result_list,后台积分规则真源)
  onPointsHelp: function () {
    this.setData({ 'pointsSheet.show': true });
    this.openScene('points-tasks');
    this.loadPointsTasks();
  },
  onPointsSheetClose: function () {
    this.closeScene();
  },
  // 出参口径:value=每次得分;pointsNum 被后端复写为「我已获得次数」(见 ApiPointsController.resultList)
  loadPointsTasks: function () {
    var that = this;
    var sheet = that.data.pointsSheet;
    if (sheet.loading) return;
    that.setData({ 'pointsSheet.loading': !sheet.loaded, 'pointsSheet.failed': false });
    req('/api/points/result_list', {}).then(function (res) {
      if (res.code != '200' || !res.data) {
        // 首次加载失败给显式失败态(可点重试);已有列表则保留旧数据不打扰
        that.setData({ 'pointsSheet.loading': false, 'pointsSheet.failed': !that.data.pointsSheet.loaded });
        return;
      }
      var tasks = [];
      for (var i = 0; i < res.data.length; i++) {
        var r = res.data[i];
        // 只列赚分任务:启用中;event_type=14(解锁提示)是花分规则,不属于任务
        if (Number(r.status) !== 1 || Number(r.eventType) === 14) continue;
        tasks.push({
          id: r.id,
          eventType: r.eventType,
          title: r.title || '',
          description: r.description || '',
          points: Number(r.value) || 0,
          doneCount: Number(r.pointsNum) || 0
        });
      }
      that.setData({ 'pointsSheet.tasks': tasks, 'pointsSheet.loading': false, 'pointsSheet.loaded': true });
    });
  },

  onPrimaryCta: function () {
    if (!this.data.isSelf) {
      this.toggleFollow();
      return;
    }
    if (this.data.isMerchantView) {
      this.goScanQR();
      return;
    }
    // 玩家主按钮"开始探索" = 直接进漫游(2026-07-31:和下方"游玩"分组功能重复,已删该分组)
    this.goRoam();
  },

  goSignup: function () {
    wx.navigateTo({ url: '/subpackageMember/signup/index' });
  },

  toggleFollow: function () {
    var that = this;
    // UI-12(2026-09-18 用户定):公开视角主按钮统一为「关注」,被看者是商家也照常关注,
    // 不再挡 subjectIsMerchant;本人视角不渲染这颗钮,进不到这里。
    if (that._following) return;
    if (that.data.previewSelf && String(app.getUserID() || '') === String(that.data.userId || '')) {
      cyToast('预览中，不能关注自己');
      return;
    }
    if (!that.data.userId) {
      if (app.tips) app.tips('用户不存在');
      return;
    }
    that._following = true;
    // 请求发出前冻结这次操作的目标；期间任何资料读回都不能改变成功回调的方向。
    var intendedFollow = that.data.userInfo && that.data.userInfo.isFollow == 1 ? 0 : 1;
    that._followStateVersion = (that._followStateVersion || 0) + 1;
    var followEpoch = that._followEpoch || 0;
    that.setData({ followSubmitting: true, followReceipt: false });
    req('/api/user/follow/action', { follow_member_id: that.data.userId, follow: intendedFollow }).then(function (res) {
      if (followEpoch !== (that._followEpoch || 0)) return;
      that._following = false;
      if (res.code != '200') {
        that.setData({ followSubmitting: false, followReceipt: false });
        cyToast(res.msg || '操作失败');
        return;
      }
      var nextFollow = intendedFollow;
      // CU-M-36:成功后同屏粉丝数跟着 ±1(原来要退出重进才变),与按钮状态同一时刻更新。
      var fans = Math.max(0, (Number(that.data.userInfo && that.data.userInfo.fansNum) || 0) + (nextFollow ? 1 : -1));
      that.setData({
        'userInfo.isFollow': nextFollow,
        'userInfo.fansNum': fans,
        fansNum: fans,
        primaryCta: nextFollow ? '已关注' : '关注',
        followSubmitting: false,
        followReceipt: nextFollow === 1
      });
      cyToast(nextFollow ? '关注成功' : '已取消关注');
    });
  },

  onStartChat: function () {
    var that = this;
    if (that.data.subjectIsMerchant) return;
    var target = this.data.userId;
    if (!target) {
      if (app.tips) app.tips('用户不存在');
      return;
    }
    app.sendRequest({
      url: '/api/im/start',
      method: 'POST',
      hideLoading: true,
      data: { target_member_id: target },
      success: function (res) {
        if (res && res.code == 200 && res.data && res.data.conversationId) {
          var ui = that.data.userInfo || {};
          wx.navigateTo({
            url: '/subpackageB/pages/im/chat/index?conversationId=' + res.data.conversationId +
              '&name=' + encodeURIComponent(ui.nickname || '') +
              '&avatar=' + encodeURIComponent(ui.avatar || '') + '&type=1'
          });
          return;
        }
        if (app.tips) app.tips((res && res.msg) || '无法发起会话');
      },
      fail: function () {
        if (app.tips) app.tips('网络异常，请重试');
      }
    });
  },

  goScanQR: function () {
    var that = this;
    wx.scanCode({
      success: function (res) {
        var scan = resolveVerificationScan(res.result);
        if (scan.kind === 'invalid') {
          cyToast(scan.message);
          return;
        }
        that._submitVerification(scan.url + ':' + scan.code, scan.loadingTitle, {
          url: scan.url,
          data: scan.data,
          method: 'POST',
          // [P0-2] 本页自己接管错误提示,压掉 request-client 对 code!=200 的自动 toast:
          // 选章那条返的就是 error(核销确实没发生),不压会在弹出选章面板前先闪一条失败 toast。
          // 真错误照旧由下面的 else 分支弹,信息不丢。
        }, function (r) {
            var d = r.data || {};
            // ★ [P0-2] 判据是**载荷**不是 code —— 后端对「需要选章」永久返 error,
            //   因为选章没完成 = 核销没发生。这里若改判 code,会把选章当成普通失败弹掉,
            //   商家就永远核销不了(而这正是修复前的形态:只判 code==200 ⇒ 弹「验票成功」)。
            if (d.needChapterChoice) {
              that.openChapterSheet(scan.code, d);
              return;
            }
            if (d.needStationChoice) {
              that.openStationSheet(scan.code, d);
              return;
            }
            if (r.code == '200') {
              // P3-2:重复核销不是成功新动作,口径与商家工作台一致(重复核销,非成功图标)。
              var verdict = resolveVerificationResult(r, scan.successTitle || '核销');
              if (verdict.state === 'duplicate') {
                cyToast(verdict.title + '：' + verdict.message, { icon: 'none' });
                return;
              }
              cyToast.success(completionReceiptMessage(r, scan.successTitle));
            } else {
              cyToast(r.msg || '核销失败');
            }
        });
      }
    });
  },

  /**
   * [P0-2] 交集 ≥2 ⇒ 让商家自己选章。
   * 一商家在同一路线承接多章是**常态**(uk_offer_merchant_chapter 只约束一商家一章一行,
   * 不阻止一商家多章)⇒ 这不是边界情况。后端绝不默默取第一个:选错章不可逆。
   */
  openChapterSheet: function (code, d) {
    // chapters 带名字(后端 describeChapters)。回落 chapterIds 是为了「后端还没部署到位」的
    // 那段窗口:宁可显示「章节 101」也不能给个空面板 —— 空面板商家会以为卡死。
    var items = (Array.isArray(d.chapters) && d.chapters.length)
      ? d.chapters
      : (Array.isArray(d.chapterIds) ? d.chapterIds : []).map(function (id) { return { id: id, name: '章节 ' + id }; });
    if (!items.length) {
      cyToast('没有可核销的章节');
      return;
    }
    this.setData({ chapterSheet: { show: true, code: code, items: items } });
    this.openScene('member-chapter-picker');
  },

  onChapterSheetClose: function () {
    this.closeScene();
  },

  onChapterPick: function (e) {
    var id = e.currentTarget.dataset.id;
    var code = this.data.chapterSheet.code;
    this.closeScene();
    this._submitVerification('/chapter:' + code + ':' + id, '核销中...', {
      url: '/api/registration/scan_qr_code_chapter',
      data: { code: code, chapterId: id },
      method: 'POST',
    }, function (r) {
        var ok = r.code == '200';
        if (ok) motion.haptic({ type: 'medium', reducedMotion: readReducedMotion() });
        cyToast(ok ? completionReceiptMessage(r, '核销成功') : (r.msg || '核销失败'), { icon: ok ? 'success' : 'none' });
    });
  },

  openStationSheet: function (code, d) {
    var items = Array.isArray(d.stations) ? d.stations : [];
    if (!items.length) {
      cyToast('没有可核销的据点');
      return;
    }
    this.setData({ stationSheet: { show: true, code: code, items: items } });
    this.openScene('member-station-picker');
  },

  onStationSheetClose: function () {
    this.closeScene();
  },

  onStationPick: function (e) {
    var registrationMerchantId = e.currentTarget.dataset.registrationMerchantId;
    var code = this.data.stationSheet.code;
    this.closeScene();
    this._submitVerification('/station:' + code + ':' + registrationMerchantId, '核销中...', {
      url: '/api/registration/scan_qr_code_station',
      data: { code: code, registrationMerchantId: registrationMerchantId },
      method: 'POST',
    }, function (r) {
        var ok = r.code == '200';
        if (ok) motion.haptic({ type: 'medium', reducedMotion: readReducedMotion() });
        cyToast(ok ? completionReceiptMessage(r, '核销成功') : (r.msg || '核销失败'), { icon: ok ? 'success' : 'none' });
    });
  },

  // AI 推荐「开始探索」保留探索语义:有进行中的场次→游玩,否则回探索首页
  onExplore: function () {
    // FE-19 D-4:有进行中场次 → 去票夹开始游玩;否则回探索首页(play 统一从票夹进入)
    var join = this.data.joinInfo || {};
    if (join.id > 0) {
      wx.navigateTo({ url: '/subpackageMember/signup/index' });
      return;
    }
    wx.switchTab({ url: '/pages/index/index' });
  },

  goRoam: function () { wx.switchTab({ url: '/pages/roam/index' }); },

  onThemeTap: function (e) {
    // FE-19 D-4:游玩统一从票夹进入
    wx.navigateTo({ url: '/subpackageMember/signup/index' });
  },

  onAiStart: function () { this.onExplore(); },

  onCompare: function () {
    wx.navigateTo({ url: '/subpackageP3/pages/growthcenter/index/index' });
  },

  openScene: function (id, params) {
    var next = getScene(id, params || {});
    if (id === 'share-invite') next.theme = this.data.isMerchantView ? 'merchant' : 'player';
    if (exitDecision(this.data.sceneStack, 'close') === 'confirm') {
      this.setData({ sceneConfirm: { show: true, action: 'replace', pending: next } });
      return false;
    }
    var sceneStack = pushScene(this.data.sceneStack, next);
    this.setData({ sceneStack: sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
    return true;
  },
  backScene: function () {
    if (exitDecision(this.data.sceneStack, 'back') === 'confirm') {
      this.setData({ sceneConfirm: { show: true, action: 'back', pending: null } });
      return;
    }
    var sceneStack = popScene(this.data.sceneStack);
    this.setData({ sceneStack: sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
  },
  closeScene: function () {
    this.setData({ sceneStack: [], sceneCurrent: null, sceneConfirm: { show: false, action: null, pending: null } });
  },
  requestSceneClose: function () {
    if (exitDecision(this.data.sceneStack, 'close') === 'confirm') {
      this.setData({ sceneConfirm: { show: true, action: 'close', pending: null } });
      return;
    }
    this.closeScene();
  },
  confirmSceneDiscard: function () {
    var sceneStack;
    if (this.data.sceneConfirm.action === 'back') {
      sceneStack = popScene(this.data.sceneStack);
      this.setData({ sceneStack: sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
      return;
    }
    if (this.data.sceneConfirm.action === 'replace' && this.data.sceneConfirm.pending) {
      sceneStack = pushScene(this.data.sceneStack, this.data.sceneConfirm.pending);
      this.setData({ sceneStack: sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
      return;
    }
    this.closeScene();
  },
  cancelSceneDiscard: function () {
    this.setData({ sceneConfirm: { show: false, action: null, pending: null } });
  },
  setSceneDirty: function (dirty) {
    if (!this.data.sceneStack.length) return;
    var sceneStack = this.data.sceneStack.slice();
    sceneStack[sceneStack.length - 1] = Object.assign({}, sceneStack[sceneStack.length - 1], { dirty: dirty === true });
    this.setData({ sceneStack: sceneStack, sceneCurrent: currentScene(sceneStack) });
  },
  onSceneDirtyChange: function (event) {
    this.setSceneDirty(event.detail && event.detail.dirty);
  },
  openChildScene: function (event) {
    var detail = event.detail || {};
    if (detail.id) this.openScene(detail.id, detail.params || {});
  },
  submitSceneForm: function () {
    var content = this.selectComponent('#sceneRouteContent');
    if (content && typeof content.submitForm === 'function') content.submitForm();
  },
  openStampCamera: function () {
    this.closeScene();
    wx.navigateTo({ url: '/subpackageP3/pages/stamp-camera/index/index' });
  },
  blockSceneTouch: function () {},

  openMerchantNpcChat: function () {
    // 再判一次开关:data 里的值是组件创建时的快照,而 features 是启动时异步拉的 ——
    // 组件先于拉取完成创建时快照是 false,拉完不会自动回填。这里读实时值。
    if (!(getApp().globalData.features || {}).merchantNpcChat) return;
    this.setData({ merchantNpcChatShow: true });
  },

  closeMerchantNpcChat: function () {
    this.setData({ merchantNpcChatShow: false });
  },

  openMoreMenu: function () { this.openScene('member-more-menu'); },
  closeMoreMenu: function () { this.closeScene(); },

  onShareProfile: function () {
    this.closeMoreMenu();
    cyToast('点击右上角分享主页');
  },


  onChangeHeroBg: function () {
    var that = this;
    this.closeMoreMenu();
    app.chooseImage(function (urls) {
      if (!urls || !urls.length) return;
      var url = urls[0];
      wx.setStorageSync('member_hero_bg', url);
      that.setData({ heroImg: url });
      cyToast.success('背景已更新');
    }, 1, { crop: true, cropScale: '16:9' });
  },

  onMoreSetting: function () {
    this.closeMoreMenu();
    wx.navigateTo({ url: '/pages/shezhi/shezhi' });
  },

  // CU-M-43(2026-09-23 用户裁决 B):onBlock 随「屏蔽」入口一起摘掉 —— 原来只弹一句
  //「已屏蔽」,没有请求也没有持久化,重进无状态变化。接上写路径前不带这条假成功。

  getCreativesquareList: function () {
    var that = this;
    var data = {
      is_my: that.data.isSelf ? 1 : 0,
      pageNum: that.data.page_no,
      pageSize: app.getPageSize()
    };
    if (!that.data.isSelf) data.user_id = that.data.userId;
    req('/api/creativesquare/list', data).then(function (res) {
      // 原码把失败显式写成 nodata=true → 渲染「还没有动态,发布一次城市发现吧」
      if (res.code != '200') {
        that.setData({ hasMore: false, feedErr: true });
        return;
      }
      var result = isRecord(res.data) ? res.data : {};
      var newlist = result.rows || [];
      if (!isRecordList(newlist)) {
        that.setData({ hasMore: false, feedErr: true });
        return;
      }
      newlist.forEach(function (row) {
        if (row.pics) row.picList = String(row.pics).split(';').filter(function (pic) { return pic; });
        if (row.createTime) row.formattedCreateTime = that.formatTimeDifference(row.createTime);
      });
      var merged = that.data.page_no === 1 ? newlist : that.data.list.concat(newlist);
      that.setData({
        feedErr: false,
        list: merged,
        hasMore: app.getTotalPage(result.total || 0, app.getPageSize()) > that.data.page_no,
        nodata: merged.length < 1
      });
    });
  },

  // cy-error 的重试:各自只重拉自己那条链路,不整页刷新(别的区块的数据没坏,不该被连坐)
  reloadOrders: function () { this.loadOrderPreview(); },
  reloadProjects: function () { this.loadProjectPreview(); },
  reloadProfileMetrics: function () {
    this.resetProfileMetricState();
    return Promise.all([
      this.loadUserData(),
      this.loadGrowthBundle(),
      this.loadThemes(),
      this.loadPointsStat()
    ]);
  },

  // C7:我的项目入口待处理角标(未通过+审核中;/api/publish/home projectSummary 无草稿档)
  loadProjectPending: function () {
    var that = this;
    return req('/api/publish/home', {}).then(function (res) {
      if (res.code != '200' || !res.data || !res.data.projectSummary) return;
      var s = res.data.projectSummary;
      that.setData({ projectPendingCount: (s.pending || 0) + (s.rejected || 0) });
    });
  },
  reloadMedals: function () { this.loadMedals(); },
  reloadFeed: function () {
    this.setData({ page_no: 1 });
    this.getCreativesquareList();
  },

  onFeedReachBottom: function () {
    if (!this.data.hasMore || this.data.activeTab !== 'posts') return;
    this.setData({ page_no: this.data.page_no + 1 });
    this.getCreativesquareList();
  },

  lickClick: function (e) {
    var that = this;
    var index = e.currentTarget.dataset.index;
    var type = e.currentTarget.dataset.type;
    var item = that.data.list[index];
    if (!item) return;
    req('/api/creativesquare/like', { id: item.id, type: type }).then(function (res) {
      if (res.code != '200') {
        cyToast(app.getRequestErrorMessage(res, '操作失败'));
        return;
      }
      var current = that.data.list[index];
      if (type == 1) {
        if (current.isLiked == 0) { current.likeCount = (current.likeCount || 0) + 1; current.isLiked = 1; }
        else if (current.isLiked == 1) { current.likeCount = (current.likeCount || 1) - 1; current.isLiked = 0; }
        else if (current.isLiked == 2) { current.likeCount = (current.likeCount || 0) + 1; current.isLiked = 1; }
      } else {
        if (current.isLiked == 0) current.isLiked = 2;
        else if (current.isLiked == 1) { current.likeCount = (current.likeCount || 1) - 1; current.isLiked = 2; }
        else if (current.isLiked == 2) current.isLiked = 0;
      }
      that.setData({ ['list[' + index + ']']: current });
    });
  },

  favoriteClick: function (e) {
    var that = this;
    var index = e.currentTarget.dataset.index;
    var item = that.data.list[index];
    if (!item) return;
    var requestKey = String(item.id);
    that._favoriteRequests = that._favoriteRequests || Object.create(null);
    if (that._favoriteRequests[requestKey]) return;
    that._favoriteRequests[requestKey] = true;
    var next = item.isBookmarked == 1 ? 0 : 1;
    req('/api/creativesquare/bookmark', {
      id: item.id,
      bookmark: next,
      request_id: 'bookmark-' + item.id + '-' + next + '-' + Date.now().toString(36)
    }).then(function (res) {
      delete that._favoriteRequests[requestKey];
      if (res.code != '200') {
        cyToast(app.getRequestErrorMessage(res, '操作失败'));
        return;
      }
      that.setData({ ['list[' + index + '].isBookmarked']: next });
    });
  },

  goBack: function () {
    var pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.switchTab({ url: '/pages/index/index' });
  },
  onAvatarTap: function () {
    if (this.data.isSelf) this.goUserInfo();
  },
  goSetting: function () { wx.navigateTo({ url: '/pages/shezhi/shezhi' }); },
  // 直达个人资料真页。原来跳的是 `shezhi?scene=settings-profile` —— 那会让「设置」一进去就
  // 盖一层弹窗(2026-08-08 用户提「点到设置不要弹这个弹窗」),而弹窗里是 scene-route-content
  // 的通用表单,只有昵称+邮箱,pages/gerenziliao 那 390 行的头像/介绍/标签全没了。
  // 2026-08-20 用户定:商家视角个人资料与店铺装修合并,编辑头像/资料一律进店铺装修。
  goUserInfo: function () {
    if (this.data.isMerchantView) { wx.navigateTo({ url: '/pages/merchant/decor/index' }); return; }
    wx.navigateTo({ url: '/pages/gerenziliao/gerenziliao' });
  },
  // CU-M-28:这一块显示的是会员本人的 introduction,编辑必须进个人资料;
  // goUserInfo 在商家视角会去品牌中心,那里没有「个人介绍」字段。
  goEditIntro: function () { wx.navigateTo({ url: '/pages/gerenziliao/gerenziliao' }); },
  // FE-14 商家店铺资料收编进「我的」更多菜单(原 shanghuziliao 页保留即重定向)
  goShop: function () { this.closeScene(); wx.navigateTo({ url: '/pages/merchant/decor/index' }); },
  // 访客看商家主页的底部「发起合作」:与 club/detail onInviteMerchant 同链路(coop/invite type=0,
  // toId=memberId)。userId 在商家主页语境下就是对方 memberId。
  onCoopInvite: function () {
    var toId = this.data.userId;
    if (!toId) { cyToast('该商家暂不可对接'); return; }
    var q = ['type=0', 'toId=' + toId];
    var m = this.data.subjectMerchant;
    if (m && m.name) q.push('toName=' + encodeURIComponent(m.name));
    if (m && m.logo) q.push('toLogo=' + encodeURIComponent(m.logo));
    if (m) {
      var merchantMeta = m.suitActivityTypes || m.address || m.cityRole || '';
      if (merchantMeta) q.push('toMeta=' + encodeURIComponent(merchantMeta));
    }
    if (this.data.topicId) q.push('topicId=' + this.data.topicId);
    if (this.data.topicName) q.push('topicName=' + encodeURIComponent(this.data.topicName));
    if (this.data.operationScope === 'MERCHANT') q.push('scope=MERCHANT');
    wx.navigateTo({ url: '/pages/coop/invite/index?' + q.join('&') });
  },
  goOrder: function () { wx.navigateTo({ url: '/subpackageMember/order/order' }); },
  goProject: function () { wx.navigateTo({ url: '/subpackageA/pages/myproject/index' }); },
  onOrderPreviewTap: function (e) {
    var id = e.currentTarget.dataset.id;
    // 订单详情是「订单」二级页的子场景;一级「我的」先进入父页,由父页托管返回关系。
    if (id) wx.navigateTo({ url: '/subpackageMember/order/order?detailId=' + encodeURIComponent(String(id)) });
    else this.goOrder();
  },
  onProjectPreviewTap: function (e) {
    // projectPreviewList 源为 /api/topic/list?is_my=1(仅 topic),故单卡直达主题详情;无 id 兜底进 myproject
    var id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/topic/index/index?id=' + id });
    else this.goProject();
  },
  goMyJoin: function () { wx.navigateTo({ url: '/subpackageMember/mycanyu/mycanyu' }); },
  goGrowthCenter: function () { wx.navigateTo({ url: '/subpackageP3/pages/growthcenter/index/index' }); },
  goWall: function () { wx.navigateTo({ url: '/subpackageP3/pages/badge-wall/index/index' }); },
  goAlbum: function () { wx.navigateTo({ url: '/subpackageP3/pages/stamp-album/index/index' }); },
  goObjectCards: function () { wx.navigateTo({ url: '/subpackageP3/pages/object-cards/index/index' }); },
  // 当前权益里可点的行(收益提现→提现页;承接原 role/center 对赚钱角色 role!==player 的提现入口,按 withdrawable 权限门控)
  onBenefitTap: function (e) {
    var ds = e.currentTarget.dataset;
    if (ds.route && ds.unlocked) wx.navigateTo({ url: ds.route });
  },
  goInvite: function () { this.openScene('share-invite'); },
  goComplaint: function () { wx.navigateTo({ url: '/subpackageMember/complaint/index' }); },
  goEarnings: function () { wx.navigateTo({ url: '/subpackageA/pages/assetcenter/earnings/index' }); },
  goMerchantTeam: function () { wx.navigateTo({ url: '/pages/merchant/team/index' }); },
  goClubWorkbench: function () { wx.navigateTo({ url: '/pages/club/detail/index?owner=1&tab=manage' }); },
  goCoupon: function () { wx.navigateTo({ url: '/subpackageMember/coupon-wallet/index' }); },
  goClub: function () {
    wx.navigateTo({ url: this.data.clubOwnedCount >= 1 ? '/pages/club/detail/index?owner=1' : '/pages/club/create/index' });
  },
  goBecomeTalent: function () {
    cyLoading.show('加载中');
    req('/api/club/my', {}).then(function (res) {
      cyLoading.hide();
      var owned = (res.code == '200' && res.data && res.data.owned) || [];
      if (owned && !Array.isArray(owned)) owned = [owned];
      if (owned.length >= 1) wx.navigateTo({ url: '/pages/club/detail/index?id=' + ((owned[0] && owned[0].id) || '') });
      else if (roleGuard.isClubLeader()) wx.navigateTo({ url: '/pages/club/create/index' });
      else wx.navigateTo({ url: '/pages/club/apply/index' });
    });
  },
  jumpDetail: function (e) {
    var activity = this.data.list[e.currentTarget.dataset.index];
    if (activity) wx.navigateTo({ url: '/pages/square/detail/index?id=' + activity.id });
  },

  previewImage: function (e) {
    var picList = e.currentTarget.dataset.piclist;
    var index = e.currentTarget.dataset.index;
    wx.previewImage({ current: picList[index], urls: picList });
  },

  previewMerchantGallery: function (e) {
    var src = e.currentTarget.dataset.src;
    if (src) wx.previewImage({ current: src, urls: this.data.merchantGallery || [src] });
  },

  goMerchantLocation: function () {
    var m = this.data.subjectMerchant || {};
    // 现算不用 merchantHasGeo:那个只喂样式,导航要的是坐标本身,两者从同一个
    // 函数出,不存在「样式说可点、这里取不到值」的错位。
    var geo = merchantCoordinate(m);
    if (!geo) return;
    // 左边是 wx.openLocation 的入参名,右边是实体字段换算出来的值 —— 别把两层混了
    wx.openLocation({
      latitude: geo.latitude,
      longitude: geo.longitude,
      name: m.name || '商家',
      address: m.address || '',
      scale: 18
    });
  },

  // 招牌主推卡落点(4-12):活动进活动详情,券进券夹 —— 与据点页
  // (scene-roam-poi-detail 的 play-activity-detail / game-coupon-wallet)同一目标。
  // 卡片不可点(actionable=false)时不动,不给假跳转。
  goFeatured: function () {
    var f = this.data.featured || {};
    if (f.featuredType === 1 && f.featuredId) {
      wx.navigateTo({ url: '/pages/activity/detail/index?id=' + f.featuredId });
      return;
    }
    if (f.featuredType === 2) wx.navigateTo({ url: '/subpackageMember/coupon-wallet/index' });
  },

  goMerchantReviews: function () {
    var merchantRowId = Number(this.data.subjectMerchant && this.data.subjectMerchant.id);
    if (!Number.isFinite(merchantRowId) || merchantRowId <= 0) {
      cyToast('该商家评价暂不可查看');
      return;
    }
    wx.navigateTo({
      url: '/pages/merchant/reviews/index?merchantRowId=' + encodeURIComponent(merchantRowId)
    });
  },

  previewWork: function (e) {
    var url = e.currentTarget.dataset.url;
    wx.previewImage({ current: url, urls: this.data.casePicsList });
  },

  formatTimeDifference: function (createTimeStr) {
    if (!createTimeStr) return '';
    var diff = Date.now() - toTimestamp(createTimeStr);
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    var minutes = Math.floor((diff % 3600000) / 60000);
    if (days > 0) return days + '天前';
    if (hours > 0) return hours + '时' + minutes + '分前';
    if (minutes > 0) return minutes + '分前';
    return '刚刚';
  },

  getSharePayload: function (res) {
    if (res.from === 'button' && res.target && res.target.dataset && res.target.dataset.shareKind === 'invite') {
      return {
        title: '一起探索城市里的新玩法',
        path: '/pages/index/index?inviter=' + app.getUserID()
      };
    }
    if (res.from === 'button') {
      return { title: '城瘾 · 城市探索', path: '/pages/square/detail/index?id=' + res.target.dataset.id };
    }
    if (!this.data.isSelf) {
      return {
        title: (this.data.userInfo.nickname || '探索者') + ' 的城市主页',
        path: '/pages/userinfo/userinfo?userId=' + this.data.userId
      };
    }
    return {
      title: (this.data.userInfo.nickname || '我') + ' 的城市身份卡',
      path: '/pages/member/index/index'
    };
  }
  }
});
