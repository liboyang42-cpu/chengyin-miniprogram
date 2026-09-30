const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { decorate } = require('../../utils/coop-invite-view');
const ROOT = path.resolve(__dirname, '../..');

function pageHarness(relativePath, response) {
  let definition;
  const requests = [], navigations = [];
  const app = { globalData: {}, getUserID: () => 1, sendRequest(o) {
    requests.push(o);
    if (o.url === '/api/coop/list') o.success(response);
    if (o.url === '/api/coop/pool/list') o.success({ code: 200, data: { hasClub: true, rows: [] } });
  } };
  const file = path.join(ROOT, relativePath);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: p => { definition = p; }, getApp: () => app,
    wx: { stopPullDownRefresh() {}, navigateTo(o) { navigations.push(o.url); if (o.complete) o.complete(); } },
    setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (id.includes('/toast')) return () => {};
      if (id.includes('/modal')) return { show: o => o.success({ confirm: true, content: '测试理由' }) };
      if (id.includes('/loading')) return { show() {}, hide() {} };
      if (id.includes('/subscribe')) return {};
      if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (id.includes('/checkout-workflow')) return {};
      if (id.includes('/payment-verifier')) return {};
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } });
  return { page, requests, navigations };
}

test('真实 id 可定位详情，兼容历史字符串 id 与 inviteId，保留所有展示事实', () => {
  for (const raw of [{ id: 7 }, { id: '7' }, { inviteId: 7 }, { inviteId: '7' }]) {
    const row = Object.assign({ status: 5, inviteType: 1, partner: { name: '合作方' }, depositRefundPending: true }, raw);
    const decorated = decorate([row])[0];
    assert.equal(String(decorated.inviteId), '7');
    assert.equal(String(decorated.id), '7');
    assert.equal(decorated.status, 5);
    assert.equal(decorated.depositRefundPending, true);
    assert.equal(decorated.partner, row.partner);
  }
});

test('不精确或冲突的ID保留记录并给刷新错误，不发请求；精确raw优于不精确alias', () => {
  const rounded = JSON.parse('{"id":9007199254740993}');
  const preciseRaw = { id: '9007199254740993', inviteId: rounded.id };
  assert.equal(decorate([preciseRaw])[0].id, preciseRaw.id);
  for (const raw of [rounded, { id: 7, inviteId: '8' }, { id: '9223372036854775808' }, { id: 0 }, { id: true }]) {
    const response = { code: 200, data: { sent: [raw], received: [raw], slots: {} } };
    const env = pageHarness('pages/coop/list/index.js', response);
    env.page.load();
    assert.equal(env.page.data.received.length, 1, '错误记录不能被过滤掉');
    const row = env.page.data.received[0];
    assert.ok(row.identityError);
    assert.equal(row.id, '');
    assert.equal(row.inviteId, '');
    const before = env.requests.length;
    env.page.acceptReceived({ currentTarget: { dataset: { id: row.id } } });
    assert.equal(env.requests.length, before, '不确定ID不可提交');
    assert.match(env.page.data.listErrorText, /刷新/);
    const detail = pageHarness('pages/coop/invite-detail/index.js', response);
    detail.page.onLoad({ inviteId: '7', box: 'received' });
    assert.equal(detail.page.data.state, 'error', '身份不确定不能误报不在列表');
    assert.match(detail.page.data.errorText, /刷新/);
    response.data.received = [{ id: 7, inviteId: '7', status: 0 }];
    env.page.load();
    assert.equal(env.page.data.received[0].identityError, '');
    detail.page.retry();
    assert.equal(detail.page.data.state, 'ready', '刷新后的真实记录可恢复正常操作');
  }
});

test('多条异常卡片有独立展示key，正常同屏卡片仍可操作', () => {
  const response = { code: 200, data: { sent: [], received: [{ id: true }, { id: 0 }, { id: 7, inviteId: '7', status: 0 }], slots: {} } };
  const env = pageHarness('pages/coop/list/index.js', response);
  env.page.load();
  const rows = env.page.data.received;
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(r => r.rowKey)).size, 3);
  assert.equal(rows[0].id, '');
  assert.equal(rows[1].inviteId, '');
  env.page.acceptReceived({ currentTarget: { dataset: { id: rows[2].id } } });
  assert.equal(JSON.parse(env.requests.at(-1).data).id, 7);
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/coop/list/index.wxml'), 'utf8');
  assert.match(wxml, /wx:for="\{\{received\}\}" wx:key="rowKey"/);
  assert.match(wxml, /wx:for="\{\{sent\}\}" wx:key="rowKey"/);
  assert.match(wxml, /sub="\{\{item.identityError\}\}" retry="刷新邀约" bind:retry="load"/);
});

test('精确后端别名优先于已舍入 numeric id，列表/详情/所有邀约写入保持原值', () => {
  const exact = '9007199254740993';
  const wire = '{"id":9007199254740993,"inviteId":"9007199254740993","inviteType":1,"status":0,"topicId":7,"topicName":"主题","shareMode":0,"partner":{"name":"合作方"}}';
  const row = JSON.parse(wire);
  assert.notEqual(String(row.id), exact, '负控：数字已经在 JSON.parse 丢精度');
  const response = { code: 200, data: { sent: [row], received: [row], slots: {} } };
  const list = pageHarness('pages/coop/list/index.js', response);
  list.page.load();
  const shown = list.page.data.received[0];
  assert.equal(shown.id, exact);
  assert.equal(shown.inviteId, exact);
  const event = { currentTarget: { dataset: { id: shown.id, box: 'received' } } };
  list.page.goInviteDetail(event);
  assert.match(list.navigations[0], /inviteId=9007199254740993&box=received/);
  for (const action of ['acceptReceived', 'rejectReceived', 'cancelSent', 'retryDepositRefund']) {
    list.page._actionPendingKey = '';
    list.page.data.actionPendingKey = '';
    list.page[action](event);
    const request = list.requests.at(-1), payload = JSON.parse(request.data);
    assert.equal(payload.id || payload.inviteId, exact, action);
  }
  // 2026-09-15:取消已接受合作随「已接受卡最多两个按钮」搬进详情页,精确 id 同样保持原值
  const acceptedSent = { code: 200, data: { received: [], sent: [Object.assign({}, row, { status: 1, toId: 31, toType: 'merchant' })], slots: {} } };
  const cancelDetail = pageHarness('pages/coop/invite-detail/index.js', acceptedSent);
  cancelDetail.page.onLoad({ inviteId: exact, box: 'sent' });
  cancelDetail.page.cancelAccepted();
  const cancelWrite = cancelDetail.requests.find((r) => r.url === '/api/coop/handle');
  assert.equal(JSON.parse(cancelWrite.data).id, exact, 'cancelAccepted');
  const detail = pageHarness('pages/coop/invite-detail/index.js', response);
  detail.page.onLoad({ inviteId: exact, box: 'received' });
  assert.equal(detail.page.data.state, 'ready');
  assert.equal(detail.page.data.inputKind, 'reply');
  detail.page._post(1);
  assert.equal(JSON.parse(detail.requests.at(-1).data).id, exact);
  row.status = 5;
  detail.page.load();
  assert.equal(detail.page.data.state, 'ready');
  assert.equal(detail.page.data.inputKind, '');
  assert.equal(detail.page.data.statusText, '已过期');
});

test('RUN-027 邀约身份显示实际收发主体，不用邀请类型推断为商家', () => {
  const rows = decorate([
    { id: 1, inviteType: 1, fromType: 'club', fromId: 7001, toType: 'club', toId: 7002 },
    { id: 2, inviteType: 1, fromType: 'merchant', fromId: 8005, toType: 'club', toId: 7002 },
  ])
  assert.equal(rows[0].typeText, '俱乐部 → 俱乐部')
  assert.equal(rows[1].typeText, '商家 → 俱乐部')
})
