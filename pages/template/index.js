const { readReducedMotion } = require('../../utils/motion-preference.js');
const modal = require('../../utils/modal.js');
const cyToast = require('../../utils/toast.js');
const { readPageStyle } = require('../../utils/font-scale.js');
const app = getApp();
const mockData = require('../../utils/mockData.js');
const policy = require('../../utils/identity/identity-policy.js');
const merchantTheme = require('../../utils/merchant-theme.js');
const merchantAccessPolicy = require('../../utils/merchant-access-policy.js');
const { formatDurationMinutes } = require('../../utils/template-display.js');
const { isRecord, isRecordList } = require('../../utils/response-shape.js');
const analytics = require('../../utils/analytics.js');

const HOME_LIST_FIELDS = ['categoryList', 'bannerList', 'recommendList', 'mustPlayList', 'latestList'];
function isTemplateHomePayload(data) {
  return isRecord(data) && HOME_LIST_FIELDS.every(function (field) {
    return data[field] == null || isRecordList(data[field]);
  });
}

// 官方交互模板的具象游戏图标。按标题绑定可同时覆盖开发预览与后端落库后的同名模板；
// 未命中的存量模板使用设计系统图标兜底，不伪造内容图。
const INTERACTION_ICON_BY_TITLE = {
  '今晚的暗号': '/images/interaction-templates/merchant-secret-code.svg',
  '老板的秘密题': '/images/interaction-templates/merchant-secret-question.svg',
  '拍下这一刻': '/images/interaction-templates/merchant-photo-moment.svg',
  '收集这枚风味印章': '/images/interaction-templates/merchant-flavor-stamp.svg',
  '新品盲测局': '/images/interaction-templates/merchant-blind-test.svg',
  '今日搭配任务': '/images/interaction-templates/merchant-style-mission.svg',
  '集合点亮': '/images/interaction-templates/club-gather.svg',
  '小队竞速点亮': '/images/interaction-templates/club-team-race.svg',
  '街角谜题': '/images/interaction-templates/club-street-puzzle.svg',
  '城市取景任务': '/images/interaction-templates/club-city-camera.svg',
  '城市接力棒': '/images/interaction-templates/club-relay.svg',
  '今日角色任务': '/images/interaction-templates/club-role-mission.svg',
  // 生活备份 G0–G6(cms_template_library,migration_seed_life_backup_games_20260820)
  'G0｜30秒生活掉线测试': '/images/interaction-templates/life-outage-test.svg',
  'G1｜现在出状况,你先选什么': '/images/interaction-templates/life-what-first.svg',
  'G2｜我的底线三选一': '/images/interaction-templates/life-bottom-line.svg',
  'G3｜营业时间拼图': '/images/interaction-templates/life-hours-puzzle.svg',
  'G4｜去之前准备什么': '/images/interaction-templates/life-prep-checklist.svg',
  'G5｜值不值得现在处理': '/images/interaction-templates/life-worth-now.svg',
  'G6｜首选失效怎么办': '/images/interaction-templates/life-first-choice-offline.svg',
};

Page({
  // 列表缓存与加载标志:只喂 rebuildLists 算 topList/tailList,wxml 零引用 ——
  // 走 setData 会被死数据字段门禁按 A2(只当内部状态)判红,所以放在 data 之外。
  // ⚠️ 这里的 [] 是字面量共享初值,任何写入都必须整体重新赋值,不许原地 push/splice。
  _topicRows: [],
  _gameRows: [],
  _topicLoaded: false,
  _gameLoaded: false,

  data: {
    reducedMotion: false,
    pageMetaStyle: '',
    // 主题模板货架(cms_topic is_template=1,/api/template/topic-template):
    // 与上面的玩法模板(cms_template_library)是两套实体,「用模板」直落复制成我的主题草稿
    // ===== 两 tab(2026-08-26):主题 = 一条路线 / 游戏 = 一个地点上的一次互动 =====
    tab: 'topic',
    tabItems: [{ key: 'topic', label: '主题' }, { key: 'game', label: '游戏' }],
    // CU-M-64:模板内搜索的关键词('' = 没在搜索)。入口只承诺搜模板,范围就是这个页面的两个 tab。
    searchKeyword: '',
    // ⚠️ topicRows/gameRows/两个 loaded 是**内部状态**,只喂 rebuildLists 算 topList/tailList,
    //    wxml 零引用 —— 走 setData 会被死数据字段门禁按 A2 判红,所以挂在实例上不进 data。
    listLoaded: false,        // 任一 tab 拿到过数据 —— 四态里区分「首次加载」与「已有内容」
    banner: {},
    topList: [],
    tailList: [],
    bannerTitle: '推荐',
    topTitle: '全部主题',
    emptyTitle: '',
    emptySub: '',
    ttUseError: '',
    ttUseRetryItem: null,
    operationScope: '',
    merchantAccessLoaded: false,
    canManageMerchantProjects: false,
    loading: false,
    hasHome: false,
    errorMsg: '',
    // 远端封面不可用时显示已有的明确失败态,不能拿别的业务内容图冒充模板封面。
    coverErrorSrc: '/images/no_data.svg',

    home: {
      categoryList: [],
      bannerList: [],
      recommendList: [],
      mustPlayList: [],
      latestList: []
    },
    activeCat: 0, // 0 = 全部

    // 发布广场 —— 发布能力卡(/api/publish/home)
    pub: {
      role: 'player',
      roleText: '玩家',
      isMerchant: false,
      permission: {},
      quota: { maxThemes: null, themesOnline: 0, themesRemaining: null },
      projectSummary: { total: 0, pending: 0, online: 0, offline: 0, rejected: 0 }
    },
    pubLoaded: false,
    publishSheetShow: false,

    statusBarHeight: getApp().globalData.statusBarHeight,
    navBarHeight: getApp().globalData.navBarHeight,
    menuButtonInfo: getApp().globalData.menuButtonInfo,
    smButtonOffset: -40,
    tabBarRaised: true,
    lastScrollTop: 0,
    scrollStopTimer: null,

    // 胶囊安全区：胶囊底部 + 额外间距，整体页面从此线开始
    capsuleBottom: 0,
    safeTop: 0,
    titBarHeight: 0,
    headerRightInset: 0
  },

  isDevEnv() {
    try {
      return wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
    } catch (e) {
      return false;
    }
  },

  onLoad(options) {
    options = options || {};
    const mi = getApp().globalData.menuButtonInfo || {};
    const sh = this.data.statusBarHeight;
    const capsuleBottom = mi.bottom || (sh + this.data.navBarHeight);
    const safeTop = capsuleBottom + 8;  // 胶囊底 + 8px 呼吸空间
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const windowWidth = Number(windowInfo.windowWidth) || 375;
    const capsuleLeft = Number(mi.left) || 0;
    const headerRightInset = capsuleLeft > 0 && capsuleLeft < windowWidth
      ? windowWidth - capsuleLeft + 8
      : windowWidth * 32 / 750;
    this.setData({
      operationScope: (options.mode === 'merchant' || options.scope === 'MERCHANT') ? 'MERCHANT' : '',
      capsuleBottom: capsuleBottom,
      safeTop: safeTop,
      titBarHeight: safeTop - sh,     // titBar = 胶囊底到状态栏底的距离
      headerRightInset: headerRightInset
    });
    if (this.isDevEnv()) {
      const mock = mockData.getHomeData() || {};
      this.applyCategoryList(mock.categoryList);
    }
  },

  onShow() {
    this.setData({ reducedMotion: readReducedMotion() });

    this.setData({ pageMetaStyle: readPageStyle() });
    wx.hideTabBar();
    // 收敛:商家玩家共用发布广场,底部 tabBar 按本地身份立即渲染(避免等 /api/publish/home 异步返回时闪 consumer)
    // pub.role 同步用本地快照预填:发布弹窗的活动卡锁态在接口返回前也判得对(权威值随 getPublishHome 覆盖)
    const merchantView = this.data.operationScope === 'MERCHANT'
      || policy.isMerchantView({ role: app.getUserRole(), userType: app.getUserType() });
    if (merchantView) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
    this.setData({
      tabBarRaised: true,
      isMerchant: merchantView,
      'pub.role': app.getUserRole()
    });
    this.getHome();
    if (this.data.operationScope === 'MERCHANT') this.loadMerchantAccess();
    this.getPublishHome();
    this.loadTab(this.data.tab);
  },

  loadMerchantAccess() {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/merchant/access/me',
      method: 'POST',
      data: {},
      success(res) {
        const access = merchantAccessPolicy.normalizeMerchantAccess(
          res && res.code == '200' ? res.data : null
        );
        that.applyMerchantPublishAccess(access.canManageProjects);
      },
      fail() { that.applyMerchantPublishAccess(false); }
    });
  },

  applyMerchantPublishAccess(canManage) {
    const permission = Object.assign({}, (this.data.pub && this.data.pub.permission) || {}, {
      canSimplePublish: !!canManage,
      canProPublish: !!canManage,
      canCreateTemplate: !!canManage
    });
    this.setData({
      merchantAccessLoaded: true,
      canManageMerchantProjects: !!canManage,
      'pub.role': 'merchant',
      'pub.isMerchant': true,
      'pub.permission': permission
    });
  },
  // ===== 发布广场:发布能力卡 =====
  getPublishHome() {
    const that = this;
    const ROLE_TEXT = { player: '玩家', club: '俱乐部主理人', merchant: '商家' };
    app.sendRequest({
      hideLoading: true,
      url: '/api/publish/home',
      method: 'POST',
      data: {},
      success(res) {
        if (res.code == '200' && res.data) {
          const d = res.data;
          const q = d.quota || {};
          const merchantScoped = that.data.operationScope === 'MERCHANT';
          const permission = merchantScoped
            ? Object.assign({}, d.permission || {}, {
              canSimplePublish: that.data.canManageMerchantProjects,
              canProPublish: that.data.canManageMerchantProjects,
              canCreateTemplate: that.data.canManageMerchantProjects
            })
            : (d.permission || {});
          that.setData({
            pub: {
              role: merchantScoped ? 'merchant' : (d.role || 'player'),
              roleText: merchantScoped ? '商家' : (ROLE_TEXT[d.role] || '玩家'),
              isMerchant: merchantScoped || !!d.isMerchant,
              permission: permission,
              quota: {
                maxThemes: q.maxThemes,
                themesOnline: q.themesOnline || 0,
                themesRemaining: q.themesRemaining
              },
              projectSummary: d.projectSummary || {}
            },
            pubLoaded: true
          });
        }
      },
      fail() { /* 能力卡失败不阻断页面 */ }
    });
  },

  // ===== 封面兜底 =====
  // 封面 URL 拉不动(404 / 域名不可达 / 空文件)时,固定显示仓库已有的设计资产。
  // 这是渲染失败态,不伪造内容图,也不使用主题首字作为视觉占位。
  COVER_LISTS: ['topList', 'tailList'],

  // 白名单列表取数组;不在白名单、或取出来不是数组,一律给 null
  coverListOf(list) {
    if (this.COVER_LISTS.indexOf(list) < 0) return null;
    const arr = list.split('.').reduce((o, k) => (o == null ? o : o[k]), this.data);
    return Array.isArray(arr) ? arr : null;
  },

  // <image binderror> 回来的是「当初那一格」的下标,而列表随时可能被下一轮请求整条换掉。
  // 光靠 idx 会把迟到的 error 写到换过内容的同一位置上(标错卡),所以四道闸都要过:
  // 列表白名单 → idx 是整数 → 在当前数组范围内 → 该位置的 id 仍是当初绑上去的那条。
  onCoverError(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const arr = this.coverListOf(ds.list);
    if (!arr) return;
    const idx = Number(ds.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) return;
    const item = arr[idx];
    if (!item) return;
    // 身份对不上(列表已刷新)或压根没有稳定 id ⇒ 宁可不兜底,也不标错卡。
    // ⚠️ 空串不算身份:两边都空时 '' === '' 会把「都没有 id」误判成「同一条」。
    //    但 id=0 是合法的,所以判空要判字符串长度,不能直接 falsy。
    const nowId = item.id == null ? '' : String(item.id);
    const boundId = ds.key == null ? '' : String(ds.key);
    if (!nowId.length || !boundId.length || nowId !== boundId) return;
    if (item._coverFail) return;
    this.setData({ [`${ds.list}[${idx}]._coverFail`]: true });
  },

  // 头牌 banner 不是列表,仍要用稳定 id 防止上一张图迟到的 error 标记到新头牌上。
  onDetailCoverError(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const target = ds.target;
    if (target !== 'banner') return;
    const info = this.data[target] || {};
    const currentId = info.id == null ? '' : String(info.id);
    const boundId = ds.key == null ? '' : String(ds.key);
    if (!currentId.length || !boundId.length || currentId !== boundId || info._coverFail) return;
    this.setData({ [`${target}._coverFail`]: true });
  },

  // ===== 头部入口(画板05 的头像入口 2026-09-19 已撤):搜索、铃铛=站内收件箱 =====
  /* CU-M-64:入口现在只搜模板。原来这里 (以及死代码 searchClick) 只是跳到通用搜索
     /pages/search2 —— 那里搜的是主题/活动/俱乐部/商家四类,一类都不是「节点玩法」,
     而入口写着「搜索节点玩法与主题」:按承诺搜的人走错搜索范围,还搜不到。 */
  goSearch() {
    modal.show({
      title: '搜索模板',
      editable: true,
      placeholderText: '输入主题或玩法名称',
      confirmText: '搜索',
      success: (res) => {
        if (!res || !res.confirm) return;
        const keyword = String(res.content || '').trim();
        if (!keyword) { cyToast('请输入要搜索的名称'); return; }
        this.startTemplateSearch(keyword);
      },
    });
  },
  goInbox() { wx.navigateTo({ url: '/subpackageB/pages/im/list/index' }); },

  // ===== 模板内搜索(2026-09-24 裁决 CU-M-64) =====
  /* 两个 tab 的缓存都作废再重取:玩法模板那一路的 keyword 是**服务端**过滤的
     (/api/template/list?keyword=,与列表页一样按 title 模糊),留着上一个词的响应会让
     清掉搜索后仍然只剩上次那几条;主题模板列表接口没有 keyword,按数据量在客户端按名称过
     (同一批数据本来一次取全,已单测)。 */
  startTemplateSearch(keyword) {
    this.setData({ searchKeyword: keyword });
    this._topicLoaded = false;
    this._gameLoaded = false;
    this.setData({ listLoaded: false, errorMsg: '', banner: {}, topList: [], tailList: [] });
    this.loadTab(this.data.tab);
  },
  clearTemplateSearch() {
    this.startTemplateSearch('');
  },

  // ===== 发布弹窗(cy-publish-sheet,唯一发布触发) =====
  openPublishSheet() {
    if (this.data.operationScope && !this.data.canManageMerchantProjects) {
      cyToast('当前岗位没有项目发布权限');
      return;
    }
    this.setData({ publishSheetShow: true });
  },
  closePublishSheet() { this.setData({ publishSheetShow: false }); },

  onUnload() {
    this._homeSeq = (this._homeSeq || 0) + 1;
    this._topicTemplateSeq = (this._topicTemplateSeq || 0) + 1;
    this._useTtSeq = (this._useTtSeq || 0) + 1;
    if (this.data.scrollStopTimer) {
      clearTimeout(this.data.scrollStopTimer);
    }
    if (this._ttNavigateTimer) {
      clearTimeout(this._ttNavigateTimer);
      this._ttNavigateTimer = null;
    }
    merchantTheme.merchantPageRestore();
  },

  onPageScroll(e) {
    const currentScrollTop = e.scrollTop || 0;
    const isScrollingDown = currentScrollTop > this.data.lastScrollTop;

    if (this.data.scrollStopTimer) {
      clearTimeout(this.data.scrollStopTimer);
    }

    if (isScrollingDown && currentScrollTop > 50 && this.data.tabBarRaised) {
      this.setData({ tabBarRaised: false });
    }

    const scrollStopTimer = setTimeout(() => {
      this.setData({ tabBarRaised: true });
    }, 300);

    this.setData({
      lastScrollTop: currentScrollTop,
      scrollStopTimer
    });
  },

  onHide() {
    merchantTheme.merchantPageRestore();
  },

  // 主题模板走 name 字段(主题推荐/最新主题走 title),两边共用同一套真实图标映射
  // ===== 两个实体各自的装饰 =====
  // 主题 = 一条路线(cms_topic):章节 / 节点 / 总时长
  // 游戏 = 一个地点上的一次互动(cms_template_library):人数 / 时长
  // ⚠️ 两组信息属于不同层级,同一张卡不可能两样都有真数据,所以分开装饰、分开列。
  decorateTopic(list) {
    return (isRecordList(list) ? list : []).map(function (item) {
      const chapter = Number(item.chapterCount || 0);
      const spot = Number(item.locationCount || 0);
      const meta = [];
      if (chapter) meta.push(chapter + ' 章');
      if (spot) meta.push(spot + ' 个点');
      const dur = formatDurationMinutes(item.totalTime);
      if (dur) meta.push(dur);
      return Object.assign({}, item, {
        _kind: 'topic',
        _title: item.name || '',
        _subText: item.subtitle || '',
        _metaText: meta.join(' · '),
        _statusText: item.previewOnly ? '实验预览' : (item.templateStatus === 'VERIFIED' ? '' : '实验模板'),
        _cats: String(item.categoryIds == null ? '' : item.categoryIds)
      });
    });
  },

  decorateGame(list) {
    return (isRecordList(list) ? list : []).map(function (item) {
      const meta = [];
      if (item.players) meta.push(item.players);
      const dur = formatDurationMinutes(item.duration);
      if (dur) meta.push(dur);
      return Object.assign({}, item, {
        _kind: 'game',
        _title: item.title || '',
        _subText: item.description || '',
        _metaText: meta.join(' · '),
        _iconUrl: INTERACTION_ICON_BY_TITLE[item.title || ''] || '',
        // 后端按 FIND_IN_SET(activity_categoryids) 过滤,前端置顶排序照抄同一个字段;
        // 不要拿 categoryId —— 那是另一列,两者并不同步。
        _cats: String(item.activityCategoryids == null ? '' : item.activityCategoryids)
      });
    });
  },

  // 品类命中:两个实体字段不同名但同形(逗号分隔多值),统一在 _cats 上判。
  hitCategory(item, categoryId) {
    if (!categoryId) return true;
    const raw = (item && item._cats) || '';
    if (!raw) return false;
    return raw.split(',').some(function (s) { return s.trim() === String(categoryId); });
  },

  // ===== 一个列表 + 置顶排序(不硬筛)=====
  // 库存少时筛选要退化成排序:硬筛下去大部分品类只剩一两张甚至空,比「点了没反应」更糟。
  // 等单类 ≥ 15 且稳定两周再把 tailList 收起来切硬筛 —— 那时这里不用改结构。
  rebuildLists() {
    const isTopic = this.data.tab === 'topic';
    const rows = isTopic ? this._topicRows : this._gameRows;
    const cat = this.data.activeCat;
    const that = this;
    /* CU-M-64:搜索关键词是硬筛(与品类那种「退化成置顶排序」不同) —— 搜「暗号」却把
       没命中的卡排在后面同样是错的。玩法那一路服务端已按 keyword 筛过,这里同口径再判一次
       (title 包含,大小写无关);主题模板接口没有 keyword,全靠这里。 */
    const keyword = String(this.data.searchKeyword || '').trim().toLowerCase();
    const matched = function (item) {
      if (!keyword) return true;
      return String(item._title || '').toLowerCase().indexOf(keyword) >= 0;
    };
    const top = [];
    const tail = [];
    (rows || []).forEach(function (item) {
      if (!matched(item)) return;
      (that.hitCategory(item, cat) ? top : tail).push(item);
    });
    const catName = this.categoryName(cat);
    // CU-M-116:横幅原本写 `top[0] || tail[0]`,分类一条没命中时就把**别的分类**的首项
    // 抬上来挂上「<分类名> · 精选」的标题 —— 那是把不属于这个分类的东西说成这个分类的精选。
    // 同时 `topList: cat ? top : top.slice(1)` 只在不选分类时把横幅项摘掉,选了分类就
    // 横幅 + 列表各出现一次,同一张卡同屏两遍。横幅只认分类命中的首项,列表一律去重。
    const banner = top[0] || {};
    const searching = !!keyword;
    this.setData({
      banner: banner,
      // activeCat=0 走运营编排,所以叫「推荐」不叫「全部」—— 叫全部会让用户
      // 以为看到了所有模板,找不到的东西会被当成不存在。
      bannerTitle: cat ? (catName + ' · 精选') : '推荐',
      topList: top.slice(1),
      tailList: cat ? tail : [],
      topTitle: searching
        ? ('搜索「' + this.data.searchKeyword + '」· ' + (top.length + tail.length) + ' 个')
        : (cat ? (catName + ' · ' + top.length + ' 个') : (isTopic ? '全部主题' : '全部玩法')),
      emptyTitle: searching ? '没有找到相关模板' : (isTopic ? '还没有可复用的主题模板' : '这个品类还没有玩法'),
      emptySub: searching
        ? '换个名称试试，或点上面的「清除」看全部模板'
        : (isTopic
          ? '新的整包主题开放后会出现在这里,也可以先去「游戏」里挑单个玩法'
          : '换个品类,或者看看「主题」里的整包路线')
    });
  },

  // 整对象写 home,不用 'home.categoryList' 动态路径 —— 动态路径要单独登记,
  // 而这里没有任何需要动态的理由(字段名是写死的)。
  applyCategoryList(list) {
    this.setData({
      home: Object.assign({}, this.data.home, {
        categoryList: isRecordList(list) ? list : []
      })
    });
  },

  categoryName(id) {
    if (!id) return '';
    const hit = (this.data.home.categoryList || []).filter(function (c) { return c.id === id; })[0];
    return hit ? (hit.categoryName || '') : '';
  },

  // 事件来自 cy-tabs(variant=attached),不是页面手写 tab —— §9 契约要求 tab 一律走组件。
  switchTab(e) {
    const tab = ((e.detail || {}).key === 'game') ? 'game' : 'topic';
    if (tab === this.data.tab) return;
    const loaded = tab === 'topic' ? this._topicLoaded : this._gameLoaded;
    // 切 tab 时 chips 换轴,选中回到「推荐」(轴都变了,沿用旧选中没有意义)。
    // listLoaded 跟当前 tab 的加载态走;目标 tab 没加载过就先把屏上的列表清掉 ——
    // 否则请求失败时错误态被 listLoaded 挡住,旧 tab 内容会一直冒充新 tab。
    if (loaded) {
      // loading 显式归 false:另一个 tab 的请求可能仍在途,它的 complete 只归自己的 tab 管
      //(见 loader),不显式清这里会留下一个游离的 loading:true。
      this.setData({ tab: tab, activeCat: 0, errorMsg: '', listLoaded: true, loading: false });
      this.rebuildLists();
    } else {
      this.setData({
        tab: tab, activeCat: 0, errorMsg: '', listLoaded: false,
        banner: {}, topList: [], tailList: []
      });
      this.loadTab(tab);
    }
  },

  // 品类切换纯前端重排,不发请求。原来每点一次品类都要重新拉一遍,
  // 拉回来的同一个数组还被切成四份显示成四个区块(同一批卡换四个标题)。
  switchCat(e) {
    const categoryId = Number((e.currentTarget.dataset || {}).id || 0);
    if (categoryId === this.data.activeCat) return;
    this.setData({ activeCat: categoryId });
    this.rebuildLists();
  },

  loadTab(tab) {
    if (tab === 'topic') this.getTopicTemplates();
    else this.getGameRows();
  },

  // 分类行的数据源仍走 homeData(它同时下发 categoryList),但只取 categoryList:
  // bannerList/recommendList/mustPlayList/latestList 是同一张表的四刀切,不再消费。
  getHome() {
    const that = this;
    const seq = (this._homeSeq || 0) + 1;
    this._homeSeq = seq;
    const fallback = function () {
      if (!that.isDevEnv()) return;
      const mock = mockData.getHomeData() || {};
      that.applyCategoryList(mock.categoryList);
    };
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/template/homeData',
      method: 'POST',
      data: {},
      success(res) {
        if (that._homeSeq !== seq) return;
        if (res.code == '200' && isTemplateHomePayload(res.data)) {
          that.applyCategoryList(res.data.categoryList);
        } else {
          // 品类拉不到不阻断:列表来自另外两个接口,没有分类行页面照常可用。
          fallback();
        }
      },
      fail() {
        if (that._homeSeq !== seq) return;
        fallback();
      }
    });
  },

  getGameRows() {
    const that = this;
    const seq = (this._gameSeq || 0) + 1;
    this._gameSeq = seq;
    this.setData({ loading: true, errorMsg: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/template/list',
      method: 'POST',
      // 置顶排序要在整份数据上算,所以一次取全 —— 后端 startPage() 默认只给 10 条。
      // 现存玩法约 27 个,200 有余量;真长到接近这个数要改成分页 + 服务端排序。
      // CU-M-64:带上关键词 —— /api/template/list 的 keyword 就是按 title 模糊(与列表同一口径)。
      data: { pageNum: 1, pageSize: 200, keyword: this.data.searchKeyword || '' },
      success(res) {
        if (that._gameSeq !== seq) return;
        const rows = res && res.data ? (res.data.rows || res.data) : null;
        if (res.code == '200' && isRecordList(rows)) {
          that._gameRows = that.decorateGame(rows);
          that._gameLoaded = true;
          // 回来时用户可能已切去主题 tab:数据照收进缓存,但屏幕状态只归当前 tab 管,
          // 否则会把还没加载的主题 tab 标成已加载,空缓存渲染成假空态。
          if (that.data.tab === 'game') {
            that.setData({ listLoaded: true, errorMsg: '' });
            that.rebuildLists();
          }
        } else if (that.data.tab === 'game') {
          // 失败半边同样只归当前 tab 管:主题 tab 在途时游戏的迟到失败不许把
          // 错误文案画到主题的错误卡上。没画上也不丢——_gameLoaded 仍是 false,
          // 切回游戏 tab 会重新加载。
          that.setData({ errorMsg: app.getRequestErrorMessage(res, '玩法模板加载失败') });
        }
      },
      fail(res) {
        if (that._gameSeq !== seq || that.data.tab !== 'game') return;
        that.setData({ errorMsg: app.getRequestErrorMessage(res, '玩法模板加载失败') });
      },
      complete() {
        // tab 闸防掐掉另一 tab 在途的骨架屏;切去已加载 tab 的 loading 由 switchTab 显式清。
        if (that._gameSeq === seq && that.data.tab === 'game') that.setData({ loading: false });
      }
    });
  },

  retryTemplateLoad() {
    this.setData({ errorMsg: '' });
    this.loadTab(this.data.tab);
  },

  // 主操作按实体分流:主题 = 简易发布器(一条路线怎么走由作者说了算),
  // 游戏 = 节点配置页(一个地点上的一次互动,商家要改成本店的题面与答案)。
  primaryAction(e) {
    const item = (e.currentTarget.dataset || {}).item || {};
    if (item._kind === 'topic') { this.goTopicConfig(e); return; }
    this.goGameConfig(e);
  },

  jumpDetail(e) {
    const item = ((e && e.currentTarget && e.currentTarget.dataset) || {}).item || {};
    if (item.previewOnly) {
      cyToast('这是预览模板，保存后才能查看');
      return;
    }
    // 主题与玩法是两种实体:主题直接进入既有配置入口；玩法进入既有详情页。
    if (item._kind === 'topic') { this.goTopicConfig(e); return; }
    if (!item.id) return;
    wx.navigateTo({ url: '/pages/templatedetail/templatedetail?id=' + item.id });
  },

  // ===== 主题模板货架(/api/template/topic-template) =====
  applyDevTopicPreview() {
    if (!this.isDevEnv()) return;
    this._topicRows = this.decorateTopic(mockData.getTopicTemplates());
    this._topicLoaded = true;
    if (this.data.tab !== 'topic') return;
    this.setData({ listLoaded: true, errorMsg: '' });
    this.rebuildLists();
  },

  getTopicTemplates() {
    const that = this;
    const seq = (this._topicTemplateSeq || 0) + 1;
    this._topicTemplateSeq = seq;
    this.setData({ loading: true, errorMsg: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/template/topic-template/list',
      method: 'POST',
      data: {},
      success(res) {
        if (that._topicTemplateSeq !== seq) return;
        if (res.code == '200' && isRecordList(res.data)) {
          if (res.data.length || !that.isDevEnv()) {
            that._topicRows = that.decorateTopic(res.data);
            that._topicLoaded = true;
            // 同 getGameRows:缓存照收,屏幕状态只归当前 tab 管
            if (that.data.tab === 'topic') {
              that.setData({ listLoaded: true, errorMsg: '' });
              that.rebuildLists();
            }
          } else {
            that.applyDevTopicPreview();
          }
        } else {
          if (that.isDevEnv()) that.applyDevTopicPreview();
          else if (that.data.tab === 'topic') {
            // 同 getGameRows:失败半边只归当前 tab 管,迟到失败不画到别的 tab 上
            that.setData({ errorMsg: app.getRequestErrorMessage(res, '主题模板加载失败') });
          }
        }
      },
      fail(res) {
        if (that._topicTemplateSeq !== seq) return;
        if (that.isDevEnv()) that.applyDevTopicPreview();
        else if (that.data.tab === 'topic') {
          that.setData({ errorMsg: app.getRequestErrorMessage(res, '主题模板加载失败') });
        }
      },
      complete() {
        // 同 getGameRows:tab 闸防掐掉另一 tab 在途的骨架屏
        if (that._topicTemplateSeq === seq && that.data.tab === 'topic') that.setData({ loading: false });
      }
    });
  },

  // 只读岗位没有创建/配置权:入口本来就不渲染,这里是第二道闸(分享链接、旧页面栈也能进来)。
  _blockedByScope() {
    if (this.data.operationScope && !this.data.canManageMerchantProjects) {
      cyToast('当前岗位仅可浏览模板');
      return true;
    }
    return false;
  },

  // ===== 主题模板 · 配置 → 简易发布器 =====
  // 2026-08-27 把普通主题收敛到同一个去处 —— 货架上「配置」只能有一个含义。
  // 带上模板名当 AI 起草的初始想法:不带的话简易发布器是一张白纸,
  // 点「配置 XX 主题」却什么都没带过去,等于把模板扔了。
  // 主题模板 = 整包复制成草稿，进专业编辑器配章节/节点/票种。
  // 不能只把名字塞进简易 AI：那会丢掉模板结构。
  goTopicConfig(e) {
    if (this._blockedByScope()) return;
    // B-05:后端每次调用都整包复制出新主题草稿,连点两下就是两份。
    // 没有幂等键,就先在客户端把在途点击挡住,成功/失败都放行下一次。
    if (this._usingTemplate) {
      cyToast('正在配置，请稍候');
      return;
    }
    const item = ((e && e.currentTarget && e.currentTarget.dataset) || {}).item || {};
    if (item.previewOnly) {
      cyToast('这是预览模板，保存后才能配置');
      return;
    }
    const id = item.id;
    if (!id) return;
    const that = this;
    this._usingTemplate = true;
    app.sendRequest({
      url: '/api/template/topic-template/use',
      method: 'POST',
      data: { id: id, scope: this.data.operationScope },
      success(res) {
        that._usingTemplate = false;
        const copiedId = res && res.code == '200' && res.data && res.data.topicId;
        if (!copiedId) {
          cyToast((res && res.msg) || '使用模板失败');
          return;
        }
        const qs = ['id=' + copiedId];
        if (that.data.operationScope) qs.push('scope=' + that.data.operationScope);
        wx.navigateTo({ url: '/pages/publish/fabu/index?' + qs.join('&') });
      },
      fail() {
        that._usingTemplate = false;
        cyToast('网络错误，请重试');
      }
    });
  },

  // ===== 游戏模板 · 配置 → 节点配置页 =====
  // 以前要「查看」→ 半屏阅览 →「查看此模板」→ 详情页 →「开始应用」四步才摸得到这一页。
  goGameConfig(e) {
    if (this._blockedByScope()) return;
    const item = ((e && e.currentTarget && e.currentTarget.dataset) || {}).item || {};
    if (item.previewOnly) {
      cyToast('这是预览模板，保存后才能配置');
      return;
    }
    if (!item.id) return;
    analytics.track('template_reuse', { bizType: 'template', bizId: item.id });
    wx.navigateTo({ url: '/pages/publish/temp/index?id=' + item.id });
  },

  // 整包复制成我的草稿,章节/节点/玩法在「我的项目 → 编辑」里看和配。
  // 2026-08-30 用户裁决:货架卡片上不再放任何按钮;玩法点卡直达现有详情页,
  // 主题因不是同一实体、没有共用详情路由,直达既有简易发布器。
  // 本方法因此在本页 WXML 上没有绑定点;保留是因为它带着「圈层不得整包复制」与只读岗位两道闸,
  // 详情页要接这条动作时直接复用 —— 删掉等于把闸一起删了。
  useTt(e) {
    if (this._ttUsing) return;
    if (this._blockedByScope()) return;
    const item = (e.currentTarget.dataset || {}).item || {};
    if (item.previewOnly) {
      cyToast('这是预览模板，试走验证后才能用');
      return;
    }
    const id = item.id;
    if (!id) return;
    const that = this;
    const seq = (this._useTtSeq || 0) + 1;
    this._useTtSeq = seq;
    this.data.ttUseRetryItem = null;
    this._ttUsing = true;
    this.setData({ ttUseError: '' });
    app.sendRequest({
      url: '/api/template/topic-template/use',
      method: 'POST',
      data: { id: id, scope: this.data.operationScope },
      success(res) {
        if (that._useTtSeq !== seq) return;
        if (res.code == '200') {
          that.data.ttUseRetryItem = null;
          that.setData({ ttUseError: '' });
          cyToast.success('已生成我的草稿');
          // 草稿落在「我的项目·主题」tab,toast 露脸后再跳
          that._ttNavigateTimer = setTimeout(function () {
            that._ttNavigateTimer = null;
            if (that._useTtSeq !== seq) return;
            wx.navigateTo({ url: '/subpackageA/pages/myproject/index'
              + (that.data.operationScope ? '?scope=MERCHANT' : '') });
          }, 600);
        } else {
          that.data.ttUseRetryItem = item;
          that.setData({
            ttUseError: app.getRequestErrorMessage(res, '使用模板失败')
          });
        }
      },
      fail(res) {
        if (that._useTtSeq !== seq) return;
        that.data.ttUseRetryItem = item;
        that.setData({
          ttUseError: app.getRequestErrorMessage(res, '使用模板失败')
        });
      },
      complete() {
        if (that._useTtSeq !== seq) return;
        that._ttUsing = false;
      }
    });
  },

  retryUseTt() {
    const item = this.data.ttUseRetryItem;
    if (!item) return;
    this.useTt({ currentTarget: { dataset: { item } } });
  },

});
