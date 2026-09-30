// 统一加载骨架屏:首屏 loading 期间占位,避免白屏→突现。
// type:旧档 list/card/detail/amount；新档 feed-card/map-card/merchant-metric/route-timeline/form-section/ticket。
// count: list/card 重复几条(默认 list=4 / card=2,由使用方传)
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

Component({
  options: { multipleSlots: false },
  behaviors: [reducedMotionBehavior],
  properties: {
    type: { type: String, value: 'list' },
    count: { type: Number, value: 4 },
    loadingLabel: { type: String, value: '正在加载内容' },
  },
  observers: {
    count(n) {
      this.setData({ items: Array.from({ length: Math.max(1, n) }) });
    },
  },
  data: { items: [] },
  lifetimes: {
    attached() {
      this.setData({ items: Array.from({ length: Math.max(1, this.data.count) }) });
    },
  },
});
