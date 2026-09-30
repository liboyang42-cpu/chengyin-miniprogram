const { chinaParts, toTimestamp } = require('../../../../utils/datetime.js');

const TYPE_TEXT = Object.freeze({
  NOTE: '跟进',
  NOTE_CORRECTION: '更正',
  ARRIVED: '到店',
  REFUNDED: '退款',
  REGISTERED: '报名',
  CAMPAIGN: '触达',
});
const SYSTEM_TAGS = Object.freeze(['ARRIVED', 'REPEAT', 'PENDING', 'REFUNDED']);

function shapeCustomerDetail(raw, expectedId) {
  if (!record(raw) || !record(raw.summary) || !Array.isArray(raw.systemTags)
      || !Array.isArray(raw.merchantTags) || !Array.isArray(raw.timeline)) return null;
  const expectedCustomerMemberId = positiveId(expectedId);
  const customerMemberId = positiveId(raw.summary.customerMemberId);
  if (expectedCustomerMemberId == null || customerMemberId == null) return null;
  if (customerMemberId !== expectedCustomerMemberId) return null;

  const arrivedCount = count(raw.summary.arrivedCount);
  const pendingCount = count(raw.summary.pendingCount);
  const refundedCount = count(raw.summary.refundedCount);
  if (arrivedCount == null || pendingCount == null || refundedCount == null) return null;
  const amount = money(raw.summary.paidAmount);
  if (raw.summary.paidAmount != null && amount == null) return null;

  const systemTags = [];
  for (const value of raw.systemTags) {
    if (!record(value) || SYSTEM_TAGS.indexOf(text(value.code)) < 0 || !text(value.label)) return null;
    systemTags.push({ code: text(value.code), label: text(value.label) });
  }

  const merchantTags = [];
  for (const value of raw.merchantTags) {
    if (!record(value) || positiveId(value.id) == null) return null;
    const tagName = text(value.tagName);
    const tagColor = text(value.tagColor).toUpperCase();
    if (!tagName || !/^#[0-9A-F]{6}$/.test(tagColor)) return null;
    merchantTags.push({ id: positiveId(value.id), tagName, tagColor });
  }

  const timeline = [];
  for (const value of raw.timeline) {
    if (!record(value) || !text(value.key) || !TYPE_TEXT[value.type]) return null;
    timeline.push({
      key: text(value.key),
      type: value.type,
      typeText: TYPE_TEXT[value.type],
      title: text(value.title) || TYPE_TEXT[value.type],
      description: text(value.description),
      occurredAt: text(value.occurredAt) || '',
      occurredAtText: formatTime(value.occurredAt),
      noteId: positiveId(value.noteId),
      noteVersion: count(value.noteVersion),
      correctsNoteId: positiveId(value.correctsNoteId),
      canManageNote: (value.type === 'NOTE' || value.type === 'NOTE_CORRECTION')
        && positiveId(value.noteId) != null && count(value.noteVersion) != null,
    });
  }

  return {
    summary: {
      customerMemberId,
      displayName: text(raw.summary.displayName) || '未留姓名',
      avatar: text(raw.summary.avatar),
      arrivedCount,
      pendingCount,
      refundedCount,
      paidAmount: amount,
      paidAmountText: amount == null ? '无查看权限' : `¥${amount.toFixed(2)}`,
      lastInteractionTimeText: formatTime(raw.summary.lastInteractionTime),
    },
    systemTags,
    merchantTags,
    timeline,
    participation: buildParticipation(timeline),
    history: buildHistory(timeline),
    identityLine: buildIdentityLine(raw.summary.lastInteractionTime),
  };
}

/* 参与记录(Figma 71:312 / 63:309)= 时间线里的报名类事实,按 registration 归并成一行,
 * 取该 registration 最新的一条状态。跟进备注(NOTE/NOTE_CORRECTION)不属于参与记录。 */
const PARTICIPATION_STATUS = Object.freeze({ ARRIVED: '已核销', REFUNDED: '已退款', REGISTERED: '待核销' });

// 时间线"最新"一律按绝对时刻比较, 不按原始字符串字典序(混合 offset 时字典序会选错)。
// 拿不到合法时间的排到最后(-Infinity), 让位给有时间的事实。
function occurredAtEpoch(item) {
  const ts = toTimestamp(item && item.occurredAt);
  return Number.isNaN(ts) ? -Infinity : ts;
}

function buildParticipation(timeline) {
  const latest = new Map();
  for (const item of timeline) {
    if (!PARTICIPATION_STATUS[item.type]) continue;
    const matched = /^registration-(\d+)$/.exec(item.key);
    const groupKey = matched ? `r${matched[1]}` : item.key;
    const prev = latest.get(groupKey);
    // 与 timeline 顺序无关:一律按绝对时刻取最新,拿不到时间的让位给有时间的
    if (!prev || occurredAtEpoch(item) > occurredAtEpoch(prev)) latest.set(groupKey, item);
  }
  const rows = [];
  for (const [groupKey, item] of latest) {
    const when = chinaParts(item.occurredAt);
    rows.push({
      key: groupKey,
      day: when ? String(when.day).padStart(2, '0') : '--',
      month: when ? `${when.month}月` : '',
      title: stripBrackets(item.description) || '线下活动',
      statusText: `${PARTICIPATION_STATUS[item.type]} · 报名记录`,
      occurredAt: item.occurredAt,
    });
  }
  rows.sort((a, b) => occurredAtEpoch(b) - occurredAtEpoch(a));
  return rows;
}

/* 弹窗里的「跟进与触达」= 时间线里**不属于参与记录**的那些(NOTE / NOTE_CORRECTION / CAMPAIGN)。
 * 参与记录只收报名类三种,两边合起来正好是完整 timeline —— 触达记录不会因为删掉
 * 旧「互动时间线」而静默消失(后端 MerchantCrmAppServiceImpl 确实会发 CAMPAIGN 行)。 */
function buildHistory(timeline) {
  return timeline.filter((item) => !PARTICIPATION_STATUS[item.type]);
}

/* 卡片上只露最新一条跟进正文(稿 71:340「备注:喜欢靠窗位置」)。 */
function latestNoteText(timeline) {
  let best = null;
  for (const item of timeline) {
    if (item.type !== 'NOTE' && item.type !== 'NOTE_CORRECTION') continue;
    if (!best || occurredAtEpoch(item) > occurredAtEpoch(best)) best = item;
  }
  return best ? best.description : '';
}

/* 身份副行。稿 71:290 写的是「最近互动 8月26日 · 常带朋友」,但「常带朋友 / 普通客户」
 * 在稿里跟 tags、备注都对不上 —— 那是稿作者写的客户画像,后端没有这个字段。
 * 不拿最新备注去顶替:那句话下面「备注:」那行已经在显示,同屏会出现两次。
 * 只给有真数据支撑的部分;没有互动时走 C 态文案(稿 71:410)。 */
function buildIdentityLine(lastInteractionTime) {
  const when = chinaParts(lastInteractionTime);
  if (!when) return '尚无互动记录';
  return `最近互动 ${when.month}月${when.day}日`;
}

function stripBrackets(value) { return text(value).replace(/^「|」$/g, ''); }

function buildNoteDraft(value) {
  const content = text(value);
  if (!content) return { valid: false, error: '请填写跟进备注' };
  if (content.length > 500) return { valid: false, error: '跟进备注最多500字' };
  return { valid: true, content };
}

function buildTagDraft(nameValue, colorValue) {
  const tagName = text(nameValue);
  const tagColor = (text(colorValue) || '#2E6D5A').toUpperCase();
  if (!tagName) return { valid: false, error: '请填写标签名称' };
  if (tagName.length > 16) return { valid: false, error: '标签最多16字' };
  if (!/^#[0-9A-F]{6}$/.test(tagColor)) return { valid: false, error: '标签颜色无效' };
  return { valid: true, tagName, tagColor };
}

function createNoteRequestId(now, random, sequence) {
  return createRequestId('note', now, random, sequence);
}

function createTagRequestId(now, random, sequence) {
  return createRequestId('tag', now, random, sequence);
}

function createRequestId(kind, now, random, sequence) {
  const stamp = Number.isFinite(Number(now)) ? Math.floor(Number(now)).toString(36) : '0';
  const entropy = Math.floor(Math.max(0, Math.min(0.999999, Number(random) || 0)) * 0xFFFFFF)
    .toString(36).padStart(5, '0');
  return `crm-${kind}-${stamp}-${entropy}-${Number(sequence) || 1}`;
}

function record(value) { return !!(value && typeof value === 'object' && !Array.isArray(value)); }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function count(value) {
  const out = Number(value);
  return Number.isSafeInteger(out) && out >= 0 ? out : null;
}
function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const out = Number(value);
  return Number.isFinite(out) && out >= 0 ? out : null;
}
function formatTime(value) {
  const parts = chinaParts(value);
  if (!parts) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hours)}:${pad(parts.minutes)}`;
}

module.exports = { buildHistory, buildIdentityLine, buildNoteDraft, buildParticipation, latestNoteText, buildTagDraft, createNoteRequestId, createTagRequestId, positiveId, shapeCustomerDetail };
