/* cy-cell · 列表行(DS §3.11)
 * 收编:设置项 / 我的页入口行 / 表单跳转行 / 信息展示行——比 Card 更高频的行原语。
 * 结构:Leading icon(可选)→ Title + Description(可选,第二行)→ Trailing(value 文案 / chevron)。
 * openType:微信开放能力(contact 等)只能挂在 <button> 上,组件内部渲染透明 button 覆盖整行承接。
 * 根节点 catchtap 拦掉原生 tap 冒泡,只发自定义 tap——否则使用方 bind:tap 会被(原生冒泡+自定义)触发两次。 */
Component({
  properties: {
    arrowIcon: {type:String, value:'arrow-right'},
    reserveArrow: {type:Boolean, value:false},
    required: {type:Boolean, value:false},
    bubbleTap: {type:Boolean, value:false},
    icon:        { type: String,  value: '' },     // Leading 图标 src(44rpx)
    title:       { type: String,  value: '' },
    description: { type: String,  value: '' },     // 第二行说明;有则行高 128rpx
    value:       { type: String,  value: '' },     // Trailing 右侧文案
    arrow:       { type: Boolean, value: true },   // Trailing chevron,可关
    disabled:    { type: Boolean, value: false },
    danger:      { type: Boolean, value: false },  // 危险行(如"退出账号"):标题用 status-danger
    hairline:    { type: Boolean, value: true },   // 底部发丝分割线,组内末行可关
    openType:    { type: String,  value: '' },     // 透传微信 open-type(如 "contact")
    tint:        { type: String,  value: '' },     // Leading 图标染色变体:'mono'=单色描边(暗底页把深色线性图标统一染白,免逐图做暗色资产)
  },
  methods: {
    onTap() { if (!this.data.disabled) this.triggerEvent('tap', {}, {bubbles:this.data.bubbleTap, composed:this.data.bubbleTap}); },
  },
});
