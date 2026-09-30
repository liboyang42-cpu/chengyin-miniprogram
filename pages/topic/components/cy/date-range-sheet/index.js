// cy-date-range-sheet · 日期区间选择半屏(2026-08-26 新建)
//
// 参考 Date Range Picker by @jeetnirnejak(见 04-未开始/日期与区间选择_组件统一方案_20260826.md)。
// 抄的是信息架构不是配色:
//   ① 汇总徽章「共 N 天」—— 全仓原来没有任何一处显示区间跨度,用户得自己心算
//   ② 双栏摘要 —— 两头的值同时在场,并指出现在该点哪一头。原来两头是两个独立弹窗,
//      选第二个的时候根本看不到第一个选了什么
//   ③ 快捷芯片 —— 本周末 / 未来 7 天 / 本月,覆盖大部分实际意图
//
// 组件不落库、不改调用方的业务态:确定时把 [start, end] 原样抛出去,取消什么也不抛。
const cal = require('../../../../../utils/calendar.js')
const reducedMotionBehavior = require('../../../../../behaviors/reduced-motion.js')

const DEFAULT_QUICK = [
  { kind: 'weekend', label: '本周末' },
  { kind: 'next7', label: '未来 7 天' },
  { kind: 'month', label: '本月' },
]

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择日期' },
    // ['YYYY-MM-DD', 'YYYY-MM-DD'];调用方的已选值,打开时载入
    value: { type: Array, value: [] },
    min: { type: String, value: '' },
    max: { type: String, value: '' },
    months: { type: Number, value: 6 },
    disabledDates: { type: Array, value: [] },
    marks: { type: Object, value: {} },
    allowSameDay: { type: Boolean, value: false },
    maxRange: { type: Number, value: 0 },
    // 汇总徽章的量词:'day' 共 N 天(含首尾) | 'night' 共 N 晚(不含尾日)
    unit: { type: String, value: 'day' },
    quickPicks: { type: Array, value: DEFAULT_QUICK },
  },
  data: {
    // 草稿值。⚠️ 不直接改 properties.value —— 用户点了取消就该原样退回,
    // 半截的选择不能倒灌回调用方
    _value: [],
    _startText: '',
    _endText: '',
    _span: 0,
    _phase: 'start',
    _overTitle: '',
    _overSub: '',
  },
  observers: {
    'show, value': function (show) {
      if (!show) return
      // 每次打开都从调用方的值重新起草,不留上一次的残留
      this._apply((this.data.value || []).slice(0, 2))
    },
  },
  methods: {
    _fmt(date) {
      const p = cal.parse(date)
      if (!p) return ''
      const nowYear = new Date().getFullYear()
      const short = p.month + ' 月 ' + p.day + ' 日'
      return p.year === nowYear ? short : p.year + ' 年 ' + short
    },

    _apply(next) {
      const start = next && next[0]
      const end = next && next[1]
      // 天:含首尾(9/4→9/25 是 22 天);晚:不含尾日(21 晚,即参考图那个数)
      const span = start && end
        ? cal.daysBetween(start, end) + (this.data.unit === 'night' ? 0 : 1)
        : 0
      this.setData({
        _value: [start || null, end || null],
        _startText: this._fmt(start),
        _endText: this._fmt(end),
        _span: span > 0 ? span : 0,
        _phase: !start || end ? 'start' : 'end',
        // 值一落地,上一轮的越界提示就过期了(再挂着会变成「有错」的假象)
        _overTitle: '',
        _overSub: '',
      })
    },

    onCalChange(e) {
      this._apply(e.detail.value)
    },

    // 越界不落值:不静默改用户的输入(那是「替用户断定」)。但**光有事件不够** ——
    // 全仓没有任何宿主监听 sheet 的 overrange(F-PK-4),用户点第二头的表现就是「没反应」。
    // 所以组件自己先给一条默认文案,宿主仍可按需另接 overrange 换说法。
    onOverrange(e) {
      const detail = (e && e.detail) || {}
      const max = Number(detail.max) || Number(this.data.maxRange) || 0
      // cy-calendar 给出的 span 是「含首尾的天数」(index.js:128)。按晚计数时要减掉尾日,
      // 否则「共 2 晚」的区间会被念成「到了 3 晚」。
      const rawSpan = Number(detail.span) || 0
      const night = this.data.unit === 'night'
      const counted = (n) => (n > 0 ? (night ? n - 1 : n) : 0)
      const limit = counted(max)
      const got = counted(rawSpan)
      const unitText = night ? '晚' : '天'
      this.setData({
        _overTitle: limit > 0 ? `最多选 ${limit} ${unitText}` : '这段区间太长了',
        _overSub: rawSpan > 0 && limit > 0
          ? `刚点的这一头是 ${got} ${unitText}，请重新选结束日期`
          : '请重新选结束日期',
      })
      this.triggerEvent('overrange', detail)
    },

    onQuick(e) {
      const kind = e.currentTarget.dataset.kind
      const range = cal.quickRange(kind, cal.today(), this.data.min)
      if (!range) return
      this._apply(range)
    },

    onClear() {
      this._apply([])
    },

    onCancel() {
      // 取消什么也不抛:草稿丢掉,调用方的值不动
      this.triggerEvent('cancel')
    },

    onConfirm() {
      const v = this.data._value
      if (!v[0] || !v[1]) return // 未选满时确定键是 disabled 态,这里再兜一次
      this.triggerEvent('confirm', { value: [v[0], v[1]], span: this.data._span })
    },
  },
})
