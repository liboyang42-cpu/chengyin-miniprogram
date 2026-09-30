/* pages/coop/* 弹窗合同补口(2026-09-15 · 稿 356-5220)
 * 合同(与 `弹窗合同_盘点.md` 同一套写法,不另发明):
 *   整页首屏加载失败 / 无权限 = 零按钮 fail 半屏 + 2s 自动返回(cy-error auto-back);
 *   同一页的局部失败(带队申请任一路、官方邀约、刷新失败)= 原位行内错误 + 重试,不许整页退出。
 * 本文件把 pages/coop/** 的失败面按这两档分级,并对两侧各留一条负控:
 *   ① 整页失败退回老写法(去掉 auto-back) → 分级判据必须红;
 *   ② 局部失败被改成整页退出(写 listState=error) → 行为判据必须红。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');

// 与 cy-error-retry-wired-contract 同一套标签切分:引号内的 `>` 不能误当标签结尾
const CY_ERROR_TAG = /<cy-error\b(?:[^>"']|"[^"]*"|'[^']*')*>/gs;
const tagsOf = (wxml) => wxml.match(CY_ERROR_TAG) || [];
const isFill = (tag) => /(?:^|\s)fill(?:\s|=|\/?>)/.test(tag);

// 整页失败面:fill 整页 + 必须 auto-back;custom 档必须给页面自己「该去的页面」的句柄
const CUSTOM_BACK = [
  ['pages/coop/nearby/index.wxml', "pageState === 'error'", 'goBack'],
  ['pages/coop/nearby/index.wxml', '附近商家暂不可用', 'goBack'],
  ['pages/coop/invite-detail/index.wxml', "state !== 'ready'", 'goBack'],
  ['pages/coop/settlement-detail/index.wxml', '结算详情没加载出来', 'onNavBack'],
];

// fill 整页但明确豁免 auto-back 的三条(各有页面级出口,不是「加载失败甩手不管」)
const FILL_ALLOW = [
  ['pages/coop/invite-detail/index.wxml', /state === 'missing'/, '缺参终态:给了显式 CTA「回协作邀请」,不是加载失败'],
  ['pages/coop/invite-detail/index.wxml', /state === 'notfound'/, '业务不可见终态:同上,回列表是唯一下一步'],
  ['pages/coop/withdraw/records/index.wxml', /state === 'error'/, '重定向壳:重试=重新发起跳转,是真动作'],
];

// 局部失败面:必须留在行内(带自己的重试出口),且信号不许出现在任何 cy-error 整页分支里
const PARTIAL_INLINE = [
  ['pages/coop/list/index.wxml', "listErrorText && listState === 'ready'", 'bindtap="load"'],
  ['pages/coop/list/index.wxml', 'wx:if="{{receivedApplyErrorText}}"', 'bindtap="loadApplies"'],
  ['pages/coop/list/index.wxml', 'wx:if="{{receivedRegErrorText}}"', 'bindtap="loadReceivedRegs"'],
  ['pages/coop/list/index.wxml', 'wx:if="{{sentApplyErrorText}}"', 'bindtap="loadApplies"'],
  ['pages/coop/list/index.wxml', 'wx:if="{{officialErrorText}}"', 'bindtap="loadOfficialInvites"'],
  ['pages/coop/nearby/index.wxml', 'wx:if="{{refreshErrorText}}"', 'bindtap="retry"'],
  ['pages/coop/invite/index.wxml', "topicsErrorText && topicsState === 'ready'", 'bindtap="retryTopics"'],
  ['pages/coop/invite/index.wxml', "targetsErrorText && targetsState === 'ready'", 'bindtap="retryTargets"'],
  ['pages/coop/settlement-detail/index.wxml', "loadState === 'stale-error'", 'bind:action="retryLoad"'],
];

function walkWxml(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkWxml(full, out);
    else if (entry.name.endsWith('.wxml')) out.push(path.relative(ROOT, full));
  }
  return out;
}

/** 一个 wxml 里所有没接 auto-back 的 fill 整页失败(豁免除外)。 */
function fillViolations(wxml, file) {
  const violations = [];
  for (const tag of tagsOf(wxml)) {
    if (!isFill(tag)) continue;
    if (/\bauto-back\b/.test(tag)) continue;
    const exempt = FILL_ALLOW.some(([f, re]) => f === file && re.test(tag));
    if (!exempt) violations.push(file + ': ' + squash(tag).slice(0, 110));
  }
  return violations;
}

test('pages/coop/** 每个 fill 整页失败都接 auto-back,豁免三条各自成立', () => {
  const files = walkWxml(path.join(ROOT, 'pages/coop'));
  const fillTotal = files.reduce((n, file) => n + tagsOf(read(file)).filter(isFill).length, 0);
  const violations = files.flatMap((file) => fillViolations(read(file), file));
  assert.deepEqual(violations, [], '整页失败退回老写法(只剩短重试按钮):\n  ' + violations.join('\n  '));
  // 正控件:扫描面不许悄悄塌成 0,否则上面那句恒真
  // 2026-09-16 −2:候选池页整页删除(它自带 permission/error 两个 fill 整页失败)⇒ 实测 11
  assert.ok(fillTotal >= 11, 'pages/coop 的 fill 整页失败面应 >= 11,实际 ' + fillTotal);
  for (const [file, re, why] of FILL_ALLOW) {
    assert.match(read(file), re, '豁免锚点失效(' + why + '): ' + file);
  }
});

test('整页失败的返回句柄:coop/list 走默认返回,有自己出口的同族页走 custom-back', () => {
  const listTags = tagsOf(read('pages/coop/list/index.wxml'));
  for (const anchor of ["listState === 'permission'", "listState === 'error'"]) {
    const matched = listTags.filter((tag) => tag.includes(anchor) && isFill(tag));
    assert.equal(matched.length, 2, '两个 tab 各一份整页失败分支: ' + anchor);
    for (const tag of matched) {
      assert.match(tag, /\bauto-back\b/, anchor);
      assert.doesNotMatch(tag, /custom-back/, 'coop/list 没有页面级返回句柄,走默认返回(栈回退/域兜底)');
    }
  }
  for (const [file, anchor, handler] of CUSTOM_BACK) {
    const tag = tagsOf(read(file)).find((t) => t.includes(anchor) && isFill(t));
    assert.ok(tag, file + ' 找不到整页失败分支: ' + anchor);
    assert.match(tag, /\bauto-back\b/, file + ' ' + anchor);
    assert.match(tag, new RegExp('custom-back[^>]*bind:back="' + handler + '"'), file + ' ' + anchor);
    assert.match(read(file.replace(/\.wxml$/, '.js')), new RegExp('\\b' + handler + '\\s*\\('), '返回句柄必须在同页 JS 真实存在: ' + handler);
  }
});

test('局部失败保持行内:带自己的重试出口,信号不进任何 cy-error 整页分支', () => {
  for (const [file, anchor, retryPin] of PARTIAL_INLINE) {
    const wxml = read(file);
    const window = new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]{0,400}?' + retryPin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.match(wxml, window, '行内出口缺失: ' + file + ' ' + anchor);
    assert.ok(!tagsOf(wxml).some((tag) => tag.includes(anchor)),
      '局部失败被改成整页退出: ' + file + ' ' + anchor);
  }
});

// ───────── 行为:真页面 JS(只替换 wx.request 与 toast,不替代页面逻辑) ─────────

function mountList(mutate) {
  let source = read('pages/coop/list/index.js');
  if (mutate) {
    const changed = mutate(source);
    assert.notEqual(changed, source, '负控锚点失效:生产源码未命中');
    source = changed;
  }
  let definition;
  const requests = [];
  const app = {
    globalData: {},
    getUserID: () => 1,
    getUserRole: () => 'merchant',
    getUserType: () => 2,
    sendRequest(options) { requests.push(options); },
  };
  const pageFile = path.join(ROOT, 'pages/coop/list/index.js');
  vm.runInNewContext(source, {
    Page: (value) => { definition = value; },
    getApp: () => app,
    wx: { stopPullDownRefresh() {}, navigateTo(o) { if (o && o.complete) o.complete(); } },
    setTimeout() {}, clearTimeout() {}, console,
    require(id) {
      if (id.includes('/toast')) return () => {};
      if (id.includes('/modal')) return { show: (o) => o.success({ confirm: true, content: '' }) };
      if (id.includes('/loading')) return { show() {}, hide() {} };
      if (id.includes('/merchant-theme')) return { merchantPageShow() {}, merchantPageRestore() {} };
      if (id.includes('checkout')) return {};
      return require(path.resolve(path.dirname(pageFile), id));
    },
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  return { page, requests, byUrl: (url) => requests.filter((r) => r.url === url) };
}

const LIST_OK = { code: 200, data: { received: [{ id: 1, inviteType: 0, status: 0 }], sent: [], slots: {} } };

test('coop/list 首屏整页失败落 error/permission;读到过之后的刷新失败必须留页', () => {
  const first = mountList();
  first.page.load();
  assert.equal(first.page.data.listState, 'loading');
  first.byUrl('/api/coop/list')[0].success({ code: 500, msg: '服务暂不可用' });
  assert.equal(first.page.data.listState, 'error', '首屏没读到列表 = 整页失败(交给 auto-back 面板)');
  assert.equal(first.page.data.received.length, 0);

  const denied = mountList();
  denied.page.load();
  denied.byUrl('/api/coop/list')[0].success({ code: 403, msg: '无权访问协作邀请' });
  assert.equal(denied.page.data.listState, 'permission');

  const refresh = mountList();
  refresh.page.load();
  refresh.byUrl('/api/coop/list')[0].success(LIST_OK);
  refresh.page.onPullDownRefresh();
  refresh.byUrl('/api/coop/list')[1].fail({ errMsg: 'request:fail timeout' });
  assert.equal(refresh.page.data.listState, 'ready', '刷新失败必须留页(行内重试),不许整页退出');
  assert.ok(refresh.page.data.listErrorText);
  assert.equal(refresh.page.data.received.length, 1, '旧列表保留');
});

test('coop/list 局部失败:带队申请/官方邀约任一路失败都不许把整页推成失败', () => {
  const leg = mountList();
  leg.page.load();
  leg.byUrl('/api/coop/list')[0].success(LIST_OK);
  leg.byUrl('/api/coop/pool/received')[0].success({ code: 200, data: [] });
  leg.byUrl('/api/coop/pool/mine')[0].fail({ errMsg: 'request:fail timeout' });
  assert.equal(leg.page.data.listState, 'ready', '带队申请一路失败 = 局部失败,整页保持 ready');
  assert.equal(leg.page.data.received.length, 1, '邀约列表照常');
  assert.equal(leg.page.data.sentApplyState, 'error');
  assert.match(leg.page.data.sentApplyErrorText, /网络/);

  const official = mountList();
  official.page.load();
  official.byUrl('/api/coop/list')[0].success(LIST_OK);
  official.byUrl('/api/official/merchant-invites')[0].success({ code: 500, msg: '服务暂不可用' });
  assert.equal(official.page.data.listState, 'ready', '官方邀约失败 = 局部失败,整页保持 ready');
  assert.ok(official.page.data.officialErrorText);
  assert.equal(official.page.data.received.length, 1);
});

test('★负控①:整页失败退回老写法(删 auto-back) → 分级判据必须红', () => {
  const source = read('pages/coop/list/index.wxml');
  const mutated = source.replace(/auto-back bind:retry="load"/g, 'bind:retry="load"');
  assert.notEqual(mutated, source, '负控锚点失效:整页 auto-back 不存在');
  const violations = fillViolations(mutated, 'pages/coop/list/index.wxml');
  assert.equal(violations.length, 4, '两个 tab × 两档整页失败都必须被判红,实际: ' + JSON.stringify(violations));
});

test("★负控②:局部失败被改成整页退出(listState='error') → 行为判据必须红", () => {
  const real = mountList();
  real.page.load();
  real.byUrl('/api/coop/list')[0].success(LIST_OK);
  real.byUrl('/api/coop/pool/mine')[0].fail({ errMsg: 'request:fail timeout' });
  assert.equal(real.page.data.listState, 'ready', '生产源码:局部失败保持整页 ready');

  const mutated = mountList((source) => source.replace(
    'sentApplyErrorText: text,',
    "sentApplyErrorText: text, listState: 'error',",
  ));
  mutated.page.load();
  mutated.byUrl('/api/coop/list')[0].success(LIST_OK);
  mutated.byUrl('/api/coop/pool/mine')[0].fail({ errMsg: 'request:fail timeout' });
  assert.equal(mutated.page.data.listState, 'error', '负控必须复现「局部失败顶成整页退出」');
});
