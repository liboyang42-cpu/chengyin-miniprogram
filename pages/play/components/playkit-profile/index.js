// cy-playkit-profile · 出生登记(契约 §2.1)
//
// 一段 1–8 个问题的档案表:text 输入 / pick 点选,可选头像。
// ★ options[].effects 服务端不下发(契约 §2.1)—— 数值加成是暗的,组件也不许自己算:
//   这里只收「玩家填了什么」,effects 由服务端落到它自己的 state 变量上。
// ★ 提交一次即锁档(服务端 done 后拒绝改档),组件看到的 done 就是服务端的权威值。
const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');
const motion = require('../../../../utils/motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '' },
    lead: { type: String, value: '' },
    // { enabled, required }:头像位开不开、必不必填
    avatar: { type: Object, value: {} },
    questions: { type: Array, value: [] },
    answers: { type: Object, value: {} },
    avatarUrl: { type: String, value: '' },
    done: { type: Boolean, value: false },
  },
  data: {
    form: {},
    avatarEnabled: false,
    avatarRequired: false,
    ctaDisabled: true,
    ctaLabel: '提交登记',
  },
  observers: {
    'show, questions, answers, done': function (show, questions, answers, done) {
      if (!show) return;
      const form = {};
      (questions || []).forEach((q) => {
        if (!q || !q.key) return;
        const v = answers && answers[q.key];
        form[q.key] = v == null ? '' : String(v);
      });
      const avatar = this.data.avatar || {};
      this.setData({
        form,
        avatarEnabled: !!avatar.enabled,
        avatarRequired: !!avatar.required,
        ctaLabel: done ? '已登记' : '提交登记',
      }, () => this._syncCta());
    },
  },
  methods: {
    /** 必填项都填了才放开提交。required 是作者的显式声明,组件不替它猜默认值。 */
    _syncCta() {
      const done = this.data.done;
      const missing = (this.data.questions || []).some((q) => q && q.required
        && !String(this.data.form[q.key] || '').trim());
      this.setData({ ctaDisabled: done || missing });
    },

    onInput(e) {
      const key = e.currentTarget.dataset.key;
      if (!key || this.data.done) return;
      const form = Object.assign({}, this.data.form);
      form[key] = e.detail.value == null ? '' : String(e.detail.value);
      this.setData({ form }, () => this._syncCta());
    },

    onPick(e) {
      if (this.data.done) return;
      const key = e.currentTarget.dataset.key;
      const value = e.currentTarget.dataset.opt;
      if (!key) return;
      const form = Object.assign({}, this.data.form);
      form[key] = String(value == null ? '' : value);
      this.setData({ form }, () => this._syncCta());
    },

    /** 头像只是**选一张**:上传是两步走,页面传完把地址写回 avatarUrl 属性 */
    onAvatar() {
      if (this.data.done) return;
      wx.chooseMedia({
        count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
        success: (res) => {
          const file = (res && res.tempFiles && res.tempFiles[0]) || {};
          if (!file.tempFilePath) return;
          this.triggerEvent('avatar', { tempFilePath: file.tempFilePath, size: file.size });
        },
        fail: () => {},
      });
    },

    /** 提交只报原始输入,加成与落档都在服务端 */
    onSubmit() {
      if (this.data.done || this.data.ctaDisabled) return;
      // 档案提交不可撤销 —— 与作答同一档触感
      motion.haptic({ reducedMotion: this.data.reducedMotion, type: 'medium' });
      this.triggerEvent('submit', {
        answers: Object.assign({}, this.data.form),
        avatarUrl: this.data.avatarUrl || '',
      });
    },

    onClose() { this.triggerEvent('close'); },
  },
});
