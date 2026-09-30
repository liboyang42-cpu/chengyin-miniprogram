'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { bindPlayerRoamMemory, createPlayerRoamMemory } = require('../../utils/roam-player-memory.js')

function memoryStorage(initial) {
  const values = { ...(initial || {}) }
  return {
    getStorageSync(key) { return values[key] },
    setStorageSync(key, value) { values[key] = value },
    snapshot() { return JSON.parse(JSON.stringify(values)) },
  }
}

test('漫游探索记忆按玩家隔离，同设备切换账号不会串迷雾与历史', () => {
  const storage = memoryStorage({
    roam_tiles: { legacy: 1 },
    roam_reveals: [{ lat: 31.2, lng: 121.5 }],
    roam_sessions: [{ ts: 1 }],
  })
  const playerA = createPlayerRoamMemory('101', storage)
  const playerB = createPlayerRoamMemory('202', storage)

  playerA.writeTiles({ aTile: 1 }, 17)
  playerA.writeReveals([{ lat: 31.21, lng: 121.51 }])
  playerA.writeSessions([{ ts: 10101 }])

  assert.deepEqual(playerA.readTiles(), { tiles: { aTile: 1 }, serverCursor: 17 })
  assert.deepEqual(playerA.readReveals(), [{ lat: 31.21, lng: 121.51 }])
  assert.deepEqual(playerA.readSessions(), [{ ts: 10101 }])
  assert.deepEqual(playerB.readTiles(), { tiles: {}, serverCursor: 0 })
  assert.deepEqual(playerB.readReveals(), [])
  assert.deepEqual(playerB.readSessions(), [])

  const snapshot = storage.snapshot()
  assert.deepEqual(snapshot.roam_tiles, { legacy: 1 }, '不可信旧共享缓存不得认领给当前玩家')
  assert.ok(snapshot['roam_memory_v1:101:tiles'])
  assert.equal(snapshot['roam_memory_v1:202:tiles'], undefined)
})

test('缺少玩家身份时探索记忆读空且拒绝写入', () => {
  const storage = memoryStorage()
  const anonymous = createPlayerRoamMemory('', storage)

  assert.deepEqual(anonymous.readTiles(), { tiles: {}, serverCursor: 0 })
  assert.deepEqual(anonymous.readSessions(), [])
  assert.equal(anonymous.writeTiles({ shouldNotPersist: 1 }, 9), false)
  assert.deepEqual(storage.snapshot(), {})
})

test('页面生命周期绑定首次玩家，切号后旧页面不会改写新玩家记忆桶', () => {
  const storage = memoryStorage()
  let playerId = '101'
  const app = { getUserID: () => playerId }
  const page = {}

  const playerA = bindPlayerRoamMemory(page, app, storage)
  playerId = '202'
  const stillPlayerA = bindPlayerRoamMemory(page, app, storage)
  stillPlayerA.writeTiles({ aTile: 1 }, 3)

  assert.equal(stillPlayerA, playerA)
  assert.equal(stillPlayerA.playerId, '101')
  assert.deepEqual(storage.snapshot()['roam_memory_v1:101:tiles'], {
    tiles: { aTile: 1 }, serverCursor: 3,
  })
  assert.equal(storage.snapshot()['roam_memory_v1:202:tiles'], undefined)
})

test('首次登录前绑定的匿名页可在取得玩家身份后升级一次', () => {
  const storage = memoryStorage()
  let playerId = ''
  const app = { getUserID: () => playerId }
  const page = {}

  assert.equal(bindPlayerRoamMemory(page, app, storage).playerId, '')
  playerId = '101'
  const player = bindPlayerRoamMemory(page, app, storage)
  player.writeTiles({ firstLoginTile: 1 }, 1)

  assert.equal(player.playerId, '101')
  assert.ok(storage.snapshot()['roam_memory_v1:101:tiles'])
})
