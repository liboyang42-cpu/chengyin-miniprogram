const modal = require('../../../../utils/modal.js');
const cyToast = require('../../../../utils/toast.js');
const app = getApp();
const couponForm = require('../../../../utils/coupon-form.js');
// 起止时刻的拆装(跨天必须按「日期+时刻」一起算,见该文件注释)
const datetimeRange = require('../../../../utils/datetime-range.js');
const calendar = require('../../../../utils/calendar.js');

const OCCASION_LABELS = {
  node: '完成节点后发放',
  topic: '主题通关后发放',
  onsite: '到店核销后发放'
};

// 体验卡(2026-09-08 新增)走的就是券这条链路(发放/核销/库存全复用),不另起一套实体 ——
// 它和礼品券的差别只是"给的是一次体验"而不是"减多少钱",没有额外的金额计算。
const COUPON_TYPE_LABELS = couponForm.COUPON_TYPE_LABELS;

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    value: { type: Number, value: 0, observer() { this.syncSelection(); } },
    selectedName: { type: String, value: '', observer() { this.syncSelection(); } },
    occasion: { type: String, value: 'node', observer() { this.syncOccasion(); } },
    label: { type: String, value: '奖励券' },
    placeholder: { type: String, value: '不发券，仅完成打卡' },
    allowCreate: { type: Boolean, value: false },
    scope: { type: String, value: '' }
  },

  data: {
    open: false,
    loading: false,
    selectedLabel: '',
    occasionLabel: OCCASION_LABELS.node,

    /* ——— 创建优惠券半屏 sheet(不离开发布流程,建完自动选中)———
     * 字段/校验/提交逻辑全部走 utils/coupon-form.js,和 subpackageMember/couponInfo
     * 共用同一份,不在这里另写一遍。 */
    creating: false,
    isSubmitting: false,
    canCreateCoupon: false,
    createForm: {
      name: '',
      startTime: '',
      endTime: '',
      publishCount: 0,
      couponType: 0,
      description: ''
    },
    createDirty: false,
    // 「体验卡」有自己的创建入口；优惠券入口只展示三种券，避免两套入口互相串台。
    couponTypeLabels: COUPON_TYPE_LABELS.slice(0, 4),
    // 体验卡 = couponType 3(见上面那段口径)。两档筛选是纯前端过滤:
    // 后端 /api/coupon/mypublishlist 一次把我发的券全给回来,不必为筛选多跑一趟。
    rewardKinds: [{ key: 'COUPON', label: '优惠券' }, { key: 'PASS', label: '体验卡' }],
    rewardKind: 'COUPON',
    visibleCoupons: [],
    couponTypeIndex: 0,
    displayStartTime: '开始日期',
    displayEndTime: '结束日期',
    // 有效期选择器(cy-datetime-range)。2026-08-27 收口:
    // 原来是两个先后弹出的独立面板 + 9 个字段,与 subpackageMember/couponInfo 里那一份一字不差。
    rangePickerShow: false,
    rangeValue: []
  },

  methods: {
    syncSelection() {
      const couponId = Number(this.data.value || 0);
      const selected = (this._coupons || []).find((item) => Number(item.id) === couponId);
      this.setData({ selectedLabel: this.data.selectedName || (selected && selected.name) || '' });
    },

    syncOccasion() {
      this.setData({ occasionLabel: OCCASION_LABELS[this.data.occasion] || OCCASION_LABELS.node });
    },

    openSelector() {
      this.setData({ open: true });
      this.loadCoupons();
    },

    closeSelector() {
      this.setData({ open: false });
    },

    loadCoupons() {
      if (this.data.loading) return;
      this.setData({ loading: true });
      app.sendRequest({
        url: '/api/coupon/mypublishlist',
        method: 'POST',
        hideLoading: true,
        data: { is_select: 1, scope: this.data.scope === 'MERCHANT' ? 'MERCHANT' : '' },
        success: (res) => {
          if (res && (res.code === '200' || res.code === 200)) {
            const rows = Array.isArray(res.data) ? res.data : ((res.data && res.data.rows) || []);
            // coupons 只是数据源,渲染的是过滤后的 visibleCoupons ⇒ 不上屏的东西不走 setData
            this._coupons = rows;
            this.applyRewardKind();
            this.syncSelection();
          }
        },
        complete: () => this.setData({ loading: false })
      });
    },

    // 选中的那张属于哪一档,打开时就停在哪一档 —— 否则回来看不到自己选的那张。
    applyRewardKind() {
      const rows = this._coupons || [];
      const selected = rows.filter((item) => Number(item.id) === Number(this.data.value))[0];
      const kind = selected ? (Number(selected.couponType) === 3 ? 'PASS' : 'COUPON') : this.data.rewardKind;
      const visible = rows.filter((item) => (
        kind === 'PASS' ? Number(item.couponType) === 3 : Number(item.couponType) !== 3
      ));
      this.setData({ rewardKind: kind, visibleCoupons: visible });
    },

    onRewardKindChange(e) {
      const kind = e.currentTarget.dataset.kind === 'PASS' ? 'PASS' : 'COUPON';
      const visible = (this._coupons || []).filter((item) => (
        kind === 'PASS' ? Number(item.couponType) === 3 : Number(item.couponType) !== 3
      ));
      this.setData({ rewardKind: kind, visibleCoupons: visible });
    },

    chooseCoupon(e) {
      const item = e.currentTarget.dataset.item || {};
      this.emitChange(Number(item.id || 0), item.name || '');
      this.closeSelector();
    },

    clearCoupon() {
      this.emitChange(0, '');
      this.closeSelector();
    },

    emitChange(couponId, couponName) {
      this.setData({ selectedLabel: couponName || '' });
      this.triggerEvent('change', {
        couponId,
        couponName,
        occasion: this.data.occasion
      });
    },

    // 从选择器发起「创建」:不再 navigateTo 整页跳走,原地开一层半屏 sheet,
    // 选择器 sheet(this.data.open)保持不变——建完/取消都直接回到它,不丢已选状态。
    createCoupon() {
      const isPass = this.data.rewardKind === 'PASS';
      const createForm = couponForm.createDefaultFormData();
      if (isPass) createForm.couponType = 4;
      this.setData({
        creating: true,
        isSubmitting: false,
        canCreateCoupon: false,
        createForm,
        createDirty: false,
        couponTypeIndex: isPass ? 4 : 0,
        displayStartTime: '开始日期',
        displayEndTime: '结束日期'
      });
    },

    updateCreateDirty() {
      const dirtyForm = this.data.rewardKind === 'PASS'
        ? Object.assign({}, this.data.createForm, { couponType: 0 })
        : this.data.createForm;
      this.setData({
        createDirty: couponForm.isDirty(dirtyForm),
        canCreateCoupon: couponForm.validate(this.data.createForm).ok
      });
    },

    onCreateName(e) {
      this.setData({ 'createForm.name': e.detail.value }, () => this.updateCreateDirty());
    },

    onCreatePublishCount(e) {
      this.setData({ 'createForm.publishCount': parseInt(e.detail.value, 10) || 0 }, () => this.updateCreateDirty());
    },

    onCreateDescription(e) {
      this.setData({ 'createForm.description': e.detail.value }, () => this.updateCreateDirty());
    },

    onCreateTypeChange(e) {
      const index = Number(e.detail.value);
      this.setData({ couponTypeIndex: index, 'createForm.couponType': index }, () => this.updateCreateDirty());
    },

    // 起止一次选完,不再「确定开始 → 延时 300ms 自动弹出结束」——
    // 那个延时弹窗会盖住表单,而且选结束时看不到刚选的开始时间。
    showCreateStartTimePicker() {
      const { startTime, endTime } = this.data.createForm;
      this.setData({
        rangeValue: [startTime || '', endTime || ''],
        rangePickerShow: true
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
        'createForm.startTime': value[0],
        'createForm.endTime': value[1],
        displayStartTime: this.displayOf(value[0], '开始日期'),
        displayEndTime: this.displayOf(value[1], '结束日期'),
        rangePickerShow: false
      }, () => this.updateCreateDirty());
    },

    // 'YYYY-MM-DD HH:mm:ss' → '11月26日 18:00'(展示口径仍走 coupon-form 那一份,不另写)
    displayOf(value, fallback) {
      const p = datetimeRange.split(value);
      if (!p) return fallback;
      return couponForm.formatDisplayTime(calendar.parse(p.date), +p.time.slice(0, 2), +p.time.slice(3, 5));
    },

    // 退出口只有 ✕/遮罩:走 onCreateRequestClose(dirty 时二次确认,不静默丢数据)。
    // 干净状态下 cy-sheet 照发 close(向后兼容路径),直接关
    onCreateClose() {
      this.setData({ creating: false });
    },

    // dirty=true 时遮罩/✕ 不会自动关,只发这个事件,由发起方决定要不要二次确认
    onCreateRequestClose() {
      if (!this.data.createDirty) {
        this.setData({ creating: false });
        return;
      }
      modal.show({
        title: '放弃创建？',
        content: '已填写的优惠券信息不会保存',
        confirmText: '放弃',
        danger: true, // wx.showModal 只吃字面色值,和 --cy-color-status-danger 保持同一个色值
        success: (res) => {
          if (res.confirm) this.setData({ creating: false });
        }
      });
    },

    onCreateSubmit() {
      if (this.data.isSubmitting) return;
      const formData = this.data.createForm;
      const check = couponForm.validate(formData);
      if (!check.ok) {
        cyToast(check.message);
        return;
      }
      this.setData({ isSubmitting: true });
      couponForm.submitCoupon(app, formData, {
        scope: this.data.scope,
        onSuccess: (res) => {
          const couponId = Number(res.data && res.data.id) || 0;
          this.setData({ creating: false });
          this.loadCoupons();
          // C-31:回包没带 id 时不能挂 0 冒充「已选中」(玩家通关收不到券,作者却以为配好了)
          if (couponId <= 0) {
            app.tips('优惠券已发布，请在列表中选择它');
            return;
          }
          cyToast.success('发布成功');
          // 核心价值:建完直接回选择器且新券自动选中,不用用户再找一遍
          this.emitChange(couponId, formData.name);
        },
        onError: (message) => {
          this.setData({ isSubmitting: false });
          app.tips(message);
        }
      });
    }
  }
});
