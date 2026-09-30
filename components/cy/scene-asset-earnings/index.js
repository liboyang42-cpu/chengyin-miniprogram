'use strict'

const toast = require('../../../utils/toast.js');
const app = getApp()
const roleGuard = require('../../../utils/roleGuard.js')
const motion = require('../../../utils/motion.js')
const { readReducedMotion } = require('../../../utils/motion-preference.js')

function readBalance(raw) {
  const candidate = typeof raw === 'number' || (typeof raw === 'string' && raw.trim() !== '')
  if (!candidate) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value.toFixed(2) : null
}

/** 余额字段「缺失」:库列可空,新用户/还没收益时后端直接下发 null 或空串 —— 正常数据,不是错误。
 *  ⚠️ 只认缺失;负数/非数字这类坏值仍走 error,不摆伪 ¥0.00(见 readBalance)。 */
function isMissingBalance(raw) {
  return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')
}

Component({
  properties: {
    theme: { type: String, value: 'player' },
  },
  data: {
    state: 'loading',
    balance: '',
    /* 金额滚动展示值:countUp 只写这里,balance 保持真值(空态判断/全部提现都读真值) */
    balanceDisplay: '',
  },
  lifetimes: {
    attached() { this._detached = false; this.load(false) },
    detached() {
      this._detached = true
      this._loadToken = (this._loadToken || 0) + 1
      if (this._stopCountUp) { this._stopCountUp(); this._stopCountUp = null }
    },
  },
  methods: {
    load(forceRemote) {
      const token = (this._loadToken || 0) + 1
      this._loadToken = token
      if (this._stopCountUp) { this._stopCountUp(); this._stopCountUp = null }
      this.setData({ state: 'loading' })
      const cached = !forceRemote && readBalance(app.globalData.userInfo && app.globalData.userInfo.balance)
      if (cached !== null && cached !== false) {
        this._showBalance(cached)
        return
      }
      app.sendRequest({
        hideLoading: true,
        silentError: true,
        url: '/api/user/info',
        method: 'POST',
        data: { member_id: app.getUserID() },
        success: (res) => {
          if (this._detached || token !== this._loadToken) return
          // balance=null/空串是「新用户 / 商家还没有收益」的正常数据(ApiUmsMemberController 的
          // balance 列可空,直接下发 null),按 0.00 展示;只有请求真的失败(非 200 / 无 data)
          // 或余额是坏值,才进错误态。
          if (!res || res.code != '200' || !res.data) { this.setData({ state: 'error' }); return }
          const balance = readBalance(res.data.balance)
          if (balance !== null) this._showBalance(balance)
          else if (isMissingBalance(res.data.balance)) this._showBalance('0.00')
          else this.setData({ state: 'error' })
        },
        fail: () => { if (!this._detached && token === this._loadToken) this.setData({ state: 'error' }) },
        successStatusAbnormal: () => { if (!this._detached && token === this._loadToken) this.setData({ state: 'error' }) },
      })
    },
    /* 金额落定时从 0 滚到真值(220ms);末帧被 countUp 钉死在 to,不会显示错。
     * 减动效 / 非正数直接落定不滚。 */
    _showBalance(balance) {
      if (this._detached) return
      if (this._stopCountUp) { this._stopCountUp(); this._stopCountUp = null }
      const target = Number(balance)
      if (readReducedMotion() || !(target > 0)) {
        this.setData({ state: 'ready', balance, balanceDisplay: balance })
        return
      }
      /* 起点显式归零 —— 否则 refresh 时 state 转 ready 到首帧之间那一拍会闪出上次的金额 */
      this.setData({ state: 'ready', balance, balanceDisplay: '0.00' })
      this._stopCountUp = motion.countUp(0, target, (v) => {
        this.setData({ balanceDisplay: v.toFixed(2) })
      }, { decimals: 2, onDone: () => { this._stopCountUp = null } })
    },
    refresh() { this.load(true) },
    // 2026-08-11 用户裁决:收益明细放到页面上,不再开弹层
    openIncomeDetail() { wx.navigateTo({ url: '/subpackageA/pages/assetcenter/income-detail/income-detail' }) },
    openWithdrawHistory() { this.triggerEvent('open', { id: 'member-withdraw-history' }) },
    openWithdraw() {
      roleGuard.load(() => {
        if (!roleGuard.can('withdrawable')) {
          toast('暂无提现权限')
          return
        }
        this.triggerEvent('open', { id: 'member-withdraw' })
      })
    },
    openInvite() { this.triggerEvent('open', { id: 'member-invite-history' }) },
    goPublish() { wx.switchTab({ url: '/pages/template/index' }) },
  },
})
