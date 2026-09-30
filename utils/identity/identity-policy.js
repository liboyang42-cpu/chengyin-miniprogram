// Phase 2 身份策略(纯函数)。
//
// 单一解释层:输入后端快照({role,userType} 或 permission/usage)+ 可选开发视角,
// 输出展示身份与能力判断。不读 Storage、不发网络,便于单测与跨页面一致复用。
// roleGuard 负责拉取/缓存,本模块负责解释(决策:务实拆分,roleGuard 委托这里)。

// 镜像后端 RoleServiceImpl.resolveRole:role 非空优先;否则 user_type==2→merchant、其余→player。
function resolveRole(snap) {
  snap = snap || {};
  if (snap.role) return snap.role;
  if (snap.userType == 2) return 'merchant'; // 松散匹配:storage 里可能是 number 2 或字符串 '2'
  return 'player';
}

// 展示用有效身份:debug_user_view==='user' 强制玩家视角(仅展示,不改业务身份);
// 与现有 index 的 `debug!=='user'` 语义一致。正式版由调用方不传 debugView 来忽略该键。
function effectiveRole(snap) {
  snap = snap || {};
  if (snap.debugView === 'user') return 'player';
  return resolveRole(snap);
}

function isMerchantView(snap) {
  return effectiveRole(snap) === 'merchant';
}

function isClubView(snap) {
  return effectiveRole(snap) === 'club';
}

// 能力模型(2026-06-27):club 是能力不是默认视角。isClubLeader 同时兼容旧 role='club' 和新 M1 isClubLeader 快照。
function isClubLeader(snap) {
  snap = snap || {};
  if (snap.isClubLeader === true) return true;
  // fallback:旧 storage 可能只有 role 字段(未部署 M1 前);role='club' 即主理人能力
  return (snap.role || '') === 'club';
}

// 能力位:布尔位 true 才放行;列表位(数组,如 nodeTypes)传 value 判包含、不传判非空。
function can(permission, cap, value) {
  permission = permission || {};
  const v = permission[cap];
  if (Array.isArray(v)) return value == null ? v.length > 0 : v.indexOf(value) > -1;
  return v === true;
}

// 是否有权限快照(后端下发的是全集,有任意键即视为已加载;空对象/空值 = 未拉到)。
function hasSnapshot(permission) {
  return !!permission && Object.keys(permission).length > 0;
}

// 数值额度上限:null=不限。
function quota(permission, key) {
  permission = permission || {};
  return permission[key];
}

// 是否已达上限:
//  - 无权限快照(未拉到 role-info)→ fail-closed(true,拦截发布,避免越权);
//  - 已加载且 max==null → 不限(false);
//  - 否则 used(usage[usageKey]||0) >= max。
function reachedLimit(permission, usage, quotaKey, usageKey) {
  if (!hasSnapshot(permission)) return true; // fail-closed
  const max = quota(permission, quotaKey);
  if (max == null) return false;
  const used = (usage || {})[usageKey] || 0;
  return used >= max;
}

module.exports = {
  resolveRole: resolveRole,
  effectiveRole: effectiveRole,
  isMerchantView: isMerchantView,
  isClubView: isClubView,
  isClubLeader: isClubLeader,
  can: can,
  quota: quota,
  hasSnapshot: hasSnapshot,
  reachedLimit: reachedLimit,
};
