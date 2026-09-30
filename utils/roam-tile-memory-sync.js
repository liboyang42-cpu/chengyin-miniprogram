'use strict'

async function syncRoamTileMemory(options) {
  const config = options || {}
  const memory = config.memory
  const fetchPage = config.fetchPage
  const readPendingTiles = typeof config.readPendingTiles === 'function'
    ? config.readPendingTiles : function () { return {} }
  const onPage = typeof config.onPage === 'function' ? config.onPage : function () {}
  const pageSize = Number.isInteger(config.pageSize) && config.pageSize > 0 ? config.pageSize : 1000
  if (!memory || typeof memory.readTiles !== 'function' || typeof memory.writeTiles !== 'function') {
    throw new Error('缺少玩家迷雾记忆存储')
  }
  if (typeof fetchPage !== 'function') throw new Error('缺少迷雾记忆分页读取器')

  const initial = memory.readTiles()
  let tiles = { ...((initial && initial.tiles) || {}) }
  let cursor = Number(initial && initial.serverCursor) || 0

  while (true) {
    const page = await fetchPage(cursor, pageSize)
    if (!page || typeof page !== 'object' || !Array.isArray(page.tiles)) {
      throw new Error('迷雾记忆分页响应无效')
    }
    const next = Number(page.nextAfterId)
    if (!Number.isSafeInteger(next) || next < cursor) throw new Error('迷雾记忆游标无效')
    const latest = memory.readTiles()
    const pending = readPendingTiles()
    tiles = {
      ...((latest && latest.tiles) || {}),
      ...tiles,
      ...(pending && typeof pending === 'object' && !Array.isArray(pending) ? pending : {}),
    }
    page.tiles.forEach((tile) => {
      const key = String(tile == null ? '' : tile).trim()
      if (key) tiles[key] = 1
    })
    if (page.hasMore === true && next <= cursor) throw new Error('迷雾记忆游标没有推进')
    cursor = Math.max(next, Number(latest && latest.serverCursor) || 0)
    if (!memory.writeTiles(tiles, cursor)) throw new Error('迷雾记忆本地持久化失败')
    onPage(page.tiles.slice(), { tiles, serverCursor: cursor })
    if (page.hasMore !== true) return { tiles, serverCursor: cursor }
  }
}

module.exports = { syncRoamTileMemory }
