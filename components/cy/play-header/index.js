Component({
  properties: {
    model: { type: Object, value: null },
    hasExit: { type: Boolean, value: false },
  },
  methods: {
    onAction() {
      this.triggerEvent('action')
    },
  },
})
