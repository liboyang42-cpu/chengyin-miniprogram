// 我的订单 = 二级大功能,正常页面。列表实现在 components/cy/scene-member-order-history。
// 本页同时是「订单详情」这一三级场景的宿主 —— 详情是查看状态,不值得单独占一页。
const app = getApp();
const { activityShareFromEvent } = require('../../utils/activity-share.js');
const { getScene } = require('../../utils/scene-registry.js');

Page({
  data: {
    // 自定义导航:页面自留同高占位,内容不被 fixed 顶栏压住
    statusBarHeight: (app.globalData || {}).statusBarHeight || 20,
    navBarHeight: (app.globalData || {}).navBarHeight || 44,
    sceneStack: [],
    sceneCurrent: null,
  },
  onLoad(options) {
    const detailId = options && options.detailId;
    if (!detailId) return;
    const scene = getScene('member-order-detail', { id: detailId });
    this.setData({ sceneStack: [scene], sceneCurrent: scene });
  },
  goBack() {
    wx.navigateBack({
      delta: 1,
      fail() { wx.switchTab({ url: '/pages/member/index/index' }); },
    });
  },
  onReachBottom() {
    const content = this.selectComponent('#orderHistory');
    if (content && typeof content.loadMore === 'function') content.loadMore();
  },
  blockSceneTouch() {},
  openScene(e) {
    const detail = (e && e.detail) || {};
    if (!detail.id) return;
    const scene = getScene(detail.id, detail.params || {});
    if (!scene) return;
    const sceneStack = this.data.sceneStack.concat(scene);
    this.setData({ sceneStack: sceneStack, sceneCurrent: scene });
  },
  backScene() {
    if (this.data.sceneStack.length <= 1) {
      this.closeScene();
      return;
    }
    const sceneStack = this.data.sceneStack.slice(0, -1);
    this.setData({ sceneStack: sceneStack, sceneCurrent: sceneStack[sceneStack.length - 1] });
  },
  closeScene() {
    this.setData({ sceneStack: [], sceneCurrent: null });
  },
  onOrderChanged(e) {
    const scene = this.data.sceneCurrent;
    if (!scene || scene.id !== 'member-order-detail'
      || String(scene.params.id) !== String(e.detail && e.detail.id)) return;
    const content = this.selectComponent('#orderHistory');
    if (content) content.retryList();
  },
  onShareAppMessage(event) {
    return activityShareFromEvent(event);
  },
});
