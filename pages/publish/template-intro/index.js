// 创建节点玩法 · 第0页(价值主张)
//
// 位置:publish-sheet 卡2 →【本页】→ templateadd(命名)→ temp(编辑器)
// 引导、命名、编辑器各保留一层页面栈:用户在编辑器返回时先回命名,再回引导,
// 不会因为 redirectTo 连续替换页面而直接掉回发布首页。
// "跳过"和"开始创建"走同一个出口,差别只在埋点语义。
//
// 卡片数据取真实接口 /api/template/homeData 的精选/热门前 3 条,不写死图片:
// 拿不到就少画几张甚至不画(见 wxml 的 cards.length 闸),不塞假模板冒充现网内容。
const app = getApp();
const { readReducedMotion } = require('../../../utils/motion-preference.js');
const { isRecordList } = require('../../../utils/response-shape.js');

// 三张卡的品类强调色。参考图是彩色品类卡,本页是深底引导页的既定例外
// (按任务书:深色底允许、卡片可带品类色,但按钮仍走黑白系)。
// 放 JS 是因为要按数据条数逐张绑定,wxss 无法按索引取值。
const CARD_ACCENTS = ['#E8536B', '#18B5A0', '#F0B429'];

Page({
  data: {
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    reducedMotion: false,
    cards: [],
    cardsLoading: true,
    cardsError: '',
    navigating: false,
    navigationError: '',
    operationScope: '',
  },

  onLoad(options) {
    this.setData({ operationScope: options && options.scope === 'MERCHANT' ? 'MERCHANT' : '' });
    this.loadCards();
  },

  onShow() {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
  },

  loadCards() {
    if (this._cardsRequestInFlight) return;
    const that = this;
    const token = (this._cardsRequestToken || 0) + 1;
    this._cardsRequestToken = token;
    this._cardsRequestInFlight = true;
    this.setData({ cardsLoading: !this.data.cards.length, cardsError: '' });
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/template/homeData',
      method: 'POST',
      data: {},
      success(res) {
        if (token !== that._cardsRequestToken) return;
        if (!res || res.code != '200' || !res.data || typeof res.data !== 'object' || Array.isArray(res.data)) {
          that._showCardsError(app.getRequestErrorMessage
            ? app.getRequestErrorMessage(res, '精选示例加载失败，请重试')
            : '精选示例加载失败，请重试');
          return;
        }
        if (!that.applyCards(res.data)) {
          that._showCardsError('精选示例加载失败，请重试');
        }
      },
      fail() {
        if (token !== that._cardsRequestToken) return;
        that._showCardsError('精选示例加载失败，请重试');
      },
      complete() {
        if (token !== that._cardsRequestToken) return;
        that._cardsRequestInFlight = false;
        that.setData({ cardsLoading: false });
      },
    });
  },

  applyCards(d) {
    const lists = ['recommendList', 'hotList', 'latestList'];
    if (lists.some((key) => d[key] != null && !isRecordList(d[key]))) return false;
    const pool = (isRecordList(d.recommendList) && d.recommendList.length ? d.recommendList
      : (isRecordList(d.hotList) && d.hotList.length ? d.hotList
        : (isRecordList(d.latestList) ? d.latestList : [])));
    if (pool.some((it) => it.sysCategoryList != null && !isRecordList(it.sysCategoryList))) return false;
    const cards = pool.slice(0, 3).map((it, i) => {
      const cat = (it.sysCategoryList || [])[0] || {};
      return {
        id: it.id,
        key: it.id == null ? `example-${i}` : `example-${it.id}`,
        title: it.title || it.name || '',
        imgUrl: it.imgUrl || '',
        catName: cat.categoryName || '节点玩法',
        accent: CARD_ACCENTS[i % CARD_ACCENTS.length],
      };
    });
    this.setData({ cards, cardsError: '' });
    return true;
  },

  _showCardsError(message) {
    // 已有旧内容:刷新失败静默降级,旧示例留在屏上。
    if (this.data.cards.length) return;
    this.setData({ cardsError: message });
  },

  // 跳过 / 开始创建:同一出口。保留本页,让后续返回仍有可预期的上一步。
  goCreate() {
    if (this.data.navigating) return;
    this.setData({ navigating: true, navigationError: '' });
    // navigateTo 而非 redirectTo:引导页必须留在栈里,否则编辑器连按两次返回会
    // 直接掉回发布首页(publish-editor-return-flow 合同)。
    wx.navigateTo({
      url: '/pages/publish/templateadd/templateadd'
        + (this.data.operationScope ? '?scope=MERCHANT' : ''),
      // CU-M-31:成功也要放闸 —— 本页留在栈里,从创建页返回后 navigating 还是 true,
      // 「跳过」「开始创建」会被 early-return 挡死且按钮永远转圈。
      success: () => this.setData({ navigating: false }),
      fail: () => this.setData({ navigating: false, navigationError: '创建页面没有打开，请重试' }),
    });
  },
  onSkip() { this.goCreate(); },
});
