// cy-modal-host · 页面级「命令式弹窗」宿主(2026-09-06 原生弹层全删批次,替代 wx.showModal)
//
// 一页一个实例,id 固定 "cy-modal-host",由 utils/modal.js 通过栈顶页 selectComponent 找到它。
// open(opts) 接受与 wx.showModal 相同形状的参数,回调也给同形结果 {confirm, cancel, content} ——
// 这样 123 处调用点只需把 wx.showModal 换成 modal.show,一行不用改语义。
// 渲染交给 cy-modal(P 类弹层),editable 时在正文位放 cy-field 输入框。
// 在 wx.showModal 之外多一个可选字段 validate(content) → '' | '错误文案':返回文案时确认键**不关面板**,
// 文案原样贴在输入框下(CU-C-56/58/M-49:必填原因类弹窗原来只会「先关再报错」)。
Component({
  data: {
    show: false,
    title: '',
    content: '',
    confirmText: '确定',
    cancelText: '取消',
    showCancel: true,
    danger: false,
    editable: false,
    placeholderText: '',
    // editable 输入框上限:0 = 沿用微信默认 140;>0 时由调用方显式指定(如申请留言 200)
    maxlength: 0,
    inputValue: '',
    // CU-C-56/58/M-49:确认前校验不通过时的原位提示。有值就说明面板**没关**,用户看得见自己错在哪
    inputError: '',
  },
  // 页面卸载时把还开着的弹窗按 cancel 结算:用 new Promise 包着 modal.show 的调用方(如 roam 发帖锁)才不会永远 pending
  lifetimes: { detached() { this._settle({ confirm: false, cancel: true, content: '' }); } },
  methods: {
    // 与 wx.showModal 同形:title/content/confirmText/cancelText/showCancel/editable/placeholderText/success/fail/complete
    open(options) {
      const opts = options || {};
      // 原生 showModal 后弹的会顶掉前面的;这里同样:前一个按 cancel 结算,不留悬挂回调
      this._settle({ confirm: false, cancel: true, content: '' });
      this._opts = opts;
      // 前一个如果是危险确认层,也要一并收掉,否则它的确认键会结算到这次的回调上
      const dc = this.selectComponent && this.selectComponent('#dc');
      if (dc) dc.close();
      // 已登记危险写:交给 cy-danger-confirm(后果清单 + 「此操作不可撤销」),回调形状不变
      if (opts.dangerKey && dc && dc.open(opts.dangerKey, opts.dangerParams || {})) return;
      // 未登记的 key 退回普通确认(dc.open 已打日志),别让用户点了没反应
      this.setData({
        show: true,
        title: String(opts.title == null ? '' : opts.title),
        content: String(opts.content == null ? '' : opts.content),
        confirmText: opts.confirmText || '确定',
        cancelText: opts.cancelText || '取消',
        showCancel: opts.showCancel !== false,
        danger: !!opts.danger,
        editable: !!opts.editable,
        placeholderText: opts.placeholderText || '',
        maxlength: Number(opts.maxlength) > 0 ? Number(opts.maxlength) : 0,
        inputValue: '',
        inputError: '',
      });
    },
    onDcConfirm() {
      const dc = this.selectComponent && this.selectComponent('#dc');
      if (dc) dc.close();
      this._settle({ confirm: true, cancel: false, content: '' });
    },
    onDcCancel() {
      this._settle({ confirm: false, cancel: true, content: '' });
    },
    onInput(e) {
      // 用户开始改就把提示撤掉,别让上一轮的红字继续压在输入框下
      this.setData({ inputValue: (e.detail && e.detail.value) || '', inputError: '' });
    },
    // CU-C-56/58/M-49:open({ validate }) 传了校验函数时,校验不过**不关面板**、输入留在框里 ——
    // 原来是先 setData({show:false}) 再结算,调用方只能在面板消失后弹 toast,用户必须重开重打。
    onConfirm() {
      const opts = this._opts;
      if (opts && typeof opts.validate === 'function') {
        // 校验函数抛错时不吞:吞掉就等于放行,而这里正是「必填原因」的最后一道闸
        const tip = String(opts.validate(this.data.inputValue) || '');
        if (tip) { this.setData({ inputError: tip }); return; }
      }
      this._close({ confirm: true, cancel: false, content: this.data.inputValue });
    },
    onCancel() { this._close({ confirm: false, cancel: true, content: '' }); },
    _close(result) {
      this.setData({ show: false });
      this._settle(result);
    },
    _settle(result) {
      const opts = this._opts;
      this._opts = null;
      if (!opts || !result) return;
      const res = Object.assign({ errMsg: 'showModal:ok' }, result);
      try { if (typeof opts.success === 'function') opts.success(res); } catch (e) { /* 调用方异常不该卡住弹层 */ }
      try { if (typeof opts.complete === 'function') opts.complete(res); } catch (e) { /* 同上 */ }
    },
  },
});
