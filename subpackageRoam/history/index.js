// 深链兼容壳。RunCard 与汇总正文只在 scene-roam-history 维护。
const app = getApp()

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
  },
  openSession(event) {
    const detail = event.detail || {}
    wx.navigateTo({ url: `/subpackageRoam/session/index?ts=${detail.params && detail.params.ts}` })
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.switchTab({ url: '/pages/roam/index' })
  },
})
