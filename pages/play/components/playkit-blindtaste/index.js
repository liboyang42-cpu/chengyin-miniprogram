const { stepIcons, stepsA11yLabel } = require('../../utils/playkit-steps.js');
const motion = require('../../../../utils/motion.js');
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
// cy-playkit-blindtaste · 盲品挑战(Figma v5.1,node 46:259)
//
// 稿上没有提交按钮:点中哪一项就是作答。所以这里只发 answer,不本地判对错 ——
// 对错是服务端的事,前端自己判就等于把答案发到客户端。
Component({
  behaviors: [reducedMotionBehavior],
  data: {
    stepIcons: stepIcons('blindtaste'),
  },
  properties: {
    show:     { type: Boolean, value: false },
    eyebrow:  { type: String,  value: '闭眼味觉师 · 盲品' },
    title:    { type: String,  value: '' },
    // 整句步骤说明不再显示在界面上(图标行替代了它),但它是图标行的**读屏文案** ——
    // 丢掉就是让图形化的代价由读屏用户承担。默认值兜底,服务端没配也听得到。
    steps:    { type: String,  value: stepsA11yLabel('blindtaste') },
    // [{ key: 'A', label: '桂花乌龙' }, ...]
    options:  { type: Array,   value: [] },
    hint:     { type: String,  value: '🐱 猫向导:别偷看,舌头比眼睛诚实' },
    xpLabel:  { type: String,  value: '' },
    // 已作答的项;由页面在服务端回执后回填,组件不自己记(刷新后不能装作答过)
    selectedKey: { type: String, value: '' },
    locked:   { type: Boolean, value: false },
  },
  methods: {
    onPick(e) {
      if (this.data.locked || this.data.selectedKey) return;
      const key = e.currentTarget.dataset.key;
      if (!key) return;
      // 作答不可撤销(选中即提交,稿上没有提交按钮)→ medium。
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('answer', { key });
    },
    onClose() { this.triggerEvent('close'); },
  },
});
