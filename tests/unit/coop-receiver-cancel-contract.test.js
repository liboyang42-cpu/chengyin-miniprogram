/**
 * H018/H033 · 接受合作后反悔(收件方取消入口)契约。
 *
 * 后端 ApiCoopController.handle 对 status==1 的取消是**双方放行**:
 *   `if (!isFrom && !isTo) return error("无权取消")`(ApiCoopController.java:487),
 * 且 resolveActionContractMemberId 的 allowTo 对 target==3 在 status==1 时为真(:406)。
 * 前端此前只给发件箱(box === 'sent')渲染取消入口,收件方接了合作想退没有按钮。
 *
 * 本契约同时钉两件事:
 *   ① 渲染层:入口不再按 box 分侧(只按 termsFrozen 分「可取消 / 已锁价说明」);
 *   ② 行为层:收件方点击后确实发 /api/coop/handle {status:3, message},锁价后不发请求。
 * 负控打在渲染层(把 box 闸塞回 wxml 必须变红)与行为层(把 box 守卫塞回 js 必须变红)。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const WXML_PATH = 'pages/coop/invite-detail/index.wxml';
const JS_PATH = 'pages/coop/invite-detail/index.js';

function opLine(wxml, handler) {
  const match = wxml.match(new RegExp('<view class="op[^"]*"[^>]*bindtap="' + handler + '"[^>]*>'));
  assert.ok(match, `找不到 ${handler} 的动作行`);
  return match[0];
}

function opBlock(wxml, handler) {
  const line = opLine(wxml, handler);
  const start = wxml.indexOf(line);
  const end = wxml.indexOf('</view>', start);
  return wxml.slice(start, end + '</view>'.length);
}

function loadPage(response, mutate, opts) {
  let source = read(JS_PATH);
  if (mutate) {
    const changed = mutate(source);
    assert.notEqual(changed, source, '负控锚点失效:生产源码未命中');
    source = changed;
  }
  let definition;
  const requests = [];
  const modalCalls = [];
  const app = {
    globalData: {}, getUserID: () => 1,
    sendRequest(o) { requests.push(o); if (o.url === '/api/coop/list' && o.success) o.success(response); },
  };
  const file = path.join(ROOT, JS_PATH);
  vm.runInNewContext(source, {
    Page: (p) => { definition = p; },
    getApp: () => app,
    wx: {
      stopPullDownRefresh() {}, navigateBack() {}, redirectTo() {},
      setClipboardData() {},
    },
    setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (id.includes('/toast')) return Object.assign(() => {}, { success() {} });
      if (id.includes('/modal')) return { show: (o) => {
        modalCalls.push(o);
        if (!(opts && opts.manualModal)) o.success({ confirm: true, content: '测试理由' });
      } };
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  return { page, requests, modalCalls };
}

function inviteResponse(row) {
  return { code: 200, data: { received: [row], sent: [row], slots: {} } };
}

function acceptedRow(over) {
  return Object.assign({
    id: 7, inviteId: '7', status: 1, inviteType: 1, topicId: 8, topicName: '主题', shareMode: 0,
    depositOwed: false, fromId: 21, toId: 31, toType: 'merchant', termsFrozen: false, partner: { name: '合作方' },
  }, over || {});
}

test('渲染层:取消合作入口不再按 box 分侧,只按 termsFrozen 分可取消/锁价说明', () => {
  const wxml = read(WXML_PATH);
  const active = opLine(wxml, 'cancelAccepted');
  assert.doesNotMatch(active, /box === 'sent'/,
    '收件方(received)也必须有取消合作入口 —— 后端对 status==1 的取消是双方放行');
  assert.match(active, /!invite\.termsFrozen/, '锁价前才给可点的取消');
  assert.match(opBlock(wxml, 'cancelAccepted'), /op-name--danger/, '取消是涉资动作,沿用发起方那套危险样式');

  const locked = opLine(wxml, 'explainCancelLocked');
  assert.doesNotMatch(locked, /box === 'sent'/,
    '锁价后的置灰说明同样要对收件方显示');
  assert.match(locked, /invite\.termsFrozen/);

  // 负控:把 box 闸塞回两条入口,同一断言必须真红
  const mutated = wxml.replace(/wx:if="\{\{!invite\.termsFrozen\}\}"/, 'wx:if="{{box === \'sent\' && !invite.termsFrozen}}"')
    .replace(/wx:if="\{\{invite\.termsFrozen\}\}"/, 'wx:if="{{box === \'sent\' && invite.termsFrozen}}"');
  assert.notEqual(mutated, wxml, '负控锚点失效:两道取消入口未命中');
  assert.throws(() => {
    assert.doesNotMatch(opLine(mutated, 'cancelAccepted'), /box === 'sent'/);
  }, assert.AssertionError, '塞回 box 闸后渲染层断言必须变红');
});

test('后端证据:status==1 的取消双方都放行(收件方不再被挡在 403 里)', () => {
  const java = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiCoopController.java');
  const start = java.indexOf('// ---- 取消(target==3)----');
  const end = java.indexOf('@PostMapping("/deposit/refund/retry")');
  assert.ok(start > 0 && end > start, '找不到取消分支');
  const cancel = java.slice(start, end);
  assert.match(cancel, /if \(!isFrom && !isTo\) return error\("无权取消"\);/,
    '取消分支必须同时放行发起方与收件方 —— 收件方入口的合法性依据');
  assert.match(java, /boolean allowTo = target == 1 \|\| target == 2 \|\| \(target == 3 && inv\.getStatus\(\) == 1\);/,
    'resolveActionContractMemberId 的 allowTo 必须对已接受的取消放行收件方');
});

test('收件方点取消:弹必填理由确认框,确认后发 status=3 message,成功后回读详情', () => {
  const env = loadPage(inviteResponse(acceptedRow()), null, { manualModal: true });
  env.page.onLoad({ inviteId: '7', box: 'received' });
  assert.equal(env.page.data.state, 'ready', '收件方详情必须进入 ready');

  env.page.cancelAccepted();
  assert.equal(env.modalCalls.length, 1, '收件方点取消必须过确认弹窗');
  assert.equal(env.modalCalls[0].editable, true, '理由必填,走可输入确认框');
  assert.equal(env.requests.some((r) => r.url === '/api/coop/handle'), false, '确认前不得发请求');

  env.modalCalls[0].success({ confirm: true, content: '测试理由' });
  const write = env.requests.find((r) => r.url === '/api/coop/handle');
  assert.ok(write, '确认后必须发 /api/coop/handle');
  assert.deepEqual(JSON.parse(write.data), { id: '7', status: 3, message: '测试理由' },
    '收件方取消同样发 status=3 + message 字段');
  const before = env.requests.filter((r) => r.url === '/api/coop/list').length;
  write.success({ code: 200 });
  assert.ok(env.requests.filter((r) => r.url === '/api/coop/list').length > before, '写成功后必须回读');
});

test('收件方锁价后只能看说明:不发请求,行内错误给客服口径', () => {
  const env = loadPage(inviteResponse(acceptedRow({ termsFrozen: true })));
  env.page.onLoad({ inviteId: '7', box: 'received' });
  env.page.cancelAccepted();
  assert.equal(env.requests.some((r) => r.url === '/api/coop/handle'), false, '锁价后不得发取消请求');
  assert.match(env.page.data.actionError, /锁价/);
  assert.match(env.page.data.actionError, /客服/);
});

test('发起方一侧不能被改坏:发件箱仍能取消并回读', () => {
  const env = loadPage(inviteResponse(acceptedRow()));
  env.page.onLoad({ inviteId: '7', box: 'sent' });
  env.page.cancelAccepted();
  const write = env.requests.find((r) => r.url === '/api/coop/handle');
  assert.ok(write, '发件箱取消能力必须保持');
  assert.deepEqual(JSON.parse(write.data), { id: '7', status: 3, message: '测试理由' });

  // 行为层负控:把 box 守卫塞回 js,收件方取消必须被挡(证明这条契约真的盯住了那行守卫)
  const broken = loadPage(inviteResponse(acceptedRow()), (source) => source.replace(
    "if (!inv || Number(inv.status) !== 1) return;",
    "if (!inv || this.data.box !== 'sent' || Number(inv.status) !== 1) return;",
  ));
  broken.page.onLoad({ inviteId: '7', box: 'received' });
  broken.page.cancelAccepted();
  assert.equal(broken.requests.some((r) => r.url === '/api/coop/handle'), false,
    '负控:守卫塞回后收件方不再能取消,本契约的行为断言必须能抓到这个回归');
});
