/* HO-26 / 5.2 俱乐部「检查/修改集合时间」合同(2026-09-15 首版,09-15 随 cr423-52 撤出,09-17 按现 master 重做)
 *
 * 撤出原因「已售可改集合时间须与 publish-rules 第二段同行」已满足:后端 editOps 现有 CR-63 已售锁
 * (countOpenSaleRegistrations>0 拒改时间地点),本合同同时钉住这道闸与前端的「已售不可改」说明。
 *
 * 病:后端 /api/club/lead/edit-ops 早在(ApiClubLeadController.java:176-207,承接方领队可改
 *     集合时间/地点/结束时间/当日备注),小程序**零调用** —— 场次开出来集合钟点就改不了
 *     (ClubSessionServiceImpl 开场把 startDate 写成当天 00:00),玩家只能按零点算退款窗。
 * 治:导演台(活动详情页)接一格「集合时间」:显示值来自 /api/topic/info-to-user 的
 *     activityList.startDate(同一个 activity),修改走 edit-ops,成功回读,失败走结果半屏。
 *
 * 这条合同钉四件事:
 *   ① 显示的时间真的来自服务端 activityList,不是前端自己算的;
 *   ② 保存发的是**后端点名的那个**路径/方法/参数(改路径、改参数、少 activityId 都判红),
 *      且 startDate 是后端 DateUtils.parseDate 能吃的 "yyyy-MM-dd HH:mm:ss";
 *   ③ 成功必须回读(fetchDetail),不许本地先改;明确拒绝走失败半屏且原样带后端理由;
 *      5xx/传输层失败是「结果未知」,必须回读而不是断言「没改成」;
 *   ④ 负控:去掉后端那道领队闸、或把前端请求改成别的路径,上面的断言必须变红。
 */
process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PAGE = path.resolve(__dirname, '../../pages/club/topic-detail/index.js');
const WXML = path.resolve(__dirname, '../../pages/club/topic-detail/index.wxml');
const PAGE_SRC = fs.readFileSync(PAGE, 'utf8');
const SOLD_LOCK = /if \(touchesTimeOrPlace && cmsActivityService\.countOpenSaleRegistrations\(actId\) > 0\) \{\s*\n\s*return error\("该场次已售出，集合时间与地点不能修改；当日备注仍可改"\);/;
const JAVA = path.resolve(ROOT, '../chengyinhub-admin/src/main/java/com/chengyinhub/web/controller/api/ApiClubLeadController.java');

// 集合时间这一格只有在「带 activityId 的导演台态」才成立;测试统一从 topicId/clubId +
// 单场 activityList 进导演台,与真页面的自动进入路径一致。
// E-14(2026-09-16):只有管理身份才自动进导演台;release-0917 合 fix-club 后判据是 canDirect(见 openDirector)。
const RAW = {
  auditStatus: 3,
  isOwner: 1,
  activityList: [{ id: 702, startDate: '2026-09-20 14:30:00' }],
};

function applySetData(data, patch) {
  Object.keys(patch).forEach((key) => {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] == null || typeof target[parts[i]] !== 'object') target[parts[i]] = {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = patch[key];
  });
}

function loadPage() {
  const requests = [];
  const toasts = [];
  let pageConfig = null;
  const previous = {
    getApp: global.getApp, Page: global.Page, wx: global.wx, getCurrentPages: global.getCurrentPages,
  };
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest: (options) => { requests.push(options); },
    tips: (message) => { toasts.push(message); },
    getAuthorization: () => 'token',
  });
  global.Page = (config) => { pageConfig = config; };
  global.getCurrentPages = () => [{}];
  global.wx = {
    showToast: (o) => toasts.push(o && o.title),
    navigateTo: () => { }, navigateBack: () => { }, switchTab: () => { },
    getStorageSync: () => '', setStorageSync: () => { }, removeStorageSync: () => { },
    getSystemInfoSync: () => ({}), getWindowInfo: () => ({ windowWidth: 390 }),
  };
  delete require.cache[PAGE];
  try { require(PAGE); } finally {
    global.getApp = previous.getApp;
    global.Page = previous.Page;
    global.getCurrentPages = previous.getCurrentPages;
  }
  const vm = Object.assign({}, pageConfig, {
    setData(patch) { applySetData(this.data, patch); },
  });
  vm.data = JSON.parse(JSON.stringify(pageConfig.data));
  // 导演台投影走 adapter 发真请求,这里只验集合时间这一格,把它桩掉。
  vm.loadProjection = function () { this._projectionLoads = (this._projectionLoads || 0) + 1; };
  return { vm, requests, toasts };
}

function openDirector(raw) {
  const handle = loadPage();
  handle.vm._topicId = 88;
  handle.vm._clubId = 9;
  // release-0917 集成:fix-club-0917 拍板1 起,导演台身份只认 /api/club/crm/topic-manage-stats 下发的 canDirect
  //(isOwner 不再算数);这里按该接口的成功回包形状注入,集合时间这一格的合同本身不变。
  handle.vm._manageStats = { canDirect: true, canManageSessions: true, canViewVerify: true };
  handle.vm.fetchDetail();
  const read = handle.requests[0];
  assert.equal(read.url, '/api/topic/info-to-user', '集合时间的显示源必须是主题详情回包');
  read.success({ code: 200, data: raw || RAW });
  return handle;
}

test('查看:集合时间来自服务端 activityList.startDate,取不到合法时间就不给入口', () => {
  const { vm, requests } = openDirector();
  assert.equal(vm._directorActivityId, 702, '单场主题应自动进导演台');
  assert.equal(vm.data.opsTimeAvailable, true);
  assert.equal(vm.data.opsTimeText, '9月20日 14:30');
  assert.equal(requests[0].url, '/api/topic/info-to-user', '显示值必须真从服务端回读');

  const blank = openDirector({ auditStatus: 3, isOwner: 1, activityList: [{ id: 702, startDate: '' }] });
  assert.equal(blank.vm.data.opsTimeAvailable, false, '时间缺失时不许给一个会写错的入口');
  blank.vm.openOpsTimeSheet();
  assert.equal(blank.vm.data.opsTimeSheetVisible, false, '时间缺失时弹层也不该打开');
});

test('弹层预填:按当前集合时间拆成日期与时间两格', () => {
  const { vm } = openDirector();
  vm.openOpsTimeSheet();
  assert.equal(vm.data.opsTimeSheetVisible, true);
  assert.deepEqual(vm.data.opsTimeDraft, { date: '2026-09-20', time: '14:30' });
  assert.equal(vm.data.opsTimeSubmitting, false);
});

test('保存:POST /api/club/lead/edit-ops,只带 activityId + 秒级 startDate;成功回读并出成功半屏', () => {
  const { vm, requests } = openDirector();
  const before = requests.length;
  vm.openOpsTimeSheet();
  vm.onOpsTimeChange({ detail: { value: '16:05' } });
  vm.confirmOpsTime();

  assert.equal(requests.length, before + 1, '保存必须真发一次请求');
  const req = requests[before];
  assert.equal(req.url, '/api/club/lead/edit-ops', '路径必须与后端 @PostMapping("/edit-ops") 逐字一致');
  assert.equal(req.method, 'POST');
  assert.equal(req.header['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(req.data), { activityId: 702, startDate: '2026-09-20 16:05:00' },
    '参数名必须与后端 body.get("startDate") 对得上,且是 DateUtils.parseDate 能吃的秒级格式');

  req.success({ code: 200, msg: '已更新并报备发起人' });
  assert.equal(vm.data.opsTimeSheetVisible, false, '成功后弹层要收掉');
  assert.equal(vm.data.resultSheet.show, true);
  assert.equal(vm.data.resultSheet.kind, 'success');
  assert.equal(vm.data.resultSheet.title, '集合时间已更新');

  // 成功刷新 = 重新 fetchDetail + 用回读值更新显示,不是本地先改成新时间
  assert.equal(requests.length, before + 2, '成功后必须回读真源');
  const readback = requests[before + 1];
  assert.equal(readback.url, '/api/topic/info-to-user');
  readback.success({ code: 200, data: { auditStatus: 3, isOwner: 1, activityList: [{ id: 702, startDate: '2026-09-20 16:05:00' }] } });
  assert.equal(vm.data.opsTimeText, '9月20日 16:05');
});

test('失败提示:后端拒绝原样进失败半屏,不吞成通用句、不再多发一次回读', () => {
  const { vm, requests } = openDirector();
  const before = requests.length;
  vm.openOpsTimeSheet();
  vm.confirmOpsTime();
  requests[before].success({ code: 500, msg: '只有承接方领队可改运营详情' });

  assert.equal(vm.data.opsTimeSubmitting, false, '失败后必须解锁提交态');
  assert.equal(vm.data.opsTimeSheetVisible, false, '失败半屏不与编辑半屏叠着');
  assert.equal(vm.data.resultSheet.show, true);
  assert.equal(vm.data.resultSheet.kind, 'fail');
  assert.equal(vm.data.resultSheet.why, '只有承接方领队可改运营详情', '拒绝理由要原样给到主理人');
  assert.equal(requests.length, before + 1, '明确拒绝不必再回读');
});

test('结果未知:5xx / 传输层失败不当成「没改成」,失败半屏 + 回读服务端真相', () => {
  const abnormal = openDirector();
  let before = abnormal.requests.length;
  abnormal.vm.openOpsTimeSheet();
  abnormal.vm.confirmOpsTime();
  abnormal.requests[before].successStatusAbnormal({ msg: '服务暂时不可用' }, 502);
  assert.equal(abnormal.vm.data.resultSheet.kind, 'fail');
  assert.match(abnormal.vm.data.resultSheet.why, /结果待确认/);
  assert.equal(abnormal.requests[before + 1].url, '/api/topic/info-to-user', '5xx 必须回读,不许下「没改成」的结论');

  const refused = openDirector();
  before = refused.requests.length;
  refused.vm.openOpsTimeSheet();
  refused.vm.confirmOpsTime();
  refused.requests[before].successStatusAbnormal({ msg: '没有权限' }, 403);
  assert.equal(refused.vm.data.resultSheet.why, '没有权限');
  assert.equal(refused.requests.length, before + 1, '4xx 是明确拒绝,不需要回读');

  const offline = openDirector();
  before = offline.requests.length;
  offline.vm.openOpsTimeSheet();
  offline.vm.confirmOpsTime();
  offline.requests[before].fail({ errMsg: 'request:fail timeout' });
  assert.equal(offline.vm.data.resultSheet.kind, 'fail');
  assert.match(offline.vm.data.resultSheet.why, /网络异常/);
  assert.equal(offline.requests[before + 1].url, '/api/topic/info-to-user', '传输层失败同样回读');
});

test('页面接入:导演台区域有入口、有编辑半屏与结果半屏,不用新页面', () => {
  const wxml = fs.readFileSync(WXML, 'utf8');
  assert.match(wxml, /bindtap="openOpsTimeSheet"/);
  assert.match(wxml, /bindtap="confirmOpsTime"/);
  assert.match(wxml, /<cy-scene-sheet show="\{\{opsTimeSheetVisible\}\}" variant="half"[\s\S]*?cy-date-field[\s\S]*?<\/cy-scene-sheet>/, '编辑半屏沿用本页 cy-scene-sheet half + cy-date-field');
  assert.match(wxml, /已有人报名或下单的场次，集合时间和地点不能再改/, '已售不可改必须先说在前面,不能靠隐藏入口');
  assert.match(wxml, /<cy-result-sheet show="\{\{resultSheet.show\}\}"/, '结果必须走结果半屏');
  const json = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../pages/club/topic-detail/index.json'), 'utf8'));
  ['cy-scene-sheet', 'cy-date-field', 'cy-result-sheet'].forEach((name) => {
    assert.ok(json.usingComponents[name], '组件未登记:' + name);
  });
});

test('后端合同:edit-ops 仍是承接方领队专属,startDate 仍在白名单里', () => {
  const java = fs.readFileSync(JAVA, 'utf8');
  const mapping = /@PostMapping\("\/edit-ops"\)/.exec(java);
  assert.ok(mapping, '后端 /edit-ops 映射不见了 —— 前端这条请求会 404');
  const gate = /if \(!memberId\.equals\(st\.getLeaderMemberId\(\)\)\) return error\("只有承接方领队可改运营详情"\);/;
  assert.match(java, gate, '领队闸被放宽或改写 = 越权改运营详情,前端合同同时失效');
  assert.match(java, /upd\.setStartDate\(sd\)/, 'startDate 不在可改白名单里');
  assert.match(java, /DateUtils\.parseDate\(s\)/, '日期解析口径变了,前端的秒级格式要跟着改');
  // 9-15 裁决「已售锁时间地点」(CR-63):前端说明「已售不可改」、成功文案「按新集合时间算退款」都以这道闸为前提
  assert.match(java, SOLD_LOCK, '已售锁被删 = 已报名玩家的集合时间与退款窗会被悄悄挪走');
});

test('已售场次:后端拒改原文进失败半屏,主理人看得到为什么不能改', () => {
  const { vm, requests } = openDirector();
  const before = requests.length;
  vm.openOpsTimeSheet();
  vm.confirmOpsTime();
  requests[before].success({ code: 500, msg: '该场次已售出，集合时间与地点不能修改；当日备注仍可改' });
  assert.equal(vm.data.resultSheet.kind, 'fail');
  assert.equal(vm.data.resultSheet.why, '该场次已售出，集合时间与地点不能修改；当日备注仍可改');
  assert.equal(vm.data.opsTimeSubmitting, false);
});

test('负控:旧闸/错误路径/去掉领队闸时,上面的断言必须判红', () => {
  // ① 前端把路径写错(或后端改名),契约断言必须失败
  const wrongPath = PAGE_SRC.replace("url: '/api/club/lead/edit-ops'", "url: '/api/club/lead/edit-ed-ops'");
  assert.notEqual(wrongPath, PAGE_SRC, '变异没生效:路径形状已漂移,这个负控在空转');
  assert.throws(() => assert.match(wrongPath, /url: '\/api\/club\/lead\/edit-ops', method: 'POST'/), assert.AssertionError);

  // ② 成功不回读(本地先改)必须判红
  const noReadback = PAGE_SRC.replace('that.fetchDetail(); // 回读真源:新时间从 activityList 重新取,不在本地先改', '');
  assert.notEqual(noReadback, PAGE_SRC, '变异没生效:回读那一行已漂移,这个负控在空转');
  assert.throws(() => assert.match(noReadback, /that\.fetchDetail\(\); \/\/ 回读真源/), assert.AssertionError);

  // ③ 后端领队闸若被删,合同断言必须失败
  const java = fs.readFileSync(JAVA, 'utf8');
  const gate = /if \(!memberId\.equals\(st\.getLeaderMemberId\(\)\)\) return error\("只有承接方领队可改运营详情"\);/;
  const loosened = java.replace(gate, '');
  assert.notEqual(loosened, java, '变异没生效:领队闸形状已漂移,这个负控在空转');
  assert.throws(() => assert.match(loosened, gate), assert.AssertionError);

  // ④ 已售锁被删,合同断言必须失败
  const unlocked = java.replace(SOLD_LOCK, 'if (false) {');
  assert.notEqual(unlocked, java, '变异没生效:已售锁形状已漂移,这个负控在空转');
  assert.throws(() => assert.match(unlocked, SOLD_LOCK), assert.AssertionError);
});
