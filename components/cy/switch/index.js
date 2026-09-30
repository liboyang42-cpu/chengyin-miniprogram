// cy-switch · 统一开关(2026-07-31 第8批新建)。项目里此前没有共享 switch 组件/token,
// 各页各写 color 字面量(如 merchant/decor 的"营业中"开关此前是 #0f172b,墨蓝色残留的根因之一)。
// 微信原生 <switch> 的 color 属性只吃字面量,不认 var(--cy-*),所以这里只能留一份实值镜像。
//
// 2026-08-05 改绿:原默认是 selection 白(#F6F7FA),配注释"绿色只由业务状态显式传入,
// 不要把普通开关误写成成功态"。该设计意图被用户裁决推翻 —— 规范真源 §3.3:
// **所有切换按钮一律绿色**。开关的语义就是"开/关",开即生效,和成功态同色不冲突。
// 2026-09-02 改深:原值取 --cy-color-status-success(#12B886)—— 那是**文字用的绿**,
// 为了在暗底上过 4.5:1 而调亮。同一个亮度当**大色块**就显得发白,而且白色滑块压在上面
// 只有 2.55:1,边界糊,整体读起来「浅」(用户实拍反馈)。开关轨道是色块不是文字,
// 需要的是饱和度和边界,不是文字对比度,所以单开一档而不是去改 status/success ——
// 改基色会让全站绿字一起变暗、掉出 AA。
// 新值白滑块 3.41:1、压卡 #1C1C1E 4.99:1。
// ⚠️ 这是 --cy-comp-switch-on 的实值镜像(Brand Handbook: color/control/switch-on),
//    两处要同步维护;微信原生 <switch> 的 color 只吃字面量,拿不到 var()。
const DEFAULT_COLOR = '#0E9E73'; // == --cy-comp-switch-on /* ds-ok */

Component({
  properties: {
    checked: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    color: { type: String, value: '' },
    /* 2026-08-28:merchant/decor 的「是否允许粉丝投稿」开关传了 accessibilityLabel,
     * 但组件既没声明也没消费 —— 属性被静默丢弃,读屏只能读到 role/checked,
     * 拿不到调用方给的名字。开关这种控件没有可见文字关联时,可访问名称就是唯一线索。 */
    accessibilityLabel: { type: String, value: '' },
  },
  data: { _color: DEFAULT_COLOR },
  observers: {
    color(v) { this.setData({ _color: v || DEFAULT_COLOR }); },
  },
  methods: {
    onChange(e) { this.triggerEvent('change', e.detail); },
  },
});
