const loading = require('../../../utils/loading.js');
const cyToast = require('../../../utils/toast.js');
const modal = require('../../../utils/modal.js');
const app = getApp();
const { activityShareFromEvent } = require('../../../utils/activity-share.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const { merchantHomeUrl } = require('../../../utils/merchant-home-link.js');
const { isRecord, isRecordList, isBizOk } = require('../../../utils/response-shape.js');
const { inactiveAccess, normalizeMerchantAccess } = require('../../../utils/merchant-access-policy.js');
const { ensureSession } = require('../utils/session/ensure-session.js');

// cms_topic.product_type → 展示名(与 marketing 页同口径)
const PRODUCT_TYPE_TEXT = { 1: '城市定向', 2: '自由探索' };

function finiteCount(value) {
  if (value === null || value === undefined || value === '') return null;
  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}

function authenticationFailureCode(res, status) {
  const candidates = [
    status,
    res && res.statusCode,
    res && res.code,
  ];
  for (let index = 0; index < candidates.length; index += 1) {
    const code = String(candidates[index] == null ? '' : candidates[index]);
    if (code === '401' || code === '2') return code;
  }
  return '';
}

function clearInvalidSession() {
  const session = typeof app.getSession === 'function' ? app.getSession() : null;
  if (session && typeof session.clearSession === 'function') session.clearSession();
}

const { resolveVerificationResult } = require('../../../utils/merchant-verification.js');
const { resolveVerificationScan } = require('../../../utils/verification-scan.js');
const { getScene } = require('../../../utils/scene-registry.js');
const { pushScene, popScene, currentScene, exitDecision } = require('../../../utils/scene-stack.js');
const { hasTodoSummaryPayload, buildProjectCards, isEndedProject, localToday, attachVisitTexts } = require('../../../utils/merchant-workbench.js');
const { resolveApplicationResponse, decorateApplication } = require('../../../utils/merchant-identity-policy.js');
const { createWriteActionWorkflow } = require('../../../utils/write-action-workflow.js');
const { offerVerificationReadback } = require('../../../utils/verification-readback.js');
const { createGameSessionClient } = require('../../../utils/game-session-client.js');
const { attachMerchantGameEntries } = require('../utils/game-session-merchant.js');

Page({
  data: {
    refreshing: false,
    privacyGateShow: false,
    // [P0-2] ③ 选章核销面板:交集 ≥2 时装候选章节,商家选完调 scan_qr_code_chapter
    chapterSheet: { show: false, code: '', items: [] },
    stationSheet: { show: false, code: '', items: [] },
    verificationResult: { show: false, state: '', title: '', message: '' },
    statusBarHeight: 44,
    navBarHeight: 44,
    scrollIntoView: '',
    projectList: [],
    joinLoading: true,
    joinError: false,
    hostProjectList: [],
    hostProjectTotal: 0,
    hostLoading: true,
    hostError: false,
    gameEntryLoading: true,
    displayName: '商家',
    businessStatus: 1, // 1营业中 0已打烊
    merchantInfo: {},
    dashboardData: {
      revenue: null,
      pendingOrders: null,
    },
    dashboardLoading: true,
    dashboardError: '',
    // 默认 fail closed，避免首帧把上一商家或假零报表先露出来。
    merchantAccess: inactiveAccess(),
    // 身份/加载没能确认时的页内错误(cy-inline-error 承接),不再是整屏身份闸。
    consoleError: '',
    // 入驻申请审核中/未通过/停用时的页内状态卡(来源 /api/merchant/info + decorateApplication)。
    // 无商家身份的普通玩家仍走静默 switchTab,不在这里渲染。
    consoleStatus: null,
    // 参与项目真实总数(卡片只铺前几条,空态文案不能拿截断列表报数)
    joinTotal: 0,
    notifications: [],
    todo: { biddingTopics: 0, pendingVerify: 0, verifiedCount: 0, pendingScanConfirm: 0, pendingOrders: 0, refundCount: 0 },
    todoLoading: true,
    todoError: false,
    // 项目卡:承接的主题 + 主办的主题/活动合成一列,待办与动态按 (ownerType,ownerId) 归属
    projectCards: [],
    revBars: [],
    sceneStack: [],
    sceneCurrent: null,
    sceneConfirm: { show: false, action: null, pending: null },
  },

  // 隐私授权闸:app.js 优先调这里(真弹窗),没有这个方法的页面才回退到 /pages/privacy 路由页。
  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  isDevEnv() {
    try {
      return wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
    } catch (e) {
      return false;
    }
  },

  onLoad(options) {
    const gd = app.globalData || {};
    this._gameSessionClient = createGameSessionClient({ sendRequest: app.sendRequest.bind(app) });
    this._gameSummaryGeneration = 0;
    this._upcomingRuns = [];
    this._merchantGameEntries = [];
    this._merchantGameEntryTask = null;
    this.setData({
      statusBarHeight: gd.statusBarHeight || 44,
      navBarHeight: gd.navBarHeight || 44,
    });
    // 首屏数据统一由紧随其后的 onShow 在远程身份确认后加载，避免 onLoad/onShow 并发拉两整组工作台。
    if (options && options.scene) this.openScene(options.scene, { id: options.id, tab: options.tab });
  },

  refreshProfileHeader(merchantInfo, userInfo) {
    const info = merchantInfo || {};
    const user = userInfo || {};
    const displayName = info.name || user.nickname || '商家';
    const businessStatus = (info.businessStatus === 0 || info.businessStatus === '0') ? 0 : 1;
    this.setData({ displayName: displayName, businessStatus: businessStatus });
  },

  // 切换营业状态是资料写操作；员工页即使误触方法也必须在请求前关闭。
  toggleBusiness() {
    if (!this.data.merchantAccess.canWriteProfile) return;
    const that = this;
    const next = this.data.businessStatus === 1 ? 0 : 1;
    const actionEpoch = (this._businessActionEpoch || 0) + 1;
    this._businessActionEpoch = actionEpoch;
    const scopeKey = this._merchantScopeKey || '';
    const isCurrentAction = function () {
      return actionEpoch === (that._businessActionEpoch || 0)
        && scopeKey === (that._merchantScopeKey || '');
    };
    app.sendRequest({
      url: '/api/merchant/business-status/update', method: 'POST',
      data: { business_status: next },
      success(res) {
        if (!isCurrentAction()) return;
        if (res.code == '200' || res.code === 200) {
          that.setData({ businessStatus: next });
          cyToast(next === 1 ? '已营业' : '已打烊');
        } else {
          cyToast(app.getRequestErrorMessage(res, '切换失败'));
        }
      },
      fail() {
        if (!isCurrentAction()) return;
        cyToast('网络异常，请重试');
      }
    });
  },

  formatJoinCards(list) {
    return (list || []).map(function (item) {
      const reportVolume = Number(item.registrationCount || item.orderCount || item.reportCount || 0);
      const assignment = [];
      if (item.chapterName) assignment.push(item.chapterName);
      if (item.nodeName && item.nodeName !== item.chapterName) assignment.push(item.nodeName);
      if (item.startDateStr) assignment.push(item.startDateStr);
      // ⚠️ 这里曾按 searchStatus 编出 62/38 两个数,当「售出/购买比例」渲染给商家看 ——
      // 后端从来不下发这个数据,它是纯捏造的。真实数据到位前一律不显示。
      return Object.assign({}, item, {
        reportVolume: reportVolume,
        assignmentText: assignment.join(' · '),
        // 类型标签只在后端确实下发 productType 时才出;拿不到就不显示,别猜
        productTypeText: PRODUCT_TYPE_TEXT[item.productType] || '',
      });
    });
  },

  // 以下页内面板一律走场景栈:payload 仍留在各自 data 里,只有「显不显示」交给 sceneStack。
  openMoreMenu() {
    this.openScene('merchant-more-menu');
  },

  closeMoreMenu() {
    this.closeScene();
  },

  noop() {},

  openScene(id, params = {}) {
    const next = getScene(id, params);
    if (exitDecision(this.data.sceneStack, 'close') === 'confirm') {
      this.setData({ sceneConfirm: { show: true, action: 'replace', pending: next } });
      return false;
    }
    const sceneStack = pushScene(this.data.sceneStack, next);
    this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
    return true;
  },
  backScene() {
    if (exitDecision(this.data.sceneStack, 'back') === 'confirm') {
      this.setData({ sceneConfirm: { show: true, action: 'back', pending: null } });
      return;
    }
    const sceneStack = popScene(this.data.sceneStack);
    this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
  },
  // 「投一张」:scene-roam-poi-detail 只发事件,由宿主收场景再进分包城市签(3-24)
  openCityStamp(e) {
    const place = (e && e.detail && e.detail.place) || '这一站';
    this.closeScene();
    wx.navigateTo({ url: '/subpackageRoam/citystamp/index?kind=sign&place=' + encodeURIComponent(place) });
  },
  closeScene() { this.setData({ sceneStack: [], sceneCurrent: null, sceneConfirm: { show: false, action: null, pending: null } }); },
  requestSceneClose() {
    if (exitDecision(this.data.sceneStack, 'close') === 'confirm') {
      this.setData({ sceneConfirm: { show: true, action: 'close', pending: null } });
      return;
    }
    this.closeScene();
  },
  confirmSceneDiscard() {
    if (this.data.sceneConfirm.action === 'back') {
      const sceneStack = popScene(this.data.sceneStack);
      this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
      return;
    }
    if (this.data.sceneConfirm.action === 'replace' && this.data.sceneConfirm.pending) {
      const sceneStack = pushScene(this.data.sceneStack, this.data.sceneConfirm.pending);
      this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack), sceneConfirm: { show: false, action: null, pending: null } });
      return;
    }
    this.closeScene();
  },
  cancelSceneDiscard() { this.setData({ sceneConfirm: { show: false, action: null, pending: null } }); },
  setSceneDirty(dirty) {
    if (!this.data.sceneStack.length) return;
    const sceneStack = this.data.sceneStack.slice();
    sceneStack[sceneStack.length - 1] = { ...sceneStack[sceneStack.length - 1], dirty: dirty === true };
    this.setData({ sceneStack, sceneCurrent: currentScene(sceneStack) });
  },
  onSceneDirtyChange(event) { this.setSceneDirty(event.detail && event.detail.dirty); },
  openChildScene(event) {
    const detail = event.detail || {};
    if (detail.id) this.openScene(detail.id, detail.params || {});
  },
  openCityStamp(event) {
    const place = (event && event.detail && event.detail.place) || '这一站';
    this.closeScene();
    wx.navigateTo({ url: '/subpackageRoam/citystamp/index?kind=sign&place=' + encodeURIComponent(place) });
  },
  submitSceneForm() {
    const content = this.selectComponent('#sceneRouteContent');
    if (content && typeof content.submitForm === 'function') content.submitForm();
  },
  blockSceneTouch() {},

  onMoreItem(e) {
    const action = e.currentTarget.dataset.action;
    this.closeMoreMenu();
    if (action === 'messages') this.goMessages();
    else if (action === 'coupon') this.goManageCoupon();
    else if (action === 'brand') this.goBrandManage();
    else if (action === 'aftercare') this.goAftercare();
  },

  goManageCoupon() {
    wx.navigateTo({ url: '/subpackageMember/coupon/coupon?scope=MERCHANT' });
  },

  goAftercare() {
    if (!this.data.merchantAccess.canReadAftercare) return;
    wx.navigateTo({ url: '/pages/merchant/aftercare/index' });
  },
  // 今日待办(待核销/扫码待确认/待处理):后端 /api/merchant/todo-summary
  loadTodo(dataEpoch = this._dataEpoch || 0) {
    const that = this;
    this.setData({ todoLoading: true, todoError: false });
    app.sendRequest({
      hideLoading: true, url: '/api/merchant/todo-summary', method: 'POST',
      retry: 2, // 只读,断网/超时自动重发两跳
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        if ((res.code === '200' || res.code === 200) && hasTodoSummaryPayload(res.data)) {
          that.setData({ todo: res.data, todoLoading: false });
          that.refreshProjectCards();
        } else {
          that.setData({ todoLoading: false, todoError: true });
          that.refreshProjectCards();
        }
      },
      fail() {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        that.setData({ todoLoading: false, todoError: true });
        that.refreshProjectCards();
      },
    });
  },

  // 项目卡的三块数据(承接列表 / 主办列表 / 待办 / 动态)是四个独立请求,
  // 谁先回来都得能重算一次,所以统一收在这里,由各 load* 成功后调用。
  refreshProjectCards() {
    // 2026-09-16 用户裁决:「项目已结束就不显示了」。判据直接用卡片自己的状态签
    // (与 buildProjectCards 内同一条 statusLabelOf),不另按日期算一套。
    // 结束的项目仍在「全部」完整列表页里可查,工作台只是不再占位。
    const legacyTopics = new Set((this.data.projectList || []).map((item) => String(item.topicId)));
    const chapterProjects = (this._chapterProjectList || [])
      .filter((item) => !legacyTopics.has(String(item.topicId)));
    const projectCards = buildProjectCards({
      joinList: (this.data.projectList || []).concat(chapterProjects),
      hostList: this.data.hostProjectList,
      todoByProject: this.data.todo.byProject,
      events: this.data.notifications,
      todoError: this.data.todoError,
    }).filter((card) => card.statusLabel !== '已结束');
    this.refreshGameStationSummaries(projectCards);
  },

  // activityId 只来自服务端按当前登录商家过滤的 entries(只用来补出没对上承接卡的活动卡);
  // 主题报名卡仅按服务端回传的 topicId 关联,不从报名 id/topicId 猜活动 id。
  // 2026-09-23 用户裁决:卡上不写「本站可接待」这类站点状态(项目卡都是已确定接待的),
  // 改写俱乐部「谁、哪天几点到店」—— 原先为状态字逐场拉 projection 的请求一并撤掉。
  refreshGameStationSummaries(projectCards) {
    const decorated = attachMerchantGameEntries(projectCards, this._merchantGameEntries, {});
    this.setData({ projectCards: attachVisitTexts(decorated, this._upcomingRuns) });
  },

  // 俱乐部/团队即将到店的场次(含俱乐部自己开的场次);接口要 VERIFY_RECORD_READ,没这个岗位权限就不读、卡上不写。
  loadUpcomingRuns(dataEpoch = this._dataEpoch || 0) {
    if (!this.data.merchantAccess.canReadVerifyRecords) { this._upcomingRuns = []; return; }
    const that = this;
    app.sendRequest({
      hideLoading: true, url: '/api/merchant/upcoming-runs', method: 'POST',
      data: JSON.stringify({}), header: { 'Content-Type': 'application/json' },
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        that._upcomingRuns = (res.code === '200' || res.code === 200) && Array.isArray(res.data) ? res.data : [];
        that.refreshProjectCards();
      },
    });
  },

  loadMerchantGameEntries() {
    if (!this._gameSessionClient) return;
    const generation = this._gameSummaryGeneration || 0;
    if (this._merchantGameEntryTask && typeof this._merchantGameEntryTask.abort === 'function') {
      this._merchantGameEntryTask.abort();
    }
    this.setData({ gameEntryLoading: true });
    const task = this._gameSessionClient.loadMerchantEntries();
    this._merchantGameEntryTask = task;
    task.then((result) => {
      if (generation !== this._gameSummaryGeneration) return;
      this._merchantGameEntryTask = null;
      if (result && result.status === 'ready') {
        this._merchantGameEntries = result.data;
        this.setData({ gameEntryLoading: false });
      } else {
        this._merchantGameEntries = [];
        this.setData({ gameEntryLoading: false });
      }
      this.refreshProjectCards();
    });
  },

  resetGameStationSummaries(renderCards = true) {
    this._gameSummaryGeneration = (this._gameSummaryGeneration || 0) + 1;
    this._merchantGameEntries = [];
    if (this._merchantGameEntryTask && typeof this._merchantGameEntryTask.abort === 'function') {
      this._merchantGameEntryTask.abort();
    }
    this._merchantGameEntryTask = null;
    if (renderCards && this.data.projectCards.length) {
      this.setData({
        projectCards: attachMerchantGameEntries(this.data.projectCards, [], {}),
        gameEntryLoading: true,
      });
    }
  },

  // 实时动态唯一来源:/api/merchant/events(真实事件:收入到账/核销);空数组就是没有动态,不编造。
  loadEvents(dataEpoch = this._dataEpoch || 0) {
    const that = this;
    app.sendRequest({
      hideLoading: true, url: '/api/merchant/events', method: 'POST',
      retry: 2,
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        const data = ((res.code === '200' || res.code === 200) && res.data) ? res.data : [];
        that.setData({
          notifications: data.length
            ? data.map((e, i) => Object.assign({ id: i }, e))
            : [],
        });
        that.refreshProjectCards();
      },
    });
  },

  loadMerchantConsole(access, dataEpoch = this._dataEpoch || 0) {
    const currentAccess = access || this.data.merchantAccess;
    // access/me 已给出可安全展示的商家摘要；完整资料接口要求 PROFILE_WRITE，
    // 核销员/运营/财务不得为了加载工作台而先撞一次 403。
    if (currentAccess.canWriteProfile) this.loadMerchantInfo(dataEpoch);
    this.loadUserInfo(dataEpoch);
    // master #807 的商家游戏模组入口:自带 client 空守卫,与角色无关,所有员工都能看到入口。
    this.loadMerchantGameEntries();
    this.loadUpcomingRuns(dataEpoch);
    // P4 #17-1:看板/待办/动态不再只给店主,按岗位权限码加载,各自接口内部再按
    // FINANCE_READ / ORDER_READ / VERIFY_RECORD_READ 等数据块权限取数。
    if (currentAccess.canReadFinance || currentAccess.canReadOrders || currentAccess.canReadMarketing) {
      this.loadDashboard(dataEpoch);
    } else {
      this.setData({
        dashboardData: { revenue: null, pendingOrders: null },
        dashboardLoading: false,
        dashboardError: '',
        revBars: [],
      });
    }
    const canReadTodo = currentAccess.canReadVerifyRecords || currentAccess.canReadOrders
      || currentAccess.canReadAftercare || currentAccess.canManageProjects;
    if (canReadTodo) {
      this.loadTodo(dataEpoch);
    } else {
      // 没权限 ≠ 今日无待办:保持「未取到」态,项目卡这一格留空,不写假空态
      // (判据见 utils/merchant-workbench.js 的 todoUnavailable)。
      this.setData({
        todo: {
          biddingTopics: 0,
          pendingVerify: 0,
          verifiedCount: 0,
          pendingScanConfirm: 0,
          pendingOrders: 0,
          refundCount: 0,
          byProject: [],
        },
        todoLoading: false,
        todoError: true,
      });
    }
    if (currentAccess.canReadFinance || currentAccess.canReadVerifyRecords) {
      this.loadEvents(dataEpoch);
    } else {
      this.setData({ notifications: [] });
    }
    if (currentAccess.canManageProjects) {
      this.loadJoinList(dataEpoch);
      this.loadChapterProjectList(dataEpoch);
      this.loadHostProjects(dataEpoch);
    } else {
      this._legacyJoinLoading = false;
      this._chapterJoinLoading = false;
      this._legacyJoinError = false;
      this._chapterJoinError = false;
      this._legacyJoinTotal = 0;
      this._legacyJoinTopicIds = new Set();
      this._chapterJoinTopicIds = new Set();
      this._chapterProjectList = [];
      this.setData({
        joinTotal: 0, projectList: [], joinLoading: false, joinError: false,
        hostProjectList: [], hostProjectTotal: 0, hostLoading: false, hostError: false,
        projectCards: [],
      });
    }
  },

  // 重新加载:清掉页内错误再走一遍 onShow 的身份+数据链路。
  reloadConsole() {
    this.setData({ consoleError: '' });
    this.onShow();
  },

  // 商家主体发生变化时不能把上一主体的金额/项目短暂显示给新主体。
  clearMerchantScopedData() {
    if (this._verificationWorkflow) {
      this._verificationWorkflow.destroy();
      this._verificationWorkflow = null;
      loading.hide();
    }
    // hero 头像不再兜底个人头像后,userInfo 只剩 js 内部读(昵称兜底/角色同步),不进 data
    this._userInfo = null;
    this._legacyJoinLoading = false;
    this._chapterJoinLoading = false;
    this._legacyJoinError = false;
    this._chapterJoinError = false;
    this._legacyJoinTotal = 0;
    this._legacyJoinTopicIds = new Set();
    this._chapterProjectList = [];
    this._chapterJoinTopicIds = new Set();
    this.setData({
      displayName: '商家',
      businessStatus: 1,
      merchantInfo: {},
      dashboardData: { revenue: null, pendingOrders: null },
      dashboardLoading: true,
      dashboardError: '',
      revBars: [],
      projectList: [],
      joinTotal: 0,
      joinLoading: true,
      joinError: false,
      hostProjectList: [],
      hostProjectTotal: 0,
      hostLoading: true,
      hostError: false,
      todo: { biddingTopics: 0, pendingVerify: 0, verifiedCount: 0, pendingScanConfirm: 0, pendingOrders: 0, refundCount: 0, pendingPredict: 0 },
      todoLoading: true,
      todoError: false,
      projectCards: [],
      notifications: [],
      chapterSheet: { show: false, code: '', items: [] },
      stationSheet: { show: false, code: '', items: [] },
      verificationResult: { show: false, state: '', title: '', message: '' },
      sceneStack: [],
      sceneCurrent: null,
    });
  },

  isCurrentDataEpoch(dataEpoch) {
    const currentMemberId = String(app.getUserID() || '');
    return dataEpoch === (this._dataEpoch || 0)
      && (this._dataMemberId === undefined || this._dataMemberId === currentMemberId);
  },

  refreshJoinRequestState() {
    this.setData({
      joinLoading: !!(this._legacyJoinLoading || this._chapterJoinLoading),
      joinError: !!(this._legacyJoinError || this._chapterJoinError),
    });
  },

  refreshJoinTotal() {
    const legacyTopics = this._legacyJoinTopicIds || new Set();
    const chapterTopics = this._chapterJoinTopicIds || new Set();
    let chapterOnly = 0;
    chapterTopics.forEach((topicId) => {
      if (!legacyTopics.has(topicId)) chapterOnly += 1;
    });
    this.setData({ joinTotal: (this._legacyJoinTotal || 0) + chapterOnly });
  },

  syncMerchantScope(userInfo) {
    const info = userInfo || {};
    const merchant = info.merchant || {};
    const nextKey = String(app.getUserID() || '') + ':' + String(merchant.id || merchant.merchantId || '');
    if (this._merchantScopeKey !== nextKey) {
      this._businessActionEpoch = (this._businessActionEpoch || 0) + 1;
      if (this._merchantScopeKey) this.clearMerchantScopedData();
    }
    this._merchantScopeKey = nextKey;
  },

  onShow(options) {
    merchantTheme.merchantPageShow();
    this.resetGameStationSummaries();
    this._businessActionEpoch = (this._businessActionEpoch || 0) + 1;
    // 页面重新进入时作废离开前的写操作；页内下拉刷新只重读经营数据，
    // 不能让一笔仍在途的核销回执静默消失。
    if (!(options && options.preserveVerification === true)) {
      this._verificationEpoch = (this._verificationEpoch || 0) + 1;
    }
    // ★ 身份链路不再整屏判:未登录先静默登录,身份确认失败只落页内内联错误。
    //   玩家没有商家入口、商家注册后也不会看到这一页,整屏「登录后查看 / 没有商家身份」
    //   只会拦到自己人(2026-09-16 裁决)。
    this.enterConsole();
  },

  enterConsole(authRetryUsed) {
    const version = (this._consoleVersion || 0) + 1;
    this._consoleVersion = version;
    const identityMemberId = String(app.getUserID() || '');
    if (!identityMemberId) {
      this._dataEpoch = (this._dataEpoch || 0) + 1;
      if (this._merchantScopeKey) this.clearMerchantScopedData();
      this._merchantScopeKey = '';
      this._dataMemberId = '';
      this.closeScene();
      this.setData({ consoleError: '', consoleStatus: null, merchantAccess: inactiveAccess() });
      // 静默登录:成功自动继续加载;失败只留页内错误,由 reloadConsole 重试。
      ensureSession(app).then((ok) => {
        if (version !== this._consoleVersion) return;
        if (!ok || !String(app.getUserID() || '')) {
          this.setData({ consoleError: '登录失败，请重试' });
          return;
        }
        this.enterConsole(authRetryUsed === true);
      });
      return;
    }
    const dataEpoch = (this._dataEpoch || 0) + 1;
    this._dataEpoch = dataEpoch;
    this._dataMemberId = identityMemberId;
    this.setData({ consoleError: '', consoleStatus: null, merchantAccess: inactiveAccess() });
    this.loadConsoleAccess(dataEpoch, version, identityMemberId, authRetryUsed === true);
  },

  // 会话失效:静默重登一次(同一轮 onShow 内只重试一次,防死循环),成功即重走身份链路;
  // 已经重试过或重登失败,就落页内错误态,而不是整屏「去登录」。
  recoverConsoleSession(version, authRetryUsed) {
    // 会话没了:旧商家的金额/项目/入口不能继续留在屏上(与旧整屏闸同一条数据纪律)。
    if (this._merchantScopeKey) this.clearMerchantScopedData();
    this._merchantScopeKey = '';
    this._dataMemberId = '';
    this._dataEpoch = (this._dataEpoch || 0) + 1;
    this.closeScene();
    this.setData({ consoleStatus: null, merchantAccess: inactiveAccess() });
    if (authRetryUsed) {
      this.setData({ consoleError: '登录已失效，请重新登录' });
      return;
    }
    clearInvalidSession();
    ensureSession(app).then((ok) => {
      if (version !== this._consoleVersion) return;
      if (!ok) {
        this.setData({ consoleError: '登录失败，请重试' });
        return;
      }
      this.enterConsole(true);
    });
  },

  loadConsoleAccess(dataEpoch, version, identityMemberId, authRetryUsed) {
    // 身份回调只认发起请求时的那一代与那个账号;会话被请求层清空(user_id 为空)也算
    // 「同一账号的登录态失效」,不能当成迟到回调丢掉 —— 否则 401 后页面停在旧数据上。
    const isCurrentIdentity = () => version === this._consoleVersion
      && identityMemberId === String(app.getUserID() || '');
    const isCurrentOrSessionCleared = () => version === this._consoleVersion
      && (!String(app.getUserID() || '') || String(app.getUserID() || '') === identityMemberId);
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      success: (res) => {
        if (authenticationFailureCode(res, 0)) {
          if (!isCurrentOrSessionCleared()) return;
          this.recoverConsoleSession(version, authRetryUsed);
          return;
        }
        if (!isCurrentIdentity()) return;
        // ★ 拉不到身份 ≠ 没有数据。失败关闭成页内错误态,别退回假空态。
        if (!(res && (res.code === '200' || res.code === 200) && isRecord(res.data))) {
          this.setData({ consoleError: isBizOk(res) ? '经营身份没能确认' : app.getRequestErrorMessage(res, '经营身份没能确认') });
          return;
        }
        const access = normalizeMerchantAccess(res.data);
        if (access.invalid) {
          this.setData({ consoleError: '经营身份没能确认，请重新检查', consoleStatus: null, merchantAccess: inactiveAccess() });
          return;
        }
        if (!access.active) {
          if (this._merchantScopeKey) this.clearMerchantScopedData();
          this._merchantScopeKey = '';
          this.setData({ consoleError: '', consoleStatus: null, merchantAccess: access });
          // 入驻申请审核中/未通过/停用:页内显示当前状态 + 查看申请进度,不把人静默丢回会员中心
          // (2026-09-17 拍板 #24)。access/me 只给状态枚举、不给驳回/停用原因,所以原因另行回读
          // /api/merchant/info —— 与入驻申请页同一真源、同一投影(decorateApplication)。
          if (access.applicationState && access.applicationState !== 'NONE') {
            this.loadApplicationStatus(dataEpoch);
            return;
          }
          // 玩家/无商家身份账号本来进不到商家页;深链误入就静默回会员中心,不摆整屏闸。
          wx.switchTab({ url: '/pages/member/index/index' });
          return;
        }
        this.syncMerchantScope(access);
        const merchantInfo = Object.assign({}, this.data.merchantInfo, access.merchant);
        this.setData({ consoleError: '', consoleStatus: null, merchantAccess: access, merchantInfo });
        this.refreshProfileHeader(merchantInfo, this._userInfo);
        this.loadMerchantConsole(access, dataEpoch);
      },
      // 超时/断网:旧实现连 fail 回调都没有 —— 请求悄悄挂掉,页面永远停在假空态。
      fail: (res, status) => {
        if (authenticationFailureCode(res, status)) {
          if (!isCurrentOrSessionCleared()) return;
          this.recoverConsoleSession(version, authRetryUsed);
          return;
        }
        if (!isCurrentIdentity()) return;
        this.setData({ consoleError: '网络好像出了点小差' });
      },
    });
  },

  // 入驻申请状态回读:只认 /api/merchant/info 里真实存在的申请行,拿不到就落页内错误,
  // 绝不拿 access/me 的枚举自己编状态文案(页内状态卡与申请页同一投影 decorateApplication)。
  loadApplicationStatus(dataEpoch = this._dataEpoch || 0) {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/info',
      method: 'POST',
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        const resolved = resolveApplicationResponse(res);
        if (resolved && resolved.kind === 'application') {
          that.setData({ consoleError: '', consoleStatus: decorateApplication(resolved.data) });
          return;
        }
        if (resolved && resolved.kind === 'none') {
          // 身份链路刚说在审核、回读却说没有申请行:不摆状态,按「没有商家身份」的原行为走。
          wx.switchTab({ url: '/pages/member/index/index' });
          return;
        }
        that.setData({ consoleError: app.getRequestErrorMessage(res, '入驻申请状态没能确认') });
      },
      fail(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        that.setData({ consoleError: app.getRequestErrorMessage(res, '入驻申请状态没能确认') });
      },
    });
  },

  goApplicationProgress() {
    wx.navigateTo({ url: '/pages/merchant/apply/index' });
  },

  // 竞猜待答:待办汇总里的 pendingPredict 只报条数,明细与「还剩几天」在待答页。
  goPredictInbox() {
    if (!this.data.merchantAccess.canManageProjects) return;
    wx.navigateTo({ url: '/pages/merchant/predict/index' });
  },

  loadMerchantInfo(dataEpoch = this._dataEpoch || 0) {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/info',
      method: 'POST',
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        if (res.code === '200' || res.code === 200) {
          that.setData({ merchantInfo: res.data });
          that.refreshProfileHeader(res.data, that._userInfo);
        }
      },
      fail(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        that.setData({ dashboardLoading: false, dashboardError: app.getRequestErrorMessage(res, '经营数据加载失败') });
      },
    });
  },

  loadUserInfo(dataEpoch = this._dataEpoch || 0) {
    const that = this;
    if (!app.getUserID()) return;
    app.sendRequest({
      hideLoading: true,
      url: '/api/user/info',
      data: { member_id: app.getUserID() },
      method: 'POST',
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        if (res.code == '200' && res.data) {
          if (res.data.role) app.setUserRole(res.data.role);
          that._userInfo = res.data;
          that.refreshProfileHeader(that.data.merchantInfo, res.data);
        }
      }
    });
  },

  loadDashboard(dataEpoch = this._dataEpoch || 0) {
    const that = this;
    that.setData({
      dashboardLoading: true,
      dashboardError: '',
    });
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/dashboard',
      method: 'POST',
      retry: 2, // 只读,断网/超时自动重发两跳
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        const data = res && res.data;
        const expectsRevenue = that.data.merchantAccess.canReadFinance;
        const revenue = data && data.revenue !== null && data.revenue !== undefined && data.revenue !== ''
          ? Number(data.revenue) : NaN;
        const r7Valid = data
          && (res.data.revenue7d == null || isRecordList(res.data.revenue7d));
        const revenueValid = expectsRevenue ? Number.isFinite(revenue) : true;
        if ((res.code === '200' || res.code === 200) && isRecord(data) && revenueValid && r7Valid) {
          const r7 = res.data.revenue7d || [];
          const max = r7.reduce((m, d) => Math.max(m, parseFloat(d.amount) || 0), 0);
          const revBars = r7.map(d => ({
            date: d.date, amount: d.amount,
            pct: max > 0 ? Math.max(4, Math.round((parseFloat(d.amount) || 0) / max * 100)) : 0,
          }));
          that.setData({
            dashboardData: {
              revenue: expectsRevenue ? revenue.toFixed(2) : null,
              pendingOrders: finiteCount(res.data.pendingOrders),
            },
            revBars: revBars,
          });
        } else {
          that.setData({ dashboardError: app.getRequestErrorMessage(res, '经营数据加载失败') });
        }
      },
      fail(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        that.setData({ dashboardError: app.getRequestErrorMessage(res, '经营数据加载失败') });
      },
      complete() {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        that.setData({ dashboardLoading: false });
      },
    });
  },

  // 组件事件会作为第一个参数传入；不能直接把 bind:action 绑到带 epoch 参数的方法。
  reloadDashboard() { this.loadDashboard(); },

  loadJoinList(dataEpoch = this._dataEpoch || 0) {
    const that = this;
    this._legacyJoinLoading = true;
    this._legacyJoinError = false;
    this.refreshJoinRequestState();
    app.sendRequest({
      hideLoading: true,
      url: '/api/registration/merchant/list',
      retry: 2, // 只读,断网/超时自动重发两跳
      data: { status: '0' },
      method: 'POST',
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        if (res.code === '200' || res.code === 200) {
          const list = (res.data && res.data.rows) ? res.data.rows : (res.data || []);
          if (!isRecordList(list)) {
            that._legacyJoinLoading = false;
            that._legacyJoinError = true;
            that.refreshJoinRequestState();
            that.refreshProjectCards();
            return;
          }
          const withStartDateStr = function (item) {
            return Object.assign({}, item, { startDateStr: that.formatDate(item.startDate) });
          };
          const formatted = that.formatJoinCards(list.slice(0, 10).map(withStartDateStr));
          const today = localToday();
          const activeRows = list.filter((item) => !isEndedProject(item.startDate, item.endDate, today));
          that._legacyJoinTopicIds = new Set(activeRows
            .map((item) => String(item.topicId))
            .filter((topicId) => topicId && topicId !== 'undefined' && topicId !== 'null'));
          that._legacyJoinTotal = activeRows.length;
          that._legacyJoinLoading = false;
          that._legacyJoinError = false;
          that.setData({
            projectList: formatted.slice(0, 2),
          });
          that.refreshJoinTotal();
          that.refreshJoinRequestState();
          that.refreshProjectCards();
        } else {
          that._legacyJoinLoading = false;
          that._legacyJoinError = true;
          that.refreshJoinRequestState();
          that.refreshProjectCards();
        }
      },
      fail(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        that._legacyJoinLoading = false;
        that._legacyJoinError = true;
        that.refreshJoinRequestState();
        that.refreshProjectCards();
      }
    });
  },

  // 自由探索的商家承接不落旧 cms_registration_merchant；工作台直接读取现有
  // application → offer 投影，并按 topic 聚成项目卡。点卡片后仍进入既有项目页，
  // 由 chapter-node/mine 提供点位编辑能力，不复制一套项目模型。
  loadChapterProjectList(dataEpoch = this._dataEpoch || 0) {
    const that = this;
    this._chapterJoinLoading = true;
    this._chapterJoinError = false;
    this.refreshJoinRequestState();
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/chapter-application/mine',
      retry: 2,
      method: 'POST',
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        if (!(res && (res.code === '200' || res.code === 200) && isRecordList(res.data))) {
          that._chapterJoinLoading = false;
          that._chapterJoinError = true;
          that.refreshJoinRequestState();
          that.refreshProjectCards();
          return;
        }
        const byTopic = {};
        res.data.forEach((row) => {
          const topicId = row && Number(row.topicId);
          const offerActive = row && (row.offerActive === true || Number(row.offerActive) === 1);
          if (!topicId || Number(row.status) !== 1 || !offerActive) return;
          const key = String(topicId);
          if (!byTopic[key]) {
            byTopic[key] = Object.assign({}, row, {
              topicId,
              projectSource: 'chapter',
              chapterName: '',
              _chapterNames: [],
            });
          }
          if (row.chapterName && byTopic[key]._chapterNames.indexOf(row.chapterName) < 0) {
            byTopic[key]._chapterNames.push(row.chapterName);
          }
        });
        const rows = Object.keys(byTopic).map((key) => {
          const row = byTopic[key];
          row.chapterName = row._chapterNames.join('、');
          delete row._chapterNames;
          return row;
        });
        that._chapterJoinTopicIds = new Set(rows.map((row) => String(row.topicId)));
        that._chapterJoinLoading = false;
        that._chapterJoinError = false;
        // 章节承接列表只喂 refreshProjectCards 算 projectCards,自身不进 WXML ——
        // 走 setData 会被判成死数据字段,所以留在实例字段上。
        that._chapterProjectList = that.formatJoinCards(rows);
        that.refreshJoinTotal();
        that.refreshJoinRequestState();
        that.refreshProjectCards();
      },
      fail() {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        that._chapterJoinLoading = false;
        that._chapterJoinError = true;
        that.refreshJoinRequestState();
        that.refreshProjectCards();
      },
    });
  },

  // 我主办的 = 我发的主题 + 我发的活动。走 /api/project/my 一次拿全:它本来就是
  // 「我的项目」那页的数据源,同时下发 bizType/title/cover/state,活动和主题同一套字段
  // ⇒ 不用为活动另开一个列表接口,也不会两个接口各自演化出两套口径。
  loadHostProjects(dataEpoch = this._dataEpoch || 0) {
    const that = this;
    this.setData({ hostLoading: true, hostError: false });
    app.sendRequest({
      hideLoading: true,
      url: '/api/project/my',
      retry: 2, // 只读,断网/超时自动重发两跳
      method: 'POST',
      data: { pageNum: 1, pageSize: 10, scope: 'MERCHANT' },
      success(res) {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        if (!(res && (res.code === '200' || res.code === 200) && res.data && isRecordList(res.data.rows))) {
          that.setData({ hostLoading: false, hostError: true });
          that.refreshProjectCards();
          return;
        }
        const rows = res.data.rows.map(function (item) {
          return Object.assign({}, item, {
            bizType: item.bizType,
            titleText: item.title || item.name || (item.id ? ('项目 #' + item.id) : '未命名项目'),
            imgUrl: item.cover || item.imgUrl || '',
            startDateStr: that.formatDate(item.startTime || item.startDate),
          });
        });
        // 「全部 N」用后端下发的未结束项目总数(全量口径,2026-09-17 拍板 #39):
        // 列表只请求一页 10 条,拿这一页数会把 30 个项目说成 10 个。判据在后端与卡片
        // 状态签同源(isEndedProject:档期未知不算结束),前端不再自己数。
        const activeTotal = finiteCount(res.data.activeTotal);
        that.setData({
          hostProjectList: rows.slice(0, 2),
          hostProjectTotal: activeTotal === null ? 0 : activeTotal,
          hostLoading: false,
          hostError: false,
        });
        that.refreshProjectCards();
      },
      fail() {
        if (!that.isCurrentDataEpoch(dataEpoch)) return;
        that.setData({ hostLoading: false, hostError: true });
        that.refreshProjectCards();
      },
    });
  },

  reloadProjects() {
    this.loadJoinList();
    this.loadChapterProjectList();
    this.loadHostProjects();
    this.loadTodo();
  },

  formatDate(dateVal) {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal).slice(0, 10);
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${days[d.getDay()]} ${d.getMonth() + 1}月${d.getDate()}日`;
  },

  // 入口名「协作邀请」= 合作中心铃铛那一页(收到的/我发出的);聊天与系统通知在 ledger 的「站内消息」。旧的「消息与动态」是空兼容页(M-07)。
  goMessages() {
    wx.navigateTo({ url: '/pages/coop/list/index' });
  },

  // 「我的消息」是收入到账/核销流水,按类型去各自明细;「全部」与未知类型落核销记录(同时有待结算/已入账)。
  goEvent(e) {
    const type = e && e.currentTarget && e.currentTarget.dataset.type;
    wx.navigateTo({ url: '/pages/merchant/ledger/index?view=' + (type === 'income' ? 'settlement' : 'redemptions') });
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search2/index' });
  },

  _submitVerification(key, loadingTitle, options, callback) {
    const that = this;
    const verificationEpoch = this._verificationEpoch || 0;
    const scopeKey = this._merchantScopeKey || '';
    if (!this._verificationWorkflow) this._verificationWorkflow = createWriteActionWorkflow({ deadlineMs: 15000 });
    if (this._verificationWorkflow.isBusy(key)) {
      cyToast('核销处理中，请勿重复提交');
      return false;
    }
    loading.show(loadingTitle);
    const submitted = this._verificationWorkflow.run(key, function (done) {
      return app.sendRequest(Object.assign({}, options, {
        autoErrorToast: false,
        success(res) { done({ status: 'success', response: res }); },
        fail() { done({ status: 'failed', response: { code: 500, msg: '网络错误，请重试' } }); },
        successStatusAbnormal(res) {
          done({ status: 'failed', response: { code: 500, msg: (res && res.msg) || '核销失败，请重试' } });
        }
      }));
    }, function (result) {
      loading.hide();
      if (verificationEpoch !== (that._verificationEpoch || 0)
        || scopeKey !== (that._merchantScopeKey || '')) return;
      if (result.status === 'unknown') {
        callback({ code: 202, msg: '核销结果待确认，请勿重复核销；请先查看核销记录' }, result);
        offerVerificationReadback(key, that._verificationWorkflow);
        return;
      }
      callback(result.response, result);
    });
    if (!submitted) loading.hide();
    return submitted;
  },

  goScanQR() {
    const that = this;
    wx.scanCode({
      success(res) {
        const scan = resolveVerificationScan(res.result);
        if (scan.kind === 'invalid') {
          // 护栏不能是哑巴:码是好的,只是核销口在别处。给一条能点过去的指路,
          // 而不是 2 秒就消失的 toast(商家会以为玩家的码坏了)。
          if (scan.path) {
            modal.show({
              title: '核销入口不对',
              content: scan.message,
              confirmText: scan.confirmText || '我知道了',
              cancelText: '留在这里',
              success(r) {
                if (r && r.confirm) wx.navigateTo({ url: scan.path });
              },
            });
          } else {
            cyToast(scan.message);
          }
          return;
        }
        const action = scan.kind === 'group' || scan.kind === 'coupon' ? '核销' : '验票';
        that._submitVerification(scan.url + ':' + scan.code, scan.loadingTitle, {
          url: scan.url,
          data: scan.kind === 'coupon'
            ? Object.assign({}, scan.data, { scope: 'MERCHANT' })
            : scan.data,
          method: 'POST',
          // [P0-2] 本页自己接管错误提示,压掉 request-client 对 code!=200 的自动 toast:
          // 选章那条返的就是 error(核销确实没发生),不压会在弹出选章面板前先闪一条失败 toast。
          // 真错误照旧由下面的 else 分支弹,信息不丢。
        }, function (res) {
            const d = res.data || {};
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
            that.showVerificationResult(res, action);
        });
      }
    });
  },

  /**
   * [P0-2] 交集 ≥2 ⇒ 让商家自己选章。
   * 一商家在同一路线承接多章是**常态**(uk_offer_merchant_chapter 只约束一商家一章一行,
   * 不阻止一商家多章)⇒ 这不是边界情况。后端绝不默默取第一个:选错章不可逆。
   */
  openChapterSheet(code, d) {
    // chapters 带名字(后端 describeChapters)。回落 chapterIds 是为了「后端还没部署到位」的
    // 那段窗口:宁可显示「章节 101」也不能给个空面板 —— 空面板商家会以为卡死。
    const items = (Array.isArray(d.chapters) && d.chapters.length)
      ? d.chapters
      : (Array.isArray(d.chapterIds) ? d.chapterIds : []).map(function (id) { return { id: id, name: '章节 ' + id }; });
    if (!items.length) {
      cyToast('没有可核销的章节');
      return;
    }
    this.setData({ chapterSheet: { show: true, code: code, items: items } });
    this.openScene('merchant-chapter-picker');
  },

  onChapterSheetClose() {
    this.closeScene();
  },

  showVerificationResult(response, action) {
    this.setData({ verificationResult: resolveVerificationResult(response, action) });
    this.openScene('merchant-verification-result');
  },

  closeVerificationResult() {
    this.closeScene();
  },

  onChapterPick(e) {
    const id = e.currentTarget.dataset.id;
    const code = this.data.chapterSheet.code;
    const that = this;
    this.closeScene();
    this._submitVerification('/chapter:' + code + ':' + id, '核销中...', {
      url: '/api/registration/scan_qr_code_chapter',
      data: { code: code, chapterId: id },
      method: 'POST',
    }, function (r) {
        that.showVerificationResult(r, '核销');
    });
  },

  /** 城市定向同一路线中标多个据点时,必须由商家明确选择本次归属。 */
  openStationSheet(code, d) {
    const items = Array.isArray(d.stations) ? d.stations : [];
    if (!items.length) {
      cyToast('没有可核销的据点');
      return;
    }
    this.setData({ stationSheet: { show: true, code: code, items: items } });
    this.openScene('merchant-station-picker');
  },

  onStationSheetClose() {
    this.closeScene();
  },

  onStationPick(e) {
    const registrationMerchantId = e.currentTarget.dataset.registrationMerchantId;
    const code = this.data.stationSheet.code;
    const that = this;
    this.closeScene();
    this._submitVerification('/station:' + code + ':' + registrationMerchantId, '核销中...', {
      url: '/api/registration/scan_qr_code_station',
      data: { code: code, registrationMerchantId: registrationMerchantId },
      method: 'POST',
    }, function (r) {
        that.showVerificationResult(r, '核销');
    });
  },

  goCoupon() {
    wx.navigateTo({ url: '/subpackageMember/coupon/coupon?scope=MERCHANT' });
  },

  // 预览商家公开主页(玩家/达人看到的样子)— 报告 §6.1
  goPreviewProfile() {
    const mid = this.data.merchantInfo && this.data.merchantInfo.id;
    if (mid) this.openScene('roam-poi-detail', { merchantId: String(mid) });
    else cyToast('商家资料加载中，请稍候');
  },

  goFinance() {
    wx.navigateTo({ url: '/pages/merchant/ledger/index?view=settlement' });
  },

  goBrandManage() {
    wx.navigateTo({ url: '/pages/merchant/decor/index' });
  },

  // 「我的合作」进入商家关系页；订单由独立主入口承接。
  // 首页这个按钮标的是「客户」,去处就得是客户名册。
  // 原来 reLaunch 到 pages/merchant/relation —— 那页标题是「合作」、内容是「找新的合作对象」,
  // 名不副实;合作仍从底部 tab「合作」进,这里不再重复给一个入口。
  goCustomers() {
    wx.navigateTo({ url: '/pages/merchant/customer/index' });
  },

  // 商家承接档案(B2B 撮合):声明可承接能力,供达人发现对接
  // T17:承接能力/常备权益已收编进 decor(店铺装修),直达 decor,弃死壳 merchant/coop
  goCoopProfile() {
    wx.navigateTo({ url: '/pages/merchant/decor/index' });
  },

  goJoinDetail(e) {
    const { id, topicid } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/topic/merchantinfo/merchantinfo?id=${id}&topicId=${topicid}&scope=MERCHANT` });
  },

  goHostProject(e) {
    const topicId = e.currentTarget.dataset.id;
    if (topicId == null || topicId === '') return;
    wx.navigateTo({ url: '/pages/topic/merchantinfo/merchantinfo?topicId=' + topicId + '&scope=MERCHANT' });
  },

  // 一张卡三种落点:承接进本人报名记录,主办的主题进项目主页,主办的活动进活动详情。
  openProjectCard(e) {
    const ds = e.currentTarget.dataset;
    if (ds.biztype === 'activity') {
      if (ds.id == null || ds.id === '') return;
      return this.openScene('play-activity-detail', { id: ds.id });
    }
    if (ds.role === 'host') return this.goHostProject(e);
    if (ds.source === 'chapter') return this.goHostProject({
      currentTarget: { dataset: { id: ds.topicid } },
    });
    return this.goJoinDetail(e);
  },

  /* 稿 134:201 卡底那颗动作。两个去向:
     · progress → 和整卡点击同一个落点(承接进度);
     · verify   → 扫码核销。
     ⚠️ #814 删过一个「文案说核销、实际跳台账」的假入口。这里必须真的进扫码流程,
        所以直接复用页面自己的 goScanQR,不另拼一条路由。 */
  onProjectCardAction(e) {
    const ds = e.currentTarget.dataset;
    if (ds.action === 'verify') return this.goScanQR();
    if (ds.source === 'chapter') return this.goHostProject({
      currentTarget: { dataset: { id: ds.topicid } },
    });
    return this.goJoinDetail(e);
  },

  // 卡片铃铛:条数来自收入到账/核销流水,正文去核销记录看。
  // 那个页面按商家维度出全量,不做按项目过滤 —— 没有这个接口,不假装有。
  goProjectMessages() {
    this.goEvent();
  },

  goPublishedProjects() {
    wx.navigateTo({ url: '/subpackageA/pages/myproject/index?scope=MERCHANT' });
  },


  /* ⚠️ 2026-08-22:本页主体是整屏 <scroll-view style="height:100vh">,**页面自身永远不滚动**,
   * 所以 app.json 的 enablePullDownRefresh + onPullDownRefresh 从来没被触发过 —— 声称有下拉刷新、
   * 实际是死的。改用 scroll-view 自带的 refresher(refresher-enabled + bindrefresherrefresh)。
   * onPullDownRefresh 保留做兜底:万一以后页面结构改回页面级滚动,它仍然管用。 */
  onRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    this._reloadAll();
    // 四个请求各自独立、都不返回 promise;这里给一个确定的收起时机,
    // 否则要么永远转圈,要么得改动四个 load 方法的签名。
    if (this._refreshEndTimer) clearTimeout(this._refreshEndTimer);
    this._refreshEndTimer = setTimeout(() => {
      this._refreshEndTimer = null;
      this.setData({ refreshing: false });
    }, 800);
  },

  _reloadAll() {
    this.onShow({ preserveVerification: true });
  },

  onPullDownRefresh() {
    this._reloadAll();
    wx.stopPullDownRefresh();
  },

  onShareAppMessage(res) {
    const activityShare = activityShareFromEvent(res);
    if (activityShare) return activityShare;
    // 招募卡分享按钮触发：分享指定路线
    if (res.from === 'button' && res.target && res.target.dataset) {
      const { type, id, name, img } = res.target.dataset;
      if (type === 'topic' && id) {
        return {
          title: `推荐路线：${name || '城瘾城市路线'}`,
          path: `/pages/topic/index/index?id=${id}`,
          imageUrl: img || '',
        };
      }
    }
    // 默认：分享商家公开主页(让玩家/达人看到商家资料,而非通用首页)— 报告 §6.1
    // 分享路径一旦发出去就被卡片固化,只能是稳定 canonical:memberId + tab=about,不带主题上下文。
    const home = merchantHomeUrl(this.data.merchantInfo && this.data.merchantInfo.memberId);
    const mname = (this.data.merchantInfo && this.data.merchantInfo.name) || '城瘾Hub';
    return {
      title: home ? (mname + ' · 商家主页') : '城瘾Hub - 商户中心',
      path: home || '/pages/index/index',
    };
  },

  onHide() {
    this._businessActionEpoch = (this._businessActionEpoch || 0) + 1;
    if (this._refreshEndTimer) {
      clearTimeout(this._refreshEndTimer);
      this._refreshEndTimer = null;
      this.setData({ refreshing: false });
    }
    merchantTheme.merchantPageRestore();
  },

  onUnload() {
    this._consoleVersion = (this._consoleVersion || 0) + 1;
    this._identityEpoch = (this._identityEpoch || 0) + 1;
    this._dataEpoch = (this._dataEpoch || 0) + 1;
    this._verificationEpoch = (this._verificationEpoch || 0) + 1;
    this._businessActionEpoch = (this._businessActionEpoch || 0) + 1;
    if (this._refreshEndTimer) {
      clearTimeout(this._refreshEndTimer);
      this._refreshEndTimer = null;
    }
    if (this._verificationWorkflow) {
      this._verificationWorkflow.destroy();
      loading.hide();
    }
    this.resetGameStationSummaries(false);
    merchantTheme.merchantPageRestore();
  },
});
