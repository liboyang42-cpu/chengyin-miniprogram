'use strict'

const PREFIX = 'roam_memory_v1'

function normalizePlayerId(playerId) {
  const value = String(playerId == null ? '' : playerId).trim()
  return value && value !== '0' ? value : ''
}

function createPlayerRoamMemory(playerId, storage) {
  const owner = normalizePlayerId(playerId)
  const target = storage || {}

  function key(kind) {
    return owner ? `${PREFIX}:${owner}:${kind}` : ''
  }

  function read(kind, fallback) {
    const result = readResult(kind)
    return result.ok && result.value != null && result.value !== '' ? result.value : fallback
  }

  function readResult(kind) {
    const storageKey = key(kind)
    if (!storageKey || typeof target.getStorageSync !== 'function') return { ok: true, value: undefined }
    try {
      return { ok: true, value: target.getStorageSync(storageKey) }
    } catch (_) {
      return { ok: false, value: undefined }
    }
  }

  function write(kind, value) {
    const storageKey = key(kind)
    if (!storageKey || typeof target.setStorageSync !== 'function') return false
    try {
      target.setStorageSync(storageKey, value)
      return true
    } catch (_) {
      return false
    }
  }

  return {
    playerId: owner,
    readTiles() {
      const state = read('tiles', null)
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return { tiles: {}, serverCursor: 0 }
      }
      const tiles = state.tiles && typeof state.tiles === 'object' && !Array.isArray(state.tiles)
        ? state.tiles : {}
      const cursor = Number(state.serverCursor)
      return { tiles, serverCursor: Number.isSafeInteger(cursor) && cursor > 0 ? cursor : 0 }
    },
    writeTiles(tiles, serverCursor) {
      const values = tiles && typeof tiles === 'object' && !Array.isArray(tiles) ? tiles : {}
      const cursor = Number(serverCursor)
      return write('tiles', {
        tiles: values,
        serverCursor: Number.isSafeInteger(cursor) && cursor > 0 ? cursor : 0,
      })
    },
    readReveals() {
      const value = read('reveals', [])
      return Array.isArray(value) ? value : []
    },
    writeReveals(value) {
      return write('reveals', Array.isArray(value) ? value : [])
    },
    readRecoveryState() {
      const result = readResult('recovery')
      return { ok: result.ok, record: result.value == null || result.value === '' ? null : result.value }
    },
    writeRecovery(value) {
      try {
        const serialized = JSON.stringify(value)
        if (!write('recovery', JSON.parse(serialized))) return false
        const result = readResult('recovery')
        return result.ok && JSON.stringify(result.value) === serialized
      } catch (_) { return false }
    },
    readSessions() {
      return this.readSessionState().sessions
    },
    readSessionState() {
      const result = readResult('sessions')
      if (!result.ok) return { ok: false, sessions: [] }
      const value = result.value
      if (value == null || value === '') return { ok: true, sessions: [] }
      return Array.isArray(value) ? { ok: true, sessions: value } : { ok: false, sessions: [] }
    },
    writeSessions(value) {
      try {
        const serialized = JSON.stringify(Array.isArray(value) ? value : [])
        if (!write('sessions', JSON.parse(serialized))) return false
        const result = readResult('sessions')
        return result.ok && JSON.stringify(result.value) === serialized
      } catch (_) { return false }
    },
    /* 清空本机缓存(原型 setScreen 的最后一行「不影响已上传的记录」)。
       只清这一个玩家桶里的四样本机数据 —— 服务端那份(roam_tile / roam_session / 邮票)
       一条都不动,所以那句「不影响已上传的记录」是真的。
       逐个 scope 写空值而不是 clearStorage:后者会把别的功能的本机数据一起端掉。
       ⚠️ recovery 必须一起清:确认框写着「会清掉本次记录」,而原来不清它 ⇒ 清完再进漫游
       仍弹「已找回本次漫游记录」,用户看到的和刚做过的操作自相矛盾。 */
    clearLocal() {
      const done = [this.writeTiles({}, 0), this.writeReveals([]), this.writeSessions([]),
        this.writeRecovery(null)]
      return done.every(Boolean)
    },
  }
}

function currentPlayerRoamMemory(app, storage) {
  const playerId = app && typeof app.getUserID === 'function' ? app.getUserID() : ''
  return createPlayerRoamMemory(playerId, storage)
}

function bindPlayerRoamMemory(holder, app, storage) {
  if (!holder || typeof holder !== 'object') return currentPlayerRoamMemory(app, storage)
  const playerId = app && typeof app.getUserID === 'function' ? normalizePlayerId(app.getUserID()) : ''
  if (!holder._roamMemory || (!holder._roamMemory.playerId && playerId)) {
    holder._roamMemory = createPlayerRoamMemory(playerId, storage)
  }
  return holder._roamMemory
}

module.exports = { bindPlayerRoamMemory, createPlayerRoamMemory, currentPlayerRoamMemory }
