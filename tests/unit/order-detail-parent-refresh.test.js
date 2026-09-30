const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const HOST = 'subpackageMember/order/order';

function harness() {
  const requests = [], events = [], modals = [], toasts = [];
  let parent, history, detail;
  let loadingDepth = 0;
  const app = {
    globalData: {}, memberId: 9, getUserID() { return this.memberId; }, getPageSize: () => 10,
    getRequestErrorMessage: (r, fallback) => (r && r.msg) || fallback,
    tips() {}, sendRequest: (request) => requests.push(request),
  };
  const wx = { getStorageSync: () => '', setStorageSync() {}, showLoading() {}, hideLoading() {} };
  const markup = fs.readFileSync(path.join(ROOT, HOST + '.wxml'), 'utf8');
  function load(file, kind) {
    let definition;
    const full = path.join(ROOT, file);
    vm.runInNewContext(fs.readFileSync(full, 'utf8'), {
      Page: (value) => { definition = value; }, Component: (value) => { definition = value; },
      getApp: () => app, wx, console, setTimeout, clearTimeout,
      require(id) {
        if (id.endsWith('/modal.js')) return { show: (options) => modals.push(options) };
        if (id.endsWith('/loading.js')) return { show() { loadingDepth += 1; }, hide() { loadingDepth -= 1; } };
        if (id.endsWith('/toast.js')) { const toast = (s) => toasts.push(s); toast.success = toast; return toast; }
        return require(path.resolve(path.dirname(full), id));
      },
    }, { filename: full });
    const instance = Object.assign({}, definition, definition.methods || {});
    instance.data = JSON.parse(JSON.stringify(definition.data));
    instance.setData = (patch, callback) => { Object.assign(instance.data, patch); if (callback) callback(); };
    instance.selectComponent = (selector) => selector === '#orderHistory' ? history : null;
    instance.triggerEvent = (name, data) => {
      events.push({ kind, name, detail: data });
      const tag = kind === 'history' ? 'cy-scene-member-order-history'
        : kind === 'detail' ? 'cy-scene-member-order-detail' : 'cy-scene-sheet';
      const element = new RegExp('<' + tag + '\\b[^>]*>').exec(markup);
      const binding = element && new RegExp('bind:' + name + '="([^"]+)"').exec(element[0]);
      if (binding) parent[binding[1]]({ detail: data });
    };
    return instance;
  }
  parent = load(HOST + '.js', 'page');
  history = load('components/cy/scene-member-order-history/index.js', 'history');
  detail = load('components/cy/scene-member-order-detail/index.js', 'detail');
  const sheet = load('components/cy/scene-sheet/index.js', 'sheet');
  const active = {
    id: 88, registrationStatus: 2, paymentStatus: 2, verificationStatus: 0, canRequestRefund: true,
    wechatPaymentAmount: 0, pointPaymentAmount: 0, ownerType: 2, ownerId: 23,
    cmsActivity: { name: 'B', startDate: '2099-09-18 10:00:00', endDate: '2099-09-18 18:00:00' },
  };
  const cancelled = { ...active, registrationStatus: 3, paymentStatus: 4, canRequestRefund: false };
  function reply(request, payload) {
    assert.ok(request, 'request must exist');
    request.success(structuredClone(payload));
    if (request.complete) request.complete();
  }
  function pending(url) { return requests.filter((r) => r.url === url); }
  function initial() {
    history.lifetimes.attached.call(history);
    reply(pending('/api/registration/list')[0], { code: 200, data: { rows: [active] } });
    assert.equal(history.data.list[0].orderStateKey, 'not_started');
    history.openDetail({ currentTarget: { dataset: { id: 88 } } });
    assert.equal(parent.data.sceneCurrent.params.id, 88);
    detail.data.orderId = String(parent.data.sceneCurrent.params.id);
    detail.lifetimes.attached.call(detail);
    reply(pending('/api/registration/info')[0], { code: 200, data: active });
    assert.equal(detail.data.info.orderStateKey, 'not_started');
  }
  function beginCancel() {
    detail.cancelRegistration();
    modals[modals.length - 1].success({ confirm: true });
    return pending('/api/registration/cancel-refund').at(-1);
  }
  return { loadingDepth: () => loadingDepth, app, requests, events, modals, toasts, parent, history, detail, sheet,
    active, cancelled, initial, beginCancel, pending, reply };
}

test('已核销主单及未核销从单均展示人工售后主卡并可回查处理进度', () => {
  for (const verificationStatus of [0, 1]) {
    const h = harness(); h.initial();
    const row = { ...h.active, verificationStatus, manualRefundCaseStatus: 'MANUAL_REFUND_REQUIRED',
      refundInfo: { refundable: false, reason: '人工评估已通过，等待退款处理' },
      refundDeadlineDisplay: '人工评估已通过，等待退款处理' };
    h.detail.reloadOrder();
    h.reply(h.pending('/api/registration/info').at(-1), { code: 200, data: row });
    assert.equal(h.detail.data.info.orderStateKey, 'manual_refund');
    assert.equal(h.detail.data.info.canRequestRefund, false);
    assert.equal(h.detail.data.info.orderHint, row.refundInfo.reason);
    assert.equal(h.detail.data.stateNotice.title, '售后处理进度');
    const verification = h.detail.data.orderTimeline.find(item => item.key === 'verification');
    assert.equal(verification.label, verificationStatus ? '权益已核销' : '尚未核销');
    if (!verificationStatus) assert.equal(verification.time, '');
    h.detail.cancelRegistration();
    assert.equal(h.pending('/api/registration/cancel-refund').length, 0);
    assert.equal(h.modals.length, 0);
    h.history.getList(true, true);
    h.reply(h.pending('/api/registration/list').at(-1), { code: 200, data: { rows: [row] } });
    assert.equal(h.history.data.list[0].orderStateKey, 'manual_refund');
    h.history.openDetail({ currentTarget: { dataset: { id: 88 } } });
    assert.equal(h.parent.data.sceneCurrent.params.id, 88);
  }
});

for (const close of ['detail', 'sheet']) test('取消成功后' + close + '返回通过权威回读刷新订单列表', () => {
  const h = harness(); h.initial();
  h.reply(h.beginCancel(), { code: 200, data: { cashRefundRequired: false } });
  h.reply(h.pending('/api/registration/info')[1], { code: 200, data: h.cancelled });
  assert.equal(h.detail.data.info.orderStateKey, 'cancelled');
  if (close === 'detail') h.detail.goBack(); else h.sheet.onBack();
  assert.equal(h.parent.data.sceneCurrent, null);
  assert.equal(h.pending('/api/registration/list').length, 2, '成功取消必须触发一次列表回读');
  assert.equal(h.history.data.list[0].orderStateKey, 'not_started', '回读完成前不能本地伪造已取消');
  h.reply(h.pending('/api/registration/list')[1], { code: 200, data: { rows: [h.cancelled] } });
  assert.equal(h.history.data.list[0].orderStateKey, 'cancelled');
});

test('账号切换后旧取消回执不能触发新账号列表刷新', () => {
  const h = harness(); h.initial();
  const cancel = h.beginCancel();
  h.app.memberId = 10;
  h.reply(cancel, { code: 200, data: {} });
  assert.equal(h.pending('/api/registration/list').length, 1);
  assert.equal(h.pending('/api/registration/info').length, 1);
});

test('取消后列表回读跨账号时丢弃旧回执，新账号正常读取', () => {
  const h = harness(); h.initial();
  h.reply(h.beginCancel(), { code: 200, data: {} });
  const oldRead = h.pending('/api/registration/list')[1];
  h.app.memberId = 10;
  h.history.pageLifetimes.show.call(h.history);
  assert.equal(h.pending('/api/registration/list').length, 3, '旧账号在途读取不能挡住新账号加载');
  assert.equal(h.history.data.list.length, 0, '新账号不能沿用旧账号快照');
  h.reply(h.pending('/api/registration/list')[2], { code: 200, data: { rows: [{ ...h.active, id: 99 }] } });
  h.reply(oldRead, { code: 200, data: { rows: [h.cancelled] } });
  assert.equal(h.history.data.list[0].id, 99);
});

for (const failure of ['business', 'network']) test('取消' + failure + '失败不触发列表同步且不伪造取消', () => {
  const h = harness(); h.initial();
  const request = h.beginCancel();
  if (failure === 'business') request.success({ code: 500, msg: 'cancel rejected' });
  else request.fail({ msg: 'network failed' });
  request.complete();
  h.sheet.onBack();
  assert.equal(h.pending('/api/registration/list').length, 1);
  assert.equal(h.detail.data.info.orderStateKey, 'not_started');
  assert.equal(h.history.data.list[0].orderStateKey, 'not_started');
  assert.ok(h.toasts.some((text) => /rejected|failed/.test(text)));
});

test('仅查看、重复关闭和不相关子层事件不会触发额外订单请求', () => {
  const h = harness(); h.initial();
  h.sheet.onBack(); h.parent.closeScene();
  h.parent.onOrderChanged({ detail: { id: 88 } });
  h.parent.openScene({ detail: { id: 'play-activity-detail', params: { id: 88 } } });
  h.parent.onOrderChanged({ detail: { id: 88 } });
  h.parent.closeScene();
  assert.equal(h.pending('/api/registration/list').length, 1);
  assert.equal(h.history.data.list[0].orderStateKey, 'not_started');
});

test('取消连点单次写入，回读替换更早列表请求且重复关闭不重复刷新', () => {
  const h = harness(); h.initial();
  h.history.retryList();
  const stale = h.pending('/api/registration/list')[1];
  const cancel = h.beginCancel();
  h.detail.cancelRegistration();
  assert.equal(h.modals.length, 1);
  h.reply(cancel, { code: 200, data: {} });
  h.sheet.onBack(); h.parent.closeScene();
  assert.equal(h.pending('/api/registration/cancel-refund').length, 1);
  assert.equal(h.pending('/api/registration/list').length, 3);
  h.reply(h.pending('/api/registration/list')[2], { code: 200, data: { rows: [h.cancelled] } });
  h.reply(stale, { code: 200, data: { rows: [h.active] } });
  assert.equal(h.history.data.list[0].orderStateKey, 'cancelled');
});

test('取消成功但列表回读失败显示可重试错误，成功重试才更新资格', () => {
  const h = harness(); h.initial();
  h.reply(h.beginCancel(), { code: 200, data: {} });
  h.sheet.onBack();
  const read = h.pending('/api/registration/list')[1];
  read.fail({ msg: '刷新失败' }); read.complete();
  assert.equal(h.history.data.list[0].orderStateKey, 'not_started');
  assert.equal(h.history.data.errorMsg, '刷新失败');
  h.history.retryList();
  h.reply(h.pending('/api/registration/list')[2], { code: 200, data: { rows: [h.cancelled] } });
  assert.equal(h.history.data.list[0].orderStateKey, 'cancelled');
  assert.equal(h.history.data.errorMsg, '');
});

test('复用详情后旧订单取消回执不能刷新当前订单列表', () => {
  const h = harness(); h.initial();
  const cancel = h.beginCancel();
  h.detail._setOrderId('99');
  h.reply(cancel, { code: 200, data: {} });
  assert.equal(h.pending('/api/registration/list').length, 1);
  assert.equal(h.detail._orderId, '99');
});

for (const result of ['success', 'fail']) test('切号后的取消' + result + '释放本请求资源但不刷新新账号', () => {
  const h = harness(); h.initial();
  const cancel = h.beginCancel();
  assert.equal(h.loadingDepth(), 1);
  h.app.memberId = 10;
  if (result === 'success') cancel.success({ code: 200, data: {} });
  else cancel.fail({ msg: 'old failure' });
  cancel.complete();
  assert.equal(h.loadingDepth(), 0);
  assert.equal(h.detail.data.cancelling, false);
  assert.equal(h.pending('/api/registration/list').length, 1);
  assert.equal(h.toasts.length, 0);
});

test('切单后旧取消 complete 不清理新取消的锁或 loading', () => {
  const h = harness(); h.initial();
  const oldCancel = h.beginCancel();
  h.detail._setOrderId('99');
  assert.equal(h.loadingDepth(), 0);
  h.reply(h.pending('/api/registration/info')[1], { code: 200, data: { ...h.active, id: 99 } });
  const newCancel = h.beginCancel();
  oldCancel.complete();
  assert.equal(h.loadingDepth(), 1);
  assert.equal(h.detail.data.cancelling, true);
  newCancel.complete();
  assert.equal(h.loadingDepth(), 0);
  assert.equal(h.detail.data.cancelling, false);
});

test('详情销毁释放取消资源，晚到 complete 不重复释放', () => {
  const h = harness(); h.initial();
  const cancel = h.beginCancel();
  h.detail.lifetimes.detached.call(h.detail);
  assert.equal(h.loadingDepth(), 0);
  cancel.complete();
  assert.equal(h.loadingDepth(), 0);
});

test('同代际新请求在途时旧 complete 重复到达不能释放新资源', () => {
  const h = harness(); h.initial();
  const oldCancel = h.beginCancel();
  oldCancel.fail({ msg: 'retry allowed' }); oldCancel.complete();
  const newCancel = h.beginCancel();
  oldCancel.complete();
  assert.equal(h.loadingDepth(), 1);
  assert.equal(h.detail.data.cancelling, true);
  newCancel.complete();
  assert.equal(h.loadingDepth(), 0);
  assert.equal(h.detail.data.cancelling, false);
});

for (const outcome of ['confirm', 'fail', 'complete']) test('确认弹层切号后' + outcome + '清理自己的提示锁且不发旧账号写入', () => {
  const h = harness(); h.initial();
  h.detail.cancelRegistration();
  const oldPrompt = h.modals[0];
  h.app.memberId = 10;
  if (outcome === 'confirm') oldPrompt.success({ confirm: true });
  else if (outcome === 'fail') oldPrompt.fail({});
  oldPrompt.complete();
  assert.equal(h.detail._cancelPromptOpen, false);
  assert.equal(h.pending('/api/registration/cancel-refund').length, 0);
  h.detail.cancelRegistration();
  assert.equal(h.modals.length, 2, '旧提示锁不能挡住后续确认');
});

for (const reuse of ['same-order', 'new-order']) test('旧弹层晚到回调不释放' + reuse + '新弹层提示锁或发旧写入', () => {
  const h = harness(); h.initial();
  h.detail.cancelRegistration();
  const oldPrompt = h.modals[0];
  if (reuse === 'new-order') {
    h.detail._setOrderId('99');
    h.reply(h.pending('/api/registration/info')[1], { code: 200, data: { ...h.active, id: 99 } });
  } else oldPrompt.success({ confirm: false });
  h.detail.cancelRegistration();
  assert.equal(h.modals.length, 2);
  oldPrompt.complete(); oldPrompt.fail({}); oldPrompt.success({ confirm: true });
  assert.equal(h.detail._cancelPromptOpen, true);
  assert.equal(h.pending('/api/registration/cancel-refund').length, 0);
  h.detail.cancelRegistration();
  assert.equal(h.modals.length, 2);
  h.modals[1].success({ confirm: true }); h.modals[1].complete();
  assert.equal(h.pending('/api/registration/cancel-refund').length, 1);
  assert.equal(h.pending('/api/registration/cancel-refund')[0].data.id, reuse === 'new-order' ? 99 : 88);
});

test('详情销毁释放确认弹层提示锁，旧确认不得发写入', () => {
  const h = harness(); h.initial();
  h.detail.cancelRegistration();
  h.detail.lifetimes.detached.call(h.detail);
  assert.equal(h.detail._cancelPromptOpen, false);
  h.modals[0].success({ confirm: true }); h.modals[0].complete();
  assert.equal(h.pending('/api/registration/cancel-refund').length, 0);
});
