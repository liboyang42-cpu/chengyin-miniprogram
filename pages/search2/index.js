const toast = require('../../utils/toast.js');
const app = getApp();
const { isRecordList } = require('../../utils/response-shape.js');
const { HISTORY_MAX, normalizeSearchHistory, searchHistoryStorageKey } = require('./utils/search-history.js');
// CU-M-63:固定推荐位常量迁进 utils(原来写死在页面 data 里),并随注释说清它不是什么
const { SEARCH_HOT_WORDS } = require('./utils/hot-words.js');
const { resolveCategoryIcon } = require('../../utils/category-icon.js');

const LEGACY_HISTORY_KEY = 'search2_history';
const DATE_YEARS = Array.from({ length: 81 }, (_, index) => 1970 + index);
const DATE_MONTHS = Array.from({ length: 12 }, (_, index) => index + 1);

function dateDays(year, month) {
  return Array.from({ length: new Date(year, month, 0).getDate() }, (_, index) => index + 1);
}

function isDateValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '');
}

function pickerState(value) {
  const now = new Date();
  const source = isDateValue(value) ? value.split('-').map(Number) : [now.getFullYear(), now.getMonth() + 1, now.getDate()];
  const year = Math.min(2050, Math.max(1970, source[0]));
  const month = Math.min(12, Math.max(1, source[1]));
  const days = dateDays(year, month);
  const day = Math.min(days.length, Math.max(1, source[2]));
  return { days, value: [year - 1970, month - 1, day - 1] };
}

function formatPickerDate(yearIndex, monthIndex, dayIndex) {
  const year = DATE_YEARS[yearIndex];
  const month = DATE_MONTHS[monthIndex];
  const day = dayIndex + 1;
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

Page({
  data: {
    searchHistory: [],
    // 搜索相关
    searchKeyword: '',
    activeHotKey: -1,
    activeCategory: null,
    
    // 原有数据保持不变
    // 推荐搜索(固定运营位,不是个性化/聚合——见 utils/hot-words.js 表头)
    hotkeys: SEARCH_HOT_WORDS.slice(),
    categoryList: [],
    categoryLoading: false,
    categoryError: '',

    // 筛选弹窗
    popVisible: false,
    startdate: '开始日期',
    enddate: '结束日期',
    dateSheetVisible: false,
    datePickerField: 'startdate',
    datePickerTitle: '选择开始日期',
    datePickerYears: DATE_YEARS,
    datePickerMonths: DATE_MONTHS,
    datePickerDays: dateDays(new Date().getFullYear(), new Date().getMonth() + 1),
    datePickerValue: [new Date().getFullYear() - 1970, new Date().getMonth(), new Date().getDate() - 1],
    jg1: "¥0",
    jg2: "¥1000",
    activeDate: '0',
    activeSort: '1',
    
    // 价格滑块
    minPrice: 0,
    maxPrice: 1000,
    minPercent: 0,
    maxPercent: 100,
    priceRange: {
      min: 0,
      max: 1000
    },
    sliderRangeStyle: 'left: 00%; right: 0%;',
    minHandleStyle: 'left: 0%;',
    maxHandleStyle: 'left: 100%;',
    
    // 筛选条件
    filterConditions: {
      keyword: '',
      categoryId: null,
      dateType: '2',
      startDate: '',
      endDate: '',
      minPrice: 0,
      maxPrice: 1000,
      sortType: '1'
    }
  },

  // 关键词输入
  onKeywordInput(e) {
    const keyword = e.detail.value;
    this.setData({
      searchKeyword: keyword,
      activeHotKey: -1,
      filterConditions: {
        ...this.data.filterConditions,
        keyword: keyword
      }
    });
  },

  // 输入框确认搜索（回车事件）
  onSearchConfirm() {
    this.navigateToSearchList();
  },

  // 2026-07-31:结果不再铺在本页下方，跳转到独立的搜索结果页
  navigateToSearchList() {
    const { searchKeyword, filterConditions } = this.data;
    const keyword = searchKeyword.trim();
    if (!keyword && !filterConditions.categoryId) {
      toast('请输入关键词或选择类别');
      return;
    }

    // 所有搜索出口(回车/热词/历史词/带参进入)都汇到这里,历史只在这一处写
    if (keyword) this.saveHistory(keyword);

    const query = [];
    if (keyword) query.push('keyword=' + encodeURIComponent(keyword));
    if (filterConditions.categoryId) query.push('categoryId=' + filterConditions.categoryId);
    if (filterConditions.startDate) query.push('startDate=' + encodeURIComponent(filterConditions.startDate));
    if (filterConditions.endDate) query.push('endDate=' + encodeURIComponent(filterConditions.endDate));
    if (filterConditions.minPrice != null && filterConditions.minPrice !== '') query.push('minPrice=' + filterConditions.minPrice);
    if (filterConditions.maxPrice != null && filterConditions.maxPrice !== '') query.push('maxPrice=' + filterConditions.maxPrice);
    // CU-M-66:排序先前只存在本页 filterConditions 里,跳转 URL 不拼它 ⇒ 选项选了跟没选一样。
    // 结果页收下后只对 /api/activity/list 生效(其余三类后端没有排序参数,不装样子)。
    if (filterConditions.sortType) query.push('sortType=' + filterConditions.sortType);
    wx.navigateTo({ url: '/pages/search2/result/index?' + query.join('&') });
  },

  // 搜索历史:2026-08-04 产品拍板,只走本地 storage 最近 10 条,不上后端、不建表,可一键清空
  loadHistory() {
    this.setData({ searchHistory: this.readHistory() });
  },

  readHistory() {
    wx.removeStorageSync(LEGACY_HISTORY_KEY);
    const key = searchHistoryStorageKey(app.getUserID && app.getUserID());
    return key ? normalizeSearchHistory(wx.getStorageSync(key), HISTORY_MAX) : [];
  },

  saveHistory(keyword) {
    const next = normalizeSearchHistory([keyword, ...this.readHistory()], HISTORY_MAX);
    const key = searchHistoryStorageKey(app.getUserID && app.getUserID());
    if (key) wx.setStorageSync(key, next);
    this.setData({ searchHistory: next });
  },

  onClearHistory() {
    wx.removeStorageSync(LEGACY_HISTORY_KEY);
    const key = searchHistoryStorageKey(app.getUserID && app.getUserID());
    if (key) wx.removeStorageSync(key);
    this.setData({ searchHistory: [] });
  },

  // 热门关键词点击
  onHotKeyClick(e) {
    const { index, keyword } = e.currentTarget.dataset;
    
    this.setData({
      searchKeyword: keyword,
      activeHotKey: index,
      filterConditions: {
        ...this.data.filterConditions,
        keyword: keyword
      }
    });
    
    this.navigateToSearchList();
  },

  // 类别点击
  onCategoryClick(e) {
    const category = e.currentTarget.dataset.category;
    
    this.setData({
      activeCategory: category.id,
      filterConditions: {
        ...this.data.filterConditions,
        categoryId: category.id
      }
    });
    
    // // 如果有关键词，跳转到搜索结果页面
    // if (this.data.searchKeyword) {
    //   this.navigateToSearchList();
    // } else {
    //   // 如果没有关键词，可以只选择分类，等待用户输入关键词
    //   wx.showToast({
    //     title: `已选择分类: ${category.categoryName}`,
    //     icon: 'none'
    //   });
    // }
    this.navigateToSearchList();
  },

  // 显示筛选弹窗
  popShow() {
    this.setData({
      popVisible: true
    });
  },

  // 关闭筛选弹窗
  popClose() {
    this.setData({
      popVisible: false
    });
  },

  // 跳转到地图页面
  goMap() {
    // 传递搜索参数到地图页面
    const params = {
      keyword: this.data.searchKeyword,
      categoryId: this.data.activeCategory,
      ...this.data.filterConditions
    };
    
    wx.navigateTo({
      url: `/pages/searchmap/index?params=${encodeURIComponent(JSON.stringify(params))}`,
    });
  },

  // 筛选搜索
  searchFilter() {
    // 更新筛选条件
    const filterConditions = {
      ...this.data.filterConditions,
      dateType: this.data.activeDate,
      sortType: this.data.activeSort,
      minPrice: this.data.minPrice,
      maxPrice: this.data.maxPrice
    };

    const isYmd = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    filterConditions.startDate = isYmd(this.data.startdate) ? this.data.startdate : '';
    filterConditions.endDate = isYmd(this.data.enddate) ? this.data.enddate : '';

    this.setData({
      popVisible: false,
      filterConditions: filterConditions
    });

    // 如果有关键词，跳转到搜索结果页面
    if (this.data.searchKeyword || this.data.activeCategory) {
      this.navigateToSearchList();
    }
  },

  // 选择日期
  selectDate(e) {
    const value = e.currentTarget.dataset.value;
    const that = this;
    
    // 获取当前日期
    const now = new Date();
    let startDate = '';
    let endDate = '';

    switch(value) {
      case '1': // 今天
        startDate = this.formatDate(now);
        endDate = startDate; // 开始和结束都是今天
        break;
      case '2': // 明天
        const tomorrow = new Date(now);
        tomorrow.setDate(now.getDate() + 1);
        startDate = this.formatDate(tomorrow);
        endDate = startDate; // 开始和结束都是明天
        break;
      case '3': // 选择日期，显示自定义日期选择器
        // 这里重置为自定义选择状态，具体日期由后续的picker选择
        startDate = '开始日期';
        endDate = '结束日期';
        break;
      default:
        // 处理其他情况或重置
        startDate = '开始日期';
        endDate = '结束日期';
    }

    // 更新数据，如果选择"今天"或"明天"，会直接设置好startdate和enddate
    that.setData({
      activeDate: value,
      startdate: startDate,
      enddate: endDate
    });
  },

    /**
   * 辅助函数：将Date对象格式化为 YYYY-MM-DD 字符串
   * @param {Date} date 
   */
  formatDate(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
  // 选择排序
  selectSort(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({
      activeSort: value
    });
  },

  // 最低价格输入
  onMinPriceInput(e) {
    let value = e.detail.value.replace(/[^\d]/g, '');
    const numValue = parseInt(value) || this.data.priceRange.min;

    if (numValue >= this.data.maxPrice) {
      toast('最低价格不能大于等于最高价格');
      return;
    }

    if (numValue < this.data.priceRange.min) {
      value = this.data.priceRange.min.toString();
    }

    const percent = ((numValue - this.data.priceRange.min) / (this.data.priceRange.max - this.data.priceRange.min)) * 100;

    this.setData({
      jg1: '¥' + value,
      minPrice: numValue,
      minPercent: percent
    }, () => {
      this.calculateSliderStyles();
    });
  },

  // 最高价格输入
  onMaxPriceInput(e) {
    let value = e.detail.value.replace(/[^\d]/g, '');
    const numValue = parseInt(value) || this.data.priceRange.min;

    if (numValue <= this.data.minPrice) {
      toast('最高价格不能小于等于最低价格');
      return;
    }

    if (numValue > this.data.priceRange.max) {
      value = this.data.priceRange.max.toString();
    }

    const percent = ((numValue - this.data.priceRange.min) / (this.data.priceRange.max - this.data.priceRange.min)) * 100;

    this.setData({
      jg2: '¥' + value,
      maxPrice: numValue,
      maxPercent: percent
    }, () => {
      this.calculateSliderStyles();
    });
  },

  // 最低价滑块拖动
  onMinSliderMove(e) {
    this.handleSliderMove(e, 'min');
  },

  // 最高价滑块拖动
  onMaxSliderMove(e) {
    this.handleSliderMove(e, 'max');
  },

  // 处理滑块拖动
  handleSliderMove(e, type) {
    const query = wx.createSelectorQuery();
    query.select('.slider-container').boundingClientRect();
    query.exec((res) => {
      if (res[0]) {
        const containerWidth = res[0].width;
        const containerLeft = res[0].left;
        const touchX = e.touches[0].clientX;

        let percent = ((touchX - containerLeft) / containerWidth) * 100;
        percent = Math.max(0, Math.min(100, percent));

        // 设置最小间隔
        const minInterval = 5; // 5%的最小间隔

        if (type === 'min') {
          if (percent >= this.data.maxPercent - minInterval) {
            percent = this.data.maxPercent - minInterval;
          }
          const price = Math.round((percent / 100) * (this.data.priceRange.max - this.data.priceRange.min) + this.data.priceRange.min);
          this.setData({
            minPercent: percent,
            minPrice: price,
            jg1: '¥' + price
          });
        } else {
          if (percent <= this.data.minPercent + minInterval) {
            percent = this.data.minPercent + minInterval;
          }
          const price = Math.round((percent / 100) * (this.data.priceRange.max - this.data.priceRange.min) + this.data.priceRange.min);
          this.setData({
            maxPercent: percent,
            maxPrice: price,
            jg2: '¥' + price
          });
        }

        this.calculateSliderStyles();
      }
    });
  },

  openDatePicker(e) {
    const field = e.currentTarget.dataset.field === 'enddate' ? 'enddate' : 'startdate';
    const current = isDateValue(this.data[field])
      ? this.data[field]
      : (field === 'enddate' && isDateValue(this.data.startdate) ? this.data.startdate : '');
    const state = pickerState(current);
    this.setData({
      dateSheetVisible: true,
      datePickerField: field,
      datePickerTitle: field === 'enddate' ? '选择结束日期' : '选择开始日期',
      datePickerDays: state.days,
      datePickerValue: state.value,
    });
  },

  onDatePickerChange(e) {
    const value = e.detail.value || [0, 0, 0];
    const year = DATE_YEARS[value[0]] || 1970;
    const month = DATE_MONTHS[value[1]] || 1;
    const days = dateDays(year, month);
    const next = [value[0], value[1], Math.min(value[2], days.length - 1)];
    this.setData({ datePickerDays: days, datePickerValue: next });
  },

  cancelDatePicker() {
    this.setData({ dateSheetVisible: false });
  },

  confirmDatePicker() {
    const value = this.data.datePickerValue;
    const selected = formatPickerDate(value[0], value[1], value[2]);
    const field = this.data.datePickerField;
    if (field === 'startdate' && isDateValue(this.data.enddate) && selected > this.data.enddate) {
      toast('开始日期不能晚于结束日期');
      return;
    }
    if (field === 'enddate' && isDateValue(this.data.startdate) && selected < this.data.startdate) {
      toast('结束日期不能早于开始日期');
      return;
    }
    this.setData({ [field]: selected, dateSheetVisible: false });
  },

  // 重置筛选条件
  resetFilter() {
    this.setData({
      activeDate: '0',
      activeSort: '1',
      startdate: '开始日期',
      enddate: '结束日期',
      jg1: '¥0',
      jg2: '¥1000',
      minPrice: 0,
      maxPrice: 1000,
      minPercent: 0,
      maxPercent: 100
    }, () => {
      this.calculateSliderStyles();
    });
  },

  // 计算滑块样式
  calculateSliderStyles() {
    const { minPercent, maxPercent } = this.data;
    const sliderRangeStyle = `left: ${minPercent}%; right: ${100 - maxPercent}%;`;
    const minHandleStyle = `left: ${minPercent}%;`;
    const maxHandleStyle = `left: ${maxPercent}%;`;

    this.setData({
      sliderRangeStyle,
      minHandleStyle,
      maxHandleStyle,
    });
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.getCategoryList();
    this.loadHistory();

    // 从其他页面传递的参数
    if (options.keyword) {
      this.setData({
        searchKeyword: options.keyword
      });
      this.navigateToSearchList();
    }
  },

  // 获取分类列表
  getCategoryList: function () {
    var that = this;
    const requestEpoch = (this._categoryRequestEpoch || 0) + 1;
    this._categoryRequestEpoch = requestEpoch;
    that.setData({
      categoryLoading: true,
      categoryError: ''
    });
     
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/category/list',
      method: "POST",
      data: {
        type: 1,
        parentid: 0
      },
      success: function (res) {
        if (requestEpoch !== that._categoryRequestEpoch) return;
        if (res && res.code == "200" && isRecordList(res.data)) {
          // UI-13:后端 icon 字段各品类共用一张占位图,展示层按 categoryName 换成 cy-icon。
          var categoryList = res.data.map(function (item) {
            return Object.assign({}, item, { iconName: resolveCategoryIcon(item && item.categoryName) });
          });
          that.setData({
            categoryList: categoryList,
            categoryLoading: false,
            categoryError: '',
          });
        } else {
          that._setCategoryError(res);
        }
      },
      fail: function (res) {
        if (requestEpoch !== that._categoryRequestEpoch) return;
        that._setCategoryError(res);
      },
      successStatusAbnormal: function (res) {
        if (requestEpoch !== that._categoryRequestEpoch) return;
        that._setCategoryError(res);
      },
    });
  },

  _setCategoryError(res) {
    const msg = app.getRequestErrorMessage
      ? app.getRequestErrorMessage(res, '类别加载失败，请重试')
      : ((res && (res.msg || res.errMsg)) || '类别加载失败，请重试');
    this.setData({ categoryList: [], categoryLoading: false, categoryError: msg });
  },
});
