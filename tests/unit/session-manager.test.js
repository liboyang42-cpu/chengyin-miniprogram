// Phase 1.2 单航班登录与续期 —— 先写失败测试(TDD RED)。
//
// 契约(摘自 Phase 1 不可破坏契约 #6/#14/#17/#20 + 假ready 修复 #19/#20):
//  - 单航班:并发 login/refresh 只触发一次 wx.login(并发 401 共享一次换 token)
//  - 成功:token 取响应顶层 token、其余取安全 data.*(双层 data),不接收/持久化 OpenID
//  - 正式版失败:返回显式失败结果,绝不伪装成已认证、绝不写会话
//  - 开发版:wx.login 失败 / 网络失败 / 无 data 时走 useDevUser 兜底
//  - 缓存短路:已有 user_id+authorization 直接成功,不发网络登录
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionManager } = require('../../utils/session/session-manager.js');

// 记录式会话桩
function makeSession(initial) {
  const snap = Object.assign({ open_id: '', authorization: '', role: '' }, initial);
  return {
    snap,
    setOpenID: (v) => { snap.open_id = v; },
    setAuthorization: (v) => { snap.authorization = v; },
    setUserID: (v) => { snap.user_id = v; },
    setUserType: (v) => { snap.user_type = v; },
    setAvatar: (v) => { snap.avatar = v; },
    setNickname: (v) => { snap.nickname = v; },
    setUserRole: (v) => { if (v) snap.role = v; },
    getOpenID: () => snap.open_id,
    getUserID: () => snap.user_id,
    getAuthorization: () => snap.authorization,
  };
}

const okBody = {
  token: 'TOKEN_TOP', // 注意:token 在顶层
  data: { id: '7', userType: 2, avatar: 'a.png', nickname: '阿岚', role: 'merchant' },
};

function makeDeps(over) {
  const calls = { wxLogin: 0, exchange: 0, dev: 0 };
  const deps = {
    session: makeSession(),
    wxLogin: async () => { calls.wxLogin++; return { code: 'CODE' }; },
    exchangeCode: async () => { calls.exchange++; return okBody; },
    isDevEnv: () => false,
    useDevUser: () => { calls.dev++; },
  };
  return { deps: Object.assign(deps, over), calls };
}

test('login 成功:只落地安全会话字段,不持久化 OpenID', async () => {
  const { deps } = makeDeps();
  const mgr = createSessionManager(deps);
  const r = await mgr.login();
  assert.equal(r.ok, true);
  assert.equal(r.authed, true);
  assert.equal(deps.session.snap.authorization, 'TOKEN_TOP'); // 顶层 token
  assert.equal(deps.session.snap.open_id, '');
  assert.equal(deps.session.snap.user_id, '7');
  assert.equal(deps.session.snap.role, 'merchant');
});

test('支持原子快照的会话存储必须一次落地完整身份', async () => {
  const session = makeSession();
  let snapshot;
  session.applySnapshot = (value) => { snapshot = value; Object.assign(session.snap, value); };
  const { deps } = makeDeps({ session });
  const mgr = createSessionManager(deps);
  const result = await mgr.login();

  assert.equal(result.ok, true);
  assert.deepEqual(snapshot, {
    authorization: 'TOKEN_TOP',
    user_id: '7',
    user_type: 2,
    open_id: '',
    avatar: 'a.png',
    nickname: '阿岚',
    role: 'merchant',
  });
})

test('升级旧会话:初始化即清除历史 OpenID,不等待重新登录', () => {
  const { deps } = makeDeps({ session: makeSession({ open_id: 'legacy-openid' }) });

  createSessionManager(deps);

  assert.equal(deps.session.snap.open_id, '');
});

test('ensureSession 缓存短路:已有 user_id+authorization 不发网络登录', async () => {
  const { deps, calls } = makeDeps({ session: makeSession({ user_id: '7', authorization: 'tok' }) });
  const mgr = createSessionManager(deps);
  const r = await mgr.ensureSession();
  assert.equal(r.ok, true);
  assert.equal(r.cached, true);
  assert.equal(calls.wxLogin, 0);
  assert.equal(calls.exchange, 0);
});

test('正式版失败(无 data):显式失败,不写会话,不伪装已认证', async () => {
  const { deps } = makeDeps({ exchangeCode: async () => ({ msg: '登录失败' }) });
  const mgr = createSessionManager(deps);
  const r = await mgr.login();
  assert.equal(r.ok, false);
  assert.equal(r.authed, false);
  assert.equal(deps.session.snap.authorization, ''); // 未写
});

test('畸形 200 缺 token/id/受控 role 时 fail closed，且不部分写入会话', async () => {
  const cases = [
    { data: { id: '7', userType: 2, role: 'merchant' } },
    { token: 'TOKEN_TOP', data: { userType: 2, role: 'merchant' } },
    { token: 'TOKEN_TOP', data: { id: '7', userType: 2, role: 'root' } },
    { token: 'TOKEN_TOP', data: { id: '7', userType: 99, role: 'player' } },
  ];
  for (const body of cases) {
    const { deps } = makeDeps({ exchangeCode: async () => body });
    const mgr = createSessionManager(deps);
    const r = await mgr.login();
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalidPayload');
    assert.equal(deps.session.snap.authorization, '');
    assert.equal(deps.session.snap.user_id, undefined);
  }
});

test('正式版 wx.login 失败:显式失败', async () => {
  const { deps } = makeDeps({ wxLogin: async () => { throw new Error('login fail'); } });
  const mgr = createSessionManager(deps);
  const r = await mgr.login();
  assert.equal(r.ok, false);
  assert.equal(r.authed, false);
});

test('wx.login 永不回调时在 deadline 后失败并释放单航班锁', async () => {
  const { deps } = makeDeps({
    wxLogin: () => new Promise(() => {}),
    loginTimeoutMs: 10,
  });
  const mgr = createSessionManager(deps);
  const r = await mgr.login();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'wxLoginFail');
  assert.equal(mgr.isLoggingIn(), false);
});

test('换 token 请求永不回调时在 deadline 后失败并释放单航班锁', async () => {
  const { deps } = makeDeps({
    exchangeCode: () => new Promise(() => {}),
    loginTimeoutMs: 10,
  });
  const mgr = createSessionManager(deps);
  const r = await mgr.login();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'networkFail');
  assert.equal(mgr.isLoggingIn(), false);
});

test('开发版无 data:走 useDevUser 兜底', async () => {
  const { deps, calls } = makeDeps({ isDevEnv: () => true, exchangeCode: async () => ({ msg: 'x' }) });
  const mgr = createSessionManager(deps);
  const r = await mgr.login();
  assert.equal(r.ok, true);
  assert.equal(calls.dev, 1);
});

test('单航班:两个并发 login 只触发一次 wx.login', async () => {
  let resolveExchange;
  const gate = new Promise((res) => { resolveExchange = res; });
  const { deps, calls } = makeDeps({
    exchangeCode: async () => { calls.exchange++; await gate; return okBody; },
  });
  const mgr = createSessionManager(deps);
  const p1 = mgr.login();
  const p2 = mgr.login(); // 并发,inFlight 仍在
  resolveExchange();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(calls.wxLogin, 1, 'wx.login 应只调一次');
});

test('单航班释放:前一轮结束后可再次登录', async () => {
  const { deps, calls } = makeDeps();
  const mgr = createSessionManager(deps);
  await mgr.login();
  await mgr.login();
  assert.equal(calls.wxLogin, 2);
});

// —— dev 兜底只给一次(2026-08-10) ——
// 旧行为:开发版登录失败恒 useDevUser + 谎报 ok:true。401 触发 reLogin 时也照兜,
// request-client 于是拿同一张 dev token 重试 ⇒ 每个请求都白跑 401→重登→再 401。
// 生产日志实测:近期 122 次认证失败 tokenPrefix 全是 dev-token。
test('dev 兜底只给一次:已经在用 dev token 还被拒,如实失败不再兜底', async () => {
  const { deps, calls } = makeDeps({
    isDevEnv: () => true,
    exchangeCode: async () => ({ msg: '微信服务暂时不可用' }), // 无 data ⇒ 走 devFallback 路径
    devToken: 'dev-token',
    session: makeSession({ authorization: 'dev-token', user_id: '7' }),
  });
  const mgr = createSessionManager(deps);
  const r = await mgr.refresh();
  assert.equal(r.ok, false, '已在用 dev token 还被拒 ⇒ 必须如实失败,否则调用方会拿假 token 重试');
  assert.equal(r.reason, 'devTokenRejected');
  assert.equal(calls.dev, 0, '不该再写一次 mock 会话');
});

test('dev 兜底首次仍然生效:没在用 dev token 时照常兜底', async () => {
  const { deps, calls } = makeDeps({
    isDevEnv: () => true,
    exchangeCode: async () => ({ msg: '微信服务暂时不可用' }),
    devToken: 'dev-token',
    session: makeSession({ authorization: '' }),   // 还没有任何会话
  });
  const mgr = createSessionManager(deps);
  const r = await mgr.refresh();
  assert.equal(r.ok, true, '首次失败仍应给 mock 会话,保住开发版页面能渲染');
  assert.equal(r.dev, true);
  assert.equal(calls.dev, 1);
});
