// cy-divider · 分隔(DS §3.7)。hairline 细线 / labelled 带字 / section-gap 面色分区带;优先留白。
Component({
  properties: {
    variant: { type: String, value: 'hairline' }, // hairline | labelled | section-gap
    text: { type: String, value: '' },
    spacing: { type: String, value: 'md' },        // sm | md | lg
    inset: { type: Boolean, value: false },
    insetLead: { type: Boolean, value: false },
  },
});
