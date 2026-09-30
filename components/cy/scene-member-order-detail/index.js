const modal = require('../../../utils/modal.js');
const cyLoading = require('../../../utils/loading.js');
const toast = require('../../../utils/toast.js');
const app = getApp();
const { summarizeOrderState, formatRefundDeadline } = require('../../../utils/order-status.js');
const cancellationFeedback = require('../../../utils/cancellation-feedback.js');

/* 稿 578:2312 的状态药丸:退款处理中是琥珀(#FF9E14)。其余档位按语义配到既有状态色,
   不为这一页新起一套色 —— 药丸在本仓是 cy-badge 的语言,这里只是把订单态映射过去。 */
/* 稿 578:2313 那张卡在稿上画的是退款态。2026-09-11 用户定:
   「是退款、还是已完成、未开始,要有不同状态的」—— 所以它不是一张退款卡,
   是一张**状态卡**,每个订单态都出,只是说的话不一样。
   ⚠️ 这里只写标题那一句;副文案与右上角那个词取既有的 orderHint / statusText,
      不另编一套 —— 两套说法迟早分叉,而它们说的是同一件事。 */
const STATE_TITLE = {
  pending_payment: '还没付款',
  not_started: '还没开场',
  in_progress: '正在进行',
  completed: '已经完成',
  cancelled: '订单已取消',
  expired: '订单已过期',
  non_refundable: '不可退款',
  manual_refund: '售后处理进度',
  refunding: '退款申请已提交',   // 含待审核:还没人批准前不能说「已受理」
  refunded: '退款已受理',
  // unknown 不给标题:状态本身没读出来时整块不出,不说一句正确的废话
};

const STATUS_TONE = {
  pending_payment: 'warning',
  refunding: 'warning',
  refunded: 'neutral',
  cancelled: 'neutral',
  expired: 'neutral',
  completed: 'success',
  not_started: 'info',
  in_progress: 'success',
  non_refundable: 'neutral',
  manual_refund: 'neutral',
  unknown: 'neutral',
};
const { createCheckoutWorkflow, hasCompletePaymentParams } = require('../../../utils/checkout/checkout-workflow.js');
const teamUp = require('../../../utils/team-up.js');
const { createRegistrationPaymentVerifier } = require('../../../utils/checkout/registration-payment-verifier.js');
const { isRecordList } = require('../../../utils/response-shape.js');
const marketingConsent = require('../../../utils/marketing-consent-entry.js');

function toDisplayTime(value) {
  const text = formatRefundDeadline(value);
  return text || '';
}

function resolveHeroImage(info) {
  const fallback = '/images/icon_ticket_empty.svg';
  if (!info) return fallback;
  if (info.cmsActivity && info.cmsActivity.imgUrl) return info.cmsActivity.imgUrl;
  const topic = info.cmsTopic;
  if (topic) {
    if (topic.imgArr) {
      try {
        const arr = typeof topic.imgArr === 'string' ? JSON.parse(topic.imgArr) : topic.imgArr;
        if (Array.isArray(arr) && arr[0]) return arr[0];
      } catch (e) { /* ignore */ }
    }
    if (topic.imgUrl) {
      if (typeof topic.imgUrl === 'string' && topic.imgUrl.indexOf('[') === 0) {
        try {
          const arr = JSON.parse(topic.imgUrl);
          if (Array.isArray(arr) && arr[0]) return arr[0];
        } catch (e) { /* ignore */ }
      }
      return topic.imgUrl;
    }
  }
  return fallback;
}

// 批5 完局面(图鉴 / 通关奖励到账明细 / J·R90 入口)的空态。
// show=false 时 wxml 整块不渲染 —— 接口没回来/失败/不是探店日单,都不许留半个空壳。
function emptyCompletion() {
  return {
    show: false,
    completed: false,
    stamps: [],
    stampProgressText: '',
    awards: { credited: false, items: [], emptyText: '' },
    revisit: {
      show: false, clubName: '', clubLeaderMemberId: null, clubId: null,
      followed: false, joined: false, canFollow: false, canJoin: false,
      joinStateText: '', hasNextEdition: false, nextEditionText: '', nextTopicId: null,
    },
  }
}

function stampSubText(stamp) {
  if (!stamp || !stamp.collected) return '待核销'
  const at = String(stamp.obtainedAt || '')
  return at ? at.slice(5, 16) : '已收集'
}

/**
 * 把后端 ExploreCompletionVO 摊成可直接渲染的形状。
 * ★这里的每一处 null 都必须原样保持「没有」,不许折成 0 ——
 *   points=null 是「没有这条流水」,不是「发了 0 分」;nextEdition=null 是「没有下期」,不是「0 场」。
 *   写 0 会同时骗玩家和骗验收(批 2-4 的账其实是对的,读面写 0 会让人误判它没做)。
 */
function toCompletionView(vo) {
  const view = emptyCompletion()
  if (!vo || typeof vo !== 'object') return view
  const awardsPayload = (vo.awards && typeof vo.awards === 'object') ? vo.awards : {}
  if (!isRecordList(vo.stamps) || !isRecordList(awardsPayload.items)) return view
  const required = Number(vo.requiredChapterCount) || 0
  const redeemed = Number(vo.redeemedChapterCount) || 0
  view.show = true
  view.completed = !!vo.completed
  view.stamps = (Array.isArray(vo.stamps) ? vo.stamps : []).map(function (stamp) {
    return {
      chapterId: stamp.chapterId,
      title: stamp.title || ('章节 ' + stamp.chapterId),
      collected: !!stamp.collected,
      subText: stampSubText(stamp),
    }
  })
  view.stampProgressText = required > 0 ? ('已集齐 ' + redeemed + '/' + required) : ''

  const awards = awardsPayload
  const items = Array.isArray(awards.items) ? awards.items : []
  view.awards.credited = !!awards.credited && items.length > 0
  view.awards.items = items.map(function (item) {
    return {
      kind: item.kind,
      title: item.title || '',
      iconUrl: item.iconUrl || '',
      // amount 为 null/undefined ⇒ 空串,wxml 据此不渲染数字(不是渲染 0)
      amountText: (item.amount === null || item.amount === undefined) ? '' : ('+' + item.amount),
    }
  })
  // ★ points 为 null 时这里什么都不做:积分那一行只由上面的 POINTS item 产出,
  //   而后端无流水时根本不下发这一项 ⇒ 屏幕上不会出现「0 积分」这个不存在的事实。
  if (!view.awards.credited) {
    view.awards.emptyText = view.completed
      ? '奖励发放中，可稍后在勋章与积分明细里查看'
      : ('走完全部 ' + required + ' 家店后发放')
  }

  const revisit = (vo.revisit && typeof vo.revisit === 'object') ? vo.revisit : {}
  if (revisit.clubId) {
    const next = revisit.nextEdition
    view.revisit.show = true
    view.revisit.clubId = revisit.clubId
    view.revisit.clubName = revisit.clubName || '主办俱乐部'
    view.revisit.clubLeaderMemberId = revisit.clubLeaderMemberId || null
    view.revisit.followed = !!revisit.followed
    view.revisit.joined = !!revisit.joined
    // 关注对象缺失就不出关注钮 —— 有钮点不动比没有钮更糟。
    view.revisit.canFollow = !revisit.followed && !!revisit.clubLeaderMemberId
    view.revisit.canJoin = !revisit.joined
    view.revisit.hasNextEdition = !!(next && next.topicId)
    view.revisit.nextTopicId = next && next.topicId ? next.topicId : null
    view.revisit.nextEditionText = view.revisit.hasNextEdition
      ? ((next.name || '下一期') + ' · ' + String(next.startDate || '').slice(5, 10) + ' 开场')
      : '下一期开售后会在这里出现'
  }
  return view
}

function resolvePrimaryCta(orderStateKey, verificationStatus) {
  if (orderStateKey === 'pending_payment') return 'pay';
  if (orderStateKey === 'not_started' || orderStateKey === 'in_progress') return 'ticket';
  if (orderStateKey === 'completed' || orderStateKey === 'cancelled'
      || orderStateKey === 'refunding' || orderStateKey === 'refunded'
      || orderStateKey === 'non_refundable' || orderStateKey === 'manual_refund') {
    return '';
  }
  // 报名成功但状态机未覆盖的兜底：未核销仍可进票夹
  if (Number(verificationStatus) !== 1) return 'ticket';
  return '';
}

function buildOrderTimeline(info) {
  const value = info || {};
  const stateKey = value.orderStateKey || '';
  const paid = Number(value.paymentStatus) === 2;
  const verified = Number(value.verificationStatus) === 1;
  const rows = [{
    key: 'created',
    label: '订单已创建',
    time: toDisplayTime(value.createTime),
    state: 'done',
  }];

  if (paid) {
    rows.push({ key: 'paid', label: '支付已完成', time: toDisplayTime(value.paymentTime), state: 'done' });
  } else if (stateKey === 'cancelled') {
    rows.push({ key: 'cancelled', label: '订单已取消', time: '', state: 'done' });
    return rows;
  } else {
    rows.push({ key: 'payment', label: '等待支付', time: '完成后更新', state: 'current' });
    return rows;
  }

  if (stateKey === 'refunding' || stateKey === 'refunded') {
    const refundTime = value.refundApplication
      ? (value.refundApplication.payoutTime || value.refundApplication.updateTime) : '';
    rows.push({
      key: 'refund',
      label: stateKey === 'refunded' ? '已退款' : '退款处理中',   // 与 utils/order-status 同词
      time: toDisplayTime(refundTime),
      state: stateKey === 'refunded' ? 'done' : 'current',
    });
    return rows;
  }

  rows.push({
    key: 'verification',
    label: verified ? '权益已核销' : (stateKey === 'manual_refund' ? '尚未核销' : '等待到店核销'),
    time: verified ? toDisplayTime(value.verificationTime) : (stateKey === 'manual_refund' ? '' : '完成后更新'),
    state: verified ? 'done' : 'current',
  });
  if (stateKey === 'manual_refund') {
    rows.push({ key: 'manual_refund', label: value.refundDisplayText, time: '',
      state: value.manualRefundCaseStatus === 'NO_REFUND'
        || value.manualRefundCaseStatus === 'MANUAL_REFUND_EVIDENCE_VERIFIED' ? 'done' : 'current' });
  }
  return rows;
}

function resolveExploreOrder(info) {
  if (!info || typeof info !== 'object') return false
  if (info.purchaseKind !== null && info.purchaseKind !== undefined && info.purchaseKind !== '') {
    return Number(info.purchaseKind) === 3
  }
  // PurchaseKind 允许存量/后台手工单为 NULL。只认 registration_entitlement 的明确章节键，
  // 不退回“数组非空”这种会把任意旧权益误判成探店日的长度 heuristic。
  return Array.isArray(info.entitlements) && info.entitlements.some(function (item) {
    return item && Number(item.chapterId) > 0
  })
}

// H10 订单详情(方案 §5.2)。订单详情与支付/退款逻辑的唯一实现;
// subpackageMember/orderinfo/orderinfo 已退化成深链薄壳,渲染的就是本组件。
//
// 与页面版的三处差异,都因为它现在活在弹窗里(§8.3 禁止 sheet 内继续 navigateTo):
//   ① 返回 = triggerEvent('back') 回上一层场景(H09),不是 navigateBack 猜页面栈;
//   ② 去票夹/路线/场次详情这些**不属于 37 个场景**的目标,先 close 再 navigateTo,不在弹窗上压页面;
//   ③ 顶部 hero 的返回钮与 statusBar 占位交给 scene-sheet 的统一头部,组件里不再画。
Component({
  properties: {
    orderId: { type: String, value: '' },
    theme: { type: String, value: 'player' },
  },
  observers: {
    orderId(value) {
      if (this._attached) this._setOrderId(value)
    },
  },
  data: {
    teamSheetShow: false,
    teamSheetItems: [],
    /* 建队默认公开(会出现在漫游地图「附近的队伍」里);打开这个开关才是仅邀请。
       true/false 由这里决定,不传给后端的那一半靠 teamUp.createActivityTeam 省略字段。 */
    teamInviteOnly: false,
      info: {},
      cancelling: false,
      paying: false,
      heroImage: '/images/icon_ticket_empty.svg',
      productTitle: '',
      orderQty: 1,
      showPointPay: false,
      showWechatPay: false,
      paymentTimeText: '',
      participateDateText: '',
      verificationTimeText: '',
      orderTimeline: [],
      expiresAtText: '',
      primaryCta: '',
      showSecondaryTicket: false,
      // 稿 578:2298:头图上的金额行/时间行与状态药丸,退款状态卡
      whenText: '',
      statusTone: 'neutral',
      stateNotice: { show: false },
      // 2026-09-17 拍板第 40 条 A:订单被核销后,这单背后有生效商家且尚未同意时出现的可选同意行。
      // 商家一方 id 只认 GET /api/merchant/crm/marketing-consents 回包(见 utils/marketing-consent-entry.js)。
      consentOffer: { show: false, merchantName: '', merchantRowId: 0, merchantOwnerMemberId: 0 },
      consentChecked: false,
      consentState: 'idle',   // idle | saving | saved | failed
      consentError: '',
      // loading / ready / failed_business / failed_network —— 四态可观察,失败态不渲染订单主体
      loadState: 'loading',
      loadErrorText: '',
      // 批5 探店日完局面;非探店日单恒 show:false
      completion: emptyCompletion()
    },
  lifetimes: {
    attached() {
      this._attached = true
      this._setOrderId(this.data.orderId)
    },
    detached() {
      if (this._finishCancelPrompt) this._finishCancelPrompt()
      if (this._finishCancellation) this._finishCancellation()
      this._attached = false
      this._orderGeneration = (this._orderGeneration || 0) + 1
      this._completionRequestId = (this._completionRequestId || 0) + 1
      if (this._workflow) this._workflow.destroy()
    },
  },
  pageLifetimes: {
    show() {
      if (this._skipFetch) return
      // 失败面板正在 2s 回列表:此时重拉会把面板切回 loading、计时从头来,原因一闪就没
      if (this._orderId && !/^failed_/.test(this.data.loadState)) this.getData(this._orderId, true)
    },
  },
  methods: {
    _setOrderId(value) {
      const id = String(value || '')
      const valid = /^[1-9]\d*$/.test(id)
      if (valid && String(this._orderId) === id) return
      this._orderGeneration = (this._orderGeneration || 0) + 1
      this._orderRequestId = (this._orderRequestId || 0) + 1
      this._completionRequestId = (this._completionRequestId || 0) + 1
      this._orderFetchInFlight = 0
      if (this._workflow) this._workflow.destroy()
      this._initWorkflow()
      if (this._finishCancelPrompt) this._finishCancelPrompt()
      this._cancelPromptOpen = false
      if (this._finishCancellation) this._finishCancellation()
      if (this.data.paying) cyLoading.hide()
      // 订单 id 只供请求与去重读取,不渲染(失败面板已无重试钮),放实例态不走 setData —— 死数据字段门禁 A2
      this._orderId = valid ? id : 0
      this.setData({
        info: {},
        completion: emptyCompletion(),
        primaryCta: '',
        showSecondaryTicket: false,
        teamSheetShow: false,
        paying: false,
        cancelling: false,
        consentOffer: { show: false, merchantName: '', merchantRowId: 0, merchantOwnerMemberId: 0 },
        consentChecked: false,
        consentState: 'idle',
        consentError: '',
        loadState: valid ? 'loading' : 'failed_business',
        loadErrorText: valid ? '' : '订单参数缺失或无效',
      })
      if (valid) this.getData(id)
    },
    // 关闭当前场景再去非场景页面 —— 不在已打开的 sheet 上再压一个页面栈
    _leave(url) {
      this.triggerEvent('close')
      wx.navigateTo({ url })
    },
    // 沿用原 id 重拉(失败面板已不给重试钮,父层刷新仍走这里)
    reloadOrder() {
      if (!this._orderId) return;
      this.getData(this._orderId);
    },

    /* 2026-09-17 拍板第 40 条 A 的订单详情入口:这单背后有生效商家且玩家尚未同意时,
       页内多一行可选同意。owner memberId 取订单回执里已返回的 cmsTopic/cmsActivity.memberId;
       商家一方 id 只认 GET 回包。拿不到 / 已同意 / 有歧义一律不出现(fail-closed);
       同一单只读一次,onShow 重刷不重来。
       2026-09-17 总控裁定(release-0917 第三阶段 C):出现门槛从「权益已核销」放宽为「已支付成功
       (paymentStatus=2)」—— 自玩通行证等不核销的票也要有入口;已核销的旧口径保留(只放宽不收窄)。
       待支付/支付失败/已退款且未核销的单不出、也不白查。 */
    loadMarketingConsent(info) {
      const that = this;
      const eligible = !!info
        && (Number(info.paymentStatus) === 2 || Number(info.verificationStatus) === 1);
      const ownerMemberId = (info && info.cmsTopic && info.cmsTopic.memberId)
        || (info && info.cmsActivity && info.cmsActivity.memberId) || 0;
      const key = eligible ? (String(info.id || '') + ':' + String(ownerMemberId)) : '';
      if (!key) {
        this._consentKey = '';
        this._consentOffer = null;
        return;
      }
      if (this._consentKey === key) return;    // 同一单已读过:保留屏上的勾选/保存态
      this._consentKey = key;
      this._consentOffer = null;
      this._consentRequestId = null;
      marketingConsent.loadOffer(app, ownerMemberId, function (offer) {
        if (!that._attached || that._consentKey !== key) return;   // 换单/离页后的旧回包不写屏
        if (!offer || that.data.loadState !== 'ready') return;
        that._consentOffer = offer;
        that._consentRequestId = marketingConsent.newRequestId('order');
        that.setData({
          consentOffer: {
            show: true,
            merchantName: offer.merchantName,
            merchantRowId: offer.merchantRowId,
            merchantOwnerMemberId: offer.merchantOwnerMemberId,
          },
          consentChecked: false,
          consentState: 'idle',
          consentError: '',
        });
      });
    },

    onConsentChange(e) {
      const checked = !!(e.detail && e.detail.checked);
      if (this.data.consentState === 'saving') return;   // 在途结果说了算,勾选态不来回抖
      if (!checked) {
        this.setData({ consentChecked: false, consentState: 'idle', consentError: '' });
        return;
      }
      if (!this._consentOffer) return;
      this._submitMarketingConsent(this._consentOffer);
    },

    onConsentRetry() {
      if (!this._consentOffer || this.data.consentState === 'saving') return;
      this._submitMarketingConsent(this._consentOffer);
    },

    /* 同一次勾选意图(含失败重试)复用同一个 requestId:重放由服务端识别,不写第二条。 */
    _submitMarketingConsent(offer) {
      const that = this;
      if (!that._consentRequestId) that._consentRequestId = marketingConsent.newRequestId('order');
      that.setData({ consentChecked: true, consentState: 'saving', consentError: '' });
      marketingConsent.optIn(app, offer, that._consentRequestId, function (result) {
        if (!that._attached) return;
        if (result.ok) {
          // 成功态就是同意行里那句「已同意,可在设置里随时退订」—— 不补两秒就没的 toast
          // (成功 toast 棘轮只减不增:提示不替代状态)。
          that.setData({ consentState: 'saved', consentError: '' });
          return;
        }
        that.setData({ consentState: 'failed',
          consentError: result.message || '同意没有保存成功，请重试' });
      });
    },

    // 加载失败面板 2s 自愈(或手动下滑)后回订单列表。
    // 弹窗里就是回上一层场景(H09),不再猜页面栈。
    backToOrderList() {
      this.triggerEvent('back');
    },

    goBack() {
      this.triggerEvent('back');
    },

    /* 订单页通往票夹的唯一出口(底部主 CTA 与次级键都走它)。
       2026-09-11 删掉快捷入口卡之后,原来的 goRoute/goPlay 与这里逐字相同,是重复的一份。
       ⚠️ 方向是单向的:订单页能来票夹,票夹不回订单(2026-09-10 用户定)。 */
    goSignInfo() {
      const info = this.data.info || {};
      const stype = Number(info.ownerType) === 1 ? 0 : 2;
      this._leave('/subpackageMember/signup/index?focusId=' + (info.id || '') + '&stype=' + stype);
    },


    startOrderTeam() {
      const info = this.data.info || {}
      const activity = info.cmsActivity || {}
      if (Number(info.ownerType) !== 2 || Number(activity.teamMode) !== 2 || !info.ownerId) return
      /* 2026-09-02:原来这里弹 wx.showActionSheet(系统弹层,设计体系外)。 */
      const sheet = teamUp.memberSheet(activity.teamMaxMembers)
      this._teamSheetOptions = sheet.options   // 仅供回调查表,不渲染 ⇒ 不进 data(死数据字段门禁)
      this.setData({ teamSheetItems: sheet.items, teamSheetShow: true })
    },

    onTeamInviteOnlyChange(e) {
      this.setData({ teamInviteOnly: !!(e && e.detail && e.detail.value) })
    },

    onTeamSheetSelect(e) {
      const that = this
      const info = that.data.info || {}
      const members = (that._teamSheetOptions || [])[e.detail.index]
      if (!members || !info.ownerId) return
      that.setData({ teamSheetShow: false })
      teamUp.createActivityTeam(app, info.ownerId, members, that.data.teamInviteOnly ? 1 : null, {
        success(teamId) { that._leave('/pages/team/detail/index?teamId=' + teamId) },
        fail(message) { toast(message) }
      })
    },

    onTeamSheetCancel() {
      this.setData({ teamSheetShow: false })
    },

    openMeetingPoint() {
      const t = (this.data.info && this.data.info.omsTicket) || {};
      const lat = parseFloat(t.gatherLat), lng = parseFloat(t.gatherLng);
      if (!lat || !lng) { toast('集合点坐标未配置'); return; }
      wx.openLocation({ latitude: lat, longitude: lng, name: t.meetingPoint || '集合点', scale: 18 });
    },

    copyOrderNo() {
      const no = this.data.info && this.data.info.registrationNo;
      if (!no) return;
      wx.setClipboardData({
        data: String(no),
        success() { toast('已复制订单号'); }
      });
    },

    cancelRegistration() {
      const that = this;
      const info = that.data.info || {};
      const generation = that._orderGeneration;
      const memberId = app.getUserID && app.getUserID();
      const isCurrent = () => generation === that._orderGeneration && memberId === (app.getUserID && app.getUserID());
      if (!info.id || that.data.cancelling || that._cancelPromptOpen) return;
      if (Number(info.paymentStatus) === 2 && !info.canRequestRefund) {
        toast(info.refundDisplayText || info.refundDeadlineDisplay || '当前订单不可自助退款');
        return;
      }
      const paid = Number(info.paymentStatus) === 2;
      that._cancelPromptOpen = true;
      const finishCancelPrompt = () => {
        if (that._finishCancelPrompt !== finishCancelPrompt) return false;
        that._finishCancelPrompt = null;
        that._cancelPromptOpen = false;
        return true;
      };
      that._finishCancelPrompt = finishCancelPrompt;
      modal.show({
        dangerKey: paid ? 'order.cancel-refund' : 'order.cancel',   // 三段式文案在 utils/danger-actions.js
        dangerParams: { deadline: info.refundDeadlineDisplay || '已核销或已过开始时间不可退' },
        success(res) {
          if (!finishCancelPrompt() || !isCurrent()) return;
          if (!res.confirm) return;
          if (that.data.cancelling) return;
          that.setData({ cancelling: true });
          cyLoading.show('处理中...');
          // 请求拥有的 loading/锁须释放；账号校验只限制业务回执更新。
          const finishCancellation = () => {
            if (that._finishCancellation !== finishCancellation) return;
            that._finishCancellation = null;
            cyLoading.hide();
            that.setData({ cancelling: false });
          };
          that._finishCancellation = finishCancellation;
          app.sendRequest({
            url: paid ? '/api/registration/cancel-refund' : '/api/registration/cancel',
            method: 'POST',
            data: { id: info.id },
            success(resp) {
              if (!isCurrent()) return;
              if (resp.code == '200') {
                toast.success(paid ? cancellationFeedback(resp) : '已取消', { duration: 5000 });
                that.triggerEvent('orderchanged', { id: info.id });
                that.getData(that._orderId);
              } else {
                toast(app.getRequestErrorMessage(resp, '处理失败，请联系客服'));
              }
            },
            fail(resp) {
              if (!isCurrent()) return;
              toast(app.getRequestErrorMessage(resp, '网络错误，请联系客服'));
            },
            complete: finishCancellation
          });
        },
        fail: finishCancelPrompt,
        complete: finishCancelPrompt
      });
    },

    _initWorkflow() {
      const that = this;
      const generation = that._orderGeneration;
      const verifyRegistrationPayment = createRegistrationPaymentVerifier(app);
      that._workflow = createCheckoutWorkflow({
        createOrder: function (payload, cb) {
          return app.sendRequest({
            url: '/api/registration/pay',
            method: 'POST',
            data: { id: payload.id },
            success: function (res) {
              if (generation !== that._orderGeneration) return;
              cyLoading.hide();
              if (res && res.code == '200' && hasCompletePaymentParams(res.data)) {
                cb({ ok: true, data: res.data });
              } else {
                that.setData({ paying: false });
                cb({
                  ok: false,
                  msg: res && res.code == '200' ? '支付参数不完整，请重试' : ((res && res.msg) || '支付失败')
                });
              }
            },
            fail: function () {
              if (generation !== that._orderGeneration) return;
              cyLoading.hide();
              that.setData({ paying: false });
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
          var regId = data.registrationId || data.id || that._orderId;
          if (!regId) { cb({ ok: false, errMsg: '缺少订单编号' }); return; }
          return verifyRegistrationPayment({ registrationId: regId }, cb);
        },
        isPayable: function (d) { return d && d.payParams && d.payParams.package; }
      });
    },

    payOrder() {
      const that = this;
      const info = that.data.info || {};
      if (!info.id || that.data.paying) return;
      that.setData({ paying: true });
      cyLoading.show('支付中...');
      const submitted = that._workflow.submit({ id: info.id }, {
        onOrderFail: function (res) {
          that.setData({ paying: false });
          toast((res && res.msg) || '支付失败');
        },
        onFreeSuccess: function () {
          that.setData({ paying: false });
          cyLoading.hide();
          toast.success('支付成功');
          that.getData(that._orderId);
        },
        onPayVerifying: function () {
          cyLoading.show('确认支付结果...');
        },
        onPaySuccess: function () {
          that.setData({ paying: false });
          cyLoading.hide();
          toast.success('支付成功');
          that.getData(that._orderId);
        },
        onPayCancel: function () {
          that.setData({ paying: false });
          toast('您已取消支付');
        },
        onPayFail: function (res) {
          cyLoading.hide();
          that.setData({ paying: false });
          toast((res && res.errMsg) || '支付失败，请重试');
        },
        onPayUnknown: function () {
          cyLoading.hide();
          that.setData({ paying: false });
          modal.show({
            title: '支付结果待确认',
            content: '暂不要重复支付，请稍后刷新订单查看最终状态。',
            showCancel: false
          });
        }
      });
      if (!submitted) {
        that.setData({ paying: false });
        cyLoading.hide();
        // unknown 是 workflow 故意留的闸(防重复建单扣款),但闸不能是哑巴:
        // 关掉「支付结果待确认」弹层后再点「继续支付」,原来什么都不说。
        if (that._workflow.getState() === 'unknown') {
          modal.show({
            title: '支付结果待确认',
            content: '这笔付款还在确认中，请勿重复支付。稍后回到本页下拉刷新即可看到最终状态。',
            showCancel: false
          });
        }
      }
    },

    // ---- 批5 探店日完局面:图鉴 / 通关奖励到账明细 / 完局后的 J·R90 入口 ----

    // 只对「已支付的 ③ 探索票」拉。①② 与未支付单拉了也只有空壳,
    // 而订单详情是每次 onShow 都会走的路径 —— 无条件拉 = 每笔订单白查五张表。
    loadCompletion(info) {
      const that = this
      const isExplore = resolveExploreOrder(info)
      const paid = Number(info && info.paymentStatus) === 2 || Number(info && info.registrationStatus) === 2
      if (!isExplore || !paid || !info.id) {
        if (that.data.completion && that.data.completion.show) that.setData({ completion: emptyCompletion() })
        return
      }
      // 与订单本体同一套防串号:onShow 会重复触发,旧响应不得覆盖新响应的结果。
      const seq = (that._completionRequestId || 0) + 1
      that._completionRequestId = seq
      const isCurrent = function () { return seq === that._completionRequestId }
      app.sendRequest({
        hideLoading: true,
        url: '/api/registration/explore-completion',
        method: 'POST',
        data: { id: info.id },
        success(res) {
          if (!isCurrent()) return
          if (res && res.code == '200' && res.data) {
            that.setData({ completion: toCompletionView(res.data) })
            return
          }
          // 业务失败也不留半个空壳:整块收起,玩家看到的仍是原来的订单详情。
          that.setData({ completion: emptyCompletion() })
        },
        fail() {
          if (!isCurrent()) return
          that.setData({ completion: emptyCompletion() })
        }
      })
    },

    // J:自愿关注主办俱乐部主体。自愿、可不做,不与任何权益交换。
    followClub() {
      const that = this
      const revisit = (that.data.completion || {}).revisit || {}
      if (!revisit.canFollow || !revisit.clubLeaderMemberId || that._following) return
      that._following = true
      app.sendRequest({
        url: '/api/user/follow/action',
        method: 'POST',
        // R10-07:关注按钮只表达「关注」;丢响应后重试同一意图幂等,不会变取消。
        data: { follow_member_id: revisit.clubLeaderMemberId, follow: 1 },
        success(res) {
          if (res && res.code == '200') {
            // 只有服务端确认才置位 —— 乐观置位会让失败的关注在屏幕上变成"已关注"。
            that.setData({ 'completion.revisit.followed': true, 'completion.revisit.canFollow': false })
            toast('已关注')
          } else {
            toast(app.getRequestErrorMessage(res, '关注失败，请重试'))
          }
        },
        fail(res) {
          toast(app.getRequestErrorMessage(res, '网络错误，请重试'))
        },
        complete() { that._following = false }
      })
    },

    // J:自愿入群。公开团直进、私密团进待审 —— 两种回执都要说清,不许把 pending 显示成已入群。
    joinClub() {
      const that = this
      const revisit = (that.data.completion || {}).revisit || {}
      if (!revisit.canJoin || !revisit.clubId || that._joining) return
      that._joining = true
      app.sendRequest({
        url: '/api/club/join',
        method: 'POST',
        data: JSON.stringify({ id: revisit.clubId }),
        header: { 'Content-Type': 'application/json' },
        success(res) {
          if (res && res.code == '200') {
            const joined = !!(res.data && res.data.state === 'joined')
            that.setData({
              'completion.revisit.joined': joined,
              'completion.revisit.canJoin': false,
              'completion.revisit.joinStateText': joined ? '已加入俱乐部' : '申请已提交，等待主理人审核'
            })
          } else {
            toast(app.getRequestErrorMessage(res, '加入失败，请重试'))
          }
        },
        fail(res) {
          toast(app.getRequestErrorMessage(res, '网络错误，请重试'))
        },
        complete() { that._joining = false }
      })
    },

    // R90:回访入口。没有下期就什么都不做 —— 钮上写的就是"下一期开售后会在这里出现"。
    goNextEdition() {
      const revisit = (this.data.completion || {}).revisit || {}
      if (!revisit.hasNextEdition || !revisit.nextTopicId) return
      this._leave('/pages/topic/index/index?id=' + revisit.nextTopicId)
    },

    formatDateTime(dateTimeStr) {
      if (!dateTimeStr) return { date: '', time: '' };
      try {
        const date = new Date(String(dateTimeStr).replace(/-/g, '/'));
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return {
          date: year + '.' + month + '.' + day,
          time: hours + ':' + minutes
        };
      } catch (error) {
        return { date: '', time: '' };
      }
    },

    getData: function (_id, dedupe) {
      const that = this;
      if (dedupe && that._orderFetchInFlight) return;
      const orderGeneration = that._orderGeneration;
      const requestId = (that._orderRequestId || 0) + 1;
      that._orderRequestId = requestId;
      that._orderFetchInFlight = requestId;
      const settleFetch = function () {
        if (that._orderFetchInFlight === requestId) that._orderFetchInFlight = 0;
      };
      const isCurrentRequest = function () {
        return requestId === that._orderRequestId;
      };
      // 已有订单在屏时(onShow 后台刷新)不回退到 loading,避免闪白;失败也不顶掉已渲染内容
      const hasRendered = that.data.loadState === 'ready';
      if (!hasRendered) that.setData({ loadState: 'loading', loadErrorText: '' });
      // 首屏失败由结果面板说原因,不再另弹同义 toast;订单已在屏时(后台刷新失败)没有面板,只剩 toast 这一个信号。
      const markFailed = function (state, text) {
        if (!isCurrentRequest()) return;
        if (hasRendered || that.data.loadState === 'ready') { toast(text); return; }
        that.setData({ loadState: state, loadErrorText: text });
      };
      app.sendRequest({
        hideLoading: true,
        url: '/api/registration/info',
        data: { id: that._orderId },
        method: 'POST',
        success: function (res) {
          settleFetch();
          if (that._orderGeneration !== orderGeneration) return;
          // 允许较早请求在最新请求仍 loading 时提供首屏兜底;最新请求已结束后,旧响应不得复活或覆盖结果。
          if (!isCurrentRequest() && that.data.loadState !== 'loading') return;
          // 后端偶发返回 code=200 但 data 为 null/非对象,直接往上写字段会 TypeError 白屏
          const isOrderObject = res.data !== null
            && typeof res.data === 'object'
            && !Array.isArray(res.data);
          if (res.code == '200' && isOrderObject) {
            const info = res.data;
            const summary = summarizeOrderState(info);
            info.orderStateKey = summary.key;
            info.statusText = summary.text;
            info.refundDisplayText = summary.refundText;
            info.refundDeadlineText = formatRefundDeadline(info.refundInfo && info.refundInfo.deadline);
            // 退款态说的是退款事实;refundInfo.reason 是「可不可退」的政策文案(含「预计1-3个工作日」),
            // 退款已发生后再把它放在前面就是一句没人兑现的承诺。
            if (info.orderStateKey === 'refunding' || info.orderStateKey === 'refunded') {
              info.refundDeadlineDisplay = '';
            } else if (!info.refundDeadlineDisplay) {
              if (info.refundInfo && info.refundInfo.refundable && info.refundDeadlineText) {
                info.refundDeadlineDisplay = '可免费取消至 ' + info.refundDeadlineText.replace(
                  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/,
                  function (_, y, m, d, hm) {
                    return Number(m) + '月' + Number(d) + '日 ' + hm;
                  }
                );
              } else if (info.refundInfo && info.refundInfo.reason) {
                info.refundDeadlineDisplay = info.refundInfo.reason;
              }
            }
            info.canRequestRefund = info.orderStateKey === 'not_started' || info.orderStateKey === 'in_progress';
            const isTopicOrder = Number(info.ownerType) === 1;
            // purchaseKind 非空时权威；仅存量 NULL 单回落到明确 chapterId，权益延迟到达时可补正类型。
            const isExploreOrder = resolveExploreOrder(info);
            info.isTopicOrder = isTopicOrder;
            info.isExploreOrder = isExploreOrder;
            info.organizerLabel = isTopicOrder ? '主理人' : '主办方';
            info.organizerDisplayName = info.organizerName || (isTopicOrder ? '主题主理人' : '活动主办方');
            info.typeLabel = isTopicOrder ? '城市路线' : (isExploreOrder ? '探店日' : '城市定向场次');
            info.primaryActionText = isTopicOrder ? '进入路线' : (isExploreOrder ? '进入游玩' : '继续探索');
            info.secondaryActionText = isTopicOrder ? '路线详情' : '回场次详情';
            // 探店日票面:场次时间槽与集合点来自票种快照(omsTicket),拿不到就不显示、不编
            const ticket = info.omsTicket || null;
            if (ticket && ticket.startTime) {
              const st = String(ticket.startTime);
              const et = String(ticket.endTime || '');
              info.sessionTimeText = st.slice(5, 16) + (et
                ? ('–' + (et.slice(0, 10) === st.slice(0, 10) ? et.slice(11, 16) : et.slice(5, 16))) : '');
            }
            info.meetingPointText = (ticket && ticket.meetingPoint) || '';
            const gatherLat = ticket ? parseFloat(ticket.gatherLat) : NaN;
            const gatherLng = ticket ? parseFloat(ticket.gatherLng) : NaN;
            info.meetingPointCoordinateMissing = isExploreOrder
              && (!Number.isFinite(gatherLat) || !Number.isFinite(gatherLng));
            info.meetingPointDisplayText = info.meetingPointCoordinateMissing
              ? ((info.meetingPointText || '集合点待补充') + ' · 坐标待补充')
              : info.meetingPointText;

            if (info.orderStateKey === 'pending_payment' && info.payExpireTime) {
              const expire = toDisplayTime(info.payExpireTime);
              info.orderHint = expire ? ('请在 ' + expire + ' 前完成支付') : '请完成支付后使用票夹';
            } else if (info.orderStateKey === 'refunding' || info.orderStateKey === 'refunded' || info.orderStateKey === 'non_refundable' || info.orderStateKey === 'manual_refund') {
              info.orderHint = info.refundDeadlineDisplay || info.refundDisplayText;
            } else if (Number(info.registrationStatus) === 2) {
              info.orderHint = isTopicOrder
                ? '票夹已生成，可进入路线查看城市节点与打卡反馈'
                : (isExploreOrder ? '票夹已生成，请按场次时间到集合点开场' : '票夹已生成，可继续探索或现场核验');
            } else if (Number(info.registrationStatus) === 1) {
              info.orderHint = '请完成支付后使用票夹';
            } else {
              info.orderHint = '订单已关闭，如有疑问请联系客服';
            }

            let eventDate = '';
            let eventTime = '';
            let productTitle = '';
            if (info.cmsActivity) {
              productTitle = info.activityTitle || info.cmsActivity.title || info.cmsActivity.name || '';
              if (info.cmsActivity.startDate) {
                const dt = that.formatDateTime(info.cmsActivity.startDate);
                info.cmsActivity.startDateFormatted = dt.date;
                info.cmsActivity.startTimeFormatted = dt.time;
                eventDate = dt.date;
                eventTime = dt.time;
              }
            } else if (info.cmsTopic) {
              productTitle = info.cmsTopic.name || '';
              if (info.cmsTopic.startDate) {
                const dt = that.formatDateTime(info.cmsTopic.startDate);
                info.cmsTopic.startDateFormatted = dt.date;
                info.cmsTopic.startTimeFormatted = dt.time;
                eventDate = dt.date;
                eventTime = dt.time;
              }
            }

            const qty = Number(info.orderNum) > 0 ? Number(info.orderNum) : 1;
            const pointAmt = Number(info.pointPaymentAmount);
            const wechatAmt = Number(info.wechatPaymentAmount);
            const primaryCta = resolvePrimaryCta(info.orderStateKey, info.verificationStatus);

            that.setData({
              /* 稿 578:2298(D07)「大金额与状态先行」——头图上第一眼是实付金额,
                 然后才是路线名、场次时间、一颗状态药丸。
                 ⚠️ 时间这一行头图与「订单明细」里的「日期与时间」是同一个事实,
                    所以只算一次:有场次时间槽(探店日票种快照)就用它,否则用日期 · 时间。
                    两处各拼一遍必然有一天分叉。 */
              whenText: info.sessionTimeText || [eventDate, eventTime].filter(Boolean).join(' · '),
              statusTone: STATUS_TONE[info.orderStateKey] || 'neutral',
              /* 稿 578:2313 那张卡:标题 / 一句话 / 右上角一个状态词。
                 ⚠️ 退款中那档含「待平台审核」,标题只能说「退款申请已提交」,没批准前不说「已受理」;
                    当前走到哪一步由右上角那个词说(退款审核中 / 退款处理中 / 已退款)。
                    终态在全仓统一叫「已退款」,别另起说法(cross-end-copy 契约钉着这条)。 */
              stateNotice: STATE_TITLE[info.orderStateKey]
                ? { show: true,
                    title: STATE_TITLE[info.orderStateKey],
                    sub: info.orderHint || '',
                    tag: info.statusText || '' }
                : { show: false },
              info: info,
              heroImage: resolveHeroImage(info),
              productTitle: productTitle,
              orderQty: qty,
              showPointPay: !isNaN(pointAmt) && pointAmt > 0,
              showWechatPay: !isNaN(wechatAmt) && wechatAmt > 0,
              paymentTimeText: toDisplayTime(info.paymentTime),
              participateDateText: toDisplayTime(info.participateDate) || (info.participateDate || ''),
              verificationTimeText: Number(info.verificationStatus) === 1 ? toDisplayTime(info.verificationTime) : '',
              orderTimeline: buildOrderTimeline(info),
              expiresAtText: toDisplayTime(info.expiresAt),
              primaryCta: primaryCta,
              showSecondaryTicket: primaryCta !== 'ticket',
              loadState: 'ready',
              loadErrorText: ''
            });
            that.loadCompletion(info);
            that.loadMarketingConsent(info);
          } else {
            // 过时请求的失败不能在新请求已接管后弹出误导性提示。
            markFailed('failed_business', app.getRequestErrorMessage(res, '订单暂时读不到'));
          }
        },
        fail: function (res) {
          settleFetch();
          // 过时请求的失败不能在新请求已接管后弹出误导性提示。
          markFailed('failed_network', '网络异常，订单没有读到');
        }
      });
    }

  },
})
