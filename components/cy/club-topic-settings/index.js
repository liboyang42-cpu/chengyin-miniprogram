// cy-club-topic-settings · J4 主题 · 俱乐部设置(T1 半屏弹窗)。Figma node 201:118。
// 范围严格按稿子锁死:只改「开放商家承接」与两条展示偏好开关;主题名称、封面、剧情、
// 日期、票价一律跳编辑主题页(本组件只 triggerEvent('editcontent'),不自己导航 ——
// 具体页面路由由宿主决定)。结束主题/退款/下架也不在这层,那些是 J5
// (cy-club-topic-end-confirm)与编辑主题页的事。章节列表在本弹窗里只读展示。
//
// 纯展示组件:数据由宿主通过属性传入,开关切换只 triggerEvent('togglefield')
// 把 { field, value } 抛给宿主,不自己发请求 —— 后端目前没有对应接口(TODO 见下),
// 真写一个指向不存在 endpoint 的 app.sendRequest 调用只会是死代码,还会被
// UI-GATE-0(U1 静态路径无 Mapping、U4 动态 setData 字段未登记)判红。
//
// TODO(backend):需要新增 GET /api/topic/club-settings?id= 与
// POST /api/topic/club-settings/update { id, field, value },保存开放商家承接 /
// 置顶在俱乐部主页 / 只对成员可见 这三个开关。稿上没有独立"保存"按钮 —— 每个开关都是
// 点即生效(iOS 设置页语义),宿主接线时建议"乐观更新 + 失败回滚"(参考
// scene-club-edit 里 dissolveClub 的三段式错误处理写法)。
Component({
  properties: {
    show: { type: Boolean, value: false },
    topicId: { type: String, value: '' },
    loadState: { type: String, value: 'loading' }, // loading | ready | error
    loadErrorText: { type: String, value: '' },
    topicName: { type: String, value: '' },
    saleStatusLabel: { type: String, value: '' },
    openForMerchant: { type: Boolean, value: false },
    pinned: { type: Boolean, value: false },
    membersOnly: { type: Boolean, value: false },
    chapters: { type: Array, value: [] }, // [{ name, meta }],只读展示
    savingField: { type: String, value: '' }, // 宿主告知当前哪个开关在途,用来锁死对应 switch
  },
  methods: {
    onEditContent() {
      this.triggerEvent('editcontent', { topicId: this.data.topicId });
    },
    onOpenForMerchantChange(e) { this.toggleField('openForMerchant', !!e.detail.value); },
    onPinnedChange(e) { this.toggleField('pinned', !!e.detail.value); },
    onMembersOnlyChange(e) { this.toggleField('membersOnly', !!e.detail.value); },
    toggleField(field, value) {
      if (this.data.savingField) return; // 上一个开关还在途,先不让第二个抢
      this.triggerEvent('togglefield', { topicId: this.data.topicId, field, value });
    },
    onRetry() { this.triggerEvent('retry', { topicId: this.data.topicId }); },
    onClose() { this.triggerEvent('close'); },
  },
});
