Component({
  properties: {
    cover: { type: String, value: '' },
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    completed: { type: Boolean, value: false },
    remixable: { type: Boolean, value: false },
    nodeTotal: { type: Number, value: 0 },
    postIndex: { type: Number, value: -1 },
  },

  methods: {
    onDetail() {
      this.triggerEvent('detail', { index: this.data.postIndex })
    },

    onRemix() {
      this.triggerEvent('remix', { index: this.data.postIndex })
    },

    onPlay() {
      this.triggerEvent('play', { index: this.data.postIndex })
    },
  },
})
