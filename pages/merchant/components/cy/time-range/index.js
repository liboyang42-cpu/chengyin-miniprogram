// cy-time-range · 时段选择(2026-08-26 新建)
//
// 为什么要有它:「开始时间 + 结束时间」这件事全仓 5 处各写各的双滚轮,而**校验各不相同** ——
// topic/merchantapply、publish/activity、publish/fabu、couponInfo 走
// time-picker-options 的 isEndAfterStart,而 merchant/game-node 与 play/celebrate
// 干脆一点校验都没有;play/celebrate 旁边写着「120—210 分钟」,全仓没有一处算过这个时长。
// 判断散在 5 个页面里必然对不齐,收进组件才有单一真相。
//
// 形态(2026-08-27 改):原来用原生 picker-view 双滚轮。滚轮本身没问题,坏的是它**不跟主题走** ——
// 白色渐变遮罩和浅色指示条是微信画的,wxss 覆不干净,在纯黑页上整块泛白。
// 换成自绘的「减—数值—加」调节器:深色由 token 决定,归属(开始/结束)显式标注,
// 并支持左右拖动连续调整(一屏宽约 9 小时),不至于用 ± 从 00:00 点到 19:00。
//
// 选项与格式化复用既有的 utils/time-picker-options.js(2026-08-25 建的单一真源),
// 本组件只额外用 utils/timerange.js 的分钟互转、跨天跨度与时长上下限判定。
const tr = require('../../../../../utils/timerange.js')
const reducedMotionBehavior = require('../../../../../behaviors/reduced-motion.js')

// 拖动灵敏度:每 12px 位移走一格。step=15 分钟时,一屏宽(~360px)约等于 7.5 小时,
// 任意时刻两三下就能到 —— 太灵敏会滑过头,太钝就退化成只能点 ±。
const DRAG_PX_PER_STEP = 12

const MINUTES_PER_DAY = 1440

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择时段' },
    // ['HH:mm', 'HH:mm']
    value: { type: Array, value: [] },
    // 分钟粒度。营业时段给 5 或 30 就够,别默认 1 让用户一格一格挪
    minuteStep: { type: Number, value: 5 },
    // 时长下/上限(分钟);0 = 不限
    minMinutes: { type: Number, value: 0 },
    maxMinutes: { type: Number, value: 0 },
    // 允许跨天:结束早于开始视为次日(夜场营业 22:00–02:00)
    allowCross: { type: Boolean, value: false },
  },
  data: {
    _startText: '00:00',
    _endText: '00:00',
    _spanText: '',
    _ok: false,
    _hint: '',
  },
  observers: {
    'show, value, minuteStep': function (show) {
      if (!show) return
      // 每次打开都从调用方的值重新起草,不留上一次的残留
      this._draft((this.data.value || [])[0] || '', (this.data.value || [])[1] || '')
    },
  },
  methods: {
    // 与 time-picker-options.minuteOptions 同一条兜底规则:步进不合法一律退回 1 分钟,
    // 尤其 step=0 会让「加一格」永远停在原地。
    _stepMin() {
      const s = this.data.minuteStep
      return s > 0 && s <= 60 ? Math.floor(s) : 1
    },

    // 分钟数吸附到步进格并绕回一天之内。
    // ⚠️ 负数必须真的绕到前一天末尾,不能夹到 0:00:00 按一下减号得到的是 -15,
    // 夹成 0 的话「减」在午夜就成了一个没反应的按钮。
    _snap(minutes) {
      const step = this._stepMin()
      const m = Math.round(minutes / step) * step
      return ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
    },

    // 起草一头的初值。⚠️ 用吸附后的值当内部真值,而不是保留调用方传进来的原值:
    // 界面显示 09:00 而内部还记着 09:07,确定时落下去的就不是用户看到的那个时间。
    // 空值/非法值也一样按界面实际显示的 00:00 起草 —— 原来内部记 '' 而界面显示 00:00,
    // 首次只改一头就点完成会静默 return:面板不关、值不落、零提示。所记必须等于所见。
    // (这里的 t < 0 是 toMinutes 的「解析不出来」哨兵,与上面「减到负数」是两回事,
    //  所以哨兵在这一层就地处理掉,不让它流进 _snap 的绕回算术。)
    _draftMin(hhmm) {
      const t = tr.toMinutes(hhmm)
      return this._snap(t < 0 ? 0 : t)
    },

    _draft(start, end) {
      this._startMin = this._draftMin(start)
      this._endMin = this._draftMin(end)
      this.setData({
        _startText: tr.fromMinutes(this._startMin),
        _endText: tr.fromMinutes(this._endMin),
      })
      this._revalidate()
    },

    // 两支各自写字面量 setData,不合并成一个动态键 —— 动态 setData 让门禁没法静态核对
    // 顶层字段有没有被消费,那条豁免不该为省三行代码去申请。
    _apply(which, minutes) {
      const m = this._snap(minutes)
      if (which === 'end') {
        this._endMin = m
        this.setData({ _endText: tr.fromMinutes(m) })
      } else {
        this._startMin = m
        this.setData({ _startText: tr.fromMinutes(m) })
      }
      this._revalidate()
    },

    _revalidate() {
      const d = this.data
      const r = tr.validate(d._startText, d._endText, {
        allowCross: d.allowCross,
        minMinutes: d.minMinutes,
        maxMinutes: d.maxMinutes,
      })
      this.setData({
        _ok: r.ok,
        _spanText: r.minutes > 0 ? '共 ' + tr.formatSpan(r.minutes) : '',
        _hint: this._hintOf(r),
      })
    },

    // 提示要说清「差多少」——只说「太短」用户不知道该往哪调
    _hintOf(r) {
      if (r.ok) return ''
      if (r.reason === 'not-after') {
        return this.data.allowCross ? '开始与结束不能是同一时刻' : '结束时间要晚于开始时间'
      }
      if (r.reason === 'too-short') {
        return '至少 ' + tr.formatSpan(this.data.minMinutes) + '，现在是 ' + tr.formatSpan(r.minutes)
      }
      if (r.reason === 'too-long') {
        return '最多 ' + tr.formatSpan(this.data.maxMinutes) + '，现在是 ' + tr.formatSpan(r.minutes)
      }
      return ''
    },

    onStep(e) {
      const ds = e.currentTarget.dataset
      const which = ds.which
      const base = which === 'end' ? this._endMin : this._startMin
      this._apply(which, base + Number(ds.dir) * this._stepMin())
    },

    // 拖动:按下时记住起点和当时的值,移动中始终以「起点值 + 总位移」计算,
    // 不做增量累加 —— 累加会把每次 round 的余数攒起来,来回滑一趟回不到原位。
    onDragStart(e) {
      const which = e.currentTarget.dataset.which
      const t = (e.touches || [])[0]
      if (!t) return
      this._drag = {
        which: which,
        x: t.clientX,
        base: which === 'end' ? this._endMin : this._startMin,
      }
    },

    onDragMove(e) {
      const d = this._drag
      const t = (e.touches || [])[0]
      if (!d || !t) return
      const steps = Math.round((t.clientX - d.x) / DRAG_PX_PER_STEP)
      this._apply(d.which, d.base + steps * this._stepMin())
    },

    onDragEnd() {
      this._drag = null
    },

    onCancel() {
      // 取消什么也不抛:草稿丢掉,调用方的值不动
      this.triggerEvent('cancel')
    },

    onConfirm() {
      // 校验不过就不抛,也不关面板 —— 让用户在原地看着提示改,
      // 而不是关掉之后才发现值没落上去
      if (!this.data._ok) {
        this._revalidate()
        return
      }
      const value = [this.data._startText, this.data._endText]
      this.triggerEvent('confirm', {
        value: value,
        minutes: tr.spanMinutes(value[0], value[1], this.data.allowCross),
      })
    },
  },
})
