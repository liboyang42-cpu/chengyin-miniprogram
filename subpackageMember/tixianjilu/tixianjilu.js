// D21 深链兼容壳：正文直接落在页上，列表与取数只有 scene 组件一份实现。
const merchantTheme = require('../../utils/merchant-theme.js')

Page({
  data: { isMerchant: false },
  // 商家侧深链(pages/coop/withdraw/records)带 theme=merchant 进来 → 根节点挂 theme-merchant 白底;
  // 玩家侧(收益页等)不带参数,保持原暗色。只切展示主题,取数不变。
  onLoad(options) {
    this.setData({ isMerchant: !!options && options.theme === 'merchant' })
  },
  onShow() { merchantTheme.merchantPageShow() },
  onHide() { merchantTheme.merchantPageRestore() },
  onUnload() { merchantTheme.merchantPageRestore() },
  onReachBottom() {
    const content = this.selectComponent('#withdrawHistory')
    if (content && typeof content.loadMore === 'function') content.loadMore()
  },
  onClose() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({ url: '/subpackageA/pages/assetcenter/earnings/index' })
  },
})
