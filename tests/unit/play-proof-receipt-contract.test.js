const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PLAY_RECEIPT_STATE_ORDER, PLAY_RECEIPT_STATES, getPlayReceiptState,
} = require('../../utils/play-state-contract.js');

const PAGE_PATH = require.resolve('../../pages/play/merchant/index.js');
let definition;

// app 在模块加载时被 const app = getApp() 抓住，所以用一个可换 handler 的常驻桩。
const appStub = { handler: null, chooseImage() {}, sendRequest(opts) { appStub.handler(opts); } };

function loadPage() {
  const previousPage = global.Page;
  const previousGetApp = global.getApp;
  global.Page = (options) => { definition = options; };
  global.getApp = () => appStub;
  delete require.cache[PAGE_PATH];
  require(PAGE_PATH);
  global.Page = previousPage;
  global.getApp = previousGetApp;
}
loadPage();

// ── 词典本身 ─────────────────────────────────────────────
test('回执词典六态齐全，未知值 fail-closed 回 ready', () => {
  assert.deepEqual(PLAY_RECEIPT_STATE_ORDER.slice(),
    ['ready', 'submitting', 'confirmed', 'unknown', 'failed']);
  PLAY_RECEIPT_STATE_ORDER.forEach((key) => {
    assert.ok(PLAY_RECEIPT_STATES[key], key + ' 必须有定义');
    assert.equal(typeof PLAY_RECEIPT_STATES[key].readerLabel, 'string');
  });
  assert.equal(getPlayReceiptState('LANDED_MAYBE').key, 'ready');
  assert.equal(getPlayReceiptState(null).key, 'ready');
  assert.equal(getPlayReceiptState(undefined).key, 'ready');
});

test('★unknown 文案不得出现成功/失败/已记录 —— 结果就是不知道', () => {
  const unknown = PLAY_RECEIPT_STATES.unknown;
  [unknown.label, unknown.readerLabel].forEach((text) => {
    assert.doesNotMatch(text, /成功|失败|已记录|已完成|已到账/,
      `unknown 不能给用户一个结论：${text}`);
    assert.match(text, /待确认|勿重复/);
  });
  assert.equal(unknown.holdsLock, true, 'unknown 必须持锁');
  assert.equal(unknown.canRetry, false, 'unknown 不得放行重试写入');
});

test('只有 submitting 和 unknown 持锁；只有 failed/ready 可重试', () => {
  const holding = PLAY_RECEIPT_STATE_ORDER.filter((k) => PLAY_RECEIPT_STATES[k].holdsLock);
  assert.deepEqual(holding, ['submitting', 'unknown']);
  const retryable = PLAY_RECEIPT_STATE_ORDER.filter((k) => PLAY_RECEIPT_STATES[k].canRetry);
  assert.deepEqual(retryable, ['ready', 'failed']);
});

// ── 商家页现场证据提交 ────────────────────────────────────
function createPage(nodeState, plan) {
  const calls = [];
  // ⚠️ 必须先摊 definition(它自带 data),再装本例的 data —— 反过来会被 definition.data 顶掉,
  // 而且那是所有用例共享的同一个对象,会跨用例串味。
  const page = Object.assign({}, definition, {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), {
      node: Object.assign({ nodeId: 7, arrived: false, done: false, selfReported: false }, nodeState),
    }),
    setData(update, cb) { Object.assign(this.data, update); if (cb) cb(); },
    calls,
    _session: { activityId: 1 },
    _prev: null,
    _maybeAutoPopup() { calls.push({ popup: true }); },
  });
  page._readbackNode = () => {
    calls.push({ readback: true });
    return Promise.resolve(plan.readback === undefined ? null : plan.readback);
  };
  return page;
}

const netFail = () => Promise.resolve({ code: 'fail', netFail: true, msg: '网络异常，现场记录暂未同步' });

test('★负控：现场证据响应丢失 ⇒ 不解锁 busy，不写「失败」', async () => {
  const page = createPage({}, { readback: null });
  await page._submitProof(netFail, {}, '已记录到店');
  assert.equal(page.data.receipt, 'unknown');
  assert.equal(page.data.busy, true, 'unknown 期间必须锁着，否则用户一点就是重复核销');
  assert.doesNotMatch(page.data.degradedMessage, /失败/);
  assert.match(page.data.degradedMessage, /勿重复核销|待确认/);
});

test('unknown 回读到「服务端已记下」⇒ 转 confirmed，不重发写请求', async () => {
  const page = createPage({}, { readback: { nodeId: 7, arrived: true, done: false, selfReported: false } });
  await page._submitProof(netFail, {}, '已记录到店', { autoPopup: true });
  assert.equal(page.data.receipt, 'confirmed');
  assert.equal(page.data.busy, false);
  assert.equal(page.data.node.arrived, true);
  assert.equal(page.calls.filter((c) => c.readback).length, 1, '只能读一次，绝不重写');
});

test('unknown 回读到「节点没动」⇒ 转 failed 并放行重试', async () => {
  const page = createPage({}, { readback: { nodeId: 7, arrived: false, done: false, selfReported: false } });
  await page._submitProof(netFail, {}, '已记录到店');
  assert.equal(page.data.receipt, 'failed');
  assert.equal(page.data.busy, false);
  assert.match(page.data.feedback, /没有提交成功/);
});

test('retryProofReadback 只在 unknown 下生效，且只重读不重写', async () => {
  const page = createPage({}, { readback: null });
  page.data.receipt = 'confirmed';
  page.retryProofReadback();
  assert.equal(page.calls.filter((c) => c.readback).length, 0, '非 unknown 态不该触发回读');
});

test('业务失败（非网络）仍走 failed，不冒充 unknown', async () => {
  const page = createPage({}, { readback: null });
  await page._submitProof(() => Promise.resolve({ code: 500, msg: '不在核销时间内' }), {}, '已记录到店');
  assert.equal(page.data.receipt, 'failed');
  assert.equal(page.data.busy, false);
  assert.equal(page.data.feedback, '不在核销时间内');
  assert.equal(page.calls.filter((c) => c.readback).length, 0);
});


// ── 答题(submitGame)：与到店/照片同一套回执合同 ──────────────
function createGamePage(nodeState, readback) {
  const calls = [];
  const page = Object.assign({}, definition, {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), {
      node: Object.assign({ nodeId: 7, arrived: true, validationMethod: 3, question: 'Q' }, nodeState),
      game: { show: true, answer: '', choice: 'A', submitting: false, done: false, resultText: '', errText: '', receipt: 'ready' },
    }),
    setData(update, cb) {
      Object.keys(update).forEach((key) => {
        if (key.indexOf('.') === -1) { this.data[key] = update[key]; return; }
        const [head, tail] = key.split('.');
        this.data[head] = Object.assign({}, this.data[head], { [tail]: update[key] });
      });
      if (cb) cb();
    },
    calls,
    _session: { activityId: 1 },
  });
  page._readbackNode = () => { calls.push({ readback: true }); return Promise.resolve(readback); };
  return page;
}

test('答题首次完成才显示奖励飞字', async () => {
  const page = createGamePage({}, null);
  appStub.handler = (o) => o.success({ code: 200, msg: '答对了！', data: { firstTime: true, xp: 12 } });
  await page.submitGame();
  assert.equal(page.data.game.receipt, 'confirmed');
  assert.match(page.data.game.resultText, /\+12 探索值/);
});

test('★重复提交 firstTime=false ⇒ 不再飞一次奖励', async () => {
  const page = createGamePage({}, null);
  appStub.handler = (o) => o.success({ code: 200, msg: '该节点已完成', data: { firstTime: false, xp: 0 } });
  await page.submitGame();
  assert.equal(page.data.game.receipt, 'confirmed');
  assert.doesNotMatch(page.data.game.resultText, /探索值/, '重复完成不得再显示奖励入账');
});

test('★负控：答题响应丢失 ⇒ unknown，锁住不放行重答', async () => {
  const page = createGamePage({}, null);
  let writes = 0;
  appStub.handler = (o) => { if (o.method !== 'GET') writes += 1; o.fail(); };
  await page.submitGame();
  assert.equal(page.data.game.receipt, 'unknown');
  assert.equal(page.data.game.submitting, true, 'unknown 期间必须锁着');
  assert.doesNotMatch(page.data.game.errText, /失败|成功/);
  await page.submitGame();
  assert.equal(writes, 1, 'unknown 未解除前不得再发答案');
});

test('答题 unknown 回读 gameDone=true ⇒ confirmed 且不编造 xp', async () => {
  const page = createGamePage({}, { nodeId: 7, gameDone: true });
  appStub.handler = (o) => o.fail();
  await page.submitGame();
  assert.equal(page.data.game.receipt, 'confirmed');
  assert.equal(page.data.game.done, true);
  assert.doesNotMatch(page.data.game.resultText, /探索值/, '回读拿不到本次奖励明细，不许编');
  assert.equal(page.calls.filter((c) => c.readback).length, 1);
});

test('答题 unknown 回读 gameDone=false ⇒ failed，才放行重答', async () => {
  const page = createGamePage({}, { nodeId: 7, gameDone: false });
  appStub.handler = (o) => o.fail();
  await page.submitGame();
  assert.equal(page.data.game.receipt, 'failed');
  assert.equal(page.data.game.submitting, false);
  assert.match(page.data.game.errText, /没有提交成功/);
});

test('答错(业务失败)仍走 failed，不冒充 unknown', async () => {
  const page = createGamePage({}, null);
  appStub.handler = (o) => o.success({ code: 500, msg: '答案不正确' });
  await page.submitGame();
  assert.equal(page.data.game.receipt, 'failed');
  assert.equal(page.data.game.errText, '答案不正确');
  assert.equal(page.calls.filter((c) => c.readback).length, 0);
});

test('★后端必须下发 gameDone —— 没有它答题就没有权威回读', () => {
  const controller = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiPlayProgressController.java'),
    'utf8');
  assert.match(controller, /m\.put\("gameDone"/,
    '/api/play/nodes 不下发 gameDone 时，前端只能靠重发写请求去试探结果');
});


// ── 状态与它管辖的控件必须同处一个视野 ──────────────────
test('★状态条与主 CTA 同在固定容器里，不许漂回折叠线以下', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxml = fs.readFileSync(
    path.join(__dirname, '../../pages/play/merchant/index.wxml'), 'utf8');

  const wrapAt = wxml.indexOf('class="mp-cta-wrap"');
  assert.notEqual(wrapAt, -1, '底部固定容器必须存在');
  const wrap = wxml.slice(wrapAt, wxml.indexOf('</view>\n  </block>'));
  assert.match(wrap, /class="mp-status/, '状态条必须在固定容器内');
  assert.match(wrap, /class="mp-cta"/, '主 CTA 必须在同一个固定容器内');

  // 页面中段不许再留一份 —— 两份状态会各说各话
  assert.equal((wxml.match(/class="mp-status mp-status--/g) || []).length, 1,
    '状态条只能有一处');
});

test('状态色只落在圆点上，不整块染色', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wxss = fs.readFileSync(
    path.join(__dirname, '../../pages/play/merchant/index.wxss'), 'utf8');
  const statusBlock = wxss.slice(wxss.indexOf('.mp-status{'), wxss.indexOf('@keyframes mp-status-in'));
  assert.doesNotMatch(statusBlock.split('.mp-status__dot')[0], /status-warning|status-danger/,
    '容器本身不得用状态色做底或边框——那是把提示喊成警报');
  assert.match(wxss, /\.mp-status--unknown \.mp-status__dot\{ background:var\(--cy-color-status-warning\)/);
  assert.match(wxss, /\.mp-status--failed  \.mp-status__dot\{ background:var\(--cy-color-status-danger\)/);
});


// ── code-review 三条缺陷的回归闸 ────────────────────────
test('★5xx / 408 是「结果未知」,不是「答错了」', async () => {
  for (const status of [500, 502, 504, 408]) {
    const page = createGamePage({}, { nodeId: 7, gameDone: false });
    appStub.handler = (o) => o.successStatusAbnormal({ msg: '网关超时' }, status);
    await page.submitGame();
    assert.equal(page.data.game.receipt, 'failed',
      `HTTP ${status} 必须先进 unknown 再由回读判定，不能直接判业务失败`);
    // 回读说没落地才允许 failed；关键是它走了回读这条路
    assert.equal(page.calls.filter((c) => c.readback).length, 1,
      `HTTP ${status} 必须触发权威回读`);
    assert.doesNotMatch(page.data.game.errText, /再想想/,
      `HTTP ${status} 不得把丢响应讲成答错了`);
  }
});

test('4xx 仍是明确的业务失败，不走回读', async () => {
  const page = createGamePage({}, { nodeId: 7, gameDone: false });
  appStub.handler = (o) => o.successStatusAbnormal({ msg: '先扫店内静态码进店' }, 403);
  await page.submitGame();
  assert.equal(page.data.game.receipt, 'failed');
  assert.equal(page.calls.filter((c) => c.readback).length, 0, '4xx 不该触发回读');
  assert.equal(page.data.game.errText, '先扫店内静态码进店');
});

test('★unknown 期间关掉弹层再打开，业务锁不得被抹掉', async () => {
  const page = createGamePage({}, null);
  appStub.handler = (o) => o.fail();
  await page.submitGame();
  assert.equal(page.data.game.receipt, 'unknown');

  page.closeSheets();
  page.openGame();
  assert.equal(page.data.game.receipt, 'unknown', '重开弹层不得把 receipt 抹回 ready');
  assert.equal(page.data.game.submitting, true, '重开弹层不得解锁 submitting');
  assert.equal(page.data.game.show, true, '弹层本身要能重新打开');

  let writes = 0;
  appStub.handler = (o) => { if (o.method !== 'GET') writes += 1; o.fail(); };
  await page.submitGame();
  assert.equal(writes, 0, '锁还在，就不该再发写请求');
});
