/**
 * cy-club-director-recap · D9 活动复盘 · 已结束整页态。
 * Figma s7SEFaoJ3GQUIxJhdqcFUb 289:523。纯展示,数据全部由宿主活动详情页从 recap 映射传入。
 * 「榜单对外可见性」行沿用收编行列表的可点行为,tap 时把行 id 回抛给宿主(宿主决定是否二次确认)。
 */
Component({
  properties: {
    title: { type: String, value: '活动复盘' },
    funnelTitle: { type: String, value: '活动漏斗' },
    funnelSub: { type: String, value: '复盘自动生成，缺失指标不显示为零' },
    metrics: { type: Array, value: [] }, // [{ label, value }]
    completionTitle: { type: String, value: '完成情况' },
    completionRows: { type: Array, value: [] },
    leaderboardTitle: { type: String, value: '榜单' },
    leaderboardRows: { type: Array, value: [] },
    caption: { type: String, value: '' },
  },
  methods: {
    onLeaderboardRowTap(e) {
      this.triggerEvent('leaderboardrowtap', e.detail)
    },
  },
})
