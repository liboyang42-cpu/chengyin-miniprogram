const modal = require('../../utils/modal.js');
const toast = require('../../utils/toast.js');
const { toTimestamp } = require('../../utils/datetime');
const app = getApp();
const mockData = require('../../utils/mockData.js');
const policy = require('../../utils/identity/identity-policy.js');
const merchantTheme = require('../../utils/merchant-theme.js');
const { isRecordList } = require('../../utils/response-shape.js');

Page({
  data: {
    isMerchant: false,
    list: [],
    searchKeyword: '',
    filterCategoryId: 0,
    page: 1,
    pageSize: 10,
    total: 0,
    hasMore: true,
    loading: false,
    loadingMore: false,
    errorMsg: '',
    loadMoreError: ''
  },

  onBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.switchTab({ url: '/pages/template/index' });
  },

  isDevEnv() {
    try {
      return wx.getAccountInfoSync().miniProgram.envVersion === 'develop';
    } catch (e) {
      return false;
    }
  },

  // 分类筛选
  onFilterCategory(e) {
    const categoryId = e.currentTarget.dataset.id;
    this.setData({
      filterCategoryId: categoryId
    });
    this.refreshList();
  },

  // R4-C04:封面选源(imgUrl/imgUrls/storyImg + 本地图片兜底)未获 §5.5 授权,
  // 按 github/master 原形恢复为「标题首字」文本兜底。
  decorateItem(item) {
    const title = String(item && (item.title || item.name) || '玩法').trim();
    return Object.assign({}, item, {
      drop: false,
      coverFailed: false,
      coverInitial: title.charAt(0) || '玩'
    });
  },

  onCoverError(e) {
    const index = Number(e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.index);
    const boundKey = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    if (!Number.isInteger(index) || index < 0 || index >= this.data.list.length) return;
    const item = this.data.list[index];
    const currentKey = item && item.id != null ? String(item.id) : '';
    if (!item || !currentKey || String(boundKey || '') !== currentKey || item.coverFailed) return;
    this.setData({ [`list[${index}].coverFailed`]: true });
  },

  // 下拉展开关闭
  toggleDropdown(e) {
    const index = e.currentTarget.dataset.index;
    const list = this.data.list.map((item, i) => {
      if (i === index) {
        return { ...item, drop: !item.drop };
      }
      return { ...item, drop: false };
    });
    this.setData({ list });
  },
  goInfo(e){
    const index = e.currentTarget.dataset.index;
    const item = this.data.list[index];
    wx.navigateTo({
      url: '/pages/templatedetail/templatedetail?id=' + item.id + '&scope=my',
    })
  },
  // 删除模板
  deleteItem(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.list[index];
    
    modal.show({
      dangerKey: 'template.delete', dangerParams: { name: item.title },   // 三段式文案在 utils/danger-actions.js
      success: (res) => {
        if (res.confirm) {
          this.deleteTemplate(item.id, index);
        }
      }
    });
  },
 
  templateStatus(e) {
    var that = this
    const index = e.currentTarget.dataset.index;
    let topicList = that.data.list
    let item = topicList[index]
    app.sendRequest({
      hideLoading: true,
      url: '/api/template/updateLibraryStatus',
      method: "POST",
      data: {
        template_id : item['id'],
        publish_status : !topicList[index].publishStatus  ? 1: 0
      },
      success: function (res) {
        if (res.code == "200") {
          toast('操作成功');
          const key = `list[${index}].publishStatus`;
          const keydrop = `list[${index}].drop`;
          that.setData({
            [key]: !topicList[index].publishStatus,
            [keydrop]: !topicList[index].drop
          });
        } else {
          // 原来只有 200 分支:非 200 无声,而空 fail/complete 又把封装的自动错误
          // toast 挡了(挂了 fail 就被视为「调用方自理」)——上下架失败全静默。
          toast((res && res.msg) || '操作失败，请重试');
        }
      }
    })
  },

  // 获取难度文本
  getDifficultyText(difficulty) {
    const difficultyMap = {
      '高': '高难度',
      '中': '中等难度',
      '低': '低难度'
    };
    return difficultyMap[difficulty] || difficulty;
  },

  // 获取验证方式文本
  getValidationMethodText(method) {
    const methodMap = {
      1: '选择题',
      2: '问答题',
      3: '混合题'
    };
    return methodMap[method] || '未知类型';
  },

  // 获取状态文本
  getStatusText(status) {
    const statusMap = {
      1: '已发布',
      0: '未发布',
      2: '审核中'
    };
    return statusMap[status] || '未知状态';
  },

  // 格式化日期
  formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(toTimestamp(dateString));
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return '今天';
    } else if (days === 1) {
      return '昨天';
    } else if (days < 7) {
      return `${days}天前`;
    } else {
      return `${date.getMonth() + 1}-${date.getDate()}`;
    }
  },

  // 刷新列表
  refreshList() {
    if (this.data.loading || this.data.loadingMore) return false;
    this.setData({
      page: 1,
      hasMore: true,
      loadMoreError: ''
    });
    this.getList(false, 1);
    return true;
  },

  // 加载更多
  loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.getList(true, this.data.page + 1);
  },

  retryLoadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;
    this.getList(true, this.data.page + 1);
  },

  // 获取模板列表
  getList: function (isLoadMore = false, requestedPage) {
    if (this.data.loading || this.data.loadingMore) return;
    const pageNum = isLoadMore ? (requestedPage || this.data.page + 1) : 1;
    if (isLoadMore) this.setData({ loadingMore: true, loadMoreError: '' });
    else this.setData({ loading: true, errorMsg: '' });
    const localRows = this.isDevEnv() ? mockData.getTemplates(this.data.searchKeyword).map(item => this.decorateItem(item)) : [];
    if (!isLoadMore && localRows.length > 0) {
      this.setData({
        list: localRows,
        total: localRows.length,
        hasMore: false
      });
    }
    
    const that = this;
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/template/my-list',
      method: "POST",
      data: {
        is_quote: '',
        keyword: this.data.searchKeyword,
        category_id: '',
        pageNum: pageNum,
        pageSize: this.data.pageSize
      },
      success: function (res) {
        if (res && res.code == "200" && res.data && isRecordList(res.data.rows)) {
          const data = res.data.rows;
          if (data.length === 0 && that.isDevEnv()) {
            that.setData({
              list: localRows,
              total: localRows.length,
              hasMore: false
            });
            return;
          }
          const numericTotal = Number(res.data.total);
          const totalKnown = Number.isFinite(numericTotal) && numericTotal >= 0;
          const total = totalKnown ? numericTotal : 0;
          
          // 处理数据，添加下拉状态等
          const processedData = data.map(item => that.decorateItem(item));
          
          if (isLoadMore) {
            // 加载更多
            const nextLength = that.data.list.length + data.length;
            that.setData({
              list: [...that.data.list, ...processedData],
              page: pageNum,
              total: total,
              hasMore: totalKnown ? nextLength < total : data.length >= that.data.pageSize,
              loadMoreError: ''
            });
          } else {
            // 刷新列表
            that.setData({
              list: processedData,
              page: 1,
              total: total,
              hasMore: totalKnown ? data.length < total : data.length >= that.data.pageSize,
              errorMsg: '' });
          }
        } else {
          that.handleListError(isLoadMore, app.getRequestErrorMessage(res, '玩法草稿加载失败'), localRows);
        }
      },
      fail: function (res) {
        that.handleListError(isLoadMore, app.getRequestErrorMessage(res, '玩法草稿加载失败'), localRows);
      },
      complete: function () {
        if (isLoadMore) that.setData({ loadingMore: false });
        else that.setData({ loading: false });
        if (!isLoadMore && that._pullDownRefreshing) {
          that._pullDownRefreshing = false;
          wx.stopPullDownRefresh();
        }
      }
    });
  },

  handleListError(isLoadMore, message, localRows) {
    if (isLoadMore) {
      this.setData({ loadMoreError: message });
      return;
    }
    if (localRows.length > 0) {
      this.setData({
        list: localRows,
        total: localRows.length,
        hasMore: false,
        errorMsg: '' });
      return;
    }
    if (this.data.list.length > 0) {
      this.setData({  errorMsg: '' });
      return;
    }
    this.setData({ errorMsg: message });
  },

  // 删除模板API调用
  deleteTemplate: function (id, index) {
    const that = this;
    app.sendRequest({
      url: '/api/template/delete',
      method: "POST",
      data: { template_id : id },
      success: function (res) {
        if (res.code == "200") {
          toast.success('删除成功');
          // 从列表中移除
          const list = that.data.list;
          list.splice(index, 1);
          that.setData({ list });
        } else {
          toast(res.msg || '删除失败');
        }
      },
      fail: function (res) {
        toast('网络错误，请重试');
      }
    });
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.getList();
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    const isMerchant = policy.isMerchantView({ role: app.getUserRole(), userType: app.getUserType() });
    this.setData({ isMerchant: isMerchant });
    if (isMerchant) merchantTheme.merchantPageShow();
    else merchantTheme.merchantPageRestore();
    // 页面显示时刷新数据，确保数据最新
    this.refreshList();
  },

  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    this._pullDownRefreshing = true;
    if (!this.refreshList()) {
      this._pullDownRefreshing = false;
      wx.stopPullDownRefresh();
    }
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {
    this.loadMore();
  }
});
