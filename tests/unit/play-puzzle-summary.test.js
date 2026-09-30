const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { summarizePuzzleScores } = require('../../pages/play/utils/play-puzzle-summary.js')

test('完赛解谜分只汇总服务端持久化的谜题表现', () => {
  const summary = summarizePuzzleScores([
    { done: true, puzzleScore: 100, completionMode: 'SOLVED' },
    { done: true, puzzleScore: 40, completionMode: 'SOLVED' },
    { done: true, puzzleScore: 0, completionMode: 'REVEALED' },
    { done: true },
    { done: false, puzzleScore: 70, completionMode: 'SOLVED' },
  ])

  assert.deepEqual(summary, { score: 140, count: 3, revealedCount: 1 })
})

test('玩家端提示和看答案必须走服务端事实接口', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../pages/play/index.js'), 'utf8')
  const view = fs.readFileSync(path.resolve(__dirname, '../../pages/play/index.wxml'), 'utf8')

  assert.match(source, /\/api\/play\/puzzle\/hint/)
  assert.match(source, /\/api\/play\/puzzle\/reveal/)
  assert.match(source, /usedHints: Array\.isArray\(n\.usedHints\)/)
  assert.match(source, /finishPuzzleBest: Number\(this\._puzzlePersonalBest\) \|\| 0/)
  assert.match(view, /当前最高[^<]*解谜分/)
  assert.match(view, /finishPuzzleScore/)
  assert.match(view, /finishPuzzleBest > 0/)
})
