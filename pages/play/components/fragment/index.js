const reducedMotionBehavior = require('../../../../behaviors/reduced-motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false, observer(v) { if (v) { this.setData({ flip: false, fly: false });
      if (this.data.reducedMotion) this.setData({ flip: true });
      else setTimeout(() => this.setData({ flip: true }), 30); } } },
    text: { type: String, value: '' },
    step: { type: String, value: '' }
  },
  data: { flip: false, fly: false },
  methods: {
    // M10 碎片飞入手记:轻触先播放飞向左下手记 fab 的动画(520ms),落定再通知页面收尾
    onTap() {
      if (this.data.fly) return;
      if (this.data.reducedMotion) {
        this.triggerEvent('done');
        return;
      }
      this.setData({ fly: true });
      setTimeout(() => { this.triggerEvent('done'); this.setData({ fly: false }); }, 520);
    }
  }
});
