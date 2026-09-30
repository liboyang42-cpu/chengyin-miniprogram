// cy-work-item · 商家待办(DS §5.8)。左状态轨+日历贴片;唯一主动作(card CTA / row chevron 互斥)。
Component({
  properties: {
    variant: { type: String, value: 'card' },   // card | row
    status: { type: String, value: 'new' },       // new|due-soon|overdue|done|blocked|loading
    title: { type: String, value: '' },
    taskType: { type: String, value: '' },
    object: { type: String, value: '' },
    deadlineText: { type: String, value: '' },
    actionText: { type: String, value: '' },
    showCalendar: { type: Boolean, value: false },
    dateBadge: { type: Object, value: null },      // { month, day, weekday }
    note: { type: String, value: '' },
  },
  data: { _pv: 'info', _pi: '', _pl: '', _cta: 'primary' },
  observers: {
    status(s) {
      const m = {
        'new': ['info', '', '待处理', 'primary'],
        'due-soon': ['warning', 'clock', '即将截止', 'primary'],
        'overdue': ['danger', 'warning', '已逾期', 'primary'],
        'done': ['success', 'check', '已完成', 'ghost'],
        'blocked': ['neutral', 'lock', '待前置', 'disabled'],
      }[s] || ['info', '', '', 'primary'];
      this.setData({ _pv: m[0], _pi: m[1], _pl: m[2], _cta: m[3] });
    },
  },
  methods: {
    onTap() { const s = this.data.status; if (this.data.variant === 'row' && s !== 'blocked' && s !== 'loading') this.triggerEvent('tap'); },
    onAction() { if (this.data.status !== 'blocked') this.triggerEvent('action'); },
  },
});
