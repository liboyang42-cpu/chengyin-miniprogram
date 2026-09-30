// 统一错误态:图标 + 原因 + 重试按钮。点重试触发 'retry' 事件。
// 区分网络/接口失败由使用方传 title/sub 决定;retry 为空则不显示按钮。
function retryLabel(title, retry) {
  const action = String(retry == null ? '' : retry).trim();
  const heading = String(title == null ? '' : title).trim();
  if (!action || action === heading || action === '出错了') return '重试';
  return action;
}

Component({
  properties: {
    icon: { type: String, value: '' },
    title: { type: String, value: '出错了' },
    sub: { type: String, value: '网络开了点小差，请稍后再试' },
    aria: { type: String, value: '' },
    retry: { type: String, value: '重试' },
    // 整页阻断态的安全第二出口；默认空，局部错误态保持单出口。
    secondary: { type: String, value: '' },
    // fill:撑满父容器剩余空间并在其中居中(整屏错误态用),同构 cy-empty 的 fill
    fill: { type: Boolean, value: false },
    // size:'lg' = aaa 标准放大档,同构 cy-empty,opt-in
    size: { type: String, value: '' },
    // autoBack:整页加载失败 = 用户在这页已无事可做(稿 356-5220)。不画错误页,弹零按钮 fail 半屏
    // 把原因展示 2s,然后自动返回。只给页面级整屏错误用:tab 页无处可回、场景弹层里返回会离开宿主页,都别开。
    autoBack: { type: Boolean, value: false },
    // 页面有自己的「该去的页面」(返回俱乐部 / 返回工作台):传 custom-back 并 bind:back,组件不再自己导航。
    customBack: { type: Boolean, value: false },
  },
  data: {
    retryLabel: '重试',
    _sheet: false,
  },
  lifetimes: {
    attached() {
      this._attached = true;
      this._openAutoBack();
    },
  },
  observers: {
    // 父组件(如 cy-state-shell)可能在挂上之后才把 autoBack 翻成 true:只在 attached 读一次会只剩空白占位
    autoBack() { if (this._attached) this._openAutoBack(); },
    'title, retry': function (title, retry) {
      this.setData({ retryLabel: retryLabel(title, retry) });
    },
  },
  methods: {
    _openAutoBack() {
      if (!this.data.autoBack || this.data._sheet || this._page) return;
      const pages = getCurrentPages();
      this._page = pages[pages.length - 1];   // 记下所在页:收起时栈顶可能已经换了
      this.setData({ _sheet: true });
    },
    onRetry() { this.triggerEvent('retry'); },
    onSecondary() { this.triggerEvent('secondary'); },
    // 面板收起(2s 到点 / 点遮罩)都算看过了原因,一律回去;只走一次。
    onAutoBack() {
      // 同一页上 access-gate 与页面自己的无权限态可能同时弹,只许一个真的返回,否则连退两页
      const page = this._page || {};
      if (page.__cyAutoBacked) return;
      page.__cyAutoBacked = true;
      this.setData({ _sheet: false });
      if (this.data.customBack) { this.triggerEvent('back'); return; }
      const pages = getCurrentPages();
      if (pages.length > 1) { wx.navigateBack(); return; }
      const route = (pages[0] && pages[0].route) || '';
      wx.reLaunch({ url: route.indexOf('pages/merchant/') === 0 ? '/pages/merchant/index/index' : '/pages/index/index' });
    },
  },
});
