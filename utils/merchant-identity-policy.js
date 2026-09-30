function text(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  var parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAllowedState(value) {
  return Number.isInteger(value) && value >= 0 && value <= 2;
}

function normalizeApplication(source) {
  if (!isRecord(source) || source.id === null || source.id === undefined || source.id === '') return null;
  var id = numberValue(source.id);
  var status = numberValue(source.status);
  var accountStatus = numberValue(source.accountStatus);
  if (!Number.isFinite(id) || id <= 0 || !isAllowedState(status) || !isAllowedState(accountStatus)) return null;
  return Object.assign({}, source, { id: id, status: status, accountStatus: accountStatus });
}

function resolveApplicationResponse(res) {
  if (!isRecord(res) || !(res.code === 200 || res.code === '200')) return null;
  if ((res.data === null || res.data === undefined) && res.applicationState === 'NONE') {
    return { kind: 'none', data: null };
  }
  var application = normalizeApplication(res.data);
  return application ? { kind: 'application', data: application } : null;
}

function normalizeOwnedClubs(rows) {
  if (!Array.isArray(rows)) return null;
  var clubs = [];
  for (var index = 0; index < rows.length; index += 1) {
    var club = rows[index];
    if (!isRecord(club)
        || club.id === null || club.id === undefined || club.id === '') return null;
    var id = numberValue(club.id);
    var delFlag = club.delFlag === null || club.delFlag === undefined || club.delFlag === '' ? 0 : numberValue(club.delFlag);
    var status = numberValue(club.status);
    if (!Number.isFinite(id) || id <= 0 || !Number.isInteger(delFlag) || (delFlag !== 0 && delFlag !== 1)
        || !isAllowedState(status)) return null;
    if (delFlag !== 0) continue;
    var canTransfer = status === 1;
    var statusText = '状态待确认，暂不能移交';
    var badgeVariant = 'neutral';
    if (canTransfer) {
      statusText = '已生效，须先移交';
      badgeVariant = 'warning';
    } else if (status === 0) {
      statusText = '待审核，暂不能移交';
    } else if (status === 2) {
      statusText = '审核未通过，需先处置';
      badgeVariant = 'danger';
    }
    clubs.push({
      id: id,
      name: text(club.name) || ('俱乐部 #' + id),
      status: status,
      canTransfer: canTransfer,
      statusText: statusText,
      badgeVariant: badgeVariant
    });
  }
  return clubs;
}

function decorateApplication(source) {
  var normalized = normalizeApplication(source);
  if (!normalized) return null;
  var status = normalized.status;
  var accountStatus = normalized.accountStatus;
  var disabled = accountStatus === 2;
  var active = status === 1 && accountStatus === 1;
  var rejected = status === 2;
  var statusLabel = '状态待确认';
  var statusText = '申请状态暂时无法确认，请稍后重新检查。';
  var badgeVariant = 'neutral';
  var timelineClass = '';
  var timelineText = '等待上一步完成';
  if (disabled) {
    statusLabel = '账号已停用';
    // R9-35：只读平台停用专用字段 disableReason。reson 是审核驳回原因，两者不复用 ——
    // 复用会把历史驳回原因（如「执照模糊」）误展示成停用原因。
    statusText = '商家账号已停用，经营功能暂不可用。'
      + (text(normalized.disableReason) ? '停用原因：' + text(normalized.disableReason) + '。' : '平台暂未填写停用原因。')
      + '请等待平台复核。';
    badgeVariant = 'danger';
    timelineClass = 'rej';
    timelineText = '账号已停用';
  } else if (active) {
    statusLabel = '已生效';
    statusText = '商家身份已生效，可以进入商家中心使用经营功能。';
    badgeVariant = 'success';
    timelineClass = 'done';
    timelineText = '已生效';
  } else if (rejected) {
    statusLabel = '已驳回';
    statusText = '本次申请未通过。' + (text(normalized.reson) || '请完善资料后重新提交。');
    badgeVariant = 'danger';
    timelineClass = 'rej';
    timelineText = '未通过';
  } else if (status === 1) {
    statusLabel = '待启用';
    statusText = '资料审核已通过；完成主理人移交等身份条件后，商家账号才会生效。';
    timelineText = '待身份条件完成';
  } else if (status === 0) {
    statusLabel = '审核中';
    statusText = '我们正在审核你的资料，预计 1-3 个工作日内完成。';
    badgeVariant = 'warning';
  }
  return Object.assign({}, normalized, {
    status: status,
    accountStatus: accountStatus,
    statusLabel: statusLabel,
    statusText: statusText,
    badgeVariant: badgeVariant,
    timelineClass: timelineClass,
    timelineText: timelineText,
    canReapply: rejected && !disabled
  });
}

module.exports = { normalizeOwnedClubs, decorateApplication, resolveApplicationResponse };
