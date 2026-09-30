// cy-playkit-note · 留言(契约 §2.4)
//
// 写一句留给后来的人。审核本轮只做长度 + 预设短句两道(机审不接),
// 组件这边只保证:不超过 maxLength、空句不发、留过之后不再发第二遍。
// ★ 存哪儿是服务端的事(优先复用 dailySign 那套跨玩家存储),客户端不挑存储。
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    prompt: { type: String, value: '' },
    maxLength: { type: Number, value: 40 },
    presets: { type: Array, value: [] },
    previous: { type: Array, value: [] },     // 前几条:{ text, at }
    mine: { type: String, value: '' },
    done: { type: Boolean, value: false },
  },
  data: {
    text: '',
    countLabel: '',
    canSubmit: false,
  },
  observers: {
    'show, done, mine, maxLength': function (show, done, mine, maxLength) {
      if (!show) return;
      const text = done ? String(mine || '') : '';
      this.setData({
        text,
        countLabel: text.length + '/' + (Number(maxLength) || 0),
        canSubmit: !done && !!text.trim(),
      });
    },
  },
  methods: {
    onInput(e) {
      if (this.data.done) return;
      const text = e.detail.value == null ? '' : String(e.detail.value);
      this.setData({
        text,
        countLabel: text.length + '/' + (Number(this.data.maxLength) || 0),
        canSubmit: !!text.trim(),
      });
    },
    onPickPreset(e) {
      if (this.data.done) return;
      const text = String(e.currentTarget.dataset.text || '');
      this.setData({
        text,
        countLabel: text.length + '/' + (Number(this.data.maxLength) || 0),
        canSubmit: !!text.trim(),
      });
    },
    onSubmit() {
      if (this.data.done || !this.data.canSubmit) return;
      // 留言提交不可撤销 —— 与作答同一档触感
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('submit', { text: this.data.text });
    },
    onClose() { this.triggerEvent('close'); },
  },
});
