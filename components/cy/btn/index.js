Component({
  options: { multipleSlots: false },
  properties: {
    // 新语义 API(文档1 §2):primary(反色中性) | secondary | ghost | danger
    // accent(品牌紫)已按规范真源 §2.1 废止,传进来会被映射到 primary
    variant: { type: String, value: '' },
    // 2026-09-01(D8):旧 API kind(blue|black|secondary|red|disabled)已删除。
    // 全部 8 处调用点已迁到 variant(blue/black 原本就映射到 primary,视觉零变化)。
    size: { type: String, value: '' },     // '' 标准(--cy-btn-h) | sm 小(--cy-btn-h-sm)
    loading: { type: Boolean, value: false },  // 提交转圈(替代原生 <button loading>);loading 时压掉按压反馈
    disabled: { type: Boolean, value: false }, // 禁用:视觉置灰 + 组件内拦截点击;被拦时补发 disabledtap 供页面挂引导提示
    accessibilityLabel: { type: String, value: '' }, // 纯图标/动态文案调用方显式覆盖；普通文字按钮由可见文本提供名称
  },
  data: { _v: 'primary' },
  observers: {
    'variant, disabled': function (variant, disabled) {
      // 主行动统一反色中性白(文档2 批1 清紫方向 + 用户"按钮白不紫")。
      // 2026-08-05:accent(品牌紫渐变)按规范真源 §2.1 废止,样式块已删。这里把它
      // 一并映射到 primary —— 只删样式不改映射的话,漏改的调用点会落到一个没有
      // 背景的 .btn--accent 上,变成透明按钮,比留着紫色更糟。
      if (disabled) { this.setData({ _v: 'disabled' }); return; }
      const retired = { accent: 'primary', blue: 'primary', black: 'primary', red: 'danger' };
      const v = variant || 'primary';
      this.setData({ _v: retired[v] || v });
    },
  },
  methods: {
    // 原生 tap 在内层被 catch,这里按状态决定是否重发:任一禁用形态(disabled 属性或
    // variant="disabled",统一看 _v)与 loading 一律吞掉;禁用被点时补发非冒泡
    // disabledtap,页面可绑它弹"为什么点不了"的引导(loading 有转圈,不补发)。
    // 可点时以冒泡自定义事件透传(detail 原样),页面既有 bindtap/catchtap + dataset 取参零改动。
    // ⚠️ 只收编"视觉禁用但仍可点"的拦截;disabled/loading 经 setData 异步传播,拦不住
    // 同一连击窗口的重入——防重复提交仍靠页面同步守卫(isPaying/submitting),勿删。
    __onTap: function (e) {
      if (this.data.loading) return;
      if (this.data._v === 'disabled') {
        this.triggerEvent('disabledtap', e.detail);
        return;
      }
      this.triggerEvent('tap', e.detail, { bubbles: true, composed: true });
    },
  },
});
