const toast = require('../../utils/toast.js');
const app = getApp();

// 后端 /api/coop/complaint/report 仅信任 topicId + reason(过错方/垫付额/状态等一律客服后台设)。
// 投诉类型 / 联系方式后端无独立列,统一并入 reason 文本,避免信息静默丢失。
const COMPLAINT_TYPES = ['服务与履约', '费用与退款', '安全与纠纷', '虚假宣传', '其他'];

Page({
  data: {
    loading: true,
    errorMsg: '',
    topics: [],        // 可投诉对象 [{ id, name }]
    topicIndex: -1,
    types: COMPLAINT_TYPES,
    typeIndex: -1,
    pickerSheet: '',
    reason: '',
    contact: '',
    submitting: false,
    submitError: '',
    submitErrorKind: 'data',
    canSubmit: false,
  },

  onLoad() {
    this.loadTopics();
  },

  onRetry() {
    this.setData({ loading: true, errorMsg: '' });
    this.loadTopics();
  },

  // R3-C04:导航条返回由页面接管。裸 cy-nav-bar 的内建 onBack 只在栈长 > 1 时 navigateBack,
  // 直达/reLaunch 进来时栈长为 1 ⇒ chevron 看得见、点不动(复拍 10 实证)。
  // 兜底页取同域姊妹页既有写法(mycanyu.js 同一句):会员中心是 tabBar 页,必须用 switchTab。
  onBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.switchTab({ url: '/pages/member/index/index' });
  },

  // 可投诉对象 = 我已支付参与的主题。★ 判据在服务端,和受理口
  // /api/coop/complaint/report 读同一份(ICmsRegistrationService.selectComplainableTopics),
  // 前端只负责把 topicId/topicName 铺成下拉项,不再自己拼主题 id。
  //
  // 2026-08-18 换掉了原来的 /api/registration/list?owner_type=3:真库实测坐实它有两个缺陷 ——
  // ① 它末端会过「我参与的」列表的 7 天视觉收纳规则(filterEndedOverWeek),结束超过 7 天的主题
  //    直接从选择源消失,而受理口根本没有时间窗,投诉本就是事后行为;
  // ② 活动单(owner_type=2)既不挂 cmsTopic、registration.topic_id 又恒 null ⇒ 下面这段
  //    `t.id != null ? t.id : item.topicId` 两个来源全空,整行被丢掉,
  //    ③ 自由探索玩家(买活动票、活动 topic_id 指向主题)因此整条选不到对象。
  loadTopics() {
    const that = this;
    const finishLoadError = (res, fallback) => {
      that.setData({ loading: false, errorMsg: app.getRequestErrorMessage(res, fallback) });
    };
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/coop/complaint/topics',
      method: 'POST',
      success(res) {
        if (res.code == 200 || res.code == '200') {
          const rows = res.data || [];
          // 服务端已经去过重、已经 fail-closed 过(反查不出主题的单不会下发);
          // 这里只兜一次 topicId 为空,不自己造兜底 id —— 投错对象会冻结别人的结算。
          const topics = rows
            .filter(function (item) { return item && item.topicId != null; })
            .map(function (item) {
              return { id: item.topicId, name: item.topicName || ('活动#' + item.topicId) };
            });
          that.setData({ topics: topics, loading: false, errorMsg: '' });
        } else {
          finishLoadError(res, '可投诉活动加载失败，请重试');
        }
      },
      successStatusAbnormal(res) {
        finishLoadError(res, '登录状态已失效，请重新进入');
      },
      fail(res) {
        finishLoadError(res, '网络异常，请重试');
      },
    });
  },

  openPickerSheet(e) {
    this.setData({ pickerSheet: e.currentTarget.dataset.picker || '' });
  },

  closePickerSheet() {
    this.setData({ pickerSheet: '' });
  },

  selectPickerOption(e) {
    const picker = e.currentTarget.dataset.picker;
    const index = Number(e.currentTarget.dataset.index);
    if (picker === 'topic') this.setData({ topicIndex: index, pickerSheet: '', submitError: '' }, () => this.refreshSubmitState());
    if (picker === 'type') this.setData({ typeIndex: index, pickerSheet: '', submitError: '' });
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value || '', submitError: '' }, () => this.refreshSubmitState());
  },

  onContactInput(e) {
    this.setData({ contact: e.detail.value || '', submitError: '' });
  },

  refreshSubmitState() {
    const d = this.data;
    const canSubmit = d.topicIndex >= 0 && !!d.topics[d.topicIndex] && (d.reason || '').trim().length >= 5;
    if (canSubmit !== d.canSubmit) this.setData({ canSubmit });
  },

  submit() {
    if (this.data.submitting) return;
    const d = this.data;
    if (d.topicIndex < 0 || !d.topics[d.topicIndex]) {
      toast('请选择投诉的活动');
      return;
    }
    const content = (d.reason || '').trim();
    if (content.length < 5) {
      toast('请填写至少 5 字的投诉内容');
      return;
    }
    // 组装 reason:后端仅存 reason 单字段,把类型/联系方式并入,防信息丢失
    let reason = content;
    if (d.typeIndex >= 0) reason = '【' + d.types[d.typeIndex] + '】' + reason;
    const contact = (d.contact || '').trim();
    if (contact) reason = reason + '\n联系方式：' + contact;

    const that = this;
    this.setData({ submitting: true, submitError: '', submitErrorKind: 'data' });
    // 后端 /api/coop/complaint/report 是 @RequestBody 端点,必须发 JSON;缺 header 会被当 urlencoded 导致投诉提交不上去
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/coop/complaint/report',
      method: 'POST',
      data: JSON.stringify({ topicId: d.topics[d.topicIndex].id, reason: reason }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        if (res.code == 200 || res.code == '200') {
          toast.success('投诉已提交');
          // R4-C04:原为裸 wx.navigateBack() —— 直达/reLaunch 进来时栈长为 1,提交成功后
          // 那一跳什么都不会发生,用户被留在已提交的表单上。复用 onBack() 的栈长兜底,
          // 让栈首也有出口(与导航条返回同一条路径,不再有两套返回语义)。
          setTimeout(function () { that.onBack(); }, 1200);
        } else {
          that.setData({ submitting: false, submitError: res.msg || '提交失败，请重试', submitErrorKind: 'data' });
        }
      },
      successStatusAbnormal(res) {
        that.setData({
          submitting: false,
          submitError: app.getRequestErrorMessage(res, '登录状态已失效，请重新进入'),
          submitErrorKind: 'data',
        });
      },
      fail() {
        that.setData({ submitting: false, submitError: '网络异常，请重试', submitErrorKind: 'network' });
      },
    });
  },
});
