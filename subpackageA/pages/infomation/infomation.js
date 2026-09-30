const { getScene } = require('../../../utils/scene-registry.js');
const app = getApp();
const mockData = require('../../../utils/mockData.js');
const policy = require('../../../utils/identity/identity-policy.js');
const merchantTheme = require('../../../utils/merchant-theme.js');

// 「城瘾玩法」说明书:三种玩法各自讲清楚 + 各自跳到真实入口,下面挂一小段现成玩法。
// ⚠️ 这页是**说明书**不是模板市场:现成玩法只取前 MAX_TEMPLATES 个、不分页、不做筛选,
//    要看全的走 goTemplateSquare → 发布广场 tab。
const MAX_TEMPLATES = 6;

/**
 * 三种玩法的真实入口(2026-08-01 全仓核实,不是拍脑袋填的路径):
 *  · 经典定向 / 自由定向 —— 两者都是 topic 的 productType(1/2),源码里**没有**任何按
 *    productType 过滤的浏览列表(/api/topic/list 无该入参),玩家实际都在首页主题 feed
 *    里翻;所以两张卡都落首页,差别写在文案里,不假造一个不存在的筛选页。
 *  · 漫游 —— pages/roam/index,自己就是 tabBar 页,进去即玩。
 * 三个目标都是 tabBar 页 ⇒ 只能 switchTab,navigateTo 会直接失败。
 */
const MODES = [
  {
    key: 'classic',
    name: '城市定向',
    tag: '组队 · 按顺序',
    icon: 'flag',
    desc: '按顺序打卡通关,到点了大家一起出发。适合约人、适合有剧情的路线。',
    target: '/pages/index/index',
  },
  {
    key: 'free',
    name: '自由探索',
    tag: '随时 · 自己走',
    icon: 'route',
    desc: '点位全开,想从哪个开始都行。买张通行证随时开玩,不用等人凑齐。',
    target: '/pages/index/index',
  },
  {
    key: 'roam',
    name: '漫游',
    tag: '无终点 · 散步',
    icon: 'gps',
    desc: '边走边点亮城市迷雾,没有任务也没有终点。顺路散个步也算数。',
    target: '/pages/roam/index',
  },
];

/**
 * 后端数据契约:CmsInfomation{ id, title, subtitle, sortId, contents }
 * (ApiCommonController#infomationList → selectCmsInfomationList;Mapper 的 select 含 contents)
 *
 * 只做由契约直接推出的事,**从不伪造标题**:
 *  1) subtitle 与 title 逐字相同 ⇒ 不作为摘要渲染。把同一个值印两遍信息量为零。
 *  2) usable 判三条:
 *     a. title 为空          → 列表上没有可读锚点
 *     b. contents 为空       → 点进详情是空正文
 *     c. **标题是纯数字,且没有任何能区分它的副标题** → 无有效用户可读标题
 *        (C03-R2 真实图上剩下的那个可点「11」就是这一类)
 *
 * ⚠️ (c) 绝不是「过滤数字」。判据是「纯数字 **且** 无区分信息」,所以:
 *      title='11'   subtitle='11'            → 不可读(线上那行)
 *      title='11'   subtitle=''              → 不可读
 *      title='2024' subtitle='年度城市定向回顾' → **保留**(数值命名 + 有效副标题)
 *      title='11'   subtitle='新手上路指南'     → **保留**(副标题给了语义)
 *      title='72小时城市漫游' / '11 号线沿线玩法' → **保留**(非纯数字)
 *    标题脏本身属运营侧清理;前端只负责不把「无从辨认的条目」做成可点死链。
 */
function normalizeInfomationList(rows) {
  const text = (v) => (v == null ? '' : String(v)).trim();
  return (Array.isArray(rows) ? rows : []).map((it) => {
    const title = text(it && it.title);
    const subtitle = text(it && it.subtitle);
    const hasBody = text(it && it.contents) !== '';
    // 纯数字标题 + 没有可区分的副标题 = 用户无从辨认这条是什么
    const numericOnlyTitle = /^\d+$/.test(title);
    const noDistinguishingSubtitle = subtitle === '' || subtitle === title;
    const unreadableTitle = numericOnlyTitle && noDistinguishingSubtitle;
    return {
      id: it && it.id,
      title,
      description: subtitle && subtitle !== title ? subtitle : '',
      usable: title !== '' && hasBody && !unreadableTitle,
    };
  });
}

// 现成玩法卡要的字段:封面 / 名称 / 简介 / 已玩次数。
// useNum 缺失时不编数字,直接不显示那一行 —— 「已玩 0 次」和「没这个数据」是两回事。
function normalizeTemplates(rows) {
  const text = (v) => (v == null ? '' : String(v)).trim();
  return (Array.isArray(rows) ? rows : [])
    .map((it) => {
      const title = text(it && (it.title || it.name));
      const used = Number(it && it.useNum);
      return {
        id: it && it.id,
        title,
        imgUrl: text(it && it.imgUrl),
        description: text(it && it.description),
        _initial: title.charAt(0) || '玩',
        _usedText: Number.isFinite(used) && used > 0 ? '已玩 ' + used + ' 次' : '',
      };
    })
    .filter((it) => it.id != null && it.title !== '')
    .slice(0, MAX_TEMPLATES);
}

Page({
  data: {
    sceneStack: [],
    sceneCurrent: null,
    isMerchantView: false,
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    modes: MODES,
    templates: [],
    tplLoading: true,
    tplError: '',
    list: [],
    nodata: false,
    docsState: 'loading',
    docsError: '',
  },
  blockSceneTouch() {},
  closeScene() {
    this.setData({ sceneStack: [], sceneCurrent: null });
  },

  onLoad() {
    this.syncViewTheme();
    this.loadTemplates();
    this.getList();
  },

  onShow() { this.syncViewTheme(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  syncViewTheme() {
    const isMerchantView = policy.isMerchantView({
      role: wx.getStorageSync('role'),
      userType: wx.getStorageSync('user_type'),
      debugView: wx.getStorageSync('debug_user_view'),
    });
    this.setData({ isMerchantView });
    if (isMerchantView) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
  },

  // 栈首(被详情页 redirectTo 落过来,或深链直达)时 navigateBack 会失败。
  // 回落到源码里唯一真实 caller shezhi.js:93 所在的设置页;设置页自身已有 member tab 兜底,
  // 于是「详情 → 列表 → 设置 → tab」整链有最终出口,不会把用户停在某一层。
  onBack() {
    wx.navigateBack({ fail() { wx.redirectTo({ url: '/pages/shezhi/shezhi' }); } });
  },

  // 三种玩法 → 各自真实入口。三个目标都是 tabBar 页,必须 switchTab。
  goMode(e) {
    const key = e.currentTarget.dataset.key;
    const mode = MODES.filter((m) => m.key === key)[0];
    if (!mode) return;
    wx.switchTab({ url: mode.target });
  },

  goTemplateDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (id == null || id === '') return;
    wx.navigateTo({ url: '/pages/templatedetail/templatedetail?id=' + id });
  },

  // 完整玩法列表在发布广场(tabBar 页),本页只做精选入口
  goTemplateSquare() {
    wx.switchTab({ url: '/pages/template/index' });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    const scene = getScene('settings-how-to-play-detail', { id: id });
    if (!scene) return;
    scene.theme = this.data.isMerchantView ? 'merchant' : 'player';
    this.setData({ sceneStack: [scene], sceneCurrent: scene });
  },

  // 现成玩法取 /api/template/homeData 的热门榜(与发布广场同一个数据源);
  // 热门为空时退到推荐/必玩,三个都空才算真空态。
  loadTemplates() {
    const that = this;
    that.setData({ tplLoading: true, tplError: '' });
    app.sendRequest({
      hideLoading: true,
      url: '/api/template/homeData',
      method: 'POST',
      data: {},
      success(res) {
        if (res.code == '200' && res.data) {
          that.applyTemplates(res.data);
          return;
        }
        if (app.isDevEnv && app.isDevEnv()) {
          that.applyTemplates(mockData.getHomeData());
          return;
        }
        that.setData({
          templates: [],
          tplError: app.getRequestErrorMessage(res, '现成玩法加载失败'),
        });
      },
      fail(res) {
        if (app.isDevEnv && app.isDevEnv()) {
          that.applyTemplates(mockData.getHomeData());
          return;
        }
        that.setData({
          templates: [],
          tplError: app.getRequestErrorMessage(res, '现成玩法加载失败'),
        });
      },
      complete() {
        that.setData({ tplLoading: false });
      },
    });
  },

  applyTemplates(data) {
    const d = data || {};
    const pool = (d.hotList && d.hotList.length && d.hotList)
      || (d.recommendList && d.recommendList.length && d.recommendList)
      || d.mustPlayList
      || [];
    this.setData({ templates: normalizeTemplates(pool), tplError: '' });
  },

  // 玩法文档(CMS):说明书主体不依赖它,所以它自己空/失败都不影响上面三张玩法卡,
  // 但空态必须显式渲染 —— nodata 曾经只在 JS 里算、WXML 从不消费(C03-R1 修过,别回退)。
  getList() {
    const that = this;
    that.setData({ docsState: 'loading', docsError: '', nodata: false });
    app.sendRequest({
      hideLoading: true,
      url: '/api/common/infomation_list',
      method: 'POST',
      data: { pageNum: 1, pageSize: app.getPageSize() },
      success(res) {
        if (res && res.code == '200' && Array.isArray(res.data)) {
          const list = normalizeInfomationList(res.data);
          that.setData({
            list,
            nodata: list.length < 1,
            docsState: list.length ? 'ready' : 'empty',
            docsError: '',
          });
          return;
        }
        that.setData({
          docsState: 'error',
          docsError: app.getRequestErrorMessage(res, '玩法文档加载失败'),
          nodata: false,
        });
      },
      fail(res) {
        that.setData({
          docsState: 'error',
          docsError: app.getRequestErrorMessage(res, '玩法文档加载失败'),
          nodata: false,
        });
      },
      successStatusAbnormal() {
        that.setData({ docsState: 'error', docsError: '玩法文档暂时不可用，请稍后重试', nodata: false });
      },
      // 保留请求生命周期钩子，便于旧客户端/测试在 complete 后统一收尾；终态只由上面三路决定。
      complete() {},
    });
  },
});
