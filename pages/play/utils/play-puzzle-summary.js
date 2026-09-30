function summarizePuzzleScores(nodes) {
  return (nodes || []).reduce((summary, node) => {
    if (!node || !node.done || node.puzzleScore == null) return summary
    const score = Math.max(0, Math.min(100, Number(node.puzzleScore) || 0))
    summary.score += score
    summary.count += 1
    if (node.completionMode === 'REVEALED') summary.revealedCount += 1
    return summary
  }, { score: 0, count: 0, revealedCount: 0 })
}

module.exports = { summarizePuzzleScores }
