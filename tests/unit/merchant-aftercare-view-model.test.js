const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  buildAftercareTimeline,
  buildResponseDraft,
  filterAftercareItems,
  groupAftercareItems,
  shapeAftercareDetail,
  shapeAftercareListPage,
} = require('../../pages/merchant/aftercare/detail/view-model');

function assertPendingNotRefunded(shape) {
  const detail = shape({
    refundId: 81,
    processing: 'WAITING_PLATFORM_REVIEW',
    merchantOpinion: 'AGREE',
    canRespond: true,
    allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
    responses: [],
  });
  assert.equal(detail.refunded, false, '平台审核中不得映成已退款');
  assert.equal(detail.refundedText, '尚未确认退回', '平台审核中不得展示终态款项文案');
}

test('平台处理、商家意见、款项结果三轨独立，商家同意不等于已退款', () => {
  const detail = shapeAftercareDetail({
    refundId: 81,
    refundNo: 'RF-81',
    refundAmount: '128.50',
    refundPolicyCode: 'EXPLORE_END_100_0',
    refundPolicyVersion: 1,
    refundDeadline: '2026-08-24 19:30:00',
    processing: 'WAITING_PLATFORM_REVIEW',
    merchantOpinion: 'AGREE',
    canRespond: true,
    allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
    responses: [],
  });

  assert.equal(detail.processingText, '平台审核中');
  assert.equal(detail.merchantOpinionText, '商家已同意申请');
  assert.equal(detail.refunded, false);
  assert.equal(detail.refundedText, '尚未确认退回');
  assert.match(detail.merchantOpinionHint, /不代表款项已退/);
  assert.equal(detail.refundPolicyText, '截止前未核销可全额申请');
  assert.equal(detail.refundPolicyVersionText, '政策版本 1');
  assert.equal(detail.refundDeadlineText, '2026-08-24 19:30');
});

test('商家补充记录使用中文 decision 与短时可查看凭证投影', () => {
  const detail = shapeAftercareDetail({
    refundId: 81,
    processing: 'WAITING_PLATFORM_REVIEW',
    merchantOpinion: 'PENDING',
    canRespond: true,
    allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
    responses: [{
      id: 3,
      refundId: 81,
      decision: 'EVIDENCE',
      evidenceUrl: 'https://private-oss.example/upload/evidence-3.jpg?Expires=300&Signature=short-lived',
      actorRoleCode: 'MERCHANT_MANAGER',
      createTime: '2026-08-23 10:30:00',
    }],
  });

  assert.equal(detail.responses[0].decisionText, '补充凭证');
  assert.equal(detail.responses[0].actorText, '店长');
  assert.equal(detail.responses[0].hasEvidence, true);
  assert.equal(detail.responses[0].createTimeText, '2026-08-23 10:30');
});

test('凭证核验失败显示「暂不可查看」，不再悄悄隐藏；无凭证不显示', () => {
  const detail = shapeAftercareDetail({
    refundId: 81,
    processing: 'WAITING_PLATFORM_REVIEW',
    merchantOpinion: 'PENDING',
    canRespond: false,
    allowedDecisions: [],
    responses: [
      { id: 4, refundId: 81, decision: 'EVIDENCE', evidenceUrl: null, evidenceStatus: 'UNAVAILABLE' },
      { id: 5, refundId: 81, decision: 'REJECT', content: '不同意', evidenceUrl: null, evidenceStatus: 'NONE' },
    ],
  });

  assert.equal(detail.responses[0].hasEvidence, false);
  assert.equal(detail.responses[0].evidenceUnavailable, true);
  assert.equal(detail.responses[1].evidenceUnavailable, false);
});

test('退款金额未知保持未知，不得投影成 0 元', () => {
  const detail = shapeAftercareDetail({
    refundId: 81,
    refundAmount: null,
    processing: 'UNKNOWN',
    merchantOpinion: 'PENDING',
    canRespond: false,
    allowedDecisions: [],
    responses: [],
  });

  assert.equal(detail.hasRefundAmount, false);
  assert.equal(detail.refundAmountText, '金额待确认');
  assert.doesNotMatch(detail.refundAmountText, /0\.00/);
});

test('补充凭证草稿以 evidenceKeys 为真源，空上传结果 fail closed', () => {
  const empty = buildResponseDraft({ decision: 'EVIDENCE', content: '', evidenceKeys: [] });
  assert.equal(empty.valid, false);
  assert.match(empty.error, /上传凭证/);

  const uploaded = buildResponseDraft({
    decision: 'EVIDENCE',
    content: '补充聊天截图',
    evidenceKeys: ['upload/merchant-aftercare-evidence/0123456789abcdef0123456789abcdef.jpg'],
  });
  assert.equal(uploaded.valid, true);
  assert.deepEqual(uploaded.payload.evidenceKeys,
    ['upload/merchant-aftercare-evidence/0123456789abcdef0123456789abcdef.jpg']);
  assert.equal(Object.prototype.hasOwnProperty.call(uploaded.payload, 'evidenceUrl'), false,
    '新客户端不得回退成人工填写 evidenceUrl');

  const multiple = buildResponseDraft({
    decision: 'EVIDENCE', evidenceKeys: [
      'upload/merchant-aftercare-evidence/0123456789abcdef0123456789abcdef.jpg',
      'upload/merchant-aftercare-evidence/fedcba9876543210fedcba9876543210.jpg',
    ],
  });
  assert.equal(multiple.valid, false, '现有单凭证落库合同必须显式拒绝多项，不能静默丢图');

  const legacyUrl = buildResponseDraft({
    decision: 'EVIDENCE',
    evidenceKeys: ['https://private-oss.example/upload/evidence.jpg?Signature=long-lived'],
  });
  assert.equal(legacyUrl.valid, false, '客户端也必须拒绝把长期 URL 冒充 object key');

  for (const key of [
    'upload/0123456789abcdef0123456789abcdef.jpg',
    'upload/merchant-aftercare-evidence/../0123456789abcdef0123456789abcdef.jpg',
    'upload/MERCHANT-AFTERCARE-EVIDENCE/0123456789abcdef0123456789abcdef.jpg',
    'upload/merchant-aftercare-evidence/0123456789ABCDEF0123456789ABCDEF.jpg',
  ]) {
    assert.equal(buildResponseDraft({ decision: 'EVIDENCE', evidenceKeys: [key] }).valid, false,
      `必须拒绝不可验证的售后凭证 key: ${key}`);
  }
});

test('售后列表严格校验分桶、分页与退款终态，不接受半份成功数据', () => {
  const page = shapeAftercareListPage({
    bucket: 'PENDING', pageNum: 1, pageSize: 20, total: 1, hasMore: false,
    items: [{
      refundId: 81,
      refundNo: 'RF-81',
      refundAmount: null,
      bucket: 'PENDING',
      processing: 'WAITING_PLATFORM_REVIEW',
      merchantOpinion: 'PENDING',
      canRespond: true,
      allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'],
      refunded: false,
    }],
  }, 'PENDING');

  assert.equal(page.items[0].refundAmountText, '金额待确认');
  assert.equal(page.items[0].processingText, '平台审核中');
  assert.equal(shapeAftercareListPage(Object.assign({}, page, { bucket: 'COMPLETED' }), 'PENDING'), null);
  assert.equal(shapeAftercareListPage(Object.assign({}, page, { hasMore: true }), 'PENDING'), null,
    '已返回全部记录时，hasMore=true 是不一致回执，不能继续重复翻页');
});

test('负控：把 pending 映成 refunded 时，款项状态断言必须判红', () => {
  assertPendingNotRefunded(shapeAftercareDetail);
  const file = path.resolve(__dirname, '../../pages/merchant/aftercare/detail/view-model.js');
  const source = fs.readFileSync(file, 'utf8');
  const mutated = source.replace(
    "const refunded = source.processing === 'REFUNDED';",
    "const refunded = source.processing === 'WAITING_PLATFORM_REVIEW';",
  );
  assert.notEqual(mutated, source, '负控锚点失效');
  const sandbox = { module: { exports: {} }, exports: {} };
  vm.runInNewContext(mutated, sandbox);
  assert.throws(
    () => assertPendingNotRefunded(sandbox.module.exports.shapeAftercareDetail),
    /平台审核中不得映成已退款/,
  );
});

function listItem(overrides) {
  return Object.assign({
    refundId: 81,
    refundNo: 'RF-81',
    refundAmount: '128.50',
    reason: '行程临时调整',
    bucket: 'PENDING',
    processing: 'WAITING_PLATFORM_REVIEW',
    merchantOpinion: 'PENDING',
    canRespond: true,
    refunded: false,
    sourceType: 'registration',
    createTime: '2026-09-17 10:05:00',
  }, overrides);
}

function listPage(bucket, items) {
  return shapeAftercareListPage({ bucket, pageNum: 1, pageSize: 20, total: items.length, hasMore: false, items }, bucket);
}

test('列表行照 Revolut:HH:mm · 状态，待回应警示、已退回成功、其余中性，金额未知保持弱态', () => {
  const pending = listPage('PENDING', [listItem({ refundAmount: null })]).items[0];
  assert.equal(pending.timeText, '10:05');
  assert.equal(pending.dateKey, '2026-09-17');
  assert.equal(pending.statusText, '待回应');
  assert.equal(pending.statusTone, 'warning');
  assert.equal(pending.hasAmount, false);
  assert.equal(pending.refundAmountText, '金额待确认');

  const done = listPage('COMPLETED', [listItem({ bucket: 'COMPLETED', processing: 'REFUNDED', refunded: true, canRespond: false })]).items[0];
  assert.equal(done.statusText, '已退回');
  assert.equal(done.statusTone, 'success');

  const processing = listPage('PROCESSING', [listItem({ bucket: 'PROCESSING', merchantOpinion: 'AGREE' })]).items[0];
  assert.equal(processing.statusText, '平台审核中', '商家已表态但平台未审完,不能显示待回应');
  assert.equal(processing.statusTone, 'neutral');
});

test('按日期分组:今天/昨天/M月D日/跨年;合计只在整组金额都确认时给出', () => {
  const now = new Date(2026, 8, 17, 12, 0, 0);
  const items = listPage('PENDING', [
    listItem({ refundId: 1, createTime: '2026-09-17 10:05:00', refundAmount: '100.10' }),
    listItem({ refundId: 2, createTime: '2026-09-17 09:00:00', refundAmount: '28.40' }),
    listItem({ refundId: 3, createTime: '2026-09-16 23:59:00', refundAmount: '10' }),
    listItem({ refundId: 4, createTime: '2026-09-02 08:00:00', refundAmount: null }),
    listItem({ refundId: 5, createTime: '2025-12-31 08:00:00', refundAmount: '1' }),
    listItem({ refundId: 6, createTime: null, refundAmount: '1' }),
  ]).items;
  const groups = groupAftercareItems(items, now);
  assert.deepEqual(groups.map(g => g.label), ['今天', '昨天', '9月2日', '2025年12月31日', '时间待确认']);
  assert.deepEqual(groups.map(g => g.items.map(i => i.refundId)), [[1, 2], [3], [4], [5], [6]]);
  assert.equal(groups[0].totalText, '¥128.50', '分组合计按分累加,不能出现浮点尾差');
  assert.equal(groups[2].totalText, '', '组内有金额待确认时不给合计');
  assert.equal(new Set(groups.map(g => g.key)).size, groups.length, '分组 key 唯一');

  // 非连续同日也并进同一组,不产生重复 key
  const shuffled = groupAftercareItems([items[0], items[2], items[1]], now);
  assert.deepEqual(shuffled.map(g => g.items.length), [2, 1]);
});

test('搜索只在已加载数据里按单号/原因过滤，空词返回全部，不命中返回空', () => {
  const items = listPage('PENDING', [
    listItem({ refundId: 1, refundNo: 'RF-A001', reason: '临时有事' }),
    listItem({ refundId: 2, refundNo: 'RF-B002', reason: '天气原因' }),
  ]).items;
  assert.deepEqual(filterAftercareItems(items, '').map(i => i.refundId), [1, 2]);
  assert.deepEqual(filterAftercareItems(items, ' rf-b ').map(i => i.refundId), [2]);
  assert.deepEqual(filterAftercareItems(items, '天气').map(i => i.refundId), [2]);
  assert.deepEqual(filterAftercareItems(items, '报名退款'), [], '类型文案不参与过滤(只有一种值,搜它等于不过滤)');
  assert.deepEqual(filterAftercareItems(items, '不存在'), []);
});

test('处理记录时间线:审核中只到「平台审核中」且款项待定;驳回不出款项节点;已退款两步都完成', () => {
  const responses = [{ decisionText: '建议驳回', createTimeText: '2026-09-17 11:00', actorText: '店主', contentText: '已核销' }];
  const waiting = buildAftercareTimeline('WAITING_PLATFORM_REVIEW', '2026-09-17 10:05', responses);
  assert.deepEqual(waiting.map(n => [n.title, n.status]), [
    ['玩家提交退款申请', 'done'], ['建议驳回', 'done'], ['平台审核中', 'doing'], ['款项结果', 'todo'],
  ]);
  assert.equal(waiting[1].note, '已核销');
  assert.equal(waiting[3].time, undefined, '未来节点不给时间');

  const rejected = buildAftercareTimeline('PLATFORM_REJECTED', '', []);
  assert.deepEqual(rejected.map(n => n.status), ['done', 'rejected']);

  const refunded = buildAftercareTimeline('REFUNDED', '', []);
  assert.deepEqual(refunded.map(n => [n.title, n.status]), [
    ['玩家提交退款申请', 'done'], ['平台已批准退款', 'done'], ['平台确认已退款', 'done'],
  ]);
  const paying = buildAftercareTimeline('REFUND_PROCESSING', '', []);
  assert.deepEqual(paying.slice(-1).map(n => [n.title, n.status]), [['退款处理中', 'doing']],
    '款项处理中不得画成已完成');
  const unknown = buildAftercareTimeline('UNKNOWN', '', []);
  assert.deepEqual(unknown.slice(-1).map(n => n.status), ['todo']);
  assert.ok(shapeAftercareDetail({
    refundId: 81, processing: 'REFUNDED', merchantOpinion: 'AGREE', canRespond: false, allowedDecisions: [], responses: [],
  }).timelineNodes.length === 3);
});

test('后端展示列:标题昵称优先回落单号，活动名第二行，转平台注明;非字符串脏数据整页拒收', () => {
  const page = listPage('PENDING', [
    listItem({ refundId: 1, refundNo: 'RF-1', customerNickname: ' 小王 ', activityTitle: '外滩夜跑', platformTakeoverAt: '2026-09-18 10:06:00' }),
    listItem({ refundId: 2, refundNo: 'RF-2', customerNickname: null, activityTitle: null, platformTakeoverAt: null }),
    listItem({ refundId: 3, refundNo: 'RF-3' }),
  ]);
  const [withAll, withNone, legacy] = page.items;
  assert.equal(withAll.titleText, '小王');
  assert.equal(withAll.activityTitleText, '外滩夜跑');
  assert.equal(withAll.takeoverText, '已转平台客服');
  assert.equal(withAll.statusText, '待回应', '转平台只追加注明,不改状态');
  assert.equal(withNone.titleText, 'RF-2');
  assert.equal(withNone.activityTitleText, '');
  assert.equal(withNone.takeoverText, '');
  assert.equal(legacy.titleText, 'RF-3', '旧回包没有新字段时照常回落');

  assert.deepEqual(filterAftercareItems(page.items, '小王').map(i => i.refundId), [1]);
  assert.deepEqual(filterAftercareItems(page.items, '夜跑').map(i => i.refundId), [1]);

  assert.equal(listPage('PENDING', [listItem({ customerNickname: 123 })]), null, '昵称类型不对必须整页拒收');
  assert.equal(listPage('PENDING', [listItem({ activityTitle: {} })]), null);
});

test('详情展示列:副标题「报名退款 · 活动名」、客户昵称、转平台时间进状态卡与时间线', () => {
  const base = { refundId: 81, sourceType: 'registration', processing: 'WAITING_PLATFORM_REVIEW', merchantOpinion: 'PENDING',
    canRespond: true, allowedDecisions: ['AGREE', 'REJECT', 'EVIDENCE'], responses: [], createTime: '2026-09-17 10:05:00' };
  const full = shapeAftercareDetail(Object.assign({}, base, {
    activityTitle: '外滩夜跑', customerNickname: '小王', platformTakeoverAt: '2026-09-18 10:06:00' }));
  assert.equal(full.headSubtitle, '报名退款 · 外滩夜跑');
  assert.equal(full.customerNicknameText, '小王');
  assert.equal(full.platformTakeoverText, '2026-09-18 10:06');
  assert.deepEqual(full.timelineNodes.map(n => n.title), ['玩家提交退款申请', '商家超时未表态，已转平台客服', '平台审核中', '款项结果']);
  assert.equal(full.timelineNodes[1].time, '2026-09-18 10:06');

  const bare = shapeAftercareDetail(base);
  assert.equal(bare.headSubtitle, '报名退款');
  assert.equal(bare.customerNicknameText, '');
  assert.equal(bare.platformTakeoverText, '');
  assert.ok(!bare.timelineNodes.some(n => /转平台/.test(n.title)), '没有后端时间就不画转平台节点');
  assert.equal(shapeAftercareDetail(Object.assign({}, base, { customerNickname: 1 })), null);
  assert.equal(shapeAftercareDetail(Object.assign({}, base, { platformTakeoverAt: 1758074760000 })), null, '转平台时间只收后端格式化字符串');

  // 转平台之后商家还能回应:节点必须按时间插在商家记录之间,不能一律排在最后
  const withResponses = buildAftercareTimeline('WAITING_PLATFORM_REVIEW', '2026-09-17 10:05', [
    { decisionText: '补充凭证', createTimeText: '2026-09-17 12:00', actorText: '财务', contentText: '' },
    { decisionText: '同意申请', createTimeText: '2026-09-19 09:00', actorText: '店主', contentText: '' },
  ], '2026-09-18 10:06');
  assert.deepEqual(withResponses.map(n => n.title),
    ['玩家提交退款申请', '补充凭证', '商家超时未表态，已转平台客服', '同意申请', '平台审核中', '款项结果']);
});
