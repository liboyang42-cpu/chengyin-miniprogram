/* cy-option-sheet · 底部选项弹层(2026-09-02,收编 wx.showActionSheet)
 *
 * 病:`wx.showActionSheet` 是系统弹层 —— 系统蓝、系统字、系统圆角,完全在设计体系外,
 * Do not use 页明令禁止。生产代码里还有 9 处,而现有拦截只有页级一条断言
 * (club-journey-audit-fix-contract),新页天然不受约束 = 典型的闸放错层。
 *
 * 形态照 vault §3.22:平列表,行高 56、行间 1px 分隔线、顶部标题左 + ✕ 右。
 * 两种语义,别混:
 *   ① 一次选择(默认):单选圆点右对齐 + 底部一个主 CTA,选中再确认。
 *   ② 动作菜单(immediate):点一行立刻执行,没有圆点也没有 CTA
 *      —— IM 的「+」「更多」这类不是"选择"而是"动作",套确认反而多一步。
 *
 * 回调形状与 showActionSheet 对齐(select.detail.index === 原 res.tapIndex),
 * 所以 9 个落点的业务分支一行都不用改;取消走 cancel(原 fail)。
 */
Component({
  options: { multipleSlots: true },
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '请选择' },
    /* 选项。字符串数组即可(与 itemList 同形);要禁用某项时传
     * { label, disabled } 对象。 */
    items: { type: Array, value: [] },
    /* true = 动作菜单:点一行立刻发 select,不画圆点、不画 CTA */
    immediate: { type: Boolean, value: false },
    confirmText: { type: String, value: '确定' },
    /* 预选中项(仅非 immediate);-1 = 无 */
    defaultIndex: { type: Number, value: -1 },
  },
  data: {
    rows: [],
    picked: -1,
  },
  observers: {
    items(list) {
      this.setData({
        rows: (list || []).map((item, index) => (
          typeof item === 'string'
            ? { label: item, disabled: false, index }
            : { label: (item && item.label) || '', disabled: !!(item && item.disabled), index }
        )),
      });
    },
    show(v) {
      if (v) this.setData({ picked: this.data.defaultIndex });
    },
  },
  methods: {
    onRow(e) {
      const index = Number(e.currentTarget.dataset.index);
      const row = this.data.rows[index];
      if (!row || row.disabled) return;
      if (this.data.immediate) {
        this.triggerEvent('select', { index, label: row.label });
        return;
      }
      this.setData({ picked: index });
    },
    onConfirm() {
      const index = this.data.picked;
      if (index < 0) return;
      this.triggerEvent('select', { index, label: this.data.rows[index].label });
    },
    /* 关闭 = 取消。showActionSheet 的 fail 分支(用户划走/点取消)在这里对应 cancel,
     * 9 个落点里有 3 个靠它回收状态(team-up 的 callbacks.cancel/complete、
     * roam POI 的 _handleInteractionFailure),不能只发 close 了事。 */
    onClose() {
      this.triggerEvent('cancel');
    },
  },
});
