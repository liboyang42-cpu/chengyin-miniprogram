const { stepIcons, stepsA11yLabel } = require('../../utils/playkit-steps.js');
// cy-playkit-steps · 计步挑战(Figma v5.1,node 48:270)
//
// 步数来源是微信运动(wx.getWeRunData),取数与解密归页面/服务端;组件只负责画。
// 「刷新步数」发事件而不是自己拉:授权弹窗要挂在页面的用户手势上下文里。

/** 纯函数:整数 → 千分位。稿里 4,286 / 6,000 都带逗号,读起来才像步数不像编号。 */
function groupThousands(value) {
  const n = value > 0 ? Math.floor(value) : 0;
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 纯函数:已走/目标 → 百分比(封顶 100,超额不画成两圈) */
function stepPercent(steps, goal) {
  if (!(goal > 0)) return 0;
  const s = steps > 0 ? steps : 0;
  return Math.min(100, Math.round((s / goal) * 100));
}

const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

// 2026-08-27 触感:这一壳里「做成了一件事」不是点刷新,是**步数达标**。
// 所以手感落在 percent 从 <100 跨到 100 的那一刻,而不是刷新按钮上 ——
// 刷新只是去取数,取回来还是没达标的话震一下就是骗人。
Component({
  behaviors: [reducedMotionBehavior],
  options: { multipleSlots: true },
  properties: {
    show:       { type: Boolean, value: false },
    eyebrow:    { type: String,  value: '低碳行动 · 今日步数' },
    // 图标行的读屏文案。⚠️ 刻意不叫 stepsLabel:本组件 data 里已有同名字段(千分位步数),
    // 撞名会让读屏器念出「4,286」而不是步骤说明 —— 比没有 aria-label 更糟。
    stepsA11y: { type: String, value: stepsA11yLabel('steps') },
    steps:      { type: Number,  value: 0 },
    goal:       { type: Number,  value: 0 },
    co2Label:   { type: String,  value: '' },
    remainLabel:{ type: String,  value: '' },
    refreshing: { type: Boolean, value: false },
  },
  data: {
    stepIcons: stepIcons('steps'),

    percent: 0,
    stepsLabel: '0',
    goalLabel: '0',
  },
  observers: {
    'steps, goal': function (steps, goal) {
      const percent = stepPercent(steps, goal);
      // ⚠️ 只在「从没达标 → 达标」这条边上震一次:
      //   · 首次落数据不震(_reachedGoal 还是 undefined,打开时已达标不该凭空震一下);
      //   · 已达标之后再刷新也不震(percent 一直是 100,不是新发生的事)。
      if (this._reachedGoal !== undefined && !this._reachedGoal && percent >= 100) {
        motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      }
      this._reachedGoal = percent >= 100;
      this.setData({
        percent: percent,
        stepsLabel: groupThousands(steps),
        goalLabel: groupThousands(goal),
      });
    },
  },
  methods: {
    _groupThousands: groupThousands,   // 纯算法出口,供单测
    _stepPercent: stepPercent,

    onRefresh() {
      if (this.data.refreshing) return;
      this.triggerEvent('refresh');
    },
    onClose() { this.triggerEvent('close'); },
  },
});
