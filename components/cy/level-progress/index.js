// cy-level-progress · 等级进度(DS §5.6)。单一 status 枚举驱动;卡内只讲下一步,点击进成长详情。
Component({
  properties: {
    variant: { type: String, value: 'card' },   // card | inline
    status: { type: String, value: 'normal' },   // normal | level-up | max | locked | loading
    level: { type: Number, value: 1 },
    identityName: { type: String, value: '' },
    current: { type: Number, value: 0 },
    target: { type: Number, value: 100 },
    nextLevel: { type: Number, value: 0 },
    nextIdentityName: { type: String, value: '' },
    unit: { type: String, value: '探索值' },
    clickable: { type: Boolean, value: true },
  },
  data: { _pct: 0, _remain: 0 },
  observers: {
    'current, target'(cur, tgt) {
      const pct = tgt > 0 ? Math.min(100, Math.round((cur / tgt) * 100)) : 0;
      this.setData({ _pct: pct, _remain: Math.max(0, (tgt || 0) - (cur || 0)) });
    },
  },
  methods: {
    onTap() { const s = this.data.status; if (this.data.clickable && s !== 'locked' && s !== 'loading') this.triggerEvent('tap'); },
  },
});
