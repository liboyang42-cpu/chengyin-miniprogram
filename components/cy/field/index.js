// cy-field · 表单字段(DS §3.3)。Label→Control→Helper/Error;placeholder≠label;错误紧邻字段。
Component({
  properties: {
    variant: { type: String, value: 'text' },   // text | textarea | select
    label: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    value: { type: String, value: '' },
    displayValue: { type: String, value: '' },
    helperText: { type: String, value: '' },
    errorText: { type: String, value: '' },
    required: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    readonly: { type: Boolean, value: false },
    error: { type: Boolean, value: false },
    success: { type: Boolean, value: false },
    clearable: { type: Boolean, value: false },
    showCount: { type: Boolean, value: false },
    maxlength: { type: Number, value: 140 },
    active: { type: Boolean, value: false },
  },
  data: { _focused: false, _filled: false },
  observers: {
    'value, displayValue, _focused': function (value, displayValue, focused) {
      const filled = !!(focused || (value && String(value).length) || (displayValue && String(displayValue).length));
      if (filled !== this.data._filled) this.setData({ _filled: filled });
    },
  },
  methods: {
    onInput(e) {
      const value = e.detail.value;
      this.setData({ value });
      this.triggerEvent('input', e.detail);
      // showCount 软上限:允许超字数,派发 overflow 供父表单禁用提交(红字计数由 fd__count--over 呈现)
      if (this.data.showCount) this.triggerEvent('overflow', { over: value.length > this.data.maxlength });
    },
    onFocus() { this.setData({ _focused: true }); },
    onBlur() { this.setData({ _focused: false }); this.triggerEvent('blur'); },
    onClear() {
      this.setData({ value: '' });
      this.triggerEvent('input', { value: '' });
      // showCount 软上限:清除即复位 overflow,否则父表单残留上次超字数态
      if (this.data.showCount) this.triggerEvent('overflow', { over: false });
    },
    onSelectTap() { if (!this.data.disabled && !this.data.readonly) this.triggerEvent('select'); },
  },
});
