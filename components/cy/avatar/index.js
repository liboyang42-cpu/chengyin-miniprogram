// cy-avatar · 头像(DS §3.5)。数据回退 image→initial→placeholder;角标单槽 verified>online。
Component({
  properties: {
    size: { type: null, value: 88 },        // xs/sm/md/lg/xl 或数字 rpx
    src: { type: String, value: '' },
    name: { type: String, value: '' },
    clickable: { type: Boolean, value: false },
    bordered: { type: Boolean, value: false },
    shape: { type: String, value: 'circle' },   // circle(人) | rounded(门店/品牌位)
    online: { type: Boolean, value: false },
    verified: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
  },
  data: { _size: 88, _mode: 'placeholder', _initial: '' },
  observers: {
    size(s) {
      const map = { xs: 48, sm: 64, md: 88, lg: 120, xl: 160 };
      let v = map[s];
      if (v === undefined) {
        v = Number(s);
        if (!v) { console.warn('[cy-avatar] 非法 size，回退 88'); v = 88; }
      }
      this.setData({ _size: v });
    },
    'src, name'(src, name) {
      const mode = src ? 'image' : (name ? 'initial' : 'placeholder');
      this.setData({ _mode: mode, _initial: name ? name.trim().charAt(0).toUpperCase() : '' });
    },
  },
  methods: {
    onTap() { if (!this.data.disabled && this.data.clickable) this.triggerEvent('tap'); },
  },
});
