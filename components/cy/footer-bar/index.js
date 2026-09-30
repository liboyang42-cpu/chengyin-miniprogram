// cy-footer-bar · 固定底部动作条(ADA,2026-07-29)
// 收编全站各页自绘的"底部 CTA 条":fixed bottom + 安全区内距 + 与页面同底的不透明承托。
// 为什么必须不透明:半透明/无底的动作条压在滚动内容上,文字会与内容互相穿透(ADA 可读性);
// 承托底固定取 --cy-bg-page,与页面同底 ⇒ 不产生第二种"面"。
//
// 两种用法(互斥,slot 优先):
//   ① 属性槽:primary / secondary 传文案 ⇒ 内部渲染 cy-btn,事件 primarytap / secondarytap
//   ② 自定义槽:不传 primary 时走 <slot>,页面塞任意内容(价格 + 按钮等复合底栏)
// 页面须自行给内容区留出 --cy-comp-footer-h 的底部空白(组件是 fixed,不占文档流)。
// 该 token 定义在 style/tokens.wxss,= 按钮高 + 上下内距 + 安全区,与本组件盒子构成一一对应。
Component({
  options: { multipleSlots: true },
  properties: {
    primary:   { type: String, value: '' },       // 主按钮文案;为空 ⇒ 走 slot
    secondary: { type: String, value: '' },       // 次按钮文案;为空 ⇒ 单按钮
    primaryVariant: { type: String, value: 'primary' },  // 透传 cy-btn variant
    primaryDisabled: { type: Boolean, value: false },
    primaryLoading:  { type: Boolean, value: false },
    // highlight:顶缘 1rpx 高光(暗端把动作条从内容里"抬"出来);默认关,亮端一般不需要
    highlight: { type: Boolean, value: false },
  },
  methods: {
    onPrimary()   { this.triggerEvent('primarytap'); },
    onSecondary() { this.triggerEvent('secondarytap'); },
    // 主按钮被禁用时仍点了:透传出去,页面可挂"为什么点不了"的引导(与 cy-btn 同语义)
    onPrimaryDisabled() { this.triggerEvent('primarydisabledtap'); },
  },
});
