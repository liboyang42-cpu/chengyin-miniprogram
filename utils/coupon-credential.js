'use strict'

// 钱包与两种出码入口共用的归属/回包合同，不能用空 owner 的相等证明私产归属。
function currentOwnerId(app) {
  try {
    const value = app && typeof app.getUserID === 'function' ? app.getUserID()
      : app && app.globalData && app.globalData.user_id
    if (typeof value !== 'string' && typeof value !== 'number') return ''
    const owner = String(value).trim()
    return owner && owner !== '0' ? owner : ''
  } catch (e) { return '' }
}

// 0 未使用 / 1 已核销 / 2 已过期 / 3 已失效(平台手动失效;商家停发的券不拦已领,不会出现在这里)
function couponStatus(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3 ? value : null
}

function parseQrReply(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const status = couponStatus(data.useStatus)
  if (status === null) return null
  if (status !== 0) return { status, qr: '', countdown: 0 }
  const qr = typeof data.qrcodeUrl === 'string' ? data.qrcodeUrl.trim() : ''
  const seconds = data.expiresIn
  if (!qr || typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds <= 0 || seconds > 90) return null
  return { status, qr, countdown: seconds }
}

module.exports = { currentOwnerId, couponStatus, parseQrReply }
