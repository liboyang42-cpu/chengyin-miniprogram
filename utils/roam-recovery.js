'use strict'

function exactSessionId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  const text = String(value == null ? '' : value)
  return /^[1-9]\d{0,18}$/.test(text)
    && (text.length < 19 || text <= '9223372036854775807') ? text : ''
}

function validRecovery(record) {
  return record && typeof record === 'object'
    && (/^[a-f0-9]{32}$/.test(record.clientSessionKey || '') || exactSessionId(record.sessionId))
    && (!record.sessionId || exactSessionId(record.sessionId))
    && Array.isArray(record.pendingTiles) && record.pendingTiles.every(t => typeof t === 'string')
    && typeof record.finishRequested === 'boolean'
}

function newSessionKey(platform) {
  return new Promise((resolve, reject) => {
    if (!platform || typeof platform.getRandomValues !== 'function') {
      reject(new Error('当前微信无法生成会话关联，请更新微信后重试'))
      return
    }
    platform.getRandomValues({
      length: 16,
      success(res) {
        const bytes = new Uint8Array(res.randomValues)
        if (bytes.length !== 16) { reject(new Error('会话关联生成失败，请重试')); return }
        resolve(Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''))
      },
      fail() { reject(new Error('会话关联生成失败，请重试')) },
    })
  })
}

module.exports = { exactSessionId, validRecovery, newSessionKey }
