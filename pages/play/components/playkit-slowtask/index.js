// cy-playkit-slowtask · 跨日慢任务(Figma「🌙 低压游戏循环 UX」)
//
// 三态由服务端的 started / claimed / daysLeft 决定,组件自己不推算日期 ——
// 客户端算"隔天"就等于改手机日期即可提前解锁(判定在服务端,见 claimSlowTask)。
const motion = require('../../../../utils/motion.js');
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
Component({
  behaviors: [reducedMotionBehavior],
  options: { multipleSlots: true },
  properties: {
    show:        { type: Boolean, value: false },
    eyebrow:     { type: String,  value: '慢一点 · 跨日任务' },
    title:       { type: String,  value: '' },
    startHint:   { type: String,  value: '现在开个头,剩下的交给时间。' },
    startLabel:  { type: String,  value: '就这么定了' },
    waitHint:    { type: String,  value: '' },
    waitCta:     { type: String,  value: '明天再来' },
    unlockLabel: { type: String,  value: '看看留下了什么' },
    unlockText:  { type: String,  value: '' },
    started:     { type: Boolean, value: false },
    claimed:     { type: Boolean, value: false },
    daysLeft:    { type: Number,  value: 0 },
  },
  methods: {
    onStart() { this.triggerEvent('start'); },
    onClaim() {
      // 跨日等待的兑现点,领了就没了 → medium。开头那下(onStart)只是定意图,不震。
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('claim');
    },
    onClose() { this.triggerEvent('close'); },
  },
});
