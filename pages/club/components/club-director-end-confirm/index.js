/**
 * cy-club-director-end-confirm · D2 结束活动 · T2 居中确认。
 * Figma s7SEFaoJ3GQUIxJhdqcFUb 286:440。T2 型弹层:没有顶栏、没有 ✕,只能点按钮——
 * 复用 cy-modal(tone="interactive"),不自建 fixed 定位/遮罩。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '确认结束活动？' },
    content: { type: String, value: '结束后将停止玩家继续提交，并等待生成复盘。' },
    cancelText: { type: String, value: '再想想' },
    confirmText: { type: String, value: '结束活动' },
    loading: { type: Boolean, value: false },
  },
  methods: {
    onCancel() { this.triggerEvent('cancel') },
    onConfirm() { this.triggerEvent('confirm') },
  },
})
