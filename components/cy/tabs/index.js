// cy-tabs:统一水平 Tab 栏(封装 style/components.wxss §5.2 的 .cy-tabs 类系统为组件)。
// properties:tabs=[{key,label,badge?}] · active=当前选中 key · variant=''|fill|wide|segmented|chip|attached · sticky=Boolean
// chip(R2 新增):Airbnb Messages 式独立药丸,item 各自成丸、横向可滑,与 segmented(单胶囊内分段)不同。
// sharedSlab:chip 的等分共享选中块,仅由需要连续位移动效的固定短筛选显式开启。
// 事件:切换时 triggerEvent('change', { key });强调色可由页面用 --cy-tabs-accent 覆盖。
const reducedMotionBehavior = require('../../../behaviors/reduced-motion.js');

Component({
  behaviors: [reducedMotionBehavior],
  properties: {
    tabs: { type: Array, value: [] },
    active: { type: String, value: '' },
    // variant 管**布局形态**(chip 横滑药丸 / fill 横滑等宽 / segmented / attached 与下方面板连体 / 默认)
    variant: { type: String, value: '' },
    // wide 管**选中指示条的宽度**：默认锚在文案上，wide 锚在整个 item 上撑满。
    // 2026-08-05 从 variant 里拆出来 —— 这两件事本来正交，塞进一个字符串就没法
    // 同时表达「横滑等宽布局 + 全宽选中条」，topic 页正是这个组合，迁移时因此卡住。
    wide: { type: Boolean, value: false },
    // size='sm'：视觉高度压到 44rpx 的紧凑档(账期切换这类二级 tab 用)，但触达区
    // 由透明 ::after 撑回 88rpx —— 与 cy-btn 的 sm 档同一手法。
    // 2026-08-05 加：ledger 页有三层 tab，第二层 period-tab 是刻意的 44rpx 紧凑档
    // (原代码有 ds-ok 标注)，组件没有对应档位，迁移因此卡住。
    size: { type: String, value: '' },
    // plain:去掉整条 border-bottom、字号加大、下划线与文案等宽(漫游起始页这类"标题下挂 tab"的版式用)。
    // 默认 false,其余使用方零影响。
    plain: { type: Boolean, value: false },
    // hairline(2026-08-20):只管整条 border-bottom 画不画,其余(字号/指示条)不动。
    // member 主页那排 tab 用户定「不要那条白线」,但仍要选中指示条 ⇒ plain 管不了这个组合。
    // 默认 true,其余使用方零影响。
    hairline: { type: Boolean, value: true },
    sticky: { type: Boolean, value: false },
    sharedSlab: { type: Boolean, value: false },
  },
  data: {
    _slabCount: 0,
    _slabWidth: '0',
    _slabOffset: 0,
    _slabOpacity: 0,
  },
  observers: {
    'tabs, active': function (tabs, active) {
      const items = Array.isArray(tabs) ? tabs : [];
      const activeIndex = items.findIndex((item) => item && item.key === active);
      const slabPercent = items.length ? 100 / items.length : 0;
      const slabInset = items.length ? 12 / items.length : 0;
      this.setData({
        _slabCount: items.length,
        // CSS calc 的除法在旧基础库并不稳定，先在 JS 展开成标准的百分比减法。
        _slabWidth: items.length ? `calc(${slabPercent}% - ${slabInset}rpx)` : '0',
        _slabOffset: Math.max(activeIndex, 0) * 100,
        _slabOpacity: activeIndex >= 0 ? 1 : 0,
      });
    },
  },
  methods: {
    onTab(e) {
      const key = e.currentTarget.dataset.key;
      if (key === this.data.active) return;
      this.triggerEvent('change', { key });
    },
  },
});
