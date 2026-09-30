'use strict'

const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const app = getApp()
const analytics = require('../../../utils/analytics.js')
const { chinaDayStart, toTimestamp } = require('../../../utils/datetime.js')
const { isRecordList } = require('../../../utils/response-shape.js')
const { ticketWindowPassed, ticketWindowText } = require('../../../utils/ticket-window.js')

function ok(res) { return res && (res.code === 200 || res.code === '200') }

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function nonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function nonNegativeInteger(value) {
  const number = nonNegativeNumber(value)
  return number !== null && Number.isInteger(number) ? number : null
}

function countText(value) {
  // UI-04(2026-09-18):人数/条数没取到显示 0,不再显示横杠
  const number = nonNegativeInteger(value)
  return number === null ? '0' : String(number)
}

function coordinate(value, max) {
  const number = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() ? Number(value) : NaN)
  return Number.isFinite(number) && Math.abs(number) <= max ? number : null
}

function dateText(value) {
  if (!value) return ''
  const date = new Date(String(value).replace(/-/g, '/'))
  if (Number.isNaN(date.getTime())) return String(value)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function normalizeTicket(ticket) {
  const source = ticket || {}
  const remaining = nonNegativeInteger(source.remainingInventory)
  const price = nonNegativeNumber(source.price)
  // CU-C-32:履约窗(场次)已过的票不能当可售票。原来只判库存,过期场次在详情里
  // 看起来跟正常票一模一样,点下去一路到结算才被后端拒。
  const windowPassed = ticketWindowPassed(source)
  return {
    ...source,
    cmsRegistrationList: Array.isArray(source.cmsRegistrationList) ? source.cmsRegistrationList : [],
    _id: String(source.id == null ? '' : source.id),
    _dateText: source.startTime ? `场次时间 ${dateText(source.startTime)}${source.endTime ? ` - ${dateText(source.endTime)}` : ''}` : '',
    _deadlineText: source.endTime ? dateText(source.endTime) : '',
    _nameText: nonEmptyString(source.name) || '票种名称待确认',
    _priceText: price === null ? '价格待定' : `¥${price}`,
    _inventoryText: remaining === null ? '余票待确认' : remaining > 0 ? `剩余 ${remaining} 张` : '已售罄',
    // remaining_inventory 可空:商家没填库存 ≠ 卖完了。只把**确证的 0** 当售罄,
    // 空值照常可选(原来这里显示「余票待确认」、点下去却说「已售罄」并硬拦);
    // 真超卖由服务端建单时判,不在这里替它猜。
    _available: remaining === null || remaining > 0,
    _windowPassed: windowPassed,
    _windowText: windowPassed ? ticketWindowText(source) : '',
  }
}

function actionFor(info) {
  if (!info || (info.isSignUp !== 0 && info.isSignUp !== 1)) return { state: 'unavailable', text: '报名状态待确认' }
  if (info.isSignUp === 0) return { state: 'signup', text: '立即报名' }
  const now = Date.now()
  const start = info.startDate ? toTimestamp(String(info.startDate)) : NaN
  const endDayStart = info.endDate ? chinaDayStart(String(info.endDate)) : NaN
  const end = Number.isNaN(endDayStart) ? NaN : endDayStart + 24 * 60 * 60 * 1000 - 1
  if (!Number.isNaN(start) && now < start) return { state: 'view', text: '查看报名' }
  if (!Number.isNaN(end) && now > end) return { state: 'trace', text: '查看足迹' }
  return { state: 'play', text: '继续探索' }
}

/* CU-M-106:这一页的状态徽章过去用 activityStatusMeta(info.status) 查文案,
   可 utils/activity-status.js 那张表解释的是 **official_event.status**(0草稿/1即将开始/
   2报名中/3进行中/…),而这里的 info.status 是 cms_activity 的**审核码**(0 待审/1 通过/2 未过,
   见 CmsActivityMapper.xml 的 `status = 1` 上架闸)。于是审核通过(1)恒被念成「即将开始」,
   而同一行在「我的项目」列表按档期说「进行中」—— 走查读到的正是这两个字互相打架。
   状态文案与分桶口径由后端 ActivityLifecycle 一处算,列表与详情读同一个值;
   这里只剩「语义状态 → 徽章颜色」这一件展示层自己的事。 */
const STATE_VARIANT = {
  draft: 'neutral', pending: 'neutral', rejected: 'danger', offline: 'neutral',
  notStarted: 'neutral', running: 'success', completed: 'neutral',
}

Component({
  properties: { activityId: { type: String, value: '' } },
  data: {
    state: 'loading', // loading | error | empty | ready | missing | gate
    info: {},
    tickets: [],
    // M1-3 门卡:非俱乐部成员拿到的是 {gate:true, clubId, activityName, message},
    // 不是详情。当成正常详情渲染会得到「活动标题待确认 + 空票种」(B-03)。
    gateClubId: 0,
    gateMessage: '',
    selectedTicketId: '',
    expandedTicketId: '',
    statusText: '',
    statusVariant: 'done',
    dateText: '',
    hostName: '',
    hostAvatar: '',
    categoryText: '',
    titleText: '活动标题待确认',
    registrationCountText: '0',
    averageRatingText: '—',
    commentCountText: '0',
    hasLocation: false,
    actionState: 'signup',
    actionText: '立即报名',
    isOwner: false,
    errorMsg: '',
    cancelShow: false,
    cancelReason: '',
    canCancel: false,
    cancelling: false,
    cancelError: '',
    cancelBlocked: false,
    canConfirmSignup: false,
    voteShow: false,
    starsBox: [1, 1, 1, 1, 1],
    answer: -1,
    plnr: '',
    canSubmitComment: false,
    uploadImages: [],
    commentSubmitting: false,
    commentError: '',
  },
  observers: {
    activityId(value) {
      this.load(value)
    },
  },
  lifetimes: {
    attached() {
      this.load(this.data.activityId)
    },
    detached() {
      this._loadToken = (this._loadToken || 0) + 1
      this._cancelToken = (this._cancelToken || 0) + 1
      this._commentToken = (this._commentToken || 0) + 1
    },
  },
  methods: {
    load(id) {
      const requestedId = String(id || '')
      if (!requestedId) {
        this._loadToken = (this._loadToken || 0) + 1
        this._loadingId = ''
        this._loadedId = ''
        this.setData({ state: 'missing', info: {}, tickets: [] })
        return
      }
      if (this._loadingId === requestedId || this._loadedId === requestedId) return
      const token = (this._loadToken || 0) + 1
      this._loadToken = token
      this._cancelToken = (this._cancelToken || 0) + 1
      this._commentToken = (this._commentToken || 0) + 1
      this._loadingId = requestedId
      this._loadedId = ''
      this.setData({
        state: 'loading',
        errorMsg: '',
        info: {},
        tickets: [],
        selectedTicketId: '',
        expandedTicketId: '',
        canConfirmSignup: false,
        cancelShow: false,
        voteShow: false,
        cancelling: false,
        cancelError: '',
        cancelBlocked: false,
        commentSubmitting: false,
        commentError: '',
      })
      app.sendRequest({
        url: '/api/activity/info', method: 'POST', data: { id: requestedId }, hideLoading: true, silentError: true,
        success: (res) => {
          if (token !== this._loadToken) return
          this._loadingId = ''
          if (!ok(res)) {
            this.setData({ state: 'error', errorMsg: res && res.msg ? res.msg : '活动详情暂时打不开，请稍后重试。' })
            return
          }
          if (!res.data) {
            this.setData({ state: 'empty', info: {}, tickets: [] })
            return
          }
          if (typeof res.data !== 'object' || Array.isArray(res.data)) {
            this.setData({ state: 'error', errorMsg: '活动详情数据暂不可用。' })
            return
          }
          if (res.data.gate === true) {
            this._loadingId = ''
            this._loadedId = requestedId
            this.setData({
              state: 'gate',
              info: {}, tickets: [],
              gateClubId: Number(res.data.clubId) || 0,
              gateMessage: res.data.message || '来自俱乐部的活动，加入后查看',
            })
            return
          }
          const listFields = ['collaboratorsList', 'registrationList', 'memberTemplateList', 'commentList', 'sysCategoryList', 'omsTicketList']
          if (listFields.some((field) => res.data[field] != null && !isRecordList(res.data[field]))) {
            this.setData({ state: 'error', errorMsg: '活动详情数据暂不可用。' })
            return
          }
          const templates = (res.data.memberTemplateList || []).map((item) => {
            const duration = nonNegativeNumber(item.duration)
            const players = nonEmptyString(item.players)
              || (nonNegativeInteger(item.players) === null ? '' : String(item.players))
            return {
              ...item,
              _titleText: nonEmptyString(item.title) || '节点名称待确认',
              _imageUrl: nonEmptyString(item.imgUrl),
              _playersText: players ? (/人$/.test(players) ? players : `${players}人`) : '人数待确认',
              _durationText: duration === null ? '时长待确认' : `${duration} 分钟`,
            }
          })
          const info = {
            ...res.data,
            collaboratorsList: res.data.collaboratorsList || [],
            registrationList: res.data.registrationList || [],
            memberTemplateList: templates,
            commentList: res.data.commentList || [],
            sysCategoryList: res.data.sysCategoryList || [],
          }
          const stateVariant = STATE_VARIANT[info.state] || 'neutral'
          const tickets = info.omsTicketList ? info.omsTicketList.map(normalizeTicket) : []
          const host = info.collaboratorsList[0] || {}
          const action = actionFor(info)
          const latitude = coordinate(info.latitude, 90)
          const longitude = coordinate(info.longitude, 180)
          const averageRating = nonNegativeNumber(info.averageRating)
          this._loadedId = requestedId
          this.setData({
            state: 'ready',
            info,
            tickets,
            statusText: nonEmptyString(info.stateText) || '状态待确认',
            statusVariant: stateVariant,
            // CU-C-48:顶部这行是**活动时间**(cms_activity.start_date/end_date),票种行的是
            // **场次时间**(oms_ticket.start_time/end_time) —— 两组字段不是一回事。不标名称的
            // 话,后台把票种窗口填到活动日期之外就会看到「顶部 9.24、票种 10.1」这种
            // 互相打架的界面,而且两边都像是“这场活动的时间”。后端写口现已拦住越界,
            // 存量数据仍可能存在,所以标注必须留在展示层。
            dateText: info.startDate
              ? `活动时间 · ${dateText(info.startDate)}${info.endDate ? ` - ${dateText(info.endDate)}` : ''}`
              : '时间待定',
            hostName: nonEmptyString(host.memberRealName),
            hostAvatar: nonEmptyString(host.memberAvatar),
            titleText: nonEmptyString(info.name) || '活动标题待确认',
            categoryText: info.sysCategoryList.map((item) => nonEmptyString(item.categoryName)).filter(Boolean).join(' · '),
            registrationCountText: countText(info.registrationCount),
            averageRatingText: averageRating !== null && averageRating <= 5 ? String(averageRating) : '—',
            commentCountText: countText(info.commentCount),
            hasLocation: latitude !== null && longitude !== null,
            actionState: action.state,
            actionText: action.text,
            isOwner: info.memberId != null && info.memberId == app.getUserID(),
          })
          this.triggerEvent('loaded', { id: requestedId, name: info.name || '', imgUrl: info.imgUrl || '' })
        },
        successStatusAbnormal: () => this.failLoad(token, '服务暂时不可用，请稍后重试。'),
        fail: () => this.failLoad(token, '网络异常，请检查网络后重试。'),
      })
    },

    failLoad(token, errorMsg) {
      if (token !== this._loadToken) return
      this._loadingId = ''
      this.setData({ state: 'error', errorMsg })
    },

    retry() {
      this._loadingId = ''
      this._loadedId = ''
      this.load(this.data.activityId)
    },

    reload() {
      this._loadedId = ''
      this.load(this.data.activityId)
    },

    toggleTicket(event) {
      const id = String(event.currentTarget.dataset.id || '')
      this.setData({ expandedTicketId: this.data.expandedTicketId === id ? '' : id })
    },

    selectTicket(event) {
      const id = String(event.currentTarget.dataset.id || '')
      const ticket = this.data.tickets.find((item) => item._id === id)
      if (!ticket) return
      // CU-C-32:场次已过/已开始的票先拦,而且理由必须说准 —— 拿「已售罄」去解释一个
      // 过期场次是两套口径,用户会以为还有机会刷到票。
      if (ticket._windowPassed) {
        toast(ticket._windowText || '该场次已过')
        return
      }
      if (ticket._available === false) {
        toast('该票种已售罄')
        return
      }
      this.setData({ selectedTicketId: id, expandedTicketId: id, canConfirmSignup: true })
    },

    openSignup() {
      if (!this.data.canConfirmSignup) return
      if (app.getUserType() == 2) {
        toast('商家用户不可报名活动')
        return
      }
      const info = this.data.info || {}
      if (info.memberId == app.getUserID()) {
        toast('不可报名您发布的活动')
        return
      }
      if (info.isSignUp === 1) {
        toast('您已报名该活动')
        return
      }
      const ticket = this.data.tickets.find((item) => item._id === this.data.selectedTicketId)
      if (!ticket) {
        toast('请先选择票种')
        return
      }
      // CU-C-32:与 selectTicket 同一把尺子。原来只比 endTime(报名截止),startTime
      // 已过而 endTime 缺失/仍在未来的票会从这里直接走到结算页。
      if (ticket._windowPassed) {
        toast(ticket._windowText || '该场次已过')
        return
      }
      if (ticket._available === false) {
        toast('该票种已售罄')
        return
      }
      const end = ticket.endTime ? toTimestamp(String(ticket.endTime)) : NaN
      if (!Number.isNaN(end) && Date.now() > end) {
        toast('该票种已截止报名')
        return
      }
      wx.navigateTo({ url: `/pages/activity/baoming/baoming?activityId=${this.data.activityId}&ticketId=${ticket.id}` })
    },

    goPlay() {
      wx.navigateTo({ url: '/subpackageMember/signup/index' })
    },

    goUserInfo(event) {
      const id = event.currentTarget.dataset.id
      if (id) wx.navigateTo({ url: `/pages/userinfo/userinfo?userId=${id}` })
    },

    goTemplateDetail(event) {
      const id = event.currentTarget.dataset.id
      if (id) wx.navigateTo({ url: `/pages/templatedetail/templatedetail?id=${id}&scope=my` })
    },

    openLocation() {
      const info = this.data.info || {}
      const latitude = coordinate(info.latitude, 90)
      const longitude = coordinate(info.longitude, 180)
      if (latitude === null || longitude === null) return
      wx.openLocation({ latitude, longitude, name: info.addressName || info.name || '集合点', address: info.address || '', scale: 18 })
    },

    // [C8-05] 确认框要写明「将给 N 位已付款玩家全额退款」:打开取消面板时就问后端人数,
    // 拿不到 submitCancel 不弹确认、不发取消。(不放进 submitCancel 里异步取:台账按它体内的
    // modal.show 判「有没有确认框」,挪进回调会被记成没有确认框。)
    openCancel() {
      const activityId = this.data.activityId
      this._cancelPaidPlayers = null
      this.setData({ cancelShow: true, cancelReason: '', canCancel: false, cancelError: '', cancelBlocked: false })
      // 「重新检查」会连发预检:只认最后一次,迟到的旧「拒绝」不得把刚通过的面板再打回被拦
      const seq = (this._cancelPreviewSeq || 0) + 1
      this._cancelPreviewSeq = seq
      app.sendRequest({
        url: '/api/activity/cancel_preview', method: 'POST', data: { id: activityId }, hideLoading: true, silentError: true,
        success: (res) => {
          if (activityId !== this.data.activityId || seq !== this._cancelPreviewSeq) return
          // CU-C-23:预检被服务端拒(没有取消权限等)= 这次根本取消不了,原来仍让人填原因、按确认,
          // 白填一遍才撞同一个拒绝。拒绝就收起表单,只留原因与「关闭」。
          if (!ok(res)) {
            this.setData({ cancelBlocked: true, cancelError: (res && res.msg) || '当前不能取消这场活动' })
            return
          }
          const n = res.data ? Number(res.data.paidPlayers) : NaN
          if (Number.isInteger(n) && n >= 0) this._cancelPaidPlayers = n
          else this.setData({ cancelError: '暂时算不出退款人数，请关闭后重试。' })
        },
        fail: () => { if (activityId === this.data.activityId && seq === this._cancelPreviewSeq) this.setData({ cancelError: '网络异常，算不出退款人数，请关闭后重试。' }) },
      })
    },

    closeCancel() {
      if (this.data.cancelling) return
      this.setData({ cancelShow: false, cancelReason: '', canCancel: false, cancelError: '' })
    },

    onCancelReasonInput(event) {
      const cancelReason = event.detail.value || ''
      this.setData({ cancelReason, canCancel: !!cancelReason.trim(), cancelError: '' })
    },

    submitCancel() {
      if (!this.data.canCancel || this.data.cancelling || this.data.cancelBlocked) return
      const reason = (this.data.cancelReason || '').trim()
      if (!reason) return
      const paidPlayers = this._cancelPaidPlayers
      if (!Number.isInteger(paidPlayers)) {
        this.setData({ cancelError: '还没算出将退款的人数，请稍候或关闭后重试。' })
        return
      }
      modal.show({
        dangerKey: 'activity.cancel-refund',   // 三段式文案在 utils/danger-actions.js
        dangerParams: { count: paidPlayers },
        success: (result) => {
          if (!result.confirm) return
          const activityId = this.data.activityId
          const token = (this._cancelToken || 0) + 1
          this._cancelToken = token
          this.setData({ cancelling: true, cancelError: '' })
          app.sendRequest({
            url: '/api/activity/cancel', method: 'POST', data: { id: activityId, reason }, hideLoading: true, silentError: true,
            success: (res) => {
              if (token !== this._cancelToken || activityId !== this.data.activityId) return
              this.setData({ cancelling: false })
              if (ok(res)) {
                this.closeCancel()
                this.noticeCancelled(res.msg)
                return
              }
              this.setData({ cancelError: res.msg || '活动取消失败，请重试。' })
            },
            fail: () => {
              if (token === this._cancelToken && activityId === this.data.activityId) this.setData({ cancelling: false, cancelError: '网络异常，取消原因已保留，请重试。' })
            },
            successStatusAbnormal: () => {
              if (token === this._cancelToken && activityId === this.data.activityId) this.setData({ cancelling: false, cancelError: '服务暂时不可用，取消原因已保留，请重试。' })
            },
          })
        },
      })
    },

    /* 取消成功之后的单钮告知(审查C B1)。
     *
     * ⚠️ 这一处不能改 toast:后端 ApiActivityController#cancel 的成功文案是拼出来的,
     * 订单里有已核销票时会追加「另有 N 笔订单含已核销的票…平台将人工跟进处理」,整句 66 字,
     * 超过 utils/toast.js → safeUserMessage 的 60 字闸,会被兜底成「操作失败」——
     * 取消明明成功了却显示成失败,而且越是要紧的那句越会把文案顶过闸、越读不到。
     * 告知弹窗的正文不过长度兜底,标题固定,退款去向由后端原文讲。
     *
     * ⚠️ 也不能把它内联回 submitCancel 的 success 回调里:台账
     * (scripts/uiaudit/build-action-ledger.js · synchronousModalContract)判「这颗钮有没有
     * 确认框」时,是对**外层 modal.show 的整段实参源码**做 /showCancel:\s*false/ 扫描的。
     * 内联会把这里的 showCancel:false 落进那段源码,外层确认框被当成告知框跳过,
     * submitCancel 于是被记成 confirmationMode=None、丢掉 modal-cancelled 分支 ——
     * 一条「全额退款动作没有确认框」的假事实。拆成独立方法就不在那段实参里了。 */
    noticeCancelled(message) {
      modal.show({
        title: '活动已取消', content: message || '已全额退款给所有已报名用户', showCancel: false,
        success: () => this.reload(),
      })
    },

    openComment() {
      this.setData({ voteShow: true, commentError: '' })
    },

    closeComment() {
      if (this.data.commentSubmitting) return
      // CU-C-105:关闭只收起表单,保留草稿——失败提示已承诺「评分和文案已保留」,不能一关就清空
      this.setData({ voteShow: false, commentError: '' })
    },

    // CU-C-105:只有提交成功才清空草稿
    resetCommentDraft() {
      this.setData({ answer: -1, plnr: '', uploadImages: [], canSubmitComment: false, commentError: '' })
    },

    chooseCommentImages() {
      app.chooseImage((images) => {
        const uploadImages = this.data.uploadImages.slice()
        images.forEach((image) => uploadImages.push(image))
        this.setData({ uploadImages: uploadImages.slice(0, 9), commentError: '' })
      }, 6)
    },

    deleteCommentImage(event) {
      const uploadImages = this.data.uploadImages.slice()
      uploadImages.splice(Number(event.currentTarget.dataset.index), 1)
      this.setData({ uploadImages, commentError: '' })
    },

    previewCommentImage(event) {
      const current = event.currentTarget.dataset.src
      if (current) wx.previewImage({ current, urls: this.data.uploadImages })
    },

    changeRating(event) {
      this.setData({ answer: Number(event.currentTarget.dataset.index), commentError: '' }, () => this.refreshCommentState())
    },

    onCommentInput(event) {
      this.setData({ plnr: event.detail.value || '', commentError: '' }, () => this.refreshCommentState())
    },

    refreshCommentState() {
      const canSubmitComment = this.data.answer !== -1 && !!(this.data.plnr || '').trim()
      if (canSubmitComment !== this.data.canSubmitComment) this.setData({ canSubmitComment })
    },

    submitComment() {
      if (!this.data.canSubmitComment || this.data.commentSubmitting) return
      const activityId = this.data.activityId
      const token = (this._commentToken || 0) + 1
      this._commentToken = token
      this.setData({ commentSubmitting: true, commentError: '' })
      app.sendRequest({
        url: '/api/comment/add', method: 'POST', hideLoading: true, silentError: true,
        data: {
          owner_type: 2,
          owner_id: activityId,
          rating: this.data.answer + 1,
          contents: (this.data.plnr || '').trim(),
          reply_id: 0,
          img_arr: this.data.uploadImages.join(';'),
        },
        success: (res) => {
          if (token !== this._commentToken || activityId !== this.data.activityId) return
          if (ok(res)) {
            this.setData({ commentSubmitting: false, commentError: '' })
            toast.success('评价成功')
            this.resetCommentDraft()
            this.closeComment()
            this.reload()
            return
          }
          this.setData({ commentSubmitting: false, commentError: (res && res.msg) || '评价暂时无法发布，请重试。' })
        },
        fail: () => {
          if (token === this._commentToken && activityId === this.data.activityId) this.setData({ commentSubmitting: false, commentError: '网络异常，评分和文案已保留，请重试。' })
        },
        successStatusAbnormal: () => {
          if (token === this._commentToken && activityId === this.data.activityId) this.setData({ commentSubmitting: false, commentError: '服务暂时不可用，评分和文案已保留，请重试。' })
        },
      })
    },

    trackShare() {
      analytics.track('content_share', { bizType: 'activity', bizId: this.data.activityId })
    },

    // 门卡出口:有 clubId 就去俱乐部页;拿不到就只是关掉(不给无目的按钮)。
    goGateClub() {
      const clubId = Number(this.data.gateClubId) || 0
      if (clubId > 0) {
        wx.navigateTo({ url: '/pages/club/detail/index?id=' + clubId })
        return
      }
      this.close()
    },

    close() {
      this.triggerEvent('close')
    },
  },
})
