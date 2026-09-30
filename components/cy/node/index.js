const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    state: { type: String, value: 'idle' }, // idle | active | done | selected
    pulse: { type: Boolean, value: true },   // active 态是否慢脉冲
  },
});
