// 身份标识小标(RBAC):player/club/merchant/official
// 设计来源 Figma: club 107-10399 / merchant 107-10371 / official 109-10406
Component({
  properties: {
    // 角色:player(默认不显示) / club / merchant / official
    role: { type: String, value: 'player' },
    // 是否显示玩家标(默认玩家不显示标)
    showPlayer: { type: Boolean, value: false }
  }
});
