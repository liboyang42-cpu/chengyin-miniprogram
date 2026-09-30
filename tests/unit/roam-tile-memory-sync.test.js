'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { syncRoamTileMemory } = require('../../utils/roam-tile-memory-sync.js')

function fakeMemory(initial) {
  let state = initial
  return {
    readTiles() { return state },
    writeTiles(tiles, serverCursor) {
      state = { tiles: { ...tiles }, serverCursor }
      return true
    },
    state() { return state },
  }
}

test('迷雾记忆从已保存游标增量拉取全部分页，并逐页持久化', async () => {
  const memory = fakeMemory({ tiles: { oldTile: 1 }, serverCursor: 10 })
  const calls = []
  const painted = []
  const pages = [
    { tiles: ['newTileA', 'newTileB'], nextAfterId: 12, hasMore: true },
    { tiles: ['newTileC'], nextAfterId: 13, hasMore: false },
  ]

  const result = await syncRoamTileMemory({
    memory,
    pageSize: 2,
    fetchPage(afterId, limit) {
      calls.push([afterId, limit])
      return Promise.resolve(pages.shift())
    },
    onPage(tiles) { painted.push(tiles) },
  })

  assert.deepEqual(calls, [[10, 2], [12, 2]])
  assert.deepEqual(painted, [['newTileA', 'newTileB'], ['newTileC']])
  assert.deepEqual(result, {
    tiles: { oldTile: 1, newTileA: 1, newTileB: 1, newTileC: 1 },
    serverCursor: 13,
  })
  assert.deepEqual(memory.state(), result)
})

test('服务端声称还有下一页却不推进游标时立即失败，不能死循环', async () => {
  const memory = fakeMemory({ tiles: {}, serverCursor: 7 })

  await assert.rejects(() => syncRoamTileMemory({
    memory,
    fetchPage: () => Promise.resolve({ tiles: ['same'], nextAfterId: 7, hasMore: true }),
  }), /游标没有推进/)
})

test('分页请求期间仅在页面内存新点亮、尚未延迟落盘的格子不会被旧快照覆盖', async () => {
  const memory = fakeMemory({ tiles: { oldTile: 1 }, serverCursor: 10 })
  let localTiles = { oldTile: 1 }

  const result = await syncRoamTileMemory({
    memory,
    readPendingTiles: () => localTiles,
    fetchPage() {
      localTiles = { oldTile: 1, gpsTile: 1 }
      return Promise.resolve({ tiles: ['serverTile'], nextAfterId: 11, hasMore: false })
    },
  })

  assert.deepEqual(result, {
    tiles: { oldTile: 1, gpsTile: 1, serverTile: 1 },
    serverCursor: 11,
  })
  assert.deepEqual(memory.state(), result)
})
