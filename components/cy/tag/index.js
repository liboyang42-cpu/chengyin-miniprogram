Component({
  properties: {
    variant: { type: String, value: 'mono' }, // green | blue | red | done | mono | warning | rare
    dot: { type: Boolean, value: false },
    selected: { type: Boolean, value: false },
    icon: { type: String, value: '' }, // 覆盖默认 glyph;空串走 variant 映射;none 强制不画
  },
  data: { _icon: '' },
  observers: {
    'variant, icon': function (variant, icon) {
      if (icon === 'none') {
        this.setData({ _icon: '' });
        return;
      }
      if (icon) {
        this.setData({ _icon: icon });
        return;
      }
      const map = {
        green: 'check',
        blue: 'info',
        red: 'warning',
        warning: 'clock',
        done: 'close-sm',
        rare: 'star',
        mono: '',
      };
      this.setData({ _icon: map[variant] || '' });
    },
  },
});
