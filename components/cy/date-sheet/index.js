// cy-date-sheet · 时间/日期选择面板(标题 + 右上角 ✕ · 滚轮 slot · 底部完成)
//
// 2026-09-24 CU-M-149:头部改成和 cy-sheet 同构(左标题、右上 ✕),「完成」下到底部独立确认位。
//   原来的「取消 / 标题 / 完成」三栏顶栏是全仓唯一一处不用右上 ✕ 的弹层头部。
//   左上「取消」按 2026-09-19 用户裁决退役 —— 退出口只留右上角 ✕;
//   bind:cancel 这条事件不动,✕ 与点遮罩共用它,11 处调用方零改动。
//
// 2026-08-25 补齐三件本该有的东西 —— 全仓 11 处时间选择器一次到位,调用方不用改:
//   ① 遮罩:原来只有一张贴在屏幕底部的 fixed 面板,上半屏 ~40% 完全裸露且可点。
//      用户在选时间时能点到背后的表单字段、甚至点走整页,而选择器还开着。
//   ② 点遮罩关闭:全仓其它弹层(cy-sheet)都支持,唯独时间选择器不支持,交互模型不一致。
//   ③ 进出场动画:原来是 display:none → block,面板瞬间闪现。display 不可过渡。
// 做法与 cy-sheet 完全一致(exitMotion + reduced-motion),不另造一套。
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');
const exitMotion = require('../../../behaviors/exit-motion.js');

Component({
  behaviors: [reducedMotionBehavior, exitMotion(220)],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择时间' },
    confirmText: { type: String, value: '完成' },
    dark: { type: Boolean, value: false },
    // 点遮罩关闭。默认可关(与 cy-sheet 一致);正在提交等场景可由调用方关掉。
    maskClosable: { type: Boolean, value: true },
  },
  methods: {
    onCancel() { if (this.data._closing) return; this.triggerEvent('cancel'); },
    onConfirm() { if (this.data._closing) return; this.triggerEvent('confirm'); },
    // 点遮罩 = 取消,不是确认:半截的滚轮值不该被当成用户的选择落下去。
    onMask() {
      if (this.data._closing || !this.data.maskClosable) return;
      this.triggerEvent('cancel');
    },
    noop() {},
  },
});
