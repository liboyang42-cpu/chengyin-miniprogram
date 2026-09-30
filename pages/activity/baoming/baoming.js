const modal = require('../../../utils/modal.js');
const cyLoading = require('../../../utils/loading.js');
const toast = require('../../../utils/toast.js');
const app = getApp();
const analytics = require('../../../utils/analytics.js');
const subscribe = require('../../../utils/subscribe.js');
const { createCheckoutWorkflow, hasCompletePaymentParams, isOrderExpiredFailure, isTerminalOrderConflict,
  ORDER_REBUILD_REQUIRED, ORDER_EXPIRED_USER_MESSAGE } = require('../../../utils/checkout/checkout-workflow.js');
const { createRegistrationPaymentVerifier } = require('../../../utils/checkout/registration-payment-verifier.js');
const { isRecordList } = require('../../../utils/response-shape.js');
const { ticketWindowPassed, sortBySessionStart } = require('../../../utils/ticket-window.js');

function selectedAddressStorageKey(userId) {
  return userId ? 'selectedAddressId_v1_' + String(userId) : '';
}
const { isValidMobile } = require('../../../utils/form-state.js');
const indexFormat = require('../../../utils/index/index-format.js');
const ticketSource = require('../../../utils/ticket-source.js');
const marketingConsent = require('../../../utils/marketing-consent-entry.js');

// 成功弹窗:停留时长 + 退场动画时长。后者必须和 wxss 里 --cy-motion-slow(350ms) 一致,
// 短了会在动画没播完时就销毁节点(又变成凭空消失),长了会白白多停一截。
const SUCCESS_HOLD_MS = 2000;
/* 等 cy-sheet 播完退场再跳走。250 是 cy-sheet 的 exitMotion(250) 镜像 ——
   WXSS 时长 JS 读不到,只能两处各留一份;改那边记得改这里。 */
const SHEET_EXIT_MS = 250;

function ticketIsSoldOut(ticket) {
  if (!ticket) return false;
  const raw = ticket.remainingInventory;
  if (raw === null || raw === undefined || raw === '') return false;
  const remaining = Number(raw);
  return Number.isFinite(remaining) && remaining <= 0;
}

function parseOfferDeadline(value) {
  if (!value) return '';
  let date = new Date(value);
  if (Number.isNaN(date.getTime())) date = new Date(String(value).replace(/-/g, '/'));
  return Number.isNaN(date.getTime()) ? null : date;
}

// 票种 endTime 在本仓口径里就是「报名截止时间」:详情组件把它标成「报名截止」
// (scene-play-activity-detail/index.wxml:82)并用它拦过入口(:288)。但深链直入本页
// 会绕过那道拦,用户填完整张表才被拒。这里用同一把尺子,在加载时就闸住。
// 缺 endTime 视为「未设截止」不放行拦截 —— 与票种库存未知不判售罄同一条兜底方向。
function ticketSignupClosed(ticket) {
  if (!ticket || !ticket.endTime) return false;
  const end = parseOfferDeadline(ticket.endTime);
  return !!end && Date.now() > end.getTime();
}

function formatOfferDeadline(value) {
  const date = parseOfferDeadline(value);
  if (!date) return '';
  const pad = n => String(n).padStart(2, '0');
  return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' '
    + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function offerDeadlineIsFuture(value, now) {
  const date = parseOfferDeadline(value);
  if (!date) return false;
  const delay = date.getTime() - (now == null ? Date.now() : now);
  // 后端策略上限为 120 分钟；异常超长时间同样 fail-closed，不能扩张付款窗口。
  return delay > 0 && delay <= 121 * 60_000;
}

// CU-C-32(9-25 裁决):换票弹层是「场次选择器」,同日多场要能区分 —— 有开始时间就带上「MM-DD HH:mm」。
function sessionOptionLabel(ticket) {
  const price = '¥' + Number((ticket && ticket.price) || 0).toFixed(2);
  const when = ticket && ticket.startTime ? formatOfferDeadline(ticket.startTime) : '';
  const name = (ticket && ticket.name) || '';
  return name + (when ? ' · ' + when : '') + ' · ' + price;
}

function waitlistEligibilityMessage(eligibility) {
  const messages = {
    NO_SERIES: '本活动未配置候补',
    WAITLIST_CLOSED: '本场候补已关闭',
    NOT_MEMBER: '仅俱乐部正常成员可加入候补',
    ALREADY_REGISTERED: '你已有该票种的有效报名',
    BLOCKED: '你当前无法参与该俱乐部'
  };
  return messages[eligibility] || '当前暂不可加入候补';
}

function waitlistCanJoin(data) {
  const joinableStates = ['NONE', 'AVAILABLE', 'CANCELLED', 'EXPIRED'];
  return !!data.ticketSoldOut && data.waitlistEligibility === 'ELIGIBLE'
    && data.waitlistJoinAllowed === true && joinableStates.includes(data.waitlistState)
    && !data.waitlistLoading;
}

const WAITLIST_STATES = Object.freeze([
  'NONE', 'WAITING', 'OFFERED', 'CLAIMED', 'CONVERTED', 'CANCELLED', 'EXPIRED'
]);
const WAITLIST_ELIGIBILITIES = Object.freeze([
  'NO_SERIES', 'WAITLIST_CLOSED', 'NOT_MEMBER', 'ALREADY_REGISTERED', 'ELIGIBLE', 'BLOCKED'
]);

function normalizeWaitlistStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const state = String(value.state || '').toUpperCase();
  const eligibility = String(value.eligibilityState || '').toUpperCase();
  if (!WAITLIST_STATES.includes(state) || !WAITLIST_ELIGIBILITIES.includes(eligibility)
      || typeof value.waitlistJoinAllowed !== 'boolean') return null;
  const joinAllowed = value.waitlistJoinAllowed === true;
  if (joinAllowed !== (eligibility === 'ELIGIBLE')) return null;
  if (state !== 'NONE' && (!Number.isInteger(Number(value.id)) || Number(value.id) <= 0)) return null;
  if ((state === 'CLAIMED' || state === 'CONVERTED')
      && (!Number.isInteger(Number(value.registrationId)) || Number(value.registrationId) <= 0)) return null;
  if (state === 'OFFERED' && (!value.offerToken || !value.offerExpiresAt)) return null;
  return { entry: value, state, eligibility, joinAllowed };
}

function waitlistPresentation(data) {
  if (data.waitlistEligibility !== 'ELIGIBLE' && data.waitlistEligibility !== 'UNKNOWN') {
    const copy = {
      NO_SERIES: ['本活动未配置候补', '票满后暂不提供排队，请关注其他票种或场次。'],
      WAITLIST_CLOSED: ['本场候补已关闭', '当前不能新加入候补；已有名额仍可直接报名。'],
      NOT_MEMBER: ['仅俱乐部成员可候补', '加入俱乐部并保持正常成员状态后，才能参与本场候补。'],
      ALREADY_REGISTERED: ['你已有该票种报名', '无需重复候补，请从报名订单继续处理。'],
      BLOCKED: ['当前无法参与候补', '你的俱乐部参与资格当前不可用。']
    }[data.waitlistEligibility];
    if (copy) return { title: copy[0], detail: copy[1] };
  }
  if (data.waitlistState === 'CANCELLED') {
    return {
      title: '已退出候补',
      detail: data.ticketSoldOut ? '本票种仍已满，如仍需参加可重新加入候补。' : '当前已有名额，可直接报名。'
    };
  }
  if (data.waitlistState === 'EXPIRED') {
    return {
      title: '候补名额已过期',
      detail: data.ticketSoldOut ? '本票种仍已满，如仍需参加可重新加入候补。' : '当前已有名额，可直接报名。'
    };
  }
  return {
    title: '本票种已满',
    detail: '加入后按先到先得顺序候补；名额保留有时限。'
  };
}

function waitlistPaymentText(data) {
  const eligibilityText = {
    NO_SERIES: '本活动未配置候补',
    WAITLIST_CLOSED: '本场候补已关闭',
    NOT_MEMBER: '仅俱乐部成员可候补',
    ALREADY_REGISTERED: '你已有该票种报名',
    BLOCKED: '当前无法参与候补'
  }[data.waitlistEligibility];
  if (eligibilityText) return eligibilityText;
  const stateText = {
    WAITING: '候补排队中',
    CLAIMED: '已生成报名订单',
    CONVERTED: '报名已确认',
    CANCELLED: '已退出候补',
    EXPIRED: '候补名额已过期'
  }[data.waitlistState];
  return stateText || '等待候补名额';
}

Page({
  /**
   * 页面的初始数据
   */
  data: {
    teamSheetShow: false,
    teamSheetItems: [],
    // B-08:深链缺 ticketId 时原来静默选第一张票,页面上没有换票种入口。多票种时
    // 票种行可点开 cy-option-sheet 重选(用的就是本页 ticketList,不新增取数口径)。
    ticketSheetShow: false,
    ticketSheetItems: [],
    ticketSheetIndex: 0,
    // CU-C-32:换票弹层实际列出的那些票(已剔除过期/已开始的场次)。选项文案与选中下标
    // 必须来自同一份数组 —— 下标回读时拿原始 ticketList 会错位。
    // 活动相关
    activityId: null,
    ticketId: null,
    activityInfo: {},
    // 场次详情:loading / ready / error / missing-param / gate。只有 ready 才渲染活动卡与报名入口,
    // 避免详情拉取失败时页面仍摆出 ¥0 的可点付款按钮。
    // gate = M1-3 俱乐部门卡(非成员):不是加载失败,重试到天荒地老也读不出来,出口是加入俱乐部。
    pageState: 'loading',
    // 活动详情成功渲染过没有。只用来判 auto-back(审查C A1)。
    everLoaded: false,
    loadErrorMsg: '',
    gateClubId: 0,
    skeletonItems: [1, 2, 3],
    ticketList: [],
    selectedTicket: null,
    signupState: 'loading',
    ticketSoldOut: false,
    waitlistState: 'NONE',
    waitlistEligibility: 'UNKNOWN',
    waitlistJoinAllowed: false,
    waitlistLoading: false,
    waitlistError: '',
    waitlistOfferId: null,
    waitlistOfferToken: '',
    waitlistRegistrationId: null,
    waitlistExpiresText: '',
    showWaitlistJoin: false,
    showWaitlistCancel: false,
    waitlistStatusTitle: '',
    waitlistStatusDetail: '',
    waitlistPaymentText: '等待候补名额',
    
    // 参与人信息：历史地址表仅作兼容存储，不再向报名订单提交地址。
    selectedAddress: null,
    addressList: [],
    showAddressPopup: false,
    participantState: 'loading',
    participantErrorMsg: '',
    
    // 订单金额相关
    useDiscount: false,
    discountAmount: 0,
    totalAmount: 0,
    usedPoints: 0,
    clubMemberDiscountAmount: 0,
    clubPrioritySignupEnabled: false,
    isClubMember: false,
    
    // 用户信息（从参与人信息获取）
    userInfo: {
      realName: '',
      phone: '',
      email: '',
      point: 0
    },
    
    // 支付相关
    // 报名成功弹窗(替代原来的 wx.showModal / showToast)
    resultSheet: { show: false, kind: 'success', title: '', sub: '', meta: '', pill: '',
      why: '', primaryText: '', secondaryText: '', duration: SUCCESS_HOLD_MS,
      consentName: '', consentChecked: false, consentState: 'idle', consentError: '' },
    // 向活动主办方提供报名信息(姓名/手机号)的单独同意(PIPL 单独同意)
    hostShareChecked: false,
    // 结算关键前置态同时落在 data，供 UI/自动化回读；私有字段只保留兼容。
    hostShareConsentReady: false,
    quoteReady: false,
    orderInfo: null,
    isPaying: false,
    paymentReady: false,
    paymentReadinessChecking: false,
    canPay: false,
    // 拍板 2026-09-16 #10:所属商家已打烊时禁新报名,入口给明确提示(与后端
    // IMerchantBusinessStatusService.MERCHANT_CLOSED_MESSAGE 同源)。
    merchantClosed: false,
    // 端到端审查 #3:票面报名窗口关闭(closeAtHour)单独成态,按钮文案「报名已截止」
    signupClosed: false,
    verifyingPayment: false,
    submitError: ''
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    const that = this;
    this._skipInitialShow = true;
    this._destroyed = false;
    this._waitlistOfferExpiresAt = null;

    // 获取传递的参数
    const loadOptions = options || {};
    const activityId = loadOptions.activityId;
    const ticketId = loadOptions.ticketId;

    // 缺少活动标识时重试不会让参数凭空出现。直接进入不可重试终态，避免向三个接口
    // 发送无法完成结算的请求；深链首屏和普通页面栈分别由下方两个真实出口承接。
    if (activityId === undefined || activityId === null || String(activityId).trim() === '') {
      that.setData({
        activityId: null,
        ticketId: ticketId || null,
        pageState: 'missing-param',
        signupState: 'unavailable',
        loadErrorMsg: '',
        canPay: false
      });
      return;
    }

    that.setData({
      activityId: activityId,
      ticketId: ticketId
    });
    that.getUserInfo();
    // 获取场次详情
    that.getActivityInfo();

    // 获取参与人信息列表
    that.getAddressList();

    that._initWorkflow();
  },

  /**
   * 获取用户信息（当没有参与人信息时预填）
   */
  getUserInfo() {
    const that = this;
    app.sendRequest({
      url: '/api/user/info',
      data: {
        member_id: app.getUserID()
      },
      method: "POST",
      success: function (res) {
        if (res && res.code == "200" && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
          that._waitlistOfferExpiresAt = null;
          that.setData({
            userInfo: res.data,
            editPhone: res.data.phone || res.data.mobilePhone || '',
            editRealName: res.data.name || res.data.realName || res.data.fullName || ''
          });
        } else {
          // 如果获取失败，使用默认信息
          that.setData({
            userInfo: {
              realName: '',
              phone: '',
              email: '',
              point: 0
            }
          });
        }
      },
      fail: function (res) {
        // 失败时使用默认信息
        that.setData({
          userInfo: {
            realName: '',
            phone: '',
            email: '',
            address: '',
            point: 0
          }
        });
      }
    });
  },

  /**
   * 检查并显示参与人信息弹窗；没有记录时直接进入轻表单。
   */
  checkAndShowAddressPopup() {
    const that = this;
    const { addressList, selectedAddress, participantState } = that.data;

    // 在途/失败都不是「没有参与人」。先展示对应骨架或错误态，避免把未知状态误导成新增流程。
    if (participantState === 'loading' || participantState === 'error') {
      that.showAddressPopup();
      return;
    }
    
    // 如果没有参与人信息，直接跳转到添加页面
    if (addressList.length === 0) {
      that.goToAddAddress();
      return;
    }
    
    // 如果当前没有选中的参与人信息，但是列表非空，显示弹窗选择
    if (!selectedAddress) {
      that.showAddressPopup();
      return;
    }
    
    // 有参与人信息时显示选择弹窗
    that.showAddressPopup();
  },

  /**
   * 获取参与人信息列表（兼容历史 address API 存储）
   */
  getAddressList() {
    const that = this;
    if (that._participantRequest) {
      return that._participantRequest.task || that._participantRequest;
    }
    const epoch = (that._participantEpoch || 0) + 1;
    const requestContext = { task: null };
    that._participantEpoch = epoch;
    that._participantRequest = requestContext;
    const isCurrent = function () {
      return !that._destroyed
        && that._participantEpoch === epoch
        && that._participantRequest === requestContext;
    };
    const finish = function () {
      if (that._participantRequest === requestContext) that._participantRequest = null;
    };
    that.setData({ participantState: 'loading', participantErrorMsg: '' });
    const showLoadError = function (message) {
      if (!isCurrent()) return;
      finish();
      that.setData({
        participantState: that.data.addressList.length > 0 ? 'staleError' : 'error',
        participantErrorMsg: message || '请稍后重试'
      }, () => that.refreshPaymentState());
      console.error('获取参与人信息失败');
      toast('参与人信息加载失败，请重试');
    };
    requestContext.task = app.sendRequest({
      url: '/api/user/address/list',
      method: "POST",
      data: {},
      success: function (res) {
        if (!isCurrent()) return;
        if (res && res.code == "200" && res.data && isRecordList(res.data.rows)) {
          finish();
          const addressList = res.data.rows;
          let selectedAddress = null;
          const storageKey = selectedAddressStorageKey(app.getUserID && app.getUserID());

          // 旧版曾长期缓存姓名、手机号、邮箱等完整对象；升级后立即清掉，只保留当前账号下的 ID。
          try { wx.removeStorageSync('selectedAddress'); } catch (e) {}
          const cachedId = storageKey ? wx.getStorageSync(storageKey) : '';
          if (cachedId !== '' && cachedId !== null && cachedId !== undefined) {
            selectedAddress = addressList.find(item => String(item.id) === String(cachedId)) || null;
          }
          if (!selectedAddress && addressList.length > 0) {
            // 否则选择首个可用参与人信息
            selectedAddress = addressList.find(item => item.isDefault == 1) || addressList[0];
          }
          if (storageKey) {
            if (selectedAddress && selectedAddress.id) wx.setStorageSync(storageKey, selectedAddress.id);
            else wx.removeStorageSync(storageKey);
          }
          
          that.setData({
            addressList: addressList,
            selectedAddress: selectedAddress,
            participantState: 'ready',
            participantErrorMsg: ''
          }, () => {
            // 如果选择了参与人信息，更新用户信息
            if (selectedAddress) {
              that.updateUserInfoFromAddress(selectedAddress);
            }
            that.refreshPaymentState();
          });
        } else {
          showLoadError((res && res.msg) || '返回的数据暂时不可用');
        }
      },
      fail: function (res) {
        showLoadError('网络开了点小差，请稍后重试');
      }
    });
    return requestContext.task;
  },

  retryAddressList() {
    this.getAddressList();
  },

  // 报名页与首页共用日期出口，避免年份、星期顺序再次漂移。
  /* 已报名时的出口。⚠️ 不做「自动跳走」——用户可能是来给别人再报一单的,
     替他决定去哪是「替用户断定」;给一个入口,去不去他说了算。 */
  goMySignups() {
    wx.navigateTo({
      url: '/subpackageMember/mycanyu/mycanyu',
      fail() { wx.switchTab({ url: '/pages/member/index/index' }); },
    });
  },

  formatDateTimeForDisplay: function(date) {
    return indexFormat.formatDateTimeForDisplay(date);
  },
  /**
   * 从参与人信息更新报名联系人；不读取或提交历史地址字段。
   */
  updateUserInfoFromAddress(address) {
    const that = this;
    if (!address) return;
    
    const newUserInfo = {
      realName: address.fullName || address.realName || '',
      phone: address.mobilePhone || address.phone || '',
      email: address.email || '',
      point: address.point || that.data.userInfo.point || 0
    };
    
    that.setData({
      userInfo: newUserInfo
    });
  },

  /**
   * 显示参与人信息选择弹窗
   */
  showAddressPopup() {
    const that = this;
    that.setData({
      showAddressPopup: true
    });
  },

  /**
   * 隐藏参与人信息选择弹窗
   */
  hideAddressPopup() {
    this.setData({
      showAddressPopup: false
    });
  },

  /**
   * 选择参与人信息（在弹窗中）
   */
  selectAddress(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({
      selectedAddress: item,
      showAddressPopup: false,
      submitError: ''
    }, () => {
      // 更新用户信息
      this.updateUserInfoFromAddress(item);
      const storageKey = selectedAddressStorageKey(app.getUserID && app.getUserID());
      if (storageKey && item && item.id) wx.setStorageSync(storageKey, item.id);
      this.refreshPaymentState();
    });
  },

  /**
   * 确认参与人信息选择
   */
  confirmAddressSelection() {
    const that = this;
    const { selectedAddress } = that.data;
    
    if (!selectedAddress) {
      app.tips('请选择参与人信息');
      return;
    }
    
    const storageKey = selectedAddressStorageKey(app.getUserID && app.getUserID());
    if (storageKey && selectedAddress.id) wx.setStorageSync(storageKey, selectedAddress.id);
    
    that.setData({
      showAddressPopup: false
    }, () => {
      // 更新用户信息
      that.updateUserInfoFromAddress(selectedAddress);
    });
    
    toast.success('参与人信息已选择');
  },

  /**
   * 跳转到参与人信息列表页面
   */
  goToAddressList() {
    const that = this;
    
    wx.navigateTo({
      url: '/pages/address/address?mode=participant',
      success: function(res) {
        // 监听参与人信息页面返回
        res.eventChannel.on('addressSelected', (data) => {
          if (data && data.address) {
            that.handleAddressSelected(data.address);
          }
        });
      }
    });
  },

  /**
   * 跳转到添加参与人信息页面
   */
  goToAddAddress() {
    const that = this;
    
    wx.navigateTo({
      url: '/pages/addressinfo/addressinfo?mode=participant',
      events: {
        // 监听从参与人信息页面返回的事件
        addressAdded: function(data) {
          // 重新获取参与人信息列表
          that.getAddressList();
          if (data && data.address) {
            that.handleAddressSelected(data.address);
          }
          // 隐藏弹窗（如果还显示的话）
          that.hideAddressPopup();
        }
      },
      success: function(res) {
        // 保留来源参数给历史页面兼容。
        res.eventChannel.emit('fromPage', {
          from: 'baoming',
          activityId: that.data.activityId
        });
      }
    });
  },

  /**
   * 处理从参与人信息页面返回的选择
   */
  handleAddressSelected(address) {
    const that = this;
    
    const storageKey = selectedAddressStorageKey(app.getUserID && app.getUserID());
    if (storageKey && address && address.id) wx.setStorageSync(storageKey, address.id);
    
    that.setData({
      selectedAddress: address,
      showAddressPopup: false,
      submitError: ''
    }, () => {
      // 更新用户信息
      that.updateUserInfoFromAddress(address);
      that.refreshPaymentState();
    });
  },

  /**
   * 获取场次详情
   */
  getActivityInfo() {
    const that = this;
    if (that.data.activityId === undefined || that.data.activityId === null
      || String(that.data.activityId).trim() === '') {
      that.setData({ pageState: 'missing-param', signupState: 'unavailable', canPay: false });
      return null;
    }
    if (that._activityInfoRequest) {
      return that._activityInfoRequest.task || that._activityInfoRequest;
    }
    const epoch = (that._activityInfoEpoch || 0) + 1;
    const requestContext = { task: null };
    that._activityInfoEpoch = epoch;
    that._activityInfoRequest = requestContext;
    const isCurrent = function () {
      return !that._destroyed
        && that._activityInfoEpoch === epoch
        && that._activityInfoRequest === requestContext;
    };
    const finish = function () {
      if (that._activityInfoRequest === requestContext) that._activityInfoRequest = null;
    };
    that.setData({
      pageState: 'loading', signupState: 'loading', loadErrorMsg: '',
      canPay: false, signupClosed: false,
    });
    requestContext.task = app.sendRequest({
      url: '/api/activity/info',
      autoErrorToast: false, // 失败由整页 auto-back fail 半屏讲原因,不再叠 toast
      data: {
        id: that.data.activityId
      },
      method: "POST",
      success: function (res) {
        if (!isCurrent()) return;
        // 只有「非数组对象 + 带非空 id」才算真拿到场次:后端偶发返回 {} / [] 时
        // 旧逻辑会判成功,页面就摆出 ¥0 空活动卡和可点付款按钮。
        const d = res && res.data;
        // M1-3 门卡:俱乐部活动对非成员只回 {gate:true,...}。以前它落进下面的 error 分支,
        // 页面说「活动信息没能加载出来」还给一个永远失败的重试。
        if (res && res.code == '200' && d && typeof d === 'object' && !Array.isArray(d) && d.gate === true) {
          finish();
          that.setData({
            pageState: 'gate',
            signupState: 'unavailable',
            canPay: false,
            gateClubId: Number(d.clubId) || 0,
            loadErrorMsg: d.message || '来自俱乐部的活动，加入后查看',
          });
          return;
        }
        const hasActivity = !!d && typeof d === 'object' && !Array.isArray(d)
          && !!d.id;
        const rawTickets = hasActivity ? d.omsTicketList : null;
        const hasValidTickets = rawTickets == null || (isRecordList(rawTickets)
          && rawTickets.every(function (ticket) {
            return ticket.id != null && ticket.id !== ''
              && typeof ticket.price === 'number' && Number.isFinite(ticket.price)
              && ticket.price >= 0;
          }));
        if (res && res.code == "200" && hasActivity && hasValidTickets) {
          finish();
          const activityInfo = res.data;
          let ticketList = [];
          let selectedTicket = null;

          // 空值保护:startDate 缺失时 .replace 会抛错中断整页;空串→Invalid Date 由下行 isNaN 接住
          const startDate = new Date(String(activityInfo['startDate'] || '').replace(/-/g, '/'));
          if (!isNaN(startDate.getTime())) {
            activityInfo['formattedDateTime'] = that.formatDateTimeForDisplay(startDate);
          }

          // 处理票务数据
          if (activityInfo.omsTicketList && activityInfo.omsTicketList.length > 0) {
            ticketList = activityInfo.omsTicketList;

            // CU-C-32:票列表原来原样收下、默认选第一张。库里有 9.22 的条目时,
            // 9.23 打开结算页会直接停在过期场次上;而换票弹层又把全量都列出来,
            // 用户能选回去。显式指定了 ticketId 就尊重它(已过期也要如实告诉用户
            // 这一场不能报),否则默认落在第一个还能卖的场次。
            const requestedTicket = that.data.ticketId
              ? ticketList.find(item => item.id == that.data.ticketId)
              : null;
            const sellableTickets = ticketList.filter(item => !ticketWindowPassed(item));
            selectedTicket = requestedTicket || sellableTickets[0] || ticketList[0];
          }

          // 确保总金额保留两位小数
          const totalAmount = selectedTicket ? parseFloat(selectedTicket.price.toFixed(2)) : 0;

          that.setData({
            activityInfo: activityInfo,
            merchantClosed: activityInfo.merchantClosed === true,
            ticketList: ticketList,
            selectedTicket: selectedTicket,
            ticketSoldOut: ticketIsSoldOut(selectedTicket),
            waitlistState: 'LOADING',
            waitlistEligibility: 'UNKNOWN',
            waitlistJoinAllowed: false,
            waitlistError: '',
            waitlistOfferId: null,
            waitlistOfferToken: '',
            waitlistRegistrationId: null,
            waitlistExpiresText: '',
            totalAmount: totalAmount,
            signupState: selectedTicket
              ? ((ticketSignupClosed(selectedTicket) || ticketWindowPassed(selectedTicket)) ? 'closed' : 'available')
              : 'unavailable',
            pageState: 'ready',
            everLoaded: true,
            loadErrorMsg: ''
          }, () => {
            // 数据设置完成后重新计算折扣
            that.recalculateDiscount();
            that.loadWaitlistStatus();
          });
        } else {
          finish();
          that.setData({ pageState: 'error', signupState: 'error', loadErrorMsg: (res && res.msg) || '请稍后重试' });
        }
      },
      fail: function (res) {
        if (!isCurrent()) return;
        finish();
        that.setData({ pageState: 'error', signupState: 'error', loadErrorMsg: '网络开了点小差，请稍后重试' });
      }
    });
    return requestContext.task;
  },

  /**
   * 错误态重试:沿用当前 activityId/ticketId 重新拉详情。
   */
  retryActivityInfo() {
    if (this.data.pageState === 'loading') return;
    this.getActivityInfo();
  },

  // B-08:换票种。只在多票种且没有待支付的候补名额时开放 —— OFFERED 是真实票库存 hold,
  // 换票会让那份 hold 与 ticketId 对不上,页面上另有候补卡的付款出口,这里不抢它。
  openTicketSheet() {
    const list = this.data.ticketList || [];
    if (list.length < 2 || this.data.waitlistState === 'OFFERED') return;
    // CU-C-32:换票弹层不出过期/已开始的场次(原来列全量,选回去就又是一张不能报的票)。
    // 选项按场次开始时间升序,同日多场靠带上时间区分。
    // 选项与索引必须来自同一份数组 —— onTicketSheetSelect 按下标回读,这里存下来给它用。
    const sellable = sortBySessionStart(list.filter((ticket) => !ticketWindowPassed(ticket)));
    if (sellable.length < 2) return;
    const selected = this.data.selectedTicket;
    const currentIndex = Math.max(0, sellable.findIndex((ticket) => selected && ticket.id == selected.id));
    this._ticketSheetList = sellable;   // 只给 onTicketSheetSelect 按下标回读,不进视图
    this.setData({
      ticketSheetItems: sellable.map(sessionOptionLabel),
      ticketSheetIndex: currentIndex,
      ticketSheetShow: true,
    });
  },

  closeTicketSheet() {
    this.setData({ ticketSheetShow: false });
  },

  onTicketSheetSelect(e) {
    const index = Number(e && e.detail && e.detail.index);
    // CU-C-32:读的是 openTicketSheet 过滤后的那份列表,与选项顺序一一对应。
    const ticket = (this._ticketSheetList || [])[index];
    this.setData({ ticketSheetShow: false });
    if (!ticket) return;
    const selected = this.data.selectedTicket;
    if (selected && ticket.id == selected.id) return;
    // 与首次加载同一套状态重置:金额/售罄/候补都跟着新票种走,报价由 recalculateDiscount
    // 末尾的 refreshQuote 重新向服务端要(quoteSign 是绑定 ticketId 的,不能复用旧的)。
    this.setData({
      selectedTicket: ticket,
      totalAmount: parseFloat(Number(ticket.price).toFixed(2)),
      ticketSoldOut: ticketIsSoldOut(ticket),
      signupState: 'available',
      waitlistState: 'LOADING',
      waitlistEligibility: 'UNKNOWN',
      waitlistJoinAllowed: false,
      waitlistError: '',
      waitlistOfferId: null,
      waitlistOfferToken: '',
      waitlistRegistrationId: null,
      waitlistExpiresText: '',
      submitError: '',
    }, () => {
      this.recalculateDiscount();
      this.loadWaitlistStatus();
    });
  },

  onNavBack() {
    const fallback = function () {
      wx.redirectTo({ url: '/pages/activity/list/index' });
    };
    if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1) {
      wx.navigateBack({ fail: fallback });
      return;
    }
    fallback();
  },

  goDiscoverActivities() {
    wx.redirectTo({ url: '/pages/activity/list/index' });
  },

  // 门卡出口:这是一条真实可达路径(主题货架/收藏里点进来的俱乐部场次),
  // 唯一能解锁报名的动作是加入俱乐部,所以不给重试,只给这一条路。
  goGateClub() {
    const clubId = Number(this.data.gateClubId) || 0;
    if (clubId > 0) {
      wx.navigateTo({ url: '/pages/club/detail/index?id=' + clubId });
      return;
    }
    this.goDiscoverActivities();
  },

  /** 当前成员在本活动+票种的候补真状态；OFFERED 才会返回短期原始 token。 */
  loadWaitlistStatus() {
    const that = this;
    const ticket = that.data.selectedTicket;
    if (!that.data.activityId || !ticket || !ticket.id) return;
    that.setData({ waitlistLoading: true, waitlistError: '' });
    app.sendRequest({
      url: '/api/club/event-ops/waitlist/status',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      hideLoading: true,
      data: JSON.stringify({ activityId: that.data.activityId, ticketId: ticket.id }),
      success(res) {
        if (!res || (res.code != 200 && res.code != '200')) {
          that.setData({ waitlistLoading: false, waitlistState: 'ERROR', waitlistError: (res && res.msg) || '候补状态加载失败' },
            () => that.refreshPaymentState());
          return;
        }
        const normalized = normalizeWaitlistStatus(res.data);
        if (!normalized) {
          that._waitlistOfferExpiresAt = null;
          that.setData({
            waitlistLoading: false,
            waitlistState: 'UNKNOWN',
            waitlistEligibility: 'UNKNOWN',
            waitlistJoinAllowed: false,
            waitlistError: '候补状态数据不完整，请重试',
            waitlistOfferId: null,
            waitlistOfferToken: '',
            waitlistRegistrationId: null,
            waitlistExpiresText: ''
          }, () => that.refreshPaymentState());
          return;
        }
        const entry = normalized.entry;
        let state = normalized.state;
        const eligibility = normalized.eligibility;
        const joinAllowed = normalized.joinAllowed;
        const activeOffer = state === 'OFFERED' && entry && entry.id && entry.offerToken
          && offerDeadlineIsFuture(entry.offerExpiresAt);
        if (state === 'OFFERED' && !activeOffer) state = 'EXPIRED';
        const offerId = activeOffer ? entry.id : null;
        const offerToken = activeOffer ? entry.offerToken : '';
        that._waitlistOfferExpiresAt = activeOffer ? entry.offerExpiresAt : null;
        that.setData({
          waitlistLoading: false,
          waitlistState: state,
          waitlistEligibility: eligibility,
          waitlistJoinAllowed: joinAllowed,
          waitlistError: '',
          waitlistOfferId: offerId,
          waitlistOfferToken: offerToken,
          waitlistRegistrationId: entry && entry.registrationId || null,
          waitlistExpiresText: activeOffer ? formatOfferDeadline(entry.offerExpiresAt) : ''
        }, function () {
          that.refreshPaymentState();
          that.scheduleWaitlistOfferExpiry();
          if (activeOffer) that.refreshQuote();
        });
      },
      fail() {
        that.setData({ waitlistLoading: false, waitlistState: 'ERROR', waitlistError: '网络错误，请重试候补状态' },
          () => that.refreshPaymentState());
      }
    });
  },

  retryWaitlistStatus() {
    if (this.data.waitlistLoading) return;
    this.loadWaitlistStatus();
  },

  scheduleWaitlistOfferExpiry() {
    clearTimeout(this._waitlistOfferTimer);
    this._waitlistOfferTimer = null;
    const deadline = parseOfferDeadline(this._waitlistOfferExpiresAt);
    if (!deadline || this.data.waitlistState !== 'OFFERED') return;
    const delay = deadline.getTime() - Date.now();
    if (delay <= 0) {
      this.expireWaitlistOfferInView();
      return;
    }
    if (delay > 121 * 60_000) {
      this.expireWaitlistOfferInView();
      return;
    }
    const that = this;
    this._waitlistOfferTimer = setTimeout(function () {
      that.expireWaitlistOfferInView();
      that.loadWaitlistStatus();
    }, delay + 50);
  },

  expireWaitlistOfferInView() {
    if (this.data.waitlistState !== 'OFFERED') return;
    clearTimeout(this._waitlistOfferTimer);
    this._waitlistOfferTimer = null;
    this._waitlistOfferExpiresAt = null;
    this.setData({
      waitlistState: 'EXPIRED',
      waitlistOfferId: null,
      waitlistOfferToken: '',
      waitlistExpiresText: ''
    }, () => this.refreshPaymentState());
  },

  joinWaitlist() {
    const that = this;
    const ticket = that.data.selectedTicket;
    if (that.data.waitlistLoading || !ticket || !ticket.id) return;
    if (!that.data.ticketSoldOut) {
      app.tips('当前已有名额，请直接报名');
      return;
    }
    if (!waitlistCanJoin(that.data)) {
      app.tips(waitlistEligibilityMessage(that.data.waitlistEligibility));
      return;
    }
    that.setData({ waitlistLoading: true, waitlistError: '' });
    app.sendRequest({
      url: '/api/club/event-ops/waitlist/join',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ activityId: that.data.activityId, ticketId: ticket.id }),
      success(res) {
        if (res && (res.code == 200 || res.code == '200') && res.data) {
          that.setData({ waitlistLoading: false, waitlistState: 'WAITING', waitlistError: '' },
            () => that.refreshPaymentState());
          return;
        }
        that.setData({ waitlistLoading: false, waitlistState: 'ERROR', waitlistError: (res && res.msg) || '加入候补失败' },
          () => that.refreshPaymentState());
      },
      fail() {
        that.setData({ waitlistLoading: false, waitlistState: 'ERROR', waitlistError: '网络错误，请重试加入候补' },
          () => that.refreshPaymentState());
      }
    });
  },

  cancelWaitlist() {
    const that = this;
    const ticket = that.data.selectedTicket;
    if (that.data.waitlistLoading || !ticket || !ticket.id) return;
    modal.show({
      dangerKey: 'waitlist.quit',   // 三段式文案在 utils/danger-actions.js
      success(result) {
        if (!result.confirm) return;
        that.setData({ waitlistLoading: true, waitlistError: '' });
        app.sendRequest({
          url: '/api/club/event-ops/waitlist/cancel',
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: JSON.stringify({ activityId: that.data.activityId, ticketId: ticket.id }),
          success(res) {
            if (res && (res.code == 200 || res.code == '200')) {
              clearTimeout(that._waitlistOfferTimer);
              that._waitlistOfferTimer = null;
              that._waitlistOfferExpiresAt = null;
              that.setData({
                // OFFERED 取消会真实回补并可能立即晋级下一位；旧票对象已经失真，
                // 先封闭本地操作，再重拉活动票库存与候补状态。
                waitlistLoading: true,
                waitlistState: 'LOADING',
                waitlistEligibility: 'UNKNOWN',
                waitlistJoinAllowed: false,
                waitlistOfferId: null,
                waitlistOfferToken: '',
                waitlistRegistrationId: null,
                waitlistExpiresText: ''
              }, function () {
                that.refreshPaymentState();
                that.getActivityInfo();
              });
              return;
            }
            that.setData({ waitlistLoading: false, waitlistState: 'ERROR', waitlistError: (res && res.msg) || '退出候补失败' },
              () => that.refreshPaymentState());
          },
          fail() {
            that.setData({ waitlistLoading: false, waitlistState: 'ERROR', waitlistError: '网络错误，请重试退出候补' },
              () => that.refreshPaymentState());
          }
        });
      }
    });
  },

  goWaitlistOrder() {
    const id = this.data.waitlistRegistrationId;
    if (!id) { app.tips('报名订单尚未就绪，请稍后刷新'); return; }
    wx.navigateTo({ url: '/subpackageMember/orderinfo/orderinfo?id=' + id + '&from=waitlist' });
  },

  /**
   * 切换折扣使用
   */
  toggleDiscount() {
    const that = this;
    const useDiscount = !that.data.useDiscount;
    
    let discountAmount = 0;
    let usedPoints = 0;
    
    if (useDiscount) {
      // 计算可抵扣金额：1积分 = 0.02元
      const maxDiscount = 50; // 最多抵扣50元
      const pointValue = 0.02; // 1积分价值
      
      // 获取用户积分
      const userPoints = that.data.userInfo.point || 0;
      const calculatedDiscount = userPoints * pointValue;
      
      // 取计算值和最大值中的较小值
      discountAmount = Math.min(calculatedDiscount, maxDiscount);
      
      // 如果票务价格小于可抵扣金额，则最多抵扣票务价格
      const ticketPrice = that.data.selectedTicket ? that.data.selectedTicket.price : 0;
      discountAmount = Math.min(discountAmount, ticketPrice);
      
      // 保留两位小数
      discountAmount = Math.round(discountAmount * 100) / 100;
      
      // 计算实际使用的积分
      let theoreticalPoints = Math.round(discountAmount / pointValue);
      
      const maxPointsFromDiscount = Math.floor(maxDiscount / pointValue);
      const maxPointsFromPrice = Math.floor(ticketPrice / pointValue);
      
      usedPoints = Math.min(
        theoreticalPoints,
        userPoints,
        maxPointsFromDiscount,
        maxPointsFromPrice
      );
      
      // 重新计算实际的折扣金额
      discountAmount = Math.min(usedPoints * pointValue, ticketPrice, maxDiscount);
      discountAmount = Math.round(discountAmount * 100) / 100;
    }
    
    // 计算总金额
    const baseAmount = that.data.selectedTicket ? that.data.selectedTicket.price : 0;
    const totalAmount = Math.max(0, baseAmount - discountAmount);
    
    that.setData({
      useDiscount: useDiscount,
      discountAmount: discountAmount,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      usedPoints: usedPoints,
      submitError: ''
    }, () => that.refreshPaymentState());
    // M0-1 实扣报价一致:本地仅做即时估算,随即用服务端 quote 覆盖为权威金额
    that.refreshQuote();
  },

  /**
   * 服务端报价(M0-1):用后端 /api/registration/quote 覆盖本地估算,保证「展示金额 = 微信实付」。
   * 返回的 quoteSign 存 that._quoteSign,下单时回传;后端重算不一致返回 409。
   */
  refreshQuote() {
    const that = this;
    const ticket = that.data.selectedTicket;
    if (!ticket || !that.data.activityId) return;
    if (that.data.ticketSoldOut && that.data.waitlistState !== 'OFFERED') {
      that._quoteSign = '';
      that.setData({ quoteReady: false });
      return;
    }
    that._quoteSign = '';
    // 退款性是纯闸门判据不进视图:data 里的字段必须被 wxml 渲染(U4 死数据门禁),
    // 与 _nonRefundableConfirmed 同族走实例属性。null/undefined=未知(旧 jar)⇒ 不拦。
    that._quoteRetried = false;
    that._nonRefundableConfirmed = false;
    that._quoteRefundableNow = null;
    that.setData({ quoteReady: false });
    app.sendRequest({
      url: '/api/registration/quote',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        ownerType: 2,
        ownerId: that.data.activityId,
        ticketId: ticket.id,
        isUsePoint: that.data.useDiscount ? 1 : 0,
        waitlistOfferId: that.data.waitlistOfferId || null,
        waitlistOfferToken: that.data.waitlistOfferToken || null
      }),
      success: function (res) {
        if (res && (res.code == '200' || res.code == 200) && res.data) {
          const pay = Number(res.data.payAmount || 0);
          const pd = Number(res.data.pointsDeductYuan || 0);
          const clubDiscount = Number(res.data.memberDiscountYuan || 0);
          that._quoteSign = res.data.quoteSign || '';
          // 1-22 附注(拍板 2026-09-19 第6条):下单前退款性由后端唯一场次钟判定,null=旧 jar 未下发,
          // 前端零动作 —— 不许在这里自己按 startDate 减 24h 造第二口钟。
          const refundableNow = res.data.refundableNow === true || res.data.refundableNow === false
            ? res.data.refundableNow : null;
          that._quoteRefundableNow = refundableNow;
          that.setData({
            quoteReady: !!that._quoteSign,
            totalAmount: parseFloat(pay.toFixed(2)),
            discountAmount: parseFloat(pd.toFixed(2)),
            usedPoints: res.data.pointsUsed || 0,
            clubMemberDiscountAmount: parseFloat(clubDiscount.toFixed(2)),
            clubPrioritySignupEnabled: res.data.prioritySignupEnabled === true,
            isClubMember: res.data.clubMember === true,
            paymentReady: pay <= 0 ? true : that.data.paymentReady
          }, () => that.refreshPaymentState());
          that._quoteRefundableNow = refundableNow;
          // D2:探店日等票种服务端关闭积分抵扣 —— 用户开了开关而权威报价回 0,
          // 就收起整行并说明,不留一个勾着却 -¥0.00 的死开关。
          if (that.data.useDiscount && pd <= 0) {
            const noPoints = !(Number((that.data.userInfo || {}).point) > 0);
            that.setData({ useDiscount: false, pointsUsable: false });
            toast(noPoints ? '暂无可用积分' : '该票不支持积分抵扣');   // T32:0 积分用户的真实原因是没积分
          }
          if (pay > 0) that.checkPaymentReadiness();
        }
      }
    });
  },

  /**
   * 重新计算折扣
   */
  recalculateDiscount() {
    const that = this;
    const { useDiscount, userInfo, selectedTicket } = that.data;
    
    if (useDiscount) {
      let discountAmount = 0;
      let usedPoints = 0;
      
      // 计算可抵扣金额
      const maxDiscount = 50;
      const pointValue = 0.02;
      const userPoints = userInfo.point || 0;
      const ticketPrice = selectedTicket ? selectedTicket.price : 0;
      
      // 计算理论最大可抵扣金额
      const calculatedDiscount = userPoints * pointValue;
      discountAmount = Math.min(calculatedDiscount, maxDiscount, ticketPrice);
      discountAmount = Math.round(discountAmount * 100) / 100;
      
      // 计算实际使用的积分
      let theoreticalPoints = Math.round(discountAmount / pointValue);
      
      const maxPointsFromDiscount = Math.floor(maxDiscount / pointValue);
      const maxPointsFromPrice = Math.floor(ticketPrice / pointValue);
      
      usedPoints = Math.min(
        theoreticalPoints,
        userPoints,
        maxPointsFromDiscount,
        maxPointsFromPrice
      );
      
      // 重新计算实际的折扣金额
      discountAmount = Math.min(usedPoints * pointValue, ticketPrice, maxDiscount);
      discountAmount = Math.round(discountAmount * 100) / 100;
      
      // 计算总金额
      const totalAmount = Math.max(0, ticketPrice - discountAmount);
      
      that.setData({
        discountAmount: discountAmount,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        usedPoints: usedPoints
      }, () => that.refreshPaymentState());
    } else {
      // 如果不使用折扣，重置使用的积分为0
      const ticketPrice = selectedTicket ? selectedTicket.price : 0;
      that.setData({
        totalAmount: parseFloat(ticketPrice.toFixed(2)),
        usedPoints: 0
      }, () => that.refreshPaymentState());
    }
    // M0-1:用服务端 quote 覆盖为权威金额
    that.refreshQuote();
  },

  /* 报名/支付成功:弹上来 → 停 2s → 自己弹下去 → 跳订单详情。
     用 redirectTo 不用 navigateTo:结算页已经完成使命,留在栈里的话用户从订单页
     返回会掉回一个"订单已创建"的结算页,还能再点一次付款。
     ⚠️ 两个定时器都要在 onUnload 里清:用户手动返回时页面已销毁,定时器还在跑,
     到点会对着死页面 setData 并强行 redirect。 */
  /* 2026-09-06 用户裁决:买完就直接跳,面板上不放按钮 —— B 模式(teamMode=2)也一样。
     建队入口没有丢:落地的订单详情页有「和队友一起出发」整张卡(见
     components/cy/scene-member-order-detail/index.wxml 的 teamMode == 2 分支,
     文案同样写明「组队与否不影响活动举行」)。面板本来就是要跳去那一页的,
     等于把入口放在了用户下一秒就会看到的地方,而不是拦在半路让他先选一次。 */
  showSignupSuccess({ title, detail }) {
    this.setData({
      resultSheet: {
        show: true, kind: 'success', title: title, sub: detail, meta: '',
        pill: '', why: '', primaryText: '', secondaryText: '', duration: SUCCESS_HOLD_MS,
        consentName: '', consentChecked: false, consentState: 'idle', consentError: '',
      },
    });
    // 2026-09-17 拍板第 40 条 A:这单背后有生效商家且尚未同意时,面板里多一行可选勾选。
    // 拿不到 / 已同意 / 有歧义一律不出(见 utils/marketing-consent-entry.js)。
    this._loadMarketingConsentOffer((this.data.activityInfo && this.data.activityInfo.memberId) || 0);
  },

  /* 同意入口:owner memberId 来自活动详情已返回的 memberId;商家一方 id 只认 GET 回包。
     面板已收掉就不再补塞 —— 错过的用户在订单详情「权益已核销」处还有兜底入口。 */
  _loadMarketingConsentOffer(ownerMemberId) {
    const that = this;
    that._consentOffer = null;
    that._consentRequestId = null;
    marketingConsent.loadOffer(app, ownerMemberId, function (offer) {
      if (!offer) return;
      if (!that.data.resultSheet || !that.data.resultSheet.show) return;
      that._consentOffer = offer;
      that._consentRequestId = marketingConsent.newRequestId('signup');
      that.setData({
        'resultSheet.consentName': offer.merchantName,
        'resultSheet.consentChecked': false,
        'resultSheet.consentState': 'idle',
        'resultSheet.consentError': '',
      });
    });
  },

  onResultConsentChange(e) {
    const checked = !!(e.detail && e.detail.checked);
    const state = this.data.resultSheet.consentState;
    if (state === 'saving') return;                       // 在途结果说了算,勾选态不来回抖
    if (!checked) {
      this.setData({ 'resultSheet.consentChecked': false, 'resultSheet.consentState': 'idle', 'resultSheet.consentError': '' });
      return;
    }
    if (!this._consentOffer) return;
    this._submitMarketingConsent(this._consentOffer);
  },

  onResultConsentRetry() {
    if (!this._consentOffer || this.data.resultSheet.consentState === 'saving') return;
    this._submitMarketingConsent(this._consentOffer);
  },

  /* 同一次勾选意图(含失败重试)复用同一个 requestId:重放由服务端识别,不写第二条。 */
  _submitMarketingConsent(offer) {
    const that = this;
    if (!that._consentRequestId) that._consentRequestId = marketingConsent.newRequestId('signup');
    that.setData({ 'resultSheet.consentChecked': true, 'resultSheet.consentState': 'saving', 'resultSheet.consentError': '' });
    marketingConsent.optIn(app, offer, that._consentRequestId, function (result) {
      if (result.ok) {
        // 成功态就是面板上那行「已同意,可在设置里随时退订」—— 不再补一发两秒就没的 toast
        // (成功 toast 棘轮只减不增:提示不替代状态)。
        that.setData({ 'resultSheet.consentState': 'saved', 'resultSheet.consentError': '' });
        return;
      }
      that.setData({ 'resultSheet.consentState': 'failed',
        'resultSheet.consentError': result.message || '同意没有保存成功，请重试' });
    });
  },

  /* 面板自己收完(或被划走)才跳走。退场动画归 cy-sheet,这里只等它播完 ——
     直接 redirect 的话页面当场销毁,用户看到的是"凭空消失"。 */
  onResultSheetClose() {
    const that = this;
    const wasSuccess = that.data.resultSheet.kind === 'success';
    that.setData({ 'resultSheet.show': false });
    if (!wasSuccess) return;   // 失败态收掉只是关面板,留在结算页重试
    that._successLeaveTimer = setTimeout(function () {
      if (that._destroyed) return;
      wx.redirectTo({
        url: '/subpackageMember/orderinfo/orderinfo?id=' + (that._regId || '') + '&from=signup',
      });
    }, SHEET_EXIT_MS);
  },

  noop() {},

  /* 2026-09-06:报名成功面板去掉两颗按钮(用户裁决「买完直接跳」)后,
     goToOrderDetail / startPostSignupTeam / onTeamSheetSelect / onTeamSheetCancel
     在本页都没有调用点了,连同 creatingTeam / teamSheetItems / teamSheetShow 一起删。
     ⚠️ 不是把 master 2026-09-02 的 cy-option-sheet 改造回退掉 —— 那套改造在
     components/cy/scene-member-order-detail 里有**完全相同的一份**(startOrderTeam →
     teamUp.memberSheet → cy-option-sheet),而面板收掉后正是跳去那一页。
     所以这里删的是重复的那份,建队能力与改良后的选择器都还在。 */
  finishSignup(successCopy) {
    this.showSignupSuccess(successCopy)
  },

  /**
   * 切换「向主办方提供信息」单独同意
   */
  toggleHostShare() {
    const checked = !this.data.hostShareChecked;
    if (!checked) this._hostShareConsentReady = false;
    this.setData({
      hostShareChecked: checked,
      hostShareConsentReady: checked ? this.data.hostShareConsentReady : false,
      submitError: '',
    }, () => this.refreshPaymentState());
  },

  refreshPaymentState() {
    const data = this.data;
    const activeOffer = data.waitlistState === 'OFFERED' && !!data.waitlistOfferId
      && !!data.waitlistOfferToken && offerDeadlineIsFuture(this._waitlistOfferExpiresAt);
    const waitlistAllowsCheckout = !data.ticketSoldOut || activeOffer;
    // 票种过了报名截止,常规这条路当场关掉(原来能一路填到建单才被动拒)。候补名额除外:
    // 它的售止口径是 signupDeadline ?? startTime,不是票的 endTime,拿着未过期凭证的人不该误伤。
    // CU-C-32:履约窗(场次)已过与「报名已截止」同归这条闸 —— 两者都意味着这一场不能报。
    const signupClosed = (ticketSignupClosed(data.selectedTicket) || ticketWindowPassed(data.selectedTicket))
      && !activeOffer;
    const canPay = data.pageState === 'ready' && !!data.selectedTicket && !signupClosed
      && data.hostShareChecked && !!data.selectedAddress
      && !data.merchantClosed
      && waitlistAllowsCheckout
      && data.waitlistEligibility !== 'ALREADY_REGISTERED'
      && !(Number(data.totalAmount) > 0 && data.paymentReady === false) && !data.isPaying;
    const presentation = waitlistPresentation(data);
    const paymentText = waitlistPaymentText(data);
    const showWaitlistJoin = waitlistCanJoin(data);
    const showWaitlistCancel = ['WAITING', 'OFFERED'].includes(data.waitlistState)
      && data.waitlistEligibility !== 'NO_SERIES' && !data.waitlistLoading;
    this.setData({
      canPay,
      signupClosed,
      showWaitlistJoin,
      showWaitlistCancel,
      waitlistStatusTitle: presentation.title,
      waitlistStatusDetail: presentation.detail,
      waitlistPaymentText: paymentText
    });
  },

  _initWorkflow() {
    const that = this;
    const verifyRegistrationPayment = createRegistrationPaymentVerifier(app);
    that._workflow = createCheckoutWorkflow({
      createOrder: function (payload, cb) {
        const { activityId, selectedTicket, useDiscount, userInfo, quoteSign, requestId,
          waitlistOfferId, waitlistOfferToken } = payload;
        var data = {
          ownerType: 2,
          ownerId: activityId,
          ticketId: selectedTicket.id,
          realName: userInfo.realName,
          phone: userInfo.phone,
          email: userInfo.email || '',
          isUsePoint: useDiscount ? 1 : 0,
          quoteSign: quoteSign || '',
          requestId: requestId,
          waitlistOfferId: waitlistOfferId || null,
          waitlistOfferToken: waitlistOfferToken || null
        };
        // 3-5 票源归因:只有「捕获到的那一期」== 「正在下单的这一期」才带标记。
        // 期 = cms_activity.topicId;拿不到 topicId 就归平台,不拿 activityId 顶替(那是场次不是期)。
        Object.assign(data, ticketSource.attributionPayload(
          (that.data.activityInfo && that.data.activityInfo.topicId) || null));
        return app.sendRequest({
          url: '/api/registration/create',
          data: JSON.stringify(data),
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          success: function (res) {
            if (isTerminalOrderConflict(res)) {
              // fix-be-0917(B-R2):旧幂等键对应的单已取消(3)/已过期(4),后端不再把终态单
              // 当重放返回,改为 409「该幂等键对应的报名已取消/已过期，请重新发起报名」。
              // 不提示、不重报价 —— 作废旧键,交给 onOrderFail 换新键重建,玩家无感继续支付。
              that._reqId = null;
              that._rebuildFallbackMessage = res.msg || '';
              cb({ ok: false, msg: ORDER_REBUILD_REQUIRED });
              return;
            }
            cyLoading.hide();
            if (res.code == 409 || res.code == '409') {
              that.setData({ isPaying: false }, () => that.refreshPaymentState());
              app.tips('价格已更新，请重新确认');
              that.refreshQuote();
              cb({ ok: false, msg: 'price_changed' });
              return;
            }
            const registrationId = res && res.data
              && (res.data.registrationId || (Array.isArray(res.data.registrationIds) && res.data.registrationIds[0]));
            const payableAmount = res && res.data && res.data.payableAmount;
            const hasValidAmount = payableAmount !== null && payableAmount !== undefined && payableAmount !== ''
              && Number.isFinite(Number(payableAmount)) && Number(payableAmount) >= 0;
            if (res && res.code == '200' && registrationId && hasValidAmount) {
              that.setData({
                orderInfo: res.data,
                waitlistState: waitlistOfferId ? 'CLAIMED' : that.data.waitlistState,
                waitlistRegistrationId: waitlistOfferId ? registrationId : that.data.waitlistRegistrationId
              });
              that._regId = registrationId;
              // 重放命中已有订单时后端有意不下发 payParams(RegistrationCheckoutServiceImpl:107)。
              // 旧代码直接把这些单判成「支付参数不完整」→ onPayFail → 取消订单 → 同一 requestId
              // 再点又重放这张已取消的单,形成死循环。这里照主题自玩页的先例补一次取参数。
              if (Number(payableAmount) > 0 && !hasCompletePaymentParams(res.data)) {
                cyLoading.show('获取支付参数...');
                app.sendRequest({
                  url: '/api/registration/pay',
                  method: 'POST',
                  hideLoading: true,
                  data: { id: registrationId },
                  success: function (payRes) {
                    // 拍板 #21:过期待支付单 —— 后端这次 /pay 已即时关单(started),旧幂等键
                    // 重放只会再撞上这张关单。这里不显示、不撤单,交给 onOrderFail 换新键重建;
                    // 重建走正常建单接口,闭店/名额/退款截止等校验一条不少。
                    if (isOrderExpiredFailure(payRes)) {
                      that._reqId = null;
                      that._rebuildFallbackMessage = ORDER_EXPIRED_USER_MESSAGE;
                      cb({ ok: false, msg: ORDER_REBUILD_REQUIRED });
                      return;
                    }
                    cyLoading.hide();
                    if (payRes && payRes.code == '200' && hasCompletePaymentParams(payRes.data)) {
                      cb({ ok: true, data: payRes.data });
                      return;
                    }
                    that.setData({ isPaying: false }, () => that.refreshPaymentState());
                    cb({ ok: false, msg: (payRes && payRes.msg) || '支付参数获取失败，请重试' });
                  },
                  fail: function () {
                    cyLoading.hide();
                    that.setData({ isPaying: false }, () => that.refreshPaymentState());
                    cb({ ok: false, msg: '网络错误，请重试' });
                  }
                });
                return;
              }
              cb({ ok: true, data: res.data });
            } else {
              that.setData({ isPaying: false }, () => that.refreshPaymentState());
              cb({ ok: false, msg: (res && res.msg) || '报名失败' });
            }
          },
          fail: function (res) {
            cyLoading.hide();
            that.setData({ isPaying: false }, () => that.refreshPaymentState());
            cb({ ok: false, msg: '网络错误，请重试' });
          }
        });
      },
      requestPayment: function (orderData, cb) {
        var p = orderData.payParams;
        wx.requestPayment({
          timeStamp: p.timeStamp,
          nonceStr: p.nonceStr,
          package: p.package,
          signType: p.signType,
          paySign: p.paySign,
          success: function () { cb({ ok: true }); },
          fail: function (res) {
            cb({ ok: false, cancelled: res.errMsg === 'requestPayment:fail cancel', errMsg: res.errMsg });
          }
        });
      },
      verifyPayment: function (data, cb) {
        var regId = data.registrationId || (data.registrationIds && data.registrationIds[0]);
        if (!regId) { cb({ ok: false, errMsg: '缺少订单编号' }); return; }
        return verifyRegistrationPayment({ registrationId: regId }, cb);
      },
      isPayable: function (d) { return d && Number(d.payableAmount) > 0; },
      validatePayment: hasCompletePaymentParams
    });
  },

  /**
   * 处理付款
   */
  handlePayment() {
    const that = this;

    // 详情未就绪时禁止下单:此时票种/金额都不可信,CTA 之外再兜一道
    if (that.data.pageState !== 'ready') {
      app.tips('活动信息尚未加载完成，请稍后再试');
      return;
    }

    // 拍板 2026-09-16 #10:商家闭店只挡新报名;已售订单(/pay 重试、候补转正)不受影响。
    if (that.data.merchantClosed) {
      app.tips('商家暂停营业，暂不可报名');
      return;
    }


    if (that.data.isPaying) {
      app.tips('订单提交中，请勿重复点击');
      return;
    }

    if (that.data.waitlistState === 'OFFERED'
      && !offerDeadlineIsFuture(that._waitlistOfferExpiresAt)) {
      that.expireWaitlistOfferInView();
      app.tips('候补名额已过期，正在刷新');
      that.loadWaitlistStatus();
      return;
    }

    if (that.data.waitlistEligibility === 'ALREADY_REGISTERED') {
      app.tips('已有该票种报名，别重复提交');
      return;
    }

    if (that.data.ticketSoldOut && that.data.waitlistState !== 'OFFERED') {
      const message = that.data.waitlistState === 'WAITING'
        ? '候补排队中，获得名额后才能报名'
        : that.data.waitlistState === 'CLAIMED'
          ? '候补名额已生成报名订单，请到订单中继续'
          : that.data.waitlistState === 'EXPIRED'
            ? '候补名额已过期，请重新加入候补'
            : that.data.waitlistState === 'CANCELLED'
              ? '你已退出候补，如仍需参加请重新加入'
              : that.data.waitlistEligibility !== 'ELIGIBLE'
                ? waitlistEligibilityMessage(that.data.waitlistEligibility)
                : '该票种已满，请先加入候补';
      app.tips(message);
      return;
    }
    if (that.data.waitlistState === 'OFFERED'
      && (!that.data.waitlistOfferId || !that.data.waitlistOfferToken)) {
      app.tips('候补凭证未就绪，正在刷新');
      that.loadWaitlistStatus();
      return;
    }

    if (Number(that.data.totalAmount || 0) > 0 && that.data.paymentReady === false) {
      if (!that.data.paymentReadinessChecking) that.checkPaymentReadiness(true);
      app.tips('正在重新检查支付服务，请稍后重试');
      return;
    }

    // 验证数据
    if (!that.data.selectedTicket) {
      app.tips('暂不可报名：暂无可用票');
      return;
    }

    // 已截止:CTA 与空态已经把话说明白了,这里是「绕过界面直接调用」的最后一道。
    // 候补凭证未过期的人另算(售止口径不是票的 endTime),所以放在候补分支之后。
    const claimingOffer = that.data.waitlistState === 'OFFERED'
      && !!that.data.waitlistOfferId && !!that.data.waitlistOfferToken
      && offerDeadlineIsFuture(that._waitlistOfferExpiresAt);
    if (ticketSignupClosed(that.data.selectedTicket) && !claimingOffer) {
      app.tips('该票种报名已截止');
      return;
    }

    if (!that.data.selectedAddress) {
      app.tips('请选择参与人信息');
      that.checkAndShowAddressPopup();
      return;
    }

    if (!that.data.hostShareChecked) {
      app.tips('请同意向主办方提供报名信息');
      return;
    }

    // 验证用户信息（从参与人信息获取）
    if (!that.data.userInfo.realName) {
      app.tips('参与人信息需要包含姓名');
      that.checkAndShowAddressPopup();
      return;
    }

    if (!that.data.userInfo.phone) {
      app.tips('参与人信息需要包含手机号');
      that.checkAndShowAddressPopup();
      return;
    }

    // 验证手机号格式
    if (!isValidMobile(that.data.userInfo.phone)) {
      app.tips('参与人信息中的手机号码格式不正确');
      that.checkAndShowAddressPopup();
      return;
    }

    // 1-22 附注(拍板 2026-09-19 第6条):已过退款截止的 ¥ 单必须先明确确认「本单不可退」。
    // 退款性只信后端 quote 下发的 tri-state(false=已过截止,null=旧 jar 未下发 ⇒ 不拦),
    // 纯积分/0 元单没有资金风险不拦。放在存证/订阅之前:确认键本身提供手势上下文。
    if (Number(that.data.totalAmount || 0) > 0
      && that._quoteRefundableNow === false && !that._nonRefundableConfirmed) {
      modal.show({
        title: '本单不可退',
        content: '该场次已过「集合前 24 小时」退款截止时间，支付后不可退款。确认继续下单？',
        confirmText: '继续下单',
        cancelText: '再想想',
        success: function (res) {
          if (res && res.confirm) {
            that._nonRefundableConfirmed = true;
            that.handlePayment();
          }
        }
      });
      return;
    }

    // 报名提醒订阅授权必须仍处于本次点击手势内；模板 ID 未配置或用户拒绝均不阻塞报名。
    if (!that._signupSubscriptionRequested) {
      that._signupSubscriptionRequested = true;
      subscribe.request(['signupSuccess', 'activityStart', 'refund']);
    }

    // 后端创建报名单前会硬校验该单独同意已经落库。这里必须先等存证成功再建单，
    // 否则弱网时前端同意请求与建单请求并发，会出现第一次提交被拒绝的竞态。
    if (!that._hostShareConsentReady) {
      if (!app.recordConsent) {
        const message = '同意记录服务暂不可用，请稍后重试';
        that.setData({ submitError: message });
        app.tips(message);
        return;
      }
      that.setData({ isPaying: true, submitError: '' }, () => that.refreshPaymentState());
      cyLoading.show('提交中...');
      app.recordConsent({
        docType: 'activity_host_data_sharing',
        scene: 'activity_signup',
        eventType: 'AGREE'
      }).then(function () {
        if (that._destroyed) {
          cyLoading.hide();
          return;
        }
        that._hostShareConsentReady = true;
        that.setData({ isPaying: false, hostShareConsentReady: true }, function () {
          that.refreshPaymentState();
          cyLoading.hide();
          that.handlePayment();
        });
      }).catch(function () {
        if (that._destroyed) {
          cyLoading.hide();
          return;
        }
        const message = '同意记录未保存，请检查网络后重试';
        that.setData({ isPaying: false, submitError: message }, function () {
          that.refreshPaymentState();
          cyLoading.hide();
          app.tips(message);
        });
      });
      return;
    }

    // 设置支付中状态
    that.setData({ isPaying: true, submitError: '' }, () => that.refreshPaymentState());

    // 显示加载中
    cyLoading.show('提交中...');

    // BE-10:活动下单(ownerType=2)后端硬校验 quoteSign。若报价未就绪,先即时补一次报价再下单
    if (!that._quoteSign && !that._quoteRetried) {
      that._quoteRetried = true;
      const { selectedTicket, activityId, useDiscount } = that.data;
      // ⚠️ 重入 handlePayment 前必须先解锁并关掉 loading。上面已经置了 isPaying=true 并
      // showLoading,而 handlePayment 开头就有 `if (isPaying) return` 守卫 —— 直接重入会被
      // 自己挡住:loading 永远转、isPaying 永远 true,用户既等不到结果也无法重试。
      // (wx.hideLoading 不能用 app.hideToast 代替,后者是 wx.hideToast,关不掉 loading。)
      const resumePayment = function () {
        that.setData({ isPaying: false }, function () {
          that.refreshPaymentState();
          cyLoading.hide();
          that.handlePayment();
        });
      };
      app.sendRequest({
        url: '/api/registration/quote', method: 'POST', header: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
          ownerType: 2,
          ownerId: activityId,
          ticketId: selectedTicket.id,
          isUsePoint: useDiscount ? 1 : 0,
          waitlistOfferId: that.data.waitlistOfferId || null,
          waitlistOfferToken: that.data.waitlistOfferToken || null
        }),
        success: function (res) {
          if (res && (res.code == 200 || res.code == '200') && res.data) {
            that._quoteSign = res.data.quoteSign || '';
            that._quoteRefundableNow = res.data.refundableNow === true || res.data.refundableNow === false
              ? res.data.refundableNow : null;
            that.setData({
              quoteReady: !!that._quoteSign
            });
          }
          resumePayment();
        },
        fail: resumePayment
      });
      return;
    }
    that._quoteRetried = false;

    // BE-03 幂等键
    if (!that._reqId) that._reqId = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

    const payload = {
      activityId: that.data.activityId,
      selectedTicket: that.data.selectedTicket,
      useDiscount: that.data.useDiscount,
      userInfo: that.data.userInfo,
      quoteSign: that._quoteSign || '',
      requestId: that._reqId,
      waitlistOfferId: that.data.waitlistOfferId || null,
      waitlistOfferToken: that.data.waitlistOfferToken || null
    };

    var submitted = that._workflow.submit(payload, {
      onOrderFail: function (res) {
        // 拍板 #21 / fix-be-0917:旧幂等键不可用(单已过期/已取消)时先自动换新键重建一次
        // (玩家无感,不发提示);重建后仍失败才退回可见提示,防止在死循环里反复建单。
        if (res && res.msg === ORDER_REBUILD_REQUIRED) {
          if (that._rebuildOrderWithNewKey()) return;
          // 重建过仍不可用:检测分支没关 loading/提交态,这里补上再给可见提示。
          cyLoading.hide();
          that.setData({ isPaying: false }, () => that.refreshPaymentState());
          res = { msg: that._rebuildFallbackMessage || ORDER_EXPIRED_USER_MESSAGE };
        }
        const priceChanged = res && res.msg === 'price_changed';
        const message = priceChanged ? '价格已更新，请重新确认' : ((res && res.msg) || '报名失败，请重试');
        that.setData({ submitError: message });
        if (!priceChanged) {
          app.tips(message);
        }
      },
      onFreeSuccess: function (data) {
        that.setData({
          isPaying: false,
          submitError: '',
          waitlistState: that.data.waitlistOfferId ? 'CONVERTED' : that.data.waitlistState
        }, () => that.refreshPaymentState());
        analytics.track('signup_submit', {
          bizType: 'activity',
          bizId: that.data.activityId,
          properties: {
            registrationId: data.id || '',
            payableAmount: data.payableAmount
          }
        });
        that.finishSignup({
          title: '报名成功',
          detail: '票已放入票夹，出发前 30 分钟到集合点核验',
        });
      },
      onPayVerifying: function (data) {
        /* 在途是这个面板的**前一拍**,不是另一件事:正在支付 → 支付成功/失败,
           稿(Payment Sheet States 帧 2→3/1)本来就是同一个 sheet 里的连续序列,
           面板留在原地只换内容,而不是「先盖一层全屏遮罩、再弹一个面板」。
           ⚠️ 所以这里不用 cyLoading —— 那是给「没有结果面板的通用阻塞等待」的
           (比如发布页的安全预检),两者分工不同,不是同一件事两套机制。
           duration: 0 —— 在途没有终点,不自愈;终点由下面各 onPay* 回调改写。 */
        that.setData({
          verifyingPayment: true,
          resultSheet: { show: true, kind: 'loading', title: '确认支付结果',
            sub: '正在和微信核对这笔付款。', meta: '', pill: '', why: '',
            primaryText: '', secondaryText: '', duration: 0 },
        });
      },
      onPaySuccess: function (data) {
        that.setData({
          isPaying: false,
          verifyingPayment: false,
          submitError: '',
          waitlistState: that.data.waitlistOfferId ? 'CONVERTED' : that.data.waitlistState
        }, () => that.refreshPaymentState());
        cyLoading.hide();
        // 成功由 finishSignup 把面板改写成 success 态(loading → success 同一块面板),
        // 这里不收 —— 收了会先闪一下空白再弹一次。
        analytics.track('payment_success', {
          bizType: 'activity',
          bizId: that.data.activityId,
          properties: {
            registrationId: data.id || '',
            payableAmount: data.payableAmount || 0
          }
        });
        that.finishSignup({
          title: '支付成功',
          detail: '票已放入票夹，可随时出示入场码',
        });
      },
      onPayCancel: function () {
        // 取消没有结果可报,把在途那张面板直接收掉
        that.setData({ isPaying: false, submitError: '', 'resultSheet.show': false },
          () => that.refreshPaymentState());
        cyLoading.hide();
        app.tips('您已取消支付');
        that.cancelPendingOrder();
      },
      onPayFail: function (res) {
        const message = (res && res.errMsg) || '支付失败，请重试';
        cyLoading.hide();
        that.setData({
          isPaying: false, verifyingPayment: false, submitError: message,
          // 面板负责「说清楚发生了什么」并自愈;重试出口是页内那条 submitError,
          // 它一直留在页上 —— 恢复动作不能放进会自己消失的面板里。
          // 原来这里还会再 app.tips 一次,和面板+页内错误就是同一句话说三遍,故去掉。
          resultSheet: { show: true, kind: 'fail', title: '这笔没有付成功', sub: '钱没有扣,可以直接重试。',
            meta: '', pill: '', why: message, primaryText: '', secondaryText: '', duration: SUCCESS_HOLD_MS },
        }, () => that.refreshPaymentState());
        that.cancelPendingOrder({ stayOnPage: true });
      },
      onPayUnknown: function () {
        cyLoading.hide();
        // 结果待确认:面板给不出结论,收掉交给下面的 modal 说清楚
        that.setData({ isPaying: false, verifyingPayment: false, 'resultSheet.show': false },
          () => that.refreshPaymentState());
        modal.show({
          title: '支付结果待确认',
          content: '暂不要重复支付，请稍后到订单中查看最终状态。',
          showCancel: false
        });
      }
    });

    if (!submitted) {
      that.setData({ isPaying: false }, () => that.refreshPaymentState());
      cyLoading.hide();
      // unknown 是 workflow 故意留的闸(防重复建单扣款),但闸不能是哑巴:
      // 「支付结果待确认」modal 被关掉后再点报名,原来什么都不说。
      // 这里把同一句结论重新给一遍并指出去哪看,而不是让按钮看起来坏了。
      if (that._workflow.getState() === 'unknown') {
        modal.show({
          title: '支付结果待确认',
          content: '这笔付款还在确认中，请勿重复支付。稍后可到「我的-订单」查看最终状态。',
          showCancel: false,
        });
      }
    }
  },

  checkPaymentReadiness(announceFailure) {
    const that = this;
    const requestEpoch = (that._paymentReadinessEpoch || 0) + 1;
    that._paymentReadinessEpoch = requestEpoch;
    const previous = that._paymentReadinessRequest;
    if (previous && typeof previous.abort === 'function') previous.abort();
    that._paymentReadinessRequest = null;
    const isCurrent = function () {
      return !that._destroyed && that._paymentReadinessEpoch === requestEpoch;
    };
    that.setData({ paymentReady: false, paymentReadinessChecking: true }, () => that.refreshPaymentState());
    const settle = function (ready, message) {
      if (!isCurrent()) return;
      that.setData({ paymentReady: ready === true, paymentReadinessChecking: false }, function () {
        that.refreshPaymentState();
        if (announceFailure && ready !== true) app.tips(message || '支付服务暂不可用，请稍后重试');
      });
    };
    const request = app.sendRequest({
      url: '/api/registration/payment-readiness', method: 'POST', data: {}, hideLoading: true,
      success(res) {
        if (res && (res.code == 200 || res.code == '200') && res.data) {
          settle(res.data.ready === true, res.data.message);
          return;
        }
        settle(false, res && res.msg);
      },
      successStatusAbnormal(res) { settle(false, res && res.msg); },
      fail() { settle(false, '支付服务检查失败，请检查网络后重试'); },
      complete() { if (isCurrent()) that._paymentReadinessRequest = null; }
    });
    if (isCurrent() && request && typeof request.abort === 'function') {
      that._paymentReadinessRequest = request;
    }
  },

  /**
   * 2026-09-17 拍板 #21(+fix-be-0917 B-R2):旧幂等键不可用时自动换新键重建,玩家无感继续支付。
   *
   * 触发面:① /pay 见过期拒绝(后端已即时关单);② /create 回终态单冲突 409(已取消/已过期)—— 
   * 两种情况下旧键对应的单都已不可支付,重放只会再撞同一堵墙。检测点已作废旧键,这里回到正常
   * 建单接口用新键重建(同样的票种/数量/报名信息,由 handlePayment 按当前页态重新组装),
   * 闭店、名额、退款截止、报价等校验全部照走。
   * 每次结账意图只自动重建一次;重建后仍不可用由 onOrderFail 给可见提示(旧键此时已作废,
   * 用户再点一次就是全新一单,不会被同一堵墙卡住)。
   */
  _rebuildOrderWithNewKey() {
    const that = this;
    if (that._rebuildUsed) return false;
    that._rebuildUsed = true;
    that.setData({ isPaying: false }, function () {
      that.refreshPaymentState();
      // 先收掉上一跳的 loading 再重入:handlePayment 的早退分支(售罄/闭店/信息未就绪)
      // 只给 tips 不关 loading,留着它会把页面永久锁死在遮罩下。重入到请求发出之间是同一个
      // tick,用户看不到闪烁。
      cyLoading.hide();
      that.handlePayment();
    });
    return true;
  },

  /**
   * 取消本次未支付报名(支付取消/失败时调),释放库存与已抵扣积分。best-effort,完成后返回。
   */
  cancelPendingOrder(options) {
    const that = this;
    const info = this.data.orderInfo || {};
    const ids = (info.registrationIds && info.registrationIds.length)
      ? info.registrationIds
      : (info.registrationId ? [info.registrationId] : []);
    ids.forEach(function (rid) {
      app.sendRequest({
        url: '/api/registration/cancel',
        data: { id: rid },
        method: 'POST',
        hideLoading: true,
        successStatusAbnormal: function () {},
        // 只有取消真的落库了才换幂等键:撤单成功后再用旧 requestId 重试会重放这张已取消的单
        // (/api/registration/pay 对非待支付单必拒);撤单失败则保留旧键重放原单,由 /pay 兜底继续支付。
        success: function () { that._reqId = null; },
        fail: function () {}
      });
    });
    if (!(options && options.stayOnPage)) app.goBack();
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    this._destroyed = true;
    this._activityInfoEpoch = (this._activityInfoEpoch || 0) + 1;
    this._participantEpoch = (this._participantEpoch || 0) + 1;
    if (this._activityInfoRequest && this._activityInfoRequest.task
      && typeof this._activityInfoRequest.task.abort === 'function') {
      this._activityInfoRequest.task.abort();
    }
    if (this._participantRequest && this._participantRequest.task
      && typeof this._participantRequest.task.abort === 'function') {
      this._participantRequest.task.abort();
    }
    this._activityInfoRequest = null;
    this._participantRequest = null;
    this._paymentReadinessEpoch = (this._paymentReadinessEpoch || 0) + 1;
    if (this._paymentReadinessRequest && typeof this._paymentReadinessRequest.abort === 'function') {
      this._paymentReadinessRequest.abort();
    }
    this._paymentReadinessRequest = null;
    if (this._workflow) this._workflow.destroy();
    // 成功弹窗的两个定时器:用户在 2s 内手动返回时页面已卸载,它们还在跑,
    // 到点会对着死页面 setData,并把用户从别的页面强行 redirect 到订单详情。
    clearTimeout(this._successLeaveTimer);
    clearTimeout(this._waitlistOfferTimer);
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    if (this._skipInitialShow) { this._skipInitialShow = false; return; }
    if (this.data.pageState === 'missing-param') return;
    // 页面显示时重新获取参与人信息列表
    this.getAddressList();
    this.loadWaitlistStatus();
  },

  /**
   * 用户点击右上角分享
   */
});
