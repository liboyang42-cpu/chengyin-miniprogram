const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const { readPageStyle } = require('../../../utils/font-scale.js');
const app = getApp();
const roleGuard = require('../../../utils/roleGuard.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const policy = require('../../../utils/identity/identity-policy.js');
const { isRecord, isRecordList } = require('../../../utils/response-shape.js');
// variant 判定与广场、俱乐部页共用同一份,别在这里写第二套(两套迟早分叉)。
const { isCompletedShare, hasFeedPlayCover } = require('../../../utils/feed-play-card.js');

// 主理人 L1-L5 等级对外文案(俱乐部继承展示;level=0 不显示)
const LEVEL_LABELS = ['', 'L1 新手', 'L2 稳定', 'L3 成熟', 'L4 城市运营者', 'L5 区域策划方'];
function levelTextOf(lv) { return (lv && LEVEL_LABELS[lv]) ? LEVEL_LABELS[lv] : (lv ? ('Lv.' + lv) : ''); }
function isOkRes(res) { return !!(res && (res.code == 200 || res.code == '200')); }
function requestError(res, fallback) {
  return app.getRequestErrorMessage ? app.getRequestErrorMessage(res, fallback) : fallback;
}
function normalizeClub(c) {
  if (!c) return c;
  if (c.id == null && c.clubId != null) c.id = c.clubId;
  c.levelText = levelTextOf(c.level);
  c.logoUrl = c.logo ? app.getImgUrl(c.logo) : '/images/d_logo.png';
  // 封面字段表里一直有,重设计卡片开始消费;空走组件的纯色底占位
  c.coverUrl = c.cover ? app.getImgUrl(c.cover) : '';
  return c;
}
Page({
  data: {
    // 顶栏几何
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    rightGap: 100,
    headerH: 0,
    isSticky: false,
    activeTab: 1, // 固定俱乐部(tab 页面:漫游子 tab 已拆除,直落俱乐部)
    // 俱乐部(R2 真实数据)
    myClubId: null,
    myClubs: [],        // 我创建的俱乐部(多俱乐部)
    myClubCount: 0,
    localClubs: [],     // 目录中他人俱乐部(不含我创建的)
    nearbyClubs: [],    // 城市俱乐部(展示用)
    clubsLoaded: false,
    clubsError: false,
    clubsState: 'idle', // idle | loading | refreshing | ready | empty | error | stale-error
    clubsErrorText: '',
    isMerchantViewer: false,   // 商户视角:团体页只显示同城(附近)俱乐部,玩家不受影响
    merchantCity: '',
    merchantCityState: 'idle', // idle | loading | ready | error
    merchantCityError: '',
    merchantCityErrorKind: 'data',
    clubManageShow: false,
    managingClub: null,
    clubMembers: [],
    clubMembersLoaded: false,
    clubMembersState: 'idle', // idle | loading | refreshing | ready | empty | error | stale-error
    clubMembersError: '',
    joinedClubs: [],       // 我加入的俱乐部(/api/club/home)

    // 2026-08-05:一级 tab「帖文 / 俱乐部」。帖文原来只活在单个俱乐部详情页里,
    // 没有跨俱乐部的流;范围由后端 /api/club/post/feed 按身份判死,不是全站公开流。
    topTabs: [{ key: 'feed', label: '帖文' }, { key: 'club', label: '俱乐部' }],
    activeTopTab: 'club',
    feed: [],
    feedState: 'idle',      // idle | loading | refreshing | ready | empty | error | stale-error
    feedError: '',
    feedEmptyTitle: '还没有帖文',
    feedEmptySub: '',
  },

  onTopTabChange(e) {
    const key = e.detail.key;
    if (!key || key === this.data.activeTopTab) return;
    this.setData({ activeTopTab: key });
    if (key === 'feed' && this.data.feedState === 'idle') this.loadFeed();
  },

  /**
   * 聚合动态流。空态分两种说法:一种是「你还没有任何俱乐部」(该去加入),
   * 一种是「有俱乐部但还没人发」(该去发)——合成一句会让人不知道下一步做什么。
   */
  loadFeed() {
    if (this._feedLoading) return;
    const that = this;
    const hasSnapshot = ['ready', 'empty', 'stale-error'].indexOf(this.data.feedState) >= 0;
    const requestId = (this._feedRequestId || 0) + 1;
    this._feedRequestId = requestId;
    this._feedLoading = true;
    this.setData({
      feedState: hasSnapshot ? 'refreshing' : 'loading',
      feedError: '',
    });
    function isCurrent() { return !that._unloaded && requestId === that._feedRequestId; }
    function fail(res, kind) {
      if (!isCurrent()) return;
      that._feedLoading = false;
      that.setData({
        feedState: hasSnapshot ? 'stale-error' : 'error',
        feedError: requestError(res, '动态加载失败，请重试'),
      });
    }
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/post/feed', method: 'POST',
      data: JSON.stringify({ limit: 20 }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!isCurrent()) return;
        if (!isOkRes(res) || !isRecord(res.data) || !isRecordList(res.data.rows)
            || typeof res.data.clubCount !== 'number' || !Number.isFinite(res.data.clubCount)
            || res.data.clubCount < 0) return fail(res, 'data');
        const rows = res.data.rows;
        const noClub = res.data.clubCount === 0;
        that._feedLoading = false;
        that.setData({
          feed: rows.map(function (p) {
            // refType 的编号就是广场的 dataType;后端投影不出 sportName(被引对象已删/下架)时
            // 两个判定都会自然判假,卡片降级成普通图文帖。
            const ref = Object.assign({}, p, { dataType: p.refType, completed: true });
            return Object.assign({}, p, {
              memberNickname: p.nickname,
              memberAvatar: p.avatar,
              contents: p.content,
              picList: String(p.images || '').split(/[;,]/).filter(Boolean).slice(0, 3),
              formattedCreateTime: String(p.createTime || '').slice(5, 16),
              isCompletionShare: isCompletedShare(ref),
              hasPlayCover: hasFeedPlayCover(ref),
            });
          }),
          feedState: rows.length ? 'ready' : 'empty',
          feedError: '',
          feedEmptyTitle: noClub ? '这里还没有帖文' : '还没有帖文',
          feedEmptySub: noClub
            ? '帖文来自你加入的俱乐部，加入或创建一个俱乐部后即可看到'
            : '你加入的俱乐部还没有人发布帖文，去俱乐部主页发第一条',
        });
      },
      fail(res) { fail(res, 'network'); }
    });
  },

  onPostTap(e) {
    const clubId = e.detail && e.detail.clubId;
    const postId = e.detail && e.detail.postId;
    if (clubId && postId) wx.navigateTo({ url: '/pages/club/detail/index?id=' + clubId + '&postId=' + postId });
  },

  // 引用卡上的两个动作:看主题 / 现在去玩。拿不到被引主题就退回帖子本身,不做死区。
  onPostReference(e) {
    const post = this.data.feed[e.detail && e.detail.index];
    if (!post || !post.sportTopicId) return this.onPostTap(e);
    wx.navigateTo({ url: '/pages/topic/index/index?id=' + post.sportTopicId });
  },

  onPostReferencePlay(e) {
    const post = this.data.feed[e.detail && e.detail.index];
    if (!post || !post.sportTopicId) return this.onPostTap(e);
    wx.navigateTo({ url: '/pages/play/index?topicId=' + post.sportTopicId });
  },

  onPostUser(e) {
    const memberId = e.detail && e.detail.memberId;
    if (memberId) wx.navigateTo({ url: '/pages/userinfo/userinfo?userId=' + memberId });
  },

  onPostClub(e) {
    const clubId = e.detail && e.detail.clubId;
    if (clubId) wx.navigateTo({ url: '/pages/club/detail/index?id=' + clubId });
  },

  onLoad() {
    this._unloaded = false;
    this._skipInitialShow = true;
    this.initNav();
    this.detectMerchant();
    this.loadClubHome();
  },

  // 商户视角:团体页只显示同城(附近)俱乐部 — 取商户所在城市用于过滤(玩家 isMerchantViewer=false,不受影响)
  detectMerchant() {
    var isMerchant = policy.isMerchantView({
      role: app.getUserRole(),
      userType: app.getUserType(),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    if (!isMerchant) {
      this._merchantInfoRequestId = (this._merchantInfoRequestId || 0) + 1;
      this._merchantInfoLoading = false;
      var all = this.data._nearbyAll || this.data.nearbyClubs || [];
      this.setData({
        isMerchantViewer: false,
        merchantCity: '',
        merchantCityState: 'idle',
        merchantCityError: '',
        merchantCityErrorKind: 'data',
        nearbyClubs: all,
        localClubs: all,
      });
      return isMerchant;
    }
    this.setData({ isMerchantViewer: true });
    if (this._merchantInfoLoading) return isMerchant;
    var that = this;
    var requestId = (this._merchantInfoRequestId || 0) + 1;
    this._merchantInfoRequestId = requestId;
    this._merchantInfoLoading = true;
    this.setData({ merchantCityState: 'loading', merchantCityError: '' });
    function isCurrent() {
      return !that._unloaded && requestId === that._merchantInfoRequestId && that.data.isMerchantViewer;
    }
    function fail(res, kind) {
      if (!isCurrent()) return;
      that._merchantInfoLoading = false;
      var full = that.data._nearbyAll || that.data.nearbyClubs || [];
      that.setData({
        merchantCity: '',
        merchantCityState: 'error',
        merchantCityError: requestError(res, kind === 'network' ? '网络异常，同城范围暂未确认' : '店铺城市暂未取回'),
        merchantCityErrorKind: kind || 'data',
        nearbyClubs: full,
        localClubs: full,
      });
    }
    app.sendRequest({
      url: '/api/merchant/info', method: 'POST', hideLoading: true, silentError: true,
      success: function (res) {
        if (!isCurrent()) return;
        if (!isOkRes(res) || !isRecord(res.data)) return fail(res, 'data');
        var d = res.data;
        var city = typeof d.city === 'string' && d.city.trim()
          ? d.city.trim()
          : (typeof d.address === 'string' ? d.address.trim() : '');
        if (!city) return fail(res, 'data');
        that._merchantInfoLoading = false;
        that.setData({ merchantCity: city, merchantCityState: 'ready', merchantCityError: '', merchantCityErrorKind: 'data' });
        that.applyNearbyFilter();
      },
      fail: function (res) { fail(res, 'network'); }
    });
    return isMerchant;
  },

  // 同城过滤:仅商户生效;城市未知则不过滤(避免误清空)。数据无经纬度,"附近"口径 = 同城。
  applyNearbyFilter() {
    if (!this.data.isMerchantViewer) return;
    var full = this.data._nearbyAll || this.data.nearbyClubs || [];
    var city = String(this.data.merchantCity || '').trim();
    if (!city) { this.setData({ nearbyClubs: full, localClubs: full }); return; }
    var filtered = full.filter(function (c) {
      var loc = String(c.city || c.address || '');
      return loc && (loc.indexOf(city) >= 0 || (c.city && city.indexOf(c.city) >= 0));
    });
    this.setData({ nearbyClubs: filtered, localClubs: filtered });
  },

  // 一级 tab 页原本一个都不能下拉刷新:feed 陈旧后用户唯一的手段是退出重进。
  onPullDownRefresh() {
    this.loadClubHome();
    this.loadImUnread();
    if (this.data.activeTopTab === 'feed') this.loadFeed();
  },

  onShow() {

    this.setData({ fontScaleStyle: readPageStyle() });
    const isMerchantViewer = policy.isMerchantView({
      role: app.getUserRole(),
      userType: app.getUserType(),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    if (isMerchantViewer !== this.data.isMerchantViewer) this.detectMerchant();
    if (isMerchantViewer) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
    if (this._skipInitialShow) this._skipInitialShow = false;
    else this.loadClubHome();
    this.loadImUnread();
  },

  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    merchantTheme.merchantPageRestore();
    this._unloaded = true;
    this._feedRequestId = (this._feedRequestId || 0) + 1;
    this._clubHomeRequestId = (this._clubHomeRequestId || 0) + 1;
    this._clubMembersRequestId = (this._clubMembersRequestId || 0) + 1;
    this._merchantInfoRequestId = (this._merchantInfoRequestId || 0) + 1;
    this._feedLoading = false;
    this._clubHomeLoading = false;
    this._clubMembersLoading = false;
    this._merchantInfoLoading = false;
  },

  // 俱乐部首页聚合(/api/club/home):我的 / 加入 / 附近 / 主理人态
  loadClubHome() {
    if (this._clubHomeLoading) return;
    var that = this;
    var hasSnapshot = ['ready', 'empty', 'stale-error'].indexOf(this.data.clubsState) >= 0
      || (this.data.clubsLoaded && !this.data.clubsError);
    var requestId = (this._clubHomeRequestId || 0) + 1;
    this._clubHomeRequestId = requestId;
    this._clubHomeLoading = true;
    this.setData({
      clubsState: hasSnapshot ? 'refreshing' : 'loading',
      clubsError: false,
      clubsErrorText: '',
    });
    function isCurrent() { return !that._unloaded && requestId === that._clubHomeRequestId; }
    function fail(res, kind) {
      if (!isCurrent()) return;
      that._clubHomeLoading = false;
      that.setData({
        clubsLoaded: hasSnapshot,
        clubsError: true,
        clubsState: hasSnapshot ? 'stale-error' : 'error',
        clubsErrorText: requestError(res, '俱乐部列表加载失败，请重试'),
      });
    }
    app.sendRequest({
      // 下拉刷新的收圈绑在真实完成上;非下拉场景下 stopPullDownRefresh 是 no-op
      complete() { wx.stopPullDownRefresh(); },
      hideLoading: true,
      hideLoading: true, silentError: true,
      url: '/api/club/home',
      method: 'POST',
      data: {},
      success: function (res) {
        if (!isCurrent()) return;
        if (!isOkRes(res) || !isRecord(res.data) || !isRecordList(res.data.owned)
            || !isRecordList(res.data.joined) || !isRecordList(res.data.nearby)
            || !isRecord(res.data.leaderStatus)) return fail(res, 'data');
        var d = res.data;
        var owned = d.owned.map(normalizeClub);
        owned.forEach(function (c) { c.isOwner = true; });
        var joined = d.joined.map(normalizeClub);
        // joined 列表天然已加入;后端行未必带 isJoined,卡片按钮三态靠它判「进入」
        joined.forEach(function (c) { c.isJoined = true; });
        var nearby = d.nearby.map(normalizeClub);
        that._clubHomeLoading = false;
        that.setData({
          myClubs: owned,
          myClubCount: owned.length,
          myClubId: owned.length ? owned[0].id : null,
          joinedClubs: joined,
          nearbyClubs: nearby,
          _nearbyAll: nearby,
          clubsLoaded: true,
          clubsError: false,
          clubsState: owned.length || joined.length || nearby.length ? 'ready' : 'empty',
          clubsErrorText: ''
        });
        that.applyNearbyFilter();
      },
      fail: function (res) { fail(res, 'network'); }
    });
  },

  retryClubs() { this.loadClubHome(); },

  // 站内消息未读红点
  loadImUnread() {
    var that = this;
    app.sendRequest({
      url: '/api/im/unread-total', method: 'POST', hideLoading: true,
      success: function (res) { if (res && res.code == 200) that.setData({ imUnread: res.data || 0 }); },
      fail: function () {},
    });
  },

  // 顶栏 + tab 栏几何(右侧图标避开微信胶囊)
  initNav() {
    var info = wx.getWindowInfo();
    var m = app.globalData.menuButtonInfo;
    var rightGap = info.windowWidth - m.left + 8;
    var headerH = this.data.statusBarHeight + this.data.navBarHeight;
    this.setData({ rightGap: rightGap, headerH: headerH });
  },

  onPageScroll(e) {
    var s = e.scrollTop > 4;
    if (s !== this.data.isSticky) this.setData({ isSticky: s });
  },

  // 商户查看俱乐部对其发起的合作邀约(接受/拒绝)→ 合作中心。
  // 2026-08-08:原先跳 coop/list,但商家的接受/拒绝已全部收敛到 merchant/coop-center,
  // coop/list 只剩发起方视角 —— 商家再跳过去会看到一个自己无法处理的列表。

  // 顶栏交互
  onMsgTap() { wx.navigateTo({ url: '/subpackageB/pages/im/list/index' }); },

  stopBubble() {},

  // 发布路线：先按角色配额预检(后端为最终准则),通过后直达专业编辑器
  onHeroTap() {
    var go = function () { wx.navigateTo({ url: '/pages/publish/fabu/index' }); };
    app.sendRequest({
      url: '/api/role/info', method: 'POST', hideLoading: true,
      success: function (res) {
        if (res.code == '200' && res.data) {
          var p = res.data.permission || {}, u = res.data.usage || {};
          if (p.canCreateTheme === false) {
            toast('当前身份不可创建路线');
            return;
          }
          if (p.maxThemes != null && u.themes >= p.maxThemes) {
            modal.show({ title: '已达上限', content: '已达到当前身份路线数量上限（' + p.maxThemes + '）。可在「身份中心」升级为俱乐部获得更多额度。', showCancel: false });
            return;
          }
        }
        go();
      },
      successStatusAbnormal: go, // 接口未部署/HTTP非200时放行,照样进发布(后端为最终准则)
      fail: go
    });
  },

  onTopicTap(e) {
    wx.navigateTo({ url: '/pages/topic/index/index?id=' + e.currentTarget.dataset.id });
  },

  // 进俱乐部公开主页(详情页)
  goClubDetail(e) {
    var id = e.currentTarget.dataset.clubId || e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/club/detail/index?id=' + id });
  },

  // owner 进自己的俱乐部管理台
  goMyClubConsole() { wx.navigateTo({ url: '/pages/club/detail/index?owner=1' }); },

  // 创建俱乐部:已是主理人→表单B 直接建团;否则→表单A 先成为主理人(后端要求先有档案)
  onClubApply() {
    var isLeader = roleGuard.isClubLeader();
    var url = isLeader ? '/pages/club/create/index' : '/pages/club/apply/index';
    wx.navigateTo({ url: url });
  },
  // 俱乐部卡按钮三态分发(cy-club-card 的 action 事件)
  onClubCardAction(e) {
    var act = e.detail && e.detail.act;
    if (act === 'manage') return this.onClubManage(e);
    if (act === 'join') return this.onClubJoin(e);
    return this.goClubDetail(e);
  },
  onClubManage(e) {
    var id = e.currentTarget.dataset.id;
    // 管理入口只对我创建的开放;此前误读不存在的 data.clubs(死代码复活时一并修正)
    var club = this.data.myClubs.find(function (item) { return item.id == id; });
    if (!club || !club.isOwner) {
      toast('无权管理该俱乐部');
      return;
    }
    this.setData({
      clubManageShow: true,
      managingClub: club,
      clubMembers: [],
      clubMembersLoaded: false,
      clubMembersState: 'idle',
      clubMembersError: ''
    });
    this.loadClubMembers(id);
  },

  closeClubManage() {
    this._clubMembersRequestId = (this._clubMembersRequestId || 0) + 1;
    this._clubMembersLoading = false;
    this._clubMembersLoadKey = '';
    this.setData({
      clubManageShow: false,
      managingClub: null,
      clubMembers: [],
      clubMembersLoaded: false,
      clubMembersState: 'idle',
      clubMembersError: ''
    });
  },

  loadClubMembers(clubId) {
    if (!clubId) return;
    var key = String(clubId);
    if (this._clubMembersLoading && this._clubMembersLoadKey === key) return;
    var that = this;
    var hasSnapshot = this._clubMembersLoadKey === key
      && (['ready', 'empty', 'stale-error'].indexOf(this.data.clubMembersState) >= 0
        || !!(this.data.clubMembers && this.data.clubMembers.length));
    var requestId = (this._clubMembersRequestId || 0) + 1;
    this._clubMembersRequestId = requestId;
    this._clubMembersLoading = true;
    this._clubMembersLoadKey = key;
    this.setData({
      clubMembersState: hasSnapshot ? 'refreshing' : 'loading',
      clubMembersError: '',
    });
    function isCurrent() {
      var managing = that.data.managingClub;
      return !that._unloaded && requestId === that._clubMembersRequestId
        && managing && String(managing.id) === key;
    }
    function fail(res, kind) {
      if (!isCurrent()) return;
      that._clubMembersLoading = false;
      that.setData({
        clubMembersLoaded: hasSnapshot,
        clubMembersState: hasSnapshot ? 'stale-error' : 'error',
        clubMembersError: requestError(res, '成员加载失败，请重试'),
      });
    }
    // 后端 /api/club/members 是 @RequestBody 端点,必须发 JSON;缺 header 会被当 urlencoded 导致成员列表加载不出
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/members',
      method: 'POST',
      data: JSON.stringify({ clubId: clubId }),
      header: { 'Content-Type': 'application/json' },
      success: function (res) {
        if (!isCurrent()) return;
        if (!isOkRes(res) || !isRecordList(res.data)) return fail(res, 'data');
        that._clubMembersLoading = false;
        that.setData({
          clubMembers: res.data,
          clubMembersLoaded: true,
          clubMembersState: res.data.length ? 'ready' : 'empty',
          clubMembersError: ''
        });
      },
      fail: function (res) { fail(res, 'network'); }
    });
  },

  retryClubMembers() {
    var club = this.data.managingClub;
    if (club && club.id) this.loadClubMembers(club.id);
  },

  removeClubMember(e) {
    var that = this;
    var memberId = e.currentTarget.dataset.memberId;
    var club = that.data.managingClub;
    if (!club || !memberId) return;
    // 三段式第一段:确认。文案(后果 + 「此操作不可撤销」)在 utils/danger-actions.js。
    var dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.open('club.member.remove', {
      name: e.currentTarget.dataset.memberName || '这位成员',
      memberId: memberId,
    });
  },

  /** 三段式第二段:确认弹窗里点了「移出成员」才真的发请求。 */
  onConfirmRemoveClubMember: function (e) {
    var that = this;
    var club = this.data.managingClub;
    var memberId = e.detail.params.memberId;
    var dc = this.selectComponent && this.selectComponent('#dc');
    if (!club || !memberId) return;
    if (dc) dc.busyOn();
    // 后端 /api/club/remove-member 是 @RequestBody 端点,必须发 JSON;缺 header 会被当 urlencoded 导致移除永远失败
    app.sendRequest({
      url: '/api/club/remove-member',
      method: 'POST',
      data: JSON.stringify({ clubId: club.id, memberId: memberId }),
      header: { 'Content-Type': 'application/json' },
      success: function (res) {
        if (res.code == '200') {
          if (dc) dc.done();
          that.loadClubMembers(club.id);
          that.setData({ clubsLoaded: false }, function () { that.loadClubHome(); });
        } else if (dc) dc.failed(res.msg || '移除失败');
      },
      fail: function () { if (dc) dc.failed('网络错误，请重试'); }
    });
  },

  // 加入俱乐部(即时)
  onClubJoin(e) {
    var id = e.currentTarget.dataset.id;
    if (!id) return;
    var that = this;
    // 后端 /api/club/join 是 @RequestBody 端点,必须发 JSON;缺 header 会被当 urlencoded 导致加入永远失败
    // (对照:pages/club/detail/index.js 调同一接口时已带 JSON header)
    app.sendRequest({
      url: '/api/club/join',
      method: 'POST',
      data: JSON.stringify({ id: id }),
      header: { 'Content-Type': 'application/json' },
      success: function (res) {
        toast(res.msg || '加入成功');
        if (res.code == '200') {
          that.setData({ clubsLoaded: false }, function () { that.loadClubHome(); });
        }
      },
      fail: function () {
        toast('网络错误，请重试');
      }
    });
  },

  onShareAppMessage(res) {
    const dataset = res.target && res.target.dataset;
    if (res.from === 'button' && dataset && dataset.postId && dataset.clubId) {
      return {
        title: '城瘾俱乐部帖文',
        path: '/pages/club/detail/index?id=' + dataset.clubId + '&postId=' + dataset.postId
      };
    }
    if (res.from === 'button' && dataset && dataset.id) {
      return {
        title: dataset.name || '城市路线',
        path: '/pages/topic/index/index?id=' + dataset.id
      };
    }
    return {};
  }
});
