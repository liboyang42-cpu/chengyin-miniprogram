const { initialData, methods } = require('../../../utils/deregister-flow.js');

Component({
  properties: {
    theme: { type: String, value: 'player' },
  },
  data: initialData(),
  lifetimes: {
    attached() { this.loadStatus(); },
    detached() { this.dispose(); },
  },
  // 显式列出事件入口，让 WXML 死链门禁能从组件本体核对；业务实现仍只在 shared flow 一处。
  methods: {
    _statusFailure(message) { return methods._statusFailure.call(this, message); },
    loadStatus() { return methods.loadStatus.call(this); },
    loadPrecheck() { return methods.loadPrecheck.call(this); },
    goCancellationNotice() { return methods.goCancellationNotice.call(this); },
    closeNoticeSheet() { return methods.closeNoticeSheet.call(this); },
    inputCode(event) { return methods.inputCode.call(this, event); },
    toggleConfirmed(event) { return methods.toggleConfirmed.call(this, event); },
    refreshApplyState() { return methods.refreshApplyState.call(this); },
    sendSms() { return methods.sendSms.call(this); },
    apply() { return methods.apply.call(this); },
    cancel() { return methods.cancel.call(this); },
    dispose() { return methods.dispose.call(this); },
  },
});
