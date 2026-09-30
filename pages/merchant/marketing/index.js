const app = getApp();
const merchantTheme = require('../../../utils/merchant-theme.js');
const { ensureSession } = require('../utils/session/ensure-session.js');
const { normalizeMarketingHome } = require('../utils/merchant-aggregate.js');
const { isRecord } = require('../../../utils/response-shape.js');
const { inactiveAccess, normalizeMerchantAccess } = require('../../../utils/merchant-access-policy.js');

const CONTENT_TYPES = [
  { key: 'topic', title: '主题' },
  { key: 'free', title: '自由探索' },
  { key: 'activity', title: '活动' },
];

// 零内容 → 直达创建页;有内容 → 进管理页(myproject 只有 主题/活动 两个 tab,自由探索并在主题 tab 里)。
// 单独放一张表:这三条路由原来在 go()/goMyContent()/goManage() 里抄了三遍。
const CONTENT_ROUTES = {
  topic: { create: '/pages/publish/fabu/index?scope=MERCHANT', manage: '/subpackageA/pages/myproject/index?type=simple_topic&scope=MERCHANT' },
  // 自由探索 = fabu 的 mode=2(口径同 components/cy/publish-sheet/index.js)
  free: { create: '/pages/publish/fabu/index?mode=2&scope=MERCHANT', manage: '/subpackageA/pages/myproject/index?type=simple_topic&scope=MERCHANT' },
  // ⚠️ 活动零条时去的仍是**合作中心**(CU-M-45 裁决),不是发布页:商家自营活动那条路已在
  // CU-M-05(9-25 裁决)接通 —— /api/activity/publish 认 scope=MERCHANT + 项目管理岗,
  // 入口在品牌中心「去发布一个活动」与「我的项目·活动」,不在这里。本条去向保持不变。
  activity: { create: '/pages/merchant/coop-center/index', manage: '/subpackageA/pages/myproject/index?type=club_activity&scope=MERCHANT' },
};

// 4-07 + RV(2):工具入口按后端权限码过滤。
// 店铺参谋走 /api/ai/merchant/insight,要 MARKETING_READ(运营/店长);核销员/财务没有。
// 店铺装修主页整页门禁是 canManageCoop(运营要能进去管承接设置/常备权益),
// 资料类视图与保存按钮在页内按 canWriteProfile 单独收口。
const ENTRIES = [
  { title: '店铺参谋', icon: 'star', action: 'aiInsight', permission: 'canReadMarketing' },
  { title: '店铺装修', icon: 'edit', action: 'decor', permission: 'canManageCoop' },
  { title: '发主题', icon: 'plus', action: 'topic' },
  // CU-M-45:活动零条时落点是合作中心(承接浏览面),不是发布页。文案跟去向对齐成「接活动」。
  // 商家自营发布(另立项目)在 CU-M-05 已接通,入口是品牌中心「去发布一个活动」与
  // 「我的项目·活动」的「发布单场活动」—— 与本条去向不冲突,别把这里改成发布页。
  { title: '接活动', icon: 'calendar', action: 'activity' },
];

function entriesForAccess(access) {
  return ENTRIES.filter(function (item) {
    return !item.permission || (access && access[item.permission] === true);
  });
}

// 4-10(S22):hero 数字来自 analytics.stages 的**窗口**计数(近 7/30 天完整自然日),
// 切窗口数字就变 —— 文案必须跟着窗口写「近 N 天报名」,写「累计」就是在说假话。
function heroWindowLabel(windowDays) {
  return '近 ' + (Number(windowDays) === 7 ? 7 : 30) + ' 天报名';
}

// 2026-09-19 用户裁决:本页数字位没有数字就是 0,不许出现横杠。
// 「未确认」的表达从数字位搬到状态位 —— 副行文案(数据待同步 / 点击重试)继续说实话,
// 数字位永远是个数字。首载期间这些常量都在骨架 wx:else 之后,不会抢在数据前显示 0。
function heroPlaceholder(windowDays) {
  var label = heroWindowLabel(windowDays);
  return { value: '0', sub: '', label: label, ariaLabel: label + '待同步' };
}
const COUPON_UNKNOWN = { title: '0 张在投放', sub: '数据待同步', ariaLabel: '优惠券数据待同步，查看优惠券' };

// 后端只回聚合数,没有单张券的列表 ⇒ 卡面代表「这叠券」。
// 影卡张数按 couponCount 给,最多两张;返回 null 表示服务端明确回了零张。
function buildCouponCard(coupons) {
  const count = coupons ? coupons.couponCount : 0;
  // CU-M-51/M-86:couponCount 只数「在投放」。空态(「还没有优惠券」)只能按**券总数**判:
  // 券全停发/未生效的商家仍有券,画成一张都没有是在说假话。
  const total = coupons && Number.isFinite(coupons.couponTotal) ? coupons.couponTotal : count;
  if (!count && !total) return { couponCard: null, deckGhosts: 0, couponRate: '' };
  const received = coupons.received;
  const verified = coupons.verified;
  return {
    couponCard: {
      title: count + ' 张在投放',
      sub: '领取 ' + received + ' · 核销 ' + verified,
      ariaLabel: count + ' 张券在投放，领取 ' + received + '，核销 ' + verified + '，查看优惠券',
    },
    deckGhosts: count > 2 ? 2 : (count > 0 ? 1 : 0),
    // 「领取后核销 N%」= verified / received,同一批券,口径成立。
    // 措辞写明「领取后」:本页禁用漏斗式转化比率的说法,免得被读成相邻步骤相除。
    couponRate: received > 0 ? '领取后核销 ' + Math.round((verified / received) * 100) + '%' : '',
  };
}

function currentMemberId() {
  if (typeof app.getUserID !== 'function') return '';
  const memberId = app.getUserID();
  return memberId === null || memberId === undefined ? '' : String(memberId);
}

function unknownContent() {
  return CONTENT_TYPES.map(function (item) {
    return Object.assign({}, item, {
      count: null,
      countText: '0',
      ariaLabel: '查看' + item.title + '，数量待同步',
    });
  });
}

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// 2026-08-26 合入 #817 的判据:**只有后端明确表态时才认定权限问题**。
// 原来还拿错误文案做正则(/请先登录|仅商家可|没有.*权限/)反推 —— 后端改一个字就失效,
// 而一条网络超时的 errMsg 也可能撞上,把「断网」栽成「你没权限」并撤掉重试按钮。
// 现在只认 HTTP 状态码这一个明确信号;认不出来的一律当坏响应,交给 funnelError 给重试。
// 401 与 403 也不再混成一种 —— 401 静默重登再试,403 才是明确的岗位拒权。
function resolveDeniedKind(res) {
  const code = String(res && (res.statusCode !== undefined ? res.statusCode : res.code));
  if (code === '401') return 'anonymous';
  if (code === '403') return 'denied';
  return '';
}

// 聚合层(marketing-home / merchant info)的失败分三档,别混成一档:
//  · 401 → 会话没了,静默重登一次 ⇒ anonymous(由 recoverSession 收口)
//  · 403 → 这次请求身份没通过。**不等于岗位被撤权**(那是 access/me 的结论),
//          所以不能进 denied 去撤掉重试按钮;但旧指标已不可信,必须清掉,
//          否则页面会拿着上一次的数字冒充「当前身份看到的数据」⇒ stale
//  · 其它 → 普通失败,留旧内容 + 局部重试
function resolveAggregateFailure(res) {
  const kind = resolveDeniedKind(res);
  if (kind === 'anonymous') return 'anonymous';
  if (kind === 'denied') return 'stale';
  return '';
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,   // 胶囊行高:内容整体落在微信导航栏之下
    merchantId: 0,
    // 营销入口;合作统一从合作机会卡进入。
    // 优惠券不在这里 —— 它在下面那张带领取/核销数的汇总卡上,同一个路由不放两遍。
    // 评价入口已删:商家评价在后端不存在(UmsComment 的 owner_type 只有主题/活动/创意广场),
    // 原来点进去是「承接商家」公开名片页,既没有评价,还给自己看到「发起合作」。
    entries: entriesForAccess(inactiveAccess()),
    // hero = 全页唯一的主角数字(近 N 天报名)。不用「收入」——那是工作台的 hero。
    hero: heroPlaceholder(30),
    funnelLoading: false,
    funnelError: '',
    marketingLoaded: false,
    // checking / ready / denied(明确无权限)。
    // 未登录不再是一种整屏态:静默登录后加载,登录/身份确认失败落 entryError 页内重试。
    accessState: 'checking',
    accessError: '',
    entryError: '',
    // 岗位权限真源 = /api/merchant/access/me。聚合层的错误码只说明「这次请求没成」,
    // 不能拿来推断岗位有没有权限(见 merchant-marketing-state-contract 的 403 用例)。
    merchantAccess: inactiveAccess(),
    // 首载未确认时是 COUPON_UNKNOWN(数字位 0 + 副行「数据待同步」),不是 null —— null 只表示服务端明确回了零张
    // unknown=未确认 | ready=有真实数据 | empty=服务端明确全零
    // 全零和「还没加载」必须分开:前者要给首发引导,后者只能给骨架。
    marketingDataState: 'unknown',
    couponCard: COUPON_UNKNOWN,
    // 影卡张数直接跟 couponCount 挂钩,不是装饰
    deckGhosts: 0,
    couponRate: '',
    // marketing-home 一直在回 recruiting.count,以前只拿它判空态
    recruitCount: 0,

    // 我的内容(从工作台迁入):商家自己发布的主题 / 自由探索 / 活动
    myContent: unknownContent(),
  },

  onLoad() {
    this._unloaded = false;
    this._skipNextShowReload = true;
    this._scopeMemberId = currentMemberId();
    const gd = app.globalData || {};
    const sys = wx.getSystemInfoSync();
    this.setData({
      statusBarHeight: gd.statusBarHeight || sys.statusBarHeight || 20,
      navBarHeight: gd.navBarHeight || 44,
    });
    // ★顺序不能并行:必须先由 access/me 确认岗位权限,再拉营销数据。
    // 并行会让「切账号时旧身份的在途请求」把上一个商家的数据带进新视角
    // (见 state-contract「access/me 在途时账号改变」用例)。
    this.enterMarketing(false);
  },

  onShow() {
    merchantTheme.merchantPageShow();
    const memberId = currentMemberId();
    if (this._scopeMemberId === undefined) this._scopeMemberId = memberId;
    if (memberId !== this._scopeMemberId) {
      this._skipNextShowReload = false;
      this._resetMemberScope(memberId);
      this.retryAll();
      return;
    }
    if (this._skipNextShowReload) {
      this._skipNextShowReload = false;
      return;
    }
    this.retryAll();
  },

  // 入口:未登录先静默登录,成功自动继续;失败只留页内 entryError(重试走 retryAll)。
  enterMarketing(authRetryUsed) {
    if (this._unloaded) return;
    this._authRetryUsed = authRetryUsed === true;
    if (!currentMemberId()) {
      const that = this;
      ensureSession(app).then(function (ok) {
        if (that._unloaded) return;
        if (!ok) {
          that.setData({ entryError: '登录失败，请重试', accessState: 'checking' });
          return;
        }
        that._scopeMemberId = currentMemberId();
        that.enterMarketing(that._authRetryUsed);
      });
      return;
    }
    this._scopeMemberId = currentMemberId();
    this.loadMerchantAccess();
  },

  // 会话失效(401):静默重登一次,成功重走权限确认;失败落页内错误,不整屏「去登录」。
  recoverSession() {
    if (this._unloaded) return;
    if (this._authRetryUsed) {
      this.setData({ entryError: '登录已失效，请重新登录' });
      return;
    }
    this._authRetryUsed = true;
    const that = this;
    ensureSession(app).then(function (ok) {
      if (that._unloaded) return;
      if (!ok) {
        that.setData({ entryError: '登录失败，请重试' });
        return;
      }
      that._scopeMemberId = currentMemberId();
      that.loadMerchantAccess();
    });
  },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._unloaded = true;
    this._marketingEpoch = (this._marketingEpoch || 0) + 1;
    this._merchantEpoch = (this._merchantEpoch || 0) + 1;
    merchantTheme.merchantPageRestore();
  },

  loadMarketingHome() {
    // 权限闸:access/me 没确认过 marketing:read 就不发请求(同 #817)
    if (!this.data.merchantAccess.canReadMarketing) return;
    const that = this;
    const scopeMemberId = this._scopeMemberId === undefined
      ? currentMemberId()
      : this._scopeMemberId;
    this._scopeMemberId = scopeMemberId;
    const epoch = (this._marketingEpoch || 0) + 1;
    this._marketingEpoch = epoch;
    const isCurrent = function () {
      return !that._unloaded
        && epoch === that._marketingEpoch
        && scopeMemberId === that._scopeMemberId
        && scopeMemberId === currentMemberId();
    };
    // 401 时请求层会先清会话(账号从 X 变成空),不能把这当成「迟到回调」丢掉,
    // 否则页面停在旧结论上、静默重登永远不触发。
    const isCurrentOrSessionCleared = function () {
      return !that._unloaded
        && epoch === that._marketingEpoch
        && scopeMemberId === that._scopeMemberId
        && (!currentMemberId() || scopeMemberId === currentMemberId());
    };
    that.setData({ funnelLoading: true, funnelError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      // ★窗口走 query 参数:后端是 @RequestParam(value="windowDays"),放 body 绑不上。
      // 2026-09-18 UI-09:按用户稿删掉「经营事件」区块后不再切窗口,固定 30 天口径
      // (hero 的累计报名/核销仍由 analytics.stages 算出)。
      url: '/api/merchant/marketing-home?windowDays=30',
      method: 'POST',
      success(res) {
        const failKind = resolveAggregateFailure(res);
        if (failKind === 'anonymous') {
          if (!isCurrentOrSessionCleared()) return;
          that.recoverSession();
          return;
        }
        if (!isCurrent()) return;
        if (failKind === 'stale') {
          that._clearMetricsKeepRetry(that._getErrMsg(res, '经营身份校验未通过，请返回工作台重试'));
          return;
        }
        const home = (res.code === '200' || res.code === 200)
          ? normalizeMarketingHome(res.data) : null;
        const rows = home ? that._buildFunnelRows(home.analytics && home.analytics.stages) : null;
        if (!home || !rows) {
          const message = app.getRequestErrorMessage(res, '营销数据加载失败');
          that.setData({ funnelError: message });
          return;
        }
        const couponView = buildCouponCard(home.coupons);
        that.setData({
          hero: that._buildHero(rows, 30),
          couponCard: couponView.couponCard,
          deckGhosts: couponView.deckGhosts,
          couponRate: couponView.couponRate,
          recruitCount: home.recruiting.count,
          myContent: that._buildContentItems(home.content),
          marketingDataState: that._resolveMarketingDataState(home),
          marketingLoaded: true,
          accessState: 'ready',
          accessError: '',
          entryError: '',
        });
      },
      fail(res) {
        const failKind = resolveAggregateFailure(res);
        if (failKind === 'anonymous') {
          if (!isCurrentOrSessionCleared()) return;
          that.recoverSession();
          return;
        }
        if (!isCurrent()) return;
        if (failKind === 'stale') {
          that._clearMetricsKeepRetry(that._getErrMsg(res, '经营身份校验未通过，请返回工作台重试'));
          return;
        }
        const message = app.getRequestErrorMessage(res, '营销数据加载失败');
        that.setData({ funnelError: message });
      },
      complete() { if (isCurrent()) that.setData({ funnelLoading: false }); },
    });
  },

  // 数据源 = 聚合层的 analytics.stages(不是 home.funnel —— 那个字段在后端口径改版后
  // 就不存在了,继续读它会让整页永远落到「营销数据加载失败」)。
  // ★这里**不再产出百分比**:五步是各自发生过的事件数,不是相邻漏斗 ——
  //   相邻步骤可能跨窗口,拿这一屏相除得到的"转化率"是个算错的数字。
  //   宁可只给绝对数,也不显示一个好看但错的率(2026-08-26 用户裁决)。
  _buildFunnelRows(stages) {
    if (!Array.isArray(stages)) return null;
    const rows = [];
    for (let i = 0; i < stages.length; i++) {
      const source = stages[i];
      const step = source && typeof source.label === 'string' ? source.label.trim() : '';
      const count = finiteNonNegative(source && source.currentCount);
      if (!step || count === null) return null;
      rows.push({ step, count: Math.floor(count) });
    }
    return rows;
  },


  // 全零判定:所有业务计数都是 0 才算「服务端明确回了空」。
  // 只要有一项 > 0 就是 ready —— 未确认(unknown)绝不能当成空态,那会把
  // 「还没读到」画成「你什么都没有」,并推一个不该推的首发引导。
  _resolveMarketingDataState(home) {
    const values = [
      home.recruiting.count,
      // CU-M-51/M-86:couponCount 改口径后不再等价于「有没有券」,空态判据要带上总数。
      home.coupons.couponCount,
      home.coupons.couponTotal,
      home.coupons.received,
      home.coupons.verified,
      home.content.topicCount,
      home.content.freeExploreCount,
      home.content.activityCount,
    ].concat((home.analytics && home.analytics.stages ? home.analytics.stages : [])
      .map(function (stage) { return stage.currentCount; }));
    return values.some(function (value) { return value > 0; }) ? 'ready' : 'empty';
  },

  // 全零首屏的首发引导。只有有发布权限的岗位才看得到(wxml 侧用 canManageProjects 控 cta)
  startFirstContent() {
    if (!this.data.merchantAccess.canManageProjects) return;
    wx.navigateTo({ url: CONTENT_ROUTES.topic.create });
  },

  _buildContentItems(content) {
    const countByKey = {
      topic: content.topicCount,
      free: content.freeExploreCount,
      activity: content.activityCount,
    };
    return CONTENT_TYPES.map(function (item) {
      const count = countByKey[item.key];
      // 零条也照实写 0(2026-09-19 用户裁决:数字位不放占位符)。
      // 「零条直接进创建页」的引导不靠这个字符表达 —— 它在 goMyContent 的路由里,
      // 全零时另有 cy-empty 的首发 CTA。
      return Object.assign({}, item, {
        count,
        countText: String(count > 0 ? count : 0),
        ariaLabel: count > 0
          ? '管理' + item.title + '，共' + count + '条'
          : '创建' + item.title,
      });
    });
  },



  // 岗位权限真源。★判据:只有后端**明确表态**才认定无权限 —— access.active 不是布尔
  // (字段缺失/响应残缺)说明它没表态,那是坏响应,该给重试,不能栽成「你没权限」。
  loadMerchantAccess() {
    const that = this;
    const scopeMemberId = currentMemberId();
    const epoch = (this._accessEpoch || 0) + 1;
    this._accessEpoch = epoch;
    const isCurrent = function () {
      return !that._unloaded && epoch === that._accessEpoch && scopeMemberId === currentMemberId();
    };
    // 见 loadMarketingHome 的同名判据:401 清会话后账号变空,不能当成迟到回调丢掉。
    const isCurrentOrSessionCleared = function () {
      return !that._unloaded && epoch === that._accessEpoch
        && (!currentMemberId() || scopeMemberId === currentMemberId());
    };
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      success(res) {
        if (resolveDeniedKind(res) === 'anonymous') {
          if (!isCurrentOrSessionCleared()) return;
          that.recoverSession();
          return;
        }
        if (!isCurrent()) return;
        if (!(res && (res.code === '200' || res.code === 200) && isRecord(res.data))) {
          that.setData({ funnelError: that._getErrMsg(res, '经营身份没能确认') });
          return;
        }
        const access = normalizeMerchantAccess(res.data);
        if (!access.active || !access.canReadMarketing) {
          that._denyAccess('denied', '');
          that.setData({ merchantAccess: access, entries: entriesForAccess(access) });
          return;
        }
        that.setData({
          merchantAccess: access,
          entries: entriesForAccess(access),
          accessState: 'ready',
          accessError: '',
          entryError: '',
        });
        that.loadMarketingHome();
      },
      fail(res) {
        if (resolveDeniedKind(res) === 'anonymous') {
          if (!isCurrentOrSessionCleared()) return;
          that.recoverSession();
          return;
        }
        if (!isCurrent()) return;
        that.setData({ entryError: '网络好像出了点小差' });
      },
    });
  },

  // 重新确认 = 从权限真源重来一遍。★旧结论必须**先**失效:
  // 不清掉旧的 funnelError/accessError,一次断网重试会让页面继续显示上一次的拒权文案,
  // 用户看到的是「我明明重试了,它还说我没权限」。
  retryAll() {
    this.setData({
      accessState: 'checking',
      accessError: '',
      funnelError: '',
      entryError: '',
    });
    this.enterMarketing(false);
  },

  // 页面里「重新加载」入口的别名,语义同 retryAll(从权限真源重来)
  reloadMarketing() { this.retryAll(); },

  _resetMemberScope(memberId) {
    this._scopeMemberId = memberId;
    this._marketingEpoch = (this._marketingEpoch || 0) + 1;
    this._merchantEpoch = (this._merchantEpoch || 0) + 1;
    this._clearScopedState('checking', '');
  },

  // 明确拒权(商家成员但没有营销读权限)。未登录不在这里收口 —— 静默重登,失败走 entryError。
  // 文案与 wxml 的岗位说明同源:没有权限时页面只留这一句,不再渲染「—/数据待同步」占位
  // (2026-09-17 拍板 #25 —— 拿未知当数据画,员工会以为系统坏了而不是自己没开通)。
  _denyAccess(kind, message) {
    this._marketingEpoch = (this._marketingEpoch || 0) + 1;
    this._merchantEpoch = (this._merchantEpoch || 0) + 1;
    this._clearScopedState('denied', message || '请联系店主开通');
  },

  // 清掉不可信的旧指标,但**不动 accessState** —— 这不是拒权,是这次请求身份没过。
  // 重试按钮必须留着:撤掉它等于把一次可恢复的失败演成「你被撤权了」。
  _clearMetricsKeepRetry(message) {
    this._marketingEpoch = (this._marketingEpoch || 0) + 1;
    this.setData({
      hero: heroPlaceholder(this.data.windowDays),
      couponCard: COUPON_UNKNOWN,
      deckGhosts: 0,
      couponRate: '',
      recruitCount: 0,
      myContent: unknownContent(),
      marketingDataState: 'unknown',
      marketingLoaded: false,
      funnelLoading: false,
      funnelError: message || '营销数据加载失败',
    });
  },

  _clearScopedState(accessState, accessError) {
    this.setData({
      merchantId: 0,
      hero: heroPlaceholder(this.data.windowDays),
      funnelLoading: false,
      funnelError: '',
      marketingLoaded: false,
      accessState,
      accessError: accessError || '',
      entryError: '',
      merchantAccess: inactiveAccess(),
      entries: entriesForAccess(inactiveAccess()),
      couponCard: COUPON_UNKNOWN,
      deckGhosts: 0,
      couponRate: '',
      recruitCount: 0,
      myContent: unknownContent(),
    });
  },

  // hero:取 stages 里「报名」当主角数字,「核销」退到副行(绝对数,不算率)。
  // 标签用后端真实口径 —— 「互动量」在库里没有事件源,不拿报名数冒名顶替。
  _buildHero(rows, windowDays) {
    const label = heroWindowLabel(windowDays);
    const by = {};
    (rows || []).forEach(function (r) { by[r.step] = r; });
    const signup = by['报名'];
    const verify = by['核销'];
    if (!signup && !verify) {
      return { value: '0', sub: '还没有人报名 · 发布内容后开始积累', label: label, ariaLabel: label + ' 0' };
    }
    const value = this._compact(signup && signup.count);
    if (!verify) {
      return { value, sub: '还没有核销记录', label: label, ariaLabel: label + ' ' + value + '，还没有核销记录' };
    }
    // 只报核销的绝对数。要给比率,得先有「同一批报名里核销了多少」这种有定义的口径;
    // 拿本屏核销数除以本屏报名数不行 —— 两者可能跨窗口,不是同一批人。
    const sub = '核销 ' + this._compact(verify.count);
    return { value, sub, label: label, ariaLabel: label + ' ' + value + '，' + sub };
  },



  // 万位以上收成「12.4万」(设计稿口径),小于一万照原样。
  // 读不到的数一律落 0:本页数字位不放横杠(2026-09-19 用户裁决)。
  _compact(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    if (v < 10000) return String(v);
    return (Math.round(v / 1000) / 10) + '万';
  },

  // 有内容 → 我的项目管理页(myproject 只有 主题/活动 两个 tab,自由探索并在主题 tab 里);
  // 零内容 → 直接进对应创建页,别让用户点进一个空列表再找创建按钮。
  goMyContent(e) {
    if (!this.data.merchantAccess.canManageProjects) return;
    const ds = e.currentTarget.dataset || {};
    // 未知不等于零：数量尚未同步时进入管理页，由目标页读取真实列表；
    // 只有服务端明确回 0，才直接去创建。
    const countKnown = ds.count !== undefined && ds.count !== null && ds.count !== '';
    const empty = countKnown && Number(ds.count) === 0;
    // 自由探索 = fabu 的 mode=2(口径同 components/cy/publish-sheet/index.js),见 CONTENT_ROUTES
    const route = CONTENT_ROUTES[ds.key] || CONTENT_ROUTES.topic;
    wx.navigateTo({ url: empty ? route.create : route.manage });
  },


  go(e) {
    const action = e.currentTarget.dataset.action;
    if (action === 'coupon') {
      wx.navigateTo({ url: '/subpackageMember/coupon/coupon?scope=MERCHANT' });
    } else if (action === 'decor') {
      // 店铺装修 E0 已上线
      wx.navigateTo({ url: '/pages/merchant/decor/index' });
    } else if (action === 'aiInsight') {
      // AI 店铺参谋:打卡分析 / 适合人群 / 活动建议
      wx.navigateTo({ url: '/pages/merchant/marketing/ai-insight/index' });
    } else if (CONTENT_ROUTES[action]) {
      wx.navigateTo({ url: CONTENT_ROUTES[action].create });
    }
  },

  // 「我的内容」区头的管理入口,默认落主题
  goManage() {
    wx.navigateTo({ url: CONTENT_ROUTES.topic.manage });
  },

  goCoopCenter() {
    wx.navigateTo({ url: '/pages/merchant/coop-center/index' });
  },

  _getErrMsg(res, fallback) {
    // 只有非 200 业务失败才允许用后端 msg;200 但数据校验不过时 msg 是「操作成功」(2026-09-17 拍板)。
    if (res && (res.code === 200 || res.code === '200')) return fallback;
    return (app.getRequestErrorMessage && app.getRequestErrorMessage(res, fallback)) || fallback;
  }
});
