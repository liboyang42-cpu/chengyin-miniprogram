// 商家「我承接的这一站」视图 —— 纯展示组件。
// 属性一一列出而不是塞一个 vm 对象:页面的 data 是扁平的,一个 vm 会逼着页面
// 再维护一份镜像,两份状态迟早漂移。这里啰嗦一点,换页面那边零改动。
Component({
  options: { addGlobalClass: true },
  properties: {
    assignedLabel: { type: String, value: '' },
    assignedNodeText: { type: String, value: '' },
    assignedValue: { type: String, value: '' },
    badgeImg: { type: String, value: '' },
    chapterActionText: { type: String, value: '' },
    chapterImg: { type: String, value: '' },
    fulfillActionText: { type: String, value: '' },
    heroFailed: { type: Boolean, value: false },
    heroImg: { type: String, value: '' },
    info: { type: Object, value: {} },
    isSelfTemplate: { type: Boolean, value: false },
    loadFailed: { type: Boolean, value: false },
    modeText: { type: String, value: '' },
    // 同一主题承接多站时的切换条(PR #585 放开多站后才有意义);<=1 站时页面不传,整块不渲染
    myStations: { type: Array, value: [] },
    activeStationId: { type: Number, value: 0 },
    navBarHeight: { type: Number, value: 0 },
    pendingCount: { type: Number, value: 0 },
    play: { type: null, value: null },
    prepText: { type: String, value: '' },
    /* 「开场前记得核一遍名单」后半句的人数。缺就只出前半句 —— 不写「0 人」。 */
    prepHeadcount: { type: String, value: '' },
    progress: { type: Array, value: [] },
    primaryDisabled: { type: Boolean, value: false },
    primaryText: { type: String, value: '' },
    role: { type: String, value: 'join' },
    quickActions: { type: Array, value: [] },
    playerSheet: { type: Object, value: {} },
    playerFilters: { type: Array, value: [] },
    clubActions: { type: Array, value: [] },
    moreSheet: { type: Object, value: { show: false, groups: [] } },
    chapterSheet: { type: Object, value: { show: false, state: 'idle', nodes: [] } },
    /* 「只接了合作邀约、还没有自己的点位」那一档(CU-M-92)。
       有值 = 这一页的主语是**合作关系**本身,不是某一站:承接页那些按站点算的区块
       (核销数字 / 我承接的 / 这一站玩什么 / 进度 / 准备)全部不出 —— 他没有站,
       渲染出来就是「待分配」满屏。页面给 null 即维持原样。 */
    coopPartner: { type: Object, value: null },
    nodeSheet: { type: Object, value: { show: false } },
    clubSheet: { type: Object, value: { show: false, items: [] } },
    reward: { type: null, value: null },
    rulesOpen: { type: Boolean, value: false },
    scheduleValue: { type: String, value: '' },
    sharedAmountText: { type: String, value: '' },
    sharingRateText: { type: String, value: '' },
    showCheckinQr: { type: Boolean, value: false },
    showFulfillment: { type: Boolean, value: false },
    showPrep: { type: Boolean, value: false },
    stateClass: { type: String, value: '' },
    stateKey: { type: String, value: '' },
    stateSub: { type: String, value: '' },
    stateText: { type: String, value: '' },
    statusBarHeight: { type: Number, value: 0 },
    stepText: { type: String, value: '' },
    templateReady: { type: Boolean, value: false },
    templateSubText: { type: String, value: '' },
    todos: { type: Array, value: [] },
    totalCount: { type: Number, value: 0 },
    verifiedCount: { type: Number, value: 0 },
  },
  data: { anyDrawerOpen: false },
  observers: {
    // 抽屉在页面流里,不是遮罩;上面那块 hero 虚化就是「有东西打开了」的唯一提示
    'clubSheet, playerSheet, chapterSheet, nodeSheet': function (club, player, chapter, node) {
      this.setData({ anyDrawerOpen: !!((club && club.show) || (player && player.show)
        || (chapter && chapter.show) || (node && node.show)) });
    },
  },
  methods: {
    onSwitchStation(e) {
      // 形状照既有约定:{act, dataset},页面 onJoinAct 统一分发。别新造一套。
      this.triggerEvent('act', { act: 'switchStation', dataset: { id: e.currentTarget.dataset.id } })
    },
    // 组件只说「用户点了什么」,做什么由页面决定
    emit(e) {
      const ds = e.currentTarget.dataset || {};
      this.triggerEvent('act', { act: ds.act, dataset: ds });
    },
    emitCloseClub() {
      this.triggerEvent('act', { act: 'closeClubSheet', dataset: {} });
    },
    emitCloseMore() {
      this.triggerEvent('act', { act: 'closeMoreSheet', dataset: {} });
    },
    // 章节 / 节点抽屉:project-drawer 的 close 不带 dataset,各给一个具名转发
    emitCloseChapter() {
      this.triggerEvent('act', { act: 'closeChapterSheet', dataset: {} });
    },
    emitOpenChapter() {
      this.triggerEvent('act', { act: 'openChapterSheet', dataset: {} });
    },
    // 关节点 = 回章节(下钻的返回),不是关掉整条路 —— 页面 closeNodeSheet 负责把章节开回来
    emitCloseNode() {
      this.triggerEvent('act', { act: 'closeNodeSheet', dataset: {} });
    },
    emitClosePlayer() {
      this.triggerEvent('act', { act: 'closePlayerSheet', dataset: {} });
    },
    // 抽屉外那条黑按钮:key 就是 act 名,页面白名单派发
    emitDrawerAction(e) {
      this.triggerEvent('act', { act: (e.detail || {}).key, dataset: {} });
    },
    emitHeroError() {
      this.triggerEvent('act', { act: 'onHeroError', dataset: {} });
    },
  },
});
