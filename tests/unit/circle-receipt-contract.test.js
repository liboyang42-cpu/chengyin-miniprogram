const assert = require('node:assert/strict');
const test = require('node:test');

const PAGE_PATH = require.resolve('../../pages/play/circle/index.js');
let definition;
// app 在模块加载时就被 const app = getApp() 抓住了，所以这里给一个可换 handler 的常驻桩。
const appStub = { globalData: {}, handler: null, sendRequest(opts) { appStub.handler(opts); } };

function loadPage() {
  const previousPage = global.Page;
  const previousGetApp = global.getApp;
  const previousWx = global.wx;
  global.Page = (options) => { definition = options; };
  global.getApp = () => appStub;
  global.wx = { showToast() {} };
  delete require.cache[PAGE_PATH];
  require(PAGE_PATH);
  global.Page = previousPage;
  global.getApp = previousGetApp;
  global.wx = previousWx;
}
loadPage();

function createPage(cardAfterRefresh) {
  const toasts = [];
  const previousWx = global.wx;
  global.wx = { showToast: (opts) => toasts.push(opts.title) };
  const page = {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), {
      card: { records: [], answers: [] }, offers: [], noteDrafts: {},
    }),
    setData(update, cb) { Object.assign(this.data, update); if (cb) cb(); },
    toasts,
    refreshCalls: 0,
    _sessionId: 5,
    _themeCode: 'SHANGHAI',
    restore() { global.wx = previousWx; },
  };
  Object.assign(page, definition);
  page.refreshCard = function () {
    this.refreshCalls += 1;
    if (!cardAfterRefresh) return Promise.resolve(false);
    this.data.card = cardAfterRefresh;
    return Promise.resolve(true);
  };
  return page;
}

const tap = (id) => ({ currentTarget: { dataset: { id } } });

test('★负控：记录请求丢响应 ⇒ unknown，不解锁 submitting，不说失败', async () => {
  const page = createPage(null);
  page._request = null;
  global.wx.showToast = (o) => page.toasts.push(o.title);
  // 直接驱动 unknown 分支：landed 判据恒假且回读失败
  await page._resolveUnknown(() => false);
  assert.equal(page.data.receipt, 'unknown');
  assert.equal(page.data.submitting, true, 'unknown 期间必须锁着');
  assert.match(page.data.receiptText, /勿重复提交/);
  assert.doesNotMatch(page.data.receiptText, /失败|成功/);
  page.restore();
});

test('unknown 回读到「这笔已在卡上」⇒ confirmed，不重发', async () => {
  const page = createPage({ records: [{ offerId: 9 }], answers: [] });
  await page._resolveUnknown(() => page._hasRecord(9));
  assert.equal(page.data.receipt, 'confirmed');
  assert.equal(page.data.submitting, false);
  assert.equal(page.refreshCalls, 1, '只重读一次，绝不重写');
  page.restore();
});

test('unknown 回读到「卡上没有」⇒ failed，才放行重试', async () => {
  const page = createPage({ records: [], answers: [] });
  await page._resolveUnknown(() => page._hasRecord(9));
  assert.equal(page.data.receipt, 'failed');
  assert.equal(page.data.submitting, false);
  assert.match(page.data.receiptText, /没有提交成功/);
  page.restore();
});

test('_hasAnswer 按 stage+value 比对服务端回读结果', async () => {
  const page = createPage(null);
  page.data.card = { records: [], answers: [{ answerStage: 'PRE_WISH', answerValue: ' a1 ' }] };
  assert.equal(page._hasAnswer('PRE_WISH', 'a1'), true, '两侧都要 trim');
  assert.equal(page._hasAnswer('PRE_WISH', 'a2'), false);
  assert.equal(page._hasAnswer('NEXT_PICK', 'a1'), false);
  page.restore();
});

test('retryReceiptReadback 只在 unknown 下生效', async () => {
  const page = createPage({ records: [], answers: [] });
  page.data.receipt = 'confirmed';
  page.retryReceiptReadback();
  assert.equal(page.refreshCalls, 0);
  page.restore();
});

test('★「你已经记录过这家供给」是确认不是失败：不弹红，转 confirmed', async () => {
  const page = createPage({ records: [{ offerId: 9 }], answers: [] });
  appStub.handler = (opts) => opts.success({ code: 500, msg: '你已经记录过这家供给' });
  await page.recordOffer(tap(9));
  assert.equal(page.data.receipt, 'confirmed',
    '撞唯一键说明上一次其实写进去了；判 failed 会让用户以为没记上，然后再点一次');
  assert.equal(page.refreshCalls, 1, '要回读记录卡把真实状态拿回来');
  assert.deepEqual(page.toasts, [], '不该弹错误提示');
  page.restore();
});

test('真正的业务失败仍然是 failed 并弹出原因', async () => {
  const page = createPage({ records: [], answers: [] });
  appStub.handler = (opts) => opts.success({ code: 500, msg: '该商家供给当前不可用于本次探索' });
  await page.recordOffer(tap(9));
  assert.equal(page.data.receipt, 'failed');
  assert.equal(page.data.submitting, false);
  assert.deepEqual(page.toasts, ['该商家供给当前不可用于本次探索']);
  page.restore();
});

test('★负控：recordOffer 网络断开 ⇒ unknown 且不放行第二次写请求', async () => {
  const page = createPage(null);
  let writes = 0;
  appStub.handler = (opts) => {
    if (opts.method !== 'GET') writes += 1;
    opts.fail();
  };
  await page.recordOffer(tap(9));
  assert.equal(page.data.receipt, 'unknown');
  assert.equal(writes, 1);
  await page.recordOffer(tap(9));
  assert.equal(writes, 1, 'unknown 未解除前不得再发写请求');
  page.restore();
});
