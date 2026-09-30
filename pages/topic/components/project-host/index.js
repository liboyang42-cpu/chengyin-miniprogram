// 主办方「我发的这条路线」视图 —— 纯展示组件,与 project-join 同构。
Component({
  options: { addGlobalClass: true },
  properties: {
    /* CU-C-68:主办方抽屉「本站运营」资格探不到时的可见说明(页面探、组件只渲染)。 */
    stationOpsErrorText: { type: String, value: '' },
    statusBarHeight: { type: Number, value: 0 },
    navBarHeight:    { type: Number, value: 0 },
    navHidden:       { type: Boolean, value: false }, // 打卡码弹层显示时收起导航(✕为唯一出口)
    loadFailed:      { type: Boolean, value: false },
    rulesOpen:       { type: Boolean, value: false },
    quickActions:    { type: Array, value: [] },
    hostOwnerType:   { type: String, value: 'merchant' }, // club 主办不显示俱乐部协作位
    playerSheet: { type: Object, value: {} },
    playerFilters: { type: Array, value: [] },
    playerActions: { type: Array, value: [] },
    clubActions: { type: Array, value: [] },
    merchantSheet: { type: Object, value: {} },
    moreSheet:     { type: Object, value: { show: false, groups: [] } },
    merchantActions: { type: Array, value: [] },
    clubSheet:       { type: Object, value: { show: false, items: [] } },
    hostTopic:       { type: Object, value: {} },
    hostRecruit:     { type: Object, value: {} },
    hostMerchants:   { type: Array, value: [] },
    hostPlayers:     { type: Object, value: {} },
    ownerChapterApplications: { type: Array, value: [] },
    ownerChapterApplicationsState: { type: String, value: 'idle' },
    pendingMerchantNodes: { type: Array, value: [] },
    pendingMerchantNodesState: { type: String, value: 'idle' },
  },
  observers: {
    // 抽屉在页面流里,不是遮罩;上面那块 hero 虚化就是「有东西打开了」的唯一提示
    'clubSheet, playerSheet, merchantSheet': function (club, player, merchant) {
      this.setData({
        anyDrawerOpen: !!((club && club.show) || (player && player.show) || (merchant && merchant.show)),
      });
    },
    // 派生量放 observer 而不是让页面再多存两个字段:它们只有这个视图用得上
    'hostRecruit, clubSheet': function (recruit, sheet) {
      const total = (recruit && recruit.nodeTotal) || 0;
      const filled = (recruit && recruit.nodeFilled) || 0;
      this.setData({
        recruitDone: total > 0 && filled >= total,
        clubCount: ((sheet && sheet.items) || []).length,
      });
    },
  },
  data: { recruitDone: false, clubCount: 0, anyDrawerOpen: false },
  methods: {
    emit(e) {
      const ds = e.currentTarget.dataset || {};
      this.triggerEvent('act', { act: ds.act, dataset: ds });
    },
    emitCloseClub() {
      this.triggerEvent('act', { act: 'closeClubSheet', dataset: {} });
    },
    emitClosePlayer() {
      this.triggerEvent('act', { act: 'closePlayerSheet', dataset: {} });
    },
    emitCloseMore() {
      this.triggerEvent('act', { act: 'closeMoreSheet', dataset: {} });
    },
    emitCloseMerchant() {
      this.triggerEvent('act', { act: 'closeMerchantSheet', dataset: {} });
    },
    // 抽屉外那条黑按钮:key 就是 act 名,页面白名单派发
    emitDrawerAction(e) {
      this.triggerEvent('act', { act: (e.detail || {}).key, dataset: {} });
    },
  },
});
