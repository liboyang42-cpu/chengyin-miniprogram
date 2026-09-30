const { resolveMenuChrome } = require('../../../../utils/nav-safe-area.js');

Component({
  behaviors: [require('../../../../behaviors/reduced-motion.js')],
  properties: {
    model: { type: Object, value: {} }
  },
  data: {
    // 关闭键得避开微信胶囊。原来写死 env(safe-area-inset-top)+16rpx / right:20rpx ——
    // 实测命中区落在 335..380 × 8..53,而胶囊是 296.. × 55..87:**正好贴在胶囊上沿 2px**,
    // 手指一偏点到的是「关闭小程序」,而这一屏恰恰是刚发布完、误触代价最大的时刻
    // (nav-safe-area.js 里那段注释警告的就是这件事)。改成走全站同一份几何:
    // 竖直对齐胶囊(actionTop),水平让到胶囊左边(actionRight)。
    chrome: { actionTop: 28, actionRight: 12 }
  },
  attached() {
    let windowInfo = {};
    let menuButtonInfo = null;
    try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (e) {}
    try { menuButtonInfo = wx.getMenuButtonBoundingClientRect(); } catch (e) {}
    this.setData({ chrome: resolveMenuChrome(windowInfo, menuButtonInfo) });
  },
  methods: {
    onAction(e) { this.triggerEvent('action', { key: e.currentTarget.dataset.key }); },
    block() {}
  }
});
