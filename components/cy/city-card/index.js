// cy-city-card · 城市/街区探索卡(DS §5.4)。cover 必真实地点;状态三通道;紫仅进度、通关转绿。
Component({
  properties: {
    variant: { type: String, value: 'explore' }, // explore | theme
    size: { type: String, value: 'default' },      // default | hero | compact
    status: { type: String, value: 'active' },      // new | active | completed | coming-soon
    cover: { type: String, value: '' },
    cityName: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    unlockedCount: { type: Number, value: 0 },
    totalCount: { type: Number, value: 0 },
    nextTitle: { type: String, value: '' },
    nextHint: { type: String, value: '' },
  },
  data: { _pct: 0, _sLabel: '', _sIcon: '' },
  observers: {
    'unlockedCount, totalCount'(u, t) { this.setData({ _pct: t > 0 ? Math.min(100, Math.round((u / t) * 100)) : 0 }); },
    status(s) {
      const c = {
        'new': ['新开放', 'star'],
        'active': ['探索中', 'gps'],
        'completed': ['已通关', 'check'],
        'coming-soon': ['敬请期待', 'lock'],
      }[s] || ['', ''];
      this.setData({ _sLabel: c[0], _sIcon: c[1] });
    },
  },
  methods: {
    onTap() { if (this.data.status !== 'coming-soon') this.triggerEvent('tap'); },
  },
});
