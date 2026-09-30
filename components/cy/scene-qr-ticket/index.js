'use strict'

const app = getApp()

Component({
  properties: {
    registrationId: { type: String, value: '' },
  },
  data: {
    state: 'loading',
    qr: '',
    code: '',
    errorText: '',
    countdown: '',
    bigQr: false,
  },
  observers: {
    registrationId(value) {
      if (!this._attached) return
      if (!value) {
        this._loadedRegistrationId = ''
        this._loadToken = (this._loadToken || 0) + 1
        this.clearTimer()
        this.setData({ state: 'error', qr: '', code: '', countdown: '', errorText: '缺少报名记录，无法生成入场码' })
        return
      }
      if (value !== this._loadedRegistrationId) this.load()
    },
  },
  lifetimes: {
    attached() {
      this._attached = true
      if (this.data.registrationId) this.load()
      else this.setData({ state: 'error', errorText: '缺少报名记录，无法生成入场码' })
    },
    detached() {
      this._attached = false
      this._loadToken = (this._loadToken || 0) + 1
      this.clearTimer()
      // 顶亮的屏必须还回去,否则用户离开票券页后屏幕一直全亮在烧电
      this.restoreBrightness()
    },
  },
  methods: {
    clearTimer() {
      if (this._timer) { clearInterval(this._timer); this._timer = null }
    },
    load() {
      const registrationId = this.data.registrationId
      if (!registrationId) {
        this.setData({ state: 'error', errorText: '缺少报名记录，无法生成入场码' })
        return
      }
      this._loadedRegistrationId = registrationId
      const token = (this._loadToken || 0) + 1
      this._loadToken = token
      this.clearTimer()
      this.setData({ state: 'loading', qr: '', code: '', errorText: '', countdown: '', bigQr: false })
      app.sendRequest({
        url: '/api/verify/dyncode/issue',
        method: 'POST',
        data: { registrationId },
        hideLoading: true,
        silentError: true,
        success: (res) => {
          if (token !== this._loadToken) return
          if (!(res && (res.code === 200 || res.code === '200') && res.data)) {
            this.setData({ state: 'error', errorText: (res && res.msg) || '入场码生成失败' })
            return
          }
          const payload = res.data
          if (!payload.qrcodeUrl) {
            this.setData({ state: 'error', errorText: '入场码生成失败' })
            return
          }
          const rawExpiresAt = payload.expiresAt
          const expiresAt = typeof rawExpiresAt === 'number' && Number.isFinite(rawExpiresAt)
            ? (rawExpiresAt < 100000000000 ? rawExpiresAt * 1000 : rawExpiresAt)
            : 0
          if (!(expiresAt > Date.now())) {
            this.setData({ state: 'error', qr: '', code: '', errorText: '入场码有效期暂时无法确认，请重新获取' })
            return
          }
          this._expiresAt = expiresAt
          this.setData({ state: 'ready', qr: payload.qrcodeUrl, code: payload.code || '' })
          this.tick()
          this._timer = setInterval(() => this.tick(), 1000)
        },
        fail: () => {
          if (token === this._loadToken) this.setData({ state: 'error', errorText: '网络没连上，请重试' })
        },
        successStatusAbnormal: () => {
          if (token === this._loadToken) this.setData({ state: 'error', errorText: '入场码服务暂时不可用，请重试' })
        },
      })
    },
    tick() {
      const left = Math.max(0, (this._expiresAt || 0) - Date.now())
      if (!left) {
        this.clearTimer()
        this.setData({ state: 'error', qr: '', code: '', countdown: '', errorText: '入场码已过期，请重新获取' })
        return
      }
      const seconds = Math.ceil(left / 1000)
      this.setData({ countdown: `有效期剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` })
    },
    retry() { this.load() },
    openBigQr() {
      if (this.data.state !== 'ready' || !this.data.qr) return
      this.setData({ bigQr: true })
      this.boostBrightness()
    },
    closeBigQr() {
      this.setData({ bigQr: false })
      this.restoreBrightness()
    },
    /** 放大出示时顶亮屏幕:强光下低亮度屏幕扫不出来,这是现场最常见的一种「码没问题但扫不动」。 */
    boostBrightness() {
      if (!wx.setScreenBrightness) return
      const boost = () => wx.setScreenBrightness({ value: 1, fail: () => {} })
      if (this._prevBrightness != null || !wx.getScreenBrightness) { boost(); return }
      // 必须等 get 回来再顶亮:两个 API 都是异步的,先 set 后 get 会把刚顶上去的 1
      // 当成「原亮度」存下来 ⇒ 关闭时「还原」回 1 ⇒ 屏幕永远停在最亮下不来。
      wx.getScreenBrightness({
        success: (res) => { this._prevBrightness = res && res.value; boost() },
        fail: () => { boost() },
      })
    },
    restoreBrightness() {
      if (!wx.setScreenBrightness || this._prevBrightness == null) return
      wx.setScreenBrightness({ value: this._prevBrightness, fail: () => {} })
      this._prevBrightness = null
    },
    close() { this.restoreBrightness(); this.triggerEvent('close') },
  },
})
