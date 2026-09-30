// Figma 297:1827 Roam variant 的内容主体(外壳在 cy-post-card)。
// 纯展示组件:不拼文案、不换算单位 —— 距离/探店/用时都收成已格式化的字符串,
// 由数据侧决定「5.2 公里」还是「5.2km」,免得同一口径在组件和页面各写一份。
Component({
  properties: {
    cover: { type: String, value: '' },        // 轨迹图(漫游成绩长图 / 路线预览图)
    title: { type: String, value: '' },
    // 稿上 Roam 正文没有时间:时间归 post-card 头部。property 保留是因为两个页面仍在传,
    // 而详情页在 hasPlayCover 档下自己不显示时间(见组件返回说明的遗留项)。
    time: { type: String, value: '' },
    nodeTotal: { type: Number, value: 0 },     // 活动完赛帖(dataType=1)的路线节点数
    roamResult: { type: Boolean, value: false },
    postIndex: { type: Number, value: -1 },

    // MedalPill:后端 ViewCreativeSquare 已加这三个计数(节点全平台第 1/2/3 个完成)
    medalGold: { type: Number, value: 0 },
    medalSilver: { type: Number, value: 0 },
    medalBronze: { type: Number, value: 0 },

    // Stats 三栏:已格式化好的值,空串即不渲染该栏
    distanceText: { type: String, value: '' },
    shopText: { type: String, value: '' },
    durationText: { type: String, value: '' },

    // Kudos:头像 URL 数组(只取前三枚)+ 整句文案(如「你和 11 人点亮了这次漫游」)
    kudosAvatars: { type: Array, value: [] },
    kudosText: { type: String, value: '' },

    // CommentPreview:一条评论 + 总条数
    commentNick: { type: String, value: '' },
    commentText: { type: String, value: '' },
    commentCount: { type: Number, value: 0 },
  },

  methods: {
    onDetail() {
      this.triggerEvent('detail', { index: this.data.postIndex })
    },
  },
})
