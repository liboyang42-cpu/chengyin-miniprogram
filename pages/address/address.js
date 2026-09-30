const cyToast = require('../../utils/toast.js');
const app = getApp()

function requestErrorMessage(res, fallback) {
  return app.getRequestErrorMessage ? app.getRequestErrorMessage(res, fallback) : fallback;
}

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // ⚠️ 别删:secondary-nav-migration-contract 门禁要求「迁到共享 cy-nav-bar 的二级页」
    // data 里必须落 statusBarHeight/navBarHeight,即使本页已不再用它们手算 spacer 高度
    // (cy-page-title 的 safeTop 自己算了一份)。
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    list: [], // 地址列表数据
    loadState: 'loading', // loading | ready | error
    loadErrorMsg: '',
    refreshing: false,
    deletingIds: {},
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this._skipInitialShow = true;
    this.getList();
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    if (this._skipInitialShow) { this._skipInitialShow = false; return; }
    // 页面显示时重新获取数据，确保编辑后数据更新
    this.getList();
  },

  /**
   * 获取地址列表
   */
  getList: function (fromPullDown) {
    var that = this;
    const stopPullAfterComplete = fromPullDown === true;
    const generation = (this._listGeneration || 0) + 1;
    this._listGeneration = generation;
    if (this._listTask && typeof this._listTask.abort === 'function') this._listTask.abort();
    const hasSnapshot = that.data.loadState === 'ready';
    const finishLoadError = function (res, fallback) {
      const message = requestErrorMessage(res, fallback);
      if (hasSnapshot) {
        that.setData({
          loadState: 'ready',
          loadErrorMsg: '',
          refreshing: false,
        });
        return;
      }
      that.setData({
        list: [],
        loadState: 'error',
        loadErrorMsg: message,
        refreshing: false,
      });
    };
    that.setData({
      loadState: hasSnapshot ? 'ready' : 'loading',
      loadErrorMsg: '',
      refreshing: hasSnapshot,
    });
    this._listTask = app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/user/address/list',
      method: "POST",
      data: {},
      success: function (res) {
        if (generation !== that._listGeneration) return;
        const rows = res && res.data && res.data.rows;
        if (res && res.code == "200" && Array.isArray(rows)) {
          that.setData({
            list: rows,
            loadState: 'ready',
            loadErrorMsg: '',
            refreshing: false,
          })
        } else {
          finishLoadError(res, '参与人信息加载失败');
        }
      },
      fail: function (res) {
        if (generation !== that._listGeneration) return;
        finishLoadError(res, '网络异常，请重试');
      },
      successStatusAbnormal: function (res) {
        if (generation !== that._listGeneration) return;
        finishLoadError(res, '服务暂时不可用，请稍后再试');
      },
      complete: function () {
        if (generation !== that._listGeneration) return;
        that._listTask = null;
        if (stopPullAfterComplete && typeof wx.stopPullDownRefresh === 'function') wx.stopPullDownRefresh();
      }
    })
  },

  // 栈首页(深链/直达)时 navigateBack 会失败。caller(报名页)必须带 mode 参数,盲跳会进错态,
  // 故兜底落到无参且必达的 member tab,而不是做一个点了不动的死箭头。
  onBack: function () {
    wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/member/index/index' }); } });
  },

  selectAddress: function (e) {
    const address = e.currentTarget.dataset.address;
    if (!address) return;
    const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (eventChannel && eventChannel.emit) {
      eventChannel.emit('addressSelected', {
        address: address
      });
    }
    this.onBack();
  },

  goEditAddress: function (e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: '/pages/addressinfo/addressinfo?id=' + id
    });
  },

  /**
   * 删除地址
   */
  deleteAddress: function (e) {
    const that = this;
    const id = e.currentTarget.dataset.id;
    
    // 三段式第一段:确认。文案(含「此操作不可撤销」)在 utils/danger-actions.js。
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.open('address.delete', { id: id });
  },

  /** 三段式第二段:用户在确认弹窗里点了「删除地址」才真的发请求。 */
  onConfirmDeleteAddress: function (e) {
    this._deleteAddress(e.detail.params.id);
  },

  /**
   * 执行删除地址请求
   */
  _deleteAddress: function (id) {
    const that = this;
    if (!id || this.data.deletingIds[id]) return;
    const deletingIds = Object.assign({}, this.data.deletingIds, { [id]: true });
    this.setData({ deletingIds: deletingIds });
    const dc = this.selectComponent && this.selectComponent('#dc');
    if (dc) dc.busyOn();
    const task = app.sendRequest({
      url: '/api/user/address/delete',
      method: "POST",
      data: { id: id },
      success: function (res) {
        if (res.code == "200") {
          // 三段式第三段:结果确认卡取代原来一闪而过的 toast
          if (dc) dc.done();
          // 重新获取列表
          that.getList();
        } else {
          if (dc) dc.failed(res.msg || '删除失败');
        }
      },
      fail: function (res) {
        if (dc) dc.failed('网络错误，请重试');
      },
      complete: function () {
        const next = Object.assign({}, that.data.deletingIds);
        delete next[id];
        that.setData({ deletingIds: next });
        delete that._writeTasks['delete:' + id];
      }
    });
    this._writeTasks = this._writeTasks || {};
    this._writeTasks['delete:' + id] = task;
  },

  /**
   * 设置默认地址
   */
  setDefault: function (e) {
    const that = this;
    const id = e.currentTarget.dataset.id;
    
    if (!id || this._defaultingId) return;
    this._defaultingId = id;
    const task = app.sendRequest({
      url: '/api/user/address/setDefault',
      method: "POST",
      data: { id: id, isDefault: 1 },
      success: function (res) {
        if (res.code == "200") {
          cyToast.success('设置成功')
          // 重新获取列表
          that.getList();
        } else {
          cyToast(res.msg || '设置失败')
        }
      },
      fail: function (res) {
        cyToast('网络错误，请重试')
      },
      complete: function () {
        that._defaultingId = '';
        delete that._writeTasks.default;
      }
    });
    this._writeTasks = this._writeTasks || {};
    this._writeTasks.default = task;
  },

  // 其他生命周期函数保持不变...
  onReady() {},
  onHide() {},
  onUnload() {
    this._listGeneration = (this._listGeneration || 0) + 1;
    if (this._listTask && typeof this._listTask.abort === 'function') this._listTask.abort();
    Object.keys(this._writeTasks || {}).forEach(key => {
      const task = this._writeTasks[key];
      if (task && typeof task.abort === 'function') task.abort();
    });
    this._writeTasks = {};
  },
  onPullDownRefresh() {
    this.getList(true);
  },
  onReachBottom() {},
})
