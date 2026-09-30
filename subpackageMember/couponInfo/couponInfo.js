const modal = require('../../utils/modal.js');
const cyToast = require('../../utils/toast.js');
const app = getApp();
const merchantTheme = require('../../utils/merchant-theme.js');
const couponForm = require('../../utils/coupon-form.js');
// 起止时刻的拆装(跨天必须按「日期+时刻」一起算,见该文件注释)
const datetimeRange = require('../../utils/datetime-range.js');
const calendar = require('../../utils/calendar.js');
Page({

  /**
   * 页面的初始数据
   */
  data: {
    startdate: '开始日期',
    enddate: '结束日期',
    array2: couponForm.COUPON_TYPE_LABELS,
    index2: 0,
    couponTypeSheetVisible: false,
    
    // 表单数据
    formData: {
      name: '',
      startTime: '',
      endTime: '',
      publishCount: 0,
      couponType: 0,
      description: ''
    },
    canSubmit: false,
    isSubmitting: false,
    submitError: '',
    submitErrorKind: 'data',
    submitErrorTitle: '',
    submitErrorRetryable: false,
    operationScope: '',
    
    // 显示文本
    displayStartTime: '开始日期',
    displayEndTime: '结束日期',

    // 有效期选择器(cy-datetime-range)。
    // 2026-08-27 收口:原来是两个先后弹出的独立面板 + 9 个页面级 data 字段
    // (startTimePicker/startDateIndex/startTimeIndex/endTimePicker/endDateIndex/
    //  endTimeIndex/dateList/hours/minutes),reward-selector 里还有一份一字不差的副本。
    // 现在起止一屏内切换、当场显示跨度、当场判定,滚轮与日期列表都在组件里。
    rangePickerShow: false,
    rangeValue: [], // ['YYYY-MM-DD HH:mm:ss', ...];打开时喂给组件
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    var that = this 
    that.setData({ operationScope: options && options.scope === 'MERCHANT' ? 'MERCHANT' : '' })
  },

  onShow() { merchantTheme.merchantPageShow(); },
  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() { merchantTheme.merchantPageRestore(); },

  // 打开有效期选择器。起止一次选完,不再「确定开始 → 延时 300ms 自动弹出结束」——
  // 那个延时弹窗会盖住页面,而且选结束时看不到刚选的开始时间。
  showStartTimePicker() {
    const { startTime, endTime } = this.data.formData;
    this.setData({
      rangeValue: [startTime || '', endTime || ''],
      rangePickerShow: true,
    });
  },

  onRangeCancel() {
    this.setData({ rangePickerShow: false });
  },

  // 组件只在校验通过时才抛 confirm(不合法它自己留在原地提示),
  // 所以这里不再需要「结束必须晚于开始」那句 toast —— 用户在面板里当场就看到了。
  onRangeConfirm(e) {
    const value = e.detail.value || [];
    this.setData({
      'formData.startTime': value[0],
      'formData.endTime': value[1],
      displayStartTime: this.displayOf(value[0], '开始日期'),
      displayEndTime: this.displayOf(value[1], '结束日期'),
      rangePickerShow: false,
      submitError: '',
      submitErrorTitle: '',
      submitErrorRetryable: false,
    }, () => {
      this.refreshSubmitState();
      cyToast.success('时间设置完成');
    });
  },

  // 'YYYY-MM-DD HH:mm:ss' → '11月26日 18:00'(展示口径仍走 coupon-form 那一份,不另写)
  displayOf(value, fallback) {
    const p = datetimeRange.split(value);
    if (!p) return fallback;
    return couponForm.formatDisplayTime(calendar.parse(p.date), +p.time.slice(0, 2), +p.time.slice(3, 5));
  },

  // 优惠券名称输入
  onNameInput(e) {
    this.setData({
      'formData.name': e.detail.value,
      submitError: '',
      submitErrorTitle: '',
      submitErrorRetryable: false,
    }, () => this.refreshSubmitState())
  },

  // 投放数量输入
  onPublishCountInput(e) {
    this.setData({
      'formData.publishCount': parseInt(e.detail.value) || 0,
      submitError: '',
      submitErrorTitle: '',
      submitErrorRetryable: false,
    }, () => this.refreshSubmitState())
  },

  // 优惠券说明输入
  onDescriptionInput(e) {
    this.setData({
      'formData.description': e.detail.value,
      submitError: '',
      submitErrorTitle: '',
      submitErrorRetryable: false,
    })
  },

  openCouponTypeSheet() {
    this.setData({ couponTypeSheetVisible: true });
  },

  closeCouponTypeSheet() {
    this.setData({ couponTypeSheetVisible: false });
  },

  selectCouponType(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    this.setData({
      index2: index,
      'formData.couponType': index, // 下标同 COUPON_TYPE_LABELS(0=请选择)
      couponTypeSheetVisible: false,
      submitError: '',
      submitErrorTitle: '',
      submitErrorRetryable: false,
    }, () => this.refreshSubmitState());
  },

  refreshSubmitState() {
    const canSubmit = couponForm.validate(this.data.formData).ok;
    if (canSubmit !== this.data.canSubmit) this.setData({ canSubmit });
  },

  // 取消按钮
  onCancel() {
    if (this.data.isSubmitting) return
    if (!couponForm.isDirty(this.data.formData)) {
      this.exitPage()
      return
    }
    modal.show({
      title: '放弃编辑？',
      content: '已填写的优惠券内容不会保存。',
      confirmText: '放弃',
      cancelText: '继续编辑',
      success: (res) => {
        if (res.confirm) this.exitPage()
      },
    })
  },

  exitPage() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.redirectTo({ url: '/subpackageMember/coupon/coupon' })
  },

  // 提交表单
  onSubmit() {
    const that = this;
    // M0-4 发券防重:前端防抖,提交中直接拦掉重复点击
    if (that.data.isSubmitting) return;
    const formData = that.data.formData;

    const check = couponForm.validate(formData);
    if (!check.ok) {
      that.setData({
        submitErrorTitle: '还差一点才能发布',
        submitError: check.message,
        submitErrorKind: 'data',
        submitErrorRetryable: false,
      });
      return;
    }

    that.setData({
      isSubmitting: true,
      submitError: '',
      submitErrorTitle: '',
      submitErrorRetryable: false,
    });
    couponForm.submitCoupon(app, formData, {
      scope: that.data.operationScope,
      onSuccess() {
        that.setData({ isSubmitting: false, submitError: '' });
        cyToast.success('发布成功', { duration: 2000 })
        setTimeout(() => {
          that.exitPage()
        }, 2000)
      },
      onError(message, reason) {
        that.setData({
          isSubmitting: false,
          submitErrorTitle: '优惠券没有发布',
          submitError: message,
          submitErrorKind: reason === 'network' ? 'network' : 'data',
          submitErrorRetryable: true,
        });
      },
      onComplete() {
        if (that.data.isSubmitting) that.setData({ isSubmitting: false });
      },
    });
  },
})
