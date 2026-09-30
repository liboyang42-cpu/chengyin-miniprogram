// Phase 1.1 会话快照存储。
//
// 职责单一:维护七个会话字段在「内存(target)/Storage」之间的一致性。不发任何网络请求。
//
// 设计要点:target 默认绑定 app.globalData 同一对象引用 —— setter 写入即反映到 globalData,
// 因此现有大量「直接读 globalData.authorization / globalData.open_id」的代码(sendRequest、
// firstLogin、getUserRole 三级回退等)无需改动即自动保持同步。
//
// 字段名与 Storage key 同名(沿用 app.js 既有约定),故字段列表同时充当 key 列表。
// 持久化采用同步写(setStorageSync):相比原 6 个 setter 的异步 wx.setStorage,消除了
// 「setStorage 异步、getStorageSync 同步读」之间的读后写时序裂缝,是安全的局部改进,
// 不改变「内存+Storage 双写」这一对外契约。

var SESSION_FIELDS = [
  'user_type',
  'user_id',
  'authorization',
  'open_id',
  'avatar',
  'nickname',
  'role',
];
var AUTH_ISSUED_AT_KEY = 'authorization_issued_at';
var AUTH_EXPIRES_AT_KEY = 'authorization_expires_at';

function createSessionStore(options) {
  options = options || {};
  // 存储提供方:测试注入 options.wx 桩;生产回退到全局 wx。
  // 注意:局部变量不能叫 wx,否则 `typeof wx` 会指向被提升的局部变量(undefined)而非全局 wx,
  // 导致生产环境(未注入 options.wx)解析为 null —— 这正是单测掩盖、真机才暴露的 bug。
  var storage = options.wx || options.storage || (typeof wx !== 'undefined' ? wx : null);
  var target = options.target || {};
  var onClear = options.onClear;
  var now = options.now || Date.now;
  var defaultTokenTtlMs = Math.max(60 * 1000, Number(options.defaultTokenTtlMs) || 24 * 60 * 60 * 1000);

  if (!storage) {
    throw new Error('session-store: 缺少 wx 存储提供方');
  }

  function set(field, value) {
    target[field] = value;
    storage.setStorageSync(field, value);
  }

  function get(field) {
    return target[field];
  }

  function jwtExpiresAt(token) {
    try {
      var part = String(token || '').split('.')[1];
      if (!part) return 0;
      var base64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) base64 += '=';
      var json = '';
      if (typeof atob === 'function') json = atob(base64);
      else if (typeof storage.base64ToArrayBuffer === 'function') {
        var bytes = new Uint8Array(storage.base64ToArrayBuffer(base64));
        for (var i = 0; i < bytes.length; i++) json += String.fromCharCode(bytes[i]);
      }
      var exp = json && JSON.parse(json).exp;
      return Number(exp) > 0 ? Number(exp) * 1000 : 0;
    } catch (e) { return 0; }
  }

  function clearAuthMetadata() {
    storage.removeStorageSync(AUTH_ISSUED_AT_KEY);
    storage.removeStorageSync(AUTH_EXPIRES_AT_KEY);
  }

  function restoreStorageValue(key, value) {
    if (value === undefined || value === null || value === '') storage.removeStorageSync(key);
    else storage.setStorageSync(key, value);
  }

  return {
    target: target,

    // 登录成功要么整份身份落地，要么回滚到旧快照。页面不能看到“新 token + 旧 role”之类半账号。
    applySnapshot: function (snapshot) {
      snapshot = snapshot || {};
      var next = {};
      var previousTarget = {};
      var previousStorage = {};
      for (var i = 0; i < SESSION_FIELDS.length; i++) {
        var field = SESSION_FIELDS[i];
        next[field] = snapshot[field] === undefined || snapshot[field] === null ? '' : snapshot[field];
        previousTarget[field] = Object.prototype.hasOwnProperty.call(target, field) ? target[field] : undefined;
        previousStorage[field] = storage.getStorageSync(field);
      }
      var previousIssuedAt = storage.getStorageSync(AUTH_ISSUED_AT_KEY);
      var previousExpiresAt = storage.getStorageSync(AUTH_EXPIRES_AT_KEY);
      try {
        for (var j = 0; j < SESSION_FIELDS.length; j++) {
          storage.setStorageSync(SESSION_FIELDS[j], next[SESSION_FIELDS[j]]);
        }
        var issuedAt = now();
        storage.setStorageSync(AUTH_ISSUED_AT_KEY, issuedAt);
        storage.setStorageSync(AUTH_EXPIRES_AT_KEY,
          jwtExpiresAt(next.authorization) || issuedAt + defaultTokenTtlMs);
        for (var k = 0; k < SESSION_FIELDS.length; k++) {
          target[SESSION_FIELDS[k]] = next[SESSION_FIELDS[k]];
        }
      } catch (error) {
        for (var r = 0; r < SESSION_FIELDS.length; r++) {
          var rollbackField = SESSION_FIELDS[r];
          try { restoreStorageValue(rollbackField, previousStorage[rollbackField]); } catch (ignored) {}
          if (previousTarget[rollbackField] === undefined) delete target[rollbackField];
          else target[rollbackField] = previousTarget[rollbackField];
        }
        try { restoreStorageValue(AUTH_ISSUED_AT_KEY, previousIssuedAt); } catch (ignored) {}
        try { restoreStorageValue(AUTH_EXPIRES_AT_KEY, previousExpiresAt); } catch (ignored) {}
        throw error;
      }
    },

    // 启动恢复:仅在 Storage 值为真时写回,复刻 `if (x = getStorageSync(key)) ...` 的「空值不覆盖」语义。
    restore: function () {
      var storedToken = storage.getStorageSync('authorization');
      if (storedToken) {
        var expiresAt = Number(storage.getStorageSync(AUTH_EXPIRES_AT_KEY));
        if (expiresAt > 0 && expiresAt <= now()) {
          this.clearSession();
          return;
        }
        if (!expiresAt) {
          var issuedAt = now();
          storage.setStorageSync(AUTH_ISSUED_AT_KEY, issuedAt);
          storage.setStorageSync(AUTH_EXPIRES_AT_KEY, jwtExpiresAt(storedToken) || issuedAt + defaultTokenTtlMs);
        }
      }
      for (var i = 0; i < SESSION_FIELDS.length; i++) {
        var field = SESSION_FIELDS[i];
        var v = storage.getStorageSync(field);
        if (v) {
          target[field] = v;
        }
      }
    },

    // 七组命名 setter/getter(与 app.js 既有方法名一一对应,便于委托)
    setAuthorization: function (v) {
      set('authorization', v);
      if (!v) { clearAuthMetadata(); return; }
      var issuedAt = now();
      storage.setStorageSync(AUTH_ISSUED_AT_KEY, issuedAt);
      storage.setStorageSync(AUTH_EXPIRES_AT_KEY, jwtExpiresAt(v) || issuedAt + defaultTokenTtlMs);
    },
    getAuthorization: function () { return get('authorization'); },
    setUserID: function (v) { set('user_id', v); },
    getUserID: function () { return get('user_id'); },
    setOpenID: function (v) { set('open_id', v); },
    getOpenID: function () { return get('open_id'); },
    setUserType: function (v) { set('user_type', v); },
    getUserType: function () { return get('user_type'); },
    setAvatar: function (v) { set('avatar', v); },
    getAvatar: function () { return get('avatar'); },
    setNickname: function (v) { set('nickname', v); },
    getNickname: function () { return get('nickname'); },
    // role 保留空值守卫(复刻 setUserRole 的 `if (!role) return`),避免把空角色写进单一真源
    setUserRole: function (role) {
      if (!role) return;
      set('role', role);
    },
    getUserRole: function () { return get('role'); },

    // 清空会话:仅清七个会话 key(内存+Storage),不动 debug_user_view 等非会话键。
    clearSession: function () {
      var clearedIdentity = { userId: target.user_id || storage.getStorageSync('user_id') || '' };
      for (var i = 0; i < SESSION_FIELDS.length; i++) {
        var field = SESSION_FIELDS[i];
        delete target[field];
        storage.removeStorageSync(field);
      }
      clearAuthMetadata();
      if (typeof onClear === 'function') onClear(clearedIdentity);
    },
  };
}

module.exports = {
  createSessionStore: createSessionStore,
  SESSION_FIELDS: SESSION_FIELDS,
  AUTH_ISSUED_AT_KEY: AUTH_ISSUED_AT_KEY,
  AUTH_EXPIRES_AT_KEY: AUTH_EXPIRES_AT_KEY
};
