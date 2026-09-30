// cy-points · 数值/积分/资产(DS §5.5)。kind 驱动符号,state 三通道(色+符号+图标),必带来源。
function fmt(n, precision) {
  n = Number(n) || 0;                                        // 归一:挡字符串/NaN/浮点毛刺
  const neg = n < 0;
  const parts = Math.abs(n).toFixed(precision).split('.');   // precision 由 kind 驱动:cash=2 / points·exp=0
  const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + int + (parts[1] ? '.' + parts[1] : '');
}
Component({
  properties: {
    kind: { type: String, value: 'points' },  // points | cash | exp
    size: { type: String, value: 'card' },     // inline | card | hero
    state: { type: String, value: 'static' },  // static | earned | spent | pending
    value: { type: Number, value: 0 },
    unit: { type: String, value: '' },
    source: { type: String, value: '' },
    delta: { type: Number, value: 0 },
    statusLabel: { type: String, value: '' },
    subline: { type: String, value: '' },
    loading: { type: Boolean, value: false },
    tappable: { type: Boolean, value: false },
  },
  data: { _val: '0', _unit: '', _prefix: '', _delta: '' },
  observers: {
    'kind, value, unit, delta, state, statusLabel'(kind, value, unit, delta, state, statusLabel) {
      const cfg = {
        points: { unit: '积分', prefix: '', precision: 0 },
        cash: { unit: '元', prefix: '¥', precision: 2 },
        exp: { unit: 'EXP', prefix: '', precision: 0 },
      };
      const c = cfg[kind] || cfg.points;
      let d = '';
      if (state === 'earned') d = '+' + fmt(Math.abs(delta), c.precision);
      else if (state === 'spent') d = '−' + fmt(Math.abs(delta), c.precision);
      else if (state === 'pending') d = statusLabel || '待入账';
      this.setData({ _val: fmt(value, c.precision), _unit: unit || c.unit, _prefix: c.prefix, _delta: d });
    },
  },
  methods: {
    onTap() { if (this.data.tappable) this.triggerEvent('tap'); },
  },
});
