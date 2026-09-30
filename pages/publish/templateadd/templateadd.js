const modal = require('../../../utils/modal.js');
const app = getApp();
const { readReducedMotion } = require('../../../utils/motion-preference.js');
Page({

  /**
   * 页面的初始数据
   */
  data: {
    id: 0,
    templateName: '', // 新增：存储输入的名称
    canSubmit: false,
    reducedMotion: false,
    dirty: false,
    navigating: false,
    validationError: '',
    navigationError: '',
    operationScope: ''
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    options = options || {};
    var that = this
    that.setData({
      id: options.id || 0,
      operationScope: options.scope === 'MERCHANT' ? 'MERCHANT' : '',
    })
  },

  /**
   * 输入框内容变化事件
   */
  onInputChange(e) {
    const value = e.detail.value;
    this.data.dirty = !!value;
    this.setData({
      templateName: value,
      canSubmit: !!value.trim(),
      validationError: '',
      navigationError: ''
    });
  },

  /**
   * 创建路线模板按钮点击事件
   */
  onCreateTemplate() {
    if (this.data.navigating) return;
    const { templateName, id } = this.data;

    // 验证输入是否为空
    if (!templateName || templateName.trim().length === 0) {
      this.setData({ validationError: '请输入模板名称' });
      return;
    }

    // 进入编辑器时保留命名页,编辑器返回应回到用户刚才填写的这一步
    this.setData({ navigating: true, validationError: '', navigationError: '' });
    wx.navigateTo({
      url: `/pages/publish/temp/index?templateName=${encodeURIComponent(templateName.trim())}`
        + (this.data.operationScope ? '&scope=MERCHANT' : ''),
      success: () => {
        this.data.dirty = false;
      },
      fail: () => {
        this.setData({ navigating: false, navigationError: '跳转失败，请重试' });
      }
    });
  },

  onNavBack() {
    if (!this.data.dirty) {
      wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/template/index' }); } });
      return;
    }
    modal.show({
      title: '放弃未保存的名称？',
      content: '返回后，这个玩法名称不会保留。',
      confirmText: '放弃',
      cancelText: '继续填写',
      success: (res) => {
        if (res.confirm) wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/template/index' }); } });
      }
    });
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    const reducedMotion = readReducedMotion();
    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });
  },

  /**
   * 用户点击右上角分享
   */
})
