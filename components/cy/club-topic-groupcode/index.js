// cy-club-topic-groupcode · J6 出示团码(弹窗)。Figma node 297:392。
// 已经弹窗化的逻辑(选场次 → 出码 → 倒计时刷新)整段活在 cy-scene-qr-group-code 里
// (pages/club/detail/index.js 的 showGroupCode() 与它是同一套行为,业已验证)——
// 本组件只是把它包进 T1 半屏 cy-scene-sheet,给活动详情页一个开箱即用的弹窗壳。
Component({
  properties: {
    show: { type: Boolean, value: false },
    topicId: { type: String, value: '' },
    activityId: { type: String, value: '' },
    name: { type: String, value: '' },
  },
  methods: {
    onClose() { this.triggerEvent('close'); },
  },
});
