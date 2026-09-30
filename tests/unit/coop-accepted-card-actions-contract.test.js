const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 总控裁决(2026-09-15,弹窗合同配套):一张卡最多两个小按钮并排。
//   · 已接受卡:欠保证金 = 次[查看合作] + 主[缴纳保证金];不欠 = 只[查看合作](单动作给次级按钮)。
//     联系合作方 / 申报供给 / 评价 / 发件箱的取消合作,从卡片搬进协作详情页。
//   · 详情页动作区同样 ≤2 并排,多出的放次级区列表行 —— 不做弹窗堆按钮。
//   · 已过期卡维持现状:不给「联系对方」(后端 §3.8 只对已签约双方建会话)。

function region(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, '缺少区块锚点:' + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, '缺少区块终止锚点:' + endMarker);
  return source.slice(start, end);
}

// 从注释锚点往后找第一块 inv-acts,按 <view> 深度取出闭合整块 —— 一屏里有多张卡,
// 用「下一个注释」当终点会把别的卡也圈进来(负控报过 9 个按钮)。
function actBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, '缺少区块锚点:' + marker);
  const open = source.indexOf('<view class="inv-acts"', start);
  assert.ok(open > start, '缺少动作区块:' + marker);
  let depth = 0;
  const re = /<view\b[^>]*>|<\/view>/g;
  re.lastIndex = open;
  let match;
  while ((match = re.exec(source))) {
    depth += match[0] === '</view>' ? -1 : 1;
    if (depth === 0) return source.slice(open, re.lastIndex);
  }
  assert.fail('动作区块未闭合:' + marker);
}

function assertAcceptedCard(area, label) {
  const buttons = [...area.matchAll(/class="inv-btn[^"]*"/g)];
  assert.ok(buttons.length <= 2, label + '已接受卡最多两个按钮,现为 ' + buttons.length + ' 个');
  assert.match(area, /class="inv-btn inv-btn--secondary"[^>]*catchtap="goInviteDetail"[^>]*>查看合作</,
    label + '「查看合作」必须是次级按钮');
  assert.match(area, /wx:if="\{\{item\.depositOwed\}\}"[\s\S]{0,200}?class="inv-btn inv-btn--primary"[^>]*catchtap="payDeposit"/,
    label + '欠保证金时主按钮必须是「缴纳保证金」');
  for (const moved of ['contactPartner', 'openPerkPick', 'reviewCoop', 'cancelAccepted', 'explainCancelLocked']) {
    assert.doesNotMatch(area, new RegExp('catchtap="' + moved + '"'),
      label + moved + ' 已搬到协作详情页,不得留在卡片上');
  }
}

function loadPage(relativePath, response, mutate, opts) {
  let source = read(relativePath);
  if (mutate) {
    const changed = mutate(source);
    assert.notEqual(changed, source, '负控锚点失效:生产源码未命中');
    source = changed;
  }
  let definition;
  const requests = [];
  const navigations = [];
  const toasts = [];
  const modalCalls = [];
  const app = {
    globalData: {}, getUserID: () => 1,
    sendRequest(o) {
      requests.push(o);
      if (o.url === '/api/coop/list') o.success(response);
    },
  };
  const file = path.join(ROOT, relativePath);
  vm.runInNewContext(source, {
    Page: (p) => { definition = p; },
    getApp: () => app,
    wx: {
      stopPullDownRefresh() {},
      navigateTo(o) { navigations.push(o.url); if (o.complete) o.complete(); },
      navigateBack() {},
      redirectTo(o) { navigations.push(o.url); },
      setClipboardData() {},
    },
    setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (id.includes('/toast')) return Object.assign((t) => toasts.push(t), { success: (t) => toasts.push(t) });
      if (id.includes('/modal')) return { show: (o) => {
        modalCalls.push(o);
        // 默认照旧自动确认;C2 要分别演「点取消 / 点确定」,manualModal 时由用例自己回调
        if (!(opts && opts.manualModal)) o.success({ confirm: true, content: '测试理由' });
      } };
      if (id.includes('/loading')) return { show() {}, hide() {} };
      if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { applyDataPatch(this.data, patch); } });
  return { page, requests, navigations, toasts, modalCalls };
}

// setData 支持 'perkTemplates[0].checked' 这类路径键,测试替身也得支持,否则负控会假绿
function applyDataPatch(data, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const parts = key.match(/[^.[\]]+/g) || [];
    if (parts.length < 2) { data[key] = value; return; }
    let cursor = data;
    parts.slice(0, -1).forEach((part) => {
      if (cursor[part] == null) cursor[part] = /^\d+$/.test(part) ? [] : {};
      cursor = cursor[part];
    });
    cursor[parts[parts.length - 1]] = value;
  });
}

function inviteResponse(row) {
  return { code: 200, data: { received: [row], sent: [row], slots: {} } };
}

test('已接受卡最多两个按钮:欠款=[查看合作次级][缴纳保证金主],不欠=只[查看合作]单动作', () => {
  const wxml = read('pages/coop/list/index.wxml');
  const received = actBlock(wxml, '<!-- 已接受卡(收件箱)');
  const sent = actBlock(wxml, '<!-- 已接受卡(发件箱)');
  assertAcceptedCard(received, '收件箱');
  assertAcceptedCard(sent, '发件箱');

  // 负控:给卡片塞回第三个按钮,同一断言必须真红
  const mutated = received.replace('</view>',
    '<view class="inv-btn inv-btn--secondary" catchtap="reviewCoop" aria-role="button">评价</view></view>');
  assert.notEqual(mutated, received, '负控锚点失效:收件箱已接受卡未命中');
  assert.throws(() => assertAcceptedCard(mutated, '负控'), assert.AssertionError);
});

test('已过期卡维持现状:不加「联系对方」,也不把联系入口塞进任何卡片', () => {
  const wxml = read('pages/coop/list/index.wxml');
  assert.doesNotMatch(wxml, /联系对方/);
  assert.doesNotMatch(wxml, /contactPartner/, '联系合作方已搬到协作详情页');
  assert.doesNotMatch(wxml, /item\.status===5/, '已过期卡没有新增动作分支');
});

test('保证金支付入口:详情页有「缴纳保证金」入口,欠款时才可见;负控删掉入口即红', () => {
  const wxml = read('pages/coop/invite-detail/index.wxml');
  const entry = /wx:if="\{\{depositActionVisible\}\}"[\s\S]{0,200}?bindtap="goDeposit"/;
  assert.match(wxml, /bindtap="goDeposit"/, '详情页必须保留缴纳保证金入口');
  assert.match(wxml, entry, '入口必须在欠款标记为真时才渲染');

  const stripped = wxml.replace(/<view wx:if="\{\{depositActionVisible\}\}"[\s\S]*?<\/view>/, '');
  assert.notEqual(stripped, wxml, '负控锚点失效:保证金入口未命中');
  assert.throws(() => assert.match(stripped, entry), assert.AssertionError, '删掉入口后断言必须变红');
});

test('欠款时详情页标记可见,不欠款时不标记', () => {
  const row = (over) => Object.assign({
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题',
    shareMode: 0, managerName: '合作方', partner: { name: '合作方' },
  }, over || {});
  const owed = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row({ depositOwed: true, depositAmount: 50 })));
  owed.page.onLoad({ inviteId: '7', box: 'received' });
  assert.equal(owed.page.data.state, 'ready');
  assert.equal(owed.page.data.depositActionVisible, true, '欠保证金时入口必须可见');

  const clear = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row({ depositOwed: false })));
  clear.page.onLoad({ inviteId: '7', box: 'sent' });
  assert.equal(clear.page.data.state, 'ready');
  assert.equal(clear.page.data.depositActionVisible, false, '不欠保证金时不给缴纳保证金入口');

  // 负控:把可见性判据写死为 false,欠款用例必须真红
  const broken = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row({ depositOwed: true })), (source) => source.replace(
    /depositActionVisible:\s*status === 1/,
    'depositActionVisible: false && status === 1',
  ));
  broken.page.onLoad({ inviteId: '7', box: 'received' });
  assert.equal(broken.page.data.depositActionVisible, false);
});

test('详情页承接搬来的合作动作,底部动作条不塞这些按钮', () => {
  const wxml = read('pages/coop/invite-detail/index.wxml');
  for (const handler of ['contactPartner', 'openPerkPick', 'reviewCoop', 'cancelAccepted']) {
    assert.match(wxml, new RegExp('bindtap="' + handler + '"'), handler + ' 必须落在协作详情页');
  }
  const acts = region(wxml, '<view class="acts">', '\n    </view>');
  assert.doesNotMatch(acts, /contactPartner|openPerkPick|reviewCoop|cancelAccepted/,
    '底部动作条不允许再堆这些动作');
  // 动作条里各状态分支互斥:逐分支验证并排按钮 ≤2(整块总数会把互斥分支加在一起,没有意义)
  const branches = acts.split('<block ').slice(1);
  assert.ok(branches.length >= 4, '动作条状态分支变少,检查是否吞了终态说明');
  branches.forEach((branch) => {
    const barButtons = [...branch.matchAll(/class="act act--(?:solid|ghost)[^"]*"/g)];
    assert.ok(barButtons.length <= 2, '详情页动作条单个分支 ≤2 并排,现为 ' + barButtons.length + ' 个');
  });
});

test('F-44/CU-M-92:商家已接受邀约用 topicId+MERCHANT 进项目(后端判身份),待处理/已取消不开放', () => {
  const row = (status) => ({
    id: 7, inviteId: '7', status, inviteType: 0, topicId: 990028, topicName: '自由探索',
    shareMode: 0, depositOwed: false, toType: 'merchant', partner: { name: '合作方' },
  });
  const accepted = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row(1)));
  accepted.page.onLoad({ inviteId: '7', box: 'received' });

  assert.equal(accepted.page.data.projectActionVisible, true);
  accepted.page.openAcceptedProject();
  assert.equal(accepted.navigations[0],
    '/pages/topic/merchantinfo/merchantinfo?topicId=990028&scope=MERCHANT');
  // CU-M-92(走查第三轮):必须是 topicId= —— id= 是「浏览/招商」入口,受邀商家点进项目
  // 看到主题介绍和「报名」,那不是他该落的页。带 topicId 才有 /api/project/home 判身份。
  assert.match(accepted.navigations[0], /[?&]topicId=/,
    '已接受邀约的商家要进承接视图,入口必须带 topicId');

  for (const status of [0, 3]) {
    const blocked = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row(status)));
    blocked.page.onLoad({ inviteId: '7', box: 'received' });
    assert.equal(blocked.page.data.projectActionVisible, false);
    blocked.page.openAcceptedProject();
    assert.deepEqual(blocked.navigations, []);
  }

  const wxml = read('pages/coop/invite-detail/index.wxml');
  assert.match(wxml, /wx:if="\{\{projectActionVisible\}\}"[^>]*bindtap="openAcceptedProject"/);
  // CU-M-92(2026-09-24 走查):文案从「进入项目 / 配置承接」改成「进入项目」——
  // 落点是主题项目页(浏览 + 承接入口),配置步骤不在这条路由上;"?topicId=" 那条路对
  // 「已接受邀约但还没承接记录」的商家会被 /api/project/home 直接拒(见 openAcceptedProject 注释)。
  assert.match(wxml, />进入项目</);
  assert.doesNotMatch(wxml, />进入项目 \/ 配置承接</, '不再承诺这条路由到不了的步骤');
});

test('详情页:联系合作方建会话并按会话跳转', () => {
  const env = loadPage('pages/coop/invite-detail/index.js', inviteResponse({
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, fromId: 21, partner: { name: '合作方' },
  }));
  env.page.onLoad({ inviteId: '7', box: 'received' });
  env.page.contactPartner();
  const request = env.requests.find((r) => r.url === '/api/coop/contact');
  assert.ok(request, '必须走 /api/coop/contact');
  assert.deepEqual(JSON.parse(request.data), { id: '7' });
  request.success({ code: 200, data: { conversationId: 55 } });
  // CU-C-26:带上合作方名,会话页顶栏写对方是谁
  assert.equal(env.navigations[0], '/subpackageB/pages/im/chat/index?conversationId=55&type=1&name=' + encodeURIComponent('合作方'));
});

// CU-C-27:评过的合作回读成「已评价 ★N」,不再每次都给空白评分面板
test('详情页:已评价的合作回读星级', () => {
  const env = loadPage('pages/coop/invite-detail/index.js', inviteResponse({
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, fromId: 21, partner: { name: '合作方' },
  }));
  env.page.onLoad({ inviteId: '7', box: 'received' });
  const request = env.requests.find((r) => r.url === '/api/coop/review/summary');
  assert.ok(request, '已接受合作必须回读自己的评价');
  assert.deepEqual(JSON.parse(request.data), { toId: 21 });
  request.success({ code: 200, data: { reviews: [
    { fromId: 999, topicId: 8, rating: 1 },
    { fromId: 1, topicId: 8, rating: 4 },
  ] } });
  assert.equal(env.page.data.myReviewStars, '★★★★');
});

test('详情页:已接受合作不渲染不可提交的留言输入框', () => {
  const env = loadPage('pages/coop/invite-detail/index.js', inviteResponse({
    id: 7, inviteId: '7', status: 1, inviteType: 0, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, fromId: 21, toId: 9002, partner: { name: '合作方' },
  }));
  env.page.onLoad({ inviteId: '7', box: 'received' });
  assert.equal(env.page.data.inputKind, '');
  assert.match(read('pages/coop/invite-detail/index.wxml'), /需要对齐事项时，请点击上方“联系合作方”进入单聊/);
});

test('详情页:发件箱已接受可取消合作(锁价置灰只说明),走 handle status=3 并回读', () => {
  const env = loadPage('pages/coop/invite-detail/index.js', inviteResponse({
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, toId: 31, toType: 'merchant', termsFrozen: false, partner: { name: '合作方' },
  }));
  env.page.onLoad({ inviteId: '7', box: 'sent' });
  env.page.cancelAccepted();
  const write = env.requests.find((r) => r.url === '/api/coop/handle');
  assert.deepEqual(JSON.parse(write.data), { id: '7', status: 3, message: '测试理由' });
  const before = env.requests.filter((r) => r.url === '/api/coop/list').length;
  write.success({ code: 200 });
  assert.ok(env.requests.filter((r) => r.url === '/api/coop/list').length > before, '写成功后必须回读详情');

  const frozen = loadPage('pages/coop/invite-detail/index.js', inviteResponse({
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, toId: 31, toType: 'merchant', termsFrozen: true, partner: { name: '合作方' },
  }));
  frozen.page.onLoad({ inviteId: '7', box: 'sent' });
  frozen.page.explainCancelLocked();
  assert.match(frozen.page.data.actionError, /锁价|客服/);
  assert.equal(frozen.requests.some((r) => r.url === '/api/coop/handle'), false, '锁价后不得发取消请求');
});

// C1(审查_审查C_小程序界面合同.md §1 P1-C1):取消已接受合作的前后端字段必须对齐 ——
// 后端 ApiCoopController.handle 的取消已接受分支读 body.getMessage(),
// 接受/拒绝分支读 body.getHandleReason();CoopInvite 上这两个字段互相独立,
// 发错字段后端恒回「取消已接受的合作需填写理由」。这条契约把两边钉在一起。
test('C1 取消已接受合作:前端发 message,后端读 body.getMessage();负控发回 handleReason 即红', () => {
  const java = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiCoopController.java');
  const cancelSection = region(java, '// ---- 取消(target==3)----', '@PostMapping("/deposit/refund/retry")');
  assert.match(cancelSection, /body\.getMessage\(\)/, '后端取消分支读的是 message 字段');
  assert.doesNotMatch(cancelSection, /body\.getHandleReason\(\)/, '取消分支不读 handleReason,前端别发错字段');

  const row = {
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, toId: 31, toType: 'merchant', termsFrozen: false, partner: { name: '合作方' },
  };
  const env = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row));
  env.page.onLoad({ inviteId: '7', box: 'sent' });
  env.page.cancelAccepted();
  const payload = JSON.parse(env.requests.find((r) => r.url === '/api/coop/handle').data);
  assert.equal(payload.message, '测试理由', '取消理由必须落在后端读的 message 字段上');
  assert.equal('handleReason' in payload, false, '取消分支不得再发 handleReason');

  // 修取消不许把拒绝一起改坏:后端拒绝分支读 handleReason,这条要一直发它
  env.requests.length = 0;
  env.page.onDraftInput({ detail: { value: '测试理由' } });
  env.page._post(2);
  const rejectPayload = JSON.parse(env.requests.find((r) => r.url === '/api/coop/handle').data);
  assert.equal(rejectPayload.handleReason, '测试理由', '拒绝必须继续发 handleReason');

  // 负控:把取消分支改回发 handleReason,「理由落在 message 上」这条断言必须真红
  const broken = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row), (source) => source.replace(
    'if (status === 3) payload.message = reason;',
    'if (status === 3) payload.handleReason = reason;',
  ));
  broken.page.onLoad({ inviteId: '7', box: 'sent' });
  broken.page.cancelAccepted();
  const brokenPayload = JSON.parse(broken.requests.find((r) => r.url === '/api/coop/handle').data);
  assert.equal(brokenPayload.handleReason, '测试理由', '负控必须真的把取消改成发 handleReason');
  assert.throws(() => assert.equal(brokenPayload.message, '测试理由'), assert.AssertionError, '负控必须真红');
});

// C2(审查_审查C_小程序界面合同.md §1 P1-C2,存量 bug):cy-modal-host 点取消回调的是
// {confirm:false, cancel:true},对象恒为真 —— `success(ok) { if (ok) onOk(); }` 会把
// 点「取消」也当成确认提交。基线 61a370a48:153 就有,不是这批引入的。
test('C2 确认框点「取消」不得提交(接受/拒绝/撤回),点「确定」才发请求;负控回退 if(ok) 即红', () => {
  const row = {
    id: 7, inviteId: '7', status: 0, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, fromId: 21, partner: { name: '合作方' },
  };
  const handleCount = (env) => env.requests.filter((r) => r.url === '/api/coop/handle').length;

  // 收件箱:接受 / 拒绝,各演一遍「点取消」与「点确定」
  for (const action of ['accept', 'reject']) {
    const cancelEnv = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row), null, { manualModal: true });
    cancelEnv.page.onLoad({ inviteId: '7', box: 'received' });
    cancelEnv.page[action]();
    assert.equal(cancelEnv.modalCalls.length, 1, action + ' 必须弹确认框');
    cancelEnv.modalCalls[0].success({ confirm: false, cancel: true, content: '' });
    assert.equal(handleCount(cancelEnv), 0, action + ':点「取消」不得提交');

    const okEnv = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row), null, { manualModal: true });
    okEnv.page.onLoad({ inviteId: '7', box: 'received' });
    okEnv.page[action]();
    okEnv.modalCalls[0].success({ confirm: true, cancel: false, content: '' });
    assert.equal(handleCount(okEnv), 1, action + ':点「确定」才提交');
  }

  // 发件箱:撤回(理由必填,先写 draft),同样只认 confirm
  const sent = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row), null, { manualModal: true });
  sent.page.onLoad({ inviteId: '7', box: 'sent' });
  sent.page.onDraftInput({ detail: { value: '档期冲突' } });
  sent.page.withdraw();
  assert.equal(sent.modalCalls.length, 1, '撤回必须弹确认框');
  sent.modalCalls[0].success({ confirm: false, cancel: true, content: '' });
  assert.equal(handleCount(sent), 0, '撤回:点「取消」不得提交');

  // 负控:只把确认判据回退成 `if (ok)`,点取消的用例必须真红
  const broken = loadPage('pages/coop/invite-detail/index.js', inviteResponse(row), (source) => source.replace(
    'success(ok) { if (ok && ok.confirm) onOk(); }',
    'success(ok) { if (ok) onOk(); }',
  ), { manualModal: true });
  broken.page.onLoad({ inviteId: '7', box: 'received' });
  broken.page.accept();
  broken.modalCalls[0].success({ confirm: false, cancel: true, content: '' });
  assert.equal(handleCount(broken), 1, '负控必须真的把点取消变成提交');
  assert.throws(() => assert.equal(handleCount(broken), 0, '点取消不得提交'), assert.AssertionError, '负控必须真红');
});

test('详情页:申报供给浮层沿用同一份过滤与提交口径', () => {
  const env = loadPage('pages/coop/invite-detail/index.js', inviteResponse({
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, partner: { name: '合作方' },
  }));
  env.page.onLoad({ inviteId: '7', box: 'received' });
  env.page.openPerkPick();
  const templates = env.requests.find((r) => r.url === '/api/coop/perk-template/list');
  assert.ok(templates, '必须载入常备权益');
  templates.success({ code: 200, data: [
    { id: 1, name: '旧权益', retailValue: null, quota: null },
    { id: 2, name: '可用权益', retailValue: 68, quota: 10, perkType: 0 },
  ] });
  const chosen = env.requests.find((r) => r.url === '/api/coop/perks/list');
  assert.ok(chosen, '必须载入已申报供给');
  assert.deepEqual(JSON.parse(chosen.data), { inviteId: '7' });
  chosen.success({ code: 200, data: [] });
  assert.deepEqual(env.page.data.perkTemplates.map((t) => t.id), [2]);
  env.page.togglePerk({ currentTarget: { dataset: { idx: 0 } } });
  env.page.submitPerks();
  const attach = env.requests.find((r) => r.url === '/api/coop/perks/attach');
  assert.deepEqual(JSON.parse(attach.data), { inviteId: '7', templateIds: [2] });
});

test('详情页:评价入口按角色取被评对象(收件箱评发起方,发件箱只对商家)', () => {
  const received = loadPage('pages/coop/invite-detail/index.js', inviteResponse({
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, fromId: 21, partner: { name: '合作方' },
  }));
  received.page.onLoad({ inviteId: '7', box: 'received' });
  received.page.reviewCoop();
  assert.equal(received.page.data.reviewSheetShow, true);
  received.page.onReviewSheetSelect({ detail: { index: 0 } });
  const write = received.requests.find((r) => r.url === '/api/coop/review/save');
  const payload = JSON.parse(write.data);
  assert.equal(payload.toId, 21, '收件箱评的是发起方');
  assert.equal(payload.topicId, 8);

  const sent = loadPage('pages/coop/invite-detail/index.js', inviteResponse({
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, toId: 31, toType: 'merchant', partner: { name: '合作方' },
  }));
  sent.page.onLoad({ inviteId: '7', box: 'sent' });
  sent.page.reviewCoop();
  sent.page.onReviewSheetSelect({ detail: { index: 0 } });
  assert.equal(JSON.parse(sent.requests.find((r) => r.url === '/api/coop/review/save').data).toId, 31);
});
