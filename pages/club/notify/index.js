const toast = require('../../../utils/toast.js');
const { bizFailureMessage } = require('../../../utils/response-shape.js');
const app = getApp()

const AUDIENCES = [
  { value: 'ALL_MEMBERS', label: '全部成员', eventOnly: false },
  { value: 'ADMINS', label: '管理员', eventOnly: false },
  { value: 'REGISTERED', label: '本场已报名', eventOnly: true },
  { value: 'WAITLIST', label: '本场候补', eventOnly: true },
  { value: 'NO_SHOW', label: '本场未到场', eventOnly: true },
  { value: 'INACTIVE', label: '近 90 天未活跃', eventOnly: false },
]

function positiveId(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
function jsonBody(data) { return JSON.stringify(data || {}) }
function jsonHeader() { return { 'Content-Type': 'application/json' } }
function ok(res) { return !!res && (res.code === 200 || res.code === '200') }
function newRequestId() {
  return 'campaign-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
}
/* CU-C-135:服务端只下发 total/success/failed 三个数 + 一个状态字符串。
   「待投递」是这三个数剩下的那部分,不是服务端另一个字段;「处理中」得让人在卡面上看见,
   不能只活在 send 那一刻的 toast 里(.toast 三秒就没了,卡片还写着 4/0/0)。
   没有的数按 0 显示,不遮起来。 */
function presentCampaign(campaign) {
  const total = Number(campaign.totalCount) || 0
  const success = Number(campaign.successCount) || 0
  const failed = Number(campaign.failedCount) || 0
  const status = String(campaign.status || '').toUpperCase()
  return Object.assign({}, campaign, {
    pendingCount: Math.max(total - success - failed, 0),
    processing: status === 'PROCESSING',
    statusText: status === 'COMPLETED' ? '已投递完成' : status === 'PARTIAL_FAILED' ? '部分未送达' : '投递中',
  })
}

Page({
  data: {
    statusBarHeight: (app.globalData || {}).statusBarHeight || 44,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    clubId: null,
    state: 'loading',
    errorText: '',
    audiences: AUDIENCES,
    audienceType: 'ALL_MEMBERS',
    title: '',
    content: '',
    previewState: 'idle',
    recipientCount: 0,
    previewError: '',
    sending: false,
    retrying: false,
    refreshing: false,
    campaign: null,
    draftRequestId: '',
  },

  onLoad(options) {
    const clubId = positiveId(options && (options.clubId || options.id))
    const activityId = positiveId(options && options.activityId)
    if (!clubId) {
      this.setData({ state: 'error', errorText: '缺少俱乐部 ID' })
      return
    }
    const audiences = AUDIENCES.map(item => Object.assign({}, item, {
      disabled: item.eventOnly && !activityId,
    }))
    // activityId 只在 js 里当路由参数用,wxml 一个字都不渲染 —— 进 data 就是死字段(U4 门禁),
    // 而且它一辈子不变,没有任何理由走 setData。留在实例上。
    this._activityId = activityId
    this.setData({ clubId, audiences })
    this.loadAccess()
  },

  // 根栈兜底:这四页可由分享/深链直达,栈深为 1 时 navigateBack 是空操作,
  // 必须退回俱乐部列表 tab,否则用户卡在页面里出不去(all-page-back-stack-contract)。
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/talent/list/index' })
  },
  retryLoad() { this.loadAccess() },
  onPullDownRefresh() { this.loadAccess() },

  loadAccess() {
    const that = this
    this.setData({ state: 'loading', errorText: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/access/me',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId, activityId: this._activityId }),
      header: jsonHeader(),
      success(res) {
        const access = ok(res) && res.data && typeof res.data === 'object' ? res.data : null
        const permissions = access && Array.isArray(access.permissions) ? access.permissions : []
        const activityId = that._activityId
        const canNotifyAllMembers = permissions.indexOf('club:notify:send') >= 0
        const canOperateEvent = !!activityId && permissions.indexOf('club:event:operate') >= 0
        if (!access || access.active !== true || String(access.club && access.club.id) !== String(that.data.clubId)
            || (!canNotifyAllMembers && !canOperateEvent)) {
          that.setData({ state: 'no-permission', errorText: bizFailureMessage(res, '当前角色没有成员通知权限') })
          return
        }
        const audiences = AUDIENCES.map(item => Object.assign({}, item, {
          disabled: item.eventOnly
            ? !canOperateEvent
            : !canNotifyAllMembers,
          hint: item.eventOnly
            ? (!activityId ? '从具体活动进入后才可选' : (!canOperateEvent ? '当前角色没有本场通知权限' : ''))
            : '',
        }))
        const audienceType = activityId && canOperateEvent ? 'REGISTERED' : 'ALL_MEMBERS'
        that.setData({ state: 'ready', audiences, audienceType })
        // 人数拉取放在**权限确认之后**,不是 onLoad —— 提前发等于让没权限的人平白吃一个 403
        that.loadAudienceCounts()
      },
      fail() { that.setData({ state: 'network-error', errorText: '网络没有连上' }) },
      successStatusAbnormal(res) {
        that.setData({ state: 'error', errorText: (res && res.msg) || '通知权限暂时不可用' })
      },
      complete() { wx.stopPullDownRefresh() },
    })
  },

  /* 稿 R4 290:526:每个受众分组右侧带人数,进页面就有,不必先选一个再 preview。
     ⚠️ 没选活动时三个「本场」分组服务端回 null 不是 0,这里也不许拿 0 兜底 ——
        「还没选活动、算不了」和「这个分群一个人都没有」是两件事,写成 0 就把前者说成了后者。 */
  loadAudienceCounts() {
    const that = this
    app.sendRequest({
      hideLoading: true, silentError: true,
      url: '/api/club/event-notification/audience-counts', method: 'POST',
      data: JSON.stringify({ clubId: this.data.clubId, activityId: this._activityId || null }),
      header: { 'Content-Type': 'application/json' },
      success(res) {
        const ok = res && (res.code === 200 || res.code === '200')
        const counts = ok && res.data && res.data.counts ? res.data.counts : null
        if (!counts) return
        that.setData({
          audiences: that.data.audiences.map(item => Object.assign({}, item, {
            countText: typeof counts[item.value] === 'number' ? counts[item.value] + ' 人' : '',
          })),
        })
      },
      // 人数是这一行的装饰,算不出来就不显示。为它弹一次全局 toast 是噪音,
      // 而且会盖住页面自己那条更要紧的权限/网络错误。
      fail() {},
    })
  },

  chooseAudience(e) {
    if (this.data.sending || this.data.retrying) return
    const value = String(e.currentTarget.dataset.value || '')
    const option = this.data.audiences.find(item => item.value === value)
    if (!option || option.disabled) return
    this.setData({ audienceType: value, previewState: 'idle', campaign: null, draftRequestId: '' })
  },
  onTitleInput(e) {
    this.setData({ title: e.detail.value, previewState: 'idle', campaign: null, draftRequestId: '' })
  },
  onContentInput(e) {
    this.setData({ content: e.detail.value, previewState: 'idle', campaign: null, draftRequestId: '' })
  },

  payload(sending) {
    return {
      clubId: this.data.clubId,
      activityId: this._activityId,
      audienceType: this.data.audienceType,
      channel: 'IN_APP',
      title: this.data.title.trim(),
      content: this.data.content.trim(),
      requestId: sending ? (this.data.draftRequestId || newRequestId()) : null,
    }
  },

  validDraft() {
    const title = this.data.title.trim()
    const content = this.data.content.trim()
    if (!title || title.length > 80) {
      toast('标题需为 1–80 字')
      return false
    }
    if (!content || content.length > 1000) {
      toast('内容需为 1–1000 字')
      return false
    }
    return true
  },

  preview() {
    if (!this.validDraft() || this.data.previewState === 'loading' || this.data.sending) return
    const that = this
    this.setData({ previewState: 'loading', previewError: '', campaign: null })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/event-notification/preview',
      method: 'POST',
      data: jsonBody(this.payload(false)),
      header: jsonHeader(),
      success(res) {
        const data = ok(res) && res.data && typeof res.data === 'object' ? res.data : null
        const count = data && Number(data.recipientCount)
        if (!data || !Number.isInteger(count) || count < 0 || data.phoneIncluded !== false
            || data.inApp !== 'AVAILABLE' || data.wechatSubscription !== 'UNAVAILABLE') {
          that.setData({ previewState: 'error', previewError: bizFailureMessage(res, '受众预览不可用') })
          return
        }
        that.setData({ previewState: count === 0 ? 'empty' : 'ready', recipientCount: count })
      },
      fail() { that.setData({ previewState: 'error', previewError: '网络没有连上' }) },
      successStatusAbnormal(res) {
        that.setData({ previewState: 'error', previewError: (res && res.msg) || '受众预览不可用' })
      },
    })
  },

  send() {
    if (!this.validDraft() || this.data.previewState !== 'ready' || this.data.sending) return
    const that = this
    const payload = this.payload(true)
    this.setData({ sending: true, draftRequestId: payload.requestId })
    app.sendRequest({
      silentError: true,
      url: '/api/club/event-notification/send',
      method: 'POST',
      data: jsonBody(payload),
      header: jsonHeader(),
      success(res) {
        const campaign = ok(res) && res.data && positiveId(res.data.id) ? res.data : null
        if (!campaign) {
          toast(bizFailureMessage(res, '通知发送失败'))
          return
        }
        that.setData({ campaign: presentCampaign(campaign) })
        const status = String(campaign.status || '').toUpperCase()
        if (status === 'COMPLETED') toast('站内通知已发送', { icon: 'success' })
        else if (status === 'PARTIAL_FAILED') toast('部分发送失败')
        else toast('通知已提交，正在投递')
      },
      fail() { toast('网络异常，请稍后重试') },
      successStatusAbnormal(res) {
        toast((res && res.msg) || '通知发送失败')
      },
      complete() { that.setData({ sending: false }) },
    })
  },

  retryFailed() {
    const campaignId = positiveId(this.data.campaign && this.data.campaign.id)
    if (!campaignId || this.data.retrying || Number(this.data.campaign.failedCount) <= 0) return
    const that = this
    this.setData({ retrying: true })
    app.sendRequest({
      silentError: true,
      url: '/api/club/event-notification/retry',
      method: 'POST',
      data: jsonBody({ campaignId }),
      header: jsonHeader(),
      success(res) {
        const campaign = ok(res) && res.data && positiveId(res.data.id) ? res.data : null
        if (!campaign) {
          toast(bizFailureMessage(res, '重试失败'))
          return
        }
        that.setData({ campaign: presentCampaign(campaign) })
        toast(Number(campaign.failedCount) > 0 ? '仍有失败项' : '失败项已重试')
      },
      fail() { toast('网络异常，请稍后重试') },
      successStatusAbnormal(res) {
        toast((res && res.msg) || '重试失败')
      },
      complete() { that.setData({ retrying: false }) },
    })
  },

  /* CU-C-135:send 回来时任务常常还是 PROCESSING,而这一页原来只存那一次响应 ——
     后台投完了页面也不会知道,数字永远停在 4/0/0。回来(含从别的页返回)静默读一次,
     点「刷新」显式读一次。读不到就保留上一次的数:展示过的数字不能因为一次网络失败凭空变 0。 */
  onShow() {
    if (positiveId(this.data.campaign && this.data.campaign.id)) this.refreshCampaign({ silent: true })
  },

  refreshCampaign(options) {
    const campaignId = positiveId(this.data.campaign && this.data.campaign.id)
    if (!campaignId || this.data.refreshing || this.data.sending || this.data.retrying) return
    const silent = !!(options && options.silent)
    const that = this
    this.setData({ refreshing: true })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/club/event-notification/status',
      method: 'POST',
      data: jsonBody({ campaignId }),
      header: jsonHeader(),
      success(res) {
        const campaign = ok(res) && res.data && positiveId(res.data.id) ? res.data : null
        if (!campaign) {
          if (!silent) toast(bizFailureMessage(res, '投递状态没读到'))
          return
        }
        that.setData({ campaign: presentCampaign(campaign) })
        if (!silent) toast('投递状态已更新')
      },
      fail() { if (!silent) toast('网络异常，请稍后重试') },
      successStatusAbnormal(res) { if (!silent) toast((res && res.msg) || '投递状态没读到') },
      complete() { that.setData({ refreshing: false }) },
    })
  },
})
