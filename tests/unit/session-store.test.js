// Phase 1.1 会话快照存储 —— 先写失败测试(TDD RED)。
//
// 契约(摘自 Phase 1 不可破坏契约 #13/#15):
//  - 七字段与同名 Storage key:user_type/user_id/authorization/open_id/avatar/nickname/role
//  - restore() 从 Storage 恢复到 target(=globalData 同一对象);空/falsy 值不覆盖已有默认值
//  - setter 双写:同时更新 target 与 Storage;target 即 globalData,直接读 globalData 的代码自动同步
//  - clearSession() 同时清内存(target)与 Storage 的七个会话 key
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createSessionStore, SESSION_FIELDS, AUTH_ISSUED_AT_KEY, AUTH_EXPIRES_AT_KEY,
} = require('../../utils/session/session-store.js');

// 内存版 wx storage 桩
function makeWx(initial) {
  const store = Object.assign({}, initial);
  return {
    _store: store,
    getStorageSync: (k) => (k in store ? store[k] : ''),
    setStorageSync: (k, v) => { store[k] = v; },
    removeStorageSync: (k) => { delete store[k]; },
  };
}

test('生产回退:未注入 wx 时使用全局 wx(防自遮蔽 bug 回归)', () => {
  // 复刻真机场景:app.js 调用 createSessionStore({ target }) 不传 wx。
  // 历史 bug:局部 `var wx` 自遮蔽使 `typeof wx` 永为 'undefined',解析为 null 抛错。
  const saved = global.wx;
  global.wx = makeWx({ authorization: 'GTOK' });
  try {
    const target = {};
    const store = createSessionStore({ target }); // 不传 wx
    store.restore();
    assert.equal(target.authorization, 'GTOK');     // 走到全局 wx 才会有值
    store.setOpenID('oid-x');
    assert.equal(global.wx.getStorageSync('open_id'), 'oid-x');
  } finally {
    if (saved === undefined) delete global.wx; else global.wx = saved;
  }
});

test('SESSION_FIELDS 恰为七个会话字段', () => {
  assert.deepEqual(
    SESSION_FIELDS.slice().sort(),
    ['authorization', 'avatar', 'nickname', 'open_id', 'role', 'user_id', 'user_type'].sort()
  );
});

test('restore: 从 Storage 恢复全部七字段到 target', () => {
  const wx = makeWx({
    user_type: 2, user_id: '42', authorization: 'tok', open_id: 'oid',
    avatar: 'a.png', nickname: '阿岚', role: 'merchant',
  });
  const target = {};
  const store = createSessionStore({ wx, target });
  store.restore();
  assert.equal(target.user_type, 2);
  assert.equal(target.authorization, 'tok');
  assert.equal(target.role, 'merchant');
  assert.equal(target.nickname, '阿岚');
});

test('restore: 空/falsy 值不覆盖 target 已有默认值', () => {
  const wx = makeWx({ authorization: '', role: '' }); // 空串模拟未登录
  const target = { authorization: 'EXISTING', role: 'player' };
  const store = createSessionStore({ wx, target });
  store.restore();
  // 空串不得覆盖既有值(复刻 `if (x = getStorageSync()) ...` 语义)
  assert.equal(target.authorization, 'EXISTING');
  assert.equal(target.role, 'player');
});

test('setter 双写:同时更新 target 与 Storage', () => {
  const wx = makeWx({});
  const target = {};
  const store = createSessionStore({ wx, target });
  store.setAuthorization('newtok');
  assert.equal(target.authorization, 'newtok');         // 内存
  assert.equal(wx.getStorageSync('authorization'), 'newtok'); // Storage
});

test('applySnapshot 任一字段持久化失败时回滚整份身份，不留下半个新账号', () => {
  const wx = makeWx({
    user_type: 1, user_id: '7', authorization: 'OLD', open_id: '',
    avatar: 'old.png', nickname: '旧用户', role: 'player',
  });
  const originalSet = wx.setStorageSync;
  let failed = false;
  wx.setStorageSync = (key, value) => {
    if (key === 'nickname' && !failed) {
      failed = true;
      throw new Error('storage full');
    }
    originalSet(key, value);
  };
  const target = {
    user_type: 1, user_id: '7', authorization: 'OLD', open_id: '',
    avatar: 'old.png', nickname: '旧用户', role: 'player',
  };
  const store = createSessionStore({ wx, target });

  assert.throws(() => store.applySnapshot({
    user_type: 2, user_id: '9', authorization: 'NEW', open_id: '',
    avatar: 'new.png', nickname: '新用户', role: 'merchant',
  }), /storage full/);

  assert.deepEqual(target, {
    user_type: 1, user_id: '7', authorization: 'OLD', open_id: '',
    avatar: 'old.png', nickname: '旧用户', role: 'player',
  });
  assert.equal(wx.getStorageSync('authorization'), 'OLD');
  assert.equal(wx.getStorageSync('user_id'), '7');
  assert.equal(wx.getStorageSync('role'), 'player');
})

test('target 即 globalData:setter 反映到同一对象,直接读者自动同步', () => {
  const wx = makeWx({});
  const globalData = { authorization: '', open_id: '' };
  const store = createSessionStore({ wx, target: globalData });
  store.setOpenID('oid-1');
  store.setAuthorization('tok-1');
  // 模拟 firstLogin 的直接读:globalData.open_id && globalData.authorization
  assert.ok(globalData.open_id && globalData.authorization);
});

test('getter 读取 target 当前值', () => {
  const wx = makeWx({});
  const target = {};
  const store = createSessionStore({ wx, target });
  store.setUserType(2);
  store.setUserRole('merchant');
  assert.equal(store.getUserType(), 2);
  assert.equal(store.getUserRole(), 'merchant');
});

test('setUserRole 空值守卫:不写空 role(复刻 if(!role) return)', () => {
  const wx = makeWx({ role: 'merchant' });
  const target = { role: 'merchant' };
  const store = createSessionStore({ wx, target });
  store.setUserRole('');
  assert.equal(target.role, 'merchant');                 // 未被清空
  assert.equal(wx.getStorageSync('role'), 'merchant');
});

test('clearSession: 同时清内存与 Storage 的七个会话 key', () => {
  const wx = makeWx({
    user_type: 2, user_id: '42', authorization: 'tok', open_id: 'oid',
    avatar: 'a.png', nickname: '阿岚', role: 'merchant',
    debug_user_view: 'user', // 非会话键,不应被会话清理误删
  });
  const target = { user_type: 2, authorization: 'tok', role: 'merchant' };
  const store = createSessionStore({ wx, target });
  store.clearSession();
  for (const f of SESSION_FIELDS) {
    assert.equal(wx.getStorageSync(f), '', `storage ${f} 应被清`);
    assert.ok(!target[f], `target ${f} 应被清`);
  }
  assert.equal(wx.getStorageSync('debug_user_view'), 'user'); // 非会话键保留
});

test('clearSession 必须同步调用权限缓存清理钩子', () => {
  const wx = makeWx({ authorization: 'tok', user_id: '42' });
  let cleared = 0;
  const store = createSessionStore({ wx, target: {}, onClear: () => { cleared += 1; } });
  store.clearSession();
  assert.equal(cleared, 1);
});

test('token 写入携带 issuedAt/expiry，启动时本地淘汰已过期会话', () => {
  const clock = 1_000_000;
  const wx = makeWx({});
  const target = {};
  const store = createSessionStore({ wx, target, now: () => clock, defaultTokenTtlMs: 60_000 });
  store.setUserID('42');
  store.setAuthorization('opaque-token');
  assert.equal(wx.getStorageSync(AUTH_ISSUED_AT_KEY), clock);
  assert.equal(wx.getStorageSync(AUTH_EXPIRES_AT_KEY), clock + 60_000);

  const restored = {};
  const expiredStore = createSessionStore({ wx, target: restored, now: () => clock + 60_001 });
  expiredStore.restore();
  assert.equal(restored.authorization, undefined);
  assert.equal(wx.getStorageSync('authorization'), '');
  assert.equal(wx.getStorageSync(AUTH_EXPIRES_AT_KEY), '');
});
