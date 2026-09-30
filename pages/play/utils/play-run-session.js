'use strict'

// R9-21:暂停会话的本地快照;第二轮拍板 22 起同时双写服务端 /api/play/run-session,
// 换手机登录同账号也能续(本机没有快照、或服务端那份更新时用服务端的)。
// 暂停态在离页时落盘、重进时恢复;恢复前由页面用服务端权威态(时间窗 / 路线状态 /
// 通关 / 游戏会话结束)把门 —— 服务端说结束就不恢复,清掉本机那份并在服务端留 ENDED 墓碑
// (另一台设备重进时墓碑比它本机快照新,就不再把已结束的局恢复回来)。
const KEY_PREFIX = 'play_paused_run_v2:'
const LEGACY_KEY_PREFIX = 'play_paused_run_v1:'
// 一次步行行程不可能按天计;超过这个值的快照只可能是脏数据,不当成可恢复会话。
const MAX_PAUSED_SECONDS = 7 * 24 * 3600

function exactScopeId(value) {
  const text = String(value == null ? '' : value).trim()
  return /^[1-9]\d{0,18}$/.test(text) ? text : ''
}

/** 活动场次按 activityId、自玩按 topicId 隔离:同一主题换一场活动不串用旧计时。
 *  两样都没有(参数缺失/预览)时返回空串 —— 空 key 不算会话,不落盘也不读。 */
function pausedRunStorageKey(scope) {
  const memberId = exactScopeId(scope && scope.memberId)
  const activityId = exactScopeId(scope && scope.activityId)
  const topicId = exactScopeId(scope && scope.topicId)
  if (!memberId) return ''
  if (activityId) return KEY_PREFIX + 'm' + memberId + ':a' + activityId
  if (topicId) return KEY_PREFIX + 'm' + memberId + ':t' + topicId
  return ''
}

function legacyPausedRunStorageKey(scope) {
  const activityId = exactScopeId(scope && scope.activityId)
  const topicId = exactScopeId(scope && scope.topicId)
  if (activityId) return LEGACY_KEY_PREFIX + 'a' + activityId
  if (topicId) return LEGACY_KEY_PREFIX + 't' + topicId
  return ''
}

/** 只认「暂停中 + 合法用时」的快照形状;running/畸形/越界一律当没有,
 *  否则脏数据会被恢复成看起来正常的假会话。 */
function normalizePausedRun(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (raw.state !== 'paused') return null
  const elapsedSeconds = raw.elapsedSeconds
  if (!Number.isSafeInteger(elapsedSeconds)) return null
  if (elapsedSeconds < 0 || elapsedSeconds > MAX_PAUSED_SECONDS) return null
  return {
    state: 'paused',
    elapsedSeconds,
    savedAt: Number.isSafeInteger(raw.savedAt) && raw.savedAt > 0 ? raw.savedAt : 0,
  }
}

function readPausedRun(wx, scope) {
  const key = pausedRunStorageKey(scope)
  if (!key || !wx || typeof wx.getStorageSync !== 'function') return null
  const legacyKey = legacyPausedRunStorageKey(scope)
  try { if (legacyKey && typeof wx.removeStorageSync === 'function') wx.removeStorageSync(legacyKey) } catch (error) {}
  let raw = null
  try { raw = wx.getStorageSync(key) } catch (error) { return null }
  return normalizePausedRun(raw)
}

function writePausedRun(wx, scope, elapsedSeconds, now) {
  const key = pausedRunStorageKey(scope)
  if (!key || !wx || typeof wx.setStorageSync !== 'function') return false
  const record = normalizePausedRun({ state: 'paused', elapsedSeconds, savedAt: now })
  if (!record) return false
  try { wx.setStorageSync(key, record); return true } catch (error) { return false }
}

function clearRunSession(wx, scope) {
  const key = pausedRunStorageKey(scope)
  if (!key || !wx || typeof wx.removeStorageSync !== 'function') return false
  try {
    wx.removeStorageSync(key)
    const legacyKey = legacyPausedRunStorageKey(scope)
    if (legacyKey) wx.removeStorageSync(legacyKey)
    return true
  } catch (error) { return false }
}

// ===== 第二轮拍板 22:服务端那一份(request = pages/play 的 req(url, method, data) → Promise<res>) =====
/** 与本机 key 同一优先级:有 activityId 按场次,否则按自玩 topicId;都没有 = 不算会话。 */
function runSessionRequestScope(scope) {
  const activityId = exactScopeId(scope && scope.activityId)
  if (activityId) return { activityId }
  const topicId = exactScopeId(scope && scope.topicId)
  return topicId ? { topicId } : null
}

function isOk(res) {
  return !!res && (res.code === 200 || res.code === '200')
}

function saveServerPausedRun(request, scope, elapsedSeconds, now) {
  const params = runSessionRequestScope(scope)
  const record = normalizePausedRun({ state: 'paused', elapsedSeconds, savedAt: now })
  if (!params || !record || typeof request !== 'function') return Promise.resolve(false)
  return request('/api/play/run-session/save', 'POST', Object.assign({
    elapsedSeconds: record.elapsedSeconds, savedAt: record.savedAt,
  }, params)).then(isOk, () => false)
}

function clearServerRunSession(request, scope, now) {
  const params = runSessionRequestScope(scope)
  if (!params || typeof request !== 'function' || !Number.isSafeInteger(now) || now <= 0) return Promise.resolve(false)
  return request('/api/play/run-session/clear', 'POST', Object.assign({ savedAt: now }, params)).then(isOk, () => false)
}

/** ok:false = 没读到(断网/报错),调用方沿用本机快照;ok:true + record:null = 服务端没有可继续的会话,
 *  其中 endedAt>0 表示服务端有结束墓碑(比本机快照新就该作废本机那份)。 */
function readServerPausedRun(request, scope) {
  const params = runSessionRequestScope(scope)
  if (!params || typeof request !== 'function') return Promise.resolve({ ok: false, record: null })
  return request('/api/play/run-session', 'GET', params).then((res) => {
    if (!isOk(res)) return { ok: false, record: null }
    const data = res.data
    if (!data) return { ok: true, record: null, endedAt: 0 }
    if (data.runState === 'ENDED') {
      const endedAt = Number(data.savedAt)
      return { ok: true, record: null, endedAt: Number.isSafeInteger(endedAt) && endedAt > 0 ? endedAt : 0 }
    }
    return { ok: true, endedAt: 0, record: normalizePausedRun({
      state: data.runState === 'PAUSED' ? 'paused' : '',
      elapsedSeconds: Number(data.elapsedSeconds),
      savedAt: Number(data.savedAt),
    }) }
  }, () => ({ ok: false, record: null }))
}

/** 两台设备各有一份时取较晚落盘的那份;savedAt 缺失(旧快照)视为最旧。 */
function newerPausedRun(local, remote) {
  if (!local) return remote || null
  if (!remote) return local
  return remote.savedAt > local.savedAt ? remote : local
}

module.exports = {
  MAX_PAUSED_SECONDS,
  pausedRunStorageKey,
  normalizePausedRun,
  readPausedRun,
  writePausedRun,
  clearRunSession,
  runSessionRequestScope,
  saveServerPausedRun,
  clearServerRunSession,
  readServerPausedRun,
  newerPausedRun,
}
