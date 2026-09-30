/**
 * cy-club-director-row-list · 导演台通用行列表(收编源:Figma s7SEFaoJ3GQUIxJhdqcFUb
 * 286:402/286:419/287:458/288:405/288:432/288:456/288:487/288:518/288:536/288:558/289:545/289:569 等「卡」)。
 * 站点/队伍/角色/章节/事件……10 张卡里有 11 处用的是同一张「卡+行+分隔线」,故收成一个纯展示组件,
 * 不含任何业务判断——行数据、可点与否、颜色语义全部由宿主页面算好传入。
 *
 * rows: [{ id, title, subtitle?, value?, valueTone?('default'|'success'|'warning'|'danger'|'muted'), disabled? }]
 * surface: 'elevated'(整页上的卡,--cy-color-bg-elevated) | 'raised'(弹窗面板上的卡,--cy-color-bg-raised)
 * selectable: true 时行可点,点击非 disabled 行触发 rowtap { id }
 */
Component({
  properties: {
    rows: { type: Array, value: [] },
    surface: { type: String, value: 'elevated' },
    selectable: { type: Boolean, value: false },
  },
  methods: {
    onRowTap(e) {
      if (!this.data.selectable) return
      const id = e.currentTarget.dataset.id
      const row = (this.data.rows || []).find(function (item) { return String(item.id) === String(id) })
      if (!row || row.disabled) return
      this.triggerEvent('rowtap', { id: row.id })
    },
  },
})
