function buildPlayRecap(nodes) {
  const completed = Array.isArray(nodes) ? nodes.filter((node) => node && node.done) : []
  return {
    photos: completed
      .filter((node) => node.picUrl)
      .slice(0, 12)
      .map((node) => ({ nodeId: node.nodeId, picUrl: node.picUrl })),
    canReplayJournal: completed.length > 0
  }
}

module.exports = { buildPlayRecap }
