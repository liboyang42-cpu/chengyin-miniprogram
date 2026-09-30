// cy-ai-score-card · AI 参考分(Figma v5.1,node 47:319)
// 纯展示:分数与评语都由服务端给。刻意不带任何交互 —— 稿上写明"最终以商家审核为准",
// 让它可点会误导成"点了能申诉"。
Component({
  properties: {
    score:   { type: Number, value: 0 },
    label:   { type: String, value: 'AI 参考分' },
    comment: { type: String, value: '' },
    note:    { type: String, value: '最终以商家审核为准' },
  },
});
