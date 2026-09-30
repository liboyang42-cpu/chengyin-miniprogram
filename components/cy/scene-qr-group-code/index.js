'use strict'

const app = getApp()
const { buildGroupCodeIssuePayload, listGroupCodeActivities } = require('../../../utils/group-code-session.js')

function ok(res) { return res && (res.code === 200 || res.code === '200') }
function ttlSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000
    ? Math.floor(value / 1000)
    : 0
}

Component({
  properties: {
    activityId: { type: String, value: '' },
    topicId: { type: String, value: '' },
    name: { type: String, value: '' },
  },
  data: { state: 'loading', options: [], currentActivityId: '', title: '本团', pickerTitle: '', pickerSubtitle: '', qr: '', code: '', countdown: 0, errorText: '' },
  observers: {
    'activityId, topicId': function (activityId, topicId) { if (activityId || topicId) this.start(activityId, topicId) },
  },
  lifetimes: { attached() { if (this.data.activityId || this.data.topicId) this.start(this.data.activityId, this.data.topicId) }, detached() { this._requestToken = (this._requestToken || 0) + 1; this.clearTimer() } },
  methods: {
    start(activityId, topicId) {
      this.clearTimer()
      const payload = buildGroupCodeIssuePayload(activityId)
      this.setData({ state: payload ? 'loading' : topicId ? 'loading' : 'missing', currentActivityId: payload ? String(payload.activityId) : '', title: this.data.name || '本团', errorText: payload || topicId ? '' : '链接缺少团信息' })
      if (payload) this.issue()
      else if (topicId) this.selectActivity(topicId)
    },
    friendly(message, fallback) {
      const text = String(message || '')
      if (/登录|认证|401|token/i.test(text)) return '登录已过期，请重新进入'
      if (/网络|timeout|fail|502|503/i.test(text)) return '网络异常，请稍后重试'
      return fallback
    },
    selectActivity(topicId) {
      const token = (this._requestToken || 0) + 1
      this._requestToken = token
      app.sendRequest({
        url: '/api/topic/info-to-user', method: 'POST', data: { id: topicId }, hideLoading: true, silentError: true,
        success: (res) => {
          if (token !== this._requestToken) return
          const raw = res && res.data && res.data.activityList
          if (!ok(res) || !Array.isArray(raw)) { this.setData({ state: 'error', options: [], errorText: this.friendly(res && res.msg, '场次暂时没能加载，请稍后重试') }); return }
          if (raw.length === 0) { this.setData({ state: 'empty', options: [], errorText: '' }); return }
          const options = listGroupCodeActivities(raw)
          if (!options.length) { this.setData({ state: 'error', options: [], errorText: this.friendly(res && res.msg, '场次信息不完整，请稍后重试') }); return }
          if (options.length === 1) { this.setData({ currentActivityId: String(options[0].id), title: options[0].name }, () => this.issue()); return }
          this.setData({ state: 'selecting', options, pickerTitle: '选择场次', pickerSubtitle: '选择本次带队场次' })
        },
        successStatusAbnormal: (res) => { if (token === this._requestToken) this.setData({ state: 'error', errorText: this.friendly(res && res.msg, '场次暂时没能加载，请稍后重试') }) },
        fail: () => { if (token === this._requestToken) this.setData({ state: 'error', errorText: '网络异常，请稍后重试' }) },
      })
    },
    chooseActivity(event) {
      const id = event.currentTarget.dataset.id
      const item = this.data.options.find((option) => String(option.id) === String(id))
      if (!buildGroupCodeIssuePayload(id)) return
      this.setData({ currentActivityId: String(id), title: item && item.name || '本团' }, () => this.issue())
    },
    issue() {
      const payload = buildGroupCodeIssuePayload(this.data.currentActivityId)
      if (!payload) { this.setData({ state: 'error', errorText: '请选择具体场次' }); return }
      const token = (this._requestToken || 0) + 1
      this._requestToken = token
      this.clearTimer(); this.setData({ state: 'loading', qr: '', code: '', countdown: 0, errorText: '' })
      app.sendRequest({
        url: '/api/verify/groupcode/issue', method: 'POST', data: payload, hideLoading: true, silentError: true,
        success: (res) => {
          if (token !== this._requestToken) return
          const data = res && res.data
          if (!ok(res) || !data || !data.code) { this.setData({ state: 'error', errorText: this.friendly(res && res.msg, '团码暂时没能生成，请稍后重试') }); return }
          const countdown = ttlSeconds(data.ttlMs)
          if (!countdown) { this.setData({ state: 'error', errorText: '团码有效期未确认，请重新生成' }); return }
          // CU-C-01:团码是一长串签名令牌,只能靠二维码扫;没有图时 qr-voucher 会退回把 code 当文字铺满码区
          // (券码短,那条退路对券有用,对团码是乱码)。没图 = 没出成码,按失败给重试。
          if (!data.qrcodeUrl) { this.setData({ state: 'error', errorText: '团码二维码没能生成，请重试' }); return }
          this.setData({ state: 'ready', qr: data.qrcodeUrl, code: data.code, countdown }, () => this.startTimer())
        },
        successStatusAbnormal: (res) => { if (token === this._requestToken) this.setData({ state: 'error', errorText: this.friendly(res && res.msg, '团码暂时没能生成，请稍后重试') }) },
        fail: () => { if (token === this._requestToken) this.setData({ state: 'error', errorText: '网络异常，请稍后重试' }) },
      })
    },
    startTimer() {
      this.clearTimer()
      this._timer = setInterval(() => { const next = this.data.countdown - 1; if (next <= 0) this.issue(); else this.setData({ countdown: next }) }, 1000)
    },
    clearTimer() { if (this._timer) clearInterval(this._timer); this._timer = null },
    retry() { if (this.data.currentActivityId) this.issue(); else if (this.data.topicId) this.selectActivity(this.data.topicId) },
    close() { this.clearTimer(); this.triggerEvent('close') },
  },
})
