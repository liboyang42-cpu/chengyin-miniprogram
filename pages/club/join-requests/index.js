const modal = require('../../../utils/modal.js');
const toast = require('../../../utils/toast.js');
const app = getApp()
const { isRecordList } = require('../../../utils/response-shape.js')

function jsonBody(data) { return JSON.stringify(data || {}) }
function jsonHeader() { return { 'Content-Type': 'application/json' } }

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    clubId: null,
    requests: [],
    // 副标题带待审条数(Figma 30:11)。
    // ⚠️ 2026-09-11 复核:上一版注释写「后端 owner-only」是错的 ——
    //    ClubMemberServiceImpl.canApproveMembers 放行三种人:主理人、role=1 管理员、
    //    以及被委派 club:member:approve 的角色。这行文案跟的是后端真实口径,不是稿。
    //    编辑资料页那句「只有主理人可通过或拒绝申请」同日一并改掉,三处口径现在一致。
    // CU-C-133:数「谁能处理」的名单本身就漏掉被委派的成员。本页有 access-gate 拦在
    //    club:member:approve 上,能打开的人一定按得动,所以只报动作、不报名单。
    introText: '待审核的入会申请 · 可直接通过或拒绝',
    state: 'loading', // loading | ready | business-error | network-error | missing-param
    errorText: '',
    refreshing: false,
    // 2026-09-17 用户拍板:刷新失败不再完全静默 —— 有旧快照时保留列表并给内联错误 + 重试。
    // 这是 2026-08-26「有旧内容时刷新失败一律静默降级」的唯一例外(本页待审名单会直接影响审批动作)。
    staleError: '',
    staleErrorKind: 'data',
    actingMemberId: null,
    actingAction: '',
    actionErrorMemberId: null,
    actionErrorAction: '',
    actionErrorText: '',
    actionErrorKind: 'data',
  },

  // 顶部条只报「有多少条 + 能做什么」,不报「谁能处理」:后端 canApproveMembers 放行
  // 主理人、role=1 管理员与被委派 club:member:approve 的成员(CU-C-133 实证第三种人
  // 确实按得动,却被旧文案排除在外),名单怎么数都会漏一档。改文案,不动权限。
  buildIntro(count) {
    // CU-C-96:待审为 0 时顶部条不再重复「暂无待审申请」—— 中央空态已经写着同一句,
    // 同屏两句一字不差的话既占位又让人以为漏看了一处。
    return (count > 0 ? count + ' 条待审 · ' : '') + '可直接通过或拒绝'
  },

  onLoad(options) {
    const clubId = options && options.clubId ? Number(options.clubId) : null
    this.setData({ clubId: clubId })
    if (clubId) this.loadRequests()
    else this.setData({ state: 'missing-param', errorText: '缺少俱乐部信息，请返回俱乐部列表后重新进入' })
  },

  onUnload() { this._requestEpoch = (this._requestEpoch || 0) + 1 },

  goBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    if (this.data.clubId) {
      wx.redirectTo({ url: '/pages/club/detail/index?id=' + this.data.clubId })
      return
    }
    wx.switchTab({ url: '/pages/talent/list/index' })
  },

  onPullDownRefresh() {
    if (this.data.clubId) this.loadRequests()
    else wx.stopPullDownRefresh()
  },

  loadRequests() {
    if (!this.data.clubId) {
      wx.stopPullDownRefresh()
      this.setData({ state: 'missing-param', errorText: '缺少俱乐部信息，请返回俱乐部列表后重新进入' })
      return
    }
    const epoch = (this._requestEpoch || 0) + 1
    this._requestEpoch = epoch
    const that = this
    const hadSnapshot = this.data.state === 'ready'
    this.setData({
      state: hadSnapshot ? 'ready' : 'loading',
      errorText: '',
      refreshing: hadSnapshot,
      staleError: '',
    })
    app.sendRequest({
      // 下拉刷新的收圈绑在真实完成上;非下拉场景下 stopPullDownRefresh 是 no-op
      complete() { wx.stopPullDownRefresh(); },
      hideLoading: true,
      url: '/api/club/join-requests', method: 'POST',
      data: jsonBody({ clubId: this.data.clubId }), header: jsonHeader(),
      success(res) {
        if (epoch !== that._requestEpoch) return
        if (res.code != '200' || !isRecordList(res.data)) {
          // 200 但数据校验不过时 res.msg 是「操作成功」,不能当失败原因(2026-09-17 拍板)。
          const message = res.code == '200' ? '入会申请暂时不可用' : ((res && res.msg) || '入会申请暂时不可用')
          if (hadSnapshot) {
            that.setData({ state: 'ready', refreshing: false, staleErrorKind: 'data', staleError: message })
          } else {
            that.setData({ state: 'business-error', refreshing: false, errorText: message })
          }
          return
        }
        const requests = res.data.map(function (item) {
          return Object.assign({}, item, {
            requestTimeText: item.joinTime ? String(item.joinTime).replace('T', ' ').slice(0, 16) : '时间未知',
            // 稿 P3 30:2:申请人写的那句话,用引号裹起来显示。没写就整行不出 ——
            // 空引号会被读成「他写了但没说什么」。
            joinMessageText: item.joinMessage ? '“' + String(item.joinMessage) + '”' : ''
          })
        })
        that.setData({ state: 'ready', requests: requests, refreshing: false, staleError: '', introText: that.buildIntro(requests.length) })
      },
      fail() {
        if (epoch !== that._requestEpoch) return
        if (hadSnapshot) {
          that.setData({ state: 'ready', refreshing: false, staleErrorKind: 'network', staleError: '入会申请更新失败，请检查网络后重试' })
        } else {
          that.setData({ state: 'network-error', refreshing: false, errorText: '网络没有连上' })
        }
      },
    })
  },

  approve(e) { this.confirmReview(e.currentTarget.dataset.memberId, true) },
  reject(e) { this.confirmReview(e.currentTarget.dataset.memberId, false) },

  confirmReview(memberId, approve) {
    if (!memberId || this.data.actingMemberId) return
    const that = this
    // CU-C-95:相邻申请连着点时,确认层必须指名道姓。以前 approve 标题写死「通过入会申请」,
    // reject 的 dangerKey 不传 name —— 标题兑底成「拒绝「这一项」的入会申请?」,最后一步无从核对。
    const row = this.data.requests.find(function (item) {
      return String(item.memberId) === String(memberId)
    })
    const name = (row && row.nickname) || '城瘾玩家'
    modal.show(approve ? {
      title: '通过「' + name + '」的入会申请',
      content: '通过后，对方将成为正式成员并可进入群聊。',
      confirmText: '通过',
      cancelText: '取消',
      success(result) { if (result.confirm) that.review(memberId, approve) },
    } : {
      dangerKey: 'club.joinRequest.reject',   // 登记表 scripts/danger-action-registry.json 指向的确认层
      dangerParams: { name },
      success(result) { if (result.confirm) that.review(memberId, approve) },
    })
  },

  retryReview(e) {
    const dataset = e.currentTarget.dataset || {}
    this.confirmReview(dataset.memberId, (this.data.actionErrorAction || dataset.action) === 'approve')
  },

  review(memberId, approve) {
    if (!memberId || this.data.actingMemberId) return
    const that = this
    const action = approve ? 'approve' : 'reject'
    this.data.actionErrorAction = ''
    this.setData({
      actingMemberId: memberId,
      actingAction: action,
      actionErrorMemberId: null,
      actionErrorText: '',
    })
    app.sendRequest({
      url: approve ? '/api/club/join-request/approve' : '/api/club/join-request/reject',
      method: 'POST',
      data: jsonBody({ clubId: this.data.clubId, memberId: memberId }),
      header: jsonHeader(),
      success(res) {
        if (res.code != '200') {
          that.data.actionErrorAction = action
          that.setData({
            actingMemberId: null,
            actingAction: '',
            actionErrorMemberId: memberId,
            actionErrorKind: 'data',
            actionErrorText: (res && res.msg) || '这次处理没有完成，请重试',
          })
          return
        }
        that.data.actionErrorAction = ''
        that.setData({
          actingMemberId: null,
          actingAction: '',
          actionErrorMemberId: null,
          actionErrorText: '',
          requests: that.data.requests.filter(function (item) { return item.memberId != memberId }),
          introText: that.buildIntro(that.data.requests.filter(function (item) { return item.memberId != memberId }).length),
        })
        toast.success(approve ? '已通过' : '已拒绝')
        const channel = that.getOpenerEventChannel && that.getOpenerEventChannel()
        if (channel && channel.emit) channel.emit('joinRequestsChanged')
      },
      fail() {
        that.data.actionErrorAction = action
        that.setData({
          actingMemberId: null,
          actingAction: '',
          actionErrorMemberId: memberId,
          actionErrorKind: 'network',
          actionErrorText: '网络异常，这次处理没有完成，请重试',
        })
      },
    })
  },
})
