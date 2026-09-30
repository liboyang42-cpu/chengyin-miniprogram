// 账户收益正文由 scene-asset-earnings 承载；本页负责三级 scene 与资金写入表单。
const modal = require('../../../../utils/modal.js');
const loading = require('../../../../utils/loading.js');
const toast = require('../../../../utils/toast.js');
const app = getApp()
const analytics = require('../../../../utils/analytics.js')
const merchantTheme = require('../../../../utils/merchant-theme.js')
const roleGuard = require('../../../../utils/roleGuard.js')
const { getScene } = require('../../../../utils/scene-registry.js')
// 校验与单独同意的单一真源:/api/withdrawal/create 有三个前端写入口,规则只留一份。
const withdrawForm = require('../../../../utils/withdraw-form.js')
const withdrawalPreflight = require('../../../utils/withdrawal-preflight.js')
// 2026-09-15 起「提现」不再走银行卡表单:平台不打款,一律弹平台客服微信线下处理。
const withdrawCs = require('../../../../utils/withdraw-cs.js')

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    sceneStack: [],
    sceneCurrent: null,
    txSheet: { show: false },
    txUserInfo: { balance: 0 },
    txBalanceText: '0.00',
    txBalanceErr: false,
    txBalanceLoaded: false,
    txRealname: '',
    txBankName: '',
    txBankAccount: '',
    txMobilephone: '',
    txWithdrawalAmount: '',
    txCanSubmit: false,
    // 个保法 §29 单独同意:必须默认 false,不得预勾
    txConsented: false,
    txSubmitting: false,
    txSubmitError: '',
    txSubmitErrorKind: 'data',
  },

  onLoad(options) {
    if (!options || options.scene !== 'merchant-profit') return
    const params = options.topicId ? { topicId: options.topicId } : {}
    this.openScene({ detail: { id: 'merchant-profit', params } })
  },

  onShow() { merchantTheme.merchantPageRestore() },
  onHide() { merchantTheme.merchantPageRestore() },
  onUnload() { merchantTheme.merchantPageRestore() },

  blockSceneTouch() {},

  openScene(event) {
    const detail = (event && event.detail) || {}
    if (!detail.id) return
    if (detail.id === 'member-withdraw') {
      this.openWithdrawSheet()
      return
    }
    const scene = getScene(detail.id, detail.params || {})
    this.setData({ sceneStack: [scene], sceneCurrent: scene })
  },

  closeScene() {
    this.setData({ sceneStack: [], sceneCurrent: null })
  },

  // 2026-09-15 收款模型定稿 §3:平台不打款。这里不再打开 txSheet 银行卡表单,
  // 改为弹平台客服微信;txSheet 及其表单代码暂留(后端 /api/withdrawal/create 不动),
  // 已无入口可到达。
  openWithdrawSheet() {
    roleGuard.load(function () {
      if (!roleGuard.can('withdrawable')) {
        toast('暂无提现权限')
        return
      }
      withdrawCs.showWithdrawCsPopup()
    })
  },

  onTxAmountInput(event) { this.setData({ txWithdrawalAmount: event.detail.value, txSubmitError: '' }, () => this.refreshTxSubmitState()) },
  onTxRealnameInput(event) { this.setData({ txRealname: event.detail.value, txSubmitError: '' }, () => this.refreshTxSubmitState()) },
  onTxBankNameInput(event) { this.setData({ txBankName: event.detail.value, txSubmitError: '' }, () => this.refreshTxSubmitState()) },
  onTxBankAccountInput(event) { this.setData({ txBankAccount: event.detail.value, txSubmitError: '' }, () => this.refreshTxSubmitState()) },
  onTxMobilephoneInput(event) { this.setData({ txMobilephone: event.detail.value, txSubmitError: '' }, () => this.refreshTxSubmitState()) },

  txFormSnapshot() {
    const d = this.data
    return {
      amount: d.txWithdrawalAmount,
      balance: d.txUserInfo && d.txUserInfo.balance,
      realname: d.txRealname,
      bankName: d.txBankName,
      bankAccount: d.txBankAccount,
      mobilephone: d.txMobilephone,
      consented: d.txConsented,
      balanceReady: d.txBalanceLoaded && !d.txBalanceErr,
    }
  },

  // 单独同意勾选。取消勾选要作废已落库标记,重新勾选须再存证一次。
  onTxConsentChange(event) {
    this._txConsentReady = false
    this.setData({ txConsented: !!(event.detail && event.detail.checked) }, () => this.refreshTxSubmitState())
  },

  refreshTxSubmitState() {
    const txCanSubmit = withdrawForm.canSubmitWithdraw(this.txFormSnapshot())
    if (txCanSubmit !== this.data.txCanSubmit) this.setData({ txCanSubmit })
  },

  // 置灰的「确认提现」被点 → 报 checkWithdrawForm 的第一条原因(与可用态同源判定)。
  onTxDisabledTap() {
    const { message } = withdrawForm.checkWithdrawForm(this.txFormSnapshot())
    if (message) toast(message)
  },

  onTxAllWithdrawal() {
    if (this.data.txBalanceErr || !this.data.txBalanceLoaded) {
      toast('余额没取到，请先重试')
      return
    }
    const balance = this.data.txUserInfo.balance
    if (balance > 0) this.setData({ txWithdrawalAmount: balance.toString(), txSubmitError: '' }, () => this.refreshTxSubmitState())
    else toast('无可提现金额')
  },

  // 与独立 subpackageMember/tixian 的资金校验逐条一致：都走 utils/withdraw-form.js。
  // 三个写入口共用同一份规则与文案顺序。
  validateTxForm() {
    const verdict = withdrawForm.checkWithdrawForm(this.txFormSnapshot())
    if (!verdict.ok) {
      toast(verdict.message)
      return false
    }
    return true
  },

  recordTxConsentThenSave() {
    const that = this
    if (!app.recordConsent) {
      toast('同意记录服务暂不可用，请稍后重试')
      return
    }
    loading.show('提交中...')
    app.recordConsent({
      docType: withdrawForm.CONSENT_DOC_TYPE,
      scene: withdrawForm.CONSENT_SCENE,
      eventType: 'AGREE',
    }).then(function () {
      loading.hide()
      that._txConsentReady = true
      that.onTxSave()
    }).catch(function () {
      loading.hide()
      toast('同意记录未保存，请检查网络后重试')
    })
  },

  onTxSave() {
    const that = this
    if (that._txSubmitting || that.data.txSubmitting) return
    if (!that.data.txCanSubmit) {
      toast('余额没取到，请先重试')
      return
    }
    if (!that.validateTxForm()) return
    // 前端先保存单独同意，后端 BankWithdrawalCommandService 还会校验当前版本记录；
    // 任一侧缺失都不得创建提现单。
    if (!that._txConsentReady) {
      that.recordTxConsentThenSave()
      return
    }
    if (that._txSubmitting) return

    that._txSubmitting = true
    that.setData({ txSubmitting: true, txSubmitError: '' })
    const data = {
      realname: that.data.txRealname.trim(),
      bankName: that.data.txBankName.trim(),
      bankAccount: that.data.txBankAccount.trim(),
      mobilephone: that.data.txMobilephone.trim(),
      withdrawalAmount: parseFloat(that.data.txWithdrawalAmount),
    }
    that._txRequestIdentity = withdrawForm.ensureWithdrawRequestIdentity(that._txRequestIdentity, data)
    data.requestId = that._txRequestIdentity.requestId
    withdrawalPreflight.submitBankWithdrawal(app, wx, data, {
      success(res) {
        if (res.code == '200') {
          that._txRequestIdentity = null
          analytics.track('withdrawal_submit', {
            bizType: 'withdrawal',
            bizId: res.data && res.data.id ? res.data.id : null,
            properties: { amount: data.withdrawalAmount },
          })
          toast.success('提现申请提交成功', { duration: 2000 })
          setTimeout(() => {
                that.setData({
                  'txSheet.show': false,
                  txWithdrawalAmount: '',
                  txRealname: '',
                  txBankName: '',
                  txBankAccount: '',
                  txMobilephone: '',
                  txCanSubmit: false,
                  txSubmitError: '',
                })
                that.loadTxBalance()
                const earnings = that.selectComponent('#assetEarnings')
                if (earnings && typeof earnings.refresh === 'function') earnings.refresh()
              }, 2000)
        } else {
          that.setData({
            txSubmitError: app.getRequestErrorMessage(res, '提现申请提交失败，请检查后重试'),
            txSubmitErrorKind: 'data',
          })
        }
      },
      fail(error) {
        that.setData({
          txSubmitError: error && error.errMsg
            ? '网络连接异常，请检查后重试'
            : app.getRequestErrorMessage(error, '暂时无法提交，请重试'),
          txSubmitErrorKind: 'network',
        })
      },
      cancel() {
        that.setData({ txSubmitError: '' })
      },
      complete() {
        that._txSubmitting = false
        that.setData({ txSubmitting: false })
      },
    })
  },

  loadTxBalance() {
    const that = this
    app.sendRequest({
      hideLoading: true,
      url: '/api/user/info',
      data: { member_id: app.getUserID() },
      method: 'POST',
      success(res) {
        // balance 为 null/空是「新用户 / 商家还没有收益」的正常数据(库列可空),按 0 展示;
        // 只有请求失败(非 200 / 无 data)或余额是坏值才落 txBalanceErr —— 别把正常空余额说成网络错,
        // 也别把坏值渲染成确定的 ¥0.00(与 components/cy/scene-asset-earnings 同口径)。
        const rawBalance = res && res.data && res.data.balance
        const missing = rawBalance === null || rawBalance === undefined
          || (typeof rawBalance === 'string' && rawBalance.trim() === '')
        const parsed = Number(rawBalance)
        const valid = !missing && Number.isFinite(parsed) && parsed >= 0
        const balance = missing ? 0 : parsed
        if (res && res.code == '200' && res.data && (missing || valid)) {
          that.setData({
            txUserInfo: Object.assign({}, res.data, { balance }),
            txBalanceText: balance.toFixed(2),
            txBalanceErr: false,
            txBalanceLoaded: true,
          }, () => that.refreshTxSubmitState())
        } else {
          that.setData({ txBalanceErr: true, txBalanceLoaded: true }, () => that.refreshTxSubmitState())
        }
      },
      fail() { that.setData({ txBalanceErr: true, txBalanceLoaded: true }, () => that.refreshTxSubmitState()) },
    })
  },

  onTxRequestClose() {
    const data = this.data
    const dirty = !!(data.txWithdrawalAmount || data.txRealname || data.txBankName || data.txBankAccount || data.txMobilephone)
    if (!dirty) return
    const that = this
    modal.show({
      title: '放弃本次提现填写？',
      content: '已填写的信息不会被保存',
      confirmText: '放弃',
      cancelText: '继续填写',
      success(res) {
        if (res.confirm) {
          that.setData({
            'txSheet.show': false,
            txWithdrawalAmount: '',
            txRealname: '',
            txBankName: '',
            txBankAccount: '',
            txMobilephone: '',
            txCanSubmit: false,
            txSubmitError: '',
          })
        }
      },
    })
  },

  onTxClose() { this.setData({ 'txSheet.show': false }) },
})
