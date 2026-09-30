// cy-loading-mask · 全屏阻塞式加载遮罩(替代 wx.showLoading,支付/核销链路专用)
//
// 一页一个实例,id 固定 "cy-loading",由 utils/loading.js 找到它。show() 计数式:嵌套 show 两次要 hide 两次才消失,
// 避免「A 的 hide 把 B 的遮罩提前关掉」——这是原生 showLoading 的老坑。
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  data: { visible: false, entered: false, title: '' },
  lifetimes: { detached() { this._depth = 0; if (this._enterTimer) clearTimeout(this._enterTimer); if (this._exitTimer) clearTimeout(this._exitTimer); } },
  methods: {
    noop() {},   // catchtouchmove 吃掉遮罩下的滚动/点击
    show(options) {
      const opts = options || {};
      this._depth = (this._depth || 0) + 1;
      if (this._exitTimer) { clearTimeout(this._exitTimer); this._exitTimer = null; }
      if (this.data.visible || this.data.reducedMotion) {
        this.setData({ visible: true, entered: true, title: String(opts.title || '加载中') });
        return;
      }
      this.setData({ visible: true, entered: false, title: String(opts.title || '加载中') });
      this._enterTimer = setTimeout(() => { this._enterTimer = null; this.setData({ entered: true }); }, 20);
    },
    hide(force) {
      this._depth = force ? 0 : Math.max(0, (this._depth || 0) - 1);
      if (this._depth !== 0 || !this.data.visible) return;
      if (this._enterTimer) { clearTimeout(this._enterTimer); this._enterTimer = null; }
      if (this.data.reducedMotion) { this.setData({ visible: false, entered: false }); return; }
      this.setData({ entered: false });
      // 140ms = --cy-motion-fast 的 JS 镜像,与 .lm 的 transition 时长一致
      this._exitTimer = setTimeout(() => { this._exitTimer = null; this.setData({ visible: false }); }, 140);
    },
  },
});
