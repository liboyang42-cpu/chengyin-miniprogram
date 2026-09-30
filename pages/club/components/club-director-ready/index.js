/**
 * cy-club-director-ready · D1 活动详情 · 准备中(准备总览)整页态。
 * Figma s7SEFaoJ3GQUIxJhdqcFUb 286:393。纯展示:站点/队伍两张收编行列表 + 主键 + 提示语,
 * 由宿主活动详情页把 projection 映射成 rows 传入,本组件不发请求、不判权限。
 */
Component({
  properties: {
    title: { type: String, value: '准备总览' },
    stationTitle: { type: String, value: '站点准备' },
    stationSub: { type: String, value: '' },
    stations: { type: Array, value: [] },
    teamTitle: { type: String, value: '队伍与角色' },
    teamSub: { type: String, value: '' },
    teams: { type: Array, value: [] },
    primaryText: { type: String, value: '开始活动' },
    primaryDisabled: { type: Boolean, value: false },
    caption: { type: String, value: '' },
    captionTone: { type: String, value: 'warning' }, // 'warning' | 'default'
  },
  methods: {
    onPrimaryTap() {
      if (this.data.primaryDisabled) return
      this.triggerEvent('primary')
    },
  },
})
