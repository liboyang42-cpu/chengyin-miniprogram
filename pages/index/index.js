const modal = require('../../utils/modal.js');
const cyLoading = require('../../utils/loading.js');
const cyToast = require('../../utils/toast.js');
const { readPageStyle } = require('../../utils/font-scale.js');
const { toTimestamp } = require('../../utils/datetime');
const app = getApp();
const { applyTheme } = require('../../utils/theme.js');
const policy = require('../../utils/identity/identity-policy.js');
const indexFormat = require('../../utils/index/index-format.js');
const { decorateFeedCards } = require('../../utils/index/feed-card.js');
const { buildContinueExplore, buildContinueGame } = require('../../utils/index/continue-explore.js');
const { buildHomeActionBanners, openHomeActionBanner } = require('../../utils/index/home-action-banner.js');
const { readReducedMotion } = require('../../utils/motion-preference.js');
const { openScene } = require('../../utils/scene-entry.js');
const { parseDoorScene, pathForScanEntry } = require('../../utils/game-door-entry.js');

const { buildActivityShare } = require('../../utils/activity-share.js');
const { isRecordList } = require('../../utils/response-shape.js');
const { isValidMobile } = require('../../utils/form-state.js');

function boundPhoneFromResponse(res) {
  if (!res) return '';
  var candidates = [];
  if (typeof res.data === 'string') candidates.push(res.data);
  if (res.data && typeof res.data === 'object' && typeof res.data.phone === 'string') {
    candidates.push(res.data.phone);
  }
  if (typeof res.msg === 'string') candidates.push(res.msg);
  for (var i = 0; i < candidates.length; i++) {
    var phone = String(candidates[i]).trim();
    if (isValidMobile(phone)) return phone;
  }
  return '';
}

// A-01:邀请落地参数兼容两种键 —— 分享端现有两处都产 ?inviter=,但早期卡片是 ?id=,
// 老卡片仍在外面流通;读取端两个都认(只改分享端会让存量卡片继续丢邀请关系)。
function readInviterId(options) {
  if (!options) return '';
  return options.inviter || options.id || '';
}

// 视角分流快照:role(RBAC 单一真源)+ user_type(过渡兜底)+ debug_user_view(仅展示)。
function viewSnap() {
  return {
    role: wx.getStorageSync('role'),
    userType: wx.getStorageSync('user_type'),
    debugView: wx.getStorageSync('debug_user_view'),
  };
}

// 身份分流统一交给 identity-policy(镜像后端 resolveRole:role 优先、user_type==2 兜底;
// debug_user_view='user' 仅强制玩家展示)。三处分流(data 初始化/onLoad/onShow)同源,消除各页不一致。
function isMerchantView() {
  return policy.isMerchantView(viewSnap());
}

const MERCHANT_HOME = '/pages/merchant/index/index';

// 跳商家首页的唯一出口。四处身份分流(onLoad 同步 / onShow 同步 / 登录落地复判 /
// /api/user/info 兜底)共用:路由字符串只写一处,且失败不再静默 —— 原先四处 redirectTo
// 都没有 fail 回调,导航被框架丢掉时零信号。这条日志同时是诊断闸:若"先进玩家首页"
// 修完仍复现,它能分清是「没判出商家」还是「判出了却没跳成」。
function goMerchantHome() {
  wx.redirectTo({
    url: MERCHANT_HOME,
    fail() { console.error('[identity] 跳转商家首页失败'); },
  });
}

function normalizeMemberId(memberId) {
  return memberId || '';
}

function clearPrivateDisplay(page) {
  page.setData({
    userInfo: { avatar: '', nickname: '', point: '0' },
    continueExplore: null,
    showPhoneModal: false,
  });
}

function capturePrivateRequest(page, memberId) {
  const normalizedMemberId = normalizeMemberId(memberId);
  if (page._privateDataMemberId !== normalizedMemberId) {
    page._privateDataMemberId = normalizedMemberId;
    page._privateDataEpoch = (page._privateDataEpoch || 0) + 1;
    clearPrivateDisplay(page);
  }
  return page._privateDataEpoch || 0;
}

function isCurrentPrivateRequest(page, memberId, requestEpoch) {
  const currentMemberId = normalizeMemberId(app.getUserID());
  if (page._privateDataMemberId !== currentMemberId) {
    capturePrivateRequest(page, currentMemberId);
  }
  return (page._privateDataEpoch || 0) === requestEpoch
    && currentMemberId === normalizeMemberId(memberId);
}

function invalidatePrivateRequests(page, clearDisplay = true) {
  page._privateDataEpoch = (page._privateDataEpoch || 0) + 1;
  if (clearDisplay) clearPrivateDisplay(page);
}

function captureLocationRequest(page) {
  const scope = {
    epoch: (page._locationEpoch || 0) + 1,
    memberId: normalizeMemberId(app.getUserID()),
  };
  page._locationEpoch = scope.epoch;
  return scope;
}

function isCurrentLocationRequest(page, scope) {
  return !!scope
    && !page._unloaded
    && scope.epoch === (page._locationEpoch || 0)
    && scope.memberId === normalizeMemberId(app.getUserID());
}

function hideLocationLoading(page, scope) {
  if (!scope || page._locationLoadingEpoch !== scope.epoch) return;
  page._locationLoadingEpoch = null;
  cyLoading.hide();
}

// 即将上线倒计时格式化:>1天→还剩Nd,<1天→还剩Nh,已过→已开始(红)。不到分秒。
function fmtRemain(startDateStr) {
  if (!startDateStr) return { remainingTime: '', started: false };
  const diff = toTimestamp(String(startDateStr)) - Date.now();
  if (diff <= 0) return { remainingTime: '已开始', started: true };
  const days = Math.floor(diff / 86400000);
  if (days >= 1) return { remainingTime: `还剩${days}d`, started: false };
  const hours = Math.max(1, Math.floor(diff / 3600000));
  return { remainingTime: `还剩${hours}h`, started: false };
}

const RECO_INACTIVE_SCALE = 280 / 306;
const RECO_BLUR_PX = 8;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function recoCardStyle(focus) {
  const normalizedFocus = clamp01(focus);
  const deEmphasis = 1 - normalizedFocus;
  const scale = RECO_INACTIVE_SCALE + (1 - RECO_INACTIVE_SCALE) * normalizedFocus;
  return `--reco-card-scale:${scale.toFixed(4)};--reco-mask-opacity:${deEmphasis.toFixed(4)};--reco-blur:${(RECO_BLUR_PX * deEmphasis).toFixed(2)}px;`;
}

function buildRecoCardStyles(count, current, target, progress) {
  const normalizedProgress = clamp01(progress);
  return Array.from({ length: count }, function (_, index) {
    let focus = index === current ? 1 - normalizedProgress : 0;
    if (index === target) focus = normalizedProgress;
    return recoCardStyle(focus);
  });
}

// feed/卡片多图:发布页(publish/fabu)写入的 imgArr 与章节同为 "," 分隔，历史数据也有 ";"。
// 两种分隔符都吃，避免把整串 "a.jpg,b.jpg" 当成一个坏 URL。
function decorateImgs(list) {
  // 首页五类列表共用这条图片消费者链：
  // 统一拆分逗号/分号格式，避免整串落成一个坏 URL；
  // 统一补全后端相对路径，附近活动不再出现有数据无图；
  // feed 只拿前四张，并保留真实总数计算 +N；
  // nearby/upcoming 都从同一个 cover 取首图；
  // `decorateFeedCards` 无 wx 依赖，契约测试可直接驱动。
  const normalizeImage = function (src) {
    return app.getImgUrl(src);
  };

  // 页面入口只注入 URL 规则，不复制纯函数里的卡片判定。
  return decorateFeedCards(
    list,
    normalizeImage,
  );
}

// 开发版首页 UI 预览假数据(对齐 Figma 3579:11316,用 index-figma 切图)
function buildIndexUiMock() {
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const iso = function (offsetMs) {
    const d = new Date(Date.now() + offsetMs);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
      + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00';
  };
  const feedGrid = '/images/home-route-city-placeholder.jpg;/images/home-route-free-placeholder.jpg;/images/index-figma/nearby-card.jpg;/images/index-figma/reco-hero.jpg;/images/home-banner-2.jpg';
  const nearby = decorateImgs([
    { id: 90001, name: 'WINDS OF DESTINY', imgUrl: '/images/index-figma/nearby-card.jpg', formattedDateTime: '今晚 20:00', addressName: '黄浦·外滩源', distance: '1.2km', started: true, startDate: iso(-3600000) },
    { id: 90002, name: '霓虹夜行解谜', imgUrl: '/images/index-figma/nearby-card.jpg', formattedDateTime: '6月2日 19:30', addressName: '静安·静安寺', distance: '0.8km', startDate: iso(86400000) },
    { id: 90003, name: '苏州河畔寻踪', imgUrl: '/images/home-route-city-placeholder.jpg', formattedDateTime: '6月3日 14:00', addressName: '普陀·苏州河', distance: '2.5km', startDate: iso(172800000) },
    { id: 90004, name: '老城厢漫步', imgUrl: '/images/home-route-free-placeholder.jpg', formattedDateTime: '6月4日 10:00', addressName: '黄浦·豫园', distance: '3.1km', startDate: iso(259200000) },
  ]);
  const recommendedTopicList = decorateImgs([
    {
      id: 70001,
      name: '城市夜跑 外滩 7 公里',
      imgArr: '/images/index-figma/reco-hero.jpg',
      imgUrl: '/images/index-figma/reco-hero.jpg',
      formattedDateTime: '6/8 19:00',
      addressName: '外滩观景台',
      enrollCount: 86,
      clubName: '夜行者俱乐部',
      sysCategoryList: [{ categoryName: '运动健身' }, { categoryName: '城市探索' }],
      startDate: iso(-1800000),
    },
    {
      id: 70002,
      name: '外滩光影解谜之夜',
      imgArr: '/images/home-route-free-placeholder.jpg',
      imgUrl: '/images/home-route-free-placeholder.jpg',
      formattedDateTime: '6月8日 20:00',
      addressName: '外滩源',
      sysCategoryList: [{ categoryName: '文化叙事' }],
    },
  ]);
  const upcomingRaw = [
    { id: 80001, name: 'Ladies Bird Movie', imgUrl: '/images/index-figma/nearby-card.jpg', formattedDateTime: '6月6日 22:00', addressName: '黄浦·外滩 SOHO', startDate: iso(259200000) },
    { id: 80002, name: '午夜霓虹 · 音乐现场', imgUrl: '/images/home-route-city-placeholder.jpg', formattedDateTime: '6月7日 21:00', addressName: '静安·现场音乐厅', startDate: iso(432000000) },
    { id: 80003, name: '苏州河跨年夜行', imgUrl: '/images/home-route-free-placeholder.jpg', formattedDateTime: '6月10日 22:00', addressName: '普陀·苏州河', startDate: iso(86400000) },
  ];
  const upcomingActivityList = decorateImgs(upcomingRaw.map(function (item) {
    const r = fmtRemain(item.startDate);
    return Object.assign({}, item, { remainingTime: r.remainingTime, started: r.started });
  }));
  const bottomTopicList = decorateImgs([
    { id: 71001, name: 'Skipass 城市定向', productType: 1, imgArr: feedGrid, feedBadgeCount: 2, minAmout: '68.00', formattedDateTime: '2025年6月12日 周四 下午07:00', addressName: 'AlpenGlide Resort', sysCategoryList: [{ categoryName: '亲子' }, { categoryName: '解谜' }] },
    { id: 71002, name: '街角密码 · 黄昏版', productType: 2, imgArr: '/images/index-figma/nearby-card.jpg;/images/index-figma/reco-hero.jpg;/images/home-route-city-placeholder.jpg', minAmout: '0.00', formattedDateTime: '2025年6月13日 周五 下午06:30', addressName: '静安寺商圈', sysCategoryList: [{ categoryName: '漫步' }] },
    { id: 71003, name: '单图路线预览', productType: 1, imgArr: '/images/home-route-city-placeholder.jpg', minAmout: '38.00', formattedDateTime: '2025年6月14日 周六 下午02:00', addressName: '外滩源', sysCategoryList: [{ categoryName: '城市探索' }] },
  ]);
  const bottomActivityList = decorateImgs([
    { id: 72001, name: '派对在城市之巅', productType: 2, imgArr: feedGrid, minAmout: '128.00', formattedDateTime: '2025年6月14日 周六 下午10:00', addressName: '陆家嘴观景台', sysCategoryList: [{ categoryName: '夜场' }] },
  ]);
  return {
    userInfo: { avatar: '/images/d_profile.png', nickname: 'Sarah', point: '1280' },
    nearbyActivityList: nearby,
    recommendedTopicList: recommendedTopicList,
    upcomingActivityList: upcomingActivityList,
    bottomTopicList: bottomTopicList,
    bottomActivityList: bottomActivityList,
    hasMoreBottomTopic: false,
    hasMoreBottomActivity: false,
  };
}

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 下拉刷新转圈态(scroll-view refresher)
    refreshing: false,
    privacyGateShow: false,
    // 身份分流：商户在首页 tab 渲染前直接跳商户首页，避免玩家首页闪一帧
    // debug_user_view='user' 强制使用普通用户视角（调试用）
    _needsRedirect: isMerchantView(),
    city: '',
    isAppReady: false,
    isLoading: true,
    userInfo: {
      avatar: '',
      nickname: '',
      point: '0',
    },

    // 列表加载失败标记(按 listName 索引)。错误与空态必须分开:
    // 失败时列表停在 [],光判 length 会渲染成「本来就没有」甚至「正在加载」。
    listErr: {},
    // 首次加载和重试都必须立即给反馈；否则网络慢时用户点“重试”看起来完全没生效。
    listLoading: {},

    // 分页相关数据
    bottomTopicPageNo: 1,
    bottomActivityPageNo: 1,
    hasMoreBottomTopic: false,
    hasMoreBottomActivity: false,
    isBottomLoading: false,
    // A-14-2:底部信息流加载失败的行内重试。存「失败的是第几页」,0 = 无错误;
    // wxml 据此在列表底部渲染 cy-inline-error,重试沿用失败页而不是从头再拉。
    bottomTopicFailedPage: 0,
    bottomActivityFailedPage: 0,
    pageSize:20,
    
    // 倒计时相关
    countdownTimer: null, // 倒计时定时器
    countdownInterval: 60000, // 更新间隔60秒（1分钟）
    
    // 其他数据保持不变
    recommendedTopicList: [],
    nearbyActivityList: [],
    upcomingActivityList: [],
    continueExplore: null,
    bottomTopicList: [],
    bottomActivityList: [],
    _navUp: false,  // 底部导航:首屏隐藏,向下滑动升起
    // 顶栏对齐胶囊 + 滚动区高度
    capsuleTop: 0,   // 状态栏高度(px),品牌行 padding-top → 和胶囊同高
    heroActionsTop: 52,
    heroActionsRight: 16,
    heroActionsReserve: 68,
    scrollH: 0,      // 主滚动区高度(px) = 全屏可视高
    heroBannerH: 480, // 启动占位；同步布局后固定为视口 60%，让附近任务在首屏露出
    reducedMotion: false,  // 读玩家路径共享的动效偏好;true 时 hero 入场不播
    heroBannerList: buildHomeActionBanners(),
    recoHero: null,
    recoCards: [],
    recoCurrent: 0,
    recoCardStyles: [],
    bannerCurrent: 0,
    activeTab: '0',
    showPhoneModal: false,
    locationInfo: {
      latitude: 0,
      longitude: 0,
      address: '正在解析地址...'
    }
  },

  // 隐私授权闸:app.js 优先调这里(真弹窗),没有这个方法的页面才回退到 /pages/privacy 路由页。
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const that = this;
    this._unloaded = false;

    // 门口游戏码优先：没报名去买主题，已报名进游玩。不能先被商家分流吃掉 scene。
    if (this.consumeDoorScene(options)) return;

    // 身份分流：商户直接跳商户首页，不渲染玩家首页
    // 必须实时判断（isMerchantView 实时读 storage），不能用 data 里的静态 _needsRedirect（模块加载时求值，之后不变）
    if (isMerchantView()) {
      goMerchantHome();
      return;
    }

    // data 初值可能在旧角色快照下创建；玩家分支必须显式解除隐藏闸，
    // 否则从商家切回玩家时根节点仍停留在 wx:if="{{!_needsRedirect}}" 的黑空页。
    that.setData({ _needsRedirect: false });

    // 能力模型(2026-06-27):不再因 isClubLeader 自动跳转到俱乐部管理台。
    // 主理人默认仍是玩家首页;管理台由首页底Tab/入口按钮主动进入。

    // 处理分享链接中的邀请人ID:先存下,等 appReady(登录落地)后再发一次。
    // 典型被邀请人=新用户,onLoad 时还没有会话;当场调用会被 handleInviter 的登录闸挡掉,
    // 且此后无人重试 → 邀请关系永久丢失(A-01)。
    const inviterId = readInviterId(options);
    if (inviterId) that._pendingInviter = inviterId;

    app.waitForAppReady().then(() => {
      // 登录落地后才知道真实身份:冷缓存冷启动时上面那次同步判定手里根本没有角色快照
      // (restore() 拿不到、登录是异步的),商家会停在玩家首页直到下一次 onShow ——
      // 2026-08-10 用户真机(体验版)实测的正是这个。必须排在 loadPageData/getFuzzyLocation
      // 之前,否则商家先被弹一次定位授权框再被跳走。
      // 本页已不是栈顶(用户自己切走了)就别抢导航。
      if (that._unloaded) return;
      if (isMerchantView()) {
        const stack = getCurrentPages();
        if (stack[stack.length - 1] === that) {
          that.setData({ _needsRedirect: true });
          goMerchantHome();
          return;
        }
      }
      that.setData({ isAppReady: true });
      that.loadPageData();
      that.getFuzzyLocation();
      that.retryPendingInviter();
    }).catch(err => {
      if (that._unloaded) return;
      console.error('等待app初始化失败');
      cyToast('加载失败，请重试');
    });

    // 初始化关键位置（只执行一次）
    that._layoutChrome();   // 胶囊对齐 + 分屏高度(同步,首屏即正确)
    that.setData({ reducedMotion: readReducedMotion() });

    // 启动倒计时定时器
    that.startCountdownTimer();
  },

  consumeDoorScene(options) {
    const code = parseDoorScene(options && options.scene) || parseDoorScene(app.pendingDoorScene);
    app.pendingDoorScene = null;
    if (!code) return false;
    if (this._doorSceneLast === code) return !!this._doorSceneInFlight;
    this._doorSceneLast = code;
    this._doorSceneInFlight = true;
    const that = this;
    this.setData({ _needsRedirect: true });
    app.waitForAppReady().then(() => {
      if (that._unloaded) return;
      app.sendRequest({
        url: '/api/play/scan-entry',
        method: 'POST',
        data: { code },
        hideLoading: true,
        success(res) {
          const path = pathForScanEntry(res && res.data);
          if ((res.code == 200 || res.code == '200') && path) {
            that._doorSceneInFlight = false;
            wx.redirectTo({
              url: path,
              fail() { wx.reLaunch({ url: path }); },
            });
            return;
          }
          cyToast((res && res.msg) || '这张码暂时打不开');
          that.finishDoorSceneFallback();
        },
        fail() {
          cyToast('这张码暂时打不开');
          that.finishDoorSceneFallback();
        },
      });
    }).catch(() => {
      if (that._unloaded) return;
      cyToast('这张码暂时打不开');
      that.finishDoorSceneFallback();
    });
    return true;
  },

  finishDoorSceneFallback() {
    this._doorSceneInFlight = false;
    if (this._unloaded) return;
    if (isMerchantView()) {
      goMerchantHome();
      return;
    }
    this.setData({ _needsRedirect: false, isAppReady: true });
    this.loadPageData();
    this.getFuzzyLocation();
  },

  // A-01:登录落地后补发一次邀请关系(onLoad 时新用户还没有 currentUserId)。
  retryPendingInviter() {
    const inviterId = this._pendingInviter;
    if (!inviterId || this._unloaded) return;
    this._pendingInviter = '';
    this.handleInviter(inviterId);
  },

  /**
   * 处理邀请人逻辑
   */
  handleInviter: function(inviterId) {
    const that = this;
    const hasInviter = wx.getStorageSync('has_inviter');
    const currentUserId = app.getUserID();
    
    // 分享 path 里的 id 是字符串,getUserID() 是数字 —— 不归一化的话「自己点自己的卡片」判不出来
    if (currentUserId && !hasInviter && String(inviterId) !== String(currentUserId)) {
      app.sendRequest({
        url: '/api/user/setInviter',
        method: "POST",
        data: { inviter_id: inviterId },
        success: function (res) {
          if (res.code == "200") {
            wx.setStorageSync('has_inviter', true);
          }
        }
      });
    }
  },

  /**
   * 启动倒计时定时器
   */
  startCountdownTimer: function() {
    const that = this;
    
    // 清除已有的定时器
    if (that.data.countdownTimer) {
      clearInterval(that.data.countdownTimer);
    }
    
    // 每60秒更新一次倒计时（1分钟）
    const timer = setInterval(() => {
      that.updateUpcomingActivitiesCountdown();
    }, that.data.countdownInterval);
    
    that.setData({ countdownTimer: timer });
  },

  /**
   * 更新即将上线活动的倒计时
   */
  updateUpcomingActivitiesCountdown: function() {
    const that = this;
    const upcomingList = that.data.upcomingActivityList;
    
    if (!upcomingList || upcomingList.length === 0) {
      return;
    }
    
    let updated = false;

    // 更新每个活动的倒计时(缩写格式:还剩Nd / 还剩Nh / 已开始)
    const updatedList = upcomingList.map(item => {
      if (!item.startDate) return item;
      const r = fmtRemain(item.startDate);
      if (item.remainingTime !== r.remainingTime || item.started !== r.started) {
        updated = true;
      }
      return Object.assign({}, item, { remainingTime: r.remainingTime, started: r.started });
    });
    
    // 如果有更新，则设置数据
    if (updated) {
      that.setData({
        upcomingActivityList: updatedList
      });
    }
  },

  /**
   * 确保倒计时定时器正在运行
   */
  ensureCountdownTimerRunning: function() {
    const that = this;
    
    if (!that.data.countdownTimer) {
      that.startCountdownTimer();
    }
  },

  /**
   * 页面显示时 - 修复返回页面时的问题
   */
  onShow() {
    this.setData({ fontScaleStyle: readPageStyle() });
    wx.hideTabBar();

    const that = this;

    // 热启动扫小程序码只在 App.onShow 收下 pending。这里消费一次就清掉。
    if (this.consumeDoorScene()) return;
    if (this._doorSceneInFlight) return;

    // 身份分流：每次进首页 tab 都同步检查一次身份
    // (冷启动时登录可能还在途、此处判不出商家;那一路由 onLoad 的 waitForAppReady 复判兜住)
    if (isMerchantView()) {
      this.setData({ _needsRedirect: true });
      goMerchantHome();
      return;
    }

    // onShow 也要复位旧快照留下的隐藏闸，确保角色切换后页面可见。
    this.setData({ _needsRedirect: false });

    // 确认留在首页后,保持深色:状态栏/导航切深色(白字)。离开首页时 onHide 复位浅色。
    applyTheme('dark');

    // 兜底：拉一次 /api/user/info，覆盖跨设备升级商户的场景
    const roleMemberId = normalizeMemberId(app.getUserID());
    const roleRequestEpoch = capturePrivateRequest(this, roleMemberId);
    if (roleMemberId && wx.getStorageSync('debug_user_view') !== 'user') {
      app.sendRequest({
        hideLoading: true,
        url: '/api/user/info',
        data: { member_id: roleMemberId },
        method: 'POST',
        success(res) {
          if (!isCurrentPrivateRequest(that, roleMemberId, roleRequestEpoch)) return;
          if (res.code == '200' && res.data) {
            if (res.data.role) app.setUserRole(res.data); // 回填含能力快照(role+isClubLeader...)
            // 能力模型:不再因 isClubLeader 自动跳管理台;主理人仍走首页。
            if (policy.isMerchantView({ role: res.data.role, userType: res.data.userType })) {
              app.setUserType(2);
              goMerchantHome();
            }
          }
        }
      });
    }

    if (this._onShowRefreshTimer) clearTimeout(this._onShowRefreshTimer);
    this._onShowRefreshTimer = setTimeout(() => {
      this._onShowRefreshTimer = null;
      // 刷新用户数据（可选）
      if (that.data.isAppReady) {
        that.getUserData();
        that.loadContinueExplore();
      }

      // 重新启动倒计时定时器
      if (that.data.upcomingActivityList && that.data.upcomingActivityList.length > 0) {
        that.startCountdownTimer();
      }
    }, 100);
  },

  /**
   * 页面隐藏时
   */
  onHide() {
    // 全站暗色默认:离开首页保持深色导航/状态栏(后续页同为暗底)。
    applyTheme('dark');

    if (this._onShowRefreshTimer) {
      clearTimeout(this._onShowRefreshTimer);
      this._onShowRefreshTimer = null;
    }

    // 清除倒计时定时器以节省资源
    if (this.data.countdownTimer) {
      clearInterval(this.data.countdownTimer);
      this.setData({ countdownTimer: null });
    }
  },

  /**
   * 页面卸载时 - 清除计时器
   */
  onUnload() {
    this._unloaded = true;
    this._locationEpoch = (this._locationEpoch || 0) + 1;
    if (this._locationLoadingEpoch != null) {
      this._locationLoadingEpoch = null;
      cyLoading.hide();
    }
    if (this._onShowRefreshTimer) {
      clearTimeout(this._onShowRefreshTimer);
      this._onShowRefreshTimer = null;
    }
    if (this._recoTransitionUnlockTimer) {
      clearTimeout(this._recoTransitionUnlockTimer);
      this._recoTransitionUnlockTimer = null;
    }
    // 清除倒计时定时器
    if (this.data.countdownTimer) {
      clearInterval(this.data.countdownTimer);
      this.setData({ countdownTimer: null });
    }
    invalidatePrivateRequests(this, false);
    const listControls = this._listControls || {};
    // 先让全部旧回调失效，再 abort。微信 abort 可能同步触发 fail/complete；
    // 顺序反过来会在页面卸载过程中继续 setData。
    this._listEpoch = Object.create(null);
    this._bannerEpoch = (this._bannerEpoch || 0) + 1;
    Object.keys(listControls).forEach(function (key) {
      const control = listControls[key];
      if (control && typeof control.abort === 'function') control.abort();
    });
    this._listControls = Object.create(null);
  },

  /**
   * 切换标签页
   */
  switchTab(e) {
    const index = e.detail.key;
    const that = this;
    
    
    // 更新activeTab
    that.setData({ activeTab: index });
    
    if (index === '0') {
      // 切换到主题
      if (that.data.bottomTopicList.length === 0) {
        that.setData({
          bottomTopicPageNo: 1,
          hasMoreBottomTopic: false,
          bottomTopicList: []
        }, () => {
          that.loadBottomTopicList(1, true);
        });
      }
    } else if (index === '1') {
      // 切换到活动
      if (that.data.bottomActivityList.length === 0) {
        that.setData({
          bottomActivityPageNo: 1,
          hasMoreBottomActivity: false,
          bottomActivityList: []
        }, () => {
          that.loadBottomActivityList(1, true);
        });
      }
    }
  },

  goUser(e){
    wx.switchTab({
      url: '/pages/member/index/index',
    })
  },

  /* ⚠️ 首页主体是整屏 <scroll-view style="height:{{scrollH}}px">,**页面自身永远不滚动**,
   * app.json 的 enablePullDownRefresh 在这里点不着 —— 与 pages/merchant/index 同因,
   * 所以同样走 scroll-view 自带的 refresher。
   * 收圈时机:loadPageData 里那一批请求各自独立、都不返回 promise,给一个确定的收起时机,
   * 否则要么永远转圈,要么得改动七八个 load 方法的签名。 */
  onRefresh: function () {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    this.loadPageData();
    setTimeout(() => this.setData({ refreshing: false }), 800);
  },

  loadPageData: function () {
    const that = this;

    that.getUserData();


    // 固定行动 Banner 不再请求后台随机图。
    that.loadContinueExplore();


    // 推荐主题只取人工推荐位，避免与底部全量主题重复。
    that.getListData('recommendedTopicList', '/api/topic/list', {
      pageNum: 1,
      pageSize: 5, is_recommend: 1,
    });

    // 即将上线
    that.getListData('upcomingActivityList', '/api/activity/list', {
      is_my:2,
      status: 2,
      pageNum: 1,
      pageSize: 4,
      sort_type: 2,
    });

    // 底部主题 - 初始化第一页（设置pageSize为2）
    that.setData({
      bottomTopicPageNo: 1,
      hasMoreBottomTopic: false,
      bottomTopicList: []
    }, () => {
      that.loadBottomTopicList(1, true);
    });

    // 底部活动 - 初始化第一页
    that.setData({
      bottomActivityPageNo: 1,
      hasMoreBottomActivity: false,
      bottomActivityList: []
    }, () => {
      that.loadBottomActivityList(1, true);
    });
    
    // 附近活动:有定位用经纬度排序;无定位(模拟器/未授权)回退拉通用活动(先放上海内容),不再空着
    if (that.data.locationInfo.latitude && that.data.locationInfo.longitude) {
      that.getListData('nearbyActivityList', '/api/activity/list', {
        is_my: 0,
        sort_type: 1,
        pageNum: 1,
        pageSize: 4,
        longitude: that.data.locationInfo.longitude,
        latitude: that.data.locationInfo.latitude
      });
    } else {
      that.getListData('nearbyActivityList', '/api/activity/list', {
        is_my: 0,
        sort_type: 2,
        pageNum: 1,
        pageSize: 4,
      });
    }
  },
  
  onReady() {
    this._buildRecoHero();
    // heroBannerList 在 data 里已经是同一份冻结常量(见上方 data 初始化),
    // 这里再 setData 一次只是白渲染一帧。
    this._applyIndexUiMock();
  },

  // 开发版注入首页假数据,便于预览 Figma UI(体验版/正式版不执行)
  _applyIndexUiMock() {
    if (!(app.isDevEnv && app.isDevEnv())) return;
    const mock = buildIndexUiMock();
    // 开发工具也必须忠实呈现游客态；公开列表可以用预览数据，私人身份不能伪造。
    if (!normalizeMemberId(app.getUserID())) delete mock.userInfo;
    this.setData(mock, () => {
      this.updateUpcomingActivitiesCountdown();
      this.ensureCountdownTimerRunning();
      this._buildRecoHero();
      this._buildHeroBanners();
    });
  },

  _applyIndexUiMockIfEmpty(listName, list) {
    if (!(app.isDevEnv && app.isDevEnv())) return list;
    if (list && list.length) return list;
    const mock = buildIndexUiMock();
    return mock[listName] || list;
  },

  // 计算固定顶栏对齐胶囊 + 滚动区高度
  _layoutChrome() {
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const winW = sys.windowWidth || 375;
    let capsuleTop = sys.statusBarHeight || 20;
    let heroActionsTop = 52;
    let heroActionsRight = 16;
    let heroActionsReserve = 68;
    try {
      const cap = wx.getMenuButtonBoundingClientRect();
      if (cap && cap.top) {
        capsuleTop = cap.top;
        heroActionsTop = Math.round(cap.top + cap.height + 8);
        heroActionsRight = Math.max(16, Math.round(winW - cap.right));
        heroActionsReserve = heroActionsRight + 52;
      }
    } catch (e) {}
    this._recoSnapPx = winW * 650 / 750;
    const winH = sys.screenHeight || sys.windowHeight;
    // 2026-07-31:banner 高度回归到改坏前的 6/7 屏(此前被误收到 60vh,见 git 历史)。
    const heroBannerH = Math.round(winH * 3 / 5);
    this.setData({
      capsuleTop,
      heroActionsTop, heroActionsRight, heroActionsReserve,
      scrollH: Math.round(winH),
      heroBannerH,
    });
  },

  // 首页行动 Banner：固定业务入口，不再由后台随机图覆盖。
  _buildHeroBanners() {
    this.setData({ heroBannerList: buildHomeActionBanners() });
  },

  // Figma 3579:11316 — 为你专属推荐主题 Hero
  _buildRecoHero() {
    const items = (this.data.recommendedTopicList || []).slice(0, 5);
    if (!items.length) {
      this.setData({ recoHero: null, recoCards: [], recoCurrent: 0, recoCardStyles: [] });
      return;
    }
    const cards = items.map(function (item) {
      const tags = (item.sysCategoryList || []).map(function (t) { return t.categoryName; }).filter(Boolean);
      const enroll = item.signupCount || item.enrollCount || item.joinCount || item.signUpCount;
      const metaParts = [];
      if (enroll) metaParts.push('🔥 ' + enroll + ' 人已报名');
      if (item.formattedDateTime) metaParts.push(item.formattedDateTime);
      const started = item.startDate && fmtRemain(item.startDate).started;
      return {
        id: item.id,
        name: item.name,
        cover: item.cover || item.imgUrl,
        tags: tags,
        clubLabel: item.clubName || item.merchantName || tags[0] || '',
        clubAvatar: item.clubAvatar || item.merchantAvatar || item.cover,
        statusLabel: started ? '进行中' : '',
        betaFlag: item.betaFlag == 1 ? 1 : 0,
        metaLine: metaParts.join(' · ') || item.addressName || '',
      };
    });
    const current = Math.min(this.data.recoCurrent || 0, cards.length - 1);
    this.setData({
      recoHero: cards[0],
      recoCards: cards,
      recoCurrent: current,
      recoCardStyles: buildRecoCardStyles(cards.length, current, -1, 0),
    });
  },

  onHeroBannerTap(e) {
    const idx = e.currentTarget.dataset.inx;
    const item = (this.data.heroBannerList || [])[idx];
    if (!item) return;
    if (item._type === 'action') {
      openHomeActionBanner(wx, item);
    }
  },

  // banner 轮播切换
  onBannerChange(e) {
    const cur = (e.detail && e.detail.current) || 0;
    if (cur !== this.data.bannerCurrent) this.setData({ bannerCurrent: cur });
  },

  onRecoTransition(e) {
    const count = this.data.recoCards.length;
    if (count < 2 || this.data.reducedMotion || this._recoTransitionLocked) return;
    const dx = Number(e.detail && e.detail.dx) || 0;
    const progress = clamp01(Math.abs(dx) / (this._recoSnapPx || 1));
    const current = this.data.recoCurrent || 0;
    const direction = dx < 0 ? 1 : -1;
    const target = progress ? (current + direction + count) % count : -1;
    this.setData({ recoCardStyles: buildRecoCardStyles(count, current, target, progress) });
  },

  _lockRecoTransitionTail() {
    this._recoTransitionLocked = true;
    if (this._recoTransitionUnlockTimer) clearTimeout(this._recoTransitionUnlockTimer);
    this._recoTransitionUnlockTimer = setTimeout(() => {
      this._recoTransitionLocked = false;
      this._recoTransitionUnlockTimer = null;
    }, 360);
  },

  onRecoChange(e) {
    const count = this.data.recoCards.length;
    const current = Math.max(0, Math.min(count - 1, Number(e.detail && e.detail.current) || 0));
    this._lockRecoTransitionTail();
    this.setData({
      recoCurrent: current,
      recoCardStyles: buildRecoCardStyles(count, current, -1, 0),
    });
  },

  // 主滚动区
  onMainScroll(e) {
    const top = (e.detail && e.detail.scrollTop) || 0;
    this._lastTop = top;
    const navUp = top > 120;
    if (navUp !== this.data._navUp) this.setData({ _navUp: navUp });
  },

  // 滚动容器触底 → feed 分页加载
  onPagerLower() {
    this.onReachBottom();
  },

  // ========== /整屏分页 ==========

  onShareAppMessage: function (res) {
    if (res.from === 'button') {
      const dataset = res.target.dataset;
      const shareType = dataset.type;
      const id = dataset.id;
      const name = dataset.name;
      const imageUrl = dataset.img;
      
      let path = '';
      let title = '';
      
      if (shareType === 'topic') {
        path = `/pages/topic/index/index?id=${id}`;
        title = `推荐路线：${name}`;
      } else if (shareType === 'activity') {
        const activityShare = buildActivityShare({ id, name: `推荐场次：${name}`, imgUrl: imageUrl });
        path = activityShare.path;
        title = activityShare.title;
      }
      
      return {
        title: title,
        path: path,
        imageUrl: imageUrl,
        success: function (res) {
          cyToast.success('分享成功');
        },
        fail: function (res) {
          // 原文案「分享取消」把失败说成用户主动取消 —— 这是 fail 分支,不是 cancel。
          cyToast('没能分享出去，请重试');
        }
      };
    }
    
    return {
      title: '城瘾Hub',
      path: '/pages/index/index',
      success: function (res) {
        cyToast.success('分享成功');
      }
    };
  },

  goRecoHero: function (e) {
    const index = Number(e && e.currentTarget && e.currentTarget.dataset.index);
    const cards = this.data.recoCards || [];
    if (cards.length > 1 && Number.isInteger(index) && index !== this.data.recoCurrent) {
      this._lockRecoTransitionTail();
      this.setData({
        recoCurrent: index,
        recoCardStyles: buildRecoCardStyles(cards.length, index, -1, 0),
      });
      return;
    }
    const hero = cards[index] || this.data.recoHero;
    if (!hero || !hero.id) return;
    wx.navigateTo({ url: '/pages/topic/index/index?id=' + hero.id });
  },

  goActivity: function (e) {
    const id = e.currentTarget.dataset.id;
    if (id) openScene('play-activity-detail', { id });
  },

  goTopic: function (e) {
    wx.navigateTo({
      url: '/pages/topic/index/index?id=' + e.currentTarget.dataset.id,
    })
  },

  getPhoneNumber: function (e) {
    const that = this;
    
    if (e.detail.errMsg === "getPhoneNumber:ok") {
      const { code } = e.detail;
      const memberId = normalizeMemberId(app.getUserID());
      const requestEpoch = capturePrivateRequest(that, memberId);
      
      cyLoading.show('获取中...');
      
      app.sendRequest({
        url: '/api/getwxbindphone',
        method: "POST",
        data: { code: code },
        success: function (res) {
          cyLoading.hide();
          if (!isCurrentPrivateRequest(that, memberId, requestEpoch)) return;
          if (res.code == "200") {
            var phone = boundPhoneFromResponse(res);
            if (!phone) {
              cyToast(res.msg || '获取手机号失败');
              return;
            }
            that.setData({
              'userInfo.phone': phone,
              showPhoneModal: false
            });
          } else {
            cyToast(res.msg || '获取手机号失败');
          }
        },
        fail: function (res) {
          cyLoading.hide();
          if (!isCurrentPrivateRequest(that, memberId, requestEpoch)) return;
          cyToast('网络错误，请重试');
        }
      });
    } else {
      this.setData({ showPhoneModal: false });
      cyToast('您已取消授权');
    }
  },

  closePhoneModal() {
    this.setData({ showPhoneModal: false });
  },

  getUserData: function () {
    const that = this;
    const memberId = normalizeMemberId(app.getUserID());
    const requestEpoch = capturePrivateRequest(that, memberId);
    if (!that._getUserDataRetryCount) that._getUserDataRetryCount = 0;
    if (!memberId) {
      // 游客是合法状态；登录管理器自己负责落地/重试，这里不能把“尚无身份”误报成过期。
      that._getUserDataRetryCount = 0;
      that.setData({ isLoading: false });
      return;
    }
    app.sendRequest({
      hideLoading: true,
      url: '/api/user/info',
      data: { member_id: memberId },
      method: "POST",
      success: function (res) {
        if (!isCurrentPrivateRequest(that, memberId, requestEpoch)) return;
        that._getUserDataRetryCount = 0;  // 成功后重置,避免下次调用从陈旧计数开始
        if (res && res.code == "200" && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
          that.setData({ userInfo: res.data, isLoading: false });
          if (!res.data.phone || res.data.phone === '') {
            that.setData({ showPhoneModal: true });
          }
        } else if (res && res.code == "401") {
          that.firstLogin();
        } else {
          app.setOpenID(null);
          app.tips((res && res.msg) || '用户信息加载失败');
          that.setData({ isLoading: false });
        }
      },
      fail: function (res) {
        if (!isCurrentPrivateRequest(that, memberId, requestEpoch)) return;
        that.setData({ isLoading: false });
      }
    })
  },
  
  firstLogin: function (e) {
    // 委托单航班登录管理器(与 app.reLogin/sendRequest 401 共享在途锁),
    // 由 session-manager 统一解析双层 data 并对「无 data」做空值守卫,页面不再裸取 res.data.data。
    var that = this;
    invalidatePrivateRequests(that);
    app.reLogin(function (ok) {
      if (ok) {
        that.loadPageData();
      }
    });
  },

  // 重试:cy-error 的 retry 事件带 data-list=<listName>,回放该列表最后一次请求。
  retryList: function (e) {
    const listName = e.currentTarget.dataset.list;
    const req = this._listReq && this._listReq[listName];
    if (!req) return;
    this.getListData(listName, req.url, req.params, req.processor);
  },

  // 首页第二屏只显示已报名且仍在进行中的真实记录；点击回票夹的对应卡片，
  // 继续沿用既有报名/游玩权限判断，避免首页绕过业务链路。
  loadContinueExplore: function () {
    const that = this;
    const memberId = normalizeMemberId(app.getUserID());
    const requestEpoch = capturePrivateRequest(that, memberId);
    if (!memberId) {
      return;
    }
    // 第二轮拍板 22:进行中的游戏会话优先占这张卡(换手机登录也能从首页继续),没有才显示报名旅程。
    let journey = null;
    let game = null;
    const apply = function () { that.setData({ continueExplore: game || journey }); };
    app.sendRequest({
      hideLoading: true,
      url: '/api/registration/my-joined',
      method: 'POST',
      data: {},
      success: function (res) {
        if (!isCurrentPrivateRequest(that, memberId, requestEpoch)) return;
        journey = res && (res.code == 200 || res.code == '200') ? buildContinueExplore(res.data) : null;
        apply();
      },
      fail: function () {
        if (!isCurrentPrivateRequest(that, memberId, requestEpoch)) return;
        journey = null;
        apply();
      }
    });
    app.sendRequest({
      hideLoading: true,
      url: '/api/play/run-session/list',
      method: 'GET',
      data: {},
      success: function (res) {
        if (!isCurrentPrivateRequest(that, memberId, requestEpoch)) return;
        game = res && (res.code == 200 || res.code == '200') ? buildContinueGame(res.data) : null;
        apply();
      },
      fail: function () {
        if (!isCurrentPrivateRequest(that, memberId, requestEpoch)) return;
        game = null;
        apply();
      }
    });
  },

  goContinueExplore: function () {
    const card = this.data.continueExplore;
    if (card && card.focusPath) wx.navigateTo({ url: card.focusPath });
  },

  getListData: function (listName, url, params, dataProcessor = null) {
    const that = this;
    // 记下请求参数,失败后 cy-error 的重试才有的可重放
    that._listReq = that._listReq || {};
    that._listReq[listName] = { url: url, params: params, processor: dataProcessor };
    that._listControls = that._listControls || Object.create(null);
    that._listEpoch = that._listEpoch || Object.create(null);
    const requestEpoch = (that._listEpoch[listName] || 0) + 1;
    that._listEpoch[listName] = requestEpoch;
    const isCurrent = function () { return that._listEpoch[listName] === requestEpoch; };
    const previous = that._listControls[listName];
    if (previous && typeof previous.abort === 'function') previous.abort();
    delete that._listControls[listName];
    that.setData({
      ['listLoading.' + listName]: true,
      ['listErr.' + listName]: false,
    });

    // 失败标记:发起新请求时先清掉旧错误并显示 loading；失败/非 200 再进入 error。
    const markErr = function (why) {
      if (!isCurrent()) return;
      console.error('[index] 列表加载失败');
      that.setData({ ['listErr.' + listName]: true });
    };

    let settled = false;
    const control = app.sendRequest({
      hideLoading: true,
      url: url,
      method: "POST",
      auth: false,
      data: params,
      success: function (res) {
        if (!isCurrent()) return;
        if (res && res.code == "200" && res.data && isRecordList(res.data.rows)) {
          let list = res.data.rows;
          
          for (let i = 0; i < list.length; i++) {
            // 新增：格式化显示时间
            if (list[i]['startDate']) {
              // 获取开始日期时间
              const startDate = new Date(list[i]['startDate'].replace(/-/g, '/'));
              
              // 格式化日期显示
              list[i]['formattedDateTime'] = that.formatDateTimeForDisplay(startDate);
              
              // 保留原有的月份和日期字段
              const [datePart, timePart] = list[i]['startDate'].split(' ');
              if (datePart) {
                const [year, month, day] = datePart.split('-');
                list[i]['month'] = month;
                list[i]['day'] = day;
                
                let hourMinute = '00:00';
                if (timePart) {
                  const timeParts = timePart.split(':');
                  hourMinute = `${timeParts[0]}:${timeParts[1]}`;
                }
                list[i]['dateTime'] = `${month}.${day} ${hourMinute}`;
                list[i]['formattedStartDate'] = `${month}.${day} ${hourMinute}`;
              }
              
              // 初始化倒计时(缩写格式:还剩Nd / 还剩Nh / 已开始)
              const r = fmtRemain(list[i]['startDate']);
              list[i]['remainingTime'] = r.remainingTime;
              list[i]['started'] = r.started;
            }

            // 如果有结束日期，也进行格式化
            if (list[i]['endDate']) {
              const endDate = new Date(list[i]['endDate'].replace(/-/g, '/'));
              list[i]['formattedEndDateTime'] = that.formatDateTimeForDisplay(endDate);
              
              const [datePart, timePart] = list[i]['endDate'].split(' ');
              if (datePart) {
                const [year, month, day] = datePart.split('-');
                list[i]['endmonth'] = month;
                list[i]['endday'] = day;
                
                let hourMinute = '00:00';
                if (timePart) {
                  const timeParts = timePart.split(':');
                  hourMinute = `${timeParts[0]}:${timeParts[1]}`;
                }
                list[i]['endDateTime'] = `${month}.${day} ${hourMinute}`;
                list[i]['formattedEndDate'] = `${month}.${day} ${hourMinute}`;
              }
            }
            
            if (list[i]['distance']) {
              list[i]['distance'] = (list[i]['distance'] / 1000).toFixed(2) + 'km';
            }
          }
          
          if (dataProcessor && typeof dataProcessor === 'function') {
            list = dataProcessor(list);
          }
  
          list = that.processTopicDate(list);
          list = decorateImgs(list);   // 多图拆分 imgArr → imgList/cover
          list = that._applyIndexUiMockIfEmpty(listName, list);

          const dataObj = {};
          dataObj[listName] = list;
          dataObj['listErr.' + listName] = false;
          that.setData(dataObj, function () {
            if (listName === 'nearbyActivityList' || listName === 'recommendedTopicList') {
              that._buildRecoHero();
              that._buildHeroBanners();
            }
          });

          // 如果是即将上线列表，确保定时器正在运行
          if (listName === 'upcomingActivityList' && list.length > 0) {
            that.ensureCountdownTimerRunning();
          }
        } else {
          // 非 200 也是失败:原码直接落地不管,列表停在 [] → 渲染成空态/「正在加载」
          markErr(res && res.msg ? res.msg : '列表没加载出来，请下拉刷新');
        }
      },
      // 原为空 fail:{} —— 列表停在 [] 且无任何标记,wxml 于是渲染
      // 「正在你周围搜寻可点亮的节点…」/「正在为你匹配专属主题…」,
      // 断网时页面永久假装自己在加载,既不报错也不给重试。
      fail: function (res) {
        markErr(res && res.errMsg);
      },
      complete: function () {
        settled = true;
        if (!isCurrent()) return;
        delete that._listControls[listName];
        that.setData({ ['listLoading.' + listName]: false });
      },
    });
    if (!settled && isCurrent() && control && typeof control.abort === 'function') {
      that._listControls[listName] = control;
    }
  },

  // 日期展示统一走 utils/index/index-format.js。
  formatDateTimeForDisplay: function(date) {
    return indexFormat.formatDateTimeForDisplay(date);
  },

  // 加载底部主题列表
loadBottomTopicList: function(pageNo, isRefresh = false) {
  const that = this;
  
  if (that.data.isBottomLoading && !isRefresh) return;
  
  that.setData({ isBottomLoading: true });
  
  app.sendRequest({
    hideLoading: isRefresh,
    url: '/api/topic/list',
    method: "POST",
    auth: false,
    data: {
      pageNum: pageNo,
      pageSize: that.data.pageSize, // 每页显示2条
      sort_type: 1,
    },
    success: function (res) {
      if (!(res && res.code == "200" && res.data && isRecordList(res.data.rows))) {
        // A-14-2:原来只弹一次 toast,信息流底部仍是空的、用户没有任何重试入口。
        // 失败落「失败页」标记,由列表底部的 cy-inline-error 承接并可原地重试。
        that.setData({ isBottomLoading: false, bottomTopicFailedPage: pageNo });
        return;
      }
      {
        let list = res.data.rows;
        const total = res.data.total || 0;
        
        
        // 处理日期格式
        list = that.processTopicDate(list);
        
        // 新增：为每个主题项添加 formattedDateTime 字段
        for (let i = 0; i < list.length; i++) {
          if (list[i]['startDate']) {
            try {
              const startDate = new Date(list[i]['startDate'].replace(/-/g, '/'));
              if (!isNaN(startDate.getTime())) {
                list[i]['formattedDateTime'] = that.formatDateTimeForDisplay(startDate);
              }
            } catch (e) {
              console.warn('主题开始日期格式化失败');
            }
          }
          
          if (list[i]['endDate']) {
            try {
              const endDate = new Date(list[i]['endDate'].replace(/-/g, '/'));
              if (!isNaN(endDate.getTime())) {
                list[i]['formattedEndDateTime'] = that.formatDateTimeForDisplay(endDate);
              }
            } catch (e) {
              console.warn('主题结束日期格式化失败');
            }
          }
        }
        
        // 计算总页数
        const totalPages = Math.ceil(total / that.data.pageSize);
        if (isRefresh) list = that._applyIndexUiMockIfEmpty('bottomTopicList', list);
        
        if (isRefresh) {
          // 刷新时替换数据
          that.setData({
            bottomTopicList: decorateImgs(list),
            bottomTopicPageNo: pageNo,
            hasMoreBottomTopic: totalPages > pageNo
          });
        } else {
          // 加载更多时追加数据
          that.setData({
            bottomTopicList: that.data.bottomTopicList.concat(decorateImgs(list)),
            bottomTopicPageNo: pageNo,
            hasMoreBottomTopic: totalPages > pageNo
          });
        }
        
        // 调试输出
        // console.log('设置后的状态:', {
//           pageNo: pageNo,
//           hasMore: totalPages > pageNo,
//           listLength: isRefresh ? list.length : that.data.bottomTopicList.length
//         });
      }
      that.setData({ isBottomLoading: false, bottomTopicFailedPage: 0 });
    },
    fail: function (res) {
      // A-14-2:网络失败同样落行内重试,不再只弹一次 toast。
      that.setData({ isBottomLoading: false, bottomTopicFailedPage: pageNo });
    }
  })
},
// 加载底部活动列表
loadBottomActivityList: function(pageNo, isRefresh = false) {
  const that = this;
  
  if (that.data.isBottomLoading && !isRefresh) return;
  
  that.setData({ isBottomLoading: true });
  
  app.sendRequest({
    hideLoading: isRefresh,
    url: '/api/activity/list',
    method: "POST",
    auth: false,
    data: {
      is_my: 0,
      pageNum: pageNo,
      pageSize: that.data.pageSize, // 每页显示10条
      sort_type: 1,
      status: 1,
    },
    success: function (res) {
      if (!(res && res.code == "200" && res.data && isRecordList(res.data.rows))) {
        // A-14-2:同主题列表,失败落行内重试。
        that.setData({ isBottomLoading: false, bottomActivityFailedPage: pageNo });
        return;
      }
      {
        let list = res.data.rows;
        const total = res.data.total || 0;
        
        
        // 处理日期格式
        for (let i = 0; i < list.length; i++) {
          if (list[i]['startDate']) {
            const originalStartDate = list[i]['startDate'];
            const [datePart, timePart] = originalStartDate.split(' ');
            
            // 新增：格式化显示时间
            try {
              const startDate = new Date(originalStartDate.replace(/-/g, '/'));
              if (!isNaN(startDate.getTime())) {
                list[i]['formattedDateTime'] = that.formatDateTimeForDisplay(startDate);
              }
            } catch (e) {
              console.warn('活动开始日期格式化失败');
            }
            
            if (datePart) {
              const [year, month, day] = datePart.split('-');
              let hourMinute = '00:00';
              if (timePart) {
                const timeParts = timePart.split(':');
                hourMinute = `${timeParts[0]}:${timeParts[1]}`;
              }
              list[i]['dateTime'] = `${month}.${day} ${hourMinute}`;
            }
          }
          
          // 如果有结束日期，也进行格式化
          if (list[i]['endDate']) {
            try {
              const endDate = new Date(list[i]['endDate'].replace(/-/g, '/'));
              if (!isNaN(endDate.getTime())) {
                list[i]['formattedEndDateTime'] = that.formatDateTimeForDisplay(endDate);
              }
            } catch (e) {
              console.warn('活动结束日期格式化失败');
            }
          }
        }
        
        // 计算总页数
        const totalPages = Math.ceil(total / that.data.pageSize);
        if (isRefresh) list = that._applyIndexUiMockIfEmpty('bottomActivityList', list);
        
        if (isRefresh) {
          // 刷新时替换数据
          that.setData({
            bottomActivityList: decorateImgs(list),
            bottomActivityPageNo: pageNo,
            hasMoreBottomActivity: totalPages > pageNo
          });
        } else {
          // 加载更多时追加数据
          that.setData({
            bottomActivityList: that.data.bottomActivityList.concat(decorateImgs(list)),
            bottomActivityPageNo: pageNo,
            hasMoreBottomActivity: totalPages > pageNo
          });
        }
      }
      that.setData({ isBottomLoading: false, bottomActivityFailedPage: 0 });
    },
    fail: function (res) {
      // A-14-2:网络失败同样落行内重试,不再只弹一次 toast。
      that.setData({ isBottomLoading: false, bottomActivityFailedPage: pageNo });
    }
  })
},
  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    const that = this;

    
    if (that.data.activeTab === '0') {
      // 主题列表触底
      // console.log('主题分页状态:', {
//         hasMoreBottomTopic: that.data.hasMoreBottomTopic,
//         isBottomLoading: that.data.isBottomLoading,
//         pageNo: that.data.bottomTopicPageNo,
//         listLength: that.data.bottomTopicList.length
//       });
      
      if (that.data.hasMoreBottomTopic && !that.data.isBottomLoading) {
        const nextPage = that.data.bottomTopicPageNo + 1;
        that.loadBottomTopicList(nextPage);
      } else {
        // 只在确实没有更多数据时显示提示
        if (!that.data.hasMoreBottomTopic && that.data.bottomTopicList.length > 0) {
          cyToast('没有更多了', { duration: 1500 });
        }
      }
    } else if (that.data.activeTab === '1') {
      // 活动列表触底
      // console.log('活动分页状态:', {
//         hasMoreBottomActivity: that.data.hasMoreBottomActivity,
//         isBottomLoading: that.data.isBottomLoading,
//         pageNo: that.data.bottomActivityPageNo,
//         listLength: that.data.bottomActivityList.length
//       });
      
      if (that.data.hasMoreBottomActivity && !that.data.isBottomLoading) {
        const nextPage = that.data.bottomActivityPageNo + 1;
        that.loadBottomActivityList(nextPage);
      } else {
        // 只在确实没有更多数据时显示提示
        if (!that.data.hasMoreBottomActivity && that.data.bottomActivityList.length > 0) {
          cyToast('没有更多了', { duration: 1500 });
        }
      }
    }
  },

  // A-14-2:底部信息流行内重试。按失败页原样重来:第 1 页失败按刷新口径重拉(替换),
  // 第 N 页失败按翻页口径续拉(追加),不改变既有分页语义。
  retryBottomTopic() {
    const failedPage = this.data.bottomTopicFailedPage || 1;
    this.loadBottomTopicList(failedPage, failedPage === 1);
  },

  retryBottomActivity() {
    const failedPage = this.data.bottomActivityFailedPage || 1;
    this.loadBottomActivityList(failedPage, failedPage === 1);
  },

  processTopicDate: function (list) {
    return indexFormat.processTopicDate(list);
  },

  getFuzzyLocation() {
    const that = this;
    const scope = captureLocationRequest(this);

    wx.getSetting({
      success(res) {
        if (!isCurrentLocationRequest(that, scope)) return;
        const hasAuth = res.authSetting['scope.userFuzzyLocation'] || res.authSetting['scope.userLocation'];
        if (!hasAuth) {
          that.requestFuzzyLocationPermission(scope);
        } else {
          that.executeGetFuzzyLocation(scope);
        }
      },
      // 原为 setData({errorMsg}),但 errorMsg 全页零渲染 ⇒ 错误写进 data 就死在那里。
      // 定位失败不阻断页面(附近活动会退成通用列表),故用 toast 让用户至少知道发生了什么。
      fail(err) {
        if (!isCurrentLocationRequest(that, scope)) return;
        cyToast('定位没检查成功，附近活动可能不准', { duration: 3000 });
      }
    });
  },

  requestFuzzyLocationPermission(locationScope) {
    const that = this;
    const scope = locationScope || captureLocationRequest(this);
    if (!isCurrentLocationRequest(this, scope)) return;

    wx.authorize({
      scope: 'scope.userFuzzyLocation',
      success() {
        if (!isCurrentLocationRequest(that, scope)) return;
        that.executeGetFuzzyLocation(scope);
      },
      fail(err) {
        if (!isCurrentLocationRequest(that, scope)) return;
        wx.authorize({
          scope: 'scope.userLocation',
          success() {
            if (!isCurrentLocationRequest(that, scope)) return;
            that.executeGetFuzzyLocation(scope);
          },
          fail(err2) {
            if (!isCurrentLocationRequest(that, scope)) return;
            that.handleAuthFail(scope);
          }
        });
      }
    });
  },

  handleAuthFail(locationScope) {
    const that = this;
    const scope = locationScope || captureLocationRequest(this);
    if (!isCurrentLocationRequest(this, scope)) return;
    modal.show({
      title: '位置权限提示',
      content: '需要您授权位置权限才能提供服务，是否前往设置开启？',
      confirmText: '去设置',
      cancelText: '取消',
      success(res) {
        if (!isCurrentLocationRequest(that, scope)) return;
        if (res.confirm) {
          wx.openSetting({
            success(settingRes) {
              if (!isCurrentLocationRequest(that, scope)) return;
              const hasAuth = settingRes.authSetting['scope.userFuzzyLocation'] || settingRes.authSetting['scope.userLocation'];
              if (hasAuth) {
                // 修复:此回调内 this 非页面实例,原 this.executeGetFuzzyLocation() 会失效
                that.executeGetFuzzyLocation(scope);
              }
            }
          });
        }
      }
    });
    // 原这里还 setData 一个全页零渲染的 errorMsg;上面的 showModal 已是用户可见反馈。
  },

  executeGetFuzzyLocation(locationScope) {
    const that = this;
    const scope = locationScope || captureLocationRequest(this);

    cyLoading.show('获取位置中...');
    this._locationLoadingEpoch = scope.epoch;

    if (!wx.getLocation) {
      hideLocationLoading(this, scope);
      cyToast('微信版本不支持定位，附近可能不准', { duration: 3000 });
      return;
    }

    wx.getLocation({
      type: 'gcj02',
      success(res) {
        hideLocationLoading(that, scope);
        if (!isCurrentLocationRequest(that, scope)) return;
        const { latitude, longitude } = res;
        that.setData({
          locationInfo: {
            latitude: latitude.toFixed(6),
            longitude: longitude.toFixed(6),
            address: '正在解析地址...'
          }
        });

        that.getListData('nearbyActivityList', '/api/activity/list', {
          is_my: 0,
          sort_type: 1,
          pageNum: 1,
          pageSize: 4,
          longitude: that.data.locationInfo.longitude,
          latitude: that.data.locationInfo.latitude
        });

        that.reverseGeocode(latitude, longitude, scope);
      },
      fail(err) {
        hideLocationLoading(that, scope);
        if (!isCurrentLocationRequest(that, scope)) return;
        let errorMsg = '获取位置失败，请重试';
        switch (err.errCode) {
          case 1: errorMsg = '位置服务未开启，请检查手机GPS'; break;
          case 2: errorMsg = '网络错误，请检查网络连接'; break;
          case 3: errorMsg = '定位超时，请重试'; break;
          case 4: errorMsg = '位置服务不可用'; break;
          default: errorMsg = `获取位置失败: ${err.errMsg}`;
        }
        cyToast(errorMsg, { duration: 3000 });
      }
    });
  },

  reverseGeocode(latitude, longitude, locationScope) {
    const that = this;
    const scope = locationScope || captureLocationRequest(this);
    app.sendRequest({
      url: '/api/map/reverse-geocode',
      method: 'POST',
      hideLoading: true,
      data: { latitude: latitude, longitude: longitude },
      success: (res) => {
        if (!isCurrentLocationRequest(that, scope)) return;
        const city = res && (res.code == 200 || res.code == '200') && res.data && res.data.city;
        if (!city) return;
        that.setData({ city: city });
        that.saveInfo(scope);
      }
    });
  },

  saveInfo: function (locationScope) {
    const that = this;
    if (!isCurrentLocationRequest(that, locationScope) || !locationScope.memberId) return;
    const data = { workAddress: that.data.city };
    app.sendRequest({
      url: '/api/user/update',
      data: JSON.stringify(data),
      method: "POST",
      header: {
        'Content-Type': 'application/json'
      }
    });
  },
})
