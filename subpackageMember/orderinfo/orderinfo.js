// 深链兼容壳。订单详情与支付/退款逻辑在 components/cy/scene-member-order-detail。
const { openScene } = require('../../utils/scene-entry.js');

Page({
  data: { id: '' },
  onLoad(options) {
    this.setData({ id: (options && options.id) || '' });
  },
  // 组件在场景里发 back/close 是「回上一层场景」;深链壳里没有场景栈,退回页面导航。
  // 方法名与按钮字面一致 —— c04-r2 的「按钮字面必须为真」就是盯这条。
  backToOrderList() {
    const pages = getCurrentPages();
    const previous = pages.length > 1 ? pages[pages.length - 2] : null;
    if (previous && previous.route === 'subpackageMember/order/order') {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.redirectTo({ url: '/subpackageMember/order/order' });
  },
  openChildScene(event) {
    const detail = (event && event.detail) || {};
    if (detail.id) openScene(detail.id, detail.params || {});
  },
});
