Component({
  options: { multipleSlots: true },
  properties: {
    post: { type: Object, value: {} },
    index: { type: Number, value: 0 },
    userId: { type: null, value: '' },
    showFollow: { type: Boolean, value: false },
    showMore: { type: Boolean, value: false },
    showShare: { type: Boolean, value: false },
    showFavorite: { type: Boolean, value: false },
    interactiveActions: { type: Boolean, value: false },
    interactiveUser: { type: Boolean, value: false },
    interactiveClub: { type: Boolean, value: false },
    interactiveMedia: { type: Boolean, value: false },
    // 2026-09-03 rebase 保留:俱乐部详情以商家身份查看时整页是浅色,卡面文字要跟着翻。
    // master 的 Figma 297:1827 重排没有这个开关,而 pages/club/detail 一直在传它 ——
    // 只嫁接这一个属性 + 5 条 --light 覆写,不动 master 的排版。
    light: { type: Boolean, value: false },
    accessibilityLabel: { type: String, value: '查看帖文' },
  },
  methods: {
    eventDetail() {
      const post = this.data.post || {};
      return { index: this.data.index, postId: post.id, memberId: post.memberId, clubId: post.clubId };
    },
    emitDetail() { this.triggerEvent('detail', this.eventDetail()); },
    // 点头像不再直接跳主页,改成拉起 T5 胶囊(Figma 339:740)。锚点矩形必须在这里量:
    // 弹窗挂在页面上,createSelectorQuery 跨不进本组件内部。量不到就把 anchor 传 null,
    // 由调用方决定退回直接跳转 —— 不让它退化成居中弹窗(稿子明令禁止的形态)。
    emitUser() {
      const detail = this.eventDetail();
      const q = this.createSelectorQuery();
      q.select('.post-card__avatar-img').boundingClientRect();
      q.exec((res) => {
        this.triggerEvent('user', Object.assign(detail, { anchor: (res && res[0]) || null }));
      });
    },
    emitClub() { this.triggerEvent('club', this.eventDetail()); },
    // Roam / Template 正文块的三个动作原样转出去:页面拿到的还是 {index},
    // 与它们原先直接绑在子组件上时一模一样(feedIndexFromEvent 读的就是 e.detail.index)。
    emitPlayDetail() { this.triggerEvent('playdetail', this.eventDetail()); },
    emitRemix() { this.triggerEvent('remix', this.eventDetail()); },
    emitPlay() { this.triggerEvent('play', this.eventDetail()); },
    emitFollow() { this.triggerEvent('follow', this.eventDetail()); },
    emitMore() { this.triggerEvent('more', this.eventDetail()); },
    emitLike() { this.triggerEvent('like', Object.assign(this.eventDetail(), { type: 1 })); },
    emitFavorite() { this.triggerEvent('favorite', this.eventDetail()); },
    emitComment() { this.triggerEvent('comment', this.eventDetail()); },
    emitPreview(e) {
      if (!this.data.interactiveMedia) {
        this.emitDetail();
        return;
      }
      this.triggerEvent('preview', {
        ...this.eventDetail(),
        picList: this.data.post.picList || [],
        picIndex: Number(e.currentTarget.dataset.picindex) || 0,
      });
    },
  },
});
