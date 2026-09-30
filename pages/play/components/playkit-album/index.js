Component({
  properties: {
    show: { type: Boolean, value: false, observer(value) {
      if (value) this.setData({ cur: 0 });
    } },
    title: { type: String, value: '相册' },
    images: { type: Array, value: [] },
  },
  data: { cur: 0 },
  methods: {
    onChange(e) { this.setData({ cur: Number(e.detail.cur) || 0 }); },
    close() { this.triggerEvent('close'); },
  },
});
