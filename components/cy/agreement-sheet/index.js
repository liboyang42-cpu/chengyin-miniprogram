// cy-agreement-sheet · 协议类长文的全屏弹窗(弹窗规范类型 B:依附发起页的任务)
// 用户定:协议类长文 = 全屏弹窗,不再整页 navigateTo 跳走。
// 文本从 utils/agreement-docs.js 取(和 pages/agreement 路由页同一份真源,不在这里抄第二份)。
// 路由页 pages/agreement 保留不删 —— 深链/分享/其它入口仍走它。
const { getDoc } = require('../../../utils/agreement-docs.js');

Component({
  options: { multipleSlots: true },
  properties: {
    show: { type: Boolean, value: false },
    theme: { type: String, value: 'player' },
    // service = 用户服务协议 | deregister = 账号注销须知(短别名在真源里映射到正式 key)
    type: { type: String, value: 'service' },
  },
  data: {
    doc: null,
  },
  observers: {
    // 只在真正要显示时才算 doc:未打开过的弹窗不必先占一份数据
    'show, type': function (show, type) {
      if (!show) return;
      this.setData({ doc: getDoc(type) });
    },
  },
  methods: {
    /* 协议是只读长文,没有草稿可丢 ⇒ 不接 dirty,✕ 和遮罩都直接关。
       ⚠️ 只发事件,**不**自己 setData({show:false}):show 是父级传进来的属性,组件自己改一次,
       父级那份状态并没有跟着变;等父级下次想再打开时 setData(true) 与它自己记着的 true 无差异,
       不会重新下发,弹窗就再也打不开了。开关的所有权留在父级(cy-sheet 本身也是这么做的)。 */
    onClose() {
      this.triggerEvent('close');
    },
  },
});
