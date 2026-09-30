const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createPlayerRoamMemory } = require('../../utils/roam-player-memory')

test('恢复记录写入失败可观测，不能假称已经持久化', () => {
  const memory = createPlayerRoamMemory('9', {
    getStorageSync() { return '' }, setStorageSync() { throw new Error('full') },
  })
  assert.equal(memory.writeRecovery({ clientSessionKey: 'a'.repeat(32), pendingTiles: ['wtw3sjq'] }), false)
})

test('同设备冷重进保留待确认操作，不串玩家，不能静默空写成功', () => {
  const values = {}
  const storage = { getStorageSync: k => values[k], setStorageSync: (k, v) => { values[k] = v } }
  const a = createPlayerRoamMemory('9', storage)
  const record = { clientSessionKey: 'a'.repeat(32), sessionId: '9007199254740993', pendingTiles: ['wtw3sjq'], finishRequested: true }
  assert.equal(a.writeRecovery(record), true)
  assert.deepEqual(createPlayerRoamMemory('9', storage).readRecoveryState().record, record)
  assert.equal(createPlayerRoamMemory('10', storage).readRecoveryState().record, null)
  storage.setStorageSync = () => {}
  assert.equal(a.writeRecovery({ ...record, pendingTiles: [] }), false)
})

test('清空本机缓存必须连 recovery 一起清(否则清完再进还提示「已找回」)', () => {
  const values = {}
  const storage = { getStorageSync: k => values[k], setStorageSync: (k, v) => { values[k] = v } }
  const memory = createPlayerRoamMemory('9', storage)
  assert.equal(memory.writeRecovery({ clientSessionKey: 'a'.repeat(32), pendingTiles: ['wtw3sjq'] }), true)
  assert.equal(memory.writeTiles({ wtw3sjq: 1 }, 3), true)

  assert.equal(memory.clearLocal(), true)
  assert.equal(memory.readRecoveryState().record, null, 'recovery 不清 = 确认框写的「会清掉本次记录」是假话')
  assert.deepEqual(memory.readTiles(), { tiles: {}, serverCursor: 0 })
  assert.deepEqual(memory.readSessions(), [])
})
