/**
 * cy-club-director-chapter-sheet · D4 章节控制 · 手动解锁(弹窗)。
 * Figma s7SEFaoJ3GQUIxJhdqcFUb 287:446。T1 底部弹窗,复用 cy-scene-sheet variant="half"。
 *
 * chapters 里只有"可解锁"的行应把 disabled 置 false(其余置 true),行点击由收编行列表本身
 * 过滤 disabled——本组件不判断章节是否可解锁,那是宿主页面的业务规则。
 * Figma 未展示"现场原因"必填输入(现有 game-director 页要求手动解锁必填原因,adapter 侧
 * takeoverPayload/confirmManualUnlock 校验非空)——本组件不擅自加字段,在确认键上方留一个
 * 默认 slot,宿主如果仍要收原因,把 <textarea> 之类放进 <cy-club-director-chapter-sheet> 的
 * 子节点即可插入该位置;不放则视觉与稿子 1:1。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '章节控制' },
    chapters: { type: Array, value: [] },
    confirmText: { type: String, value: '确认解锁章节' },
    confirmDisabled: { type: Boolean, value: false },
    caption: { type: String, value: '解锁后玩家立即可进入该章节的站点，不可撤回。' },
  },
  methods: {
    onClose() { this.triggerEvent('close') },
    onChapterTap(e) { this.triggerEvent('selectchapter', e.detail) },
    onConfirmTap() {
      if (this.data.confirmDisabled) return
      this.triggerEvent('confirm')
    },
  },
})
