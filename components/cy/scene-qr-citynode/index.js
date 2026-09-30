'use strict'

const app = getApp()
const ISSUE_ERROR_MESSAGE = '暂时无法生成核销码，请稍后重试'
/* CU-M-53:据点码是长签名令牌,只能靠二维码扫。图缺时 qr-voucher 会把 code 当文字铺满码区,
   看着像扫码成功态其实扫不出 ⇒ 商家扫不了、券发不出。没图 = 没出成码,按失败给重试
   (与 components/cy/scene-qr-group-code 同一条判据)。 */
const QR_MISSING_MESSAGE = '核销码二维码没能生成，请重试'

function ok(res) { return res && (res.code === 200 || res.code === '200') }
function ttlSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000
    ? Math.floor(value / 1000)
    : 0
}

Component({
  properties: { poiId: { type: String, value: '' }, name: { type: String, value: '据点' } },
  data: { state: 'loading', qr: '', code: '', countdown: 0, errorText: '' },
  observers: { poiId(value) { if (value) this.issue(value) } },
  lifetimes: { attached() { if (this.data.poiId) this.issue(this.data.poiId) }, detached() { this._issueToken = (this._issueToken || 0) + 1; this.clearTimer() } },
  methods: {
    issue(poiId) {
      const token = (this._issueToken || 0) + 1
      this._issueToken = token
      if (!poiId) { this.setData({ state: 'missing', qr: '', code: '' }); return }
      this.clearTimer(); this.setData({ state: 'loading', qr: '', code: '', countdown: 0, errorText: '' })
      app.sendRequest({
        url: '/api/verify/citynode/issue', method: 'POST', data: { poiId }, hideLoading: true, silentError: true,
        success: (res) => {
          if (token !== this._issueToken) return
          const data = res && res.data
          if (!ok(res) || !data || !data.code) { this.setData({ state: 'error', errorText: ISSUE_ERROR_MESSAGE }); return }
          if (!data.qrcodeUrl) { this.setData({ state: 'error', errorText: QR_MISSING_MESSAGE }); return }
          const countdown = ttlSeconds(data.ttlMs)
          if (!countdown) { this.setData({ state: 'error', errorText: '核销码有效期未确认，请重新生成' }); return }
          this.setData({ state: 'ready', qr: data.qrcodeUrl, code: data.code, countdown }, () => this.startTimer())
        },
        successStatusAbnormal: () => { if (token === this._issueToken) this.setData({ state: 'error', errorText: ISSUE_ERROR_MESSAGE }) },
        fail: () => { if (token === this._issueToken) this.setData({ state: 'error', errorText: '网络异常，请稍后重试' }) },
      })
    },
    startTimer() { this.clearTimer(); this._timer = setInterval(() => { const next = this.data.countdown - 1; if (next <= 0) this.issue(this.data.poiId); else this.setData({ countdown: next }) }, 1000) },
    clearTimer() { if (this._timer) clearInterval(this._timer); this._timer = null },
    retry() { this.issue(this.data.poiId) },
    close() { this.clearTimer(); this.triggerEvent('close') },
  },
})
