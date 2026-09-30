const toast = require('../../utils/toast.js');
const app = getApp()
const { isValidMobile, deriveCanSubmit } = require('../../utils/form-state.js')

function isAddressPayload(address) {
  return !!address && typeof address === 'object' && !Array.isArray(address)
    && typeof address.fullName === 'string'
    && typeof address.mobilePhone === 'string'
    && (address.province == null || typeof address.province === 'string')
    && (address.detailAddress == null || typeof address.detailAddress === 'string');
}

Page({
  /**
   * 页面的初始数据
   */
  data: {
    // 自定义导航:顶栏高度 = 状态栏 + 导航条,页面自留同高占位,内容不被顶栏压住
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    form: {
      id: '', // 地址ID，编辑时使用
      fullName: '', // 姓名
      mobilePhone: '', // 手机号
      province: '', // 省市区
      detailAddress: '', // 详细地址
      isDefault: 0 // 是否默认地址
    },
    isEdit: false, // 是否是编辑模式
    canSubmit: false,
    saving: false,
    bootstrapping: false,
    bootstrapError: '',
    bootstrapErrorKind: 'network',
    bootstrapErrorSub: '',
    saveError: '',
    saveSucceeded: false,
    saveSteps: ['保存参与人信息']
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    // 判断是编辑还是新增
    if (options.id) {
      this.setData({
        isEdit: true,
        'form.id': options.id,
        bootstrapping: true
      });
      this.getAddressInfo(options.id);
    }
  },

  // 栈首页(深链/直达)时 navigateBack 会失败;不兜底就是个点了不动的死箭头。
  // 回落到无参可达的参与人列表(三处真实 caller 都带参数,不能盲跳回 caller)。
  // redirectTo 而非 navigateTo:兜底不该把页面栈越堆越深。
  onBack: function () {
    wx.navigateBack({ fail() { wx.redirectTo({ url: '/pages/address/address' }); } });
  },

  /**
   * 获取地址详情
   */
  getAddressInfo: function (id) {
    if (this._bootstrapLoading) return;
    this._bootstrapLoading = true;
    const that = this;
    this.setData({
      bootstrapping: true,
      bootstrapError: '',
      bootstrapErrorSub: ''
    });

    this._bootstrapTask = app.sendRequest({
      url: '/api/user/address/info',
      autoErrorToast: false,   // 失败一律落 bootstrapError → auto-back 半屏讲原因,不再叠 toast
      method: "POST",
      data: { id: id },
      success: function (res) {
        that._bootstrapLoading = false;
        that._bootstrapTask = null;
        if (res.code == "200" && isAddressPayload(res.data)) {
          const address = res.data;
          that.setData({
            'form.fullName': address.fullName,
            'form.mobilePhone': address.mobilePhone,
            'form.province': address.province || '',
            'form.detailAddress': address.detailAddress || '',
            'form.isDefault': address.isDefault || 0,
            bootstrapping: false,
            bootstrapError: '',
            bootstrapErrorSub: ''
          }, () => that.refreshSubmitState());
        } else {
          that.setData({
            bootstrapping: false,
            bootstrapError: '参与人信息暂时不可用',
            bootstrapErrorKind: 'data',
            bootstrapErrorSub: res.code == "200"
              ? '返回内容不完整，请重新加载'
              : app.getRequestErrorMessage(res, '参与人信息加载失败，请重试')
          });
        }
      },
      fail: function (res) {
        that._bootstrapLoading = false;
        that._bootstrapTask = null;
        that.setData({
          bootstrapping: false,
          bootstrapError: '网络没连上',
          bootstrapErrorKind: 'network',
          bootstrapErrorSub: '检查网络连接后重试'
        });
      }
    });
  },

  retryBootstrap: function () {
    if (this.data.form.id) this.getAddressInfo(this.data.form.id);
  },

  /**
   * 输入框变化
   */
  onInputChange: function (e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    
    this.setData({
      [`form.${field}`]: value
    }, () => this.refreshSubmitState());
  },

  refreshSubmitState: function () {
    const form = this.data.form;
    const fullName = typeof form.fullName === 'string' ? form.fullName : '';
    const mobilePhone = typeof form.mobilePhone === 'string' ? form.mobilePhone : '';
    const canSubmit = deriveCanSubmit([
      !!fullName.trim(),
      isValidMobile(mobilePhone.trim())
    ]) && !this.data.saving;
    if (canSubmit !== this.data.canSubmit) this.setData({ canSubmit: canSubmit });
  },

  /**
   * 默认地址切换
   */
  onDefaultChange: function (e) {
    this.setData({
      'form.isDefault': e.detail.value ? 1 : 0
    });
  },

  // 置灰的「保存参与人信息」被点 → 报第一条没交的必填(报名链路的最后一屏,别静默)。
  onSaveDisabledTap: function () {
    const form = this.data.form;
    if (!String(form.fullName || '').trim()) toast('请填写姓名');
    else if (!isValidMobile(String(form.mobilePhone || '').trim())) toast('请填写正确的手机号');
  },

  /**
   * 保存地址
   */
  saveAddress: function () {
    const that = this;
    const form = this.data.form;
    if (this.data.saving || this._saveSucceeded) return;
    
    // 表单验证
    if (!this.validateForm(form)) {
      return;
    }
    
    if (!form.id && !this._addressRequestId) {
      this._addressRequestId = 'address_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    }
    this.setData({ saving: true, canSubmit: false, saveError: '', saveSucceeded: false });
    this._saveTask = app.sendRequest({
      url:  '/api/user/address/action',
      method: "POST",
      data: Object.assign({}, form, { requestId: this._addressRequestId || '' }),
      success: function (res) {
        if (res.code == "200") {
          that._saveSucceeded = true;
          that._addressRequestId = null;
          that.setData({ saving: false, canSubmit: false, saveError: '', saveSucceeded: true });
          toast.success('参与人信息已保存', { duration: 1500 });

          const savedAddress = Object.assign({}, form, {
            id: (res.data && (res.data.id || res.data.addressId)) || form.id || '',
            address: form.detailAddress
          });
          const eventChannel = that.getOpenerEventChannel && that.getOpenerEventChannel();
          if (eventChannel && eventChannel.emit) {
            eventChannel.emit('addressAdded', {
              address: savedAddress
            });
          }
          
          // 返回上一页
          that._leaveTimer = setTimeout(() => {
            wx.navigateBack({
              fail() {
                // 深链/扫码直达时可能只有一层页面栈；此时保存已成功，
                // 必须去可达列表，不能让用户留在永久 saving 的表单上。
                wx.redirectTo({
                  url: '/pages/address/address',
                  fail() {
                    wx.reLaunch({
                      url: '/pages/address/address',
                      fail() {
                        that.setData({ saving: false, canSubmit: false });
                        toast('已保存，请返回参与人列表查看');
                      }
                    });
                  }
                });
              }
            });
          }, 1500);
        } else {
          that.setData({
            saveError: app.getRequestErrorMessage(res, '参与人信息暂时没有保存，请重试')
          });
        }
      },
      fail: function (res) {
        that.setData({ saveError: '网络没连上，请检查后重试' });
      },
      complete: function () {
        that._saveTask = null;
        if (!that._saveSucceeded) {
          that.setData({ saving: false }, () => that.refreshSubmitState());
        }
      }
    });
  },

  /**
   * 表单验证
   */
  validateForm: function (form) {
    const fullName = typeof form.fullName === 'string' ? form.fullName : '';
    const mobilePhone = typeof form.mobilePhone === 'string' ? form.mobilePhone : '';
    if (fullName.trim() === '') {
      toast('请输入姓名');
      return false;
    }
    
    if (mobilePhone.trim() === '') {
      toast('请输入手机号');
      return false;
    }
    
    // 手机号格式验证
    if (!isValidMobile(mobilePhone)) {
      toast('请输入正确的手机号');
      return false;
    }
    
    return true;
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 页面显示时的逻辑
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    if (this._bootstrapTask && typeof this._bootstrapTask.abort === 'function') this._bootstrapTask.abort();
    if (this._saveTask && typeof this._saveTask.abort === 'function') this._saveTask.abort();
    if (this._leaveTimer) clearTimeout(this._leaveTimer);
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
});
