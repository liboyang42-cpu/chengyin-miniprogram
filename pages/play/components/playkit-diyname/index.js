// cy-playkit-diyname · DIY 作品命名(Figma v5.1,node 47:270)
//
// 输入值不由组件自己持有:name 是要提交进服务端的业务数据,所有权留在页面,
// 组件只负责把 input / 备选点选往上抛。否则弹窗一关值就没了,重开还得再打一遍。
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');
// 2026-08-27 触感:只落在「提交」这一下;输入与点备选是过程,不给手感。
Component({
  behaviors: [reducedMotionBehavior],
  options: { multipleSlots: true },
  properties: {
    show:        { type: Boolean, value: false },
    eyebrow:     { type: String,  value: '你的作品' },
    title:       { type: String,  value: '' },
    photoUrl:    { type: String,  value: '' },
    value:       { type: String,  value: '' },
    suggestions: { type: Array,   value: [] },
    maxLength:   { type: Number,  value: 16 },
    ctaLabel:    { type: String,  value: '提交作品' },
    submitting:  { type: Boolean, value: false },
  },
  methods: {
    onInput(e) {
      this.triggerEvent('namechange', { value: e.detail.value });
    },
    onPickSuggestion(e) {
      const name = e.currentTarget.dataset.name;
      if (!name) return;
      this.triggerEvent('namechange', { value: name });
    },
    onSubmit() {
      if (this.data.submitting || !this.data.value) return;
      // 提交命名 = 这一轮创作定稿。输入与点选备选都不震(那是过程,不是结果)
      motion.haptic({ reducedMotion: this.data.reducedMotion });
      this.triggerEvent('submit', { value: this.data.value });
    },
    onClose() { this.triggerEvent('close'); },
    /* 有草稿时 cy-sheet 只发 requestclose,由页面决定"保存/放弃" —— 组件不替它拿主意 */
    onRequestClose(e) { this.triggerEvent('requestclose', e.detail); },
  },
});
