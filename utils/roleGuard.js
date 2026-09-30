// 三端权限「单一事实源」——缓存 /api/role/info 的 permission，
// 全前端一律用 can()/quota()/reachedLimit() 读，禁止散落 if (role === 'club')。
// 对应专家报告 §3 能力位全集与「原则一：单一权限事实源」。
//
// 职责分工(Phase 2):roleGuard 负责拉取/缓存,能力解释委托纯函数 identity-policy。

const policy = require('./identity/identity-policy.js');

const CACHE_KEY = 'role_permission_cache_v1';
const CACHE_TTL_MS = 10 * 60 * 1000;

let _cache = null; // { role, permission, usage }
let _inFlight = null; // { identityKey, callbacks }

function _tokenFingerprint(token) {
  var text = String(token || '');
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function _identity() {
  try {
    var app = getApp();
    var userId = typeof app.getUserID === 'function' ? app.getUserID() : app.globalData && app.globalData.user_id;
    var token = typeof app.getAuthorization === 'function' ? app.getAuthorization() : app.globalData && app.globalData.authorization;
    if (!userId || !token) return null;
    return { userId: String(userId), fingerprint: _tokenFingerprint(token) };
  } catch (e) { return null; }
}

function _matchesIdentity(cache, identity) {
  var meta = cache && cache._cacheMeta;
  return !!identity && !!meta
    && meta.userId === identity.userId
    && meta.fingerprint === identity.fingerprint
    && Number(meta.expiresAt) > Date.now();
}

function _identityKey(identity) {
  return identity ? identity.userId + ':' + identity.fingerprint : 'anonymous';
}

function _dropCache() {
  _cache = null;
  try { wx.removeStorageSync(CACHE_KEY); } catch (e) {}
}

function _readStorage() {
  var identity = _identity();
  if (_cache && _matchesIdentity(_cache, identity)) return _cache;
  if (_cache) _dropCache();
  try { _cache = wx.getStorageSync(CACHE_KEY) || null; } catch (e) { _cache = null; }
  if (_cache && !_matchesIdentity(_cache, identity)) _dropCache();
  return _cache;
}

// 拉取并缓存；cb(data) 回调（成功用最新，失败回落本地缓存）
function load(cb) {
  const app = getApp();
  const identity = _identity();
  const identityKey = _identityKey(identity);
  if (_inFlight && _inFlight.identityKey === identityKey) {
    if (typeof cb === 'function') _inFlight.callbacks.push(cb);
    return;
  }
  const flight = {
    identityKey: identityKey,
    callbacks: typeof cb === 'function' ? [cb] : []
  };
  _inFlight = flight;
  const finish = function (data) {
    if (_inFlight === flight) _inFlight = null;
    const callbacks = flight.callbacks.slice();
    flight.callbacks.length = 0;
    callbacks.forEach(function (callback) {
      try { callback(data); } catch (e) {}
    });
  };
  app.sendRequest({
    url: '/api/role/info', method: 'POST', hideLoading: true,
    success: function (res) {
      if (res.code == '200' && res.data) {
        var current = _identity();
        if (identity && current && identity.userId === current.userId && identity.fingerprint === current.fingerprint) {
          _cache = Object.assign({}, res.data, {
            _cacheMeta: {
              userId: identity.userId,
              fingerprint: identity.fingerprint,
              expiresAt: Date.now() + CACHE_TTL_MS
            }
          });
          try { wx.setStorageSync(CACHE_KEY, _cache); } catch (e) {}
        }
      }
      // 即使内存里已有缓存也必须经过身份与 TTL 校验；不能用 `_cache || ...`
      // 让旧账号请求的迟到回调绕过 _readStorage()。
      finish(_readStorage());
    },
    fail: function () { finish(_readStorage()); }
  });
}

function role() { const c = _readStorage(); return (c && c.role) || 'player'; }
function permission() { const c = _readStorage(); return (c && c.permission) || {}; }
function usage() { const c = _readStorage(); return (c && c.usage) || {}; }
// 能力快照(M1):首选取存缓存的 isClubLeader,否则 fallback role==='club'(旧版兼容)
function isClubLeader() { const c = _readStorage(); if (c && c.isClubLeader === true) return true; return (c && c.role) === 'club'; }
function ownedClubs() { const c = _readStorage(); return (c && c.ownedClubs) || []; }
function joinedClubIds() { const c = _readStorage(); return (c && c.joinedClubIds) || []; }

// 是否已拿到权限快照(未拉到 role-info 时为 false,供 fail-closed 判断)。
function hasSnapshot() { return policy.hasSnapshot(permission()); }

// 能力位判断(委托 policy):布尔位 true 才放行;列表位 nodeTypes 传 value 判包含、不传判非空。
function can(cap, value) { return policy.can(permission(), cap, value); }

// 数值额度：maxThemes / maxCoupons / maxNodesPerTheme ...（null=不限）
function quota(key) { return policy.quota(permission(), key); }

// 是否已达上限(委托 policy):无权限快照 fail-closed(true);已加载且 max=null 不限;否则 used>=max。
function reachedLimit(quotaKey, usageKey) {
  return policy.reachedLimit(permission(), usage(), quotaKey, usageKey);
}

function clear() {
  _dropCache();
}

module.exports = {
  load: load,
  role: role,
  permission: permission,
  usage: usage,
  isClubLeader: isClubLeader,
  ownedClubs: ownedClubs,
  joinedClubIds: joinedClubIds,
  can: can,
  quota: quota,
  hasSnapshot: hasSnapshot,
  reachedLimit: reachedLimit,
  clear: clear
};
