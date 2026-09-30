/* cy-search · 搜索输入框(DS §3.12)
 * 收编:L2 Browse 顶部搜索 / 搜索页输入的各页自造搜索块。
 * 状态:default / focused / filled(有值,呈现为清除钮)/ loading(联想中)。
 * placeholder 只写功能文案,禁营销话术;"取消/搜索"按钮在组件外,由页面 flex 排布。
 * clear 时同步补发 input(value:''),受控父不用单独监听 clear 也能同步 keyword。 */
Component({
  properties: {
    value:       { type: String,  value: '' },
    placeholder: { type: String,  value: '搜索' },
    focus:       { type: Boolean, value: false },   // 进入搜索页自动聚焦(§3.12)
    disabled:    { type: Boolean, value: false },
    loading:     { type: Boolean, value: false },   // 联想中
  },
  data: { focused: false },
  methods: {
    onFocus()    { this.setData({ focused: true }); },
    onBlur()     { this.setData({ focused: false }); },
    onInput(e)   { this.triggerEvent('input',   { value: e.detail.value }); },
    onConfirm(e) { this.triggerEvent('confirm', { value: e.detail.value }); },
    onClear() {
      this.setData({ value: '' });
      this.triggerEvent('input', { value: '' });
      this.triggerEvent('clear');
    },
  },
});
