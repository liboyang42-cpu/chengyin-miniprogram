'use strict'

const app = getApp()
const credential = require('../../../utils/coupon-credential.js')
const datetime = require('../../../utils/datetime.js')

function ok(res) { return res && (res.code === 200 || res.code === '200') }

const couponStatus = credential.couponStatus

// 券有效期全站只显示到日(2026-09-17 用户拍板,共享 utils/datetime.formatDayDots);
// 可用/过期判定仍用完整时间(notStartedAt 走 datetime.toTimestamp)。
function dateText(value) {
  return datetime.formatDayDots(value)
}

// 使用期承诺:start 前不出码、不误报已过期。无法解析时按已开始处理,
// 服务端 redeemCoupon/claimUnusedCoupon 才是权威闸门。比较瞬时用 datetime.toTimestamp,
// 不依赖设备时区(后端下发的是中国时间语义)。
function notStartedAt(value) {
  if (!value) return false
  const parsed = datetime.toTimestamp(value)
  return !isNaN(parsed) && parsed > Date.now()
}

// 换码失败后的受控自动重试间隔:到点失败不再永久冻结,下一个节拍重新取真实 token。
const RETRY_DELAY_MS = 5000
// 后端二维码 TTL 保守下界(expiresIn 60s + 30s 余量);跨宿主 hide/show 只有窗口内才保留码。
const CREDENTIAL_TTL_MS = 90000

// 凭证归属主键:当前登录会员 id。取不到时返回 '',按「无法证明同一所有者」处理。
function currentOwnerId() { return credential.currentOwnerId(app) }

Component({
  properties: { couponHistoryId: { type: String, value: '' }, name: { type: String, value: '' } },
  data: { state: 'loading', qrState: 'loading', qr: '', couponName: '', description: '', startText: '', notStarted: false, endTime: '', countdown: 0, useStatus: 0, useTime: '', resultText: '', errorText: '', pollError: '' },
  observers: { couponHistoryId(value) { if (value) this.start(value) } },
  lifetimes: { attached() { if (this.data.couponHistoryId) this.start(this.data.couponHistoryId) }, detached() { this._sessionToken = (this._sessionToken || 0) + 1; this._activeCouponId = ''; this._refreshingId = ''; this._retryAt = 0; this._qrOwner = undefined; this._qrCouponId = null; if (this._tokenTask && typeof this._tokenTask.abort === 'function') this._tokenTask.abort(); this._tokenTask = null; this.clearTimers() } },
  pageLifetimes: {
    show() {
      // 首次可见由 attached 负责;只有从隐藏恢复才重启,避免重复请求。
      if (!this._hostHidden) return
      this._hostHidden = false
      const id = this._activeCouponId || String(this.data.couponHistoryId || '')
      if (!id) return
      // 同 owner+同券+仍在后端 TTL 内:保留码(后台换码续期,不清不闪);
      // 换 owner / 无法证明归属 / 超 TTL:start 会把旧凭证下屏重取。
      if (this._keepQrValid()) this._resume(id)
      else this.start(id)
    },
    hide() {
      // 宿主页不可见即换代:在途回包作废、清在途锁与节拍;凭证保留与否由 show 按 owner+TTL 决定。
      this._hostHidden = true
      this._sessionToken = (this._sessionToken || 0) + 1
      if (this._tokenTask && typeof this._tokenTask.abort === 'function') this._tokenTask.abort()
      this._tokenTask = null
      this._refreshingId = ''
      this.clearTimers()
    },
  },
  methods: {
    start(id) {
      this.clearTimers()
      const sessionToken = (this._sessionToken || 0) + 1
      this._sessionToken = sessionToken
      this._activeCouponId = id ? String(id) : ''
      this._refreshingId = ''
      this._retryAt = 0
      this._terminalStatus = null
      this._qrOwner = undefined
      this._qrCouponId = null
      this._qrIssuedAt = 0
      this._qrTtlMs = 0
      if (!id) { this.setData({ state: 'missing', useStatus: 0 }); return }
      if (!this.requireOwner()) return
      this.setData({ state: 'ready', qrState: 'loading', qr: '', useStatus: 0, couponName: this.data.name || '优惠券', startText: '', notStarted: false, countdown: 0, resultText: '', errorText: '', pollError: '' })
      this.refresh(this._activeCouponId, sessionToken)
      this.startPolling(sessionToken)
      // 即使首轮换码就失败,也要有节拍承载受控重试(失败分支只负责写退避,不另起一套定时器)。
      this.startCountdown()
    },
    // 同 owner+同券+未使用+仍在外层 TTL 内,才允许跨 hide/show 保留屏上的码。
    _qrWithinTtl() {
      const issuedAt = this._qrIssuedAt || 0
      const ttl = this._qrTtlMs || 0
      return !!issuedAt && !!ttl && (issuedAt + ttl) - Date.now() > 1000
    },
    _keepQrValid() {
      if (!this._qrBelongsToCurrentOwner()) return false
      if (this.data.useStatus !== 0 || !this.data.qr) return false
      return this._qrWithinTtl()
    },
    // 从隐藏恢复:保留屏上凭证,只换代重启节拍并后台换码(成功换新,失败走同 owner 保留分支)。
    _resume(id) {
      this.clearTimers()
      const sessionToken = (this._sessionToken || 0) + 1
      this._sessionToken = sessionToken
      this._activeCouponId = String(id)
      this._refreshingId = ''
      this._retryAt = 0
      this.refresh(this._activeCouponId, sessionToken)
      this.startPolling(sessionToken)
      this.startCountdown()
    },
    friendly(message, fallback) {
      const text = String(message || '')
      if (/登录|认证|401|token/i.test(text)) return '登录已过期，请重新进入'
      if (/网络|timeout|fail|502|503/i.test(text)) return '网络异常，请稍后重试'
      return fallback
    },
    // 已渲染码是否属于「当前 owner + 当前券」。未打标(undefined)按同 owner 兼容;
    // 当前 owner 不可得 = 无法证明同一归属,一律不保留。
    _qrBelongsToCurrentOwner() {
      const owner = currentOwnerId()
      if (!owner) return false
      if (this._qrOwner === undefined) return true
      const id = this._activeCouponId || String(this.data.couponHistoryId || '')
      return this._qrOwner === owner && String(this._qrCouponId || '') === String(id || '')
    },
    refresh(requestedId, sessionToken) {
      if (!this.requireOwner()) return
      const couponHistoryId = String(requestedId || this.data.couponHistoryId || '')
      const activeToken = sessionToken || this._sessionToken
      if (!couponHistoryId || activeToken !== this._sessionToken || this._refreshingId === couponHistoryId) return
      this._refreshingId = couponHistoryId
      // 每次 refresh 独立 seq(在途身份):回调必须同时满足 本 seq + 本会话 + 本券 + 本 owner,
      // abort 只尽力而为,不能作为「旧回调不会到达」的证明。
      const seq = (this._refreshSeq = (this._refreshSeq || 0) + 1)
      const owner = currentOwnerId()
      if (this._qrOwner !== undefined && !this._qrBelongsToCurrentOwner()) {
        this._qrOwner = undefined
        this._qrCouponId = null
        this.setData({ qr: '', qrState: 'loading', couponName: '', description: '', startText: '', endTime: '', useTime: '', useStatus: 0, notStarted: false, errorText: '', pollError: '' })
      }
      const currentRequest = () => this.requireOwner() && seq === this._refreshSeq
        && activeToken === this._sessionToken
        && couponHistoryId === this._activeCouponId
        && owner === currentOwnerId()
      this.setData({ qrState: this.data.qr ? 'ready' : 'loading', errorText: '' })
      // 后端先签发再生成图片，响应耗时不能额外延长凭证TTL。
      const requestedAt = Date.now()
      const control = app.sendRequest({
        url: '/api/coupon/qr-token', method: 'POST', data: { couponHistoryId }, hideLoading: true, silentError: true,
        success: (res) => {
          if (!currentRequest()) return
          if (res && res.code == 410) { this.unavailable(res.msg); return }
          if (this._terminalStatus === 1 || this._terminalStatus === 2 || this._terminalStatus === 3) return
          const d = res && res.data
          if (!ok(res) || !d) { this.fail(res && res.msg); return }
          const parsed = credential.parseQrReply(d)
          if (!parsed) {
            // 未知 useStatus 不得沿用初值 0 伪装「未使用」(否则继续倒计时/轮询);倒计时一并归零
            if (couponStatus(d.useStatus) === null) this.setData({ useStatus: null, countdown: 0 })
            else this.setData({ countdown: 0 })
            this.fail('券码状态暂时无法确认，请稍后重试'); return
          }
          const { status, qr, countdown } = parsed
          if (status === 0 && Date.now() - requestedAt >= CREDENTIAL_TTL_MS - 1000) {
            this.fail('二维码生成超时，请重新获取')
            return
          }
          if (status === 1 || status === 2 || status === 3) this._terminalStatus = status
          this._retryAt = 0
          this._qrOwner = owner
          this._qrCouponId = couponHistoryId
          this._qrIssuedAt = qr ? requestedAt : 0
          this._qrTtlMs = qr ? CREDENTIAL_TTL_MS : 0
          this.setData({ qr, qrState: status === 0 ? 'ready' : 'loading', couponName: d.couponName || this.data.name || '优惠券', description: d.description || '', startText: dateText(d.startTime), notStarted: notStartedAt(d.startTime), endTime: dateText(d.endTime), countdown, useStatus: status, useTime: d.useTime || '', resultText: status === 1 ? '已核销' : (status === 2 ? '该券已过期' : (status === 3 ? '该券已失效' : '')), errorText: '', pollError: '' })
          if (status === 0) { this.startCountdown(); this.startPolling(activeToken) }
          else this.clearTimers()
        },
        successStatusAbnormal: (res) => {
          if (currentRequest()) {
            if (res && res.code == 410) this.unavailable(res.msg)
            else this.fail(res && res.msg)
          }
        },
        fail: (err) => {
          if (currentRequest()) this.fail(err && err.msg)
        },
        complete: () => {
          // 在途锁只允许「最新一发」释放;旧 complete 不得清掉新请求的锁。
          if (seq !== this._refreshSeq) return
          this._refreshingId = ''
          this._tokenTask = null
        },
      })
      if (control && typeof control.abort === 'function') this._tokenTask = control
    },
    requireOwner() {
      if (currentOwnerId()) return true
      this.unavailable('登录状态待确认，请登录后重试')
      this.setData({ couponName: '', description: '', startText: '', endTime: '', useTime: '', resultText: '', countdown: 0 })
      return false
    },
    unavailable(message) {
      this._sessionToken = (this._sessionToken || 0) + 1
      this._refreshSeq = (this._refreshSeq || 0) + 1
      this._refreshingId = ''
      this._terminalStatus = null
      this._qrOwner = undefined
      this._qrCouponId = null
      this._qrIssuedAt = 0
      this._qrTtlMs = 0
      if (this._tokenTask && typeof this._tokenTask.abort === 'function') this._tokenTask.abort()
      this._tokenTask = null
      this.clearTimers()
      this.setData({ qr: '', qrState: 'error', useStatus: null, notStarted: false, pollError: '', errorText: message || '优惠券已撤销或不存在' })
    },
    fail(message) {
      const text = this.friendly(message, '二维码暂时没能生成，请稍后重试')
      // P3-3:同 owner 且码仍在精确 TTL 内就保留能力,只提示不遮码 ——
      // 倒计时 0/1 不等于 token 失效(后端 TTL 90s、展示 60s)。
      if (this._qrBelongsToCurrentOwner() && !this.data.notStarted
          && this.data.qrState === 'ready' && this.data.qr && this._qrWithinTtl()) {
        this.setData({ pollError: text })
        return
      }
      // 归属可疑(旧 owner / 无归属证明)或已超 TTL 时不保留码:先下屏再落错误态。
      if (!this._qrBelongsToCurrentOwner() || !this._qrWithinTtl()) {
        this._qrOwner = undefined
        this._qrCouponId = null
        this._qrIssuedAt = 0
        this._qrTtlMs = 0
        this.setData({ qr: '' })
      }
      this._retryAt = Date.now() + RETRY_DELAY_MS
      this.setData({ qrState: 'error', errorText: text })
    },
    failPoll(message) {
      const text = this.friendly(message, '核销状态暂不可用，请稍后重试')
      if (this._qrBelongsToCurrentOwner() && this.data.qrState === 'ready' && this.data.qr) this.setData({ pollError: text })
      else this.fail(text)
    },
    startCountdown() {
      if (!this.requireOwner()) return
      if (this._countTimer) clearInterval(this._countTimer)
      this._countTimer = setInterval(() => {
        if (!this.requireOwner()) return
        if (!this._qrBelongsToCurrentOwner()) { this.refresh(); return }
        if (this.data.useStatus !== 0) return
        if (this._qrIssuedAt && this.data.qr && !this._qrWithinTtl()) {
          this.setData({ qr: '', qrState: 'loading' })
        }
        if (this.data.qrState === 'error') {
          // 失败恢复:写入退避后到点(或越过 start)自动重取真实 token,不再永久冻结。
          if (!this._retryAt || Date.now() >= this._retryAt) {
            this._retryAt = Date.now() + RETRY_DELAY_MS
            this.refresh()
          }
          return
        }
        const next = this.data.countdown - 1
        if (next <= 0) this.refresh(); else this.setData({ countdown: next })
      }, 1000)
    },
    startPolling(sessionToken) {
      if (!this.requireOwner()) return
      if (this._pollTimer) clearInterval(this._pollTimer)
      const activeToken = sessionToken === undefined ? this._sessionToken : sessionToken
      const owner = currentOwnerId()
      // 轮询回包同样核 会话代际 + 当前 owner(静默换账号时不得把上一账号的核销态写上来)。
      const stillCurrent = () => this.requireOwner() && activeToken === this._sessionToken && owner === currentOwnerId()
      this._pollTimer = setInterval(() => {
        if (!stillCurrent() || this.data.useStatus !== 0) return
        const couponHistoryId = this._activeCouponId || String(this.data.couponHistoryId || '')
        if (!couponHistoryId) return
        app.sendRequest({
          url: '/api/coupon/status', method: 'POST', data: { couponHistoryId }, hideLoading: true, silentError: true,
          success: (res) => {
            if (!stillCurrent() || (this._activeCouponId && couponHistoryId !== this._activeCouponId)) return
            if (res && res.code == 410) { this.unavailable(res.msg); return }
            if (!ok(res) || !res.data || res.data.useStatus == null) return
            const status = couponStatus(res.data.useStatus)
            if (status === null) { this.failPoll('核销状态暂不可用，请稍后重试'); return }
            if ((this._terminalStatus === 1 || this._terminalStatus === 2 || this._terminalStatus === 3) && status === 0) return
            if (status === 1 || status === 2 || status === 3) this._terminalStatus = status
            this.setData({ useStatus: status, useTime: res.data.useTime || '', resultText: status === 1 ? '已核销' : (status === 2 ? '该券已过期' : (status === 3 ? '该券已失效' : '')), pollError: '' })
            if (status === 1 && wx.vibrateShort) wx.vibrateShort({ type: 'medium' })
            if (status !== 0) this.clearTimers()
          },
          successStatusAbnormal: (res) => { if (stillCurrent() && (!this._activeCouponId || couponHistoryId === this._activeCouponId)) { if (res && res.code == 410) this.unavailable(res.msg); else if (this.data.qrState !== 'error') this.failPoll(res && res.msg || '核销状态暂不可用，请稍后重试') } },
          fail: (err) => { if (stillCurrent() && (!this._activeCouponId || couponHistoryId === this._activeCouponId) && this.data.qrState !== 'error') this.failPoll(err && err.msg || '核销状态暂不可用，请稍后重试') },
        })
      }, 5000)
    },
    clearTimers() { if (this._countTimer) clearInterval(this._countTimer); if (this._pollTimer) clearInterval(this._pollTimer); this._countTimer = null; this._pollTimer = null },
    retry() { this.setData({ qrState: this.data.qr ? 'ready' : 'loading' }); this.refresh(this._activeCouponId, this._sessionToken) },
    retryNow() {
      // 与独立页同形:清退避 + 作废在途,确保重试一定发出当前请求(成功且是当前 token 才亮码)。
      this._retryAt = 0
      if (this._tokenTask && typeof this._tokenTask.abort === 'function') this._tokenTask.abort()
      this._tokenTask = null
      this._refreshingId = ''
      this.retry()
    },
    close() { this.clearTimers(); this.triggerEvent('close') },
  },
})
