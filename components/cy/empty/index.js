// 统一空态:图 + 主文案 + 副文案 + 可选 CTA。点 CTA 触发 'cta' 事件。
//
// ADA 状态族:空 / 错 / 无权限 / 未开始不能继续共用同一张灰色插画。
// 位图只保留给真正的 empty；其余状态复用 cy-icon 里的线性图标，不新增图片资产。
// offline 保留给既有网络错误调用；missing-param / loading 也继续兼容。
// 向后兼容硬约束:**不传 kind** 走 LEGACY_DEFAULT —— 无插画、无副文案,
//   ⇒ 既有未传 kind 用法零视觉变化(不能凭空给它们多长出一张图)。
//   显式传 kind="empty" 才拿默认插画,这正是"显式声明状态"与"老用法"的分界。
// 显式传入的 icon / title / sub 恒优先于 kind 默认值。
// ⚠️ 这张表里不许出现 cta:默认 CTA 没有默认动作,点下去什么都不发生 = 假按钮。
//   CTA 只能由页面显式传,并自己 bind:cta 接住。
const KIND_DEFAULTS = {
  empty:           { icon: '/images/no_data.svg',  glyph: '',        title: '暂无内容',       sub: '这里还没有内容' },
  success:         { icon: '',                     glyph: 'check',   title: '已完成',         sub: '' },
  offline:         { icon: '',                     glyph: 'warning', title: '网络好像断开了', sub: '检查网络连接后重试' },
  network:         { icon: '',                     glyph: 'warning', title: '网络没连上',     sub: '连接恢复后可继续' },
  error:           { icon: '',                     glyph: 'warning', title: '出错了',         sub: '请稍后重试' },
  data:            { icon: '',                     glyph: 'info',    title: '这部分没加载成功', sub: '已加载的内容仍可查看' },
  'no-permission': { icon: '',                     glyph: 'lock',    title: '暂时不能查看',   sub: '当前账号没有查看权限' },
  permission:      { icon: '',                     glyph: 'lock',    title: '暂时不能查看',   sub: '当前账号没有查看权限' },
  forbidden:       { icon: '',                     glyph: 'lock',    title: '暂时不能查看',   sub: '当前账号没有查看权限' },
  'not-started':   { icon: '',                     glyph: 'clock',   title: '还没开始',       sub: '开始后内容会显示在这里' },
  // 2026-08-11:原默认图是 icon_cat.png —— 那是张 32×32 的**分类小图标**(search2 里就写死
  // width:32rpx 当行内图标用),不是插画。铺在空态那块 240rpx 的位置上,深色图形压在暗底页
  // 几乎看不见:走查 B10 拍到的缺参态就是整屏只有文案、没有图。
  // 佐证:crop、topic/index 两个调用点早就自己 override 成 no_data.svg 绕开了 —— 说明踩过,
  // 只是当时在调用侧打补丁没回来修默认值。
  // ⚠️ 改法不是换成 empty 那张位图(我第一版这么干,违反本文件表头第 3-4 行:位图只留给
  // 真正的 empty,其余状态复用 cy-icon 线性图标)。走 glyph:'info' —— 与 offline/no-permission/
  // not-started 同一档做法,视觉身份也与 empty 区分得开。
  'missing-param': { icon: '',                     glyph: 'info',    title: '页面参数不完整', sub: '这个链接可能已失效,返回上一页重新进入' },
  'not-found':     { icon: '',                     glyph: 'info',    title: '没有找到内容',   sub: '内容可能已下线或链接已失效' },
  stale:           { icon: '',                     glyph: 'warning', title: '内容暂时未更新', sub: '当前仍显示上次加载的内容' },
  loading:         { icon: '',                     glyph: '',        title: '加载中',         sub: '' },
};

// 未传 kind(以及传了未知 kind)时的兜底:与本次改造前的渲染结果逐字相同
const LEGACY_DEFAULT = { icon: '', glyph: '', title: '暂无内容', sub: '' };

Component({
  properties: {
    icon: { type: String, value: '' },
    // title 默认由 '暂无内容' 改为 ''(空 = 未指定),真正的默认值下沉到 KIND_DEFAULTS.empty.title,
    // 渲染结果不变;这样才分得清「页面显式传了文案」与「用 kind 默认文案」。
    title: { type: String, value: '' },
    sub: { type: String, value: '' },
    cta: { type: String, value: '' },
    // fill:是否撑满容器居中(整屏空态用);默认 false 保持旧行为,section 内嵌空态不传
    fill: { type: Boolean, value: false },
    kind: { type: String, value: '' },
    aria: { type: String, value: '' },
    // size:'lg' = aaa 标准(2026-07-31,速查表代号 aaa)放大插画/文字;默认 '' 保持旧尺寸,
    // 既有调用零视觉变化,新/改版页面显式传 size="lg" 才吃这档。
    size: { type: String, value: '' },
  },
  data: {
    _icon: '',
    _glyph: '',
    _title: '暂无内容',
    _sub: '',
    _loading: false,
  },
  observers: {
    'kind, icon, title, sub': function (kind, icon, title, sub) {
      // hasOwn 避免 constructor / toString 等原型键绕过未知 kind 的中性兜底。
      const knownKind = Boolean(kind && Object.prototype.hasOwnProperty.call(KIND_DEFAULTS, kind));
      const d = knownKind ? KIND_DEFAULTS[kind] : LEGACY_DEFAULT;
      const resolvedTitle = title || d.title;
      const resolvedSub = sub || d.sub;
      this.setData({
        _icon: icon || d.icon,
        // 页面显式传位图时沿用既有优先级，不再同时叠一枚默认线性图标。
        _glyph: icon ? '' : d.glyph,
        _title: resolvedTitle,
        _sub: resolvedSub,
        // loading 用转圈占插画位:此刻还不知道最终是有数据还是空,放插画会先给一个错误结论
        _loading: knownKind && kind === 'loading',
      });
    },
  },
  methods: {
    onCta() { this.triggerEvent('cta'); },
  },
});
