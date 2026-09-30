// 深链兼容壳。编辑表单与保存逻辑在 components/cy/scene-club-edit。
const toast = require('../../../utils/toast.js');
const app = getApp();

Page({
  data: {
    statusBarHeight: app.globalData.statusBarHeight,
    navBarHeight: app.globalData.navBarHeight,
    clubId: '',
    routeReady: false,
    dirty: false,
    confirm: { show: false },
  },
  onLoad(options) { this.setData({ clubId: (options && (options.id || options.clubId)) || '', routeReady: true }); },
  onDirtyChange(event) { this.setData({ dirty: !!(event.detail && event.detail.dirty) }); },
  onSaved() { this.setData({ dirty: false }); },
  onDissolved() {
    this.setData({ dirty: false });
    toast.success('俱乐部已解散');
    setTimeout(function () {
      wx.navigateBack({ delta: 1, fail() { wx.switchTab({ url: '/pages/talent/list/index' }); } });
    }, 500);
  },
  // 解散确认框的 alt「改为转让主理人」→ 治理页(转让链路真源)。原来事件没人接,点了只关框。
  goGovernance() {
    if (!this.data.clubId) return;
    wx.navigateTo({ url: '/pages/club/governance/index?clubId=' + this.data.clubId });
  },
  requestBack() {
    if (this.data.dirty) {
      this.setData({ confirm: { show: true } });
      return;
    }
    this.doBack();
  },
  confirmBack() {
    this.setData({ dirty: false, confirm: { show: false } });
    this.doBack();
  },
  cancelBack() { this.setData({ confirm: { show: false } }); },
  doBack() { wx.navigateBack({ fail() { wx.switchTab({ url: '/pages/talent/list/index' }); } }); },
});
