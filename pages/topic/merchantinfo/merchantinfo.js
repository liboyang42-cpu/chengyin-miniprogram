const cyModal = require('../../../utils/modal.js');
const cyLoading = require('../../../utils/loading.js');
const cyToast = require('../../../utils/toast.js');
const app = getApp();
/* 原生 showModal / showActionSheet 由微信自己渲染,读不到 WXSS token,只收字面色值。
   值是 --cy-text-title 的镜像,改主色时两处都要动(tokens 才是真源)。
   写法与现码 pages/publish/fabu/index.js:69 的同名局部常量一致 —— 不抽成公共模块:
   小程序这批单测用的是 `unexpected require` 白名单沙箱,多一个跨文件 require
   会同时打破十几个测试装置,代价远大于这一行重复。 */
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const merchantTheme = require('../../../utils/merchant-theme.js');
const { chinaDayStart, chinaDayEnd, chinaParts } = require('../../../utils/datetime');
/* 数据条的格子只有一份实现:玩家深色版(214:384)与本页浅色版(181:575)是同一块。 */
const { buildTopicStatBar } = require('../utils/topic-detail-facts.js');
const { isRecordList } = require('../../../utils/response-shape.js');

const { validationMethodLabel } = require('../../../utils/validation-method-labels.js');
const { resolveMenuChrome } = require('../../../utils/nav-safe-area.js');

function recruitBoundaryLabel(allowed, maxXp) {
  const parts = [];
  const raw = String(allowed || '').trim();
  if (raw) {
    const names = raw.split(',')
      .map(value => validationMethodLabel(String(value).trim()))
      .filter(Boolean);
    if (names.length) parts.push('玩法限 ' + names.join('/'));
  }
  if (maxXp != null && Number(maxXp) > 0) parts.push('探索值上限 ' + Number(maxXp));
  return parts.join(' · ');
}

function perkMinValueLabel(value) {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return '权益零售价不少于 ¥' + (amount % 1 === 0 ? String(amount) : amount.toFixed(2));
}

function chapterNodeAuditLabel(status) {
  if (Number(status) === 1) return '已通过';
  if (Number(status) === 2) return '已驳回';
  return '待审核';
}

function chapterApplicationStatusLabel(status) {
  if (Number(status) === 1) return '已通过';
  if (Number(status) === 2) return '已驳回';
  return '待审核';
}

function termsModeLabel(termsMode) {
  if (termsMode === 'PERK') return '权益承接';
  if (termsMode === 'REVSHARE') return '计酬承接';
  if (termsMode === 'TRAFFIC') return '引流承接';
  return '';
}

Page({
  data: {
    reducedMotion: false,
    // 稿 181:575 的数据条(与玩家版 214:384 同一块,只换色板)
    statBar: [],
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    // 顶边复查(2026-09-18):pop-topic2 的顶不许压胶囊行,env 在模拟器/无刘海机为 0 ⇒ 取胶囊实测
    chrome: { actionTop: 28, actionRight: 12, contentTop: 76, sheetTop: 69 },

    // 入口标志
    fromMerchantJoin: false,
    // 缺参态:id 与 topicId 都没有 —— 不再渲染「未命名路线」空壳,给提示+返回
    missingParam: false,

    // 我的参与模式
    regId: 0,
    topicId: 0,
    info: {},
    loadFailed: false,
    // Hero:大图 = 路线封面,角标 = 商家自己那一站的现场图
    heroImg: '',
    heroFailed: false,
    badgeImg: '',
    modeText: '',
    assignedLabel: '',
    assignedValue: '',
    scheduleValue: '',
    templateText: '',
    templateSubText: '',
    templateReady: false,
    perkText: '',
    sharingText: '',
    factTailText: '',
    stepText: '',
    pendingCount: 0,
    verifiedCount: 0,
    totalCount: 0,
    // 区块 A 状态条
    stateKey: '',
    stateText: '',
    stateClass: '',
    stateSub: '',
    // 区块 C 场次
    // 进度 = 报名 → 审核 → 开始接待 → 结束。
    // 原来这里是 runs(哪个团几点到店):到店时间玩家常不准时,照着它安排反而误事,
    // 2026-09-05 拍板去掉,只留状态与起止日期。runs 仍在实例上喂「第 N/M 站」那个 chip。
    progress: [],
    showFulfillment: false,
    showPrep: false,
    play: null,
    reward: null,
    prepText: '',
    // 「开场前记得核一遍名单」后半句(最近一场的人数与成团态);缺就只出前半句
    prepHeadcount: '',
    coopState: 'idle', // idle | loading | ready | error
    /* CU-M-92:「只接了合作邀约、还没有点位」那一档的数据。null = 正常承接某一站。
       有值时 project-join 里按站点算的区块全部不出 —— 他没有站,那些区块只会渲染成
       一屏「待分配」「分润比例 待定」。 */
    coopPartner: null,
    // 关系入口。图标是 Figma 导出的原始资源,不是自己画的 —— 手画的 path 一定不是设计要的那个字形。
    // ★ 承接方和主办方的按钮不是同一套:承接方看不到同场其他商家(2026-08-04 用户决策),
    //   所以承接视图只有三个,「商家」那格是主办方独有的(他要管自己招了谁、还缺哪几站)。
    role: 'join',                 // join | host,后端 /api/project/home 下发
    operationScope: '',
    // 同一主题承接多站时的站点切换条。只有 >1 站才出,单站维持原样不多一条空行。
    myStations: [],
    activeStationId: 0,
    // 首屏默认值要与 buildQuickActions('join') 一致 —— 接口没回来之前先按承接方给
    quickActions: [
      { key: 'scan',     label: '扫码',   icon: '/pages/topic/images/icon_qa_scan.svg' },
      { key: 'club',     label: '俱乐部', icon: '/pages/topic/images/icon_qa_club.svg' },
      { key: 'customer', label: '客户',   icon: '/pages/topic/images/icon_qa_person.svg' },
      { key: 'more',     label: '更多',   icon: '/pages/topic/images/icon_qa_edit.svg' },
    ],
    // 本项目的俱乐部抽屉:名称 / 负责人 / 电话
    clubSheet: { show: false, items: [] },
    clubActions: [],
    // 本主题客户抽屉:谁已核销、谁待核销
    playerSheet: { show: false, filter: 'all', groups: [], summary: {}, contactHint: '', emptyText: '', errorText: '', rows: [] },
    /* 稿 471:6605 的筛选是四档:全部 / 待核销 / 已接洽 / 已核销。
       「已接洽」= 玩家扫过码、等我确认(后端 state='contacted')——
       它一直混在「待核销」里,商家因此分不出「该去催」和「人已经在店里了」。 */
    playerFilters: [
      { key: 'all', label: '全部' },
      { key: 'pending', label: '待核销' },
      { key: 'contacted', label: '已接洽' },
      { key: 'arrived', label: '已核销' },
    ],
    playerActions: [],
    // 承接商家抽屉(主办方独有)
    merchantSheet: { show: false },
    // 「更多」抽屉:按 role + stateKey 分四套(见 buildMoreGroups)
    moreSheet: { show: false, subtitle: '', groups: [] },
    /* CU-C-68:主办方抽屉里「本站运营」那组的资格探不到时的可见说明。
       探不到 ≠ 没资格,所以不能默不作声地把入口灰着不解释。 */
    stationOpsErrorText: '',
    // 一个主题开了多个场次时,「本站」入口要先选一个(稿上没有这一屏,是现码的分支)
    stationSheetShow: false,
    stationSheetItems: [],
    /* 打开章节 / 打开节点(Figma 439:6336 / 336:461)。两层是**下钻不是叠加**:
       开节点时关章节,关节点时回章节 —— 两个 cy-sheet 同时 show 会叠两层全屏遮罩,
       下层面板被夹在中间发暗(dual-sheet-mutex 契约记的就是这个)。 */
    chapterSheet: { show: false, state: 'idle', error: '', chapterName: '', story: '', storyOpen: false, nodes: [] },
    nodeSheet: { show: false, name: '', chapterText: '', play: null, reward: null, templateId: '', mine: false, actions: [] },
    merchantActions: [{ key: 'goReceivedApplies', label: '收到的申请' }],
    // 自由探索的承接标的是章节,跟城市定向的节点邀约不是一回事,所以另给一个入口。
    // 只在 productType=2 时出现 —— 城市定向没有章节,给了也点不出东西。
    // 主办视图(role=host)
    hostTopic: {},
    hostRecruit: {},
    hostMerchants: [],
    hostPlayers: {},
    chapterImg: '',
    sharingRateText: '',
    sharedAmountText: '',
    fulfillActionText: '',
    chapterActionText: '',
    primaryDisabled: false,
    isSelfTemplate: false,
    // 区块 E 待办
    todos: [],
    // 区块 F 底部主动作
    primaryAction: '',
    primaryText: '',
    rulesOpen: false,

    // 浏览模式（品牌报名详情）
    activeTab: '0',
    browseTabs: [
      { key: '0', label: '详情' },
      // 稿 181:715 与玩家页 214:384 都叫「路线节点」;这里原来叫「探索节点」,同一个 tab 两个名字
      { key: '1', label: '路线节点' },
      /* 稿 181:575(商家版)只有「详情 / 路线节点」两个 tab —— 第三个「路线」是玩家的
         导航需求(逐站地址与步行)。2026-09-04 已拍板「承接页不补路线地图:商家关心的是
         『我这一站在哪、隔壁是谁』,列表就够」,同一条口径,商家看主题时也不需要这个 tab。 */
    ],
    topicShow: false,
    davidShow: false,
    chapterNodeFormVisible: false,
    // 节点 NPC 半屏(CR-927):哪条点位打开、以及给半屏标题用的点位名
    nodeNpcFormVisible: false,
    nodeNpcNodeId: 0,
    nodeNpcNodeName: '',
    chapterNodeSubmitting: false,
    chapterNodeFormMode: 'application',
    /* CU-M-58:本次要编辑的那个已有点位(后端按「商家 + 章节」唯一键原地覆盖,
       所以重开不是新申请)。没有就是 null,表单照旧当新申请。 */
    presetChapterNode: null,
    // 后端口径 mode=1=经典定向 / mode=2=自由定向;默认自由定向
    selectedMode: 2,
    selectedModeText: '自由探索模式',
    selectedNodeId: 0,
    selectedNodeText: '',
    selectedTemplateId: 0,
    // F3 选完玩法后带进 chapter-node-form 当预选,省得同一件事在下一屏再选一遍
    selectedTemplateName: '',
    selectedChapterId: 0,
    selectedChapterText: '',
    selectedChapterTermsMode: '',
    selectedChapterCircleMode: false,
    allNodesList: [],
    allChaptersList: [],
    chapterRecruitmentLoading: false,
    chapterRecruitmentState: 'loading', // loading | error | category-missing | ready
    chapterRecruitmentError: '',
    ownerChapterApplications: [],
    ownerChapterApplicationsLoaded: false,
    ownerChapterApplicationsState: 'idle',
    pendingMerchantNodes: [],
    pendingMerchantNodesLoaded: false,
    pendingMerchantNodesState: 'idle',
    myChapterApplications: [],
    myChapterApplicationsLoaded: false,
    chapterApplicationOpen: false,
    myChapterNodes: [],
    myChapterNodesLoaded: false,
    coverFailed: false,
    detailCoverFailed: false,
    browseLoadError: '',
    isJoin: 0,
    showCheckinQr: false,
    checkinVisible: false,
    checkinQrState: 'loading',
    checkinQrUrl: '',
    checkinErr: '',
    privacyGateShow: false,
  },

  onLoad(options) {
    options = options || {};
    this.setData({ operationScope: ['MERCHANT', 'CLUB'].includes(options.scope) ? options.scope : '' });
    try {
      const w = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync();
      const mb = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
      this.setData({ chrome: resolveMenuChrome(w, mb) });
    } catch (e) { /* 拿不到就留在兜底值 */ }
    // 三个入口:
    // 1. 商家首页"我的参与"卡片:id=regId & topicId=topicId  → 承接视图
    // 2. 只带 topicId(项目主页,如发布成功后跳过来)         → 身份由后端判
    // 3. 品牌招募广场"浏览主题":id=topicId                  → 浏览视图
    if (options.topicId && options.id) {
      this.setData({ regId: parseInt(options.id), topicId: parseInt(options.topicId) });
      this.loadDetail();
    } else if (options.topicId) {
      // 身份不由前端猜:同一个人可能既是发布者又接了一站,判据在服务端。
      this.setData({ topicId: parseInt(options.topicId) });
      this.loadProjectHome();
    } else if (options.id) {
      this.setData({ topicId: parseInt(options.id), fromMerchantJoin: true });
      this.getIsJoin();
      this.loadBrowseData();
    } else {
      // 2026-09-16 截图冒烟:id 与 topicId 都没有时原先是空壳(渲染出「未命名路线 · 开放时间待定」),
      // 三条入口分支全不命中 ⇒ 不请求、不报错、也没有出口。与其他详情页统一落缺参态。
      this.setData({ missingParam: true });
    }
  },

  onShow() {

    const reducedMotion = readReducedMotion();

    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion }); merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this.closeLiveCheckin();
    merchantTheme.merchantPageRestore();
  },

  showPrivacyGate() {
    this.setData({ privacyGateShow: true });
  },
  onPrivacyGateSettled() {
    this.setData({ privacyGateShow: false });
  },

  goBack() {
    // 直达(分享/深链)时页面栈里只有自己:navigateBack 会失败,先退回商家工作台 ——
    // 缺参态加了这个返回入口后,它也必须过全页面返回根栈审计。
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.reLaunch({ url: '/pages/merchant/index/index' });
  },

  // ============ 浏览模式：拉主题详情 ============
  showBrowseError(reason) {
    this.setData({ browseLoadError: reason }, function () {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    });
  },

  // useMerchantEndpoint:M-12 降级位。商家(scope=MERCHANT)浏览招商中、但尚未对玩家上架的主题时,
  // 玩家接口判「不存在」,此时改走与招商列表同口径的商家接口;已上架主题仍走玩家接口(带评分/评论/票务)。
  loadBrowseData(useMerchantEndpoint) {
    const that = this;
    this.setData({ browseLoadError: '' });
    app.sendRequest({
      hideLoading: true,
      // 这一行在对象字面量里求值(不在 success 回调内),this 就是 page ——
      // 写成 that.data 会让 U4 门禁看不见这次真实消费,把它误判成零消费债务。
      url: (this._managedChapterProject || useMerchantEndpoint === true)
        ? '/api/topic/info-to-merchant'
        : '/api/topic/info-to-user',
      data: { id: that.data.topicId, scope: that.data.operationScope },
      method: 'POST',
      success(res) {
        if (res.code == '200' && res.data && res.data.name) {
          const d = res.data;
          d.showStartDate = that.formatDateMd(d.startDate);
          d.showEndDate = that.formatDateMd(d.endDate);
          if (d.omsTicketList) d.omsTicketList = that.processTopicDate(d.omsTicketList);
          d.totalHour = that.formatHour(d.totalTime);
          d.totalTimeFormatted = that.formatTimeToChinese(d.totalTime);
          if (d.chaptersList) {
            d.chaptersList = that.processChaptersList(d.chaptersList);
          /* 稿 181:575 的「阵容/商家」与玩家版 214:384 是同一块(只是浅色域)。
             商家版原来是旧的「参与品牌」:按章节循环,每一章都印一次标题,而且只有商家、
             没有俱乐部。口径与算法与 pages/topic/index 那份逐字相同 —— 同一件事不写两套。 */
          d.lineup = that.buildLineup(d);
          d.contentIncludes = that.buildContentIncludes(d);
            d.hasMerchants = that.checkHasMerchants(d.chaptersList);
            const allNodesList = that.flattenNodesList(d.chaptersList);
            that.setData({ allNodesList });
          }
          /* ⚠️ 星星数要取整,**评分本身不能取整** —— 原来这里把 d.averageRating 覆盖成
             四舍五入后的整数,数据条上那格就把 4.8 印成了 5。稿 181:575 写的是 4.8,
             玩家版(topic/index)也一直显示原值,是商家版这一处自己把真值改掉了。
             星星另存一个字段,不再拿评分本身当计数器。 */
          var rating = Math.max(0, Math.min(5, Math.round(Number(d.averageRating) || 0)));
          d.starList = Array.from({ length: rating }, function (v, i) { return i; });
          /* 稿 181:575 的数据条 = 玩家版 214:384 同一块。原来这页把五格写死在 wxml 里,
             玩家页又另算一套 ⇒ 同一条路线两个身份看到的关键数字对不上。现在共用一个函数。 */
          that.setData({ statBar: buildTopicStatBar(d) });
          that.setData({ info: d, coverFailed: false, detailCoverFailed: false, browseLoadError: '' });
          if (Number(d.productType) === 2) {
            that.loadMerchantRecruitmentChapters();
            that.loadMyChapterNodes();
            that.loadMyChapterApplications();
          } else {
            that.setData({
              allChaptersList: [],
              chapterRecruitmentLoading: false,
              chapterRecruitmentState: 'ready',
              chapterRecruitmentError: '',
            });
          }
        } else {
          if (useMerchantEndpoint !== true && !that._managedChapterProject
              && that.data.operationScope === 'MERCHANT' && String(res.msg || '').indexOf('不存在') >= 0) {
            that.loadBrowseData(true);
            return;
          }
          const reason = res.code == '200'
            ? '主题信息不完整，请稍后重试。'
            : (res.msg || '主题详情暂时未加载，请稍后重试。');
          that.showBrowseError(reason);
        }
      },
      fail() {
        that.showBrowseError('网络异常，主题详情暂时未加载。');
      }
    });
  },

  retryBrowseData() {
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.loadBrowseData();
  },

  // 自由探索的商家可选章节由服务端按商家品类、招募开关、容量和锁价状态过滤；
  // 普通主题详情的原始章节字段不能充当商家承接资格。
  loadMerchantRecruitmentChapters() {
    const that = this;
    that.setData({
      chapterRecruitmentLoading: true,
      chapterRecruitmentState: 'loading',
      chapterRecruitmentError: '',
    });
    app.sendRequest({
      hideLoading: true,
      url: '/api/topic/merchant-recruitment-chapters',
      data: { id: that.data.topicId, scope: that.data.operationScope },
      method: 'POST',
      success(res) {
        if (res && res.code == '200' && Array.isArray(res.data)) {
          that.setData({
            allChaptersList: that.buildMerchantChapters(res.data),
            chapterRecruitmentLoading: false,
            chapterRecruitmentState: 'ready',
            chapterRecruitmentError: '',
          });
          that.refreshMyChapterApplications();
          return;
        }
        // Q5 V1:品类缺失是可执行的前置态,不是「路线没开招募」的业务空。
        const categoryMissing = String((res && res.msg) || '').indexOf('请先完善商家品类') >= 0;
        that.setData(categoryMissing ? {
          allChaptersList: [],
          chapterRecruitmentLoading: false,
          chapterRecruitmentState: 'category-missing',
          chapterRecruitmentError: '',
        } : {
          chapterRecruitmentLoading: false,
          chapterRecruitmentState: 'error',
          chapterRecruitmentError: app.getRequestErrorMessage(res, '可承接章节加载失败，请稍后重试'),
        });
        that.refreshMyChapterApplications();
      },
      fail(res) {
        that.setData({
          chapterRecruitmentLoading: false,
          chapterRecruitmentState: 'error',
          chapterRecruitmentError: app.getRequestErrorMessage(res, '网络异常，可承接章节暂时没能加载'),
        });
        that.refreshMyChapterApplications();
      }
    });
  },

  loadMyChapterApplications(force) {
    if (this.data.myChapterApplicationsLoaded && !force) return;
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/chapter-application/mine',
      method: 'POST',
      success(res) {
        if (res.code != '200') return;
        if (!isRecordList(res.data)) return;
        const rows = res.data;
        that.setData({
          myChapterApplications: rows.filter(row => Number(row.topicId) === Number(that.data.topicId)),
          myChapterApplicationsLoaded: true,
        });
        that.refreshMyChapterApplications();
      },
    });
  },

  refreshMyChapterApplications() {
    const rows = Array.isArray(this.data.myChapterApplications) ? this.data.myChapterApplications : [];
    this.setData({
      myChapterApplications: rows.map(row => {
        const termsMode = this.chapterTermsMode(row.chapterId, row.termsMode);
        const status = Number(row.status);
        const offerActive = row.offerActive === true || Number(row.offerActive) === 1;
        return Object.assign({}, row, {
          status,
          statusLabel: chapterApplicationStatusLabel(status),
          termsMode,
          termsLabel: termsModeLabel(termsMode),
          offerActive,
          offerReadOnly: offerActive,
          canReconfirmCircleSupply: offerActive && !!Number(row.offerId) && !!row.circleThemeCode,
          circleSupplyCheckedAtText: row.circleSupplyCheckedAt
            ? String(row.circleSupplyCheckedAt).slice(0, 10) : '',
          canWithdraw: status === 0,
          canSubmitOffer: status === 1 && !offerActive && !!termsModeLabel(termsMode),
        });
      }),
    });
  },

  reconfirmCircleSupply(e) {
    const offerId = Number(e.currentTarget.dataset.offerId);
    if (!offerId) return;
    const that = this;
    app.sendRequest({
      hideLoading: false,
      url: '/api/coop/offer/circle-supply/reconfirm-current',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ offerId }),
      success(res) {
        if (res.code != '200') {
          app.tips(app.getRequestErrorMessage(res, '重新确认失败'));
          return;
        }
        cyToast.success('已重新确认');
        that.loadMyChapterApplications(true);
      },
    });
  },

  pauseCircleSupply(e) {
    const offerId = Number(e.currentTarget.dataset.offerId);
    if (!offerId) return;
    const that = this;
    cyModal.show({
      title: '暂停这份供给？',
      content: '暂停后不会再进入新的圈层探索；历史记录不会删除。',
      confirmText: '确认暂停',
      success(modal) {
        if (!modal.confirm) return;
        app.sendRequest({
          hideLoading: false,
          url: '/api/coop/offer/circle-supply/pause',
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: JSON.stringify({ offerId }),
          success(res) {
            if (res.code != '200') {
              app.tips(app.getRequestErrorMessage(res, '暂停失败'));
              return;
            }
            cyToast.success('供给已暂停');
            that.loadMyChapterApplications(true);
          },
        });
      },
    });
  },

  chapterTermsMode(chapterId, fallback) {
    if (termsModeLabel(fallback)) return fallback;
    const eligible = (this.data.allChaptersList || []).find(chapter => Number(chapter.id) === Number(chapterId));
    if (eligible && termsModeLabel(eligible.termsMode)) return eligible.termsMode;
    const publicChapter = ((this.data.info && this.data.info.chaptersList) || [])
      .find(chapter => Number(chapter.id) === Number(chapterId));
    if (!publicChapter) return '';
    const recruit = publicChapter.recruitStatus || {};
    const termsMode = publicChapter.termsMode || recruit.termsMode;
    return termsModeLabel(termsMode) ? termsMode : '';
  },

  loadMyChapterNodes(force) {
    if (this.data.myChapterNodesLoaded && !force) return;
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/chapter-node/mine',
      method: 'POST',
      data: { topicId: that.data.topicId },
      success(res) {
        if (res.code != '200') return;
        if (!isRecordList(res.data)) return;
        const rows = res.data;
        that.setData({
          myChapterNodes: rows.map(node => Object.assign({}, node, {
            auditLabel: chapterNodeAuditLabel(node.nodeAuditStatus),
          })),
          myChapterNodesLoaded: true,
        });
      },
    });
  },

  getIsJoin() {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/registration/merchant/select',
      data: { id: that.data.topicId },
      method: 'POST',
      success(res) {
        // isJoin: 0=已报名, 1=未报名(可报名)
        that.setData({ isJoin: res.code == '200' ? 0 : 1 });
      },
      fail() {
        // 接口失败时允许报名，后端会做最终校验
        that.setData({ isJoin: 1 });
      }
    });
  },

  // P1-2:首屏是 100vh 封面,图挂了就整屏空白;切到兜底占位而不是留白
  onCoverError() {
    this.setData({ coverFailed: true });
  },

  onDetailCoverError() {
    this.setData({ detailCoverFailed: true });
  },

  scrollToSecond() {
    wx.pageScrollTo({ scrollTop: 850, duration: 800 });
  },

  switchTab(e) {
    const key = e.detail && e.detail.key !== undefined ? e.detail.key : e.currentTarget.dataset.index;
    this.setData({ activeTab: String(key) });
  },

  goLocation(e) {
    const { latitude, longitude, name, address } = e.currentTarget.dataset;
    wx.openLocation({
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      name,
      address,
      scale: 18,
    });
  },


  goTemplateDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/templatedetail/templatedetail?id=' + id + '&scope=my' });
  },

  /** 「我承接的」是个入口,不是一坨字:点进去看这条路线长什么样、我这站在第几位。 */
  goTopicDetail() {
    const id = this.data.topicId || (this.data.info && this.data.info.topicId);
    if (!id) return;
    wx.navigateTo({ url: '/pages/topic/index/index?id=' + id });
  },

  bmClick2(e) {
    const that = this;
    const now = Date.now();
    const startDateStr = that.data.info.merchantSignUpStartDate;
    const endDateStr = that.data.info.merchantSignUpEndDate;
    const isFreeExplore = Number(that.data.info.productType) === 2;
    const hasChapterApplications = isFreeExplore && that.data.myChapterApplications.length > 0;
    // CU-M-07:底部按钮有申请时写「承接进度」,进度在正文「我在这条路线上的承接」,不是再开申请弹层。
    // 再申请别的章节走那一块里的 data-apply 按钮。
    const wantsApply = !!(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.apply);
    if (that.data.myChapterApplications.length > 0 && !wantsApply) {
      wx.pageScrollTo({ selector: '.my-apply', duration: 300 });
      return;
    }
    const allChaptersList = that.data.allChaptersList || [];
    const hasOpenRecruitmentChapter = allChaptersList.some(chapter => (
      chapter && chapter.recruitStatus && chapter.recruitStatus.isOpen === true
    ));
    const hasApplicationWindow = !!startDateStr && !!endDateStr;
    const startDate = hasApplicationWindow ? chinaDayStart(startDateStr) : 0;
    const endDate = hasApplicationWindow ? chinaDayEnd(endDateStr) : 0;
    const chapterApplicationOpen = isFreeExplore
      ? that.data.chapterRecruitmentState === 'ready'
        && hasOpenRecruitmentChapter
        && that.data.info.memberId != app.getUserID()
      : hasApplicationWindow
        && now >= startDate && now <= endDate
        && that.data.info.merchantStatus === 1
        && that.data.info.memberId != app.getUserID();
    that.setData({ chapterApplicationOpen });

    // 已有申请的进度与供给补录不属于「发起新申请」，不能被报名期限、招募开关或满额闸挡住。
    if (!isFreeExplore && !hasChapterApplications) {
      if (!hasApplicationWindow) {
        cyToast('报名时间信息不完整');
        return;
      }
      if (now < startDate) {
        cyToast('商家报名还没有开始哦');
        return;
      }
      if (now > endDate) {
        cyToast('商家报名已结束');
        return;
      }
      if (that.data.info.merchantStatus !== 1) {
        cyToast('当前不接受商家报名');
        return;
      }
    }
    // 2026-08-07:承接改成按**节点**查重(一个商家可承接同一路线的多站,由主办方审核把关),
    // 这道 topic 级前端闸随之撤掉 —— 留着的话后端放开了也走不到第二个节点,
    // 而且提示「您已报名该主题」会让商家以为是系统规则,不会想到去选别的站。
    // 同节点重复报名仍由后端拒(错误文案已改成「您已报名此节点」)。
    if (!hasChapterApplications && that.data.info.memberId == app.getUserID()) {
      cyToast('不可报名您发布的主题');
      return;
    }

    const allNodesList = that.data.allNodesList;
    const initialNode = (allNodesList && allNodesList.length > 0) ? allNodesList[0] : null;
    const initialChapter = (allChaptersList && allChaptersList.length > 0) ? allChaptersList[0] : null;

    that.setData({
      topicShow: true,
      selectedMode: isFreeExplore ? 2 : 1,
      selectedModeText: isFreeExplore ? '自由探索 · 选择承接章节' : '城市定向 · 选择承接节点',
      selectedNodeId: isFreeExplore ? 0 : (initialNode ? initialNode.id : 0),
      selectedNodeText: isFreeExplore ? '' : (initialNode ? initialNode.name : ''),
      selectedTemplateId: isFreeExplore ? 0 : (initialNode ? (initialNode.templateId || 0) : 0),
      selectedChapterId: isFreeExplore && initialChapter ? initialChapter.id : 0,
      selectedChapterText: isFreeExplore && initialChapter ? initialChapter.name : '',
      selectedChapterTermsMode: isFreeExplore && initialChapter ? initialChapter.termsMode : '',
    });
  },

  goMerchantCategory() {
    this.setData({ topicShow: false });
    wx.navigateTo({ url: '/pages/merchant/decor/index' });
  },

  topicClose() {
    this.setData({ topicShow: false });
  },

  davidClick() {
    this.setData({ davidShow: true });
  },

  davidClose() {
    this.setData({ davidShow: false });
  },

  selectMode(e) {
    const mode = parseInt(e.currentTarget.dataset.mode);
    const modeText = mode === 1 ? '城市定向模式' : (mode === 2 ? '自由探索模式' : '');
    this.setData({ selectedMode: mode, selectedModeText: modeText });
  },

  selectNode(e) {
    const node = e.currentTarget.dataset.node;
    if (node) {
      this.setData({
        selectedNodeId: node.id,
        selectedNodeText: node.name,
        selectedTemplateId: node.templateId || 0,
      });
    }
  },

  selectChapter(e) {
    const chapter = e.currentTarget.dataset.chapter;
    if (chapter) {
      this.setData({
        selectedChapterId: chapter.id,
        selectedChapterText: chapter.name,
        selectedChapterTermsMode: chapter.termsMode,
      });
    }
  },

  /* F3(稿 159:346)选完章节 + 玩法 →「下一步 · 填报名」。
     和旧 pop 走的是同一条路:落在 chapter-node-form 的 application 档,
     多的只是把玩法一起带过去当预选 —— 稿把选玩法提到了这一屏。
     ⚠️ 章节的 termsMode 必须跟着一起写:chapter-node-form 整套必填校验都挂在它上面,
        漏了它表单会以为「没有条款」而放行。 */
  onChapterTargetConfirm(e) {
    const d = e.detail || {};
    const chapter = d.chapter || {};
    if (!d.chapterId) return;
    this.setData({
      topicShow: false,
      selectedChapterId: d.chapterId,
      selectedChapterText: d.chapterName || chapter.name || '',
      selectedChapterTermsMode: chapter.termsMode,
      selectedChapterCircleMode: !!(this.data.info && this.data.info.circleThemeCode),
      selectedTemplateId: Number(d.templateId) || 0,
      selectedTemplateName: d.templateName || '',
      presetChapterNode: this.myNodeOfChapter(d.chapterId),
      chapterNodeFormVisible: true,
      chapterNodeFormMode: 'application',
    });
  },

  /* CU-M-58:我在这一章上已有的点位。
     后端 /api/merchant/chapter-node/submit 按(商家 + 章节)唯一键 upsert,
     再次提交是**原地覆盖**、并回到待审核 —— 所以重开表单时先把它回填进去,
     否则商家面对的是一张空表,提完才知道点位被改写。 */
  myNodeOfChapter(chapterId) {
    const id = Number(chapterId) || 0;
    if (!id) return null;
    return (this.data.myChapterNodes || [])
      .filter(node => Number(node.chapterId) === id)[0] || null;
  },

  goCreateTemplate() {
    this.setData({ topicShow: false });
    // 与 chapter-node-form 的「去创建玩法」同一条路,两处不能分家
    wx.navigateTo({ url: '/pages/publish/temp/index?scope=MERCHANT' });
  },

  goSettlement() {
    const { selectedMode, selectedNodeId, selectedTemplateId, selectedChapterId, topicId } = this.data;
    const merchantSignUpStartDate = this.data.info.merchantSignUpStartDate;
    const merchantSignUpEndDate = this.data.info.merchantSignUpEndDate;

    if (selectedMode == 1 && this.data.isJoin == 0) {
      cyToast('您已报名此主题，请勿重复报名');
      return;
    }
    if (selectedMode == 2 && !selectedChapterId) {
      cyToast('请选择承接章节');
      return;
    }
    if (selectedMode == 1 && selectedNodeId == 0) {
      cyToast('请选择节点');
      return;
    }

    if (selectedMode == 2) {
      this.setData({
        topicShow: false,
        presetChapterNode: this.myNodeOfChapter(selectedChapterId),
        chapterNodeFormVisible: true,
        chapterNodeFormMode: 'application',
      });
      return;
    }

    // 2026-07-31:这条入口恒为经典定向(mode=1),改走弹窗规范类型 B 旗舰案例——
    // 一个 cy-sheet 全屏弹窗收完"填写→提交→成功"整条链路,不再连跳三个整页。
    // 自由定向(mode=2,需要 merchantapply2 的模板编辑)这条入口从未触发过,不受影响。
    /* 稿 365:957 的提交成功页要一张摘要卡(主题 / 章节 · 第几站 · 谁)。
       这三个名字**本页手上就有**,随路由带过去 —— 让报名页为了三行字再发一次
       主题详情请求,是拿一个必然的加载态换一次已经在内存里的数据。 */
    const node = this.findNodeById(selectedNodeId);
    const params = [
      `topicId=${topicId}`,
      `nodeId=${selectedNodeId}`,
      `templateId=${selectedTemplateId || 0}`,
      `topicName=${encodeURIComponent(String((this.data.info && this.data.info.name) || ''))}`,
      `chapterName=${encodeURIComponent(String(this.data.selectedChapterText || ''))}`,
      `nodeName=${encodeURIComponent(String((node && node.name) || ''))}`,
    ].join('&');
    wx.navigateTo({ url: `/pages/topic/merchantapply/index?${params}` });
  },

  /* 按 id 在 chaptersList 里找那一站。找不到就返回 null —— 名字宁可不写,不编。 */
  findNodeById(nodeId) {
    const id = Number(nodeId) || 0;
    if (!id) return null;
    const chapters = (this.data.info && this.data.info.chaptersList) || [];
    for (let i = 0; i < chapters.length; i += 1) {
      const nodes = chapters[i].nodes || [];
      for (let j = 0; j < nodes.length; j += 1) {
        if (Number(nodes[j].id) === id) return nodes[j];
      }
    }
    return null;
  },

  closeChapterNodeForm() {
    if (!this.data.chapterNodeSubmitting) this.setData({ chapterNodeFormVisible: false });
  },

  /** 「我的点位」行 → 节点 NPC 半屏。点位 id 从 data-* 拿,不靠当前选中态。 */
  openNodeNpcForm(e) {
    const d = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const nodeId = Number(d.nodeId) || 0;
    if (nodeId <= 0) return;
    this.setData({
      nodeNpcFormVisible: true,
      nodeNpcNodeId: nodeId,
      nodeNpcNodeName: d.nodeName || '',
    });
  },

  onNodeNpcFormClose(e) {
    this.setData({ nodeNpcFormVisible: false });
    // 保存成功才刷新列表:失败留在表单里重试,不打断输入
    if (e && e.detail && e.detail.saved) this.loadMyChapterNodes(true);
  },

  onChapterNodeFormSubmit(e) {
    if (this.data.chapterNodeFormMode === 'offer') {
      this.submitApprovedChapterOffer((e && e.detail) || {});
      return;
    }
    if (this._chapterApplying) return;
    const draft = (e && e.detail) || {};
    if (!draft.chapterId || !draft.name || !draft.templateId) return;
    this._chapterApplying = true;
    this.setData({ chapterNodeSubmitting: true });
    cyLoading.show('提交申请中...');
    app.sendRequest({
      url: '/api/merchant/chapter-application/apply',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ chapterId: draft.chapterId, message: draft.message || '' }),
      success: (res) => {
        if (res.code == '200' || this.isExistingChapterApplication(res)) {
          this.submitChapterNodeDraft(draft);
          return;
        }
        this.finishChapterNodeSubmit();
        app.tips(app.getRequestErrorMessage(res, '申请失败'));
      },
      fail: () => {
        this.finishChapterNodeSubmit();
        cyToast('网络错误，请重试');
      },
    });
  },

  isExistingChapterApplication(res) {
    if (res && res.errorCode === 'CHAPTER_APPLICATION_EXISTS') return true;
    const message = String((res && res.msg) || '');
    return message.indexOf('已申请') >= 0 || message.indexOf('申请已通过') >= 0;
  },

  buildChapterOfferPayload(draft) {
    const termsMode = draft && draft.termsMode;
    const payload = {
      chapterId: Number(draft.chapterId),
      termsMode,
    };
    if (draft.circleSupplyProfile) payload.circleSupplyProfile = draft.circleSupplyProfile;
    if (termsMode === 'PERK') {
      const quotaTotal = Number(draft && draft.quotaTotal);
      if (!Number.isInteger(quotaTotal) || quotaTotal < 1) {
        app.tips('请填写至少 1 人次的核销额度');
        return null;
      }
      if (!Number(draft.perkTemplateId)) {
        app.tips('请选择实际供给的权益');
        return null;
      }
      payload.perkTemplateId = Number(draft.perkTemplateId);
      payload.quotaTotal = quotaTotal;
      return payload;
    }
    if (termsMode === 'REVSHARE') {
      const perHeadFee = Number(draft.perHeadFee);
      if (draft.perHeadFee === '' || draft.perHeadFee == null
          || !Number.isFinite(perHeadFee) || perHeadFee < 0) {
        app.tips('请填写有效的每人次计酬金额');
        return null;
      }
      payload.perHeadFee = perHeadFee;
      return payload;
    }
    if (termsMode === 'TRAFFIC') return payload;
    app.tips('章节供给档位无效');
    return null;
  },

  openChapterOfferForm(e) {
    const chapterId = Number(e && e.currentTarget && e.currentTarget.dataset.chapterId);
    const application = (this.data.myChapterApplications || [])
      .find(row => Number(row.chapterId) === chapterId);
    if (!application || Number(application.status) !== 1) {
      cyToast('申请通过后才能填写实际供给');
      return;
    }
    if (application.offerActive) {
      cyToast('供给已生效，修改需先撤回');
      return;
    }
    if (!termsModeLabel(application.termsMode)) {
      cyToast('章节供给档位暂未读取，请稍后重试');
      return;
    }
    this.setData({
      topicShow: false,
      chapterNodeFormVisible: true,
      chapterNodeFormMode: 'offer',
      presetChapterNode: null,
      selectedChapterId: chapterId,
      selectedChapterText: application.chapterName || '',
      selectedChapterTermsMode: application.termsMode,
      selectedChapterCircleMode: !!(this.data.info && this.data.info.circleThemeCode),
    });
  },

  withdrawChapterApplication(e) {
    const applicationId = Number(e && e.currentTarget && e.currentTarget.dataset.applicationId);
    const application = (this.data.myChapterApplications || [])
      .find(row => Number(row.id) === applicationId);
    if (!applicationId || !application || Number(application.status) !== 0) {
      this.loadMyChapterApplications(true);
      app.tips('申请状态已变化，请刷新后重试');
      return;
    }
    if (this._chapterWithdrawing) return;
    // 三段式第一段:确认。文案(后果 + 「此操作不可撤销」)在 utils/danger-actions.js。
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.open('merchant.chapterApplication.withdraw', { applicationId });
  },

  /** 三段式第二段:确认弹窗里点了「确认撤回」才真的发请求。 */
  onConfirmWithdrawApplication(e) {
    if (e.detail.key !== 'merchant.chapterApplication.withdraw') return;
    this.submitChapterApplicationWithdraw(e.detail.params.applicationId);
  },

  submitChapterApplicationWithdraw(applicationId) {
    if (this._chapterWithdrawing) return;
    this._chapterWithdrawing = true;
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.busyOn();   // loading 在确认键内转圈,不再盖一层全屏 showLoading
    app.sendRequest({
      url: '/api/merchant/chapter-application/withdraw',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ applicationId }),
      success: (res) => {
        if (res.code == '200') {
          this.loadMyChapterApplications(true);
          if (dc) dc.done();   // 三段式第三段:结果确认卡
          return;
        }
        if (this.isChapterWithdrawalStateError(res)) {
          this.loadMyChapterApplications(true);
          if (dc) dc.failed('申请状态已变化，请刷新后重试');
          return;
        }
        if (dc) dc.failed(app.getRequestErrorMessage(res, '撤回失败'));
      },
      fail: () => { if (dc) dc.failed('网络错误，请重试'); },
      complete: () => {
        // showLoading 已换成确认键内转圈,这里不再需要 hideLoading
        this._chapterWithdrawing = false;
      },
    });
  },

  isChapterWithdrawalStateError(res) {
    const code = res && res.errorCode;
    return code === 'CHAPTER_APPLICATION_NOT_FOUND'
      || code === 'CHAPTER_APPLICATION_STATE_CHANGED';
  },

  submitApprovedChapterOffer(draft) {
    if (this._chapterApplying) return;
    const application = (this.data.myChapterApplications || [])
      .find(row => Number(row.chapterId) === Number(draft.chapterId));
    if (!application || Number(application.status) !== 1 || application.offerActive) {
      this.loadMyChapterApplications(true);
      app.tips('承接状态已变化，请刷新后重试');
      return;
    }
    const payload = this.buildChapterOfferPayload(draft);
    if (!payload) return;
    this._chapterApplying = true;
    this.setData({ chapterNodeSubmitting: true });
    cyLoading.show('提交供给中...');
    app.sendRequest({
      url: '/api/coop/offer/enroll',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      success: (res) => {
        if (res.code == '200') {
          this.setData({ chapterNodeFormVisible: false });
          this.finishChapterNodeSubmit();
          this.loadMyChapterApplications(true);
          cyToast.success('实际供给已生效');
          return;
        }
        this.finishChapterNodeSubmit();
        this.loadMyChapterApplications(true);
        app.tips(app.getRequestErrorMessage(res, '供给提交失败'));
      },
      fail: () => {
        this.finishChapterNodeSubmit();
        cyToast('网络错误，请重试');
      },
    });
  },

  submitChapterNodeDraft(draft) {
    app.sendRequest({
      url: '/api/merchant/chapter-node/submit',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        chapterId: draft.chapterId,
        templateId: draft.templateId,
        name: String(draft.name).trim(),
        address: draft.address || '',
        xpValue: draft.xpValue == null ? null : Number(draft.xpValue),
      }),
      success: (res) => {
        if (res.code == '200') {
          this.setData({ chapterNodeFormVisible: false });
          this.loadMyChapterNodes(true);
          this.loadMyChapterApplications(true);
          cyToast.success('已提交，等待审核');
          return;
        }
        app.tips(app.getRequestErrorMessage(res, '点位提交失败'));
      },
      fail: () => {
        cyToast('网络错误，请重试');
      },
      complete: () => this.finishChapterNodeSubmit(),
    });
  },

  finishChapterNodeSubmit() {
    this._chapterApplying = false;
    this.setData({ chapterNodeSubmitting: false });
    cyLoading.hide();
  },

  buildMerchantChapters(chaptersList) {
    if (!chaptersList || !Array.isArray(chaptersList)) return [];
    return chaptersList
      .filter(chapter => chapter && chapter.id && chapter.recruitStatus && chapter.recruitStatus.isOpen === true)
      .map(chapter => {
        const recruit = chapter.recruitStatus;
        const termsMode = recruit.termsMode || 'PERK';
        const maxMerchant = Number(recruit.maxMerchant);
        const remaining = recruit.remainingMerchantCount;
        return {
        ...chapter,
        termsMode,
        categoryLabel: chapter.category || '未配置招募品类',
        requiredLabel: Number(chapter.required) === 0 ? '可选章节' : '必选章节',
        termsLabel: termsMode === 'TRAFFIC' ? '引流承接'
          : (termsMode === 'REVSHARE' ? '计酬承接' : '权益承接'),
        boundaryLabel: recruitBoundaryLabel(recruit.allowedValidationMethods, recruit.maxNodeXp),
        perkMinValueLabel: termsMode === 'PERK' ? perkMinValueLabel(recruit.perkMinValue) : '',
        merchantLimitLabel: remaining === null || remaining === undefined
          ? '名额不限'
          : `剩余 ${remaining} / ${maxMerchant} 家可承接`,
        };
      });
  },

  flattenNodesList(chaptersList) {
    if (!chaptersList || !Array.isArray(chaptersList)) return [];
    let allNodes = [];
    for (let i = 0; i < chaptersList.length; i++) {
      const chapter = chaptersList[i];
      if (chapter.nodes && Array.isArray(chapter.nodes)) {
        const validNodes = chapter.nodes.filter(node => node.templateId && node.templateId > 0);
        allNodes = allNodes.concat(validNodes.map(node => ({
          ...node,
          chapterName: chapter.name,
          chapterId: chapter.id,
        })));
      }
    }
    return allNodes;
  },

  /* 阵容 = 参与品牌(俱乐部 + 商家),不是报名玩家。与 pages/topic/index 的同名方法
     逐字同源:同一家商家挂在多个节点上要去重,俱乐部没有头像字段交给 cy-avatar 兜底,
     名字都没有的行直接跳过。 */
  /* 稿 181:644 / 214:499 的「活动内容」——主题介绍下面那串「这趟里都有什么」。
     ⚠️ 稿上那六条(5 articles / 12 downloadable resources / 10 coding exercises /
        Full lifetime access / Access on mobile and TV / Certificate of completion)
        是 Udemy 的占位内容,按「那些不是我们的不做」一条都不抄。
        但**这个位置本身是真的**:买家在这一屏看不到「有几章、有没有语音导览、
        通关给不给勋章和券」—— 这四件事全在 /api/topic/info-to-user 的返回里,
        只是从来没渲染过(全仓 grep 过:finishMedalName / completeRewardCouponId /
        totalChapterCount 在两个详情页里一次都没出现)。
     只写后端真给了的事实,拿不到就少一条;一条都没有整块不出 —— 不摆空标题。
     ⚠️ 不重复顶部数据条已经说过的(评价 / 预计游玩 / 开放时间 / 总里程)。 */
  buildContentIncludes(data) {
    const d = data || {};
    const out = [];
    const chapters = Number(d.totalChapterCount);
    if (Number.isFinite(chapters) && chapters > 0) out.push(chapters + ' 个章节');
    /* CU-C-66:商家版同一个快照毛病 —— 「N 个站点」读 cms_topic.location_count,
       商家点位新增/过审后不重算它,而下面那张站点列表是实时查的(同一条路线两个数)。
       这里与玩家版同口径:按手上的 chaptersList 实算。 */
    const liveStations = (Array.isArray(d.chaptersList) ? d.chaptersList : [])
      .reduce((sum, chapter) => sum + (((chapter && chapter.nodes) || []).length), 0);
    const stations = liveStations > 0 ? liveStations : Number(d.locationCount);
    if (Number.isFinite(stations) && stations > 0) out.push(stations + ' 个站点');
    const plays = Number(d.templateCount);
    if (Number.isFinite(plays) && plays > 0) out.push(plays + ' 个玩法');
    if (d.audioUrl) {
      const mins = Math.round(Number(d.audioDuration) / 60);
      out.push(Number.isFinite(mins) && mins > 0 ? ('语音导览 ' + mins + ' 分钟') : '语音导览');
    }
    // 勋章名可以为空(后端默认「主题名 · 通关」),所以判据是**有没有配**,不是名字非空
    if (d.finishMedalName || d.finishMedalImg) {
      out.push('通关勋章：' + (d.finishMedalName || (d.name ? d.name + ' · 通关' : '通关纪念')));
    }
    // 只知道配了券、拿不到券名(TopicInfoVO 没有这个字段)—— 就只说配了,不编一个名字
    if (d.completeRewardCouponId) out.push('通关后可领一张优惠券');
    return out;
  },

  buildLineup(data) {
    const rows = [];
    if (data && String(data.clubName || '').trim()) {
      rows.push({ key: 'club-' + (data.clubId || 0), kind: 'club', targetId: data.clubId || 0,
        name: String(data.clubName).trim(), role: '俱乐部', avatar: '' });
    }
    const seen = {};
    const chapters = (data && data.chaptersList) || [];
    for (let i = 0; i < chapters.length; i++) {
      const nodes = (chapters[i] && chapters[i].nodes) || [];
      for (let j = 0; j < nodes.length; j++) {
        const list = nodes[j].registrationMerchantList || [];
        for (let k = 0; k < list.length; k++) {
          const row = list[k];
          const shop = row && row.mmsMerchant;
          const name = String((shop && shop.name) || '').trim();
          if (!name) continue;
          const dedupeKey = String((shop && shop.id) || name);
          if (seen[dedupeKey]) continue;
          seen[dedupeKey] = 1;
          rows.push({ key: 'merchant-' + dedupeKey, kind: 'merchant', targetId: row.memberId || 0,
            name, avatar: String(row.picUrl || '').split(',')[0].trim(), role: '商家' });
        }
      }
    }
    return rows;
  },

  /* 俱乐部去俱乐部页,商家去个人主页;没有落点就不跳,不静默跳到一个错的地方。 */
  onLineupTap(e) {
    const { kind, id } = e.currentTarget.dataset;
    const targetId = Number(id) || 0;
    if (!targetId) return;
    wx.navigateTo({ url: kind === 'club'
      ? '/pages/club/detail/index?id=' + targetId
      : '/pages/userinfo/userinfo?userId=' + targetId });
  },

  processChaptersList(chaptersList) {
    if (!chaptersList || !Array.isArray(chaptersList)) return chaptersList;
    for (let j = 0; j < chaptersList.length; j++) {
      const chapter = chaptersList[j];
      let hasMerchants = 0;
      if (chapter.nodes && Array.isArray(chapter.nodes)) {
        for (let i = 0; i < chapter.nodes.length; i++) {
          const node = chapter.nodes[i];
          if (node.registrationMerchantList && node.registrationMerchantList.length > 0) {
            hasMerchants = 1;
            break;
          }
        }
      }
      chaptersList[j].isRegistrationMerchant = hasMerchants;
      // 稿 181:715:章节标题下面这行说的是**这一章**的时长 / 地点数 / 玩法数。
      // 原来读的是 info.*(整个主题的合计),挨着章节标题印,看上去就像这一章的 ——
      // 三章会印出三组一模一样的数,零报错。字段在 CmsTopicChapter 上本来就有。
      // 拿不到的那一项不写,不补 0(补 0 会说成「这章 0 个地点」)。
      chaptersList[j].metaTime = chapter.totalTime ? this.formatTimeToChinese(chapter.totalTime) : '';
      // 单位跟着数一起在这里拼:wxml 里「{{x}} 个节点」这种插值紧跟单位的写法,
      // 值缺了会变成孤零零一个「个节点」(有门禁专门拦)。
      // CU-C-66:章节级同一个快照毛病 —— 按本章真实节点数列
      const nodeCount = (chapter.nodes || []).length || Number(chapter.locationCount) || 0;
      chaptersList[j].metaPlace = nodeCount > 0 ? nodeCount + ' 个节点' : '';
      chaptersList[j].metaPlay = Number(chapter.templateCount) > 0 ? chapter.templateCount + ' 个玩法' : '';
      chaptersList[j].hasMeta = !!(chaptersList[j].metaTime || chaptersList[j].metaPlace || chaptersList[j].metaPlay);
    }
    return chaptersList;
  },

  checkHasMerchants(chaptersList) {
    if (!chaptersList || !Array.isArray(chaptersList)) return false;
    for (let j = 0; j < chaptersList.length; j++) {
      const chapter = chaptersList[j];
      if (chapter.isRegistrationMerchant > 0) return true;
      if (chapter.nodes && Array.isArray(chapter.nodes)) {
        for (let i = 0; i < chapter.nodes.length; i++) {
          const node = chapter.nodes[i];
          if (node.registrationMerchantList && node.registrationMerchantList.length > 0) return true;
        }
      }
    }
    return false;
  },

  processTopicDate(list) {
    if (!list || list.length === 0) return list;
    for (let i = 0; i < list.length; i++) {
      if (list[i].startTime) {
        const [datePart, timePart] = list[i].startTime.split(' ');
        const [, month, day] = datePart.split('-');
        const [hour, minute] = timePart.split(':');
        list[i].monthDayTime = `${month}-${day} ${hour}:${minute}`;
      }
      if (list[i].endTime) {
        const [datePart, timePart] = list[i].endTime.split(' ');
        const [, month, day] = datePart.split('-');
        const [hour, minute] = timePart.split(':');
        list[i].endMonthDayTime = `${month}-${day} ${hour}:${minute}`;
      }
      if (list[i].isExpanded === undefined) list[i].isExpanded = false;
    }
    return list;
  },

  formatDateMd(dateString) {
    if (!dateString) return '';
    const parts = chinaParts(dateString);
    return parts ? `${parts.month}.${parts.day}` : '';
  },

  formatHour(seconds) {
    if (seconds === null || seconds === undefined || seconds === '') return 0;
    const sec = Number(seconds);
    if (isNaN(sec) || sec < 0) return 0;
    const hours = sec / 3600;
    return hours % 1 === 0 ? hours : Math.round(hours * 10) / 10;
  },

  formatTimeToChinese(seconds) {
    if (seconds === null || seconds === undefined || seconds === '') return '0时';
    const sec = Number(seconds);
    if (isNaN(sec) || sec < 0) return '0时';
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    if (hours === 0) return minutes === 0 ? '小于1分钟' : `${minutes}分钟`;
    return minutes === 0 ? `${hours}时` : `${hours}时${minutes}分`;
  },

  // 承接多站时切换当前查看的站。切的是 regId,后续详情/动作全部跟着走同一条既有链路,
  // 不另起一套 —— 多站只是"同一个页面看不同那条记录",不是新形态。
  // 承接多站时切换当前查看的站:切的是 regId,后续详情/动作全走同一条既有链路,
  // 不另起一套 —— 多站只是「同一个页面看不同那条记录」,不是新形态。
  switchStation(e) {
    const next = Number((e.currentTarget.dataset || {}).id) || 0;
    if (!next || next === this.data.activeStationId) return;
    this.setData({ activeStationId: next, regId: next });
    this.loadDetail();
  },

  // ============ 我的参与模式 ============
  loadDetail() {
    if (!this.data.regId) {
      app.tips('缺少参与记录，请返回重试');
      return;
    }
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/registration/merchant/info',
      data: { id: that.data.regId },
      method: 'POST',
      success(res) {
        if (res.code == '200' && res.data) {
          that.setData({ loadFailed: false });
          that.processData(res.data);
          that.loadUpcomingRuns();
          that.loadCoop();
        } else {
          // 整页错误态,不再是 toast 一闪之后留一屏空白
          that.setData({ loadFailed: true });
          app.tips(res.msg || '加载失败');
        }
      },
      fail() {
        that.setData({ loadFailed: true });
        app.tips('网络异常，请重试');
      }
    });
  },

  /**
   * 只带 topicId 进来时:先问后端我是谁,再决定渲染哪一半。
   * host 段直接用聚合接口的数据渲染;join 段仍走原来的详情流程,
   * 因为承接视图要的字段(玩法/奖励/场次)在那条链路上已经齐了。
   */
  loadProjectHome() {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/project/home', method: 'POST',
      data: JSON.stringify({ topicId: that.data.topicId, scope: that.data.operationScope }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.code != '200' || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) {
          that.setData({ loadFailed: true });
          return;
        }
        const d = res.data;
        if (d.role === 'host') {
          that.setData({ loadFailed: false, role: 'host' });
          that.applyHome(d);
          that.loadOwnerChapterApplications();
          that.loadPendingMerchantNodes();
          return;
        }
        // 承接方:聚合接口里带着报名记录,拿它的 id 回到既有详情流程
        const reg = d.join && d.join.registration;
        if (reg && reg.id) {
          // 同一主题可承接多站(PR #585)。只渲染第一条的话,后面几站在页面上根本不存在 ——
          // 2026-08-07 现网已有 2 例。这里把全部站做成可切换的列表,当前站仍是第一条。
          const rawRegistrations = d.join && d.join.registrations;
          if (rawRegistrations != null && !isRecordList(rawRegistrations)) {
            that.setData({ loadFailed: true });
            return;
          }
          const all = rawRegistrations || [];
          const myStations = all.length > 1 ? all.map(function (r) {
            return { id: r.id, name: r.nodeName || r.chapterName || '未命名站点' };
          }) : [];
          that.setData({
            loadFailed: false, role: 'join', regId: reg.id,
            myStations: myStations, activeStationId: reg.id,
          });
          that.loadDetail();
          return;
        }
        // 自由探索章节承接走 application → offer → chapter-node，不会生成旧 registration。
        // 这类项目直接进入本页既有的「我的点位 / 我的承接申请」管理视图；不伪造 regId，
        // 也不另建一套承接详情。
        const chapterApplications = d.join && d.join.chapterApplications;
        if (isRecordList(chapterApplications) && chapterApplications.length) {
          // 只决定 loadBrowseData 走 info-to-merchant 还是 info-to-user,WXML 不渲染它 ——
          // 进 setData 会被判成死数据字段,所以留在实例字段上。
          that._managedChapterProject = true;
          that.setData({
            loadFailed: false, role: 'join', fromMerchantJoin: true, regId: 0,
          });
          that.loadBrowseData();
          return;
        }
        /* 只接了合作邀约、没有任何站点(CU-M-92)。他也是这条路线的承接方,给承接视图。
           ⚠️ 视图里列不出「我的点位 / 我的承接申请」—— 接受 type0 邀约落的是整主题的
           商务条款(coop_order),后端 [D22] 明确不走「接受时补建报名行」:邀约带条款,
           报名行要履约细节。他的承接对象是整条路线的到店核销与分成,不是某一站。 */
        const coopInvite = d.join && d.join.coopInvite;
        if (coopInvite && coopInvite.inviteId) {
          const topic = d.topic || {};
          that.setData({
            loadFailed: false, role: 'join', fromMerchantJoin: false, regId: 0,
            info: { topicId: topic.id, topicName: topic.name },
            heroImg: that.firstImg(topic.imgUrl),
            heroFailed: false,
            modeText: Number(topic.productType) === 2 ? '自由探索' : '城市定向',
            // 与 processData 那条同一个写法(同一个组件的同一行,两种日期格式会读成两件事)
            scheduleValue: (topic.startDate && topic.endDate)
              ? (that.formatDayMonth(topic.startDate) + ' – ' + that.formatDayMonth(topic.endDate)) : '',
            stateKey: 'cooped',
            stateText: '合作已达成',
            stateClass: 'state-ok',
            coopPartner: {
              inviteId: coopInvite.inviteId,
              termsText: coopInvite.terms || '',
              // 后端已经格式化成 yyyy-MM-dd:Map 里的 Date 走不到字段上的 @JsonFormat
              acceptedText: coopInvite.handleTime || '',
            },
            quickActions: that.buildQuickActions('coopPartner'),
            'clubSheet.items': that.mapClubs(d.join && d.join.clubs),
          });
          return;
        }
        that.setData({ loadFailed: true });
      },
      fail() { that.setData({ loadFailed: true }); }
    });
  },

  loadOwnerChapterApplications(force) {
    if (this.data.role !== 'host' || (this.data.ownerChapterApplicationsLoaded && !force)) return;
    const topicId = Number(this.data.topicId);
    if (!topicId) return;
    const that = this;
    this.setData({ ownerChapterApplicationsState: 'loading' });
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/chapter-application/owner-list',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ topicId, scope: that.data.operationScope }),
      success(res) {
        if (res.code != '200' || !Array.isArray(res.data)) {
          that.setData({ ownerChapterApplicationsState: 'error' });
          return;
        }
        that.setData({
          ownerChapterApplications: res.data.map(function (row) {
            const status = Number(row.status);
            return Object.assign({}, row, {
              actionable: status === 0,
              statusLabel: chapterApplicationStatusLabel(status),
              sourceLabel: Number(row.source) === 1 ? '主办方邀请' : '商家申请',
            });
          }),
          ownerChapterApplicationsLoaded: true,
          ownerChapterApplicationsState: 'ready',
        });
      },
      fail() { that.setData({ ownerChapterApplicationsState: 'error' }); },
    });
  },

  loadPendingMerchantNodes(force) {
    if (this.data.role !== 'host' || (this.data.pendingMerchantNodesLoaded && !force)) return;
    const topicId = Number(this.data.topicId);
    if (!topicId) return;
    const that = this;
    this.setData({ pendingMerchantNodesState: 'loading' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/merchant/chapter-node/pending',
      method: 'POST',
      data: { topicId, scope: that.data.operationScope },
      success(res) {
        if (res.code != '200' || !Array.isArray(res.data)) {
          that.setData({ pendingMerchantNodesState: 'error' });
          return;
        }
        that.setData({
          pendingMerchantNodes: res.data,
          pendingMerchantNodesLoaded: true,
          pendingMerchantNodesState: 'ready',
        });
      },
      fail() { that.setData({ pendingMerchantNodesState: 'error' }); },
    });
  },

  retryChapterReviews() {
    this.loadOwnerChapterApplications(true);
    this.loadPendingMerchantNodes(true);
  },

  auditChapterApplication(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const applicationId = Number(dataset.id);
    const approved = dataset.approved === true || dataset.approved === 'true' || Number(dataset.approved) === 1;
    if (!applicationId || this._chapterApplicationAuditing) return;
    const that = this;
    const submit = function (auditRemark) {
      that._chapterApplicationAuditing = true;
      app.sendRequest({
        url: '/api/merchant/chapter-application/audit',
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          applicationId,
          approved,
          auditRemark: auditRemark || '',
          scope: that.data.operationScope,
        }),
        success(res) {
          if (res.code != '200') {
            app.tips(app.getRequestErrorMessage(res, '审核失败'));
            return;
          }
          cyToast(approved ? '已通过申请' : '已婉拒申请');
          that.loadOwnerChapterApplications(true);
          that.loadPendingMerchantNodes(true);
          that.loadProjectHome();
        },
        fail(res) { app.tips(app.getRequestErrorMessage(res, '审核失败')); },
        complete() { that._chapterApplicationAuditing = false; },
      });
    };
    if (approved) {
      /* CU-C-63(用户裁定 A:保持联动):后端把「点位跟着申请一起处置」做成硬联动
         (MerchantChapterApplicationServiceImpl 同事务调 auditAlongApplication),确认框却
         只说供给与点位,商家/主办方看不出点位也会跟着过审 —— 而点位一过审就对玩家公开。 */
      cyModal.show({
        title: '通过章节申请',
        content: '通过后商家即可按约定准备供给与点位；本次已提交的点位将一并通过审核。',
        confirmText: '确认通过',
        success(res) { if (res.confirm) submit('通过'); },
      });
      return;
    }
    cyModal.show({
      title: '婉拒章节申请',
      editable: true,
      placeholderText: '填写原因，商家可据此修改后重申',
      confirmText: '确认婉拒',
      success(res) {
        if (!res.confirm) return;
        const reason = String(res.content || '').trim();
        if (!reason) { app.tips('请填写婉拒原因'); return; }
        submit(reason);
      },
    });
  },

  auditMerchantNode(e) {
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const nodeId = Number(dataset.id);
    const approve = dataset.approved === true || dataset.approved === 'true' || Number(dataset.approved) === 1;
    if (!nodeId || this._merchantNodeAuditing) return;
    const that = this;
    const submit = function (reason) {
      that._merchantNodeAuditing = true;
      app.sendRequest({
        url: '/api/merchant/chapter-node/audit',
        method: 'POST',
        data: { nodeId, approve, reason: reason || '', scope: that.data.operationScope },
        success(res) {
          if (res.code != '200') {
            app.tips(app.getRequestErrorMessage(res, '点位审核失败'));
            return;
          }
          cyToast(approve ? '点位已通过' : '点位已驳回');
          that.loadPendingMerchantNodes(true);
        },
        fail(res) { app.tips(app.getRequestErrorMessage(res, '点位审核失败')); },
        complete() { that._merchantNodeAuditing = false; },
      });
    };
    if (approve) {
      cyModal.show({
        title: '通过商家点位',
        content: '这是内容准入，不代表平台或主办方为商家背书。',
        confirmText: '确认通过',
        success(res) { if (res.confirm) submit('通过'); },
      });
      return;
    }
    cyModal.show({
      title: '驳回商家点位',
      editable: true,
      placeholderText: '填写需修改的内容',
      confirmText: '确认驳回',
      success(res) {
        if (!res.confirm) return;
        const reason = String(res.content || '').trim();
        if (!reason) { app.tips('请填写驳回原因'); return; }
        submit(reason);
      },
    });
  },

  /** 主办视图的数据整形。数字一律给兜底,别把 undefined 渲染出去。 */
  applyHome(d) {
    const topic = d.topic || {};
    const host = d.host || {};
    const recruit = host.recruit || {};
    const players = host.players || {};
    this._isFreeExploreHost = Number(topic.productType) === 2;
    const nodeTotal = recruit.nodeTotal || 0;
    const nodeFilled = recruit.nodeFilled || 0;
    this.setData({
      quickActions: this.buildQuickActions('host', host.ownerType, host.canEdit),
      hostOwnerType: host.ownerType || 'merchant',
      'clubSheet.items': this.mapClubs(host.clubs),
      hostTopic: {
        name: topic.name || '未命名路线',
        img: this.firstImg(topic.imgUrl),
        circleThemeCode: topic.circleThemeCode || '',
        circleReviewText: topic.circleReviewedAt
          ? String(topic.circleReviewedAt).slice(0, 10) + ' 已复核' : '尚未完成城市供给复核',
        scheduleValue: (topic.startDate && topic.endDate)
          ? (this.formatShortDate(topic.startDate) + ' - ' + this.formatShortDate(topic.endDate)) : '',
        started: !!topic.started,
        // 稿 468:1126 的「邀请其他商家」副文案要写「还缺 N 站 · 招商截止 X」
        recruitDeadlineText: topic.merchantSignUpEndDate
          ? ('招商截止 ' + this.formatShortDate(topic.merchantSignUpEndDate)) : '',
      },
      hostRecruit: {
        nodeTotal,
        nodeFilled,
        pendingCount: recruit.pendingCount || 0,
        // 进度条按站点数等分。length:0 天然就是空数组,不用再判一次
        segments: Array.from({ length: nodeTotal }, (v, i) => i < nodeFilled),
        openNodes: recruit.openNodes || [],
      },
      hostMerchants: (host.merchants || []).map(function (m) {
        return Object.assign({}, m, {
          initial: (m.name || '?').slice(0, 1),
          statusText: Number(m.auditStatus) === 1 ? '已中标'
            : (Number(m.status) === 2 ? '已驳回' : (Number(m.status) === 1 ? '已通过' : '待审核')),
        });
      }),
      hostPlayers: { paidCount: players.paidCount || 0 },
    });
  },

  retryLoad() {
    this.setData({ loadFailed: false });
    // 从哪条链路进来的就重走哪条:host 没有 regId,走 loadDetail 会直接失败
    if (this.data.role === 'host' || !this.data.regId) this.loadProjectHome();
    else this.loadDetail();
  },

  // 即将到店的场次(含俱乐部包团)。接口只返回本商家已中标主题的场次。
  loadUpcomingRuns() {
    const that = this;
    const topicId = this.data.topicId || (this.data.info && this.data.info.topicId);
    if (!topicId) {
      this._runs = [];
      this.setData({ stepText: '', prepHeadcount: '' });
      return;
    }
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/upcoming-runs',
      data: { topicId: topicId },
      method: 'POST',
      header: { 'content-type': 'application/json' },
      success(res) {
        const rows = (res.code == '200' && isRecordList(res.data)) ? res.data : [];
        const runs = that.buildRuns(rows);
        that._runs = runs;
        that.setData({ stepText: that.pickStepText(runs), prepHeadcount: that.pickHeadcount(runs) });
      },
      fail() {
        that._runs = [];
        that.setData({ stepText: '', prepHeadcount: '' });
      }
    });
  },

  /**
   * 本项目的合作。走 /api/project/home 而不是 /api/coop/list ——
   * 后者不下发对方名字和电话,可见范围还得前端自己过滤;聚合接口把
   * 「谁能看到谁的号码」判死在服务端(见 ProjectHomeReadServiceImpl §联系方式)。
   */
  loadCoop() {
    const that = this;
    const topicId = this.data.topicId || (this.data.info && this.data.info.topicId);
    if (!topicId) { this.setData({ coopState: 'idle' }); return; }
    this.setData({ coopState: 'loading' });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/project/home', method: 'POST',
      data: JSON.stringify({ topicId: topicId, scope: that.data.operationScope }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.code != '200' || !res.data) { that.setData({ coopState: 'error' }); return; }
        const d = res.data;
        const role = d.role === 'host' ? 'host' : 'join';
        const raw = (role === 'host' ? (d.host && d.host.clubs) : (d.join && d.join.clubs)) || [];
        if (!isRecordList(raw)) { that.setData({ coopState: 'error' }); return; }
        that.setData({
          coopState: 'ready',
          role: role,
          quickActions: that.buildQuickActions(role, d.host && d.host.ownerType, d.host && d.host.canEdit),
          'clubSheet.items': that.mapClubs(raw),
        });
      },
      fail() { that.setData({ coopState: 'error' }); }
    });
  },

  mapClubs(rows) {
    if (!isRecordList(rows)) return [];
    return rows.map(function (c) {
      return {
        clubId: c.clubId,
        name: c.name || '未命名俱乐部',
        initial: (c.name || '?').slice(0, 1),
        leaderName: c.leaderName || '',
        phone: c.phone || '',
        // 主办方那边还带邀约状态;承接方拿到的本来就只有已谈成的。
        // fail-closed:status 缺失时按「待确认」,不按「合作中」——
        // 把还没答应的人标成合作方,商家会照着去安排场次。
        accepted: c.status === 1,
        statusText: c.status === 1 ? '合作中' : '待对方确认',
        terms: c.terms || '',
      };
    });
  },

  /**
   * 关系入口按身份给,不是同一套。
   * ★ 承接方没有「商家」这一格 —— 同场其他商家对他不可见(2026-08-04 用户决策),
   *   给一个点开必然是空的按钮,比不给更糟。
   */
  buildQuickActions(role, ownerType, canEdit) {
    // 顺手记下编辑资格:「更多」抽屉里「票价与主题内容」那一行靠它决定是否置灰。
    // wxml 不渲染这个值,所以留在实例上,不进 setData(死数据字段门禁 A2)。
    this._hostCanEdit = canEdit !== false;
    const CLUB = { key: 'club', label: '俱乐部', icon: '/pages/topic/images/icon_qa_club.svg' };
    const MERCHANT = { key: 'merchant', label: '商家', icon: '/pages/topic/images/icon_qa_store.svg' };
    const CUSTOMER = { key: 'customer', label: '客户', icon: '/pages/topic/images/icon_qa_person.svg' };
    // 「编辑」在 2026-09-05 改名「更多」:它打开的抽屉里除了编辑还有本站运营与章节控制,
    // 叫「编辑」名不副实,而且承接方过审后编辑项会置灰,整颗按钮却不该跟着消失。
    const MORE = { key: 'more', label: '更多', icon: '/pages/topic/images/icon_qa_edit.svg' };
    /* 稿 88:4014/4170/4368/3776/4583 五张承接页的快捷格第一格都是「扫码」,
       G1=A 裁决原文也写着「承接方『俱乐部·客户·编辑』**+ 扫码**」—— 这一格一直没落地。
       它跳的是商家中心首页那套核销扫码(R2/G3:核销不在承接页复制第二份),
       与底部「去核销」同一个落点,只是随时可点,不必等到进行中态。 */
    const SCAN = { key: 'scan', label: '扫码', icon: '/pages/topic/images/icon_qa_scan.svg' };
    // 俱乐部主办的主题没有「俱乐部」格:俱乐部不邀俱乐部(2026-08-07 用户拍板)
    if (role === 'host') {
      const base = ownerType === 'club' ? [MERCHANT, CUSTOMER] : [CLUB, MERCHANT, CUSTOMER];
      // 主办方的「编辑」改的是主题本身(票价/内容/权益票夹),资格闸是 /api/project/home 的
      // host.canEdit。没资格就不给入口——host 那侧后端不下发 editReason(只有 join 有),
      // 前端解释不出"为什么不能改",给个点了只会撞 403 的按钮不如不给。
      // ⚠️ canEdit === false 只让抽屉里的「票价与主题内容」置灰,不再吞掉整颗按钮 ——
      //    章节控制与本站运营跟编辑资格无关,吞了按钮等于把那些动作一起藏没了。
      return base.concat([MORE]);
    }
    /* CU-M-92「只接了合作邀约、还没有点位」的商家:四格里只有两格真能用。
       「客户」走 /api/project/players,那道闸认的是发布者或有报名行的人,他没有报名行 ⇒ 点了必被拒;
       「更多」抽屉里每一行的动作都挂在自己的报名行上 ⇒ 同样必被拒。给两颗只会报错的按钮不如不给。
       「扫码」是给的:他的核销资格不来自报名行,来自那张合作单(后端 [D22])。 */
    if (role === 'coopPartner') return [SCAN, CLUB];
    // 承接方:编辑那一项的闸是 canEditRegistration(),但「更多」本身任何状态都能开。
    return [SCAN, CLUB, CUSTOMER, MORE];
  },

  /**
   * 俱乐部抽屉。空态也照常打开 —— 抽屉里那句引导和黑按钮就是空态的下一步,
   * 直接跳走反而让人不知道自己点了什么。
   */
  openClubSheet() {
    this.setData({
      'clubSheet.show': true,
      clubActions: this.data.role === 'host'
        ? [{ key: 'goInviteClub', label: '去找俱乐部' }, { key: 'goReceivedApplies', label: '查看收到的申请', ghost: true }]
        : [{ key: 'goInviteClub', label: this.data.clubSheet.items.length ? '再找一家俱乐部带团' : '去找俱乐部' }],
    });
  },

  closeClubSheet() {
    this.setData({ 'clubSheet.show': false });
  },

  closeMerchantSheet() {
    this.setData({ 'merchantSheet.show': false });
  },

  closePlayerSheet() {
    this.setData({ 'playerSheet.show': false });
  },

  /** 玩家名单。数据现拉 —— 到没到店是开店当下才有意义的信息,缓存了就是错的。 */
  openPlayerSheet() {
    const that = this;
    const topicId = this.data.topicId || (this.data.info && this.data.info.topicId);
    if (!topicId) return;
    this.setData({
      'playerSheet.show': true,
      // CU-C-67:每次打开都清掉上一次的失败态 —— 错态与零单是两个态,不能互相残留
      'playerSheet.errorText': '',
      playerActions: this.data.role === 'host'
        // CU-M-183:商家那本台账不按主题过滤,按钮就得先说清是「全店」——
        // 点进去才发现混着别的项目,主办方会以为名单和台账口径不一致。
        ? [{ key: 'goLedger', label: '查看全店台账' }]
        : [],
    });
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/project/players', method: 'POST',
      data: JSON.stringify({ topicId: topicId, scope: that.data.operationScope }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.code != '200' || !res.data || typeof res.data !== 'object'
            || Array.isArray(res.data) || !isRecordList(res.data.rows)) {
          // CU-C-67:读失败是「名单没拿到」,不是「一单没卖」—— 原来两件事共用同一句话,
          // 俱乐部主理人看到「名单没加载出来」而顶部还摆着三个 0,分不出是哪一种。
          that.showPlayerSheetError(app.getRequestErrorMessage(res, '名单没加载出来'));
          return;
        }
        that.setData(that.buildPlayerSheet(res.data, that.data.playerSheet.filter));
      },
      fail(res) {
        that.showPlayerSheetError(app.getRequestErrorMessage(res, '网络异常，客户名单没读到'));
      }
    });
  },

  /* CU-C-67:名单读失败就要说读失败 —— 分开存、分开渲染(零单的话在 buildPlayerSheet 里)。 */
  showPlayerSheetError(text) {
    this.setData({
      'playerSheet.errorText': String(text || '名单没加载出来'),
      'playerSheet.raw': {},
      'playerSheet.rows': [],
      'playerSheet.groups': [],
      'playerSheet.summary': {},
      'playerSheet.visibleCount': 0,
      'playerSheet.redeemedCount': 0,
      'playerSheet.emptyText': '',
    });
  },

  retryPlayerSheet() {
    if (!this.data.playerSheet.show) return;
    this.openPlayerSheet();
  },

  onPlayerFilter(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.playerSheet.filter) return;
    this.setData(this.buildPlayerSheet(this.data.playerSheet.raw, key));
  },

  /**
   * 名单整形:按场次分组。空态三种说法分开 ——
   * 「一单没卖」「都到齐了」「还没人到店」的下一步完全不同,合成一句等于什么都没说。
   */
  buildPlayerSheet(data, filter) {
    const d = data || {};
    const sourceRows = isRecordList(d.rows) ? d.rows : [];
    const shopDay = d.viewType === 'SHOP_DAY_MERCHANT_ROSTER'
      || sourceRows.some(function (r) { return !!r.entitlementStatus; });
    const rows = sourceRows.map(function (r) {
      const state = shopDay
        ? (r.serviceStartedAt ? 'redeemed' : 'arrived')
        : (r.state || (r.arrived ? 'arrived' : 'pending'));
      return Object.assign({}, r, {
        state: state,
        stateText: state === 'redeemed' ? '已核销'
          : (state === 'refunded' ? '已退款'
            : (state === 'arrived' ? '已核销'
              : (state === 'contacted' ? '已接洽' : '待核销'))),
        arrivedTimeText: (r.checkinAt || r.arrivedTime) ? String(r.checkinAt || r.arrivedTime).slice(11, 16) : '',
        initial: (r.name || '?').slice(0, 1),
      });
    });
    // 按 state 过滤:退款的人既不算「已到店」也不算「未到店」——
    // 他不来了,把他混进待核销里会让商家一直等一个不会出现的人。
    const kept = rows.filter(function (r) {
      const state = r.state || (r.arrived ? 'arrived' : 'pending');
      if (filter === 'arrived') return state === 'arrived' || state === 'redeemed';
      // 已接洽单独一档:它既不是「还没来」也不是「已经核销完」
      if (filter === 'contacted') return state === 'contacted';
      if (filter === 'pending') return state === 'pending';
      return true;
    });
    // 场次:后端按报名给的是 participateDate,没有就归到「未指定场次」
    const order = [];
    const byRun = {};
    kept.forEach(function (r) {
      const key = r.sessionLabel || r.participateDate || '__none__';
      if (!byRun[key]) { byRun[key] = []; order.push(key); }
      byRun[key].push(r);
    });
    const groups = order.map(function (key) {
      return {
        key: key,
        when: key === '__none__' ? '未指定场次' : key,
        sourceText: byRun[key].length + ' 人',
        rows: byRun[key],
      };
    });
    // CU-C-125:空态判据是**筛完之后**的 kept,不是未筛的 rows —— 拿 rows 判,一单没卖时
    // 四个 Tab 会说同一句「还没有人下单」,而选中「待核销」时真正要回答的是这一档有没有记录。
    // 「全部客户都已核销」这类说法也一起换掉:已接洽的人既不在待核销也不在已核销,
    // 那句在有人扫码待确认时是假的。
    let emptyText = '';
    if (!kept.length) {
      emptyText = !rows.length
        ? (filter === 'all' ? '还没有人下单。路线上架后，报名记录会出现在这里' : '还没有人下单，这一档也是空的')
        : (filter === 'pending' ? '没有待核销的客户'
          : (filter === 'contacted' ? '还没有客户接洽'
            : (filter === 'arrived' ? '没有已核销的客户' : '没有符合条件的客户')));
    }
    return {
      'playerSheet.raw': d,
      'playerSheet.filter': filter,
      'playerSheet.rows': rows,
      'playerSheet.groups': groups,
      'playerSheet.summary': d.summary || {},
      'playerSheet.shopDay': shopDay,
      'playerSheet.visibleCount': rows.length,
      'playerSheet.redeemedCount': rows.filter(function (r) { return r.state === 'redeemed'; }).length,
      'playerSheet.contactHint': d.contactHint || '',
      'playerSheet.emptyText': emptyText,
    };
  },

  /** 电话、核销答案都走这一个 —— 复制就是复制,没必要按内容各写一份。 */
  copyText(e) {
    const text = e.currentTarget.dataset.text;
    if (!text) return;
    wx.setClipboardData({ data: String(text) });
  },

  /**
   * 找俱乐部带团:先进合作页的俱乐部发现 tab,点开谁的主页再决定发不发 ——
   * 与商家那支同一条动线(2026-08-10),不再一步跳进条款表单。主题一路带过去。
   */
  goInviteClub() {
    const topicId = this.data.topicId || (this.data.info && this.data.info.topicId) || '';
    // CU-C-64:主题名在 /api/topic/info-to-user 里是 info.name(TopicInfoVO 没有 topicName),
    // 原来读 info.topicName 恒为空 —— 名字一路丢到邀请表单,最后只剩裸主题编号。
    const name = (this.data.info && this.data.info.name) || '';
    wx.navigateTo({
      url: '/pages/merchant/relation/index?tab=club&topicId=' + topicId
        + '&topicName=' + encodeURIComponent(name)
        + (this.data.operationScope === 'MERCHANT' ? '&scope=MERCHANT' : ''),
    });
  },

  /* CU-M-181:抽屉底部那颗主按钮得是「现在真做得动」的事。
     站点数为 0 时附近商家挑回来也没有站点可承接,招商发不出去 —— 而同一抽屉的空态
     正写着「先去编辑里加站点再招商」。所以没站点时把主按钮换成加站点的真入口,
     连编辑资格都没有时干脆不给主按钮,只留「查看收到的申请」。
     2026-08-10:自由探索的「邀请商家承接章节」并进了同一份商家名单
     (coop/nearby 按距离排,章节作副标题),不再另开一个入口。 */
  buildMerchantActions() {
    const review = { key: 'goReceivedApplies', label: '查看收到的申请', ghost: true };
    // 自由探索按章节招商，商家承接后才产生站点，不能拿当前节点数挡住入口。
    if (this._isFreeExploreHost || ((this.data.hostRecruit || {}).nodeTotal || 0) > 0) {
      return [{ key: 'goInviteMerchant', label: '去找商家' }, review];
    }
    if (this._hostCanEdit === false) return [review];
    return [{ key: 'goAddStations', label: '去加站点' }, review];
  },

  /** CU-M-181:「去加站点」= 主题编辑器,与「更多 → 票价与主题内容」同一个落点。 */
  goAddStations() {
    const id = this.data.topicId || (this.data.info && this.data.info.topicId);
    if (!id) { app.tips('这条路线还没读到，稍后再试'); return; }
    wx.navigateTo({
      url: '/pages/publish/fabu/index?id=' + id
        + (this.data.operationScope === 'MERCHANT' ? '&scope=MERCHANT' : ''),
      fail: () => app.tips('编辑器暂时打不开，稍后重试'),
    });
  },

  /** 邀其他商家承接节点:先去附近商家里挑人,topicId 一路带过去。 */
  goInviteMerchant() {
    const topicId = this.data.topicId || (this.data.info && this.data.info.topicId) || '';
    // CU-C-64:同上,读 name 不读不存在的 topicName
    const name = (this.data.info && this.data.info.name) || '';
    wx.navigateTo({
      url: '/pages/coop/nearby/index?topicId=' + topicId + '&topicName=' + encodeURIComponent(name)
        + (this.data.operationScope === 'MERCHANT' ? '&scope=MERCHANT' : ''),
    });
  },

  /** 收到的申请:候选池页已下线,报名候选/俱乐部申请统一在协作列表「收到的」处理。
      CU-C-75:入口按**本主题**计数,就必须把本主题带过去 —— 否则落点是全局列表,
      管理员判断不了这条主题到底有没有申请。 */
  goReceivedApplies() {
    const topicId = this.data.topicId || '';
    wx.navigateTo({ url: '/pages/coop/list/index?tab=received'
      + (this.data.operationScope === 'MERCHANT' ? '&scope=MERCHANT' : '')
      + (topicId ? '&topicId=' + topicId + '&topicName='
        + encodeURIComponent((this.data.info && this.data.info.name) || '') : '') });
  },

  reviewCircleSupplies() {
    const topicId = Number(this.data.topicId);
    if (!topicId || this._circleReviewing) return;
    this._circleReviewing = true;
    const that = this;
    app.sendRequest({
      hideLoading: false,
      url: '/api/circle-theme/instance/review',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ topicId, scope: that.data.operationScope }),
      success(res) {
        if (res.code != '200') {
          app.tips(app.getRequestErrorMessage(res, '供给复核失败'));
          return;
        }
        cyToast.success('供给复核已更新');
        that.loadProjectHome();
      },
      complete() { that._circleReviewing = false; },
    });
  },

  /** 主办方的钱统一进「我的资产」，由收益宿主打开分润场景。 */
  goFinance() {
    const id = this.data.topicId || (this.data.info && this.data.info.topicId);
    wx.navigateTo({
      url: '/subpackageA/pages/assetcenter/earnings/index?scene=merchant-profit' + (id ? '&topicId=' + id : ''),
    });
  },


  // 后端 picUrl/imgArr 是分号或逗号分隔的多图串,取第一张
  firstImg(value) {
    if (!value) return '';
    return String(value).split(/[;,]/)[0].trim();
  },

  onHeroError() {
    this.setData({ heroFailed: true });
  },

  buildRuns(rows) {
    const that = this;
    return rows.map(function (row) {
      // 「预计到我这」是估算区间,后端事实不齐时不给区间 —— 这里同样不许自己补一个
      const hasWindow = !!(row.arrivalStart && row.arrivalEnd);
      return {
        ticketId: row.ticketId,
        dateText: that.formatRunDate(row.startTime),
        timeText: that.formatClock(row.startTime),
        clubName: row.clubName || '',
        sourceText: row.clubName ? row.clubName : '自由报名场',
        paidCount: row.paidCount || 0,
        teamText: that.teamStatusText(row.teamStatus),
        stepText: (row.nodeOrder && row.nodeTotal) ? ('第 ' + row.nodeOrder + '/' + row.nodeTotal + ' 站') : '',
        // 一行说完「多少人 · 成不成团」,避免模板里拼三段 text 造出连缀的分隔点
        metaText: [
          (row.paidCount || 0) + ' 人',
          that.teamStatusText(row.teamStatus),
        ].filter(Boolean).join(' · '),
        arrivalText: hasWindow
          ? ('预计 ' + that.formatClock(row.arrivalStart) + '-' + that.formatClock(row.arrivalEnd) + ' 到店')
          : '',
      };
    });
  },

  /* 「开场前核一遍名单」那句的后半截:最近一场的人数与成团态。
     ⚠️ 取最近一场,不求和 —— 商家今晚要接待的是这一场,把三场加起来反而误导。
        一场都没有(或者接口没取到)就返回空串,那句话只留前半句。 */
  pickHeadcount(runs) {
    const first = (runs || [])[0];
    return (first && first.metaText) || '';
  },

  // 「我是第几站」对本商家是恒定事实,从任一场次取到即可,提到 chips 行上说一次
  pickStepText(runs) {
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].stepText) return runs[i].stepText;
    }
    return '';
  },

  teamStatusText(teamStatus) {
    if (teamStatus === 1) return '已成团';
    if (teamStatus === 2) return '未成团已散';
    if (teamStatus === 0) return '募集中';
    return '';
  },

  formatRunDate(dateVal) {
    if (!dateVal) return '';
    const d = new Date(String(dateVal).replace(/-/g, '/'));
    if (isNaN(d.getTime())) return String(dateVal).slice(0, 10);
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${d.getMonth() + 1}.${d.getDate()} ${days[d.getDay()]}`;
  },

  formatClock(dateVal) {
    if (!dateVal) return '';
    const d = new Date(String(dateVal).replace(/-/g, '/'));
    if (isNaN(d.getTime())) return '';
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  processData(data) {
    const mode = data.mode || 1;
    const modeText = mode === 1 ? '城市定向' : '自由探索';

    // 承接标的:章节与节点是两件不同的事实。原来写成 chapterName || nodeName 是二选一,
    // 有章节时商家反而看不到自己承接的是哪个点位 —— 而后端两个名字都下发了。
    const chapterName = data.chapterName || '';
    const nodeName = data.nodeName || '';
    // 稿 88:4014 的段标题是「承接的章节」(卡内 eyebrow 才是「当前承接章节」)
    const assignedLabel = chapterName ? '承接的章节' : '承接的节点';
    const assignedValue = chapterName || nodeName || '';
    // 两个都有时,节点作为章节下的一行补充;只有节点时它已经占了主行,不重复
    const assignedNodeText = chapterName && nodeName ? nodeName : '';

    let scheduleValue = '';
    if (data.topicStartDate && data.topicEndDate) {
      scheduleValue = this.formatDayMonth(data.topicStartDate) + ' – ' + this.formatDayMonth(data.topicEndDate);
    } else if (data.startDate && data.endDate) {
      scheduleValue = this.formatDayMonth(data.startDate) + ' – ' + this.formatDayMonth(data.endDate);
    }

    const total = data.totalOrderNum || 0;
    const verified = data.verifiedNum || 0;

    const state = this.deriveState(data);
    const primary = this.derivePrimaryAction(state.key, data);

    const play = this.buildPlay(data.templateDetail);
    // 玩法在驳回态仍要看(重新申请时有参考),但「玩家能拿到」是给他现场讲的话术素材,
    // 这活都没接上就没有意义,不显示。
    // 稿 88:4170(M2 未通过)里「玩家可获得」照常在:被驳回的商家正要照着它改内容重报,
    // 这时候把奖励藏起来,他连这一站原本要给玩家什么都看不到了。
    const reward = this.buildReward(data.templateDetail);
    const perkText = this.buildPerkText(data);
    // sharingAmount 是已累计的分润金额(报名阶段后端不许预写,见 CmsRegistrationMerchantController),
    // 所以只能说「已分润」,不能拿它当预估收入 —— 单价这个接口不下发,编不出来。
    const sharingRateText = data.sharingRate ? (data.sharingRate + '%') : '';
    const sharedAmountText = Number(data.sharingAmount) > 0 ? ('¥' + data.sharingAmount) : '';
    const sharingText = [
      sharingRateText ? ('分润比例 ' + sharingRateText) : '',
      sharedAmountText ? ('已分润 ' + sharedAmountText) : '',
    ].filter(Boolean).join(' · ');
    const templateReady = !!data.templateId;

    this.setData({
      info: data,
      heroImg: this.firstImg(data.topicImgUrl) || this.firstImg(data.topicImgArr) || this.firstImg(data.picUrl),
      heroFailed: false,
      badgeImg: this.firstImg(data.picUrl) || this.firstImg(data.nodeImgUrl),
      modeText,
      assignedLabel,
      assignedValue,
      assignedNodeText,
      scheduleValue,
      templateText: data.templateName || '',
      templateSubText: data.templateName || '未配置玩法模板',
      templateReady,
      perkText,
      sharingText,
      sharingRateText,
      sharedAmountText,
      // 章节卡的封面:优先章节图,退到我这站的现场图,再退到路线封面
      chapterImg: this.firstImg(data.chapterImgUrl) || this.firstImg(data.nodeImgUrl) || this.firstImg(data.picUrl),
      // 玩法是不是我自己创作的 —— 后端下发,前端不猜
      isSelfTemplate: !!(data.templateDetail && data.templateDetail.memberId
        && String(data.templateDetail.memberId) === String(data.memberId)),
      // 「查看结算报告」已经是已结束态的底部主按钮(稿 88:4583),履约卡里不再放第二颗:
      // 两颗同名按钮同屏,商家会以为它们通向不同的东西。
      fulfillActionText: '',
      // 章节卡里的动作:已确认承接、还没开场时的「开始接待」。
      // 它不能顶掉底部按钮 —— 底部那个是退出口径(已中标只能联系客服申请退出),
      // 两件事挤到一个按钮上,商家就没有退出的入口了。
      chapterActionText: state.key === 'confirmed' ? '开始接待' : '',
      // 审核中没有任何可点的动作,底部按钮只是状态说明
      primaryDisabled: state.key === 'pending',
      factTailText: [perkText, sharingText].filter(Boolean).join(' · '),
      totalCount: total,
      verifiedCount: verified,
      pendingCount: Math.max(0, total - verified),
      stateKey: state.key,
      stateText: state.text,
      stateClass: state.cls,
      stateSub: state.sub,
      // 核销三格从「开始接待」那天起才有意义。稿 88:4368(M3 已确认未开始)上没有这一块 ——
      // 还没开场,三个数字必然是 0/0/N,摆在首屏只会让人以为自己漏了什么没核销。
      showFulfillment: state.key === 'running' || state.key === 'ended',
      // 进度不跟着 showFulfillment 藏:审核中和被驳回时,这一块正是唯一能说清「我在哪一步」的地方
      progress: this.buildProgress(data, state, verified),
      // 稿 88:4014(M1 审核中)上没有「开场前要准备」:这一步能不能开场还没定,
      // 先催他备料是把没落地的事当成已落地。从「已确认」起才出。
      showPrep: state.key === 'confirmed' || state.key === 'running',
      showCheckinQr: (state.key === 'confirmed' || state.key === 'running')
        && Number.isSafeInteger(Number(data.nodeId)) && Number(data.nodeId) > 0,
      play,
      reward,
      // 「所需材料」也是准备的一部分,和待办同一块显示
      prepText: (data.templateDetail && data.templateDetail.requiredMaterials) || '',
      todos: this.buildTodos(data),
      primaryAction: primary.action,
      primaryText: primary.text,
    });
  },

  /**
   * 进度:从报名到结束的一条状态线。四行固定 —— 报名已提交 / 审核 / 开始接待 / 结束。
   * 为什么不放场次:玩家到店时间常不准,把「19:20—19:40 到店」摆在这里,商家会照着排班,
   * 结果人没来或提前来都算失约。商家真正要的是「我在哪一步、什么时候开始、什么时候结束」。
   */
  buildProgress(data, state, verified) {
    /* 稿 88:4368 的开始/结束行带星期与钟点(「8.6 周三 19:30」),提交/审核行只带钟点(「8.1 10:20」) */
    const fmt = (d) => this.formatStamp(d, true) || '';
    // 提交时间 = 报名记录的 create_time,接口一直在下发(ViewRegistrationMerchantMapper 选了这一列)。
    // 审核时间 = audit_time(2026-09-10 补的列,只由中标/驳回那两条 CAS 语句写)。
    // ⚠️ 仍然不拿 update_time 顶替:那一列任何一次改动都会动,不是审核发生的时刻。
    //    存量报名没有这个时刻(不回填),那一行照旧不写时间。
    const rows = [{ key: 'submitted', label: '报名已提交', st: 'done',
      time: this.formatStamp(data.createTime) }];
    if (state.key === 'rejected') {
      rows.push({ key: 'audit', label: '审核未通过', st: 'bad', tag: '未通过',
        time: this.formatStamp(data.auditTime),
        sub: data.reason || '未填写驳回原因' });
      rows.push({ key: 'start', label: '开始接待', time: '—', st: 'wait',
        sub: '改完重新提交后才会排期' });
      return rows;
    }
    if (state.key === 'pending') {
      rows.push({ key: 'audit', label: '主办方审核中', st: 'now', tag: '进行中',
        sub: '一般 1–2 个工作日出结果' });
      rows.push({ key: 'start', label: '开始接待', time: '待定', st: 'wait', sub: '通过后才会排期' });
      rows.push({ key: 'end', label: '结束', time: '待定', st: 'wait' });
      return rows;
    }
    rows.push({ key: 'audit', label: '审核通过', st: 'done', tag: '已通过',
      time: this.formatStamp(data.auditTime) });
    const startTxt = fmt(data.topicStartDate) || '待定';
    const endTxt = fmt(data.topicEndDate) || '待定';
    /* 「还有 N 天」:稿 88:4368 的「开始接待」行与 88:3776 的「结束」行都带这一句。
       state.sub 在 confirmed 档算的就是它,直接复用,不再算第二遍(两处会算出不同的数)。
       ⚠️ 稿上「已接待 2 场 · 核销 11 人」里的「场次数」没有对应字段(履约不按场记),
          只写核销数,不编场次。 */
    if (state.key === 'confirmed') {
      rows.push({ key: 'start', label: '开始接待', time: startTxt, st: 'wait', tag: '未开始',
        sub: state.sub || '' });
      rows.push({ key: 'end', label: '结束', time: endTxt, st: 'wait' });
    } else if (state.key === 'running') {
      rows.push({ key: 'start', label: '开始接待', time: startTxt, st: 'now', tag: '进行中',
        sub: verified > 0 ? ('已核销 ' + verified + ' 人') : '' });
      rows.push({ key: 'end', label: '结束', time: endTxt, st: 'wait', sub: this.daysLeftToEnd(data) });
    } else {
      rows.push({ key: 'start', label: '开始接待', time: startTxt, st: 'done' });
      rows.push({ key: 'end', label: '结束', time: endTxt, st: 'done', tag: '已结束',
        sub: verified > 0 ? ('共核销 ' + verified + ' 人') : '' });
      /* 稿 88:4583 在「结束」之后还有一行「结算」。结算日期没有对应字段(稿上那个 8.18
         是示意),所以只给状态不给日期 —— 宁可少一列,不编一个日子出来让商家等。
         isSettlement 拿不到时整行不出:说不清结没结算,不如不说。 */
      if (data.isSettlement != null) {
        const settled = Number(data.isSettlement) === 1;
        rows.push({ key: 'settle', label: '结算', st: settled ? 'done' : 'wait',
          tag: settled ? '已结算' : '待结算', sub: settled ? '结算报告已生成' : '' });
      }
    }
    return rows;
  },

  /** 「还有 N 天」——距结束。算不出就不写(稿 88:3776 的「结束」行带这一句)。 */
  daysLeftToEnd(data) {
    const end = this.atMidnight(data.topicEndDate);
    if (!end) return '';
    const today = new Date(chinaDayStart(Date.now()));
    const days = Math.ceil((end.getTime() - today.getTime()) / 86400000);
    return days > 0 ? ('还有 ' + days + ' 天') : '';
  },

  /**
   * 承接状态机。真实调配驳回是 status=3 + auditStatus=2；兼容历史 status=2。
   * 通过后再按日期分未开始/进行中/已结束。
   * 商家最想知道的第一件事就是这个,原来整页一个字都没有。
   */
  deriveState(data) {
    const status = Number(data.status);
    const auditStatus = data.auditStatus == null ? 0 : Number(data.auditStatus);
    if (status === 2 || (status === 3 && auditStatus === 2)) {
      return { key: 'rejected', cls: 'state-danger', text: '未通过', sub: data.reason || '未填写驳回原因' };
    }
    if (status !== 1) {
      return { key: 'pending', cls: 'state-neutral', text: '审核中', sub: '主题发布者确认后即可开始准备' };
    }

    const today = new Date(chinaDayStart(Date.now()));
    const start = this.atMidnight(data.topicStartDate);
    const end = this.atMidnight(data.topicEndDate);

    if (end && today > end) {
      return { key: 'ended', cls: 'state-neutral', text: '已结束', sub: scheduleSub(data, this) };
    }
    if (start && today >= start) {
      return { key: 'running', cls: 'state-running', text: '进行中', sub: '玩家可到店核销' };
    }
    if (start) {
      const days = Math.ceil((start.getTime() - today.getTime()) / 86400000);
      // 稿 88:4368 的胶囊写的是「已确认 · 未开始」—— 光说「已确认承接」漏了后半句,
      // 商家会以为已经开张了。两段一起说,他才知道现在该做的是准备不是接待。
      return { key: 'confirmed', cls: 'state-ok', text: '已确认 · 未开始', sub: '还有 ' + days + ' 天' };
    }
    return { key: 'confirmed', cls: 'state-ok', text: '已确认 · 未开始', sub: '开始时间待定' };

    function scheduleSub(d, page) {
      // 与上面的 scheduleValue 同一个写法,两边不一致会让 wxml 里那条「stateSub !== scheduleValue」
      // 的去重条件失效,已结束态就会把同一行档期显示两遍
      return d.topicStartDate && d.topicEndDate
        ? page.formatDayMonth(d.topicStartDate) + ' – ' + page.formatDayMonth(d.topicEndDate)
        : '';
    }
  },

  /**
   * 底部主动作。
   *
   * ★ 退出闸以后端为准:cancelByMerchant 只拦 auditStatus==1(已中标),不是前端原来自己算的
   * 「距开始≥3天」。口径不一致 = 中标商家点下去必报错,而「撤销中标流程」全仓还没实现,
   * 所以中标态只能引导联系客服,不假装能退。
   */
  derivePrimaryAction(stateKey, data) {
    // 审核中没有任何能推进的动作,按钮只是把状态再说一遍(禁用态)——
    // 给它一个「取消参与」会让人以为这是这一步该做的事。
    if (stateKey === 'pending') return { action: 'none', text: '等待审核中' };
    // 驳回后可以直接改内容重新提交(后端 /registration/merchant/update 已放开这一档),
    // 不必取消重报把记录丢掉。
    if (stateKey === 'rejected') return { action: 'edit', text: '修改并重新提交' };
    // 稿 88:4583(M5 已结束)的底部主按钮是「查看结算报告」。已结束这一步商家真正要做的
    // 就是对账,把主按钮让给客服等于把唯一的正事降级成次要入口(客服仍在「更多」里)。
    if (stateKey === 'ended') return { action: 'settlement', text: '查看结算报告' };
    if (stateKey === 'running') return { action: 'verify', text: '去核销' };
    if (Number(data.auditStatus) === 1) return { action: 'service', text: '联系客服申请退出' };
    return { action: 'cancel', text: '取消参与' };
  },

  /**
   * 「这一站玩什么」——原来整页只有一行模板名,商家不知道玩家到店会跟他做什么。
   * 字段一律取后端有什么显示什么,拿不到就不显示,不编。
   *
   * 答案口径(2026-08-06 用户拍板「商家可见」):中标商家现场就是靠对暗号核销的,
   * 看不到答案这活干不了。可见性由**后端**决定 —— `MerchantRegistrationDetailReadServiceImpl`
   * 只在 auditStatus==1 时走 `TemplateSecrets.merchantView` 放行,其余一律 strip 成 null。
   * 所以这里「有就显示、没有就不显示」天然 fail-closed,前端不许自己判身份、更不许兜底凑。
   */
  buildPlay(tpl) {
    if (!tpl) return null;
    const VERIFY_TEXT = { 1: '玩家答文字题,你对暗号', 2: '玩家拍照打卡,你确认', 3: '玩家选选项,你确认' };
    const chips = [];
    if (tpl.players) chips.push(tpl.players);
    if (tpl.duration) chips.push(tpl.duration + ' 分钟');
    if (tpl.difficulty) chips.push('难度 ' + tpl.difficulty);
    const play = {
      img: this.firstImg(tpl.imgUrl),
      name: tpl.title || '',
      chips,
      // 核销方式是商家现场要做的动作,一行,留在卡上;
      // 玩法说明/剧情/规则/拍照要求都是「点进去看」的内容,不在这页铺开。
      verifyText: VERIFY_TEXT[tpl.validationMethod] || '',
      questionText: tpl.questionName || '',
      answerText: this.buildAnswerText(tpl),
    };
    const hasAny = play.img || play.name || chips.length || play.verifyText;
    return hasAny ? play : null;
  },

  /**
   * 现场核销要对的那个答案。图片验证没有标准答案(靠商家看照片判),所以不出这一行。
   * 选项验证下发的是 A/B/C/D,单看字母商家对不上题,补一句选项原文。
   */
  buildAnswerText(tpl) {
    if (tpl.validationMethod === 1) return tpl.questionAnswer || '';
    if (tpl.validationMethod === 3) {
      const key = tpl.correctAnswer || '';
      if (!key) return '';
      const option = tpl['question' + key.toUpperCase()] || '';
      return option ? key + '. ' + option : key;
    }
    return '';
  },

  /** 「玩家能拿到」——商家的话术素材:勋章 + 探索值。券走 perkText,不在这里重复。 */
  buildReward(tpl) {
    if (!tpl) return null;
    const medalName = tpl.medalName || '';
    const medalImg = tpl.medalImg || '';
    const xp = tpl.xpValue || 0;
    if (!medalName && !medalImg && !xp) return null;
    return { medalName, medalImg, xp };
  },

  buildPerkText(data) {
    if (data.couponId) return '到店券已配置';
    if (data.validationMethod === 3) return '选项验证已配置';
    if (data.validationMethod === 2) return '图片验证已配置';
    if (data.validationMethod === 1) return '文字验证已配置';
    return '';
  },

  // 「你还差什么」——原来页面不说,商家只能靠那句兜底鸡汤猜
  buildTodos(data) {
    // 三项固定清单,配好的打勾、没配的标红 —— 只列「缺什么」的话勾选框永远是空的,
    // 商家也看不出自己一共要配几样。done 一律按现码字段判,不造已完成项。
    return [
      { key: 'template', done: !!(data.templateName || data.templateId),
        text: (data.templateName || data.templateId) ? '玩法模板已配置' : '还没选玩法模板' },
      { key: 'perk', done: !!(data.validationMethod || data.couponId),
        text: (data.validationMethod || data.couponId) ? '到店权益/验证方式已配置' : '还没配到店权益或验证方式' },
      { key: 'image', done: !!(data.picUrl || data.nodeImgUrl),
        text: (data.picUrl || data.nodeImgUrl) ? '现场图片已上传' : '还没上传现场图片' },
    ];
  },

  atMidnight(dateVal) {
    if (!dateVal) return null;
    const ts = chinaDayStart(dateVal);
    return isNaN(ts) ? null : new Date(ts);
  },

  toggleRules() {
    this.setData({ rulesOpen: !this.data.rulesOpen });
  },

  /**
   * 承接视图组件的唯一出口:它只说「用户点了什么」,做什么仍由页面决定。
   * 白名单派发 —— 不写成 this[act]() 直接调,否则组件里写错一个 act 名
   * 就能调到页面上任意方法。
   */
  onJoinAct(e) {
    const detail = e.detail || {};
    const HANDLERS = {
      goTopicDetail: 1, goTemplateDetail: 1, goLedger: 1, goVerify: 1,
      showLiveCheckin: 1, downloadCheckinQr: 1,
      onPrimaryTap: 1, onQuickAction: 1, retryLoad: 1, toggleRules: 1, onHeroError: 1,
      closeClubSheet: 1, closePlayerSheet: 1, closeMerchantSheet: 1,
      closeMoreSheet: 1, onMorePick: 1,
      copyText: 1, goInviteClub: 1, onPlayerFilter: 1,
      // CU-C-67:客户名单读失败后的局部重试(错态与零单分开之后要有恢复动作)
      retryPlayerSheet: 1,
      // CU-C-68:抽屉里「本站运营」资格探不到时的就地重试
      probeStationOperable: 1,
      goReceivedApplies: 1, goFinance: 1, goInviteMerchant: 1,
      // CU-M-181:无站点时抽屉主按钮换成「去加站点」,走的仍是这条白名单派发
      goAddStations: 1,
      reviewCircleSupplies: 1,
      auditChapterApplication: 1, auditMerchantNode: 1, retryChapterReviews: 1,
      switchStation: 1,
      // 打开章节 / 打开节点(Figma 439:6336 / 336:461)
      openChapterSheet: 1, closeChapterSheet: 1, toggleChapterStory: 1,
      openNodeSheet: 1, closeNodeSheet: 1, openNodeTemplate: 1,
    };
    if (!HANDLERS[detail.act]) return;
    this[detail.act]({ currentTarget: { dataset: detail.dataset || {} } });
  },

  onPrimaryTap() {
    const action = this.data.primaryAction;
    if (action === 'none') return;
    if (action === 'cancel') return this.cancelRegistration();
    if (action === 'verify') return this.goVerify();
    if (action === 'edit') return this.goEditRegistration();
    if (action === 'settlement') return this.goSettlementReport();
    if (action === 'back') return wx.navigateBack({ delta: 1 });
    return this.contactService();
  },

  /**
   * 四个关系入口。合作/关系页都已存在,这里只负责把本项目的 topicId 带过去 ——
   * 商家站在具体项目里想找人,不该再从头选一遍是哪条路线。
   */
  onQuickAction(e) {
    const key = e.currentTarget.dataset.key;
    /* 扫码(稿 88:4014 第一格 · G1=A):走 goVerify —— 核销整套在商家中心首页,
       这里只做交接,不在承接页复制第二份(R2 判定,G3 已确认撤销「就地展开」那条)。
       与底部「去核销」同一个落点,区别只是这一格任何状态都能点。 */
    if (key === 'scan') return this.goVerify();
    if (key === 'club') return this.openClubSheet();
    if (key === 'merchant') {                                                     // 只有主办方有这一格
      return this.setData({
        'merchantSheet.show': true,
        merchantActions: this.buildMerchantActions(),
      });
    }
    // 客户 = 本项目的玩家名单(谁要来 / 谁还没来),不是全局关系页
    if (key === 'customer') return this.openPlayerSheet();
    // 编辑按身份分流:主办方改的是主题(权益票夹 / 票价主题),
    // 承接方改的是自己那条报名 —— 原来共用一个 handler,主办方点了必然
    // 撞上「该报名已通过审核」那句文不对题的提示(host 路径压根没有 stateKey)。
    if (key === 'more') return this.openMoreSheet();
  },

  /**
   * 改我这条报名。后端闸:主题未开始 且 状态∈{审核中,已驳回}(见
   * /api/registration/merchant/update)。前端这里只做「点不动时说明为什么」,
   * 真正的拦截以后端为准 —— 两边算同一套判据会漂移。
   */
  /**
   * 「更多」抽屉。按 role + stateKey 给四套分组(与 Figma 468:960 / 1009 / 1086 / 1126 一一对应)。
   * 为什么按状态拆而不是一套加禁用:承接方过审后「修改承接内容」是死的,但本站运营那一组
   * 才刚开始有意义 —— 同一张单子在不同阶段该露出的东西完全不同。
   */
  openMoreSheet() {
    const more = this.buildMoreGroups();
    this.setData({ moreSheet: { show: true, subtitle: more.subtitle, groups: more.groups } });
    // 主办方那套抽屉里的「开放报名」要显示当前是开还是关,章节得先拉到。
    // 按需拉、silentError:拉不到就是那一行不带「开/关」,抽屉本身照常能用
    if (this.data.role === 'host' && !this._hostChapters) this.loadHostChapters();
    // CU-C-68:「本站运营」那四行按商家身份取站点,没承接本站的主办方点了必被后端拒
    if (this.data.role === 'host') this.probeStationOperable();
  },

  /* CU-C-68:主办方抽屉里的「本站运营」四行(这一站怎么接待 / 服务时段与接待容量 /
     客户·谁要来谁还没来 / 暂停接待)入口都走 /api/game/session/merchant/entries,
     取的是**商家身份下的站点**。没以商家身份承接本站的主办方点下去只有
     「当前商家不负责本场站点」——入口先给后拒。开抽屉时用同一判据源探一次:
       true  = 本人也承接了本站 → 照常给入口
       false = 已确认没资格(后端 GAME_FORBIDDEN_SCOPE 或没有本站场次) → 置灰并写明
       null  = 还没探到 / 探失败 → 也置灰,不冒充可点
     探不到不等于没有(空≠错),所以失败留在未确认态,重开抽屉再探。 */
  probeStationOperable() {
    const topicId = Number(this.data.topicId || (this.data.info && this.data.info.topicId) || 0);
    if (!topicId) {
      this._stationOperable = false;
      this.setData({ stationOpsErrorText: '' });
      return;
    }
    const that = this;
    this._stationOperable = null;
    this.setData({ stationOpsErrorText: '' });
    app.sendRequest({
      url: '/api/game/session/merchant/entries', method: 'GET', hideLoading: true, silentError: true,
      success(res) {
        const ok = res && (res.code == 200 || res.code == '200');
        const rows = ok && Array.isArray(res.data) ? res.data : null;
        if (!rows) {
          const denied = !!(res && res.data && res.data.reasonCode === 'GAME_FORBIDDEN_SCOPE');
          that._stationOperable = denied ? false : null;
          that.setData({ stationOpsErrorText: denied ? '' : '没能确认你是否承接本站，稍后重开本面板再试' });
        } else {
          that._stationOperable = rows.some(row => row && Number(row.topicId) === topicId && Number(row.activityId) > 0);
          that.setData({ stationOpsErrorText: '' });
        }
        that.refreshMoreGroups();
      },
      fail() {
        that._stationOperable = null;
        that.setData({ stationOpsErrorText: '没能确认你是否承接本站，稍后重开本面板再试' });
        that.refreshMoreGroups();
      },
    });
  },

  // 抽屉开着时就地重建分组(探站点资格、章节开关都用它;抽屉关着不用白算一遍)
  refreshMoreGroups() {
    if (!this.data.moreSheet || !this.data.moreSheet.show) return;
    this.setData({ 'moreSheet.groups': this.buildMoreGroups().groups });
  },

  /* 章节列表(给「开放报名」那一行读 recruitEnabled)。
     与 openChapterSheet 拉的是同一个接口同一份数据 —— 谁先拉到谁填,另一个直接复用,
     不让同一份 chaptersList 在一个页面里被拉两遍。 */
  loadHostChapters() {
    const topicId = this.data.topicId || (this.data.info && this.data.info.topicId);
    if (!topicId || this._hostChaptersLoading) return;
    this._hostChaptersLoading = true;
    const that = this;
    app.sendRequest({
      url: '/api/topic/info-to-user', method: 'POST', hideLoading: true, silentError: true,
      data: { id: topicId, scope: this.data.operationScope },
      success(res) {
        const d = res && (res.code == 200 || res.code == '200') ? res.data : null;
        if (!d || !Array.isArray(d.chaptersList)) return;   // 读不到 ≠ 没有章节,保持不带标签
        that._hostChapters = d.chaptersList;
        if (that.data.moreSheet && that.data.moreSheet.show) {
          const more = that.buildMoreGroups();
          that.setData({ 'moreSheet.groups': more.groups });
        }
      },
      complete() { that._hostChaptersLoading = false; },
    });
  },

  closeMoreSheet() {
    this.setData({ 'moreSheet.show': false });
  },

  /* 稿 468:960/1009/1086/1126:四套抽屉除了分组,标题下面各有一句「这一套为什么长这样」。
     返回 { subtitle, groups } —— 原来只返回 groups,那句话四套都没有。 */
  buildMoreGroups() {
    const OPS = [
      { key: 'howto',   label: '这一站怎么接待', sub: '商家只做什么 · 不看剧情(剧透隔离)' },
      { key: 'service', label: '服务时段与接待容量', sub: '决定这一站能接多少人、什么时候接' },
      { key: 'customer', label: '客户 · 谁要来 / 谁还没来',
        sub: '查看报名、到店和核销情况' },
      { key: 'pause',   label: '暂停接待', sub: '临时有事 / 设备故障 · 需要已审核的备用方案' },
    ];
    if (this.data.role === 'host') {
      const canEdit = this._hostCanEdit !== false;
      return { subtitle: '你是这条路线的主办方,可以编辑主题内容和管理章节', groups: [
        { head: '编辑', rows: [
          { key: 'perk',  label: '权益票夹', sub: '商家常备权益 · 挂在店铺装修里' },
          { key: 'topic', label: '票价与主题内容', sub: canEdit ? '改票价 / 章节 / 节点' : '当前没有编辑资格',
            disabled: !canEdit, tag: canEdit ? '' : '不可用' },
        ] },
        { head: '章节控制(只有主办方能动)', rows: [
          /* 稿 468:1126「开放报名」。2026-09-10 用户确认这一行说的是**开放商家承接这一章**
             (cms_topic_chapter.recruit_enabled),不是玩家买票 —— 玩家票在本仓是主题级的,
             cms_registration 不带 chapter_id,章节层没有售票这回事。
             CU-M-185:标题照它真做的事写「开放商家承接申请」,主办方才不会读成开放玩家买票。
             ⚠️ 状态未知时不写「开/关」:写错一个字,主办方会照着它做相反的决定。 */
          { key: 'chapterOpen',   label: '开放商家承接申请',
            sub: this.chapterOpenSub(), disabled: this.chapterFinished() || this.noChapter(),
            tag: this.chapterRecruitTag(), tagKind: this.chapterRecruitTagKind() },
          { key: 'chapterInvite', label: '邀请其他商家', sub: this.inviteMerchantSub(),
            disabled: this.chapterFinished() },
          /* 2026-09-10 用户定:只有发起人能点 —— 这一组的组标题本来就写着「只有主办方能动」,
             端点侧也按主题归属人挡了一道。结束是不可逆的,所以走 cy-danger-confirm 三段式。 */
          { key: 'chapterFinish', label: '结束本章',
            sub: this.chapterFinishSub(),
            disabled: this.chapterFinished() || this.noChapter(),
            tag: this.chapterFinished() ? '已结束' : (this.noChapter() ? '需章节' : ''), danger: true },
        ] },
        { head: '本站运营(主办方自己也接待时)', rows: this.stationOpsRows(OPS) },
      ] };
    }
    const st = this.data.stateKey;
    if (st === 'ended') {
      return { subtitle: '结束后只剩复盘与结算', groups: [
        { head: '本站运营', rows: [
          { key: 'review',     label: '本站复盘', sub: '只看自己这一站 · 缺的指标不显示为零' },
          { key: 'settlement', label: '查看结算报告', sub: '结算明细与分润' },
        ] },
        { head: '其他', rows: [{ key: 'support', label: '联系客服', sub: '结算有疑问找平台' }] },
      ] };
    }
    if (this.canEditRegistration()) {
      // pending / rejected:还能改内容,也还没开始接待
      return { subtitle: '这两个状态还能改内容,也还没开始接待', groups: [
        { head: '我的报名', rows: [
          { key: 'editRegistration', label: '修改承接内容', sub: '改完重新进入审核', tag: '可改' },
        ] },
        { head: '先配起来', rows: [
          { key: 'service', label: '服务时段与接待容量', sub: '过审前就能填,过审后直接生效' },
        ] },
        { head: '其他', rows: [
          { key: 'support', label: '联系客服', sub: '审核有疑问找平台' },
          { key: 'cancel',  label: '取消参与', sub: '审核中可直接取消,不用走客服', danger: true },
        ] },
      ] };
    }
    // confirmed / running:内容锁死,运营动作才是主角
    return { subtitle: '审核通过后内容锁死,这里全是运营动作', groups: [
      { head: '我的报名', rows: [
        { key: 'editRegistration', label: '修改承接内容',
          sub: '该报名已通过审核,内容不能再修改', disabled: true, tag: '不可用' },
      ] },
      { head: '本站运营', rows: OPS },
      { head: '其他', rows: [
        { key: 'support', label: '联系客服', sub: '要改内容也走客服' },
        { key: 'quit',    label: '联系客服申请退出', sub: '已确认承接后不能自行取消', danger: true },
      ] },
    ] };
  },

  /* CU-C-68:主办方视图下的「本站运营」四行。判据不是「我是不是主办方」,而是
     「我是不是同时以商家身份承接了本站」—— 未确认或确认没资格时整组置灰并写明原因,
     不能给一颗点了只弹「当前商家不负责本场站点」的入口。 */
  stationOpsRows(rows) {
    if (this._stationOperable === true) return rows;
    return rows.map(row => Object.assign({}, row, {
      disabled: true,
      tag: this._stationOperable === false ? '不可用' : '待确认',
      sub: '只有同时以商家身份承接本站才能配置这一项',
    }));
  },

  /* 章节招商开关的三段文案。数据来自 /api/topic/info-to-user 的 chaptersList[].recruitEnabled
     (TopicChapterVO 继承 CmsTopicChapter,这一列本来就下发,不用另开读接口)。
     ⚠️ 还没拉到章节时一律返回空 —— 宁可这一行只有标题,也不要猜一个「开」出来。 */
  chapterRecruitChapter() {
    const list = this._hostChapters || [];
    if (!list.length) return null;
    // 多章时以「当前承接的那一章」为准,拿不到就第一章 —— 与 applyChapterSheet 同一条命中顺序
    const name = (this.data.info && this.data.info.chapterName) || '';
    return (name && list.filter((c) => c && c.name === name)[0]) || list[0];
  },
  /* 已结束的章节这一行是死的:后端对它直接拒掉开关(不然「结束」就成了可来回拨的招商开关)。
     前端跟着灰掉并说清为什么 —— 一颗点了只会弹错误的开关比禁用更难懂。 */
  chapterFinished() {
    const c = this.chapterRecruitChapter();
    return !!(c && c.finishTime);
  },
  chapterRecruitSub() {
    const c = this.chapterRecruitChapter();
    if (!c) return '开放后商家能在合作中心看到并申请承接这一章';
    if (c.finishTime) return '本章已结束 · 不能再开放商家承接';
    return Number(c.recruitEnabled) === 1
      ? '商家现在能在合作中心看到并申请承接这一章'
      : '关着 · 商家在合作中心看不到这一章';
  },
  /* CU-M-186:这两行管的是「这一章」,主题一章都没有时它们没有任何可执行的对象。
     以前只由 chapterFinished() 决定灰不灰 —— 读不到章节它返回 false,于是两行照旧可点,
     点完抽屉关掉,只留一句「还没读到章节,稍后再试」。现在按章节数据把两行灰掉并写明下一步。 */
  noChapter() {
    return this.chapterRecruitChapter() == null;
  },
  chapterOpenSub() {
    if (!this.noChapter()) return this.chapterRecruitSub();
    return this._hostChapters
      ? '还没有章节 · 先在「票价与主题内容」里添加一章'
      : '章节还没读到 · 稍后再试';
  },
  chapterFinishSub() {
    if (this.chapterFinished()) return '已结束';
    if (this.noChapter()) {
      return this._hostChapters
        ? '还没有章节 · 先在「票价与主题内容」里添加一章'
        : '章节还没读到 · 稍后再试';
    }
    // 这一行管的还是同一章的招商:结束后商家不能再申请承接,已确认的承接不受影响
    return '结束后商家不能再申请承接本章,已确认的承接不受影响';
  },
  chapterRecruitTag() {
    const c = this.chapterRecruitChapter();
    if (!c) return this._hostChapters ? '需章节' : '';
    if (c.finishTime) return '已结束';
    return Number(c.recruitEnabled) === 1 ? '开' : '关';
  },
  chapterRecruitTagKind() {
    const c = this.chapterRecruitChapter();
    if (!c || c.finishTime) return '';
    return Number(c.recruitEnabled) === 1 ? 'on' : '';
  },

  /* 开关章节的商家承接。落到 /api/topic/chapter/recruit ——
     ★ 一条规则都不在前端判:合法值、已有申请/供给时不许关、条款档与门槛值、容量、
       父主题上架与软删,全在服务层 updateCmsTopicChapter 里。前端自己先判一遍
       = 两套规则迟早分叉,而分叉的那一侧就是绕过闸的入口。
       所以拒绝的理由原样回显(例如「章节已有 3 条商家申请,不能关闭商家承接」)。 */
  toggleChapterRecruit() {
    const c = this.chapterRecruitChapter();
    if (!c || !c.id) { app.tips('还没读到章节，稍后再试'); return; }
    if (this._chapterRecruitBusy) return;
    this._chapterRecruitBusy = true;
    const next = Number(c.recruitEnabled) === 1 ? 0 : 1;
    const that = this;
    cyLoading.show(next === 1 ? '开放中…' : '关闭中…');
    app.sendRequest({
      url: '/api/topic/chapter/recruit', method: 'POST', hideLoading: true,
      data: { chapterId: c.id, enabled: next, scope: this.data.operationScope },
      success(res) {
        if (!(res && (res.code == 200 || res.code == '200'))) {
          app.tips(app.getRequestErrorMessage(res, '没改成功'));
          return;
        }
        c.recruitEnabled = next;                 // 回读之前先把本地这一份改掉,抽屉立刻反映
        that.setData({ moreSheet: Object.assign({}, that.data.moreSheet, that.buildMoreGroups()) });
        app.tips(next === 1 ? '已开放商家承接' : '已关闭商家承接');
      },
      fail(res) { app.tips(app.getRequestErrorMessage(res, '没改成功，检查网络后重试')); },
      // 闸放 complete:只在 success 里放,失败一次这个开关就永久点不动了
      complete() { that._chapterRecruitBusy = false; cyLoading.hide(); },
    });
  },

  /* 稿 468:1126:「邀请其他商家」的副文案是**真实数据**「还缺 2 站 · 招商截止 8.18」,
     不是「还缺几站就在这里补」这种废话。两半各自有就写、没有就不写 ——
     站数缺不出来时不写成「还缺 0 站」(那会读成招满了)。 */
  inviteMerchantSub() {
    const r = this.data.hostRecruit || {};
    const left = Number(r.nodeTotal) - Number(r.nodeFilled);
    const parts = [];
    if (Number.isFinite(left) && left > 0) parts.push('还缺 ' + left + ' 站');
    const deadline = (this.data.hostTopic || {}).recruitDeadlineText;
    if (deadline) parts.push(deadline);
    return parts.join(' · ');
  },

  onMorePick(e) {
    const key = e.currentTarget.dataset.key;
    const row = this.findMoreRow(key);
    if (row && row.disabled) { app.tips(row.sub || '当前不能做这个'); return; }
    const id = this.data.topicId || (this.data.info && this.data.info.topicId);
    this.setData({ 'moreSheet.show': false });
    /* CU-M-56 / CU-C-69:常备权益自己有一页(decor/perks),原来只跳到品牌中心「首页」,
       还要再点一次「合作经营 → 常备权益」——从项目进来的人会以为入口点错了。
       失败要给可见说法:navigateTo 不带 fail 回调时失败是静默的,点了像没反应。 */
    if (key === 'perk') {
      wx.navigateTo({
        url: '/pages/merchant/decor/perks/index',
        fail: () => app.tips('权益票夹暂时打不开，稍后重试'),
      });
      return;
    }
    // 票价与主题内容 = 专业编辑器
    if (key === 'topic' && id) return wx.navigateTo({ url: '/pages/publish/fabu/index?id=' + id
      + (this.data.operationScope === 'MERCHANT' ? '&scope=MERCHANT' : '') });
    if (key === 'editRegistration') return this.goEditRegistration();
    if (key === 'customer') return this.openPlayerSheet();
    if (key === 'cancel') return this.cancelRegistration();
    if (key === 'settlement') return this.goSettlementReport();
    if (key === 'support' || key === 'quit') {
      cyModal.show({
        title: key === 'quit' ? '申请退出' : '联系客服',
        content: '在「我的 → 帮助与客服」里发起,带上这条路线的名字,客服会核对后处理。',
        showCancel: false, confirmText: '知道了',
      });
      return;
    }
    /* howto / service / review / pause:Figma ⑧ 段那四张稿(469:1002 / 469:1025 /
       469:1087 / 281:494)画的不是四个新页面 —— 它们逐段对应现码
       pages/merchant/game-node 的「本站执行卡(无需猜剧情)」「准备清单 + 服务时段与
       接待容量」「本站复盘」「暂停信息 + 暂停接待 sheet」。同一个角色(承接方看自己
       这一站)、同一份数据,再画一遍就是第二实现。所以这四行是接线,不是新建。 */
    if (key === 'howto' || key === 'service' || key === 'review' || key === 'pause') {
      // CU-C-68:抽屉里这几行已置灰,这里再兜一道 —— 没确认自己承接本站就別去撞后端
      if (this.data.role === 'host' && this._stationOperable !== true) {
        app.tips('只有承接本站的商家能配置');
        return;
      }
      return this.goStation(key);
    }
    // 「邀请其他商家」= 去找商家补空缺的站,现成入口就在本页(goInviteMerchant → coop/nearby)
    if (key === 'chapterInvite') return this.goInviteMerchant();
    // 开放报名:真开关,落 /api/topic/chapter/recruit(2026-09-10 补的端点)
    if (key === 'chapterOpen') return this.toggleChapterRecruit();
    // 结束本章:2026-09-10 补的端点 /api/topic/chapter/finish,只有发起人能调。
    if (key === 'chapterFinish') return this.askFinishChapter();
  },

  /* 稿 468:1126「结束本章」。不可逆写 ⇒ 走 cy-danger-confirm 三段式,
     文案在 utils/danger-actions.js 的 topic.chapter.finish 里(门禁逐条校验)。
     抽屉已经由 onMorePick 关掉了,这里不再关第二遍。 */
  askFinishChapter() {
    const c = this.chapterRecruitChapter();
    if (!c || !c.id) { app.tips('还没读到章节，稍后再试'); return; }
    if (c.finishTime) { app.tips('本章已经结束过了'); return; }
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (!dc) return;
    dc.open('topic.chapter.finish', { name: c.name || '本章', id: c.id });
  },

  /* cy-danger-confirm 的 confirm 回调。e.detail = { key, params }。
     ⚠️ 这个页面上还有「撤回申请」也用同一个 #dc —— 按 key 分流,别让两条写路串线。 */
  onDangerConfirm(e) {
    const key = e && e.detail && e.detail.key;
    if (key === 'topic.chapter.finish') return this.doFinishChapter(e.detail.params || {});
    return this.onConfirmWithdrawApplication(e);
  },

  /* cy-danger-confirm 的 alt「改为关闭开放报名」(danger-actions topic.chapter.finish)。
     原来这一行没接线,按下去只关框。⚠️ 不能直接 reuse toggleChapterRecruit —— 它是双向翻转,
     报名本来就关着时按 alt 会把它开出去,方向正好反。 */
  onDangerAlt(e) {
    const key = e && e.detail && e.detail.key;
    if (key !== 'topic.chapter.finish') return;
    const c = this.chapterRecruitChapter();
    if (!c || !c.id) { app.tips('还没读到章节，稍后再试'); return; }
    if (Number(c.recruitEnabled) !== 1) { app.tips('本章已经不接新的商家申请了'); return; }
    this.toggleChapterRecruit();
  },

  doFinishChapter(params) {
    const that = this;
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.busyOn();
    app.sendRequest({
      url: '/api/topic/chapter/finish', method: 'POST', hideLoading: true,
      data: { chapterId: params.id, scope: this.data.operationScope },
      success(res) {
        if (!(res && (res.code == 200 || res.code == '200'))) {
          // 服务端写清楚的理由要原样给出来(例如「只有发起人能结束本章」)
          if (dc) dc.failed(app.getRequestErrorMessage(res, '没能结束'));
          return;
        }
        const c = that.chapterRecruitChapter();
        // 回读之前先把本地这一份改掉,抽屉与「开放报名」那一行立刻反映
        if (c) { c.finishTime = new Date().toISOString(); c.recruitEnabled = 0; }
        that.setData({ moreSheet: Object.assign({}, that.data.moreSheet, that.buildMoreGroups()) });
        if (dc) dc.done();
      },
      fail(res) { if (dc) dc.failed(app.getRequestErrorMessage(res, '网络异常，请重试')); },
    });
  },

  /* 跳「本站」页(game-node)。它按场次(activityId)开,而承接页是主题级的 ——
     中间靠 /api/game/session/merchant/entries 拿本商家的站点入口,按 topicId 过滤。
     ⚠️ 不能拿承接页自己的 upcoming-runs 顶替:那份返回的是 ticketId(OmsTicket),
     game-node 要的是 CmsActivity.id,两者不是一个东西。 */
  onStationSheetCancel() { this.setData({ stationSheetShow: false }); },

  onStationSheetSelect(e) {
    const ctx = this._stationPick || {};
    const id = (ctx.ids || [])[e.detail.index];
    this.setData({ stationSheetShow: false });
    if (id) this.openStation(id, ctx.focus);
  },

  goStation(focus) {
    if (this._stationLoading) return;
    const topicId = Number(this.data.topicId || (this.data.info && this.data.info.topicId) || 0);
    if (!topicId) { app.tips('缺少主题信息，请退出重进'); return; }
    const that = this;
    this._stationLoading = true;
    cyLoading.show('读取本站…');
    app.sendRequest({
      url: '/api/game/session/merchant/entries', method: 'GET', hideLoading: true,
      success(res) {
        const rows = (res && (res.code == 200 || res.code == '200') && Array.isArray(res.data)) ? res.data : null;
        if (!rows) { app.tips(app.getRequestErrorMessage(res, '本站入口没读到')); return; }
        const mine = rows.filter((row) => row && Number(row.topicId) === topicId && Number(row.activityId) > 0);
        if (!mine.length) {
          // 空不等于错:还没有场次开出来,本站页进去也是空的。说清楚是哪一种。
          // CU-M-21:原来只 toast 2 秒,点完回到原页像没反应 —— 改成要点「知道了」的说明。
          cyModal.show({
            title: '还没有可接待的场次',
            content: '本站接待、服务时段和暂停都按场次配置。这条路线开出场次、且你这一站在场次里之后,这里才能进入。',
            showCancel: false, confirmText: '知道了',
          });
          return;
        }
        if (mine.length === 1) { that.openStation(mine[0].activityId, focus); return; }
        /* 多个场次让商家选一个。原来弹系统 ActionSheet(设计体系外),
           2026-09-10 合流 master 后统一走 cy-option-sheet —— 与本页「更多」抽屉同一套形态。
           ⚠️ 取消要照原样把 _stationLoading 放掉,否则这个入口点一次就再也点不动。 */
        that._stationPick = { ids: mine.map((row) => row.activityId), focus };
        that.setData({
          stationSheetShow: true,
          stationSheetItems: mine.map((row) => String(row.activityName || '未命名场次').slice(0, 30)),
        });
      },
      fail(res) { app.tips(app.getRequestErrorMessage(res, '本站入口没读到,检查网络后重试')); },
      // 闸在 complete 里放:只在 success 里放的话,失败一次这个入口就永久点不动了
      complete() { that._stationLoading = false; cyLoading.hide(); },
    });
  },

  openStation(activityId, focus) {
    // focus=pause 让 game-node 落地后直接把「暂停接待」抽屉打开 —— 抽屉里点的就是这件事,
    // 再让人在那一页自己找一遍按钮是白绕一圈。其余三档只是同一页的不同段落,不传。
    wx.navigateTo({
      url: '/pages/merchant/game-node/index?activityId=' + activityId
        + (focus === 'pause' ? '&focus=pause' : ''),
    });
  },

  /* 「我承接的」章节卡点开 = 本章全貌:剧情 + 本章各站的玩法。
     ⚠️ 这些不在承接单详情里 —— 那份只给自己那一站(templateDetail),整章要走主题公开投影
     /api/topic/info-to-user。按需拉一次,不打开就不拉;拉过就不再拉。
     ⚠️ 分支图主题下后端只放行「自己已中标的节点」(ApiTopicController 2026-09-05),
     所以那种主题这里就只有自己那一站 —— 条数照实显示,不补也不解释成"加载不全"。 */
  openChapterSheet() {
    if (this._chapterSheetNodes) {
      this.setData({ 'chapterSheet.show': true, 'chapterSheet.state': 'ready' });
      return;
    }
    const topicId = this.data.topicId || (this.data.info && this.data.info.topicId);
    if (!topicId) { app.tips('缺少主题信息，请退出重进'); return; }
    const that = this;
    this.setData({ 'chapterSheet.show': true, 'chapterSheet.state': 'loading', 'chapterSheet.error': '' });
    app.sendRequest({
      url: '/api/topic/info-to-user', method: 'POST', hideLoading: true,
      data: { id: topicId, scope: this.data.operationScope },
      success(res) {
        if (!(res && (res.code == 200 || res.code == '200') && res.data)) {
          that.setData({ 'chapterSheet.state': 'error',
            'chapterSheet.error': app.getRequestErrorMessage(res, '本章内容没加载出来') });
          return;
        }
        that.applyChapterSheet(res.data);
      },
      fail(res) {
        that.setData({ 'chapterSheet.state': 'error',
          'chapterSheet.error': app.getRequestErrorMessage(res, '本章内容没加载出来,检查网络后重试') });
      },
    });
  },

  applyChapterSheet(topic) {
    const list = (topic && topic.chaptersList) || [];
    if (list.length) this._hostChapters = list;   // 同一份数据,给「开放商家承接申请」那一行复用
    const info = this.data.info || {};
    const myNodeId = info.nodeId == null ? '' : String(info.nodeId);
    const myChapterName = info.chapterName || '';
    // 命中顺序:自己那一站所在的章(最准)→ 承接单上的章节名 → 第一章
    let chapter = null;
    if (myNodeId) {
      chapter = list.filter((c) => (c.nodes || [])
        .some((n) => n && String(n.id) === myNodeId))[0] || null;
    }
    if (!chapter && myChapterName) chapter = list.filter((c) => c && c.name === myChapterName)[0] || null;
    if (!chapter) chapter = list[0] || null;
    if (!chapter) {
      this.setData({ 'chapterSheet.state': 'empty', 'chapterSheet.error': '' });
      this._chapterSheetNodes = [];
      return;
    }
    const nodes = (chapter.nodes || []).filter((n) => n && n.id).map((n) => {
      const tpl = n.cmsMemberTemplate || null;
      return {
        id: n.id,
        name: n.name || '未命名站点',
        // 玩法与奖励复用承接页那两个 build —— 同一份形状,不另写一套渲染口径
        play: this.buildPlay(tpl),
        reward: this.buildReward(tpl),
        templateId: (tpl && tpl.id) || '',
        mine: !!myNodeId && String(n.id) === myNodeId,
      };
    });
    this._chapterSheetNodes = nodes;
    this.setData({
      'chapterSheet.state': 'ready',
      'chapterSheet.chapterName': chapter.name || '',
      'chapterSheet.story': chapter.description || '',
      'chapterSheet.storyOpen': false,
      'chapterSheet.nodes': nodes,
    });
  },

  closeChapterSheet() { this.setData({ 'chapterSheet.show': false }); },
  toggleChapterStory() { this.setData({ 'chapterSheet.storyOpen': !this.data.chapterSheet.storyOpen }); },

  openNodeSheet(e) {
    const id = String(e.currentTarget.dataset.id || '');
    const node = (this._chapterSheetNodes || []).filter((n) => String(n.id) === id)[0];
    if (!node) return;
    /* 自己那一站的答案走承接单详情(后端 merchantView 只对 auditStatus=1 放行);
       本章其它站的模板是 info-to-user 里 strip 过的,答案本来就是 null ——
       所以「查答案」只对自己那一站出现,不是前端在判身份,是那儿根本没有答案可给。 */
    const play = node.mine && this.data.play ? this.data.play : node.play;
    this.setData({
      'chapterSheet.show': false,
      nodeSheet: {
        show: true,
        name: node.name,
        chapterText: (node.mine ? '我承接的站点 · ' : '') + (this.data.chapterSheet.chapterName || ''),
        play: play,
        reward: node.reward,
        templateId: node.templateId,
        mine: node.mine,
        // 没配模板就不给「看模板」——给了也是点进一个不存在的详情
        actions: node.templateId ? [{ key: 'openNodeTemplate', label: '看模板' }] : [],
      },
    });
  },

  // 关节点回章节:这是下钻的返回,不是关掉整条路
  closeNodeSheet() {
    this.setData({ 'nodeSheet.show': false, 'chapterSheet.show': true });
  },

  openNodeTemplate() {
    const id = this.data.nodeSheet.templateId;
    if (!id) { app.tips('这一站还没配玩法模板'); return; }
    this.setData({ 'nodeSheet.show': false });
    wx.navigateTo({ url: '/pages/templatedetail/templatedetail?id=' + id + '&scope=my' });
  },

  findMoreRow(key) {
    const groups = (this.data.moreSheet && this.data.moreSheet.groups) || [];
    for (let i = 0; i < groups.length; i++) {
      const rows = groups[i].rows || [];
      for (let j = 0; j < rows.length; j++) if (rows[j].key === key) return rows[j];
    }
    return null;
  },

  goEditRegistration() {
    if (!this.canEditRegistration()) {
      app.tips(this.data.stateKey === 'ended' || this.data.stateKey === 'running'
        ? '主题已开始,承接内容不能再修改'
        : '该报名已通过审核,内容不能再修改');
      return;
    }
    wx.navigateTo({
      url: '/pages/topic/merchantapply/index?mode=1&id=' + this.data.regId,
      events: { registrationSaved: () => this.loadDetail() },
    });
  },

  canEditRegistration() {
    return this.data.stateKey === 'pending' || this.data.stateKey === 'rejected';
  },

  // 核销扫码流程(含③选章面板)整套在商家首页,这里只做交接,不复制一份出来各自演化
  goVerify() {
    wx.reLaunch({ url: '/pages/merchant/index/index' });
  },

  _checkinNodeId() {
    const nodeId = Number(this.data.info && this.data.info.nodeId);
    return Number.isSafeInteger(nodeId) && nodeId > 0 ? nodeId : 0;
  },

  showLiveCheckin() {
    if (!this._checkinNodeId()) {
      app.tips('本站未绑定节点，无法出示码');
      return false;
    }
    this.setData({ checkinVisible: true });
    this.issueStationPoster();
    return true;
  },

  closeLiveCheckin() {
    this._checkinEpoch = (this._checkinEpoch || 0) + 1;
    this.clearCheckinTimer();
    this.setData({
      checkinVisible: false,
      checkinQrState: 'loading',
      checkinQrUrl: '',
      checkinErr: '',
    });
  },

  clearCheckinTimer() {
    if (this._checkinTimer) {
      clearInterval(this._checkinTimer);
      this._checkinTimer = null;
    }
  },

  issueStationPoster(opts) {
    const that = this;
    const saveAfter = !!(opts && opts.saveAfter);
    const nodeId = this._checkinNodeId();
    if (!nodeId) return;
    const epoch = (this._checkinEpoch || 0) + 1;
    this._checkinEpoch = epoch;
    this.clearCheckinTimer();
    this.setData({ checkinQrState: 'loading', checkinQrUrl: '', checkinErr: '' });
    app.sendRequest({
      url: '/api/merchant/chapter-node/poster-code',
      method: 'POST',
      data: { nodeId },
      hideLoading: true,
      success(res) {
        if (epoch !== that._checkinEpoch) return;
        const data = res && res.data;
        if (res && (res.code === 200 || res.code === '200') && data && data.qrcodeUrl) {
          that.setData({
            checkinQrState: 'ready',
            checkinQrUrl: data.qrcodeUrl || '',
            checkinErr: '',
          });
          if (saveAfter) that.saveCheckinImage(data.qrcodeUrl || '');
          return;
        }
        that.setData({ checkinQrState: 'error', checkinErr: (res && res.msg) || '打卡码暂时没能生成' });
        if (saveAfter) app.tips((res && res.msg) || '打卡码暂时没能生成');
      },
      fail() {
        if (epoch !== that._checkinEpoch) return;
        that.setData({ checkinQrState: 'error', checkinErr: '网络异常，请重试' });
        if (saveAfter) app.tips('网络异常，请重试');
      },
      successStatusAbnormal(res) {
        if (epoch !== that._checkinEpoch) return;
        that.setData({ checkinQrState: 'error', checkinErr: (res && res.msg) || '打卡码暂时没能生成' });
        if (saveAfter) app.tips((res && res.msg) || '打卡码暂时没能生成');
      },
    });
  },

  downloadCheckinQr() {
    if (!this._checkinNodeId()) {
      app.tips('本站未绑定节点，无法下载码');
      return false;
    }
    if (this.data.checkinQrState === 'ready' && this.data.checkinQrUrl) {
      this.saveCheckinImage(this.data.checkinQrUrl);
      return true;
    }
    this.issueStationPoster({ saveAfter: true });
    return true;
  },

  saveCheckinImage(url) {
    if (!url) {
      app.tips('打卡码还没生成');
      return;
    }
    wx.downloadFile({
      url,
      success(res) {
        if (!res || res.statusCode !== 200 || !res.tempFilePath) {
          app.tips('下载失败，请重试');
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success() { app.tips('已保存到相册'); },
          fail(e) {
            const msg = (e && e.errMsg) || '';
            if (/auth|deny/i.test(msg)) {
              cyModal.show({
                title: '需要相册权限',
                content: '在设置里允许保存到相册后重试。',
                confirmText: '去设置',
                cancelText: '取消',
                success(m) { if (m.confirm) wx.openSetting({}); },
              });
            } else if (!/cancel/i.test(msg)) {
              app.tips('保存失败，请重试');
            }
          },
        });
      },
      fail() { app.tips('下载失败，请重试'); },
    });
  },

  /**
   * 两条台账作用域不同,不是一条链:俱乐部名册按 clubId+topicId 读,就是本项目;
   * 商家那本是全店记录(接口不按 topicId 过滤,静默丢参比不丢更坏 —— CU-M-183 实证),
   * 所以商家分支的入口写「查看全店台账」,让人点之前就知道名单人数与台账笔数不是同一口径。
   * 跨项目的全量关系(我所有的客户/商家/俱乐部)在 pages/merchant/relation,项目页不往那儿跳。
   */
  goLedger() {
    /* CU-C-67:台账按身份分流。商家那本在 pages/merchant/ledger;俱乐部主理人的「核销台账」
       是名册页 pages/club/enroll(同一个 clubId + topicId 读报名与核销态)。
       原来一律跳商家页 —— 非商家身份 active=false,整页必然「数据服务暂不可用」(P1 实证)。 */
    if (this.data.operationScope === 'CLUB') {
      const clubId = Number((this.data.info && this.data.info.clubId) || 0);
      const topicId = Number(this.data.topicId || (this.data.info && this.data.info.topicId) || 0);
      if (!clubId || !topicId) { app.tips('这条主题没有关联俱乐部'); return; }
      wx.navigateTo({ url: '/pages/club/enroll/index?clubId=' + clubId + '&topicId=' + topicId });
      return;
    }
    wx.navigateTo({ url: '/pages/merchant/ledger/index?view=redemptions' });
  },

  /* 「查看结算报告」去的是结算明细页,不是核销台账 —— 稿 468:1086 标的就是 coop/settlement-detail。
     台账回答「谁来过」,结算报告回答「这一站给我结了多少」,已结束态商家要的是后者。
     source=finance 时该页拿 topicId 当记录标识(settlement-detail/index.js:79-81)。 */
  goSettlementReport() {
    const id = this.data.topicId || (this.data.info && this.data.info.topicId);
    if (!id) { app.tips('还没读到主题标识，稍后再试'); return; }
    wx.navigateTo({ url: '/pages/coop/settlement-detail/index?source=finance&topicId=' + id });
  },

  formatShortDate(dateVal) {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal).slice(0, 10);
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${days[d.getDay()]} ${d.getMonth() + 1}月${d.getDate()}日`;
  },

  /* 稿 88:3776 的档期行写的是「8月2日 – 8月16日」——没有星期。
     星期是「今天要不要去」才需要的信息,档期跨半个月,写上反而把这行撑长。
     formatShortDate 仍留给招商截止那几处(不在这份稿里),不一起改。 */
  formatDayMonth(dateVal) {
    if (!dateVal) return '';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal).slice(0, 10);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  },

  /* 进度行的时间戳。稿上两种写法:提交/审核是「8.1 10:20」,开始/结束是「8.6 周三 19:30」。
     ⚠️ 钟点只在数据真带钟点时才写:后端 topic_start_date 是 datetime,但历史数据可能只存到日,
        补一个「00:00」出来会让商家以为要零点开门。 */
  formatStamp(dateVal, withWeekday) {
    if (!dateVal) return '';
    const d = new Date(String(dateVal).replace(/-/g, '/'));
    if (isNaN(d.getTime())) return '';
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    const parts = [`${d.getMonth() + 1}.${d.getDate()}`];
    if (withWeekday) parts.push(days[d.getDay()]);
    if (d.getHours() || d.getMinutes()) parts.push(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    return parts.join(' ');
  },

  cancelRegistration() {
    const that = this;
    cyModal.show({
      title: '确认取消',
      content: '确定要取消参与吗？取消后不可恢复。',
      success(res) {
        if (res.confirm) {
          app.sendRequest({
            url: '/api/registration/merchant/cancel',
            data: { id: that.data.regId },
            method: 'POST',
            success(res) {
              if (res.code == '200') {
                cyToast.success('已取消');
                setTimeout(() => wx.navigateBack(), 1500);
              } else {
                app.tips(res.msg || '取消失败');
              }
            }
          });
        }
      }
    });
  },

  contactService() {
    wx.navigateTo({ url: '/pages/shezhi/shezhi' });
  },
});
