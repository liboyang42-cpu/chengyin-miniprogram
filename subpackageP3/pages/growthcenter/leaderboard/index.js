const { readReducedMotion } = require('../../../../utils/motion-preference.js');
// 完整排行榜(从成长中心主页拆出):周/总榜 × 积分/成长榜 切换 + 前三领奖台 + 全量名次
// 数据:/api/growth/leaderboard。成长中心主页只展示「自己的排名」摘要,点开才到这里看完整榜单。
const app = getApp()
const { isRecord, isRecordList } = require('../../../../utils/response-shape.js')

/* 头像优先级(手册 Utilities §5「优先照片 / Memoji，落回字母」):
 *   ① 用户自己的 avatar → ② Memoji 占位(按名次轮换) → ③ 字母 + 渐变底
 * Memoji 三张取自 Figma「Avatar · Memoji harvest」(Male 14 / Female 14 / Male 01),
 * 放在 subpackageP3/images/ 而不是主包 images/ —— 排行榜是分包页面,不必占主包体积。
 * ⚠️ 只有三张,名次多时会重复;这是 2026-09-01 用户在两个选项里选的那条,不是遗漏。 */
const MEMOJI = [
  '/subpackageP3/images/memoji-1.png',
  '/subpackageP3/images/memoji-2.png',
  '/subpackageP3/images/memoji-3.png'
]
// 落回字母时的底色渐变(按名次轮换)。2026-09-01:原第 3、4 条是品牌紫
// (#9B7BFF/#6C5CE7 与 #9B88FF/#7A5CFF),与 8-01「玩家域全去紫」冲突,换成青与珊瑚。
const AVATAR_GRADS = [
  'linear-gradient(135deg,#5B8DEF,#3B6FE0)', 'linear-gradient(135deg,#22C3A6,#17A98C)',
  'linear-gradient(135deg,#4FD3D0,#2FA8A5)', 'linear-gradient(135deg,#FF9A76,#E8663D)',
  'linear-gradient(135deg,#42C7E8,#2F9BCF)', 'linear-gradient(135deg,#F77FB0,#E2588F)',
  'linear-gradient(135deg,#5CC8FF,#3FA3E8)', 'linear-gradient(135deg,#FFC04D,#F2A01E)'
]
const ME_GRAD = 'linear-gradient(135deg,#F5C542,#F2A01E)'
// 金/银/铜外环
const RING_BG = {
  1: 'linear-gradient(135deg,#FFE9A8,#F5C542)',
  2: 'linear-gradient(135deg,#FFE9A8,#E6C46A)',
  3: 'linear-gradient(135deg,#F3C99A,#D8964B)'
}

// UI-04(2026-09-18):数字统计没取到显示 0,不再显示横杠
function fmt(n) {
  if (n === null || n === undefined || n === '') return '0'
  const v = Number(n)
  if (!Number.isFinite(v)) return '0'
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function initial(name) {
  return name ? String(name).trim().charAt(0) : '?'
}

Page({
  data: {
    reducedMotion: false,
    loading: true,
    errorMsg: '',
    metric: 'point',   // point | exp
    period: 'total',   // week | total
    unit: '积分',
    top3: [],          // [rank1, rank2, rank3]
    rest: [],          // 4 名之后
    me: null,
    animKey: 0
  },

  onShow() {

    const reducedMotion = readReducedMotion();

    if (this.data.reducedMotion !== reducedMotion) this.setData({ reducedMotion });

  },


  onLoad(query) {
    if (query && query.metric === 'exp') this.setData({ metric: 'exp' })
    if (query && query.period === 'week') this.setData({ period: 'week' })
    this.loadBoard()
  },

  onPullDownRefresh() {
    this.loadBoard(() => wx.stopPullDownRefresh())
  },

  // 错误态重试:必须真的重新取数。loadBoard 自己会先把 loading 置真、errorMsg 清空,
  // 所以这里不重复 setData —— 重复写反而会掩盖 loadBoard 漏清状态的 bug。
  onRetry() { this.loadBoard() },

  // 空榜 CTA:榜是空的时候唯一有意义的动作是去探索(去挣积分),不是重试。
  goExplore() {
    wx.switchTab({ url: '/pages/index/index', fail: () => wx.navigateBack({ fail: () => {} }) })
  },

  onMetricChange(e) { this.switchMetric(e.detail.key) },
  onPeriodChange(e) { this.switchPeriod(e.detail.key) },

  switchMetric(m) {
    if (this.data.metric === m) return
    this.setData({ metric: m, animKey: this.data.animKey + 1 })
    this.loadBoard()
  },
  switchPeriod(p) {
    if (this.data.period === p) return
    this.setData({ period: p, animKey: this.data.animKey + 1 })
    this.loadBoard()
  },

  loadBoard(done) {
    const metric = this.data.metric
    const period = this.data.period
    const requestId = (this._boardRequestId || 0) + 1
    this._boardRequestId = requestId
    const isCurrent = () => requestId === this._boardRequestId
    this.setData({ loading: true, errorMsg: '' })
    app.sendRequest({
      hideLoading: true,
      silentError: true,
      url: '/api/growth/leaderboard',
      method: 'POST',
      data: { metric, period, limit: 50 },
      success: (res) => {
        if (!isCurrent()) return
        if (res.code === 200 || res.code === '200') {
          this.buildBoard(res.data || {}, metric)
        } else {
          this.setData({ errorMsg: (app.getRequestErrorMessage && app.getRequestErrorMessage(res, '排行榜没有加载出来')) || '排行榜没有加载出来' })
        }
      },
      fail: () => {
        if (!isCurrent()) return
        this.setData({ errorMsg: '排行榜没有加载出来' })
      },
      successStatusAbnormal: (error) => {
        if (!isCurrent()) return
        this.setData({
          errorMsg: (app.getRequestErrorMessage && app.getRequestErrorMessage(error, '排行榜没有加载出来')) || '排行榜没有加载出来'
        })
      },
      complete: () => {
        if (isCurrent()) this.setData({ loading: false })
        typeof done === 'function' && done()
      }
    })
  },

  buildBoard(data, metric) {
    if (!isRecord(data) || !isRecordList(data.list) || (data.me != null && !isRecord(data.me))) {
      this.setData({ errorMsg: '排行榜没有加载出来' })
      return
    }
    const unit = (metric || this.data.metric) === 'exp' ? 'EXP' : '积分'
    const list = data.list.map((it, i) => this.toRow(it, i))
    const top3 = [0, 1, 2].map((i) => {
      const r = list[i]
      if (!r) return null
      return Object.assign({}, r, { ringBg: RING_BG[i + 1] })
    })
    let me = null
    if (data.me && data.me.rank !== null && data.me.rank !== undefined) {
      me = this.toRow(data.me, -1)
      me.bg = ME_GRAD
      me.name = data.me.nickname || '我'
    }
    this.setData({ unit, top3, rest: list.slice(3), me })
  },

  toRow(it, index) {
    const name = it.nickname || '探索者'
    return {
      rank: it.rank,
      memberId: it.memberId,
      name: name,
      initial: initial(name),
      scoreText: fmt(it.score),
      avatarUrl: it.avatar || '',
      // 没有自己的头像时给一张 Memoji;它盖住整个圆,底色渐变只在两者都没有时才露出来
      memoji: it.avatar ? '' : MEMOJI[Math.max(index, 0) % MEMOJI.length],
      bg: index >= 0 ? AVATAR_GRADS[index % AVATAR_GRADS.length] : ME_GRAD
    }
  },
})
