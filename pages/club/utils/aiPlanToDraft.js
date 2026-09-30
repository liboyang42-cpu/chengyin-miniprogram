// AiClubDesignResp → ai_topic_draft 适配器(纯函数,无 wx / 无 storage / 无副作用)。
// 消费端唯一真源:pages/publish/fabu/index.js 的 applyAiDraft(),字段名以那边为准。
// 调用方负责按当前 memberId 写入账号隔离的 AI 草稿 key，再 navigateTo 发布页。

// AiPlanNode → draft 节点。只搬有真源的 6 个地点字段。
// 玩法字段(task/validationMethod/question*/option*/correctAnswer/hint*/feedbackText/
// rewardSuggest/roleText/candidateId)一律丢弃:fabu 节点上无落点,后端 AiPlanNode 也明说
// 「玩法先建模板再挂 templateId」,硬塞会错档进 mode2 专属叙事字段、在 mode1 下静默蒸发。
function toNode(n, i) {
  return {
    // 已知降级:AiPlanNode 无 description 源,这里不给,
    // 由 applyAiDraft 的 `n.description || n.address` 回退用地址当描述。
    name: n.merchantName || ('节点' + (i + 1)),
    address: n.address || '',
    longitude: String(n.longitude || ''),
    latitude: String(n.latitude || ''),
    businessTime: n.businessTime || '',
    sortID: n.order || (i + 1)
  };
}

// resp = AiClubDesignResp { traceId, plan, merchantSuggestions, promoCopy }
// traceId 必须从 resp 顶层取(AiThemePlan 里没有);它是 fabu「[AI 辅助生成]」留痕标记的
// 唯一开关,漏了 = AI 内容零留痕 = 合规问题。
function aiPlanToDraft(resp) {
  const r = resp || {};
  const plan = r.plan || {};
  const nodes = (plan.nodes || []).map(toNode);
  return {
    name: plan.title || '',
    subtitle: plan.subtitle || '',
    description: plan.storyline || '',
    // 留痕标记的唯一开关(applyAiDraft: `draft.aiTraceId ? '  [AI 辅助生成]' : ''`)。
    // 有 plan = 确有 AI 产出 → 上游漏给 traceId 也得兜底成哨兵,合规标记不能静默消失;
    // 无 plan = 空壳草稿,没有 AI 内容可标 → 留空,免得空描述上挂个孤零零的标记。
    aiTraceId: r.traceId || (r.plan ? 'ai' : ''),
    // plan 只有平铺 nodes,fabu 要 chapters[],包一层单章节。章节字段照 applyAiDraft 现码。
    chapters: [{
      name: '第1章',
      description: '',
      imgArr: '',
      calculatedDistance: 0,
      nodes: nodes
    }]
  };
}

module.exports = { aiPlanToDraft };
