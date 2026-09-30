/**
 * 主理人清退退款这类「动真钱」的动作,两页共用的四个判据。
 *
 * 2026-09-09 从 pages/club/enroll 抽出来:退款入口按用户裁决从报名名册行内
 * 挪到了核销详情底部,于是同一套判据有了第二个消费方。复制一份过去迟早分叉 ——
 * 而这四条里有三条决定「要不要把界面判成没权限」「回执算不算未知」,
 * 分叉的后果是两页对同一个后端响应给出不同结论。
 */
// ⚠️ 别在模块顶层 getApp():这个模块被两个页面 require,谁先加载不确定,
// 而单测里的宿主也不一定在 require 之前就把 getApp 挂好。用到时再取。

/**
 * 回执未知 = 不能断定这次写有没有落。408 与 5xx 都算,拿不到状态码也算。
 * ⚠️ 未知**不等于失败**:失败可以直接报错让人重试,未知必须去回读对端事实,
 * 否则重试就是重复退款。
 */
function isUnknownHttpStatus(statusCode) {
  if (statusCode == null || statusCode === '') return true;
  const code = Number(statusCode);
  return !Number.isFinite(code) || code === 408 || code >= 500;
}

/** 业务码优先于 HTTP 码:后端惯用 200 包一个 code=403 的体。 */
function permissionFailureCode(value, statusCode) {
  const bodyCode = value && (value.code != null ? value.code : value.statusCode);
  const rawCode = bodyCode != null && [2, 401, 403].includes(Number(bodyCode))
    ? bodyCode
    : statusCode;
  return Number(rawCode);
}

/** 码之外还认文案:有些接口只在 msg 里说「仅主理人可」,码仍是 500。 */
function isPermissionFailure(value, statusCode) {
  const code = permissionFailureCode(value, statusCode);
  const message = String(value && (value.msg || value.message) || '');
  return code === 2 || code === 401 || code === 403
    || /请先登录|登录已|身份已|没有权限|无权|非本人主题|仅(?:俱乐部)?主理人(?:或管理员)?可/.test(message);
}

/**
 * 当前登录身份的指纹。动作发起到回执之间身份可能已经换人
 * (退出重登、切商家态),拿它比一次,免得把上一个人的回执算到这个人头上。
 */
function identityKey() {
  const app = getApp() || {};
  const gd = app.globalData || {};
  const memberId = typeof app.getUserID === 'function' ? app.getUserID() : gd.user_id;
  const role = typeof app.getUserRole === 'function' ? app.getUserRole() : gd.role;
  const userType = typeof app.getUserType === 'function' ? app.getUserType() : gd.user_type;
  return [memberId == null ? '' : memberId, role || '', userType == null ? '' : userType].join('|');
}

module.exports = { isUnknownHttpStatus, permissionFailureCode, isPermissionFailure, identityKey };
