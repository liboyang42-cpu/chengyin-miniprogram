const { readReducedMotion } = require('../utils/motion-preference.js')

module.exports = Behavior({
  properties: {
    reducedMotion: { type: Boolean, value: false },
  },
  lifetimes: {
    attached() {
      this._syncReducedMotionPreference()
    },
  },
  pageLifetimes: {
    show() {
      this._syncReducedMotionPreference()
    },
  },
  methods: {
    _syncReducedMotionPreference() {
      const reducedMotion = readReducedMotion()
      if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion })
    },
  },
})
