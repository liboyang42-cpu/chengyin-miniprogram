// cy-metric · 仪表盘指标(DS §5.7)。必带时间范围;禁裸显0;趋势不默认红(trendTone 决定)。
Component({
  properties: {
    variant: { type: String, value: 'single' },   // single | triple | trend
    status: { type: String, value: 'normal' },      // normal | warning | critical | empty | loading
    label: { type: String, value: '' },
    value: { type: String, value: '' },
    unit: { type: String, value: '' },
    timeRange: { type: String, value: '' },
    trend: { type: Object, value: null },           // { delta, compareText }
    trendTone: { type: String, value: 'neutral' },   // up-good | down-good | neutral
    action: { type: String, value: '' },
    metrics: { type: Array, value: [] },             // triple: [{label,value,unit}]
    emptyHint: { type: String, value: '' },
    emptyAction: { type: String, value: '' },
  },
  methods: {
    onAction() { this.triggerEvent('action'); },
  },
});
