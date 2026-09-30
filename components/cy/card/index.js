// 统一卡片:圆角/内距/背景/边框走 token。flat=去边框去背景(用于嵌套场景)。
Component({
  properties: {
    flat: { type: Boolean, value: false },
    interactive: { type: Boolean, value: false },
    accessibilityLabel: { type: String, value: '' },
    /* 2026-08-28:10 个调用点(publish/fabu、talent/list、im/chat)都写了
     * hover-class="cy-pressed" hover-stay-time="80",但组件既没声明也没透传,
     * 属性被微信静默丢弃 —— 调用方以为有的按压反馈其实一次都没生效。
     * 自定义组件不会自动把 hover-* 传给内部根节点,必须显式声明再绑上去。 */
    hoverClass: { type: String, value: 'none' },
    hoverStayTime: { type: Number, value: 70 },
  },
});
