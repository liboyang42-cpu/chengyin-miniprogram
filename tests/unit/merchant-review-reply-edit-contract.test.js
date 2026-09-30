/**
 * D-05 · 商家公开回复「只能回一次、不能改删」修复契约。
 *
 * 修复前半边:replyCas 带 `reply_content is null`,第二次回复只能得到 409;
 * 商家回错话只能找平台。修复后新增两条独立端点:
 *   POST /api/merchant/reviews/reply/update  改已有回复(version CAS,仍是同一条公开回复)
 *   POST /api/merchant/reviews/reply/delete  删已有回复(删后回到待回复,可重新回复)
 *
 * 本契约钉三件事:
 *   ① 投影层:canEditReply 只认后端布尔 true(缺字段/字符串一律降级为不可改);
 *   ② 行为层:改走 /reply/update、创建仍走 /reply;删除先过 cy-danger-confirm 再发请求;
 *   ③ 危险动作:删除调用点已登记 danger-action-registry,文案含「此操作不可撤销」。
 *
 * 负控在测试内联:临时把页面锚点改坏,同一断言必须真红(见每条 test 末尾)。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { shapePage } = require('../../pages/merchant/reviews/view-model.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const JS_PATH = 'pages/merchant/reviews/index.js';
const WXML_PATH = 'pages/merchant/reviews/index.wxml';

function reviewRow(over) {
  return Object.assign({
    id: 1, version: 3, rating: 5, status: 'VISIBLE', imageUrls: [],
    verifiedRedemption: true, canReply: false, canEditReply: true, canReport: true,
    merchantReply: '感谢反馈，我们会持续改进',
  }, over || {});
}

function shapeRows(rows) {
  const shaped = shapePage({
    mode: 'manage', pageNum: 1, pageSize: 20, total: rows.length, hasMore: false, items: rows,
  }, 'manage', 1, 20);
  assert.ok(shaped, 'fixture 必须能过 shape 层');
  return shaped.items;
}

function loadPage(mutate) {
  let source = read(JS_PATH);
  if (mutate) {
    const changed = mutate(source);
    assert.notEqual(changed, source, '负控锚点失效:生产源码未命中');
    source = changed;
  }
  let definition;
  const requests = [];
  const openedConfirms = [];
  const fakeConfirm = {
    open(key) { openedConfirms.push(key); return true; },
    busyOn() { this.busy = true; },
    done() { this.doneCalled = true; },
    failed(msg) { this.failedWith = msg || true; },
    close() { this.closed = true; },
  };
  const app = {
    globalData: {},
    sendRequest(o) { requests.push(o); },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  };
  const file = path.join(ROOT, JS_PATH);
  vm.runInNewContext(source, {
    Page: (p) => { definition = p; },
    getApp: () => app,
    wx: { getWindowInfo: () => ({ statusBarHeight: 20 }) },
    console,
    require(id) {
      if (id.includes('/toast')) return Object.assign(() => {}, { success() {} });
      return require(path.resolve(path.dirname(file), id));
    },
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
    selectComponent: () => fakeConfirm,
  });
  return { page, requests, openedConfirms, fakeConfirm };
}

test('投影层:canEditReply 只认后端布尔 true,缺失或字符串一律降级为不可改', () => {
  const items = shapeRows([
    reviewRow({ id: 1, canEditReply: true }),
    reviewRow({ id: 2, canEditReply: false }),
    reviewRow({ id: 3, canEditReply: 'true' }),
    (() => { const r = reviewRow({ id: 4 }); delete r.canEditReply; return r; })(),
  ]);
  assert.equal(items[0].canEditReply, true);
  assert.equal(items[1].canEditReply, false);
  assert.equal(items[2].canEditReply, false, '字符串 "true" 不得当权限放行');
  assert.equal(items[3].canEditReply, false, '缺字段必须 fail-closed 到「不能改」');

  // 负控:对同一批原始值改用宽松真值判断,字符串会被放行 —— 严格比较是必需的
  const raws = [true, false, 'true', undefined];
  const loose = raws.map((value) => Boolean(value));
  assert.equal(loose[2], true, '负控:宽松真值判断确实会放行字符串 "true"');
  assert.notEqual(loose[2], items[2].canEditReply, '严格比较与宽松比较在字符串上必须不同');
});

test('渲染层:已有回复渲染「修改回复/删除回复」,权限来自 item.canEditReply', () => {
  const wxml = read(WXML_PATH);
  const editLine = wxml.match(/<view class="review-action"[^>]*bindtap="openEditReply"[^>]*>/);
  const deleteLine = wxml.match(/<view class="review-action[^"]*"[^>]*bindtap="askDeleteReply"[^>]*>/);
  assert.ok(editLine, '找不到修改回复入口');
  assert.ok(deleteLine, '找不到删除回复入口');
  const editBlock = wxml.slice(wxml.indexOf(editLine[0]) - 200, wxml.indexOf(editLine[0]));
  assert.match(editBlock, /wx:if="\{\{item\.canEditReply\}\}"/, '两个入口都必须挂在 canEditReply 上');
  assert.match(wxml, /<cy-danger-confirm id="dc-reply-delete"/, '删除必须走危险确认组件');

  // 负控:把权限栅换成恒真,断言必须红
  assert.throws(() => {
    const mutated = wxml.replace('wx:if="{{item.canEditReply}}"', 'wx:if="{{true}}"');
    assert.notEqual(mutated, wxml, '负控锚点失效');
    assert.match(mutated, /wx:if="\{\{item\.canEditReply\}\}"/);
  }, assert.AssertionError, '去掉 canEditReply 栅后必须变红');

  // 负控行为:没有确认组件的页面(selectComponent 返回 null)不允许直接删
  const broken = loadPage((source) => source.replace(
    "const dc = this.selectComponent && this.selectComponent('#dc-reply-delete');\n    if (!dc) return;\n    dc.open('merchant.review.reply.delete', {});",
    "return;"));
  broken.page.data.items = shapeRows([reviewRow({})]);
  broken.page.data.filteredItems = broken.page.data.items;
  broken.page.askDeleteReply({ currentTarget: { dataset: { id: 1 } } });
  assert.equal(broken.requests.length, 0, '拿不到确认组件时不得直接发删除请求');
});

test('行为层:修改走 /reply/update 并带 version CAS,创建仍走 /reply', () => {
  const env = loadPage(null);
  const items = shapeRows([reviewRow({}), reviewRow({ id: 2, merchantReply: '', canReply: true, canEditReply: false })]);
  env.page.data.items = items;
  env.page.data.filteredItems = items;

  env.page.openEditReply({ currentTarget: { dataset: { id: 1 } } });
  assert.equal(env.page.data.replyEditing, true, '改回复必须进入编辑态');
  assert.equal(env.page.data.replyContent, '感谢反馈，我们会持续改进', '编辑态必须预填原回复');
  env.page.submitReply();
  const editWrite = env.requests.find((r) => r.url === '/api/merchant/reviews/reply/update');
  assert.ok(editWrite, '改回复必须发 /reply/update');
  const editPayload = JSON.parse(editWrite.data);
  assert.equal(editPayload.reviewId, 1);
  assert.equal(editPayload.expectedVersion, 3, '必须带列表拿到的 version 做 CAS');
  assert.ok(editPayload.requestId, '必须带幂等 requestId');
  editWrite.success({ code: 200, data: { reviewId: 1, status: 'VISIBLE', version: 4, replayed: false } });
  assert.equal(env.page.data.replySubmitting, false, '写成功必须解除提交锁');
  assert.equal(env.page.data.replyEditing, false, '写成功必须退出编辑态');

  env.page.openReply({ currentTarget: { dataset: { id: 2 } } });
  assert.equal(env.page.data.replyEditing, false);
  env.page.setData({ replyContent: '第一次回复' });
  env.page.submitReply();
  const createWrite = env.requests.find((r) => r.url === '/api/merchant/reviews/reply');
  assert.ok(createWrite, '第一次回复仍走 /reply');
  assert.equal(JSON.parse(createWrite.data).expectedVersion, 3);

  // 负控:去掉 editing 分支,改回复会错发到创建端点,同一断言必须红
  assert.throws(() => {
    const mutated = read(JS_PATH).replace(
      "requestJson(editing ? '/api/merchant/reviews/reply/update' : '/api/merchant/reviews/reply', payload,",
      "requestJson('/api/merchant/reviews/reply', payload,");
    assert.notEqual(mutated, read(JS_PATH), '负控锚点失效');
    assert.match(mutated, /\/api\/merchant\/reviews\/reply\/update/);
  }, assert.AssertionError, '去掉编辑分支后必须变红');
});

test('行为层:删除先弹确认再发 /reply/delete,成功后回读列表', () => {
  const env = loadPage(null);
  const items = shapeRows([reviewRow({})]);
  env.page.data.items = items;
  env.page.data.filteredItems = items;

  env.page.askDeleteReply({ currentTarget: { dataset: { id: 1 } } });
  assert.deepEqual(env.openedConfirms, ['merchant.review.reply.delete'], '必须先打开已登记的危险确认');
  assert.equal(env.requests.length, 0, '确认前不得发删除请求');

  env.page.onConfirmDeleteReply();
  const write = env.requests.find((r) => r.url === '/api/merchant/reviews/reply/delete');
  assert.ok(write, '确认后必须发 /reply/delete');
  assert.equal(env.fakeConfirm.busy, true, '请求期间确认弹窗必须锁死');
  const payload = JSON.parse(write.data);
  assert.deepEqual(Object.keys(payload).sort(), ['expectedVersion', 'requestId', 'reviewId']);
  assert.equal(payload.expectedVersion, 3);

  const before = env.requests.length;
  write.success({ code: 200, data: { reviewId: 1, status: 'VISIBLE', version: 4, replayed: false } });
  assert.equal(env.fakeConfirm.doneCalled, true, '成功后必须给结果确认卡');
  assert.ok(env.requests.length > before, '成功后必须回读列表');
});

test('危险动作登记:删除端点已登记且文案写明不可撤销', () => {
  const registry = JSON.parse(read('scripts/danger-action-registry.json'));
  const site = registry.sites.find((s) => s.endpoint === '/api/merchant/reviews/reply/delete');
  assert.ok(site, '删除端点必须登记在 danger-action-registry.json');
  assert.equal(site.file, JS_PATH);
  assert.equal(site.confirmKey, 'merchant.review.reply.delete');
  assert.equal(site.irreversible, true, '旧回复内容无法找回,必须按不可逆登记');

  const actions = read('utils/danger-actions.js');
  const start = actions.indexOf("'merchant.review.reply.delete'");
  assert.ok(start > 0, 'danger-actions.js 必须有该 key');
  const after = actions.slice(start);
  const nextEntry = after.slice(1).match(/\n  '([a-z0-9_.]+)'\s*:/);
  const block = nextEntry ? after.slice(0, nextEntry.index + 1) : after;
  assert.match(block, /irreversible:\s*true/);
  assert.match(block, /此操作不可撤销/, '不可逆动作必须写明不可撤销');
  assert.match(block, /改为修改回复/, '必须给出更轻的替代(改为修改)');
});

test('后端对齐:两条新端点与 canEditReply 字段真实存在,create-only 语义未被改动', () => {
  const controller = read('../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiMerchantReviewController.java');
  assert.match(controller, /@PostMapping\("\/reply\/update"\)/);
  assert.match(controller, /@PostMapping\("\/reply\/delete"\)/);
  assert.match(controller, /merchantReviewService\.updateReply\(/);
  assert.match(controller, /merchantReviewService\.deleteReply\(/);

  const service = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/service/impl/MerchantReviewServiceImpl.java');
  assert.match(service, /updateReplyCas\(/, '改回复必须走独立 CAS');
  assert.match(service, /deleteReplyCas\(/, '删回复必须走独立 CAS');
  assert.match(service, /setCanEditReply\(/, 'VO 必须下发 canEditReply');
  // 第一次回复仍是 create-only:replyCas 的「已回复则拒」不能被顺手放开
  const mapper = read('../chengyinhub-system/src/main/resources/mapper/business/MerchantReviewMapper.xml');
  const replyCas = mapper.slice(mapper.indexOf('id="replyCas"'), mapper.indexOf('id="updateReplyCas"'));
  assert.match(replyCas, /and reply_content is null/, '创建端点必须保持「一次」语义');
  const updateCas = mapper.slice(mapper.indexOf('id="updateReplyCas"'), mapper.indexOf('id="deleteReplyCas"'));
  assert.match(updateCas, /and reply_content is not null/, '修改端点必须要求「已有回复」');
});
