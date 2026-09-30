const cyToast = require('../../utils/toast.js');
const app = getApp();
const roleGuard = require('../../utils/roleGuard.js');
const merchantTheme = require('../../utils/merchant-theme.js');
// 2026-09-15 收款模型定稿 §3:平台不打款,提现一律弹平台客服微信线下处理。
// 2026-09-16 截图冒烟:银行卡表单(姓名/银行名称/银行账号/手机号 + 单独同意)从页面上撤掉 ——
// 页面仍由场景注册(utils/scene-registry.js 'member-withdraw')挂在这里,所以它不能是旧表单,
// 只能是一个客服入口。后端 /api/withdrawal/* 接口与共享工具不动。
const withdrawCs = require('../../utils/withdraw-cs.js');
Page({

  /**
   * 页面的初始数据
   */
  data: {
    // 自定义导航:顶栏高度 = 状态栏 + 导航条,页面自留同高占位,内容不被顶栏压住
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    // 展示与计算解耦:balanceText 只管显示(两位小数),校验用的原始数值已随银行卡表单一起退役
    balanceText: '0.00',
    // 余额没取到 ≠ 余额是 0。失败时不许渲染出「¥0」这个确定结论
    balanceErr: false,
    balanceLoaded: false,
    withdrawHistorySheet: false,
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    var that = this
    this._unloaded = false
    merchantTheme.merchantPageShow();
    roleGuard.load(function () {
      if (!roleGuard.can('withdrawable')) {
        merchantTheme.merchantPageRestore();
        cyToast('暂无提现权限')
        that._permissionBackTimer = setTimeout(function () {
          that._permissionBackTimer = null
          if (that._unloaded) return
          that.exitPage()
        }, 1500)
        return
      }
      that.setData({ balanceLoaded: false })
      that.getUserData()
    })
  },

  onHide() { merchantTheme.merchantPageRestore(); },
  onUnload() {
    this._unloaded = true
    if (this._permissionBackTimer) {
      clearTimeout(this._permissionBackTimer)
      this._permissionBackTimer = null
    }
    merchantTheme.merchantPageRestore()
  },

  exitPage() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.reLaunch({ url: '/pages/merchant/index/index' })
  },

  openWithdrawHistory() { this.setData({ withdrawHistorySheet: true }) },
  closeWithdrawHistory() { this.setData({ withdrawHistorySheet: false }) },

  // 2026-09-15 收款模型定稿 §3:平台不打款,提现不再走银行卡表单、不再调 /api/withdrawal/create,
  // 一律弹平台客服微信线下处理。表单校验/单独同意的旧实现已随表单一起删除(页面不再采集银行卡信息)。
  saveData: function() {
    withdrawCs.showWithdrawCsPopup()
  },

  getUserData: function() {
    const that = this;
    app.sendRequest({
      hideLoading: true,
      url: '/api/user/info',
      data: {
        member_id: app.getUserID()
      },
      method: "POST",
      success: function(res) {
        // 余额为 null/空是「新用户 / 商家还没有收益」的正常数据(库列可空),按 0 展示;
        // 只有请求失败(非 200 / 无 data)才是「暂时取不到」。
        const rawBalance = res && res.data && res.data.balance
        const missing = rawBalance === null || rawBalance === undefined
          || (typeof rawBalance === 'string' && rawBalance.trim() === '')
        const parsed = Number(rawBalance)
        const hasValidBalance = !missing && Number.isFinite(parsed) && parsed >= 0
        if (res && res.code == "200" && res.data && (missing || hasValidBalance)) {
          const balance = missing ? 0 : parsed
          that.setData({
            balanceText: balance.toFixed(2),
            balanceErr: false,
            balanceLoaded: true,
          });
        } else {
          that.setData({ balanceErr: true, balanceLoaded: true });
        }
      },
      fail: function(res) {
        that.setData({ balanceErr: true, balanceLoaded: true });
      }
    })
  },
})
