const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function ledgerPage() {
  let page;
  vm.runInNewContext(read('pages/merchant/ledger/index.js'), {
    Page: definition => { page = definition; },
    getApp: () => ({}),
    require: request => request.includes('merchant-finance')
      ? { money: value => Number(value).toFixed(2) }
      : {},
    console,
  });
  return page;
}

function detailPage(file, payload, query) {
  let page;
  let request;
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: options => { request = options; },
  };
  vm.runInNewContext(read(file), {
    Page: definition => { page = definition; },
    getApp: () => app,
    require: requestPath => requestPath.includes('merchant-finance')
      ? { isFinanceObjectPayload: result => !!result && result.code === 200 && !!result.data, money: value => Number(value).toFixed(2) }
      : (requestPath.includes('response-shape')
        ? {
          isRecord: value => !!value && typeof value === 'object' && !Array.isArray(value),
          isRecordList: value => Array.isArray(value)
            && value.every(item => !!item && typeof item === 'object' && !Array.isArray(item)),
        }
        : {}),
    console,
    wx: {},
  });
  const context = {
    data: query,
    setData(next) { this.data = Object.assign({}, this.data, next); },
  };
  page.load.call(context);
  request.success({ code: 200, data: completeDetailFixture(file, payload, query) });
  return context.data.detail;
}

function completeDetailFixture(file, payload, query) {
  if (file.includes('/order-detail/')) {
    return Object.assign({
      recordKey: `${query.recordType}:${query.recordId}`,
      recordType: query.recordType,
      recordId: String(query.recordId),
      fulfillmentState: 'ACTIVE',
      settlementState: 'PENDING',
      settlementRoute: 'PERSONAL_BALANCE',
      displayState: 'PENDING_SETTLEMENT',
    }, payload);
  }
  return Object.assign({}, payload, {
    batch: Object.assign({ batchId: String(query.batchId), holdState: 'NORMAL' }, payload.batch),
  });
}

function assertNoCashMarkup(wxml) {
  // 2026-08-11 重排:右列改成"只放金额",零现金放中性破折号;状态文案下沉成 cy-badge chip。
  // 不变量没变 —— 零现金不得出现金额串、不得回落成「待主题结算」。
  assert.doesNotMatch(wxml, /fin-row__v[^>]*>\s*待主题结算/,
    '零现金不得回落成待主题结算');
  assert.match(wxml, /class="fin-row__v fin-row__v--\{\{item\.amountTone\}\}"\s+wx:if="\{\{merchantAccess\.canReadFinance\}\}">\{\{item\.amountDisplay\}\}<\/text>/,
    '右列必须只渲染金额位(零现金由 amountDisplay 给破折号)');
  assert.match(wxml, /<cy-badge class="fin-row__chip" type="status" variant="\{\{item\.stateVariant\}\}" label="\{\{item\.stateText\}\}"/,
    '状态必须走服务端归因后的 stateText,且以 chip 呈现');
}

test('三种零现金原因不显示金额，列表右列只展示服务端状态文案', () => {
  const redemptionRow = ledgerPage().redemptionRow;
  const cases = [
    ['权益已履约 · 无现金结算', '权益已履约 · 无现金结算'],
    ['本次接待不产生结算', '本次接待不产生结算'],
    ['本次合作不产生现金分润', '本次合作不产生现金分润'],
  ];

  for (const [noCashReason, expected] of cases) {
    const row = redemptionRow({ settlementAmount: '0.00', displayState: 'NO_CASH_SETTLEMENT', noCashReason });
    assert.equal(row.amountText, null, `${expected} 不能渲染 +¥0.00`);
    assert.equal(row.amountDisplay, '—', `${expected} 右列必须是中性破折号而不是金额串`);
    assert.doesNotMatch(row.amountDisplay, /¥|\d/, `${expected} 不得保留金额串`);
    assert.equal(row.stateText, expected, `${expected} 必须从服务端文案透传`);
  }
  assertNoCashMarkup(read('pages/merchant/ledger/index.wxml'));
});

test('负控：把零现金右列改回写死待主题结算必须判红', () => {
  const wxml = read('pages/merchant/ledger/index.wxml');
  assertNoCashMarkup(wxml);
  const broken = wxml.replace(
    'class="fin-row__v fin-row__v--{{item.amountTone}}" wx:if="{{merchantAccess.canReadFinance}}">{{item.amountDisplay}}</text>',
    'class="fin-row__v fin-row__v--{{item.amountTone}}" wx:if="{{merchantAccess.canReadFinance}}">待主题结算</text>');
  assert.notEqual(broken, wxml, '负控锚点失效');
  assert.throws(() => assertNoCashMarkup(broken), /零现金不得回落成待主题结算/);
});

test('核销详情归一退款状态，并将零金额交给服务端零现金文案', () => {
  const base = { settlementAmount: '0.00', displayState: 'NO_CASH_SETTLEMENT', noCashReason: '本次合作不产生现金分润' };
  const none = detailPage('pages/merchant/ledger/order-detail/index.js', Object.assign({}, base, { refundState: 'NONE' }), { recordType: 'redemption', recordId: '31' });
  const refunded = detailPage('pages/merchant/ledger/order-detail/index.js', Object.assign({}, base, { refundState: 'REFUNDED' }), { recordType: 'redemption', recordId: '31' });
  assert.equal(none.amountText, null, '详情也不得渲染 ¥0.00');
  assert.equal(none.stateText, '本次合作不产生现金分润');
  assert.equal(none.refundText, '', 'NONE 必须整行不渲染');
  assert.equal(refunded.refundText, '已退款', '退款原始码只能映射为中文');

  const wxml = read('pages/merchant/ledger/order-detail/index.wxml');
  assert.match(wxml, /wx:if="\{\{detail\.refundText\}\}"/, '退款整行必须由中文展示字段控制');
  assert.match(wxml, /\{\{detail\.refundText\}\}/, '退款值必须使用中文展示字段');
  assert.doesNotMatch(wxml, /\{\{detail\.refundState\}\}/, 'WXML 禁止直接插入退款原始枚举');
});

function assertBatchMarkup(wxml) {
  assert.match(wxml, /\{\{detail\.batch\.paymentText\}\}/, '付款状态必须消费中文展示字段');
  assert.doesNotMatch(wxml, /\{\{detail\.batch\.paymentState\}\}/, 'WXML 禁止直接插入付款原始枚举');
  assert.match(wxml, /批次净额/, '批次详情必须展示守恒后的净额');
  assert.match(wxml, /\{\{detail\.batch\.invoiceText\}\}/, '发票状态必须中文化');
  assert.match(wxml, /wx:if="\{\{detail\.batch\.isPaid\}\}"/, '凭证只在平台已打款时展示');
  assert.match(wxml, /\{\{item\.sourceText\}\}/, '调整标签必须按来源展示');
}

test('对公批次展示净额、平台打款凭证和按方向收口的动作文案', () => {
  const paid = detailPage('pages/merchant/ledger/batch-detail/index.js', {
    batch: { periodYm: '2026-08', amountTotal: '12.00', netDirection: 'PLATFORM_PAYS_MERCHANT', paymentState: 'PAID', invoiceState: 'ISSUED', paidAt: '2026-08-31 10:00:00', payVoucherNo: 'V-88' },
    earningEntries: [{ entryKey: 'e-1', signedAmount: '12.00', entryKind: 'EARNING', source: 'REDEMPTION_FEE' }],
    adjustments: [{ entryKey: 'a-1', signedAmount: '-2.00', entryKind: 'REVERSAL', source: 'REDEMPTION_FEE' }],
  }, { batchId: '8' });
  const zero = detailPage('pages/merchant/ledger/batch-detail/index.js', {
    batch: { periodYm: '2026-09', amountTotal: '0.00', netDirection: 'ZERO', paymentState: 'PENDING', invoiceState: 'NONE' }, earningEntries: [], adjustments: [],
  }, { batchId: '9' });
  const negative = detailPage('pages/merchant/ledger/batch-detail/index.js', {
    batch: { periodYm: '2026-10', amountTotal: '-2.00', netDirection: 'MERCHANT_OWES_PLATFORM', paymentState: 'PENDING', invoiceState: 'NONE' }, earningEntries: [], adjustments: [],
  }, { batchId: '10' });
  assert.equal(paid.batch.paymentText, '平台已打款');
  assert.equal(paid.batch.invoiceText, '已开票');
  assert.equal(paid.batch.isPaid, true);
  assert.equal(paid.adjustments[0].sourceText, '冲正');
  assert.equal(zero.batch.paymentText, '本期无需打款');
  assert.equal(zero.batch.showPaymentProgress, false);
  assert.equal(negative.batch.paymentText, '调整待处理');
  assert.equal(negative.batch.showPaymentProgress, false);
  assertBatchMarkup(read('pages/merchant/ledger/batch-detail/index.wxml'));
});

test('核销详情结算进度是竖向 timeline:四节点、未来节点无日期、永不出现「预计」', () => {
  const wxml = read('pages/merchant/ledger/order-detail/index.wxml');
  const wxss = read('pages/merchant/style/merchant-finance.wxss');
  assert.match(wxml, /fin-tl__step fin-tl__step--\{\{item\.state\}\}/, '进度必须由竖向 timeline 节点渲染');
  assert.match(wxss, /\.fin-tl__step--done::before/, '已完成态必须有专属视觉');
  assert.match(wxss, /\.fin-tl__step--now::before/, '当前态必须有专属视觉');
  // 2026-08-11 草图 v2:全页零分隔线 ⇒ timeline 不画连线,顺序由点的明暗序列表达。
  assert.doesNotMatch(wxss, /\.fin-tl::before\s*\{[^}]*background/s, '不得再画连线(v2:零 divider)');

  // 真跑页面 load,拿它实际算出来的 timeline,而不是断言字符串长相
  const detail = detailPage('pages/merchant/ledger/order-detail/index.js', {
    settlementRoute: 'CHAPTER_OFFER', settlementState: 'PENDING', displayState: 'PENDING_SETTLEMENT',
    occurredAt: '2026-08-07 20:50:00', settlementAmount: '12.00',
  }, { recordType: 'redemption', recordId: '1' });
  assert.equal(detail.timeline.length, 4, 'CHAPTER_OFFER 必须四个节点');
  assert.equal(detail.timeline.filter((n) => n.state === 'now').length, 1, '当前节点有且只有一个');
  detail.timeline.filter((n) => n.state === 'todo').forEach((n) => {
    assert.equal(n.at, '', `未来节点 ${n.label} 不得带日期(附录 C:禁「预计打款日期」假承诺)`);
  });
  assert.doesNotMatch(JSON.stringify(detail.timeline), /预计/, '任何节点都不得出现「预计」');
  // 批次页同理:断言它【算出来的】timeline,而不是 grep 源文件 —— 源文件里的注释提到「预计」是
  // 在说明禁令本身,grep 会把说明当违规(误报);真正要防的是渲染出去的文案。
  const batch = detailPage('pages/merchant/ledger/batch-detail/index.js', {
    batch: { periodYm: '2026-07', amountTotal: '156.00', netDirection: 'PLATFORM_PAYS_MERCHANT',
      paymentState: 'CONFIRMED', invoiceState: 'NONE', holdState: 'NORMAL' },
    earningEntries: [], adjustments: [],
  }, { batchId: 'b7' });
  assert.ok(batch.timeline.length >= 3, '对公批次必须有打款进度节点');
  batch.timeline.filter((n) => n.state === 'todo').forEach((n) => {
    assert.equal(n.at, '', `批次未来节点 ${n.label} 不得带日期`);
  });
  assert.doesNotMatch(JSON.stringify(batch.timeline), /预计/, '批次 timeline 不得出现「预计」');
});

test('步进器按业务事实判 done/now/todo,不拿「有没有时间戳」当完成判据', () => {
  // 2026-08-12 自审探针实测的三条病:①终态末节点画成空心;②ADJUSTMENT_PENDING(定稿 §5.3
  // 「原款已结」)把已打款画成没打款;③兜底 return 1 让首节点「核销成功」带着自己的时间戳画空心。
  // 这里跑的是页面真实的 buildTimeline(detailPage 会真走 load),不是断言 fixture。
  const timelineOf = (settlementState) => detailPage('pages/merchant/ledger/order-detail/index.js', {
    settlementRoute: 'CHAPTER_OFFER', settlementState, displayState: 'SETTLED',
    occurredAt: '2026-08-07 20:50:00', settlementAmount: '12.00',
    // 故意在每种状态下都喂 paidAt:证明判据是业务状态,喂了时间戳也不会把节点点亮。
    publicSettlement: { paidAt: '2026-08-10 10:00:00' },
  }, { recordType: 'redemption', recordId: '1' }).timeline.map((n) => n.state).join(' ');

  // 原款已结的三种状态:四节点全 done,没有「当前步」
  ['SETTLED', 'ADJUSTED', 'ADJUSTMENT_PENDING'].forEach((s) => {
    assert.equal(timelineOf(s), 'done done done done', `${s} 四节点必须全 done`);
  });
  // 待结算:核销已发生(实心),生成结算单正在办(空心环),其后未发生
  assert.equal(timelineOf('PENDING'), 'done now todo todo', 'PENDING 只有第二个节点是当前步');
  // 流程终止:核销发生过必须实心;后续不会推进 ⇒ 一个 now 都不许有(空心环会读成「在办」)
  ['ERROR', 'NOT_APPLICABLE'].forEach((s) => {
    assert.equal(timelineOf(s), 'done todo todo todo', `${s} 首节点必须实心且无当前步`);
  });

  // 批次页:批次对象存在 ⇒「批次生成」必然已发生,任何状态下都不许是 now/todo
  const batchStates = (paymentState, extra) => detailPage('pages/merchant/ledger/batch-detail/index.js', {
    batch: Object.assign({ periodYm: '2026-07', amountTotal: '156.00', netDirection: 'PLATFORM_PAYS_MERCHANT',
      paymentState, invoiceState: 'NONE', holdState: 'NORMAL', createdAt: '2026-08-01 00:10:00' }, extra),
    earningEntries: [], adjustments: [],
  }, { batchId: 'b7' }).timeline.map((n) => n.state).join(' ');
  assert.equal(batchStates('PENDING'), 'done now todo', '批次已生成 ⇒ 首节点实心');
  assert.equal(batchStates('CONFIRMED', { confirmedAt: '2026-08-08 15:20:00' }), 'done done now',
    '对账已确认 ⇒ 前两节点实心,正在等打款');
  assert.equal(batchStates('PAID', { confirmedAt: '2026-08-08 15:20:00', paidAt: '2026-08-10 09:00:00' }),
    'done done done', 'PAID 三节点全 done');
});

test('终态的末节点必须是 done:走完了就没有「当前步」,不许把已完成画成空心圈', () => {
  // 2026-08-12 看图核出:SETTLED/PAID 时 step 恰好等于末节点序号 ⇒ 末节点被判成 now(空心圈),
  // 前序反而实心,与 hero 的「平台已打款」自相矛盾。终态 step 必须越过末节点。
  const settled = detailPage('pages/merchant/ledger/order-detail/index.js', {
    settlementRoute: 'CHAPTER_OFFER', settlementState: 'SETTLED', displayState: 'SETTLED',
    occurredAt: '2026-08-07 20:50:00', settlementAmount: '12.00',
    publicSettlement: { paidAt: '2026-08-10 10:00:00' },
  }, { recordType: 'redemption', recordId: '1' });
  assert.equal(settled.timeline.filter((n) => n.state !== 'done').length, 0,
    '已打款时四个节点必须全 done,一个 now/todo 都不许剩');

  const paid = detailPage('pages/merchant/ledger/batch-detail/index.js', {
    batch: { periodYm: '2026-07', amountTotal: '156.00', netDirection: 'PLATFORM_PAYS_MERCHANT',
      paymentState: 'PAID', invoiceState: 'NONE', holdState: 'NORMAL',
      createdAt: '2026-08-01 00:10:00', confirmedAt: '2026-08-08 15:20:00', paidAt: '2026-08-10 09:00:00' },
    earningEntries: [], adjustments: [],
  }, { batchId: 'b7' });
  assert.equal(paid.timeline.filter((n) => n.state !== 'done').length, 0,
    '批次已打款时三个节点必须全 done');

  // 标签不许待/已混用:同一条 timeline 里既有「待 X」又有「已 X」,读者无法判断哪些已发生。
  [].concat(settled.timeline, paid.timeline).forEach((n) => {
    assert.doesNotMatch(n.label, /^待/, `节点标签 ${n.label} 不得用「待 X」——节点名是里程碑,不是等待态`);
  });
});
