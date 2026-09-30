const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');
const exitMotion = require('../../../behaviors/exit-motion.js');

Component({
  options: { multipleSlots: true },
  behaviors: [reducedMotionBehavior, exitMotion(140)],
  properties: {
    show:        { type: Boolean, value: false },
    title:       { type: String,  value: '' },
    content:     { type: String,  value: '' },   // 纯文本正文;富内容用 slot
    confirmText: { type: String,  value: '确定' },
    cancelText:  { type: String,  value: '取消' },
    danger:      { type: Boolean, value: false }, // 危险动作:确认键红实心
    showCancel:  { type: Boolean, value: true },
    maskClosable:{ type: Boolean, value: false }, // 确认弹窗默认不点遮罩关闭
    // 以下为危险确认三段式新增。默认全空,不传时渲染结果与改动前逐像素一致。
    consequences:{ type: Array,   value: [] },    // [{icon,text}] 后果清单
    altText:     { type: String,  value: '' },    // 更轻替代方案按钮文案
    altHint:     { type: String,  value: '' },    // 替代方案文字链下的一句解释
    loading:     { type: Boolean, value: false }, // 执行中:确认键内转圈并锁全部按钮
    // T2 居中确认(Brand Handbook 弹层四型):311rpx 窄卡 + bg-interactive 底 + 左对齐文案。
    // 默认 false 时渲染结果与改动前逐像素一致,不影响现有 13 个调用点。
    compact:     { type: Boolean, value: false },
  },
  methods: {
    // 两道锁分开写:_closing 是退场期间拒绝重复触发(sheet-modal-exit-motion-contract 逐字断言这一行),
    // loading 是请求在途期间拒绝重复提交 —— 危险动作点两次会发两次删除请求。
    onConfirm() {
      if (this.data._closing) return;
      if (this.data.loading) return;
      this.triggerEvent('confirm');
    },
    onCancel() {
      if (this.data._closing) return;
      if (this.data.loading) return;
      this.triggerEvent('cancel');
    },
    // 右上角 ✕ 复用「取消」这条出口:关闭 = 放弃这次弹窗,永远不等于按下确认键。
    onClose() { this.onCancel(); },
    onAlt() {
      if (this.data._closing) return;
      if (this.data.loading) return;
      this.triggerEvent('alt');
    },
    onMask() {
      if (this.data._closing) return;
      if (this.data.loading) return;
      if (this.data.maskClosable) this.triggerEvent('cancel');
    },
  },
});
