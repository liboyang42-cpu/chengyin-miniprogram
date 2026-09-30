/**
 * cy-club-director-role-sheet · D6 角色分配 · 接管(弹窗)。
 * Figma s7SEFaoJ3GQUIxJhdqcFUb 288:442。T1 底部弹窗,复用 cy-scene-sheet variant="half"。
 * 这一屏在稿子里把「调整角色」与「角色接管」合并成一张弹窗(选成员 → 分配固定角色 chips →
 * 角色接管行列表 → 确认分配),不是两张分开的弹窗——照稿收编,不擅自拆回旧结构。
 *
 * Figma 未展示接管必填「原因」输入(现有 adapter 的 takeoverPayload 要求 reason 1-200 字非空)。
 * 本组件不擅自加字段,在确认键上方留一个默认 slot 给宿主按需插入。
 */
Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '角色分配' },
    memberSectionTitle: { type: String, value: '选择成员' },
    members: { type: Array, value: [] },
    roleSectionTitle: { type: String, value: '分配固定角色' },
    roleOptions: { type: Array, value: [] },
    selectedRoleCode: { type: String, value: '' },
    takeoverSectionTitle: { type: String, value: '角色接管' },
    takeovers: { type: Array, value: [] },
    confirmText: { type: String, value: '确认分配' },
    confirmDisabled: { type: Boolean, value: false },
  },
  methods: {
    onClose() { this.triggerEvent('close') },
    onMemberTap(e) { this.triggerEvent('selectmember', e.detail) },
    onRoleChange(e) { this.triggerEvent('selectrole', e.detail) },
    onTakeoverTap(e) { this.triggerEvent('takeovertap', e.detail) },
    onConfirmTap() {
      if (this.data.confirmDisabled) return
      this.triggerEvent('confirm')
    },
  },
})
