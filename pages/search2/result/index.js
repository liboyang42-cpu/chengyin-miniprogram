// 搜索结果独立页(2026-07-31):原来搜索输入后结果直接铺在 search2 同页下方,
// 现改成跳转到这里 —— 逻辑从 pages/search2/index.js 的 runSearch/updateVisibleResults 搬来,
// 数据源仍是同一个 utils/discover-search.js。
const toast = require('../../../utils/toast.js');
const app = getApp();
const discoverSearch = require('../../../utils/discover-search.js');
const { openScene } = require('../../../utils/scene-entry.js');
const DEFAULT_RESULT_TABS = [{ key: 'all', label: '全部' }];

Page({
  data: {
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    keyword: '',
    categoryId: null,
    searchLoading: false,
    showSearchSkeleton: false,
    searchError: '',
    // 出过结果没有。只用来判 auto-back:首屏搜索失败才自动退页,
    // 页内改关键词再搜的失败留在页内,别把用户刚打的词一起退掉(审查C A1)。
    everLoaded: false,
    activeResultType: 'all',
    resultTabs: DEFAULT_RESULT_TABS,
    resultGroups: [],
    visibleResults: []
  },

  onLoad(options) {
    const keyword = options.keyword ? decodeURIComponent(options.keyword) : '';
    const categoryId = options.categoryId || null;
    this._filters = {
      startDate: options.startDate ? decodeURIComponent(options.startDate) : '',
      endDate: options.endDate ? decodeURIComponent(options.endDate) : '',
      minPrice: options.minPrice != null && options.minPrice !== '' ? Number(options.minPrice) : null,
      maxPrice: options.maxPrice != null && options.maxPrice !== '' ? Number(options.maxPrice) : null,
      // CU-M-66:入口页的排序选择必须活到请求里。四类里只有 /api/activity/list 有 sort_type,
      // 其余三类后端没有排序参数(buildRequests 只把它给 activity)。
      sortType: options.sortType ? String(options.sortType) : '',
    };
    this.setData({ keyword, categoryId });
    this.runSearch();
  },

  onKeywordInput(e) {
    this.setData({ keyword: (e.detail && e.detail.value) || '' });
  },

  onSearchConfirm() {
    const keyword = String(this.data.keyword || '').trim();
    this.setData({ keyword: keyword }, () => this.runSearch());
  },

  onUnload() {
    this._searchSeq = (this._searchSeq || 0) + 1;
    if (this._searchSkeletonTimer) clearTimeout(this._searchSkeletonTimer);
  },

  runSearch() {
    const { keyword, categoryId } = this.data;
    const filters = this._filters || {};
    const requests = discoverSearch.buildRequests(keyword, categoryId, filters);
    const queryKey = String(keyword || '').trim() + '::' + String(categoryId || '')
      + '::' + String(filters.startDate || '') + '::' + String(filters.endDate || '')
      + '::' + String(filters.minPrice || '') + '::' + String(filters.maxPrice || '')
      + '::' + String(filters.sortType || '');
    const preserveExisting = this._resultQueryKey === queryKey
      && (this.data.resultGroups || []).some((group) => (group.items || []).length > 0);
    const previousGroups = {};
    if (preserveExisting) (this.data.resultGroups || []).forEach((group) => { previousGroups[group.type] = group.items || []; });
    const seq = (this._searchSeq || 0) + 1;
    this._searchSeq = seq;
    const groupsByType = {};
    let pending = requests.length;
    let failed = 0;

    if (this._searchSkeletonTimer) clearTimeout(this._searchSkeletonTimer);

    if (preserveExisting) {
      this.setData({ searchLoading: true, showSearchSkeleton: false, searchError: '' });
    } else {
      this.setData({ searchLoading: true, showSearchSkeleton: false, searchError: '', activeResultType: 'all', resultTabs: DEFAULT_RESULT_TABS, resultGroups: [], visibleResults: [] });
      if (requests.length) {
        this._searchSkeletonTimer = setTimeout(() => {
          if (this._searchSeq === seq && this.data.searchLoading && !this.data.visibleResults.length) {
            this.setData({ showSearchSkeleton: true });
          }
        }, 400);
      }
    }

    const finish = () => {
      pending -= 1;
      if (pending > 0 || this._searchSeq !== seq) return;
      if (this._searchSkeletonTimer) clearTimeout(this._searchSkeletonTimer);
      const resultGroups = requests.map((request) => ({
        type: request.type,
        label: discoverSearch.TYPE_META[request.type].label,
        items: Object.prototype.hasOwnProperty.call(groupsByType, request.type) ? groupsByType[request.type] : (previousGroups[request.type] || [])
      }));
      const hasResults = resultGroups.some((group) => group.items.length > 0), allFailed = failed === requests.length; this._resultQueryKey = hasResults || failed === 0 ? queryKey : this._resultQueryKey;
      this.setData({
        searchLoading: false,
        showSearchSkeleton: false,
        everLoaded: this.data.everLoaded || hasResults,
        searchError: failed > 0 && !hasResults
          ? (allFailed ? '搜索服务暂时不可用，请重试' : '部分搜索没有完成，请重试后再确认结果')
          : '',
        resultGroups: resultGroups,
        resultTabs: DEFAULT_RESULT_TABS.concat(resultGroups.map((group) => ({
          key: group.type,
          label: group.label + ' ' + group.items.length
        })))
      });
      this.updateVisibleResults();
      if (failed > 0 && hasResults) toast('部分搜索没有完成，结果可能不全');
    };

    if (!requests.length) {
      this._resultQueryKey = queryKey; this.setData({ searchLoading: false, showSearchSkeleton: false }); return; }

    requests.forEach((request) => {
      app.sendRequest({
        hideLoading: true,
        autoErrorToast: false,   // 多路并发各自 toast 会连弹;全失败由 auto-back 半屏讲,部分失败在 finish 里报一次
        url: request.url,
        method: 'POST',
        auth: request.auth,
        data: request.data,
        header: request.header,
        success: (res) => {
          if (res && (res.code == 200 || res.code == '200')) {
            groupsByType[request.type] = discoverSearch.decorateRows(request.type, res.data, filters);
            if (request.type === 'merchant' || request.type === 'club') {
              groupsByType[request.type].forEach((item) => {
                item.cardCover = app.getImgUrl(item.cardCover);
                item.cardLogo = app.getImgUrl(item.cardLogo);
                if (item.clubCard) {
                  item.clubCard.coverUrl = app.getImgUrl(item.clubCard.coverUrl);
                  item.clubCard.logoUrl = app.getImgUrl(item.clubCard.logoUrl);
                }
              });
            }
          } else {
            failed += 1;
          }
          finish();
        },
        fail: () => {
          failed += 1;
          finish();
        }
      });
    });
  },

  updateVisibleResults() {
    const type = this.data.activeResultType;
    const groups = this.data.resultGroups || [];
    const visibleResults = groups.reduce((all, group) => {
      return type === 'all' || group.type === type ? all.concat(group.items) : all;
    }, []);
    this.setData({ visibleResults: visibleResults });
  },

  onResultTab(e) {
    this.setData({ activeResultType: e.detail.key }, () => this.updateVisibleResults());
  },

  goResult(e) {
    const sceneId = e.currentTarget.dataset.sceneId;
    const id = e.currentTarget.dataset.id;
    if (sceneId) {
      openScene(sceneId, { id });
      return;
    }
    const path = e.currentTarget.dataset.path;
    // 商家结果没绑会员主体时拼不出主页地址 —— 点了没反应会被当成卡死,给一句话
    if (path) wx.navigateTo({ url: path });
    else toast('这条结果暂不可打开');
  }
});
