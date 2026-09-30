const app = getApp()
const merchantTheme = require('../../utils/merchant-theme.js')

// D23 深链壳：正文落页，不再套常驻半屏。记录正文仍与账户收益入口共用同一个 scene。
Page({
  onShow() { merchantTheme.merchantPageShow() },
  onHide() { merchantTheme.merchantPageRestore() },
  onUnload() { merchantTheme.merchantPageRestore() },
  onReachBottom() {
    const content = this.selectComponent('#inviteHistory')
    if (content && typeof content.loadMore === 'function') content.loadMore()
  },
  onClose() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({ url: '/subpackageA/pages/assetcenter/earnings/index' })
  },
  onShareAppMessage() {
    return {
      title: '城瘾Hub',
      path: '/pages/index/index?inviter=' + app.getUserID(),
    }
  },
})
