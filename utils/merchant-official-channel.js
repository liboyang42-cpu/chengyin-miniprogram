function trimNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number).replace(/\.0+$/, '') : '';
}

function rewardText(invite) {
  if (Number(invite.shareMode) === 1 && invite.shareRate != null) return '分成 ' + trimNumber(invite.shareRate) + '%';
  if (Number(invite.shareMode) === 2 && invite.fixedFee != null) return '固定 ¥' + trimNumber(invite.fixedFee) + '/人';
  if (Number(invite.shareMode) === 0) return '资源支持';
  return '报酬待官方确认';
}

function stageText(invite) {
  if (Number(invite.status) === 2) return '已拒绝';
  if (Number(invite.status) === 5) return '已过期';
  if (Number(invite.status) === 0) return '待你确认';
  if (Number(invite.status) === 1 && Number(invite.auditStatus) === 1) return '已中标承接';
  if (Number(invite.status) === 1 && Number(invite.auditStatus) === 2) return '本轮未中标';
  if (Number(invite.status) === 1) return '待后台确认';
  return '状态待确认';
}

function timeText(value) {
  if (!value) return '截止时间待官方确认';
  const date = new Date(typeof value === 'string' ? value.replace(/-/g, '/') : value);
  if (Number.isNaN(date.getTime())) return String(value);
  return '截止 ' + (date.getMonth() + 1) + '月' + date.getDate() + '日';
}

function decorateInvite(invite) {
  return Object.assign({}, invite, {
    title: invite.title || '官方活动',
    reward: rewardText(invite),
    stage: stageText(invite),
    deadline: timeText(invite.expireTime),
    actionable: Number(invite.status) === 0,
  });
}

function handlePayload(id, status, reason) {
  const payload = { id: Number(id), status: Number(status) };
  if (Number(status) === 2) {
    const normalized = String(reason || '').trim();
    if (!normalized) throw new Error('请填写拒绝原因');
    payload.handleReason = normalized;
  }
  return payload;
}

function isMerchantRecruitableEvent(event) {
  const status = Number(event && event.status);
  const policy = event && event.fulfillmentPolicy;
  return (status === 1 || status === 2)
    && (policy === 'OPTIONAL_PARTNERS' || policy === 'REQUIRED_FULFILLMENT');
}

// F21(2026-09-15 产品裁决 A 案「缺口期间从商家招募口径撤下或标缺口」;本仓选标缺口):
// 后端 listPublic/detail 的 recruitmentBlocked=true 表示必须承接模式的关键承接方缺失。
// 2026-09-17 用户拍板(裁定 C):主标固定「信息不全」,副文案以后端 recruitmentBlockedReason
// 为准(与发布检查同源),缺失时用裁决原文兜底。商家招募列表与玩家公开列表共用这一份文案。
const GAP_LABEL = '信息不全';
const GAP_REASON_FALLBACK = '关键承接方缺失，待补位';

function recruitmentGapLabel(event) {
  return event && event.recruitmentBlocked === true ? GAP_LABEL : '';
}

function recruitmentGapText(event) {
  if (!event || event.recruitmentBlocked !== true) return '';
  const reason = String(event.recruitmentBlockedReason == null ? '' : event.recruitmentBlockedReason).trim();
  return reason || GAP_REASON_FALLBACK;
}

function decorateRecruitableEvent(event) {
  return Object.assign({}, event, {
    recruitmentGapLabel: recruitmentGapLabel(event),
    recruitmentGapText: recruitmentGapText(event),
  });
}

module.exports = {
  decorateInvite, handlePayload, isMerchantRecruitableEvent, decorateRecruitableEvent,
  recruitmentGapLabel, recruitmentGapText,
};
