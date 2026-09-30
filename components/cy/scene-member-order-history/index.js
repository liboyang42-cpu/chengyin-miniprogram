'use strict'

const modal = require('../../../utils/modal.js');
const cyLoading = require('../../../utils/loading.js');
const toast = require('../../../utils/toast.js');
const cancellationFeedback = require('../../../utils/cancellation-feedback.js');
// H09 我的订单(方案 §5.2)。行卡沿用 D04 既有范式(订单号 + 状态 chip + 时间 + 地点 + 实付款 + 双动作)。
//
// ⚠️ 这里是订单列表的**唯一实现**。subpackageMember/order/order 已退化成薄壳,渲染的就是本组件 ——
// 支付(/api/registration/pay + requestPayment + 轮询核账)和取消/退款
// (/api/registration/cancel | cancel-refund)两条资金路径只此一份,不允许再抄一遍。
// 页面壳与场景弹窗的差别只有一处:打开订单详情时往哪走(见 openDetail 的 open 事件)。
const app = getApp()
const policy = require('../../../utils/identity/identity-policy.js')
const { summarizeOrderState, formatRefundDeadline } = require('../../../utils/order-status.js')
const { resolveActualPaidAmount } = require('../../../utils/order-actual-pay.js')
const { createCheckoutWorkflow, hasCompletePaymentParams } = require('../../../utils/checkout/checkout-workflow.js')
const { createRegistrationPaymentVerifier } = require('../../../utils/checkout/registration-payment-verifier.js')

// 6-12:退款确认弹窗的截止话术只读后端返回的 refundInfo(可退状态与截止点都由后端 RefundPolicy 判)。
// 前端不自算、不写死规则 —— 原先那句「已核销/已过开始时间不可退」与集合前 24h 的真实规则不一致,
// 会让还能退的单被劝退。后端没给字段时只给中性话术,绝不替后端断言不可退。
function refundDeadlineText(row) {
  const info = row && row.refundInfo
  if (!info) return '退款规则以提交后的平台判定为准'
  if (info.refundable && info.deadline) {
    return '可免费取消至 ' + formatRefundDeadline(info.deadline)
  }
  return info.reason || '退款规则以提交后的平台判定为准'
}

// CU-M-103:空态的「去发现城市路线」只有玩家身份兑现得了 —— pages/index/index 检出商家身份会
// 立刻跳商家工作台,商家点了只能落到收入/扫码那面。商家能不能逛玩家发现页归产品定夺,
// 这一条先把兑现不了的按钮收掉。判据与 pages/index/index 的 viewSnap 同源:
// role 优先、user_type 兜底、debug_user_view='user' 强制玩家展示。
function canReachDiscoverRoutes() {
  return !policy.isMerchantView({
    role: wx.getStorageSync('role'),
    userType: wx.getStorageSync('user_type'),
    debugView: wx.getStorageSync('debug_user_view'),
  })
}

function formatDateTime(value) {
  if (!value) return ''
  try {
    const date = new Date(String(value).replace(/-/g, '/'))
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  } catch (e) {
    return ''
  }
}

function formatActivityTime(value) {
  if (!value) return ''
  try {
    const date = new Date(String(value).replace(/-/g, '/'))
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  } catch (e) {
    return ''
  }
}

function formatActivityTimeRange(start, end) {
  if (!start || !end) return ''
  return `${formatActivityTime(start)} - ${formatActivityTime(end)}`
}

Component({
  properties: {
    theme: { type: String, value: 'player' },
  },
  data: {
    activeTab: '0',
    orderTabs: [
      { key: '0', label: '全部' },
      { key: 'pending_payment', label: '待支付' },
      { key: 'not_started', label: '未开始' },
      { key: 'in_progress', label: '进行中' },
      { key: 'completed', label: '已完成' },
      { key: 'refunding', label: '退款中' },
      { key: 'refunded', label: '已退款' },
      { key: 'non_refundable', label: '不可退款' },
      { key: 'manual_refund', label: '人工售后' },
    ],
    list: [],
    page_no: 1,
    hasMore: false,
    nodata: false,
    hasOrders: false,
    isPaying: false,
    loading: false,
    errorMsg: '',
    canDiscoverRoutes: true,
    cancellingId: 0,
    verifyingPayment: false,
  },
  lifetimes: {
    attached() {
      this.setData({ canDiscoverRoutes: canReachDiscoverRoutes() })
      this._initWorkflow()
      this.getList()
    },
    detached() {
      if (this._workflow) this._workflow.destroy()
    },
  },
  pageLifetimes: {
    // 首次 attached/show single-flight；支付/退款回来后的后续 show 从第一页替换刷新。
    show() {
      if (this._listFetchInFlight && this._listMemberId === (app.getUserID && app.getUserID())) return
      // 返回页刷新保留已确认列表；失败时给非阻断提示，不把订单替换成整屏错误。
      this.setData({ page_no: 1, nodata: false, errorMsg: '' })
      this.getList(true, true)
    },
  },
  methods: {
    // 页面壳的 onReachBottom 转发进来。注意:后端 list 返回全量,hasMore 恒 false,
    // 这条路径当前不会真的翻页 —— 保留是为了后端改成分页时不用再接一次线。
    loadMore() {
      if (!this.data.hasMore) return
      this.setData({ page_no: this.data.page_no + 1 })
      this.getList()
    },

    getList(dedupe, replace) {
      const that = this
      const memberId = app.getUserID && app.getUserID()
      if (dedupe && that._listFetchInFlight && that._listMemberId === memberId) return
      if (that._listMemberId !== undefined && that._listMemberId !== memberId) {
        that.setData({ list: [], hasOrders: false, page_no: 1 })
      }
      that._listMemberId = memberId
      const requestId = (that._listRequestId || 0) + 1
      that._listRequestId = requestId
      that._listFetchInFlight = requestId
      const activeTab = that.data.activeTab
      const isCurrent = () => requestId === that._listRequestId && memberId === (app.getUserID && app.getUserID())
      const settleFetch = function () {
        if (that._listFetchInFlight === requestId) that._listFetchInFlight = 0
      }
      that.setData({ loading: true, errorMsg: '' })
      app.sendRequest({
        hideLoading: true,
        url: '/api/registration/list',
        method: 'POST',
        data: {
          pageNum: that.data.page_no,
          pageSize: app.getPageSize(),
          owner_type: 3,
          // 后端历史 status 只有 4 档;七态由已返回的报名、退款与时间事实在客户端统一归一。
          status: '0',
        },
        success(res) {
          if (!isCurrent()) return
          settleFetch()
          if (res && res.code == '200') {
            const rows = res.data && res.data.rows
            if (!Array.isArray(rows) || rows.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
              that.setData({ errorMsg: '订单数据暂时不可用，请稍后重试' })
              return
            }
            const allRows = rows.map((item) => {
              if (item.createTime) item.createTimeFormatted = formatDateTime(item.createTime)
              if (item.cmsActivity && item.cmsActivity.startDate && item.cmsActivity.endDate) {
                item.cmsActivity.timeRangeFormatted = formatActivityTimeRange(item.cmsActivity.startDate, item.cmsActivity.endDate)
              }
              if (item.cmsTopic && item.cmsTopic.startDate && item.cmsTopic.endDate) {
                item.cmsTopic.timeRangeFormatted = formatActivityTimeRange(item.cmsTopic.startDate, item.cmsTopic.endDate)
              }
              const summary = summarizeOrderState(item)
              item.orderStateKey = summary.key
              item.orderStateText = summary.text
              item.refundStateText = summary.refundText
              // RUN-43:实付款只写现金(微信实付),积分抵扣不计入;存量无拆分行按回落链兜底
              item.actualPaidAmount = resolveActualPaidAmount(item)
              return item
            })
            const list = activeTab === '0'
              ? allRows
              : allRows.filter((item) => item.orderStateKey === activeTab)
            that.setData({
              list: replace ? list : that.data.list.concat(list),
              hasOrders: replace ? rows.length > 0 : (that.data.hasOrders || rows.length > 0),
              // 后端 list 返回全量(total=全量),再上拉会重复,关闭分页追加一次性渲染
              hasMore: false,
            })
            if (rows.length < 1) that.setData({ nodata: true })
          } else {
            that.setData({ errorMsg: app.getRequestErrorMessage(res, '订单加载失败') })
          }
        },
        fail(res) {
          if (!isCurrent()) return
          settleFetch()
          that.setData({ errorMsg: app.getRequestErrorMessage(res, '订单加载失败') })
        },
        complete() {
          if (!isCurrent()) return
          settleFetch()
          that.setData({ loading: false, nodata: that.data.list.length < 1 })
        },
      })
    },

    switchTab(e) {
      this.setData({ activeTab: e.detail.key, page_no: 1, list: [], nodata: false, errorMsg: '' })
      this.getList()
    },

    retryList() {
      this.setData({ page_no: 1 })
      this.getList(false, true)
    },

    // 唯一与宿主形态相关的分支:场景里推 H10 子层,页面壳里由壳自己 navigateTo。
    openDetail(e) {
      const id = e.currentTarget.dataset.id
      if (!id) return
      this.triggerEvent('open', { id: 'member-order-detail', params: { id } })
    },

    goDiscoverRoutes() {
      wx.switchTab({ url: '/pages/index/index' })
    },

    cancelOrder(e) {
      const that = this
      const index = e.currentTarget.dataset.index
      const id = e.currentTarget.dataset.id
      const status = Number(e.currentTarget.dataset.status || 0)
      if (that._cancelPromptOpen || that._cancelRequestInFlight || that.data.cancellingId) return
      if (!id) {
        toast('获取订单信息失败')
        return
      }
      that._cancelPromptOpen = true
      modal.show({
        dangerKey: status === 2 ? 'order.cancel-refund' : 'order.cancel',   // 三段式文案在 utils/danger-actions.js
        dangerParams: { deadline: refundDeadlineText(that.data.list[index]) },
        success(res) {
          that._cancelPromptOpen = false
          if (res.confirm) that.cancelOrderRequest(id, index, status)
        },
        fail() { that._cancelPromptOpen = false },
        complete() { that._cancelPromptOpen = false },
      })
    },

    cancelOrderRequest(id, index, status) {
      const that = this
      if (!id || that._cancelRequestInFlight || that.data.cancellingId) return
      that._cancelRequestInFlight = true
      cyLoading.show('处理中...')
      that.setData({ cancellingId: Number(id) })
      app.sendRequest({
        // 已支付(报名成功 registrationStatus==2)走退款接口,与详情页一致;待支付订单仍用普通取消
        url: Number(status) === 2 ? '/api/registration/cancel-refund' : '/api/registration/cancel',
        method: 'POST',
        data: { id },
        success(res) {
          cyLoading.hide()
          if (res.code == '200') {
            toast.success(Number(status) === 2 ? cancellationFeedback(res) : '已取消', { duration: 5000 })
            // 退款的实际打款状态由 refund_application 回传,刷新而不是前端猜成“已退款”。
            that.setData({ page_no: 1 })
            that.getList(false, true)
          } else {
            toast(app.getRequestErrorMessage(res, '处理失败，请联系客服'), { duration: 2000 })
          }
        },
        fail() {
          cyLoading.hide()
          toast('网络错误，请重试', { duration: 2000 })
        },
        complete() {
          that._cancelRequestInFlight = false
          that.setData({ cancellingId: 0 })
        },
      })
    },

    _initWorkflow() {
      const that = this
      const verifyRegistrationPayment = createRegistrationPaymentVerifier(app)
      that._workflow = createCheckoutWorkflow({
        createOrder(payload, cb) {
          return app.sendRequest({
            url: '/api/registration/pay',
            method: 'POST',
            data: { id: payload.id },
            success(res) {
              cyLoading.hide()
              if (res && res.code == '200' && hasCompletePaymentParams(res.data)) {
                cb({ ok: true, data: res.data })
              } else {
                that.setData({ isPaying: false })
                cb({
                  ok: false,
                  msg: res && res.code == '200' ? '支付参数不完整，请重试' : ((res && res.msg) || '支付失败'),
                })
              }
            },
            fail() {
              cyLoading.hide()
              that.setData({ isPaying: false })
              cb({ ok: false, msg: '网络错误，请重试' })
            },
          })
        },
        requestPayment(orderData, cb) {
          const p = orderData.payParams
          wx.requestPayment({
            timeStamp: p.timeStamp,
            nonceStr: p.nonceStr,
            package: p.package,
            signType: p.signType,
            paySign: p.paySign,
            success() { cb({ ok: true }) },
            fail(res) {
              cb({ ok: false, cancelled: res.errMsg === 'requestPayment:fail cancel', errMsg: res.errMsg })
            },
          })
        },
        verifyPayment(data, cb) {
          const regId = data.registrationId || data.id
          if (!regId) { cb({ ok: false, errMsg: '缺少订单编号' }); return }
          return verifyRegistrationPayment({ registrationId: regId }, cb)
        },
        isPayable(d) { return d && d.payParams && d.payParams.package },
      })
    },

    payOrder(e) {
      const that = this
      if (that.data.isPaying) return
      const index = e.currentTarget.dataset.index
      const id = e.currentTarget.dataset.id
      if (!id) {
        toast('获取订单信息失败')
        return
      }
      that.setData({ isPaying: true })
      cyLoading.show('支付中...')
      that.payOrderRequest(id, index)
    },

    payOrderRequest(id, index) {
      const that = this
      const submitted = that._workflow.submit({ id }, {
        onOrderFail(res) {
          that.setData({ isPaying: false })
          toast((res && res.msg) || '支付失败', { duration: 2000 })
        },
        onFreeSuccess() {
          that.setData({ isPaying: false })
          that._updateOrderPaid(id, index)
        },
        onPayVerifying() {
          that.setData({ verifyingPayment: true })
          cyLoading.show('确认支付结果...')
        },
        onPaySuccess() {
          that.setData({ isPaying: false, verifyingPayment: false })
          cyLoading.hide()
          that._updateOrderPaid(id, index)
        },
        onPayCancel() {
          that.setData({ isPaying: false })
          toast('您已取消支付', { duration: 2000 })
        },
        onPayFail(res) {
          cyLoading.hide()
          that.setData({ isPaying: false, verifyingPayment: false })
          toast((res && res.errMsg) || '支付失败，请重试', { duration: 2000 })
        },
        onPayUnknown() {
          cyLoading.hide()
          that.setData({ isPaying: false, verifyingPayment: false })
          modal.show({
            title: '支付结果待确认',
            content: '暂不要重复支付，请稍后刷新订单查看最终状态。',
            showCancel: false,
          })
        },
      })
      if (!submitted) {
        that.setData({ isPaying: false })
        cyLoading.hide()
        // unknown 是 workflow 故意留的闸(防重复建单扣款),但闸不能是哑巴:
        // 关掉「支付结果待确认」弹层后再点「继续支付」,原来什么都不说。
        if (that._workflow.getState() === 'unknown') {
          modal.show({
            title: '支付结果待确认',
            content: '这笔付款还在确认中，请勿重复支付。稍后下拉刷新列表即可看到最终状态。',
            showCancel: false,
          })
        }
      }
    },

    _updateOrderPaid(id, index) {
      this.setData({ ['list[' + index + '].registrationStatus']: 2 })
      modal.show({
        title: '支付成功',
        content: '票已放入票夹，可随时出示入场码',
        confirmText: '去票夹',
        cancelText: '留在本页',
        success(r) {
          if (r.confirm) wx.navigateTo({ url: '/subpackageMember/signup/index?focusId=' + (id || '') })
        },
      })
    },
  },
})
