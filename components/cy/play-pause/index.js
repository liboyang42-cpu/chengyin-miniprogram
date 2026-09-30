const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js')

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    model: { type: Object, value: null },
    modeLabel: { type: String, value: '城市探索' },
  },
  methods: {
    onResume() {
      this.triggerEvent('resume')
    },
  },
})
