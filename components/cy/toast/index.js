// cy-toast · 轻提示(替代 wx.showToast,2026-09-06 三端审核「原生弹层全删」批次)
//
// 一页一个实例,id 固定 "cy-toast",由 utils/toast.js 通过 getCurrentPages() 栈顶页 selectComponent 找到它。
// 只做四件事:排队、限时、跟主题走色、给读屏报 alert。不做交互(要用户点的就不是 toast,该用 cy-modal/cy-inline-error)。
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

const DEFAULT_MS = 2000;
const MAX_MS = 6000;

Component({
  behaviors: [reducedMotionBehavior],
  data: {
    visible: false,
    entered: false,   // 挂上后下一拍置 true,让 transition 有起点
    title: '',
    kind: 'info',       // info | success | error
    glyph: '',
  },
  lifetimes: {
    detached() { this._clearTimers(); },
  },
  methods: {
    // show({ title, kind, duration }) —— 同一实例连续 show 时直接换文案并重置计时,不排队叠层
    show(options) {
      const opts = options || {};
      const title = String(opts.title == null ? '' : opts.title).trim();
      if (!title) return;
      const kind = opts.kind === 'success' || opts.kind === 'error' ? opts.kind : 'info';
      const duration = Math.min(MAX_MS, Math.max(800, Number(opts.duration) || DEFAULT_MS));
      this._clearTimers();
      const glyph = kind === 'success' ? 'check' : (kind === 'error' ? 'warning' : '');
      if (this.data.visible || this.data.reducedMotion) {
        this.setData({ visible: true, entered: true, title, kind, glyph });
      } else {
        this.setData({ visible: true, entered: false, title, kind, glyph });
        this._enterTimer = setTimeout(() => { this._enterTimer = null; this.setData({ entered: true }); }, 20);
      }
      this._hideTimer = setTimeout(() => this.hide(), duration);
    },
    hide() {
      this._clearTimers();
      if (!this.data.visible) return;
      if (this.data.reducedMotion) { this.setData({ visible: false, entered: false }); return; }
      this.setData({ entered: false });
      // 220ms = --cy-motion-standard 的 JS 镜像(WXSS 变量 JS 读不到),与 .ct 的 transition 时长一致
      this._exitTimer = setTimeout(() => { this._exitTimer = null; this.setData({ visible: false }); }, 220);
    },
    _clearTimers() {
      if (this._enterTimer) { clearTimeout(this._enterTimer); this._enterTimer = null; }
      if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
      if (this._exitTimer) { clearTimeout(this._exitTimer); this._exitTimer = null; }
    },
  },
});
