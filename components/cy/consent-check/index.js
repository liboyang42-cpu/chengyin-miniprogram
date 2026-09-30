// cy-consent-check · 单独同意勾选行(2026-08-25 新建)
//
// 为什么要收成组件:个保法第 23/29 条要求的【单独同意】必须是独立可勾控件——不得默认勾选、
// 不得与通用条款打包、不得靠"点提交即视为同意"推定。这个形状此前只在
// pages/activity/baoming 里手写过一份,提现两页(subpackageMember/tixian、
// subpackageA/assetcenter/earnings)收银行账号(个保法 §28 明列的敏感个人信息)却都漏了。
// 双份实现让同一个缺陷要修两次,所以这次把控件本体收口成一处。
Component({
  properties: {
    checked: { type: Boolean, value: false },
    // 勾选行文案。必须写清「把哪些信息、提供给谁、用来干什么」,不能只写"我已阅读并同意"。
    text: { type: String, value: '' },
  },
  methods: {
    onTap() { this.triggerEvent('change', { checked: !this.data.checked }); },
  },
});
