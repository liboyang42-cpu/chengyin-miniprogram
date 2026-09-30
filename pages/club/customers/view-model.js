// 俱乐部客户 · 列表/详情 共用整形层(K1 / K2 / K2-B~F)
//
// ★ 手机号铁律:脱敏在服务端做。本层对手机号只认服务端渲染好的 `phoneText` 一个字段,
//   其余一律丢弃(白名单整形,不 spread 原始对象)。所以即便服务端哪天误带了
//   `phone` / `mobile` 原始号码,它也进不了 data、进不了 wxml、进不了截图。
//   对应契约测试:tests/unit/club-customers-contract.test.js「手机号只走服务端渲染字段」。
//
// 「客户」的口径:按**人**聚合(这个人在我这买过几次、什么时候来的),
// 与按团聚合的报名名册(pages/club/enroll)、按场次聚合的本场名册不是一回事。

const STATUS_TEXT = Object.freeze({
  VERIFIED: '已核销',
  PENDING: '待核销',
  CONTACTED: '已接洽',
  REFUNDED: '已退款',
  REGISTERED: '报名记录',
});
// 状态色档:已核销=绿(success),待核销/已接洽=warning,已退款=danger。
const STATUS_TONE = Object.freeze({
  VERIFIED: 'success',
  PENDING: 'warning',
  CONTACTED: 'warning',
  REFUNDED: 'danger',
  REGISTERED: 'muted',
});

function shapeCustomerList(raw) {
  if (!record(raw) || !Array.isArray(raw.items)) return null;
  const total = count(raw.total);
  const monthNew = count(raw.monthNew);
  if (total == null || monthNew == null) return null;

  const items = [];
  for (const value of raw.items) {
    if (!record(value)) return null;
    const memberId = positiveId(value.memberId);
    if (memberId == null) return null;
    const verifiedCount = count(value.verifiedCount);
    const pendingCount = count(value.pendingCount);
    if (verifiedCount == null || pendingCount == null) return null;
    const remark = text(value.remark);
    items.push({
      memberId,
      displayName: text(value.displayName) || '未留姓名',
      avatar: text(value.avatar),
      hasRemark: !!remark,
      metaText: listMetaText(pendingCount, verifiedCount, text(value.lastTopicName), text(value.lastVisitDate)),
      // 第三行:备注优先,没有备注才退回服务端渲染的手机号一行(无权限时服务端给替代说明)
      subText: remark || text(value.phoneText),
    });
  }
  return {
    total,
    countText: `${total} 位 · 本月新增 ${monthNew}`,
    canEdit: raw.canEdit === true,
    items,
  };
}

function listMetaText(pendingCount, verifiedCount, lastTopicName, lastVisitDate) {
  if (pendingCount > 0) {
    const head = `待核销 ${pendingCount} 张`;
    return lastTopicName ? `${head} · 最近参加「${lastTopicName}」` : head;
  }
  const head = `核销 ${verifiedCount} 次`;
  const day = monthDay(lastVisitDate);
  return day ? `${head} · 最近 ${day}` : head;
}

function shapeCustomerDetail(raw, expectedMemberId) {
  if (!record(raw) || !record(raw.summary) || !Array.isArray(raw.records) || !Array.isArray(raw.tags)) return null;
  const expected = positiveId(expectedMemberId);
  const memberId = positiveId(raw.summary.memberId);
  if (expected == null || memberId == null) return null;
  if (memberId !== expected) return null;

  const arrivedCount = count(raw.summary.arrivedCount);
  const pendingCount = count(raw.summary.pendingCount);
  const refundedCount = count(raw.summary.refundedCount);
  if (arrivedCount == null || pendingCount == null || refundedCount == null) return null;

  // paidAmount 为 null = 服务端判定「本岗位不能看金额」(K2-B),不是加载失败。
  const amount = money(raw.summary.paidAmount);
  if (raw.summary.paidAmount != null && amount == null) return null;

  const records = [];
  for (const value of raw.records) {
    if (!record(value) || !text(value.key) || !STATUS_TEXT[value.statusCode]) return null;
    records.push({
      key: text(value.key),
      topicId: positiveId(value.topicId),
      title: text(value.title) || '未命名活动',
      dayText: dayOf(value.occurredAt),
      monthText: monthOf(value.occurredAt),
      statusLabel: STATUS_TEXT[value.statusCode],
      tone: STATUS_TONE[value.statusCode],
    });
  }

  const tags = [];
  for (const value of raw.tags) {
    const name = typeof value === 'string' ? text(value) : text(record(value) ? value.name : '');
    if (!name) return null;
    tags.push(name);
  }

  const remark = text(raw.remark);
  return {
    summary: {
      memberId,
      displayName: text(raw.summary.displayName) || '未留姓名',
      avatar: text(raw.summary.avatar),
      // 服务端渲染好的一行,前端不参与拼装、也拿不到原始号码
      phoneText: text(raw.summary.phoneText),
      lastInteractionText: interactionText(raw.summary.lastInteractionTime, remark),
      arrivedCount,
      pendingCount,
      refundedCount,
      paidAmountText: amount == null ? '无查看权限' : `¥${trimMoney(amount)}`,
      amountVisible: amount != null,
    },
    records,
    tags,
    remark,
    remarkText: remark ? `备注：${remark}` : '还没有备注',
    canEdit: raw.canEdit === true,
  };
}

function interactionText(lastInteractionTime, remark) {
  const day = chineseDay(lastInteractionTime);
  if (!day) return '尚未发生互动';
  return remark ? `最近互动 ${day} · ${remark}` : `最近互动 ${day}`;
}

// 标签与备注的编辑草稿:只放行白名单字段,长度越界当场拦下(不指望服务端兜底)
function buildTagRemarkDraft(tagsValue, remarkValue) {
  const remark = text(remarkValue);
  if (remark.length > 200) return { valid: false, error: '备注最多 200 字' };
  const tags = [];
  for (const value of Array.isArray(tagsValue) ? tagsValue : []) {
    const name = text(value);
    if (!name) continue;
    if (name.length > 12) return { valid: false, error: '单个标签最多 12 字' };
    if (tags.indexOf(name) < 0) tags.push(name);
  }
  if (tags.length > 8) return { valid: false, error: '标签最多 8 个' };
  return { valid: true, tags, remark };
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
function trimMoney(amount) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}
function parts(value) {
  const source = String(value || '').replace('T', ' ');
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(source);
  return matched ? { year: matched[1], month: matched[2], day: matched[3] } : null;
}
function monthDay(value) {
  const p = parts(value);
  return p ? `${p.month}-${p.day}` : '';
}
function dayOf(value) {
  const p = parts(value);
  return p ? String(Number(p.day)) : '';
}
function monthOf(value) {
  const p = parts(value);
  return p ? `${Number(p.month)}月` : '';
}
function chineseDay(value) {
  const p = parts(value);
  return p ? `${Number(p.month)}月${Number(p.day)}日` : '';
}

module.exports = {
  buildTagRemarkDraft,
  listMetaText,
  positiveId,
  shapeCustomerDetail,
  shapeCustomerList,
};
