'use strict'

/**
 * 第二轮拍板 17:足迹分享卡点开直接看那条足迹。
 *
 * 轨迹只存在分享者本机(roam_sessions)。客户端上传分享设置裁剪后的真实坐标,
 * 服务端在落库前统一量化为粗粒度快照;分享 path 带随机令牌,接收页凭令牌只读。
 * ⚠️ 上传的轨迹必须与分享卡同源:clipSavedTrackForSharing + limitTrack。
 *
 * 失效:清空本机足迹时 revoke(删掉本人全部快照)。revoke 没成功就按账号记一个待办标记,
 * 下次发布前先补做;补不成就不发布新快照 —— 否则补做的 revoke 会把刚发出去的新链接一起删掉,
 * 而旧的、按旧设置裁剪的链接反倒一直能看。
 */
const { clipSavedTrackForSharing, readSharePrivacy, VISIBILITY } = require('./roam-route-privacy.js')
const { limitTrack } = require('./roam-track-simplify.js')

const REVOKE_PENDING_PREFIX = 'roam_share_revoke_pending:'
const TOKEN_RE = /^[a-f0-9]{32}$/

function send(app, options) {
  return new Promise((resolve) => {
    app.sendRequest(Object.assign({ hideLoading: true, silentError: true }, options, {
      success: (res) => resolve(res || {}),
      successStatusAbnormal: () => resolve({ code: 'http', unknown: true }),
      fail: () => resolve({ code: 'fail', unknown: true }),
    }))
  })
}

const isOk = (res) => !!res && (res.code === 200 || res.code === '200')

function numberOrNull(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? number : null
}

/** 分享卡上看得到的东西,原样组成快照。session = 页面归一后的 s(含 routeName/time)。 */
function buildSharePayload(session, privacy) {
  const clipped = limitTrack(clipSavedTrackForSharing((session && session.track) || [], privacy))
  const track = clipped.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) }))
  const pois = ((session && session.pois) || [])
    .filter((poi) => poi && typeof poi === 'object')
    .slice(0, 50)
    .map((poi) => {
      const row = { name: String(poi.name || ''), cat: String(poi.cat || ''), catLabel: String(poi.catLabel || '') }
      if (Number.isFinite(Number(poi.lat)) && Number.isFinite(Number(poi.lng)) && poi.lat !== '' && poi.lat != null) {
        row.lat = Number(poi.lat)
        row.lng = Number(poi.lng)
      }
      return row
    })
  const shops = numberOrNull(session && session.shops)
  return {
    routeName: String((session && session.routeName) || ''),
    time: String((session && session.time) || ''),
    distance: numberOrNull(session && session.distance),
    explorePct: numberOrNull(session && session.explorePct),
    shops: shops !== null && Number.isInteger(shops) ? shops : null,
    medal: String((session && session.medal) || ''),
    shopMedalName: String((session && session.shopMedalName) || ''),
    track,
    pois,
  }
}

/** 待办标记按账号分:A 作废失败留下的标记,不能被 B 登录后「补作废 B 自己的」顺手清掉。 */
function revokePendingKey(app) {
  return REVOKE_PENDING_PREFIX + String((app && typeof app.getUserID === 'function' && app.getUserID()) || '')
}

function readRevokePending(app, storage) {
  try { return storage.getStorageSync(revokePendingKey(app)) === 1 } catch (_) { return true }
}

function writeRevokePending(app, storage, pending) {
  try {
    if (pending) storage.setStorageSync(revokePendingKey(app), 1)
    else storage.removeStorageSync(revokePendingKey(app))
  } catch (_) {}
}

/** 作废本人全部分享快照。返回 Promise<boolean>;false 时待办标记留着,下次发布前补做。 */
function revokeShareSnapshots(app, storage) {
  writeRevokePending(app, storage, true)
  return send(app, { url: '/api/roam/share/revoke', method: 'POST', data: {} }).then((res) => {
    if (!isOk(res)) return false
    writeRevokePending(app, storage, false)
    return true
  })
}

/** Promise<{ token, reason }>:reason = '' | 'private' | 'revoke-pending' | 'failed'。 */
function publishShareSnapshot(app, storage, session) {
  const privacy = readSharePrivacy(storage)
  if (privacy.visibility === VISIBILITY.PRIVATE) return Promise.resolve({ token: '', reason: 'private' })
  const clientTs = Number(session && session.ts)
  if (!Number.isSafeInteger(clientTs) || clientTs <= 0) return Promise.resolve({ token: '', reason: 'failed' })
  const ready = readRevokePending(app, storage) ? revokeShareSnapshots(app, storage) : Promise.resolve(true)
  return ready.then((revoked) => {
    if (!revoked) return { token: '', reason: 'revoke-pending' }
    return send(app, {
      url: '/api/roam/share/snapshot',
      method: 'POST',
      data: { clientTs, snapshot: JSON.stringify(buildSharePayload(session, privacy)) },
    }).then((res) => {
      const token = isOk(res) && res.data && res.data.token
      return TOKEN_RE.test(token || '') ? { token, reason: '' } : { token: '', reason: 'failed' }
    })
  })
}

/** 接收方读取。Promise<{ state: 'ready'|'gone'|'error', session }>:
 *  gone = 服务端明确说没有(分享者已作废/令牌不对);error = 没读到(断网/网关),可重试。 */
function readShareSnapshot(app, token) {
  if (!TOKEN_RE.test(String(token || ''))) return Promise.resolve({ state: 'gone', session: null })
  // 匿名可读的 GET 单独写成字面量调用,供 GET 权限矩阵逐条核对(不经 send 包装)。
  return new Promise((resolve) => {
    app.sendRequest({
      url: '/api/roam/share/snapshot', method: 'GET', data: { token }, hideLoading: true, silentError: true,
      success: (res) => resolve(isOk(res) && res.data && typeof res.data === 'object' && !Array.isArray(res.data)
        ? { state: 'ready', session: res.data } : { state: 'gone', session: null }),
      successStatusAbnormal: () => resolve({ state: 'error', session: null }),
      fail: () => resolve({ state: 'error', session: null }),
    })
  })
}

module.exports = {
  revokePendingKey,
  buildSharePayload,
  publishShareSnapshot,
  revokeShareSnapshots,
  readShareSnapshot,
}
