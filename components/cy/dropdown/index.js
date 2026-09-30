// cy-dropdown · 行内下拉选择(2026-08-25 新建)
//
// 为什么要有它:全仓 32 处 <picker range=...> 都是「≤7 项的枚举单选」——角色、维度、
// 超时结果、排行榜口径、票种模式…… 微信原生 picker 点下去弹的是**整屏底部滚轮**,
// 对这种量级的选项太重,而且它是系统层,视觉完全不受设计系统控制(字体/圆角/深浅色都管不着)。
//
// 判据(与 cy-date-sheet 分工):
//   ≤7 项互斥单选、选中即生效、不需要二次确认  → cy-dropdown(就地展开)
//   连续量(时/分/日期)、多列联动、要「取消/完成」两段式 → cy-date-sheet(底部面板)
//
// ⚠️ API 与原生 <picker> 逐字兼容(range / range-key / value / bind:change 里 detail.value 是
// 下标),迁移时只改标签名与 bindchange→bind:change,调用方的 JS 处理器一行都不用动。
//
// ⚠️ 面板用 position:fixed + 实测锚点坐标,不用 absolute:调用方常常把 picker 放在
// overflow:hidden 的卡片或 scroll-view 里,absolute 面板会被裁掉半截。
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');
const exitMotion = require('../../../behaviors/exit-motion.js');

// 面板每项高度(rpx)与最大可见项数。露出半项是给用户「还能往下滚」的暗示。
const ITEM_H_RPX = 88;
const MAX_VISIBLE = 5.5;

Component({
  options: { multipleSlots: true, addGlobalClass: true },
  behaviors: [reducedMotionBehavior, exitMotion(140)],
  properties: {
    merchant: {type:Boolean, value:false},
    customPanel: {type:Boolean, value:false},
    portal: {type:Boolean, value:true},
    panelHeight: {type:Number, value:260},
    below: {type:Boolean, value:false},
    gap: {type:Number, value:6},
    panelWidth: {type:Number, value:0},
    measureDelay: {type:Number, value:0},
    range: { type: Array, value: [] },
    rangeKey: { type: String, value: '' },
    value: { type: Number, value: 0 },
    disabled: { type: Boolean, value: false },
  },
  data: {
    // show 由 exitMotion 的 observer 盯着,驱动 _render/_closing;wxml 里也真消费它
    // (展开时给触发器 open 态),不是死数据字段。
    show: false,
    labels: [],
    panelStyle: '',
    dropUp: false,
  },
  observers: {
    'range, rangeKey': function (range, rangeKey) {
      var list = range || [];
      this.setData({
        labels: list.map(function (item) {
          if (item === null || item === undefined) return '';
          if (typeof item === 'object') return String(rangeKey ? item[rangeKey] : (item.name || item.label || ''));
          return String(item);
        }),
      });
    },
  },
  lifetimes: {
    detached: function () {
      clearTimeout(this._openTimer);
      this._openEpoch = (this._openEpoch || 0) + 1;
    },
  },
  methods: {
    onTrigger: function () {
      if (this.data.disabled || this.data._closing) return;
      if (this.data.show) { this.close(); return; }
      if (!this.data.customPanel && !this.data.labels.length) return;
      if (this._openTimer) return;
      if (this.data.measureDelay) {
        this.triggerEvent('beforeopen');
        this._openTimer = setTimeout(() => {
          this._openTimer = null;
          if (!this.data.disabled) this.openAtAnchor();
        }, this.data.measureDelay);
      } else this.openAtAnchor();
    },

    // 先量锚点再开:面板是 fixed 层,位置只能来自实测,不能靠 CSS 相对定位。
    openAtAnchor: function () {
      if (!this.data.customPanel && !this.data.labels.length) return;
      var that = this;
      var epoch = this._openEpoch = (this._openEpoch || 0) + 1;
      var query = this.createSelectorQuery();
      query.select('.cdd__trigger').boundingClientRect();
      query.selectViewport().scrollOffset();
      query.exec(function (res) {
        if (epoch !== that._openEpoch || that.data.disabled) return;
        var rect = res && res[0];
        if (!rect) return;
        var win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        var winH = win.windowHeight || 667;
        var pxPerRpx = (win.windowWidth || 375) / 750;
        var panelH = that.data.customPanel ? that.data.panelHeight : Math.min(that.data.labels.length, MAX_VISIBLE) * ITEM_H_RPX * pxPerRpx + 16;
        // 下方放不下就朝上开 —— 否则面板会被挤出屏幕底部。
        var dropUp = !that.data.below && rect.bottom + panelH > winH - 12 && rect.top - panelH > 12;
        var top = dropUp ? rect.top - panelH - that.data.gap : rect.bottom + that.data.gap;
        panelH = Math.max(44, Math.min(panelH, winH - top - 16));
        if (that.data.customPanel) that.triggerEvent('open');
        var width = that.data.panelWidth || rect.width;
        var left = Math.max(12, rect.right - width);
        that.setData({
          show: true,
          dropUp: dropUp,
          panelStyle: 'left:' + left + 'px;top:' + top + 'px;width:' + width + 'px;max-height:' + panelH + 'px;--cdd-scroll-height:' + (panelH - 8) + 'px;',
        });
      });
    },

    close: function () {
      clearTimeout(this._openTimer);
      this._openTimer = null;
      this._openEpoch = (this._openEpoch || 0) + 1;
      this.setData({ show: false });
      if (this.data.customPanel) this.triggerEvent('close');
    },

    onPick: function (e) {
      if (this.data._closing) return;
      var index = Number(e.currentTarget.dataset.index);
      this.close();
      // 与原生 picker 一致:detail.value 是下标,不是值本身。
      this.triggerEvent('change', { value: index });
    },

    onMask: function () { this.close(); },
    noop: function () {},
  },
});
