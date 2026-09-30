// Phase 2 身份策略 identity-policy —— 先写失败测试(TDD RED)。
//
// 纯函数,不读 Storage、不发网络。输入后端快照 + 可选开发视角,输出展示身份与能力判断。
//
// 契约/决策:
//  - resolveRole 严格镜像后端 RoleServiceImpl.resolveRole:role 非空优先;否则 user_type==2→merchant、其余→player。
//  - 开发视角 debug_user_view==='user' 只影响展示(强制玩家视角),绝不改业务身份;与现有 index 的
//    `debug!=='user'` 语义一致(契约#37/#38)。角色全集 = player/club/merchant。
//  - can:布尔位 true 才放行;列表位(nodeTypes 数组)传 value 判包含、不传判非空。
//  - reachedLimit:**无权限快照(未拉到 role-info)时 fail-closed**(视为已达上限,拦截发布);
//    已加载但 quota=null 视为不限(放行);否则 used>=max。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../../utils/identity/identity-policy.js');

// ---- resolveRole(镜像后端)----
test('resolveRole:role 非空时直接返回(role 优先)', () => {
  assert.equal(policy.resolveRole({ role: 'club', userType: 2 }), 'club');
  assert.equal(policy.resolveRole({ role: 'merchant', userType: 1 }), 'merchant');
});

test('resolveRole:role 为空时 user_type==2 → merchant', () => {
  assert.equal(policy.resolveRole({ role: '', userType: 2 }), 'merchant');
  assert.equal(policy.resolveRole({ role: '', userType: '2' }), 'merchant'); // 松散匹配字符串
});

test('resolveRole:role 为空且非商户 → player', () => {
  assert.equal(policy.resolveRole({ role: '', userType: 1 }), 'player');
  assert.equal(policy.resolveRole({}), 'player');
  assert.equal(policy.resolveRole({ role: null, userType: null }), 'player');
});

// ---- isMerchantView / isClubView(role 优先 + debug 仅展示)----
test('isMerchantView:真实商户(role=merchant)→ true', () => {
  assert.equal(policy.isMerchantView({ role: 'merchant', userType: 2 }), true);
});

test('isMerchantView:role 为空但 user_type==2(过渡兜底)→ true', () => {
  assert.equal(policy.isMerchantView({ role: '', userType: 2 }), true);
});

test('isMerchantView:debug_user_view=user 强制玩家视角 → false(不改真实身份)', () => {
  assert.equal(policy.isMerchantView({ role: 'merchant', userType: 2, debugView: 'user' }), false);
});

test('isMerchantView:玩家 → false', () => {
  assert.equal(policy.isMerchantView({ role: 'player', userType: 1 }), false);
});

test('isClubView:role=club 且非 debug=user → true;debug=user → false', () => {
  assert.equal(policy.isClubView({ role: 'club' }), true);
  assert.equal(policy.isClubView({ role: 'club', debugView: 'user' }), false);
  assert.equal(policy.isClubView({ role: 'merchant' }), false);
});

// ---- can ----
test('can:布尔位 true 放行、false/缺失拒绝', () => {
  assert.equal(policy.can({ canCreateTheme: true }, 'canCreateTheme'), true);
  assert.equal(policy.can({ canCreateTheme: false }, 'canCreateTheme'), false);
  assert.equal(policy.can({}, 'canCreateTheme'), false);
});

// ⚠️ nodeTypes 本身已在 X03 停止下发（/api/role/info 不再返回它，键集合由
// ApiRoleInfoContractTest 钉住）。这条用例验的是 can() 的**列表位机制**本身，
// 拿 nodeTypes 只是当例子 —— 别据此以为它还是个活的能力位。
test('can:列表位机制(以 nodeTypes 为例) 传 value 判包含、不传判非空', () => {
  const perm = { nodeTypes: ['scan', 'quiz'] };
  assert.equal(policy.can(perm, 'nodeTypes', 'scan'), true);
  assert.equal(policy.can(perm, 'nodeTypes', 'gps'), false);
  assert.equal(policy.can(perm, 'nodeTypes'), true);
  assert.equal(policy.can({ nodeTypes: [] }, 'nodeTypes'), false);
});

// ---- reachedLimit(fail-closed)----
test('reachedLimit:无权限快照 → fail-closed(true,拦截)', () => {
  assert.equal(policy.reachedLimit({}, {}, 'maxThemes', 'themes'), true);
  assert.equal(policy.reachedLimit(null, null, 'maxThemes', 'themes'), true);
});

test('reachedLimit:已加载且 quota=null → 不限(false)', () => {
  const perm = { maxThemes: null, canCreateTheme: true };
  assert.equal(policy.reachedLimit(perm, { themes: 999 }, 'maxThemes', 'themes'), false);
});

test('reachedLimit:已加载且 used>=max → true;used<max → false', () => {
  const perm = { maxThemes: 2, canCreateTheme: true };
  assert.equal(policy.reachedLimit(perm, { themes: 2 }, 'maxThemes', 'themes'), true);
  assert.equal(policy.reachedLimit(perm, { themes: 1 }, 'maxThemes', 'themes'), false);
  assert.equal(policy.reachedLimit(perm, {}, 'maxThemes', 'themes'), false); // used 缺失记 0
});
