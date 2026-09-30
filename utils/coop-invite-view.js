/**
 * 协作邀约的展示整形(Figma 02b/02c 列表 + 02d-1~5 详情共用)。
 *
 * 从 pages/coop/list 抽出来,不是为了「复用」好听,是因为列表和详情画的是**同一条邀约**:
 * 条款怎么念、联系方式给不给、倒计时怎么算,两处各写一份就一定会漂。
 *
 * ⚠️ 联系方式的判据在后端(§3.8:只在已接受时下发负责人/电话)。这里只按下发到的字段拼,
 * 前端不自己判条件 —— 再判一次只会两边不一致。
 */
const { toTimestamp } = require('./datetime');

const TYPE_LABEL = ['主题发布者 → 商家', '商家 → 俱乐部', '商家 → 商家承接节点'];
const PARTY_LABEL = { merchant: '商家', club: '俱乐部', talent: '主题发布者', official: '平台' };
const STATUS_LABEL = ['待确认', '已接受', '已拒绝', '已取消', '已顶替', '已过期'];
// 稿 261:277 / 261:349 状态徽章:tone 决定底色字色,icon 走 cy-icon。取消/顶替/过期共用灰调。
const INVITE_BADGE = ['pending:clock', 'accepted:check', 'rejected:warning', 'muted:close-sm', 'muted:close-sm', 'muted:close-sm'];
function badgeOf(spec) {
  const parts = String(spec || 'muted:close-sm').split(':');
  return { badgeTone: parts[0], badgeIcon: parts[1] };
}
function dateOf(value) { return value ? String(value).slice(0, 10) : ''; }

function termsOf(it) {
  if (it.shareMode === 1) return '分成型 · 票款 ' + (it.shareRate != null ? it.shareRate : '?') + '%';
  if (it.shareMode === 2) return '固定型 · ¥' + (it.fixedFee != null ? it.fixedFee : '?') + ' / 核销人头';
  if (it.shareMode === 0) return '引流型 · 无分成';
  return '';
}

function countdownOf(it) {
  if (it.status !== 0 || !it.expireTime) return '';
  const end = toTimestamp(String(it.expireTime));
  const diff = end - Date.now();
  if (isNaN(end)) return '';
  // CU-C-24:expireTime 是这张待确认邀约的有效期(CoopInviteServiceImpl.pendingInviteExpiry:TTL 与截止取早),
  // 不是主题的招募截止(合作池写的「招募截止 MM-DD」)。两者都叫「招募」就成了同屏两个截止日。
  if (diff <= 0) return '邀约已过期';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  return '邀约剩 ' + (d > 0 ? d + ' 天' : h + ' 小时') + '有效';
}

/** 槽位占用(发出的邀约):游戏级看挂起 2/3,主题级看已接受 n/5 */
function slotOf(it, slots) {
  if (!slots) return '';
  if (it.gameId != null && slots.byGame && slots.byGame[it.gameId]) {
    const s = slots.byGame[it.gameId];
    return '本游戏挂起 ' + s.pending + '/' + s.cap;
  }
  if (it.topicId != null && slots.byTopic && slots.byTopic[it.topicId]) {
    const s = slots.byTopic[it.topicId];
    return '本主题已接受 ' + s.accepted + '/' + s.cap;
  }
  return '';
}

function contactOf(it) {
  const p = it.partner;
  if (!p) return '';
  const parts = [];
  if (p.leaderName) parts.push(p.leaderName);
  if (p.phone) parts.push(p.phone);
  return parts.join(' · ');
}

const INVITE_ID_ERROR = '邀约标识无法确认，请刷新后重试';

function parseInviteId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : '';
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return '';
  const digits = value.replace(/^0+/, '');
  const max = '9223372036854775807';
  return digits && (digits.length < max.length || (digits.length === max.length && digits <= max)) ? digits : '';
}

function decorate(arr, slots) {
  return (arr || []).map(function (it, index) {
    const partnerName = (it.partner && it.partner.name) || '';
    const topicText = it.topicName || (it.topicId ? '主题 #' + it.topicId : '');
    const termsText = termsOf(it);
    const legacyReadonly = Number(it.inviteType) === 2;
    // 两个可精确解释的身份必须一致；不把已舍入的 number 变成操作目标。
    const rawId = parseInviteId(it.id);
    const alias = parseInviteId(it.inviteId);
    const conflict = rawId && alias && rawId !== alias;
    const inviteId = conflict ? '' : (alias || rawId);
    const actionId = inviteId && typeof it.id === 'number' && rawId === inviteId ? it.id : inviteId;
    return Object.assign({}, it, badgeOf(INVITE_BADGE[it.status]), {
      id: actionId,
      inviteId: inviteId,
      identityError: inviteId ? '' : INVITE_ID_ERROR,
      rowKey: inviteId || 'unresolved-' + index,
      partnerName: partnerName,
      topicText: topicText,
      partnerContact: contactOf(it),
      partnerPhone: (it.partner && it.partner.phone) || '',
      typeText: it.fromType || it.toType
        ? (PARTY_LABEL[it.fromType] || '发起方') + ' → ' + (PARTY_LABEL[it.toType] || '接收方')
        : (TYPE_LABEL[it.inviteType] || '合作'),
      statusText: STATUS_LABEL[it.status] || '',
      dateText: dateOf(it.topicStartDate),
      timeText: it.createTime ? String(it.createTime).slice(5, 16) : '',
      termsText: termsText,
      legacyReadonly: legacyReadonly,
      decisionReady: !!(partnerName && topicText && termsText),
      countdownText: countdownOf(it),
      slotText: slotOf(it, slots),
      depositDueText: !legacyReadonly && it.depositOwed ? '锁价后待缴 ¥' + (it.depositAmount || 50) + ' 保证金' : '',
      depositRefundPending: !legacyReadonly && !!it.depositRefundPending
    });
  });
}

// 合作池(P0-4 开放报名):俱乐部视角状态 → 文案;canApply = 可发起/重新发起申请
const POOL_STATE_TEXT = {
  open: '可申请',
  applied: '已申请 · 等商家处理',
  invited: '商家已邀约',
  taken: '已被其他俱乐部承接',
  cooped: '合作中',
  // 已转为邀约:主办方同意了,球在俱乐部这边。少了这条会显示成「可申请」——
  // 明明被通过了却像没人理,还会诱导他再申请一次。
  converted: '已通过 · 已生成邀约',
  declined: '已婉拒 · 可再申请',
  withdrawn: '已撤回 · 可再申请'
};

function isPoolList(value) {
  return require('./response-shape.js').isRecordList(value) && value.every(function (item) {
    return item.topicId != null && item.topicId !== ''
      && typeof item.name === 'string' && item.name.trim() !== ''
      && Object.prototype.hasOwnProperty.call(POOL_STATE_TEXT, item.state);
  });
}

function decoratePool(rows) {
  return (rows || []).map(function (it) {
    return Object.assign({}, it, {
      stateText: POOL_STATE_TEXT[it.state] || '',
      canApply: it.state === 'open' || it.state === 'declined' || it.state === 'withdrawn',
      deadlineText: it.recruitDeadline ? '招募截止 ' + String(it.recruitDeadline).slice(5, 10) : ''
    });
  });
}

// 俱乐部承接申请(coop_club_apply.status)→ 收发件箱徽章。映射表同步写在差异表里。
// 0 待处理=待确认 / 1 商家婉拒=已拒绝 / 2 俱乐部撤回=已撤回 / 3 商家已回带条款邀约=已回邀约(不是成单)
const APPLY_STATUS = {
  0: { text: '待确认', badge: 'pending:clock' },
  1: { text: '已拒绝', badge: 'rejected:warning' },
  2: { text: '已撤回', badge: 'muted:close-sm' },
  3: { text: '已回邀约', badge: 'accepted:check' },
};

function isApplyList(value) {
  return require('./response-shape.js').isRecordList(value) && value.every(function (item) {
    return parseInviteId(item.applyId) !== '' && item.topicId != null && item.topicId !== ''
      && Object.prototype.hasOwnProperty.call(APPLY_STATUS, item.status);
  });
}

/** box = received(发布者看:来自俱乐部) / sent(俱乐部看:发给商家) */
function decorateApplies(rows, box) {
  return (rows || []).map(function (it) {
    const st = APPLY_STATUS[it.status];
    const badge = badgeOf(st.badge);
    const peer = box === 'received' ? it.clubName : it.merchantNick;
    return Object.assign({}, it, {
      rowKey: 'apply-' + it.applyId,
      statusText: st.text,
      badgeTone: badge.badgeTone,
      badgeIcon: badge.badgeIcon,
      peerText: peer ? (box === 'received' ? '来自 ' : '发给 ') + peer : '',
      titleText: it.topicName || '主题 #' + it.topicId,
      dateText: dateOf(it.startDate),
      subText: box === 'received' ? '俱乐部申请带队' : '申请带队' + (it.clubName ? ' · ' + it.clubName : ''),
      termsText: it.message ? '留言:' + it.message : '申请只表意向,条款随商家回的邀约走',
    });
  });
}

module.exports = {
  APPLY_STATUS, isApplyList, decorateApplies, badgeOf, INVITE_BADGE,
  TYPE_LABEL, STATUS_LABEL, termsOf, countdownOf, slotOf, contactOf, decorate, parseInviteId, INVITE_ID_ERROR,
  POOL_STATE_TEXT, isPoolList, decoratePool,
};
