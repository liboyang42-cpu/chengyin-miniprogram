// CU-C-138 / CU-C-149:「不能举报自己」这道闸在俱乐部详情页缺的两格。
//
// 两条走查实证(隔离库,主理人身份 #9008 / 成员 #990006):
//  CU-C-138 俱乐部 #7002 帖子下看自己那条隔离评论,操作区同时给「删除」「举报」。
//         点完「举报 → 确认 → 已举报」,audit_task 真多出一张 CLUB_POST_COMMENT 单,
//         submitter_id=990006,而被举报评论的 member_id 也是 990006 —— 没有对手的工单。
//         同页动态行(:162)与成员行(:337)都有作者闸,只有评论这一行漏了。
//  CU-C-149 活动 Tab 点自己项目 #990030 的「举报活动」,一路进到活动 #32 举报页,
//         club_governance_case.id=2 落成 filer=9008 / target_type=ACTIVITY / PENDING。
//         后端 ACTIVITY 那一档只验「属于本俱乐部且未删」,MEMBER 才有「不能举报自己」。
//
// 两道的判据都是**同一条**:目标作者 == 当前登录成员 ⇒ 入口不出现、处理器不进、后端不成单。
// 删除入口必须留着 —— 收回的是「给自己开审核单」,不是「管不了自己的内容」。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DETAIL_JS = 'pages/club/detail/index.js';
const DETAIL_WXML = 'pages/club/detail/index.wxml';

// ---------------------------------------------------------------- 静态判据
// 评论举报:必须看作者;删除:必须还留着(否则改过头,把正当的内容管理一起砍了)。
function assertCommentReportGate(wxml) {
  const report = wxml.match(/<text([^>]*)catchtap="onReportComment"[^>]*>举报<\/text>/);
  assert.ok(report, '评论举报入口必须存在(别人发的评论要能报)');
  assert.match(report[1], /wx:if="\{\{[^}]*memberId != myMemberId/,
    'CU-C-138:自己的评论不给举报入口');

  const del = wxml.match(/<text([^>]*)catchtap="onDeleteComment"/);
  assert.ok(del && /cm\.memberId == myMemberId/.test(del[1]),
    '删除入口的判据不能动 —— 本人要能删自己的评论');
}

// 活动卡:闸加在 template data 的 canReport 上,两处调用点(upcoming / ended)都得加,
// 漏一处就等于「进行中的项目报不了、已结束还能报」这种半拉子行为。
function assertActivityReportGate(wxml) {
  const sites = wxml.match(/is="clubEventCard"\s*\n?\s*data="\{\{[^"]*\}\}"/g) || [];
  assert.equal(sites.length, 2, '活动卡有两个调用点(进行中 / 已结束),断言必须覆盖两处');
  sites.forEach(function (site) {
    assert.match(site, /canReport:\s*canSeeMembers && item\.memberId != myMemberId/,
      'CU-C-149:本人创建的项目不给「举报活动」:' + site);
  });
  assert.match(wxml, /wx:if="\{\{canReport\}\}" class="event-report"/,
    '模板内仍按 canReport 渲染(闸加在 data 上,不是加在模板里)');
}

// ---------------------------------------------------------------- 页面沙箱
function makeWxStub(navigations) {
  const noop = () => {};
  return {
    showToast: noop, navigateTo(o) { navigations.push(o.url); }, navigateBack() { navigations.push('__back__'); },
    redirectTo(o) { navigations.push(o.url); }, switchTab(o) { navigations.push(o.url); },
    stopPullDownRefresh: noop, getStorageSync: () => '', setStorageSync: noop, removeStorageSync: noop,
    getSystemInfoSync: () => ({}), pageScrollTo: noop, showModal: noop, showShareMenu: noop,
    setNavigationBarColor: noop, setBackgroundColor: noop, showLoading: noop, hideLoading: noop,
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }),
  };
}

// modal 是被 require 进来的,拦下它才能知道「确认框有没有弹」。
// src 可传入**改写过的源码字符串** —— 负控靠这条才能真跑到病灶形态那一版。
function loadClubDetail(src) {
  const modals = [];
  const requests = [];
  const navigations = [];
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(o) { requests.push(o); },
    tips() {}, getUserID: () => 9008, getUserRole: () => 'club', getUserType: () => 'club',
    getAvatar: () => '', getNickname: () => '测试',
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  };
  global.getApp = () => app;
  global.wx = makeWxStub(navigations);
  const file = path.resolve(ROOT, DETAIL_JS);
  let definition;
  vm.runInNewContext(src || read(DETAIL_JS), {
    getApp: () => app,
    Page(p) { definition = p; },
    Component(p) { definition = p; },
    getCurrentPages: () => [{}, {}],
    setTimeout(fn) { if (fn) fn(); return 1; },
    clearTimeout() {}, console, Set, Date, JSON,
    require(id) {
      if (/utils\/modal\.js$/.test(id)) {
        return { show(o) { modals.push(o); }, hide() {} };
      }
      if (/utils\/(loading|toast)\.js$/.test(id)) {
        const noop = () => {};
        return Object.assign(noop, { success: noop, error: noop, info: noop, warning: noop, hide() {} });
      }
      if (/utils\/scene-registry\.js$/.test(id)) return { getScene: () => ({}) };
      if (/utils\/mockData\.js$/.test(id)) return { DEMO_NEARBY_CLUB_ID: -1 };
      if (/utils\/datetime$/.test(id)) return { toTimestamp: (v) => Date.parse(String(v).replace(' ', 'T')) || 0 };
      if (/utils\/group-code-session\.js$/.test(id)) {
        return { buildGroupCodeIssuePayload: () => ({}), listGroupCodeActivities: () => [] };
      }
      if (/utils\/aiPlanToDraft\.js$/.test(id)) return { aiPlanToDraft: () => ({}) };
      return require(path.resolve(path.dirname(file), id));
    },
    wx: makeWxStub(navigations),
  }, { filename: DETAIL_JS });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback.call(this); },
  });
  return { page, requests, navigations, modals };
}

// ============================================================ 卡面(静态)
test('CU-C-138 静态:自己的评论没有举报入口,删除入口照旧', () => {
  assertCommentReportGate(read(DETAIL_WXML));
});

test('CU-C-149 静态:活动卡两处调用点都按作者收回报举入口', () => {
  assertActivityReportGate(read(DETAIL_WXML));
});

// ============================================================ 处理器(行为)
test('CU-C-138 行为:自己的评论点举报不弹确认框,别人的照常弹', () => {
  const { page, modals } = loadClubDetail();
  page.setData({ myMemberId: 9008, comments: [{ id: 5, memberId: 9008, content: '我的' }, { id: 6, memberId: 7, content: '别人的' }] });

  page.onReportComment({ currentTarget: { dataset: { id: 5 } } });
  assert.equal(modals.length, 0, '本人的评论不该给自己开审核单');

  page.onReportComment({ currentTarget: { dataset: { id: 6 } } });
  assert.equal(modals.length, 1, '别人评论的举报是正当入口,不能顺手一起关');
  assert.equal(modals[0].confirmText, '举报');
});

test('CU-C-149 行为:自己项目的场次不进举报流程,别人项目的才会', () => {
  const { page, requests, modals } = loadClubDetail();
  page.setData({ myMemberId: 9008, canSeeMembers: true, clubId: 7002 });
  page._topics = [{ id: 990030, memberId: 9008 }, { id: 990031, memberId: 7 }];

  page.reportTopicActivity({ currentTarget: { dataset: { id: 990030 } } });
  assert.equal(requests.length, 0, '本人项目不该去拉场次列表,更不该进举报页');
  assert.equal(modals.length, 0);

  page.reportTopicActivity({ currentTarget: { dataset: { id: 990031 } } });
  assert.equal(requests.length, 1, '别人项目的举报流程必须完好');
  assert.equal(requests[0].url, '/api/topic/info-to-user');
});

test('CU-C-149 行为:字符串 id 也要认得(后端回包 id 常是字符串,别因类型漏闸)', () => {
  const { page, requests } = loadClubDetail();
  page.setData({ myMemberId: '9008', canSeeMembers: true, clubId: 7002 });
  page._topics = [{ id: '990030', memberId: 9008 }];

  page.reportTopicActivity({ currentTarget: { dataset: { id: '990030' } } });
  assert.equal(requests.length, 0);
});

// ============================================================ 负控
test('negative control CU-C-138/149:撤掉任一道闸,对应检查器必须判红', () => {
  const wxml = read(DETAIL_WXML);

  const noCommentGate = wxml.replace(
    '<text wx:if="{{cm.memberId != myMemberId}}" catchtap="onReportComment"',
    '<text catchtap="onReportComment"',
  );
  assert.notEqual(noCommentGate, wxml, '变异锚点失效(源码已改动?)');
  assert.throws(() => assertCommentReportGate(noCommentGate), assert.AssertionError);

  const oneSiteOnly = wxml.replace(
    'canReport: canSeeMembers && item.memberId != myMemberId',
    'canReport: canSeeMembers',
  );
  assert.notEqual(oneSiteOnly, wxml, '变异锚点失效(源码已改动?)');
  assert.throws(() => assertActivityReportGate(oneSiteOnly), assert.AssertionError);

  // 行为侧:把处理器的闸摘掉 ⇒ 本人那条又能弹确认框,证明这条断言量的是源码不是运气
  const js = read(DETAIL_JS);
  const strippedCommentGate = js.replace(
    '    if (comment && String(comment.memberId) === String(this.data.myMemberId)) return;\n',
    '',
  );
  assert.notEqual(strippedCommentGate, js, '变异锚点失效(源码已改动?)');
  const mutated = loadClubDetail(strippedCommentGate);
  mutated.page.setData({ myMemberId: 9008, comments: [{ id: 5, memberId: 9008 }] });
  mutated.page.onReportComment({ currentTarget: { dataset: { id: 5 } } });
  assert.equal(mutated.modals.length, 1,
    '摘闸后没弹框 ⇒ 这条负控没量到东西,得改锚点(不能留一条恒红的断言)');
  assert.throws(
    () => assert.equal(mutated.modals.length, 0, '本人的评论不该给自己开审核单'),
    assert.AssertionError,
  );

  const strippedActivityGate = js.replace(
    '    if (topic && String(topic.memberId) === String(this.data.myMemberId)) return;\n',
    '',
  );
  assert.notEqual(strippedActivityGate, js, '变异锚点失效(源码已改动?)');
  const mutatedAct = loadClubDetail(strippedActivityGate);
  mutatedAct.page.setData({ myMemberId: 9008, canSeeMembers: true, clubId: 7002 });
  mutatedAct.page._topics = [{ id: 990030, memberId: 9008 }];
  mutatedAct.page.reportTopicActivity({ currentTarget: { dataset: { id: 990030 } } });
  assert.equal(mutatedAct.requests.length, 1, '摘闸后没走流程 ⇒ 负控锚点失效');
});
