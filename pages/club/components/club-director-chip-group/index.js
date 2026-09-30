/**
 * cy-club-director-chip-group · 导演台单选 chip 行(收编源:Figma D6 分配固定角色 / D7 范围 / D8 处理方式)。
 * options: [{ id, label }]，value 为当前选中 id，点击非当前项触发 change { id }。
 */
Component({
  properties: {
    options: { type: Array, value: [] },
    value: { type: String, value: '' },
  },
  methods: {
    onTap(e) {
      const id = e.currentTarget.dataset.id
      if (id === this.data.value) return
      this.triggerEvent('change', { id: id })
    },
  },
})
