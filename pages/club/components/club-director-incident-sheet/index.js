/**
 * cy-club-director-incident-sheet · D8 现场事件(弹窗)。
 * Figma s7SEFaoJ3GQUIxJhdqcFUb 288:546。T1 底部弹窗,复用 cy-scene-sheet variant="half"。
 *
 * 这是现有 game-director 页面里没有的新能力——现状 adapter 只在复盘里聚合「商家暂停/商家兜底/
 * 任务驳回」计数,没有对应的处理动作(PREPARE/START/ASSIGN_ROLES/TAKEOVER_ROLE/BROADCAST/
 * UNLOCK_CHAPTER/SET_LEADERBOARD_VISIBILITY/FINISH 七个之外,没有「处理现场事件」)。
 * 本组件只负责稿子里的展示与交互事件,宿主接入前需要后端补一个处理事件的写接口/action。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '现场事件' },
    incidents: { type: Array, value: [] },
    modeSectionTitle: { type: String, value: '处理方式' },
    modes: { type: Array, value: [] }, // [{id,label}]
    selectedMode: { type: String, value: '' },
    confirmText: { type: String, value: '确认处理' },
    confirmDisabled: { type: Boolean, value: false },
    caption: { type: String, value: '暂停只影响本站，不改变已发放的权益与已完成的提交。' },
  },
  methods: {
    onClose() { this.triggerEvent('close') },
    onIncidentTap(e) { this.triggerEvent('selectincident', e.detail) },
    onModeChange(e) { this.triggerEvent('selectmode', e.detail) },
    onConfirmTap() {
      if (this.data.confirmDisabled) return
      this.triggerEvent('confirm')
    },
  },
})
