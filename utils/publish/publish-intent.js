'use strict'

// R10-03 广场发布稳定意图键。
//
// 问题:发布丢回包后重试会再 insert 一条(重复帖子/重复审核)。发布锁只能防同页在途连点,
//       挡不住「服务端已提交但客户端未知」后的重试与冷恢复。
// 方案:首写前生成并持久化稳定意图键(request_id),按 账号 + 草稿scope 隔离;
//       同一意图(payload 未变且未成功结算)的重试/冷恢复复用同一个键,服务端据此幂等;
//       payload 变化 = 用户明确的新意图 → 换新键(旧意图痕迹保留,不静默丢弃)。
var STORAGE_PREFIX = 'square_publish_intent_v1:'
var KEY_RE = /^[A-Za-z0-9_-]{16,64}$/

function storageKey(scope, memberId) {
  return STORAGE_PREFIX + String(memberId || 'anon') + ':' + String(scope || 'default')
}

function newKey() {
  var rand = ''
  for (var i = 0; i < 4; i += 1) rand += Math.random().toString(36).slice(2, 10)
  var key = 'sq' + Date.now().toString(36) + rand
  return key.slice(0, 64)
}

// payload 由调用方按固定顺序给出(数组),顺序即语义;同 payload 才复用意图键。
function payloadKey(payload) {
  try {
    return JSON.stringify(payload || [])
  } catch (e) {
    return ''
  }
}

function read(wx, scope, memberId) {
  try {
    var value = wx.getStorageSync(storageKey(scope, memberId))
    return value && typeof value === 'object' && value.key ? value : null
  } catch (e) {
    return null
  }
}

function write(wx, scope, memberId, intent) {
  try {
    wx.setStorageSync(storageKey(scope, memberId), intent)
    return true
  } catch (e) {
    return false
  }
}

function remove(wx, scope, memberId) {
  try {
    wx.removeStorageSync(storageKey(scope, memberId))
  } catch (e) {
  }
}

/**
 * 开始/重试一次发布。返回 { key, reused, payloadChanged, previousUnknown }。
 * - 同 payload 的未决意图(非 success) → 复用 key;
 * - payload 变化 → 换新 key,旧意图挪到 :previous 痕迹位保留;
 * - previousUnknown=true 表示上一条未确认结果仍可能存在,调用方可提示用户。
 */
function begin(wx, options) {
  var scope = options && options.scope
  var memberId = options && options.memberId
  var payload = options && options.payload
  var pk = payloadKey(payload)
  var existing = read(wx, scope, memberId)
  // sending = 上次请求发出后进程被杀/结果未知,与 unknown 同属「未确认、可恢复」;必须提示,别当新发布
  var pendingUnconfirmed = !!existing && (existing.status === 'unknown' || existing.status === 'sending')
  if (existing && KEY_RE.test(String(existing.key)) && existing.payloadKey === pk && existing.status !== 'success') {
    return {
      key: existing.key,
      reused: true,
      payloadChanged: false,
      previousUnknown: pendingUnconfirmed,
    }
  }
  var previousUnknown = pendingUnconfirmed
  if (existing && existing.key && existing.key !== (existing.previousKey || '')) {
    // 明确新意图:旧痕迹另存,便于冷恢复核对「上次可能已发出」,不静默丢
    write(wx, scope + ':previous', memberId, Object.assign({}, existing, { supersededAt: Date.now() }))
  }
  var intent = {
    key: newKey(),
    payloadKey: pk,
    status: 'sending',
    memberId: String(memberId || ''),
    createdAt: Date.now(),
  }
  if (!write(wx, scope, memberId, intent)) {
    // 存储不可用:仍然给出可用键(服务端幂等),只是冷恢复无法复用
    return { key: intent.key, reused: false, payloadChanged: true, previousUnknown: previousUnknown }
  }
  return { key: intent.key, reused: false, payloadChanged: true, previousUnknown: previousUnknown }
}

/** 结算意图:success 清除;rejected/unknown/failed 保留(同 payload 重试继续复用该键)。 */
function settle(wx, scope, memberId, key, status) {
  var current = read(wx, scope, memberId)
  if (!current || String(current.key) !== String(key)) return
  if (status === 'success') {
    remove(wx, scope, memberId)
    return
  }
  write(wx, scope, memberId, Object.assign({}, current, { status: status, settledAt: Date.now() }))
}

/**
 * 丢弃意图键(仅用于服务端明确「该发布已删除,请重新发布」这类终态):
 * 清除当前未决键,旧痕迹挪到 :previous 供核对;下一次同 payload 也会拿新键,
 * 避免同 key 在软删行上永远复用、永远发不出去。
 */
function discard(wx, scope, memberId, key) {
  var current = read(wx, scope, memberId)
  if (!current || String(current.key) !== String(key)) return
  write(wx, scope + ':previous', memberId, Object.assign({}, current, { status: 'discarded', discardedAt: Date.now() }))
  remove(wx, scope, memberId)
}

/** 当前未决意图(非 success),供冷恢复提示;无则 null。 */
function pending(wx, scope, memberId) {
  var current = read(wx, scope, memberId)
  if (!current || current.status === 'success') return null
  return current
}

module.exports = {
  begin: begin,
  settle: settle,
  discard: discard,
  pending: pending,
  read: read,
  payloadKey: payloadKey,
  storageKey: storageKey,
  isIntentKey: function (value) { return KEY_RE.test(String(value || '')) },
}
