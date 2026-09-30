// cy-identity-tag · 身份标签(挂在名字后面)
//
// 设计真源:Figma ku2oaN9ag1XUMC9lKNnrcr
//   BIZ (商家)  node 107:10367 —— 蓝渐变 #3BADF5 → #0083DA,25.24°
//   CLUB(俱乐部) node 107:10402 —— 橙渐变 #FFA654 → #F26702,151.46°
// 两者同规格:35×16 px(= 70×32rpx)、圆角 5px(= 10rpx)、白字 8px(= 16rpx)、
// 外发光 0 0 57.355px rgba(...,.70)。
//
// ⚠️ 玩家(user_type=1)**不挂标签** —— 这是产品明确要求,不要给它补一个「玩家」态。
// 所以 kind 为空/未知时组件整体不渲染,而不是渲染一个灰底兜底。
Component({
  properties: {
    // 'biz' 商家 | 'club' 俱乐部。其它值(含空)= 不渲染。
    kind: { type: String, value: '' },
  },
  data: { _kind: '', _label: '' },
  observers: {
    kind(v) {
      const k = String(v || '').toLowerCase();
      const label = k === 'biz' ? 'BIZ' : (k === 'club' ? 'CLUB' : '');
      this.setData({ _kind: label ? k : '', _label: label });
    },
  },
});
