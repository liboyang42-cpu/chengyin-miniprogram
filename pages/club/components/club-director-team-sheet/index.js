/**
 * cy-club-director-team-sheet · D5 队伍进度(弹窗)。
 * Figma s7SEFaoJ3GQUIxJhdqcFUb 288:393。T1 底部弹窗,复用 cy-scene-sheet variant="half"。
 * 纯只读展示,没有主键——稿子里唯二的操作是关闭。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '队伍进度' },
    teams: { type: Array, value: [] },
    collaborationTitle: { type: String, value: '队伍协作' },
    collaboration: { type: Array, value: [] },
  },
  methods: {
    onClose() { this.triggerEvent('close') },
  },
})
