// E-06 / E-14(2026-09-16 整体检查 E 组 P1/P2):俱乐部活动详情的字段真源与管理身份收口。
//
// 病:① resolveStateKey 读 auditStatus/rejectReason —— auditStatus 全库不存在,审核中/未通过恒显示「已确认」;
//     ② 核销三项读不存在的字段,用 Number(x)||0 把「未知」显示成「0」;
//     ③ 「接下来」段只读不存在的 raw.sessions ⇒ 恒空;
//     ④ 核销区/管理主键/导演台完全不看身份,被转发的普通成员也能看到管理向入口。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../pages/club/topic-detail/index.js');
const WXML_PATH = path.resolve(__dirname, '../../pages/club/topic-detail/index.wxml');

function loadPage() {
  const requests = [];
  let pageConfig = null;
  const previous = { getApp: global.getApp, Page: global.Page, wx: global.wx, getCurrentPages: global.getCurrentPages };
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: (options) => { requests.push(options); },
    tips: () => {},
  });
  global.Page = (config) => { pageConfig = config; };
  global.getCurrentPages = () => [{}];
  global.wx = {
    showToast: () => {}, navigateTo: () => {}, getStorageSync: () => '', setStorageSync: () => {},
    removeStorageSync: () => {}, getSystemInfoSync: () => ({}),
  };
  delete require.cache[PAGE_PATH];
  try { require(PAGE_PATH); } finally { global.getApp = previous.getApp; global.Page = previous.Page; }
  const vm = Object.assign({}, pageConfig, { setData(patch) { Object.assign(this.data, patch); } });
  vm.data = Object.assign({}, pageConfig.data);
  vm.loadProjection = function () { vm._projectionLoads = (vm._projectionLoads || 0) + 1; };
  return { vm, requests };
}

test('审核态读 cms_topic.status:0=审核中、2=未通过(带驳回原因),不再读幻字段 auditStatus', () => {
  const src = fs.readFileSync(PAGE_PATH, 'utf8');
  assert.doesNotMatch(src.replace(/^\s*\/\/.*$/gm, ''), /raw\.auditStatus/, 'auditStatus 全库不存在,不许再读');

  const reviewing = loadPage();
  reviewing.vm._topicId = 88; reviewing.vm._clubId = 9;
  reviewing.vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true };
  reviewing.vm.applyDetail.call(reviewing.vm, { status: 0, isOwner: 1, name: '审核中的主题', activityList: [] });
  assert.equal(reviewing.vm.data.statusKey, 'reviewing');
  assert.equal(reviewing.vm.data.statusText, '审核中');
  assert.equal(reviewing.vm.data.primary.disabled, true, '审核中不该给「开始准备」');

  const rejected = loadPage();
  rejected.vm._topicId = 88; rejected.vm._clubId = 9;
  rejected.vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true };
  rejected.vm.applyDetail.call(rejected.vm, { status: 2, rejectReason: '路线与主题不符', isOwner: 1, activityList: [] });
  assert.equal(rejected.vm.data.statusKey, 'rejected');
  assert.equal(rejected.vm.data.showReject, true);
  assert.equal(rejected.vm.data.topic.rejectReason, '路线与主题不符');
});

test('核销三项读管理向接口的真值;真 0 显示 0,没下发才显示「—」', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  // 真页顺序:导演台 projection 先到(RUNNING),fetchDetail 再 applyDetail —— 这时才带核销区
  vm._directorStatusKey = 'running';
  vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true, pendingVerifyCount: 4, verifiedByMeCount: 0, sessionHeadcount: 12 };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702 }] });
  vm._projectionLoads = 0;
  assert.equal(vm.data.showVerify, true, '管理身份 + 进行中才出核销区');
  assert.deepEqual(vm.data.verifyMetrics.map((m) => m.value), ['4', '0', '12']);
  vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702 }] });
  assert.deepEqual(vm.data.verifyMetrics.map((m) => m.value), ['—', '—', '—']);
  const src = fs.readFileSync(PAGE_PATH, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /Number\(raw\.pendingVerifyCount\) \|\| 0/, '未知不许折算成 0');
});

test('E-14:普通成员(非 owner)带 clubId 进详情:不出核销区、不出管理主键、不进导演台', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._manageStats = { canDirect: false, canManageSessions: false, canViewVerify: false };
  vm.applyDetail.call(vm, { status: 1, isOwner: 0, name: 't', activityList: [{ id: 702, name: '第一场' }] });
  assert.equal(vm._canDirect, false);
  assert.equal(vm.data.directorActive, false, '非管理者不进导演台状态机');
  assert.equal(vm.data.primary.text, '', '非管理者不给开始准备类主键');
  assert.equal(vm.data.showVerify, false);
  assert.equal(vm.data.canManageSessions, false, '「管理场次」入口也要收口');
  vm.applyProjectionStatus.call(vm, 'RUNNING');
  assert.equal(vm.data.showVerify, false, 'projection 回来也不放行非管理者');
});

test('「接下来」段用 activityList 真实字段渲染(不再读幻字段 raw.sessions)', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true };
  vm.applyDetail.call(vm, {
    status: 1, isOwner: 1, name: 't', totalChapterCount: 3,
    activityList: [{ id: 702, name: '周末场', startDate: '2026-09-10 10:00:00', endDate: '2026-09-10 18:00:00', addressName: '愚园路 68 号' }],
  });
  assert.equal(vm.data.sessions.length, 1);
  assert.equal(vm.data.sessions[0].whoText, '周末场');
  assert.equal(vm.data.sessions[0].etaText, '愚园路 68 号');
  assert.match(vm.data.sessions[0].whenText, /9月10日/);
  assert.equal(vm.data.sessions[0].kindText, '', '场次类型后端没给,不许冒充');
  assert.equal(vm.data.topic.structureText, '3 章', '章节总数读 totalChapterCount');
  // 空 kindText 的胶囊必须整格不渲染(否则会出一个空框)
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  assert.match(wxml, /<view class="ctd-next__kind" wx:if="\{\{item\.kindText\}\}">/);
});

// 第二轮拍板第 1 条(2026-09-17):五个主理人侧字段由管理向接口下发,页面只读字段。
test('拍板1:带 clubId 进页就拉 topic-manage-stats,进导演台后按这一场重拉', () => {
  const { vm, requests } = loadPage();
  vm.onLoad({ topicId: '88', clubId: '9' });
  const stats = requests.filter((r) => r.url === '/api/club/crm/topic-manage-stats');
  assert.equal(stats.length, 1);
  assert.deepEqual(JSON.parse(stats[0].data), { clubId: 9, topicId: 88, activityId: null });
  stats[0].success({ code: 200, data: { canDirect: true, canManageSessions: true, canViewVerify: true, nodeCount: 5, sessionHeadcount: 3, pendingVerifyCount: 1, verifiedByMeCount: 2 } });
  const detail = requests.find((r) => r.url === '/api/topic/info-to-user');
  detail.success({ code: 200, data: { status: 1, isOwner: 0, name: 't', totalChapterCount: 2, activityList: [{ id: 702 }] } });
  assert.equal(vm._canDirect, true, '导演台身份只认 canDirect');
  assert.equal(vm._directorActivityId, 702, '唯一一场自动进导演台');
  const again = requests.filter((r) => r.url === '/api/club/crm/topic-manage-stats');
  assert.equal(again.length, 2, '进了这一场,本场人数要换成这一场的口径');
  assert.equal(JSON.parse(again[1].data).activityId, 702);
  assert.equal(vm.data.topic.structureText, '2 章 · 5 站', '站数读 nodeCount 真值');
  assert.deepEqual(vm.data.topic.chips, ['本场 3 人']);
  assert.deepEqual(vm.data.topic.statusChips, [], 'gameConfiguredCount 没下发就不出「玩法 0/5」');
});

test('拍板1:isOwner=1 但接口说不能管理 ⇒ 不给管理向界面(不再拿 isOwner 猜)', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._manageStats = { canDirect: false, canManageSessions: false, canViewVerify: false, nodeCount: 5 };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702 }] });
  assert.equal(vm._canDirect, false);
  assert.equal(vm.data.canManageSessions, false);
  assert.equal(vm.data.directorActive, false);
});

test('拍板1:统计拉取失败走整页错误,晚到的详情不得把它盖成普通成员视图', () => {
  const { vm, requests } = loadPage();
  vm.onLoad({ topicId: '88', clubId: '9' });
  requests.find((r) => r.url === '/api/club/crm/topic-manage-stats').fail({ errMsg: 'timeout' });
  requests.find((r) => r.url === '/api/topic/info-to-user')
    .success({ code: 200, data: { status: 1, isOwner: 1, name: 't', activityList: [] } });
  assert.equal(vm.data.loadError, true);
  vm.onRetry();
  const retried = requests.filter((r) => r.url === '/api/club/crm/topic-manage-stats');
  assert.equal(retried.length, 2, '重试要把统计一起重拉');
  retried[1].success({ code: 200, data: { canDirect: true, canManageSessions: true, canViewVerify: true } });
  requests.filter((r) => r.url === '/api/topic/info-to-user').at(-1)
    .success({ code: 200, data: { status: 1, isOwner: 1, name: 't', activityList: [] } });
  assert.equal(vm.data.loadError, false);
});

test('拍板1:详情先到、统计后到 ⇒ 统计到之前不渲染(不闪普通成员视图);旧请求晚到的失败不打翻新结果', () => {
  const { vm, requests } = loadPage();
  vm.onLoad({ topicId: '88', clubId: '9' });
  requests.find((r) => r.url === '/api/topic/info-to-user')
    .success({ code: 200, data: { status: 1, isOwner: 1, name: 't', activityList: [{ id: 701 }, { id: 702 }] } });
  assert.notEqual(vm.data.loaded, true, '身份未知时不出 ready 视图');
  const first = requests.find((r) => r.url === '/api/club/crm/topic-manage-stats');
  vm.onRetry();
  const second = requests.filter((r) => r.url === '/api/club/crm/topic-manage-stats').at(-1);
  second.success({ code: 200, data: { canDirect: true, canManageSessions: true, canViewVerify: true } });
  requests.filter((r) => r.url === '/api/topic/info-to-user').at(-1)
    .success({ code: 200, data: { status: 1, isOwner: 1, name: 't', activityList: [{ id: 701 }, { id: 702 }] } });
  assert.equal(vm.data.loaded, true);
  assert.equal(vm._canDirect, true);
  first.fail({ errMsg: 'timeout' });
  assert.equal(vm.data.loadError, false, '旧请求晚到的失败不许把页面打成错误态');
});

// 总控复查裁定(2026-09-17):三块管理向界面各读各的身份字段,判据全在后端。
test('复查裁定:核销员只有 canViewVerify ⇒ 出核销区(标签「待核销」),不进导演台、不出场次管理与管理主键', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._directorStatusKey = 'running';
  vm._manageStats = { canDirect: false, canManageSessions: false, canViewVerify: true, pendingVerifyCount: 3, verifiedByMeCount: 1, sessionHeadcount: 9 };
  vm.applyDetail.call(vm, { status: 1, isOwner: 0, name: 't', activityList: [{ id: 702 }] });
  assert.equal(vm.data.showVerify, true);
  assert.deepEqual(vm.data.verifyMetrics.map((m) => m.label), ['待核销', '我已核销', '本场总人数']);
  assert.deepEqual(vm.data.verifyMetrics.map((m) => m.value), ['3', '1', '9']);
  assert.equal(vm.data.directorActive, false, '核销员不进导演台');
  assert.equal(vm.data.canManageSessions, false);
  assert.equal(vm.data.primary.text, '');
  vm.applyProjectionStatus.call(vm, 'CANCELLED');
  assert.equal(vm.data.showVerify, false, '取消场不开核销区(与 E-RPT-5 同语义)');
});

test('复查裁定:联席主理人/无合作单的主理人 canManageSessions 无 canDirect ⇒ 唯一一场也不进导演台,主键去场次管理', () => {
  const { vm, requests } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._manageStats = { canDirect: false, canManageSessions: true, canViewVerify: true };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702 }] });
  assert.equal(vm.data.directorActive, false, '不给必失败的导演台');
  assert.equal(vm._directorActivityId, undefined);
  assert.equal(vm.data.canManageSessions, true);
  assert.equal(vm.data.primary.text, '去选一场');
  assert.equal(requests.filter((r) => r.url === '/api/club/crm/topic-manage-stats').length, 0);
});

test('复查裁定:带 activityId 直进导演台但没有 canDirect ⇒ 不给开始/结束类主键', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9; vm._directorActivityId = 702;
  vm._manageStats = { canDirect: false, canManageSessions: true, canViewVerify: true };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702 }] });
  assert.equal(vm.data.primary.text, '');
  vm.applyProjectionStatus.call(vm, 'RUNNING');
  assert.equal(vm.data.primary.text, '', 'projection 回来也不补出「结束活动」');
  assert.equal(vm.data.showVerify, true, '核销区按 canViewVerify 照出');
  vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702 }] });
  assert.equal(vm.data.primary.text, '结束活动', '有 canDirect 才给');
});

test('复查补做:带 activityId 进来,导演台等 canDirect 下发才启动,且只启动一次;无 canDirect 不打导演台请求', () => {
  const staff = loadPage();
  staff.vm.onLoad({ topicId: '88', clubId: '9', activityId: '702' });
  assert.equal(staff.vm.data.directorActive, false, '身份未知时不进导演台');
  assert.equal(staff.vm._projectionLoads || 0, 0);
  staff.requests.find((r) => r.url === '/api/club/crm/topic-manage-stats')
    .success({ code: 200, data: { canDirect: false, canManageSessions: true, canViewVerify: true } });
  staff.requests.find((r) => r.url === '/api/topic/info-to-user')
    .success({ code: 200, data: { status: 1, isOwner: 0, name: 't', activityList: [{ id: 702 }] } });
  assert.equal(staff.vm.data.directorActive, false, '联席/核销员不进导演台');
  assert.equal(staff.vm._projectionLoads || 0, 0, '不打会被 requireClubOwner 拒掉的请求');

  const owner = loadPage();
  owner.vm.onLoad({ topicId: '88', clubId: '9', activityId: '702' });
  owner.requests.find((r) => r.url === '/api/topic/info-to-user')
    .success({ code: 200, data: { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702 }] } });
  owner.requests.find((r) => r.url === '/api/club/crm/topic-manage-stats')
    .success({ code: 200, data: { canDirect: true, canManageSessions: true, canViewVerify: true } });
  assert.equal(owner.vm.data.directorActive, true);
  assert.equal(owner.vm._projectionLoads, 1);
  owner.vm.applyDetail.call(owner.vm, owner.vm._lastRaw);
  assert.equal(owner.vm._projectionLoads, 1, '详情重放不重复启动导演台');
});

test('复查补做:projection 标了已取消,之后详情重放不把「已取消」冲回「已结束」', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9; vm._directorActivityId = 702;
  vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702 }] });
  vm.applyProjectionStatus.call(vm, 'CANCELLED');
  assert.equal(vm.data.statusText, '已取消');
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, name: 't', activityList: [{ id: 702 }] });
  assert.equal(vm.data.statusText, '已取消');
  assert.equal(vm.data.showVerify, false);
});

// 模拟回放发现(2026-09-17):核销员(canDirect=false、canViewVerify=true)不启导演台、拿不到 projection,
// statusKey 恒落 confirmed ⇒ 核销区恒不显示。修:读 topic-manage-stats 下发的本场真状态 sessionStatus。
function checkerPage(sessionStatus) {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._manageStats = { canDirect: false, canManageSessions: false, canViewVerify: true,
    pendingVerifyCount: 3, verifiedByMeCount: 1, sessionHeadcount: 18, sessionStatus };
  vm.applyDetail.call(vm, { status: 1, isOwner: 0, name: 't', activityList: [{ id: 702 }] });
  return vm;
}

test('核销员:本场进行中/已结束可见核销区,未开始/准备中/已取消/状态未知不可见', () => {
  for (const s of ['RUNNING', 'FINISHED']) {
    const vm = checkerPage(s);
    assert.equal(vm.data.showVerify, true, s + ' 时核销员必须看到核销区');
    assert.deepEqual(vm.data.verifyMetrics.map((m) => m.value), ['3', '1', '18']);
    assert.equal(vm.data.directorActive, false, '核销员仍不进导演台');
    assert.equal(vm.data.primary.text, '', '核销员仍不给导演台/管理主键');
  }
  for (const s of ['NOT_PREPARED', 'PREPARING', 'READY', 'CANCELLED', undefined, null, 'WHATEVER']) {
    assert.equal(checkerPage(s).data.showVerify, false, String(s) + ' 时不出核销区');
  }
});

test('核销员:审核中/未通过仍以审核态为准,sessionStatus=RUNNING 也不出核销区', () => {
  for (const raw of [{ status: 0, activityList: [] }, { status: 2, rejectReason: 'x', activityList: [] }]) {
    const { vm } = loadPage();
    vm._topicId = 88; vm._clubId = 9;
    vm._manageStats = { canDirect: false, canViewVerify: true, sessionStatus: 'RUNNING' };
    vm.applyDetail.call(vm, raw);
    assert.equal(vm.data.showVerify, false);
  }
});

test('负控:sessionStatus=RUNNING 但没有 canViewVerify ⇒ 不出核销区', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._manageStats = { canDirect: false, canViewVerify: false, sessionStatus: 'RUNNING' };
  vm.applyDetail.call(vm, { status: 1, isOwner: 0, activityList: [{ id: 702 }] });
  assert.equal(vm.data.showVerify, false);
});

test('主理人路径不回归:canDirect 只认导演台 projection,sessionStatus 不能提前放出核销区', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true, sessionStatus: 'RUNNING' };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, activityList: [{ id: 702 }] });
  assert.equal(vm.data.showVerify, false, 'projection 未到(还是未准备)不出核销区');
  vm.applyProjectionStatus.call(vm, 'RUNNING');
  assert.equal(vm.data.showVerify, true);
  vm.applyProjectionStatus.call(vm, 'CANCELLED');
  assert.equal(vm.data.showVerify, false);
});

test('自建主题(无合作单)主理人 canDirect=false:核销区同样按 sessionStatus,主键仍是场次管理出口', () => {
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._manageStats = { canDirect: false, canManageSessions: true, canViewVerify: true, sessionStatus: 'FINISHED' };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, activityList: [{ id: 702 }] });
  assert.equal(vm.data.showVerify, true, '已结束的场次主理人也要能看核销区(原来恒不显示)');
  assert.equal(vm.data.directorActive, false);
  assert.equal(vm.data.primary.text, '去选一场', '主键与状态胶囊不被 sessionStatus 改写');
  assert.equal(vm.data.statusKey, 'confirmed');
});

test('总控裁定:核销员胶囊文案跟 sessionStatus 显示,但主键/结算报告不放开', () => {
  const cases = [['RUNNING', '进行中', 'running'], ['FINISHED', '已结束', 'ended'], ['CANCELLED', '已取消', 'ended']];
  for (const [s, text, dot] of cases) {
    const vm = checkerPage(s);
    assert.equal(vm.data.statusText, text, s + ' 胶囊文案');
    assert.equal(vm.data.statusDisplayKey, dot, s + ' 胶囊圆点');
    assert.equal(vm.data.statusKey, 'confirmed', '决定主键的 statusKey 不被 sessionStatus 改写');
    assert.equal(vm.data.primary.text, '', '核销员不得因文案变了拿到结束活动/查看结算报告主键');
  }
  // 未知状态:胶囊回到按 statusKey 展示
  const unknown = checkerPage(null);
  assert.equal(unknown.data.statusDisplayKey, '');
  assert.equal(unknown.data.statusText, '已确认');
  const wxml = fs.readFileSync(WXML_PATH, 'utf8');
  assert.match(wxml, /ctd-head__status-dot--\{\{statusDisplayKey \|\| statusKey\}\}/, '圆点用展示态');
  // 主理人导演台路径的胶囊仍由 projection 决定
  const { vm } = loadPage();
  vm._topicId = 88; vm._clubId = 9;
  vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true, sessionStatus: 'FINISHED' };
  vm.applyDetail.call(vm, { status: 1, isOwner: 1, activityList: [{ id: 702 }] });
  assert.equal(vm.data.statusText, '已确认');
  vm.applyProjectionStatus.call(vm, 'RUNNING');
  assert.equal(vm.data.statusText, '进行中');
  assert.equal(vm.data.statusDisplayKey, '');
});
