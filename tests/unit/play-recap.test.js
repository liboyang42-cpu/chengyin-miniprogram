const test = require('node:test')
const assert = require('node:assert/strict')

const { buildPlayRecap } = require('../../pages/play/recap.js')

test('完赛照片只取当前玩家真实上传，不拿节点封面冒充', () => {
  const result = buildPlayRecap([
    { nodeId: 1, done: true, picUrl: 'me-1.jpg', imgUrl: 'cover-1.jpg' },
    { nodeId: 2, done: true, picUrl: '', imgUrl: 'cover-2.jpg' },
    { nodeId: 3, done: false, picUrl: 'unfinished.jpg', imgUrl: 'cover-3.jpg' },
    { nodeId: 4, done: true, picUrl: 'me-4.jpg', imgUrl: 'cover-4.jpg' }
  ])

  assert.deepEqual(result.photos, [
    { nodeId: 1, picUrl: 'me-1.jpg' },
    { nodeId: 4, picUrl: 'me-4.jpg' }
  ])
  assert.equal(result.canReplayJournal, true)
})

test('没有完成节点时不显示照片或回看入口', () => {
  assert.deepEqual(buildPlayRecap([{ nodeId: 1, done: false, picUrl: 'draft.jpg' }]), {
    photos: [],
    canReplayJournal: false
  })
})
