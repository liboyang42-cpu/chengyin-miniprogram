// cy-calendar · 月历网格(2026-08-26 新建)
//
// 为什么要有它:全仓原来没有任何一处月历,日期一律是滚轮,而「起止区间」被拆成 8 套
// 手写双滚轮(最夸张的一处用 4 个滚轮拼一个区间)。滚轮一次只能看到 3–5 天,选不出
// 「这个月哪几天是周末」,也没有任何一处显示「共几天」。
//
// 本组件只负责画格子和响应点选 —— 弹窗壳、确认按钮、汇总徽章都不在这里,
// 那些是 cy-date-range-sheet 的事。单选场景可以直接内嵌本组件,不必套弹窗。
//
// 职责切分(这条决定了性能):
//   · utils/calendar.js  纯计算,已单测(闰年/跨年/首日偏移/区间状态机);
//   · index.wxs          渲染层算首日偏移与每格状态 class;
//   · 本文件             只做属性 → 数据的编排。
// **格子结构只构建一次,点选只 setData 两个日期字符串** —— 六个月约 180 格,
// 若每次点选都把整片 class 过桥一遍就是跨线程反模式。
const cal = require('../../../../../utils/calendar.js')
const reducedMotionBehavior = require('../../../../../behaviors/reduced-motion.js')

const WEEK_MON = ['一', '二', '三', '四', '五', '六', '日']
const WEEK_SUN = ['日', '一', '二', '三', '四', '五', '六']

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    // 'single' 单选 | 'range' 区间
    mode: { type: String, value: 'single' },
    // single: 'YYYY-MM-DD' | range: ['YYYY-MM-DD', 'YYYY-MM-DD'|null]
    value: { type: null, value: '' },
    min: { type: String, value: '' },
    max: { type: String, value: '' },
    // 往后渲染几个月
    months: { type: Number, value: 6 },
    // 1=周一起(默认,中国习惯) 0=周日起
    firstDayOfWeek: { type: Number, value: 1 },
    // ['YYYY-MM-DD', ...] 不可选的日子(已约满的场次等)
    disabledDates: { type: Array, value: [] },
    // { 'YYYY-MM-DD': '3 场' } 格子下方小字。⚠️ 先只实现不铺开,别每页都往格子里塞字
    marks: { type: Object, value: {} },
    // 区间模式下是否允许起止同一天
    allowSameDay: { type: Boolean, value: false },
    // 区间最多跨几天;超了抛 overrange 事件,由调用方给提示。
    // ⚠️ 组件自己不夹取 —— 静默改用户的输入是「替用户断定」
    maxRange: { type: Number, value: 0 },
  },
  data: {
    _months: [],            // 只含结构(哪天、几号、有没有 mark),构建一次不再变
    _weekLabels: WEEK_MON,
    _start: '',             // 点选只动这两个字段,格子 class 由 WXS 现算
    _end: '',
    _disabledMap: {},
    // 区间只选了开头、还没落结尾。此时 start 那格不能铺半截色带 —— 色带要接的那一头
    // 还不存在,铺出来就是一条通向空气的尾巴
    _picking: false,
  },
  observers: {
    // 结构相关:月份变了才重建那 180 格
    'min, months, firstDayOfWeek, marks': function () {
      this._rebuild()
    },
    // 选中值:只更新两个字符串,不碰 _months
    'value, mode': function () {
      this._syncValue()
    },
    disabledDates(list) {
      const map = {}
      ;(list || []).forEach((x) => {
        map[x] = true
      })
      this.setData({ _disabledMap: map })
    },
  },
  lifetimes: {
    attached() {
      this._rebuild()
      this._syncValue()
    },
  },
  methods: {
    _rebuild() {
      const d = this.data
      // 起点:min 优先,否则从当前选中值所在月起,再否则从今天所在月起
      const selected = d.mode === 'range' ? (d.value && d.value[0]) || '' : d.value || ''
      const from = d.min || selected || cal.today()

      this.setData({
        _months: cal.buildMonths(from, d.months, {
          marks: d.marks,
          firstDayOfWeek: d.firstDayOfWeek,
        }),
        _weekLabels: d.firstDayOfWeek === 0 ? WEEK_SUN : WEEK_MON,
      })
    },

    _syncValue() {
      const d = this.data
      const start = d.mode === 'range' ? (d.value && d.value[0]) || '' : d.value || ''
      const end = d.mode === 'range' ? (d.value && d.value[1]) || '' : ''
      this.setData({
        _start: start,
        _end: end,
        _picking: d.mode === 'range' && !!start && !end,
      })
    },

    _isDisabled(date) {
      const d = this.data
      if (d.min && date < d.min) return true
      if (d.max && date > d.max) return true
      return !!d._disabledMap[date]
    },

    onDay(e) {
      const date = e.currentTarget.dataset.date
      // 不可选的日子静默吞掉:给它弹提示等于把「这天不能选」说两遍(视觉已经灰了)
      if (this._isDisabled(date)) return
      const d = this.data

      if (d.mode !== 'range') {
        this.triggerEvent('pick', { date: date, phase: 'single' })
        this.triggerEvent('change', { value: date })
        return
      }

      const next = cal.pickRange([d._start, d._end], date, d.allowSameDay)
      this.triggerEvent('pick', { date: date, phase: next.done ? 'end' : 'start' })

      if (next.done && d.maxRange > 0) {
        const span = cal.daysBetween(next.value[0], next.value[1]) + 1
        if (span > d.maxRange) {
          // 不夹取、不落值:把越界原样告诉调用方,由它决定提示文案
          this.triggerEvent('overrange', { value: next.value, span: span, max: d.maxRange })
          return
        }
      }
      this.triggerEvent('change', { value: next.value, done: next.done })
    },
  },
})
