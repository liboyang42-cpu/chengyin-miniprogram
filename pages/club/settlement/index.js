// G2 结算 · 俱乐部分润。
//
// 金额由服务端区分核算净额与实际入账；前端只展示，不补零或自行计算。
const app = getApp()
// 2026-09-15 起「提现」不再走银行卡表单:平台不打款,一律弹平台客服微信线下处理。
const withdrawCs = require('../../../utils/withdraw-cs.js')
const { bizFailureMessage } = require('../../../utils/response-shape.js')

function positiveId(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
function jsonBody(data) { return JSON.stringify(data || {}) }
function jsonHeader() { return { 'Content-Type': 'application/json' } }
function ok(res) { return !!res && (res.code === 200 || res.code === '200') }
function requestId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}
function nonEmptyString(value) { return typeof value === 'string' && value.length > 0 ? value : null }

/** 校验并归一化 /settlement/summary 的响应：所有金额字段必须是服务端已格式化好的字符串，
 * 前端只做透传展示，缺字段/类型不对一律判失败（fail-closed，不猜、不补 0）。 */
function normalizeSummary(data) {
  if (!data || typeof data !== 'object') return null
  const settledAmountText = nonEmptyString(data.settledAmountText)
  const settledAmountStatus = data.settledAmountStatus
  const unverifiedSettledCount = data.unverifiedSettledCount
  if (!Number.isInteger(unverifiedSettledCount) || unverifiedSettledCount < 0) return null
  if (settledAmountStatus === 'verified') {
    if (!settledAmountText || unverifiedSettledCount !== 0) return null
  } else if (settledAmountStatus === 'unverified') {
    if (data.settledAmountText !== null || unverifiedSettledCount === 0) return null
  } else return null
  const rawTopics = Array.isArray(data.topics) ? data.topics : null
  if (!rawTopics) return null
  const topics = []
  const seen = new Set()
  let missing = 0
  for (let i = 0; i < rawTopics.length; i += 1) {
    const row = rawTopics[i]
    const id = positiveId(row && row.id)
    // 结算行 id ≠ 主题 id:明细页 source=finance 按 **topicId** 在 /api/coop/finance 里找记录,
    // 传结算行 id 会永远落「这条结算记录不存在或已不可见」(E-02)。缺 topicId 判失败,不猜。
    const topicId = positiveId(row && row.topicId)
    const name = nonEmptyString(row && row.name)
    const amountText = nonEmptyString(row && row.amountText)
    const arrivedText = nonEmptyString(row && row.arrivedText)
    const paidText = nonEmptyString(row && row.paidText)
    const status = row && row.status
    const amountStatus = row && row.amountStatus
    const originalAmountText = nonEmptyString(row && row.originalAmountText)
    const executedAdjustmentText = nonEmptyString(row && row.executedAdjustmentText)
    const netAmountText = nonEmptyString(row && row.netAmountText)
    if (!id || !topicId || seen.has(id) || !name || !arrivedText || !paidText
        || !originalAmountText || !executedAdjustmentText || !netAmountText
        || !['settled', 'pending', 'void'].includes(status)) return null
    if (amountStatus === 'unverified') {
      if (status !== 'settled' || row.amountText !== null) return null
      missing += 1
    } else if (amountStatus !== 'verified' || !amountText) return null
    seen.add(id)
    topics.push({ id, topicId, name, amountText, amountStatus, originalAmountText,
      executedAdjustmentText, netAmountText, arrivedText, paidText, status })
  }
  if (missing !== unverifiedSettledCount) return null
  // 余额三段只给主理人本人(9-17 总控裁定);服务端没明确说是本人一律不显示
  const isOwner = data.isOwner === true
  return { settledAmountText, settledAmountStatus, unverifiedSettledCount, topics, isOwner }
}

Page({
  data: {
    statusBarHeight: (app.globalData || {}).statusBarHeight || 44,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    state: 'loading',
    errorText: '',
    summary: null,
    withdrawing: false,
    // CU-C-92:可提现余额决定提现主按钮能不能用(unknown/positive/zero),
    // 数来自 cy-funds-stages 自己拉的 /api/wallet/stages,本页不重复请求。
    withdrawState: 'unknown',
  },

  onLoad(options) {
    const clubId = positiveId(options && (options.clubId || options.id))
    if (!clubId) {
      this.setData({ state: 'error', errorText: '缺少俱乐部 ID' })
      return
    }
    this._clubId = clubId
    this.setData({ clubId })   // 2026-09-06 起 wxml 的 cy-access-gate 读它做范围核对
    this.loadSummary()
  },
  onPullDownRefresh() { this.loadSummary() },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/talent/list/index' })
  },
  retryLoad() { this.loadSummary() },

  loadSummary() {
    const that = this
    this.setData({ state: 'loading', errorText: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/settlement/summary',
      method: 'POST',
      data: jsonBody({ clubId: this._clubId }),
      header: jsonHeader(),
      success(res) {
        const summary = ok(res) ? normalizeSummary(res.data) : null
        if (!summary) {
          // code=200 但校验失败时 res.msg 是「操作成功」,不能当失败原因(2026-09-17 拍板)。
          that.setData({ state: 'error', errorText: bizFailureMessage(res, '结算数据暂不可用') })
          return
        }
        that.setData({ state: summary.topics.length ? 'ready' : 'empty', summary })
      },
      fail() { that.setData({ state: 'network-error', errorText: '网络没有连上' }) },
      successStatusAbnormal(res) {
        that.setData({ state: 'error', errorText: (res && res.msg) || '结算数据暂不可用' })
      },
      complete() { wx.stopPullDownRefresh() },
    })
  },

  goTopicSettlement(e) {
    const topicId = positiveId(e && e.currentTarget && e.currentTarget.dataset.topicId)
    if (!topicId) return
    // CU-C-41(用户裁决 A):俱乐部结算行走俱乐部视角 —— 明细页 source=club 按 topicId 从
    // /api/club/settlement/summary 命中。原来的 source=finance 只在「我发起 + 我是发布者」
    // 的主题里找行,受益方是俱乐部、发布者是别人时恒落「不可见」。
    // coop/settlement-detail 只有这两个 source 才把 topicId 当记录标识。
    // 同一主题可能有多条结算记录,带上本行 id 让明细页按行取,不按 topicId 取第一条
    const rowId = positiveId(e.currentTarget.dataset.id)
    wx.navigateTo({ url: '/pages/coop/settlement-detail/index?source=club&topicId=' + topicId + (rowId ? '&id=' + rowId : '') + '&clubId=' + this._clubId })
  },

  // CU-C-92:可提现为 0(或余额还没取到)时提现不是可做的动作 —— 禁用主按钮并写明条件;
  // 余额被取到时才放行。与按钮的 disabled 同一口径,兼作连击兜底。
  onStages(e) {
    const detail = (e && e.detail) || {}
    this.setData({ withdrawState: !detail.known ? 'unknown' : (detail.positive ? 'positive' : 'zero') })
  },

  // 2026-09-15 收款模型定稿 §3:平台不打款。本页不再跳银行卡表单页,也不自己发提现请求,
  // 一律弹平台客服微信线下处理。后端 /api/club/settlement/withdraw 保留,不再由本页触达。
  goWithdraw() {
    if (this.data.withdrawState !== 'positive') return   // CU-C-92:零余额/余额未知不得发起
    withdrawCs.showWithdrawCsPopup();
  },
})
