/**
 * H050/H051 · 帖文「···」操作接线契约(square 详情 + 广场列表)。
 *
 * 组件(chengyinhub-xcx/components/cy/post-actions)与内部危险确认闸早已完工并有
 * post-actions-sheet-contract 钉住,但全仓零调用 —— 用户发错帖/想删帖没有入口。
 *
 * 本契约钉两件事,且**渲染层与行为层都钉**:
 *   ① 渲染层:详情与列表都挂上 <cy-post-actions>(前者还有编辑用的 cy-post-compose);
 *   ② 行为层:delete 发 /api/creativesquare/delete、edit 以编辑态打开新建面板并带原帖 id、
 *      report 仍走既有举报确认。
 * 负控:删掉渲染入口 / 变异请求 URL / 掐掉分发分支,对应断言必须真红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const vm = require('../helpers/ui-sandbox-vm.js');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const POST_ACTIONS_TAG = /<cy-post-actions id="post-actions"[\s\S]{0,200}?show="\{\{postActionShow\}\}"[\s\S]{0,200}?bind:select="onPostAction"[\s\S]{0,200}?bind:close="closePostActions"\s*\/>/;

function assertDetailWired(wxml) {
  assert.match(wxml, POST_ACTIONS_TAG, '详情必须挂三合一操作弹层,show/select/close 三根线齐全');
  assert.match(wxml, /<cy-post-actions id="post-actions"[^>]*owner="\{\{isMine\}\}"/,
    'owner 必须来自 isMine:编辑/删除只给作者');
  // A-09:溢出入口不再按「关联帖/作者」设条件 —— 非本人纯文本帖也要能在这里举报
  // (组件 owner=false 时只渲染举报行,不会露出编辑/删除;见 post-actions/index.wxml)。
  assert.match(wxml, /<view class="ph-more" catchtap="openPostActions"/,
    '溢出入口必须对所有人可达,否则非本人纯文本帖在详情页没有举报路');
  assert.doesNotMatch(wxml, /ph-more"[^>]*wx:if/,
    '溢出入口不许再挂 hasPlayCover/isMine 条件(A-09 回退会重现「详情页举报不了」)');
  assert.match(wxml, /<cy-post-compose[^>]*edit-post="\{\{composeEdit\}\}"/,
    '编辑要复用新建面板的编辑态(edit-post),不能再造一个编辑器');
  assert.doesNotMatch(wxml, /reportSquareFromActions/,
    '旧的「只有举报」自绘弹层必须退役(三合一组件替代它)');
}

function assertListWired(wxml) {
  assert.match(wxml, POST_ACTIONS_TAG, '广场列表必须挂三合一操作弹层,三根线齐全');
  assert.match(wxml, /<cy-post-actions id="post-actions"[^>]*owner="\{\{currentActionOwner\}\}"/,
    'owner 必须来自当前行作者判定');
  assert.match(wxml, /<cy-post-compose[^>]*edit-post="\{\{composeEdit\}\}"/,
    '列表页的编辑同样走 edit-post');
  assert.doesNotMatch(wxml, /bmShow/,
    '旧的 index 版举报弹层必须整体退役(bmShow/bmClose 不许留半截)');
}

test('渲染层:详情与列表都接上 cy-post-actions(编辑走 cy-post-compose 编辑态)', () => {
  const detailWxml = read('pages/square/detail/index.wxml');
  const listWxml = read('pages/square/list/index.wxml');
  const detailJson = JSON.parse(read('pages/square/detail/index.json'));
  const listJson = JSON.parse(read('pages/square/list/index.json'));

  assertDetailWired(detailWxml);
  assertListWired(listWxml);

  assert.equal(detailJson.usingComponents['cy-post-actions'], '/pages/square/components/cy/post-actions/index');
  assert.equal(detailJson.usingComponents['cy-post-compose'], '/pages/square/components/cy/post-compose/index');
  assert.equal(listJson.usingComponents['cy-post-actions'], '/pages/square/components/cy/post-actions/index');

  // 负控:把渲染入口从 wxml 里删掉,同一条断言必须真红
  const stripped = detailWxml.replace(/<cy-post-actions[\s\S]*?\/>/, '');
  assert.notEqual(stripped, detailWxml, '负控锚点失效:详情 cy-post-actions 未命中');
  assert.throws(() => assertDetailWired(stripped), assert.AssertionError,
    '删掉渲染入口后必须变红 —— 只断言 data 的契约会放过这种回归');

  const strippedList = listWxml.replace(/<cy-post-actions[\s\S]*?\/>/, '');
  assert.notEqual(strippedList, listWxml, '负控锚点失效:列表 cy-post-actions 未命中');
  assert.throws(() => assertListWired(strippedList), assert.AssertionError);
});

function loadPage(relativePath, opts) {
  const requests = [];
  const modalCalls = [];
  const navigations = [];
  const toasts = [];
  let definition;
  const absolutePath = path.join(ROOT, relativePath);
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    getAvatar: () => '',
    getNickname: () => '',
    getPageSize: () => 10,
    getTotalPage: (total, size) => Math.ceil(Number(total || 0) / size),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) {
      requests.push(options);
      return { aborted: false, abort() { this.aborted = true; } };
    },
  };
  const wxApi = {
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 20, safeAreaInsets: { bottom: 0 } }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 64 }),
    hideTabBar() {},
    navigateBack(options) { if (options && options.fail) options.fail(); },
    navigateTo(options) { navigations.push(options && options.url); },
    redirectTo(options) { navigations.push(options && options.url); },
    reLaunch(options) { navigations.push(options && options.url); },
    pageScrollTo() {},
    setClipboardData() {},
    previewImage() {},
    stopPullDownRefresh() {},
    showModal(options) {
      modalCalls.push(options);
      if (!opts || !opts.manualModal) options.success({ confirm: true, content: '测试理由' });
    },
    showToast() {}, hideToast() {}, showLoading() {}, hideLoading() {},
    createSelectorQuery: () => ({ select() { return this; }, selectViewport() { return this; }, boundingClientRect() { return this; }, fields() { return this; }, scrollOffset() { return this; }, exec(cb) { if (cb) cb([null]); } }),
  };
  const source = (opts && opts.source) || read(relativePath);
  vm.runInNewContext(source, {
    console,
    getApp: () => app,
    Page: (config) => { definition = config; },
    require: createRequire(absolutePath),
    setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    wx: wxApi,
  }, { filename: absolutePath });

  assert.ok(definition, relativePath + ' 必须注册 Page');
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.entries(patch).forEach(([key, value]) => {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let cursor = this.data;
        parts.slice(0, -1).forEach((part) => {
          if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
          cursor = cursor[part];
        });
        cursor[parts[parts.length - 1]] = value;
      });
      if (done) done.call(this);
    },
  });
  return { page, requests, modalCalls, navigations, toasts };
}

function detailReady(h, over) {
  h.page.onLoad({ id: '77' });
  const info = h.requests.find((r) => r.url === '/api/creativesquare/info');
  assert.ok(info, '详情必须请求 /api/creativesquare/info');
  info.success({ code: '200', data: Object.assign({ id: 77, memberId: 1, memberNickname: '我自己', contents: '发错的原文', pics: '' }, over || {}) });
  assert.equal(h.page.data.detailState, 'ready');
}

test('详情:作者点删除走 /api/creativesquare/delete,成功后落到「暂不可用」态;负控换 URL 即红', () => {
  const h = loadPage('pages/square/detail/index.js');
  detailReady(h);
  assert.equal(h.page.data.isMine, true, '本人帖必须判定 isMine');

  h.page.openPostActions();
  assert.equal(h.page.data.postActionShow, true, '··· 先开弹层,不直接删');
  assert.equal(h.requests.some((r) => r.url === '/api/creativesquare/delete'), false);

  h.page.onPostAction({ detail: { action: 'delete', id: '77' } });
  const write = h.requests.find((r) => r.url === '/api/creativesquare/delete');
  assert.ok(write, '确认后必须发删除请求');
  assert.equal(String(write.data.id), '77', '删的必须是这一条');
  write.success({ code: '200' });
  assert.equal(h.page.data.detailState, 'empty', '删除成功后详情切「暂不可用」,不能留一条已删帖在页上');

  // 负控:把 URL 变异成别的端点,「必须发删除请求」这条断言真红
  const brokenSource = read('pages/square/detail/index.js')
    .replace("url: '/api/creativesquare/delete'", "url: '/api/creativesquare/report'");
  assert.notEqual(brokenSource, read('pages/square/detail/index.js'), '负控锚点失效:删除 URL 未命中');
  const broken = loadPage('pages/square/detail/index.js', { source: brokenSource });
  detailReady(broken);
  broken.page.onPostAction({ detail: { action: 'delete', id: '77' } });
  assert.equal(broken.requests.some((r) => r.url === '/api/creativesquare/delete'), false, '负控必须真的把删除端点改掉');
  assert.throws(() => {
    assert.ok(broken.requests.find((r) => r.url === '/api/creativesquare/delete'), '确认后必须发删除请求');
  }, assert.AssertionError);
});

test('详情:编辑以编辑态打开新建面板并带原帖 id/正文/关联;举报仍走既有确认', () => {
  const h = loadPage('pages/square/detail/index.js');
  detailReady(h, { dataId: 9, dataType: 1 });

  h.page.onPostAction({ detail: { action: 'edit', id: '77' } });
  assert.equal(h.page.data.postActionShow, false, '选完动作弹层要收起');
  assert.equal(h.page.data.composeShow, true, '编辑必须打开面板');
  assert.equal(h.page.data.composeEdit.id, '77');
  assert.equal(h.page.data.composeEdit.contents, '发错的原文');
  assert.equal(h.page.data.composeEdit.dataId, 9, '关联要带上:后端编辑分支对 data_id 无值即清 0');
  assert.equal(h.page.data.composeEdit.dataType, 1);

  let reports = 0;
  h.page.reportSquare = () => { reports += 1; };
  h.page.onPostAction({ detail: { action: 'report', id: '77' } });
  assert.equal(reports, 1, '举报必须仍走既有举报确认');
  assert.equal(h.page.data.postActionShow, false);

  // 负控:掐掉分发里的 delete 分支,上面的删除用例必须真红
  const brokenSource = read('pages/square/detail/index.js')
    .replace("if (action === 'delete') { this.deleteSquarePost(); return; }", '');
  assert.notEqual(brokenSource, read('pages/square/detail/index.js'), '负控锚点失效:分发分支未命中');
  const broken = loadPage('pages/square/detail/index.js', { source: brokenSource });
  detailReady(broken);
  broken.page.onPostAction({ detail: { action: 'delete', id: '77' } });
  assert.throws(() => {
    assert.ok(broken.requests.find((r) => r.url === '/api/creativesquare/delete'), '确认后必须发删除请求');
  }, assert.AssertionError, '掐掉分发分支后必须变红');
});

test('列表:more 解析当前行的 id/归属;删除摘行、编辑开面板、举报走确认', () => {
  const h = loadPage('pages/square/list/index.js');
  h.page.data.userId = 1;
  h.page.data.list = [
    { id: 11, memberId: 1, contents: '我的帖', dataId: 0, dataType: 0 },
    { id: 12, memberId: 2, contents: '别人的帖' },
  ];

  h.page.showAction({ detail: { index: 1 } });
  assert.equal(h.page.data.postActionShow, true);
  assert.equal(h.page.data.currentActionId, '12');
  assert.equal(h.page.data.currentActionOwner, false, '别人的帖:只该看到举报');

  h.page.closePostActions();
  assert.equal(h.page.data.postActionShow, false);
  h.page.showAction({ detail: { index: 0 } });
  assert.equal(h.page.data.currentActionId, '11');
  assert.equal(h.page.data.currentActionOwner, true, '本人帖:编辑/删除要出现');

  h.page.onPostAction({ detail: { action: 'edit', id: '11' } });
  assert.equal(h.page.data.composeShow, true);
  assert.equal(h.page.data.composeEdit.id, '11');
  assert.equal(h.page.data.composeEdit.contents, '我的帖');

  h.page.onComposeClose();
  assert.equal(h.page.data.composeShow, false);
  assert.equal(h.page.data.composeEdit, null, '关面板必须清编辑态,免得下次新建以编辑态打开');

  h.page.showAction({ detail: { index: 0 } });
  h.page.onPostAction({ detail: { action: 'delete', id: '11' } });
  const write = h.requests.find((r) => r.url === '/api/creativesquare/delete');
  assert.ok(write, '列表删除必须发删除请求');
  assert.equal(String(write.data.id), '11');
  write.success({ code: '200' });
  assert.deepEqual(h.page.data.list.map((item) => item.id), [12], '删除成功后本地摘掉这一行');
  assert.equal(h.page.data.postActionShow, false);

  h.page.showAction({ detail: { index: 0 } });
  h.page.onPostAction({ detail: { action: 'report', id: '12' } });
  assert.equal(h.modalCalls.length >= 1, true, '举报必须过确认框');
  const report = h.requests.find((r) => r.url === '/api/creativesquare/report');
  assert.ok(report, '确认后必须发举报请求');
  assert.equal(String(report.data.id), '12');
});

test('A-09:非本人纯文本帖在详情也有举报入口(owner=false 只渲染举报行)', () => {
  const h = loadPage('pages/square/detail/index.js');
  detailReady(h, { memberId: 2 });
  assert.equal(h.page.data.isMine, false, '别人的帖必须判定非本人');

  h.page.openPostActions();
  assert.equal(h.page.data.postActionShow, true, '非本人也要能打开 ··· 弹层(此前详情页没有这个入口)');
  let reports = 0;
  h.page.reportSquare = () => { reports += 1; };
  h.page.onPostAction({ detail: { action: 'report', id: '77' } });
  assert.equal(reports, 1, '非本人的举报必须仍走既有举报确认');
  assert.equal(h.page.data.composeShow, false, '非本人不该打开编辑面板');

  const wxml = read('pages/square/detail/index.wxml');
  assert.match(wxml, /<cy-post-actions[^>]*owner="\{\{isMine\}\}"/, 'owner 仍由 isMine 决定,非本人不露出编辑/删除');
});

test('列表:编辑入口显式带编辑态,关闭后清编辑态', () => {
  // 2026-09-18 UI-15:「展开进完整新建弹窗」口随发布区改造删除,
  // cy-post-compose 只剩编辑已有帖一条入口;这里锁编辑态的装载与关闭清理。
  const h = loadPage('pages/square/list/index.js');
  h.page.data.userId = 1;
  h.page.data.list = [{ id: 11, memberId: 1, contents: '我的帖' }];
  h.page.showAction({ detail: { index: 0 } });
  h.page.onPostAction({ detail: { action: 'edit', id: '11' } });
  assert.equal(h.page.data.composeShow, true);
  assert.ok(h.page.data.composeEdit, '编辑入口必须带被编辑的那条帖');

  h.page.onComposeClose();
  assert.equal(h.page.data.composeShow, false);
  assert.equal(h.page.data.composeEdit, null, '关闭后必须清编辑态,不能带到下一次打开');
});
