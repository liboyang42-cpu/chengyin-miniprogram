Page({
  // 栈首页(深链直达)时 navigateBack 会失败;本页又可能长时间停在核验态,
  // 没有兜底就等于把用户关在一个转圈页里。回落到真实 caller 所在的设置页(shezhi.js:129)。
  // redirectTo 而非 navigateTo:兜底不该把页面栈越堆越深。
  onBack() {
    wx.navigateBack({ fail() { wx.redirectTo({ url: '/pages/shezhi/shezhi' }); } });
  },
});
