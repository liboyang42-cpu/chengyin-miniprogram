const { buildRoadmapModel } = require('../../utils/play-roadmap.js')

Component({
  properties: {
    nodes: { type: Array, value: [] },
    activeNodeId: { type: null, value: null },
    eyebrow: { type: String, value: '' },
    title: { type: String, value: '' },
    reducedMotion: { type: Boolean, value: false },
  },

  data: {
    model: { eyebrow: '', title: '', progressText: '0 / 0 已完成', items: [], pathDelayMs: 0, highlightDelayMs: 0, ctaDelayMs: 0 },
  },

  observers: {
    'nodes,activeNodeId,eyebrow,title': function rebuildRoadmap() {
      this.setData({ model: this.buildModel() })
    },
  },

  lifetimes: {
    attached() {
      this.setData({ model: this.buildModel() })
    },
  },

  methods: {
    buildModel() {
      return buildRoadmapModel({
        nodes: this.data.nodes,
        activeNodeId: this.data.activeNodeId,
        eyebrow: this.data.eyebrow,
        title: this.data.title,
      })
    },
    onContinue() {
      this.triggerEvent('continue')
    },
  },
})
