function sameId(left, right) {
  return left !== null && left !== undefined
    && right !== null && right !== undefined
    && String(left) === String(right)
}

// 与 style/tokens.wxss 的 slow / standard / celebrate 时长保持一致。
// Figma 220:761 的演出严格串行：标题 → 路径 → 节点 → 当前站高亮 → CTA。
// WXSS 变量不能直接传进 JS，集中在这里避免节点数量增加后重新重叠。
const ROADMAP_TITLE_DURATION_MS = 350
const ROADMAP_PATH_DURATION_MS = 350
const ROADMAP_NODE_DURATION_MS = 220
const ROADMAP_HIGHLIGHT_DURATION_MS = 600
const ROADMAP_PATH_DELAY_MS = ROADMAP_TITLE_DURATION_MS
const ROADMAP_FIRST_NODE_DELAY_MS = ROADMAP_PATH_DELAY_MS + ROADMAP_PATH_DURATION_MS
const ROADMAP_NODE_STAGGER_MS = ROADMAP_NODE_DURATION_MS
const ROADMAP_CTA_GAP_MS = 220

function buildRoadmapModel(input) {
  const data = input || {}
  const nodes = Array.isArray(data.nodes) ? data.nodes.filter(Boolean) : []
  const activeNode = nodes.find((node) => sameId(node.nodeId, data.activeNodeId) && !node.done && !node.locked) || null
  const completed = nodes.filter((node) => !!node.done).length
  const lastNodeDelayMs = nodes.length
    ? ROADMAP_FIRST_NODE_DELAY_MS + ((nodes.length - 1) * ROADMAP_NODE_STAGGER_MS)
    : ROADMAP_FIRST_NODE_DELAY_MS
  const highlightDelayMs = lastNodeDelayMs + (nodes.length ? ROADMAP_NODE_DURATION_MS : 0)

  return {
    eyebrow: data.eyebrow || '',
    title: data.title || '',
    progressText: completed + ' / ' + nodes.length + ' 已完成',
    pathDelayMs: ROADMAP_PATH_DELAY_MS,
    items: nodes.map((node, index) => {
      let state = 'future'
      if (node.done) state = 'done'
      else if (node.locked) state = 'locked'
      else if (activeNode && sameId(node.nodeId, activeNode.nodeId)) state = 'active'
      return {
        nodeId: node.nodeId,
        number: node.num || node.sortId || (index + 1),
        title: node.name || node.title || node.gameTitle || '',
        body: node.gameTitle || node.description || node.address || '',
        state,
        active: state === 'active',
        last: index === nodes.length - 1,
        delayMs: ROADMAP_FIRST_NODE_DELAY_MS + (index * ROADMAP_NODE_STAGGER_MS),
      }
    }),
    highlightDelayMs,
    ctaDelayMs: highlightDelayMs + (activeNode ? ROADMAP_HIGHLIGHT_DURATION_MS : 0) + ROADMAP_CTA_GAP_MS,
  }
}

module.exports = { buildRoadmapModel }
