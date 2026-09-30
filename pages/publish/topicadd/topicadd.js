// 兼容重定向壳：兼容用户手机上的历史页面栈。
// 2026-10 之后删除本页并从 app.json 摘除。
Page({
  data: { redirectTarget: '/pages/publish/fabu/index' },

  onLoad(options = {}) {
    const query = ['templateName', 'mode', 'clubId']
      .filter((key) => Object.prototype.hasOwnProperty.call(options, key))
      .map((key) => `${key}=${encodeURIComponent(options[key])}`)
      .join('&')
    this.data.redirectTarget = query ? '/pages/publish/fabu/index?' + query : '/pages/publish/fabu/index'
    this.redirectToEditor()
  },

  redirectToEditor() {
    if (this._redirectInFlight) return
    this._redirectInFlight = true
    wx.redirectTo({
      url: this.data.redirectTarget,
      fail: () => {
        this._redirectInFlight = false
        // 退役壳不渲染页面实体；普通替换失败时重建页面栈自动恢复。
        wx.reLaunch({
          url: this.data.redirectTarget,
          fail: () => wx.switchTab({ url: '/pages/index/index' })
        })
      }
    })
  }
})
