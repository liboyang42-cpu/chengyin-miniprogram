/* cy-ai-assist · 内嵌 AI 助写(DS §5.10,Zesty 参照)
 * 附属于创作型表单字段:聚焦出按钮 → 提示 chips → 一键生成完整草稿填入表单。
 * 组件只负责交互与状态壳;真实 AI 生成由页面在 bind:generate 里调后端,
 * 结果写进普通表单字段后,通过 state 属性回推 done/error。禁止独立 AI 门户页。 */
Component({
  options: { multipleSlots: true },
  properties: {
    // 页面把字段 focus 态传进来:聚焦才亮 AI 按钮(§5.10)。非附属场景可常驻。
    active:      { type: Boolean, value: false },
    chips:       { type: Array,   value: [] },        // 示例 prompt
    // idle | generating | done | error —— 由页面按后端结果回推
    state:       { type: String,  value: 'idle' },
    placeholder: { type: String,  value: '一句话描述想法,如"静安 情侣 夜间 Citywalk 90分钟"' },
    sourceNote:  { type: String,  value: 'AI 生成内容,请核对后再发布' },  // 合规来源标注
    errorText:   { type: String,  value: '生成失败,请重试' },
  },
  data: { expanded: false, idea: '' },
  methods: {
    onExpand()      { this.setData({ expanded: true }); this.triggerEvent('open'); },
    onCollapse()    { this.setData({ expanded: false }); },
    onIdeaInput(e)  { this.setData({ idea: e.detail.value }); },
    onChip(e)       { const c = e.currentTarget.dataset.c || ''; this.setData({ idea: c }); this._emit(c); },
    onGenerate()    { this._emit(this.data.idea); },
    onRegenerate()  { this._emit(this.data.idea); },   // 换一版:同 prompt 再触发,页面自行决定覆盖确认
    onCancel()      { this.triggerEvent('cancel'); },
    _emit(prompt) {
      const p = (prompt || '').trim();
      if (!p) { this.triggerEvent('empty'); return; }
      this.triggerEvent('generate', { prompt: p });
    },
  },
});
