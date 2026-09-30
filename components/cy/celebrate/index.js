const COLORS = [
  'var(--cy-color-play-accent)',
  'var(--cy-color-play-accent)',
  'var(--cy-color-text-secondary)',
  'var(--cy-color-play-accent)',
  'var(--cy-color-text-tertiary)',
];
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

// 从 play/roam 既有的逐片数据驱动彩旗收口而来；eventKey 变化即换 key 重播，
// 不靠 JS 计时器清场，单轮时长只由 WXSS 的 --cy-motion-celebrate 决定。
function buildPieces(eventKey) {
  return Array.from({ length: 44 }, (_, index) => ({
    id: eventKey + ':' + index,
    left: Math.round(Math.random() * 100),
    color: COLORS[index % COLORS.length],
    /* 每片自己的起跳时刻。全部同时开始的话,四十四片会连成横穿屏幕的一条线往下掉 ——
       硬币落面那一下看起来就是「屏幕上划过一条虚线」,而不是撒了一把彩片。
       延时只能写在行内:组件 WXSS 不支持 :nth-child。 */
    delay: Math.round(Math.random() * 620),
  }));
}

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    eventKey: {
      type: String,
      value: '',
      observer(eventKey) {
        if (!eventKey || this.data.reducedMotion) {
          this.setData({ pieces: [] });
          return;
        }
        this.setData({ pieces: buildPieces(eventKey) });
      },
    },
  },
  data: { pieces: [] },
  observers: {
    reducedMotion(reducedMotion) {
      if (reducedMotion) this.setData({ pieces: [] });
    },
  },
});
