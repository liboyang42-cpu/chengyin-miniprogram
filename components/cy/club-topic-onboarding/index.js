// cy-club-topic-onboarding · J3-A/J3-B「承接商家」(T1 半屏弹窗),一个组件两种 variant。
// mode='node'    → J3-A 城市定向按节点招商(Figma 155:118):按点位逐个招,一个节点只能一家承接。
// mode='chapter' → J3-B 自由探索按章节招商(Figma 158:118):按章节挂条款,商家选章节不选点位,
//                  通过后商家自己在章节下建点位、再走点位审核(那一步在别处,不在本弹窗)。
// 两种稿的表头(居中标题、无抓手、header 分隔线)与 T1 现成组件 cy-scene-sheet 的默认头
// (标题左对齐 + ✕ 右)不一致 —— 按须知"复用现成组件"优先,不新起一套头部 chrome,
// 已在 PR 里说明这处与稿子的出入。
//
// 纯展示组件:数据由宿主通过属性传入,不自己发请求 —— 后端目前没有聚合接口
// (TODO 见下),真写一个指向不存在 endpoint 的 app.sendRequest 调用只会是死代码,
// 还会被 UI-GATE-0(U1)判红。招商/查看申请/开放招募等动作也只 triggerEvent,
// 具体审核/详情页面本次不在范围内,由宿主接线。
//
// TODO(backend):需要新增 GET /api/topic/merchant-onboarding?id=&mode=
//   node    → { doneCount, totalCount, pendingCount, sections: [{ chapterName, stationCount,
//               wonCount, nodes: [{ id, seq, name, sub, state: 'won'|'pending'|'open',
//               merchantName, statusLabel }] }] }
//   chapter → { chapters: [{ id, name, statusLabel: '招募中'|'未开放', recruiting: boolean,
//               category, capacityText, tags: [string], approvedCount, capLimit,
//               thresholdText, pendingCount }] }
Component({
  properties: {
    show: { type: Boolean, value: false },
    topicId: { type: String, value: '' },
    mode: { type: String, value: 'node' }, // 'node' | 'chapter'
    loadState: { type: String, value: 'loading' }, // loading | ready | empty | error
    loadErrorText: { type: String, value: '' },
    doneCount: { type: Number, value: 0 },
    totalCount: { type: Number, value: 0 },
    pendingCount: { type: Number, value: 0 },
    progressPct: { type: Number, value: 0 },
    sections: { type: Array, value: [] }, // mode='node'
    chapters: { type: Array, value: [] }, // mode='chapter'
  },
  data: {
    introCopy: '章节承载招募品类、容量与条款，商家选择章节而不是具体点位；通过后由商家自己在章节下建点位，再走点位审核。',
  },
  methods: {
    // ===== mode='node' =====
    onInviteNode(e) {
      this.triggerEvent('invite', { topicId: this.data.topicId, nodeId: e.currentTarget.dataset.id });
    },
    onViewPool() {
      this.triggerEvent('viewpool', { topicId: this.data.topicId });
    },

    // ===== mode='chapter' =====
    onViewApplications(e) {
      this.triggerEvent('viewapplications', { topicId: this.data.topicId, chapterId: e.currentTarget.dataset.id });
    },
    onOpenRecruiting(e) {
      this.triggerEvent('openrecruiting', { topicId: this.data.topicId, chapterId: e.currentTarget.dataset.id });
    },
    onEditConditions(e) {
      this.triggerEvent('editconditions', { topicId: this.data.topicId, chapterId: e.currentTarget.dataset.id });
    },

    onRetry() { this.triggerEvent('retry', { topicId: this.data.topicId, mode: this.data.mode }); },
    onClose() { this.triggerEvent('close'); },
  },
});
