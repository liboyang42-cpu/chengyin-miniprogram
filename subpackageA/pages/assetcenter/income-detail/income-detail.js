// D28 收益明细页。2026-08-11 用户裁决「放到页面上,不要做弹窗」——
// 原来这页一进来就永久弹一个 cy-sheet,页面标题与弹层标题同屏重复。现在正文直接落在页上,
// 列表与筛选仍只有 scene 组件那一份实现(本页不复制正文)。
const merchantTheme = require('../../../../utils/merchant-theme.js')

Page({
  // 本页正文根恒 theme-dark(D33 玩家资金域),原生壳必须同档;否则浅色状态条压深色内容
  onShow() { merchantTheme.merchantPageRestore() },
  onHide() { merchantTheme.merchantPageRestore() },
  onUnload() { merchantTheme.merchantPageRestore() },
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail() { wx.redirectTo({ url: '/subpackageA/pages/assetcenter/earnings/index' }) },
    })
  },
  onReachBottom() {
    const content = this.selectComponent('#incomeDetail')
    if (content && typeof content.loadMore === 'function') content.loadMore()
  },
})
