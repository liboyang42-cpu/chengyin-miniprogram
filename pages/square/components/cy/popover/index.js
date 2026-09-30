// cy-popover · T5 胶囊弹窗(Figma 339:740)
//
// 锚点矩形由调用方传进来,不在组件内量 —— 触发点(帖文头像)长在 cy-post-card 里,
// 本组件挂在页面上,createSelectorQuery 跨不过去。调用方在 tap 回调里量一次即可。
//
// 稿子的组件说明把边界写死了:**不许居中、不许铺满宽度**(一居中就变成 T2 半屏 sheet)。
// 所以这里只算 left/top,绝不设 width,也绝不用 left+right 对拉。

// 面板与锚点的间距,以及贴边时离屏幕边缘的最小余量(稿 339:730→733 实测 12pt)
const GAP_PT = 12;
const EDGE_PT = 12;

Component({
  options: { styleIsolation: 'isolated' },

  properties: {
    show: { type: Boolean, value: false },
    /* anchor:触发点的 boundingClientRect(px)。缺了就不开 —— 没有锚点的 T5 只能居中,
       而居中恰恰是稿子明令禁止的形态,宁可不显示也不显示成错的那一种。 */
    anchor: { type: Object, value: null },
    /* items:[{ key, label, icon? }]。icon 用 cy-icon 的名字(如 'plus')。 */
    items: { type: Array, value: [] },
  },

  data: {
    _render: false,
    panelStyle: '',
  },

  observers: {
    'show, anchor, items': function (show) {
      if (!show) { this.setData({ _render: false }); return; }
      this.place();
    },
  },

  methods: {
    // 先量再开:面板是 fixed 层,位置只能来自实测,不能靠 CSS 相对定位。
    place() {
      const a = this.data.anchor;
      if (!a || typeof a.left !== 'number') {
        // 没锚点不开。别退化成居中 —— 见文件头。
        this.setData({ _render: false });
        return;
      }
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const winW = win.windowWidth || 375;
      const winH = win.windowHeight || 667;
      const pxPerPt = winW / 375;
      const gap = GAP_PT * pxPerPt;
      const edge = EDGE_PT * pxPerPt;

      // 面板高度按内容估:每行 44pt + 上下各 6pt 内边距。估偏一点只影响「翻不翻边」的判定,
      // 不影响最终位置(位置是 top 一个数),所以不必等渲染完再量。
      const rows = (this.data.items || []).length || 1;
      const panelH = (rows * 44 + 12) * pxPerPt;
      const anchorBottom = typeof a.bottom === 'number' ? a.bottom : a.top + (a.height || 0);

      // 超屏翻边:下面放不下就朝上开
      const flipUp = anchorBottom + gap + panelH > winH - edge && a.top - gap - panelH > edge;
      const top = flipUp ? a.top - gap - panelH : anchorBottom + gap;

      // 贴触发点同侧:左对齐锚点。右边超屏才往左收,收到贴右边距为止。
      // 面板宽度由内容定,这里拿不到,用一个保守估值只为判断要不要收 —— 收过头也不会露出屏幕。
      const estW = 200 * pxPerPt;
      const left = Math.max(edge, Math.min(a.left, winW - estW - edge));

      this.setData({
        _render: true,
        panelStyle: `left:${Math.round(left)}px;top:${Math.round(top)}px;`,
      });
    },

    onPick(e) {
      const key = (e.currentTarget.dataset || {}).key;
      this.triggerEvent('close');
      this.triggerEvent('pick', { key });
    },

    onClose() { this.triggerEvent('close'); },
    noop() {},
  },
});
