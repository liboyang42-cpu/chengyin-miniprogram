const PROCESSING = {
  WAITING_PLATFORM_REVIEW: {
    text: '平台审核中',
    hint: '平台尚未完成退款审核',
    variant: 'warning',
  },
  PLATFORM_REJECTED: {
    text: '平台未通过退款',
    hint: '平台审核已结束，款项不会因此退回',
    variant: 'danger',
  },
  REFUND_PROCESSING: {
    text: '退款处理中',
    hint: '平台已批准，款项仍在处理',
    variant: 'warning',
  },
  MANUAL_REFUND_PENDING: {
    text: '等待人工退款',
    hint: '原路退款异常，平台正在人工处理',
    variant: 'warning',
  },
  MANUAL_REFUND_REVIEW: {
    text: '人工退款待复核',
    hint: '人工处理已登记，仍待平台复核',
    variant: 'warning',
  },
  REFUNDED: {
    text: '平台确认已退款',
    hint: '平台已确认款项退回',
    variant: 'success',
  },
  UNKNOWN: {
    text: '平台状态待确认',
    hint: '当前状态无法安全判断，请稍后刷新',
    variant: 'neutral',
  },
};

const OPINIONS = {
  PENDING: {
    text: '等待商家意见',
    hint: '尚未追加同意或拒绝意见',
    variant: 'neutral',
  },
  AGREE: {
    text: '商家已同意申请',
    hint: '这是商家意见，不代表款项已退',
    variant: 'success',
  },
  REJECT: {
    text: '商家不同意申请',
    hint: '这是商家意见，最终结果以平台审核为准',
    variant: 'danger',
  },
};

const DECISIONS = ['AGREE', 'REJECT', 'EVIDENCE'];
const DECISION_VIEW = {
  AGREE: { text: '同意申请', variant: 'success' },
  REJECT: { text: '不同意申请', variant: 'danger' },
  EVIDENCE: { text: '补充凭证', variant: 'neutral' },
};
// 回应流程文案。后果只复述现有规则:商家意见不改款项、最终以平台审核为准;不写到账时效。
const RESPONSE_FLOW = {
  AGREE: {
    formTitle: '同意退款申请',
    confirmTitle: '确认同意',
    consequence: '这是商家意见，不代表款项已退。提交后由平台审核，最终是否退款以平台审核结果为准。',
    submitText: '确认同意',
  },
  REJECT: {
    formTitle: '不同意退款申请',
    confirmTitle: '确认不同意',
    consequence: '这是商家意见，不会直接驳回申请。提交后由平台审核，最终结果以平台审核为准。',
    submitText: '确认不同意',
  },
  EVIDENCE: {
    formTitle: '补充凭证',
    confirmTitle: '确认补充凭证',
    consequence: '凭证只作为平台审核材料，不会直接改变退款或打款状态。提交后由平台审核。',
    submitText: '提交凭证',
  },
};

const ACTOR_VIEW = {
  MERCHANT_OWNER: '店主',
  MERCHANT_MANAGER: '店长',
  MERCHANT_CHECKIN: '核销员',
  MERCHANT_MARKETING: '运营',
  MERCHANT_FINANCE: '财务',
};

const EVIDENCE_OBJECT_KEY = /^upload\/merchant-aftercare-evidence\/[0-9a-f]{32}\.(?:jpe?g|png|gif)$/;

function isEvidenceObjectKey(value) {
  return typeof value === 'string' && EVIDENCE_OBJECT_KEY.test(value.trim());
}

function safeEvidencePreviewUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value.trim();
  return /^https:\/\/[^\s\\]+$/i.test(url) ? url : '';
}

function shapeAftercareDetail(raw) {
  const source = raw || {};
  const refundId = Number(source.refundId);
  const refundAmount = money(source.refundAmount);
  const policyCode = typeof source.refundPolicyCode === 'string' ? source.refundPolicyCode.trim() : '';
  const policyVersion = source.refundPolicyVersion === null || source.refundPolicyVersion === undefined
    || source.refundPolicyVersion === '' ? null : Number(source.refundPolicyVersion);
  const refundDeadlineText = formatMinute(source.refundDeadline);
  const allowedDecisions = Array.isArray(source.allowedDecisions)
    ? source.allowedDecisions.slice() : null;
  if (!Number.isSafeInteger(refundId) || refundId <= 0
      || !Object.prototype.hasOwnProperty.call(PROCESSING, source.processing)
      || !Object.prototype.hasOwnProperty.call(OPINIONS, source.merchantOpinion)
      || typeof source.canRespond !== 'boolean'
      || !allowedDecisions
      || allowedDecisions.some(item => DECISIONS.indexOf(item) < 0)
      || new Set(allowedDecisions).size !== allowedDecisions.length
      || source.canRespond !== (allowedDecisions.length > 0)
      || !Array.isArray(source.responses)
      || (policyVersion !== null && (!Number.isSafeInteger(policyVersion) || policyVersion <= 0))
      || (source.refundAmount !== null && source.refundAmount !== undefined
        && source.refundAmount !== '' && refundAmount == null)) {
    return null;
  }
  const activityTitleText = optionalText(source.activityTitle);
  const customerNicknameText = optionalText(source.customerNickname);
  if (activityTitleText === null || customerNicknameText === null
      || optionalText(source.platformTakeoverAt) === null) return null;
  const platformTakeoverText = formatMinute(source.platformTakeoverAt);
  const processing = PROCESSING[source.processing];
  const opinion = OPINIONS[source.merchantOpinion];
  const refunded = source.processing === 'REFUNDED';
  const responses = source.responses.map(row => shapeResponse(row, refundId));
  if (responses.some(row => row == null)) return null;
  return Object.assign({}, source, {
    refundId,
    processingText: processing.text,
    processingHint: processing.hint,
    processingVariant: processing.variant,
    merchantOpinionText: opinion.text,
    merchantOpinionHint: opinion.hint,
    merchantOpinionVariant: opinion.variant,
    refunded,
    refundedText: refunded ? '已确认退回' : '尚未确认退回',
    refundedHint: refunded ? '款项结果已由平台确认' : '不要根据商家意见推断退款结果',
    refundedVariant: refunded ? 'success' : 'neutral',
    hasRefundAmount: refundAmount != null,
    refundAmountText: refundAmount == null ? '金额待确认' : `¥${refundAmount}`,
    refundNoText: typeof source.refundNo === 'string' && source.refundNo.trim()
      ? source.refundNo.trim() : `#${refundId}`,
    sourceText: sourceTypeText(source.sourceType),
    createTimeText: formatMinute(source.createTime),
    hasRefundPolicy: !!(policyCode || policyVersion !== null || refundDeadlineText),
    refundPolicyText: policyCode === 'EXPLORE_END_100_0'
      ? '截止前未核销可全额申请'
      : (policyCode ? '退款规则以订单快照为准' : '退款政策待确认'),
    refundPolicyVersionText: policyVersion === null ? '' : `政策版本 ${policyVersion}`,
    refundDeadlineText,
    allowedDecisions,
    responses,
    activityTitleText,
    customerNicknameText,
    platformTakeoverText,
    headSubtitle: activityTitleText ? `${sourceTypeText(source.sourceType)} · ${activityTitleText}` : sourceTypeText(source.sourceType),
    timelineNodes: buildAftercareTimeline(source.processing, formatMinute(source.createTime), responses, platformTakeoverText),
  });
}

// 处理记录只排真实发生过的事实:申请 → 商家每条记录 → 平台审核 → 款项。
// 未来节点不写时间,也不承诺时效(后端没有给退款到账时长)。
function buildAftercareTimeline(processingCode, createTimeText, responses, platformTakeoverText) {
  const nodes = [{ title: '玩家提交退款申请', time: createTimeText, status: 'done' }];
  // 超时转平台由后端 platform_takeover_at 真实记录(商家 24h 未同意/不同意);有才画,时间取后端值。
  // 转平台后商家仍可回应,补充凭证也不阻止转平台 ⇒ 按时间插进商家记录之间(同为 yyyy-MM-dd HH:mm,可字典序比较)。
  let takeoverPlaced = !platformTakeoverText;
  const takeoverNode = { title: '商家超时未表态，已转平台客服', time: platformTakeoverText, status: 'done' };
  (responses || []).forEach((row) => {
    if (!takeoverPlaced && row.createTimeText && row.createTimeText > platformTakeoverText) {
      nodes.push(takeoverNode);
      takeoverPlaced = true;
    }
    nodes.push({ title: row.decisionText, time: row.createTimeText, desc: row.actorText, note: row.contentText, status: 'done' });
  });
  if (!takeoverPlaced) nodes.push(takeoverNode);
  const processing = PROCESSING[processingCode] || PROCESSING.UNKNOWN;
  if (processingCode === 'WAITING_PLATFORM_REVIEW') {
    nodes.push({ title: processing.text, desc: processing.hint, status: 'doing' });
    nodes.push({ title: '款项结果', desc: '尚未确认退回', status: 'todo' });
  } else if (processingCode === 'PLATFORM_REJECTED') {
    nodes.push({ title: processing.text, desc: processing.hint, status: 'rejected' });
  } else if (processingCode === 'REFUNDED') {
    nodes.push({ title: '平台已批准退款', status: 'done' });
    nodes.push({ title: processing.text, desc: processing.hint, status: 'done' });
  } else if (PROCESSING[processingCode] && processingCode !== 'UNKNOWN') {
    nodes.push({ title: '平台已批准退款', status: 'done' });
    nodes.push({ title: processing.text, desc: processing.hint, status: 'doing' });
  } else {
    nodes.push({ title: processing.text, desc: processing.hint, status: 'todo' });
  }
  return nodes;
}

function shapeResponse(raw, refundId) {
  const row = raw || {};
  const id = Number(row.id);
  const rowRefundId = Number(row.refundId);
  const decision = DECISION_VIEW[row.decision];
  if (!Number.isSafeInteger(id) || id <= 0 || rowRefundId !== refundId || !decision) return null;
  const evidenceUrl = safeEvidencePreviewUrl(row.evidenceUrl);
  return Object.assign({}, row, {
    id,
    refundId: rowRefundId,
    decisionText: decision.text,
    decisionVariant: decision.variant,
    actorText: ACTOR_VIEW[row.actorRoleCode] || '商家成员',
    contentText: typeof row.content === 'string' ? row.content.trim() : '',
    evidenceUrl,
    hasEvidence: !!evidenceUrl,
    // 服务端核验/签名失败给 UNAVAILABLE:显示「暂不可查看」,避免商家以为凭证丢了而重复补传
    evidenceUnavailable: !evidenceUrl && !!row.evidenceStatus && row.evidenceStatus !== 'NONE',
    createTimeText: formatMinute(row.createTime),
  });
}

// 后端展示列(2026-09-17 补):字符串或缺省;其它类型视为脏数据。
function optionalText(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value.trim() : null;
}

function formatMinute(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).replace('T', ' ').slice(0, 16);
}

function money(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : null;
}

function sourceTypeText(value) {
  return {
    registration: '报名退款',
    REGISTRATION: '报名退款',
  }[value] || '退款申请';
}

function buildResponseDraft(source) {
  const draft = source || {};
  const decision = typeof draft.decision === 'string' ? draft.decision : '';
  const content = typeof draft.content === 'string' ? draft.content.trim() : '';
  const evidenceKeys = Array.isArray(draft.evidenceKeys)
    ? draft.evidenceKeys.map(item => typeof item === 'string' ? item.trim() : '') : [];
  if (DECISIONS.indexOf(decision) < 0) return { valid: false, error: '请选择处理意见' };
  if (content.length > 500) return { valid: false, error: '意见内容不能超过500字' };
  if (decision === 'REJECT' && !content) return { valid: false, error: '请填写不同意的原因' };
  if (evidenceKeys.length > 1) return { valid: false, error: '当前一次只能上传一项凭证' };
  if (evidenceKeys.length === 1 && !evidenceKeys[0]) return { valid: false, error: '凭证上传结果无效，请重新上传' };
  if (evidenceKeys.length === 1 && !isEvidenceObjectKey(evidenceKeys[0])) {
    return { valid: false, error: '凭证上传结果无效，请重新上传' };
  }
  if (decision === 'EVIDENCE' && evidenceKeys.length !== 1) {
    return { valid: false, error: '请先上传凭证图片' };
  }
  const payload = {
    decision,
    content: content || null,
  };
  if (evidenceKeys.length === 1) payload.evidenceKeys = evidenceKeys;
  return {
    valid: true,
    error: '',
    payload,
  };
}

function createAftercareRequestId(now, randomValue, sequence) {
  const time = Number.isFinite(Number(now)) ? Math.max(0, Math.floor(Number(now))) : 0;
  const random = Number.isFinite(Number(randomValue)) ? Math.abs(Number(randomValue)) : 0;
  const randomPart = Math.floor((random % 1) * 0x100000000).toString(36);
  const seq = Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 1;
  return `ma:${time.toString(36)}:${seq.toString(36)}:${randomPart}`;
}

function shapeAftercareRespondResult(raw, expectedRefundId, expectedDecision) {
  const source = raw || {};
  const id = Number(source.id);
  const refundId = Number(source.refundId);
  if (!Number.isSafeInteger(id) || id <= 0
      || refundId !== Number(expectedRefundId)
      || source.decision !== expectedDecision
      || DECISIONS.indexOf(source.decision) < 0
      || !Object.prototype.hasOwnProperty.call(PROCESSING, source.processing)
      || !Object.prototype.hasOwnProperty.call(OPINIONS, source.merchantOpinion)
      || typeof source.refunded !== 'boolean'
      || source.refunded !== (source.processing === 'REFUNDED')) {
    return null;
  }
  return Object.assign({}, source, { id, refundId });
}

// 列表行(Revolut 316-318):标题 · 「HH:mm · 状态」· 右侧金额。
function listRowView(item, amount) {
  const minute = formatMinute(item.createTime);
  const nickname = optionalText(item.customerNickname) || '';
  const activity = optionalText(item.activityTitle) || '';
  let statusText = (PROCESSING[item.processing] || PROCESSING.UNKNOWN).text;
  let statusTone = 'neutral';
  if (item.bucket === 'PENDING') {
    statusText = '待回应';
    statusTone = 'warning';
  } else if (item.refunded === true) {
    statusText = '已退回';
    statusTone = 'success';
  }
  return {
    // 标题优先申请人昵称(后端按 CRM 读权限下发),没有退回单号;活动名放第二行弱色
    titleText: nickname || (typeof item.refundNo === 'string' && item.refundNo.trim() ? item.refundNo.trim() : `#${item.refundId}`),
    customerNicknameText: nickname,
    activityTitleText: activity,
    takeoverText: formatMinute(item.platformTakeoverAt) ? '已转平台客服' : '',
    dateKey: /^\d{4}-\d{2}-\d{2}/.test(minute) ? minute.slice(0, 10) : '',
    timeText: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(minute) ? minute.slice(11) : '',
    statusText,
    statusTone,
    hasAmount: amount != null,
    amountCents: amount == null ? null : Math.round(Number(amount) * 100),
  };
}

function dayKeyOf(date) {
  const pad = n => (n < 10 ? '0' : '') + n;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 按申请日期分组(今天/昨天/M月D日),组内顺序保持服务端顺序。
// 合计只在该组每一笔金额都已确认时给出,有一笔待确认就不给,避免少算的合计。
function groupAftercareItems(items, now) {
  const today = now instanceof Date ? now : new Date();
  const todayKey = dayKeyOf(today);
  const yesterdayKey = dayKeyOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  const groups = [];
  const byKey = {};
  (items || []).forEach((item) => {
    const key = item.dateKey || '';
    let group = byKey[key];
    if (!group) {
      group = { key: key || 'unknown', label: dayLabel(key, todayKey, yesterdayKey, today), items: [], cents: 0, complete: true };
      byKey[key] = group;
      groups.push(group);
    }
    group.items.push(item);
    if (item.amountCents == null) group.complete = false;
    else group.cents += item.amountCents;
  });
  return groups.map(group => ({
    key: group.key,
    label: group.label,
    items: group.items,
    totalText: group.complete ? `¥${(group.cents / 100).toFixed(2)}` : '',
  }));
}

function dayLabel(key, todayKey, yesterdayKey, today) {
  if (!key) return '时间待确认';
  if (key === todayKey) return '今天';
  if (key === yesterdayKey) return '昨天';
  const [year, month, day] = key.split('-').map(Number);
  return year === today.getFullYear() ? `${month}月${day}日` : `${year}年${month}月${day}日`;
}

// 列表接口没有关键词参数:只在已加载的数据里按单号/客户昵称/活动名/原因过滤(类型目前只有「报名退款」一种,搜它等于不过滤)。
function filterAftercareItems(items, keyword) {
  const needle = typeof keyword === 'string' ? keyword.trim().toLowerCase() : '';
  if (!needle) return (items || []).slice();
  return (items || []).filter(item => [item.refundNoText, item.customerNicknameText, item.activityTitleText, item.reasonText]
    .some(text => typeof text === 'string' && text.toLowerCase().indexOf(needle) >= 0));
}

function shapeAftercareListPage(raw, expectedBucket) {
  const source = raw || {};
  const pageNum = Number(source.pageNum);
  const pageSize = Number(source.pageSize);
  const total = Number(source.total);
  const buckets = ['PENDING', 'PROCESSING', 'COMPLETED'];
  if (source.bucket !== expectedBucket || buckets.indexOf(source.bucket) < 0
      || !Number.isSafeInteger(pageNum) || pageNum < 1
      || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50
      || !Number.isSafeInteger(total) || total < 0
      || typeof source.hasMore !== 'boolean' || !Array.isArray(source.items)) return null;
  const offset = (pageNum - 1) * pageSize;
  if (!Number.isSafeInteger(offset)) return null;
  const items = source.items.map(function (rawItem) {
    const item = rawItem || {};
    const refundId = Number(item.refundId);
    const amount = money(item.refundAmount);
    const processing = PROCESSING[item.processing];
    const opinion = OPINIONS[item.merchantOpinion];
    if (!Number.isSafeInteger(refundId) || refundId <= 0
        || item.bucket !== expectedBucket || !processing || !opinion
        || typeof item.canRespond !== 'boolean' || typeof item.refunded !== 'boolean'
        || item.refunded !== (item.processing === 'REFUNDED')
        || optionalText(item.activityTitle) === null || optionalText(item.customerNickname) === null
        || optionalText(item.platformTakeoverAt) === null
        || (item.refundAmount !== null && item.refundAmount !== undefined
          && item.refundAmount !== '' && amount == null)) return null;
    return Object.assign({}, item, {
      refundId,
      processingText: processing.text,
      processingVariant: processing.variant,
      merchantOpinionText: opinion.text,
      refundAmountText: amount == null ? '金额待确认' : `¥${amount}`,
      refundNoText: typeof item.refundNo === 'string' && item.refundNo.trim()
        ? item.refundNo.trim() : `#${refundId}`,
      sourceText: sourceTypeText(item.sourceType),
      createTimeText: formatMinute(item.createTime),
      reasonText: typeof item.reason === 'string' ? item.reason.trim() : '',
    }, listRowView(item, amount));
  });
  const returnedThrough = offset + items.length;
  if (items.some(item => item == null) || items.length > pageSize
      || !Number.isSafeInteger(returnedThrough) || returnedThrough > total
      || source.hasMore !== (returnedThrough < total)
      || (source.hasMore && items.length === 0)) return null;
  return { bucket: source.bucket, pageNum, pageSize, total, hasMore: source.hasMore, items };
}

module.exports = {
  RESPONSE_FLOW,
  buildAftercareTimeline,
  buildResponseDraft,
  filterAftercareItems,
  groupAftercareItems,
  createAftercareRequestId,
  isEvidenceObjectKey,
  shapeAftercareDetail,
  shapeAftercareListPage,
  shapeAftercareRespondResult,
};
