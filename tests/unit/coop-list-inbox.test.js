const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 用户裁决(2026-09-15):一条合作请求 = 一条记录,发起方在「我发出的」、接收方在「收到的」;
// 全站只有这两个入口,合作池 tab 收编。俱乐部申请带团:俱乐部=我发出的 / 发布者=收到的。

// 同一条申请在两个身份下各自的后端视图(/pool/received 按主题发布者、/pool/mine 按申请人)
const APPLY = { applyId: 31, topicId: 8, clubId: 7, status: 0, clubName: '夜跑团', merchantNick: '老街咖啡', topicName: '周末路线' };

function loadList(backend) {
  let definition;
  const requests = [];
  const navigations = [];
  const app = { globalData: {}, getUserID: () => 1, sendRequest(o) {
    requests.push(o);
    const res = backend[o.url];
    if (res) o.success(res);
  } };
  const file = path.join(ROOT, 'pages/coop/list/index.js');
  vm.runInNewContext(read('pages/coop/list/index.js'), {
    Page: p => { definition = p; }, getApp: () => app,
    wx: { stopPullDownRefresh() {}, navigateTo(o) { navigations.push(o.url); if (o.complete) o.complete(); } },
    setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (id.includes('/toast')) return () => {};
      if (id.includes('/modal')) return { show: o => o.success({ confirm: true, content: '' }) };
      if (id.includes('/loading')) return { show() {}, hide() {} };
      if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (id.includes('checkout')) return {};
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } });
  return { page, requests, navigations };
}

const EMPTY_LIST = { code: 200, data: { received: [], sent: [], slots: {} } };

test('负控①②:同一条俱乐部申请,俱乐部在「我发出的」、发布者在「收到的」都看得见', () => {
  const club = loadList({ '/api/coop/list': EMPTY_LIST, '/api/coop/pool/received': { code: 200, data: [] }, '/api/coop/pool/mine': { code: 200, data: [APPLY] } });
  club.page.load();
  assert.deepEqual(club.page.data.sentApplies.map(r => r.applyId), [31]);
  assert.equal(club.page.data.sentApplies[0].peerText, '发给 老街咖啡');
  assert.equal(club.page.data.receivedApplies.length, 0);

  const merchant = loadList({ '/api/coop/list': EMPTY_LIST, '/api/coop/pool/received': { code: 200, data: [APPLY] }, '/api/coop/pool/mine': { code: 200, data: [] } });
  merchant.page.load();
  assert.deepEqual(merchant.page.data.receivedApplies.map(r => r.applyId), [31]);
  assert.equal(merchant.page.data.receivedApplies[0].peerText, '来自 夜跑团');
});

test('锁价/已处理的历史申请不会从发件箱消失(不再读只列开放主题的 /pool/list)', () => {
  const rows = [0, 1, 2, 3].map(status => Object.assign({}, APPLY, { applyId: 40 + status, status }));
  const { page, requests } = loadList({ '/api/coop/list': EMPTY_LIST, '/api/coop/pool/received': { code: 200, data: [] }, '/api/coop/pool/mine': { code: 200, data: rows } });
  page.load();
  assert.deepEqual(page.data.sentApplies.map(r => r.statusText), ['待确认', '已拒绝', '已撤回', '已回邀约']);
  assert.equal(requests.filter(r => r.url === '/api/coop/pool/list').length, 0);
});

test('「我发出的」待处理申请可撤回,撤回走 /api/coop/pool/withdraw 并回读', () => {
  const { page, requests } = loadList({ '/api/coop/list': EMPTY_LIST, '/api/coop/pool/received': { code: 200, data: [] }, '/api/coop/pool/mine': { code: 200, data: [APPLY] } });
  page.load();
  const before = requests.filter(r => r.url === '/api/coop/pool/mine').length;
  page.withdrawApply({ currentTarget: { dataset: { topicid: 8 } } });
  const w = requests.find(r => r.url === '/api/coop/pool/withdraw');
  assert.deepEqual(JSON.parse(w.data), { topicId: 8 });
  w.success({ code: 200 });
  assert.equal(requests.filter(r => r.url === '/api/coop/pool/mine').length, before + 1);
});

test('wxml:两个 tab 各自渲染申请卡,空态要两路都空;动作按角色分', () => {
  const wxml = read('pages/coop/list/index.wxml');
  assert.match(wxml, /wx:for="\{\{receivedApplies\}\}"[\s\S]*catchtap="declineApply"[\s\S]*catchtap="replyApplyInvite"/);
  assert.match(wxml, /wx:for="\{\{sentApplies\}\}"[\s\S]*catchtap="withdrawApply"/);
  assert.match(wxml, /wx:if="\{\{receivedApplyState === 'ready' && !receivedApplyErrorText && !receivedRegErrorText && !officialErrorText && !listErrorText && !received\.length && !receivedApplies\.length && !receivedRegs\.length && !officialInvites\.length\}\}"/);
  assert.match(wxml, /wx:if="\{\{sentApplyState === 'ready' && !sentApplyErrorText && !listErrorText && !sent\.length && !sentApplies\.length\}\}"/);
});

test('负控③:合作池 tab、poolOnly 与 ?tab=pool 入口全仓不可达', () => {
  const js = read('pages/coop/list/index.js');
  const { page } = loadList({});
  assert.deepEqual(page.data.listTabs.map(t => t.label), ['收到的', '我发出的']);
  page.onLoad({ tab: 'pool' });
  assert.equal(page.data.tab, 0, '?tab=pool 不再有专门分支,落到默认收到的');
  assert.doesNotMatch(js, /poolOnly|loadPool|applyPool/);

  // 字面量 + 字符串拼接两种形态都扫:'tab=pool'、"tab=" + 'pool'、tab: 'pool'
  const hits = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) { if (!/node_modules|tests|scripts|docs|artifacts|miniprogram_npm/.test(d.name)) walk(full); return; }
    if (!/\.(js|wxml|json|wxs)$/.test(d.name)) return;
    const text = fs.readFileSync(full, 'utf8');
    if (/tab=pool|tab=['"]\s*\+\s*['"]pool|tab:\s*['"]pool['"]|['"]pool['"]\s*\}/.test(text)) hits.push(path.relative(ROOT, full));
  });
  walk(ROOT);
  assert.deepEqual(hits, []);
  assert.doesNotMatch(read('subpackageB/pages/im/list/index.wxml'), /合作池/);
});

test('负控①:删 tab 后俱乐部仍能从俱乐部详情「可对接的活动」就地申请,成功后回读池子', () => {
  let definition;
  const requests = [];
  const toasts = [];
  const app = { globalData: {}, sendRequest(o) { requests.push(o); } };
  const file = path.join(ROOT, 'pages/club/detail/index.js');
  vm.runInNewContext(read('pages/club/detail/index.js'), {
    Page: p => { definition = p; }, getApp: () => app, getCurrentPages: () => [],
    wx: new Proxy({}, { get: () => () => ({}) }), setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (id.includes('/toast')) return Object.assign((t) => toasts.push(t), { success: (t) => toasts.push(t) });
      if (id.includes('/modal')) return { show: o => o.success({ confirm: true, content: '带过 30 人' }) };
      if (id.includes('/subscribe')) return { request() {} };
      try { return require(path.resolve(path.dirname(file), id)); } catch (e) { return {}; }
    },
  });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } });
  page.data.club = { isOwner: true };
  const tap = { currentTarget: { dataset: { topicid: 8, name: '周末路线' } } };
  page.applyCoopPool(tap);
  page.applyCoopPool(tap);
  const writes = requests.filter(r => r.url === '/api/coop/pool/apply');
  assert.equal(writes.length, 1, '同步防重:连点只发一条申请');
  assert.deepEqual(JSON.parse(writes[0].data), { topicId: 8, message: '带过 30 人' });
  writes[0].success({ code: 200 });
  assert.match(toasts.pop(), /我发出的/);
  assert.ok(requests.some(r => r.url === '/api/coop/pool/list'), '成功后回读,卡片变「已申请」');
  assert.match(read('pages/club/detail/index.wxml'), /catchtap="applyCoopPool"/);
});

test('官方邀约收进「收到的」:非商家的权限失败=本来没有,服务失败要报错;接受/拒绝走 /api/coop/handle', () => {
  const official = { inviteId: 18, title: '城市搭子节', status: 0, shareMode: 0 };
  const merchant = loadList({ '/api/official/merchant-invites': { code: 200, data: [official] } });
  merchant.page.loadOfficialInvites();
  assert.equal(merchant.page.data.officialInvites[0].statusText, '待你确认');
  merchant.page.acceptOfficialInvite({ currentTarget: { dataset: { id: 18, terms: '资源支持' } } });
  const accept = merchant.requests.find(r => r.url === '/api/coop/handle');
  assert.deepEqual(JSON.parse(accept.data), { id: 18, status: 1 });

  const club = loadList({ '/api/official/merchant-invites': { code: 403, errorCode: 'NOT_ACTIVE_MERCHANT', msg: '任意文案' } });
  club.page.loadOfficialInvites();
  assert.equal(club.page.data.officialErrorText, '', '俱乐部主理人没有官方邀约,不是加载失败');

  // 负控:旧文案 / 泛 403 没有机器码,必须按故障报出来,不许靠文案正则猜成「不是商家」
  for (const res of [{ code: 500, msg: '仅审核通过且启用的商家可参与合作邀约' }, { code: 403, msg: '无权访问' }]) {
    const guessed = loadList({ '/api/official/merchant-invites': res });
    guessed.page.loadOfficialInvites();
    assert.ok(guessed.page.data.officialErrorText, '无机器码的失败不得被吞成空列表:' + res.msg);
  }

  const broken = loadList({ '/api/official/merchant-invites': { code: 500, msg: '服务暂不可用' } });
  broken.page.loadOfficialInvites();
  assert.match(broken.page.data.officialErrorText, /服务暂不可用/);
});

test('商家员工处理 owner 主题上的申请:行上 scope=MERCHANT 原样回传给拒绝与回邀约', () => {
  const { page, requests, navigations } = loadList({});
  page.declineApply({ currentTarget: { dataset: { applyid: 31, name: '夜跑团', scope: 'MERCHANT' } } });
  const decline = requests.find(r => r.url === '/api/coop/pool/decline');
  assert.deepEqual(JSON.parse(decline.data), { applyId: 31, scope: 'MERCHANT' });
  page.replyApplyInvite({ currentTarget: { dataset: { applyid: 31, clubid: 7, topicid: 8, name: '夜跑团', scope: 'MERCHANT' } } });
  assert.match(navigations.pop(), /&originApplyId=31&scope=MERCHANT$/);
  const wxml = read('pages/coop/list/index.wxml');
  assert.match(wxml, /catchtap="declineApply"[^>]*data-scope="\{\{item\.scope\}\}"/);
  assert.match(wxml, /catchtap="replyApplyInvite"[^>]*data-scope="\{\{item\.scope\}\}"/);
});

test('撤回申请按钮只认后端 canWithdraw(转让/非首个俱乐部的申请撤不了)', () => {
  const wxml = read('pages/coop/list/index.wxml');
  assert.match(wxml, /wx:if="\{\{item\.canWithdraw\}\}">\s*<view[^>]*catchtap="withdrawApply"/);
});

test('官方邀约切换身份:旧身份在途回包作废,新身份立即发起并清掉旧列表', () => {
  let userId = 1;
  const pending = [];
  let definition;
  const app = { globalData: {}, getUserID: () => userId, sendRequest(o) { pending.push(o); } };
  const file = path.join(ROOT, 'pages/coop/list/index.js');
  vm.runInNewContext(read('pages/coop/list/index.js'), {
    Page: p => { definition = p; }, getApp: () => app, wx: { stopPullDownRefresh() {} }, setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (/toast|modal|loading|merchant-theme|checkout/.test(id)) return { show() {}, merchantPageShow() {}, merchantPageRestore() {} };
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } });
  page.loadOfficialInvites();
  pending[0].success({ code: 200, data: [{ inviteId: 1, title: '甲的邀约', status: 0 }] });
  page.loadOfficialInvites();
  const oldFlight = pending[1];
  userId = 2;
  page.loadOfficialInvites();
  assert.equal(pending.length, 3, '身份变了不能被旧身份的在途闸挡住');
  assert.equal(page.data.officialInvites.length, 0, '新身份不得看到旧身份的官方邀约');
  oldFlight.success({ code: 200, data: [{ inviteId: 9, title: '甲的迟到回包', status: 0 }] });
  assert.equal(page.data.officialInvites.length, 0, '旧身份迟到回包不得写入');
  pending[2].success({ code: 200, data: [{ inviteId: 2, title: '乙的邀约', status: 0 }] });
  assert.equal(page.data.officialInvites[0].title, '乙的邀约');
});

// E-03(2026-09-16 整体检查 E 组 P1):收件箱拒绝邀约的理由静默丢失。
// 后端 ApiCoopController.handle 的接受/拒绝分支读 body.getHandleReason()
// (CoopInvite.message 与 handleReason 是两个独立字段),而本页发的是 message ⇒ 对方永远看不到理由。
test('E-03 收件箱拒绝必须发 handleReason(后端拒绝分支读的就是它);负控发回 message 即红', () => {
  const REASON = '档期冲突，下次再约';
  const load = (mutate) => {
    let definition;
    const requests = [];
    const app = { globalData: {}, getUserID: () => 1, sendRequest(o) { requests.push(o); } };
    const file = path.join(ROOT, 'pages/coop/list/index.js');
    let source = read('pages/coop/list/index.js');
    assert.ok(source.includes('handleReason'), '修复代码必须在源里(负控锚点)');
    if (mutate) source = mutate(source);
    vm.runInNewContext(source, {
      Page: p => { definition = p; }, getApp: () => app,
      wx: { stopPullDownRefresh() {}, navigateTo() {} },
      setTimeout() {}, clearTimeout() {}, console,
      require(id) {
        if (id.includes('/toast')) return () => {};
        if (id.includes('/modal')) return { show: o => o.success({ confirm: true, content: REASON }) };
        if (id.includes('/loading')) return { show() {}, hide() {} };
        if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
        if (id.includes('checkout')) return {};
        return require(path.resolve(path.dirname(file), id));
      },
    }, { filename: file });
    const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch); } });
    page._decideAsInvitee(7, false);
    return JSON.parse(requests.find(r => r.url === '/api/coop/handle').data);
  };

  const payload = load();
  assert.equal(payload.handleReason, REASON, '拒绝理由必须落在后端读的 handleReason 字段上');
  assert.equal('message' in payload, false, '拒绝分支不得再发 message');

  // 负控:退回发 message,上面的断言必须真红
  const broken = load((s) => s.replace('handleReason: reason ||', 'message: reason ||'));
  assert.equal(broken.handleReason, undefined, '负控必须真的把字段改回 message');
  assert.throws(() => assert.equal(broken.handleReason, REASON), assert.AssertionError, '负控必须真红');
});

// 2026-09-23 CU-M-38:回邀约后申请行恒为「已回邀约」,对方接受了也看不出来、也进不了合作详情。
test('回过邀约的申请按 originApplyId 接到邀约真实状态,并可进合作详情', () => {
  const replied = Object.assign({}, APPLY, { applyId: 55, status: 3 });
  const accepted = { code: 200, data: { received: [], sent: [{ id: 901, inviteType: 1, status: 1, originApplyId: 55 }], slots: {} } };
  const { page, navigations } = loadList({ '/api/coop/list': accepted, '/api/coop/pool/received': { code: 200, data: [replied] }, '/api/coop/pool/mine': { code: 200, data: [] } });
  page.load();
  const row = page.data.receivedApplies[0];
  assert.equal(row.statusText, '对方已接受');
  assert.equal(String(row.linkedInviteId), '901');
  page.goInviteDetail({ currentTarget: { dataset: { id: row.linkedInviteId, box: 'sent' } } });
  assert.match(navigations.pop(), /invite-detail\/index\?inviteId=901&box=sent/);

  const pending = { code: 200, data: { received: [], sent: [{ id: 902, inviteType: 1, status: 0, originApplyId: 55 }], slots: {} } };
  const waiting = loadList({ '/api/coop/list': pending, '/api/coop/pool/received': { code: 200, data: [replied] }, '/api/coop/pool/mine': { code: 200, data: [] } });
  waiting.page.load();
  assert.equal(waiting.page.data.receivedApplies[0].statusText, '已回邀约', '对方未接受时不得谎报已接受');
});
