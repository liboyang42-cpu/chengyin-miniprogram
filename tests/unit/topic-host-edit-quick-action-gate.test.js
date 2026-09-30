process.env.TZ = 'UTC';

const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * 主办方「编辑」入口必须听后端的 host.canEdit。
 *
 * 背景(2026-08-18,U4 门禁 C 类扫出来的):
 *   merchantinfo.js:1103 把 /api/project/home 的 host.canEdit 存进 data.hostCanEdit,
 *   merchantinfo.wxml:28 又把它当 prop 传给 <project-host>,而 project-host 组件里
 *   **一处都没读过**——这个资格闸从头到尾没通电,「编辑」格恒显示恒可点。
 *
 * 判据(为什么是接上而不是删掉,见 /tmp/tandianri_u4_c_class_fix_20260818.md):
 *   后端 ProjectHomeReadServiceImpl.buildHost() 现在硬编码 canEdit=TRUE,注释写明真闸
 *   「另案实现」。所以今天接不接都看不出区别;但后端哪天把它改成条件值,前端不接就是
 *   静默越权。闸接在**页面的 buildQuickActions**,不接在组件里:决定"给不给入口"的
 *   身份/资格判断本来就在页面这一层(role / ownerType 都在这判),组件只负责渲染列表。
 *   ⇒ project-host 的 hostCanEdit prop 是接错了层,应删;能力搬到 buildQuickActions。
 */
const PAGE = '../../pages/topic/merchantinfo/merchantinfo.js';
const HOST_WXML = path.resolve(__dirname, '../../pages/topic/components/project-host/index.wxml');
const HOST_JS = path.resolve(__dirname, '../../pages/topic/components/project-host/index.js');
const PAGE_WXML = path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.wxml');

let pageConfig;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 1,
  sendRequest: () => {},
  tips: () => {},
});
global.wx = {
  navigateTo: () => {}, reLaunch: () => {}, showToast: () => {}, showLoading: () => {},
  hideLoading: () => {}, navigateBack: () => {}, openLocation: () => {}, pageScrollTo: () => {},
  showModal: () => {},
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch) => {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('.') < 0) { page.data[k] = patch[k]; return; }
      const parts = k.split('.');
      let cur = page.data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = patch[k];
    });
  };
  return page;
}

const keys = (list) => list.map((a) => a.key);

// 2026-09-05「编辑」改名「更多」:抽屉里除了编辑二选一还有章节控制与本站运营,
// 那两组跟编辑资格无关,所以 canEdit=false 不再吞掉整颗按钮 —— 闸从「给不给按钮」
// 下移到「抽屉里那一行可不可点」。保护目标没变:后端说不能改,前端就不能给可用入口。
test('主办方没有编辑资格时,更多格照常出现,但抽屉里的「票价与主题内容」置灰', () => {
  const page = makePage();
  assert.deepEqual(keys(page.buildQuickActions('host', 'merchant', false)), ['club', 'merchant', 'customer', 'more']);
  // 俱乐部主办没有「俱乐部」格,这条既有规则不能被顺手改坏
  assert.deepEqual(keys(page.buildQuickActions('host', 'club', false)), ['merchant', 'customer', 'more']);

  page.data.role = 'host';
  page.openMoreSheet();
  const topicRow = page.findMoreRow('topic');
  assert.equal(topicRow.disabled, true, '后端说不能改,这一行还可点');
  assert.equal(topicRow.tag, '不可用');
  // 章节控制不受编辑资格影响,不能被顺手一起关掉
  assert.ok(page.findMoreRow('chapterOpen'), '章节控制被编辑资格误伤了');
});

test('主办方有编辑资格时,抽屉里那一行可点', () => {
  const page = makePage();
  assert.deepEqual(keys(page.buildQuickActions('host', 'merchant', true)), ['club', 'merchant', 'customer', 'more']);
  assert.deepEqual(keys(page.buildQuickActions('host', 'club', true)), ['merchant', 'customer', 'more']);

  page.data.role = 'host';
  page.openMoreSheet();
  assert.ok(!page.findMoreRow('topic').disabled, '后端说能改,这一行反而点不了');
});

test('承接方的更多格与 host.canEdit 无关(它的闸是 canEditRegistration)', () => {
  const page = makePage();
  assert.deepEqual(keys(page.buildQuickActions('join', 'merchant', false)), ['scan', 'club', 'customer', 'more']);
});

test('applyHome 把后端 host.canEdit 真的接进抽屉那一行', () => {
  const denied = makePage();
  denied.applyHome({ topic: {}, host: { ownerType: 'merchant', canEdit: false } });
  denied.data.role = 'host';
  denied.openMoreSheet();
  assert.equal(denied.findMoreRow('topic').disabled, true, '后端说不能改,编辑那一行还可点');

  const allowed = makePage();
  allowed.applyHome({ topic: {}, host: { ownerType: 'merchant', canEdit: true } });
  allowed.data.role = 'host';
  allowed.openMoreSheet();
  assert.ok(!allowed.findMoreRow('topic').disabled, '后端说能改,那一行反而点不了');

  // 后端漏发字段时保守放行:真正的拦截在后端(主题更新接口),前端置灰只是省一次无效跳转,
  // 因此不能因为字段缺失就把主办方的编辑能力整个吞掉。
  const missing = makePage();
  missing.applyHome({ topic: {}, host: { ownerType: 'merchant' } });
  missing.data.role = 'host';
  missing.openMoreSheet();
  assert.ok(!missing.findMoreRow('topic').disabled, '后端没发 canEdit 时不该置灰');
});

// 负控:把闸拆掉(buildMoreGroups 无视 _hostCanEdit)必须让上面几条变红 ——
// 这一条断言 disabled 真的由 _hostCanEdit 决定,不是恒 false 的摆设。
test('负控:闸真的通电,_hostCanEdit 变化会改变那一行的可点性', () => {
  const page = makePage();
  page.data.role = 'host';
  page.buildQuickActions('host', 'merchant', false);
  page.openMoreSheet();
  const off = page.findMoreRow('topic').disabled;
  page.buildQuickActions('host', 'merchant', true);
  page.openMoreSheet();
  const on = page.findMoreRow('topic').disabled;
  assert.notEqual(off, on, 'canEdit 翻转没有改变这一行 —— 闸没通电');
});

test('hostCanEdit 不再当 prop 传给 project-host(决策在页面层,组件只渲染)', () => {
  assert.ok(!fs.readFileSync(PAGE_WXML, 'utf8').includes('hostCanEdit'),
    'merchantinfo.wxml 还在往 project-host 传 hostCanEdit');
  assert.ok(!fs.readFileSync(HOST_JS, 'utf8').includes('hostCanEdit'),
    'project-host 还声明着零消费的 hostCanEdit');
  assert.ok(!fs.readFileSync(HOST_WXML, 'utf8').includes('hostCanEdit'),
    'project-host 的 wxml 里出现了 hostCanEdit');
});

/* ⑧ 段那四行(这一站怎么接待 / 服务时段与接待容量 / 本站复盘 / 暂停接待)是**接线**,
   不是四个新页面 —— Figma 469:1002 / 469:1025 / 469:1087 / 281:494 逐段对应现码
   pages/merchant/game-node 的「本站执行卡」「准备清单 + 服务时段与接待容量」
   「本站复盘」「暂停信息 + 暂停接待 sheet」。这几条断言守的是:
   ① 四行都真的走出去了,不能再退回 toast「这一项还没做」;
   ② 中转必须走 /api/game/session/merchant/entries 取 activityId ——
      承接页自己的 upcoming-runs 给的是 ticketId(OmsTicket),不是 CmsActivity.id,
      拿它拼 URL 会打开别人的场次或空页;
   ③ 没有场次时说「还没开出场次」,不能当成错误,也不能静默。 */
test('更多里的本站四行都跳 game-node，且 activityId 取自 merchant/entries 按 topicId 过滤', () => {
  const requests = [];
  const navigations = [];
  const tips = [];
  const sheets = [];
  // 页面模块顶层 const app = getApp() 只求值一次 —— 必须先钉住这个对象再重新 require,
  // 否则改的是另一个一次性的 getApp() 返回值,页面根本看不到。
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    sendRequest: (options) => { requests.push(options); },
    tips: (message) => { tips.push(message); },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  };
  const realGetApp = global.getApp;
  global.getApp = () => app;
  // 零场次说明走 utils/modal(CU-M-21),按模块缓存钉住,记下弹了什么
  const modals = [];
  const modalPath = require.resolve('../../utils/modal.js');
  const realModal = require.cache[modalPath];
  require.cache[modalPath] = { id: modalPath, filename: modalPath, loaded: true,
    exports: { show: (options) => { modals.push(options); } } };
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  if (realModal) require.cache[modalPath] = realModal; else delete require.cache[modalPath];
  const page = makePage();
  global.getApp = realGetApp;
  page.data.topicId = 77;
  global.wx.navigateTo = (options) => { navigations.push(options.url); };
  global.wx.showActionSheet = (options) => { sheets.push(options); };

  // 单场次:直接进,不多问一步
  page.goStation('howto');
  assert.equal(requests[0].url, '/api/game/session/merchant/entries');
  requests[0].success({ code: 200, data: [
    { activityId: 9, topicId: 77, activityName: '周六场' },
    { activityId: 8, topicId: 999, activityName: '别的主题,不能混进来' },
  ] });
  requests[0].complete();
  assert.deepEqual(navigations, ['/pages/merchant/game-node/index?activityId=9']);

  // pause 那一行带 focus=pause:抽屉里点的就是这件事,不该让人到了那页再找一次按钮
  page.goStation('pause');
  requests[1].success({ code: 200, data: [{ activityId: 9, topicId: 77, activityName: '周六场' }] });
  requests[1].complete();
  assert.equal(navigations[1], '/pages/merchant/game-node/index?activityId=9&focus=pause');

  // 多场次:先选场次
  page.goStation('service');
  requests[2].success({ code: 200, data: [
    { activityId: 9, topicId: 77, activityName: '周六场' },
    { activityId: 10, topicId: 77, activityName: '周日场' },
  ] });
  requests[2].complete();
  // 2026-09-10 合流 master:系统 ActionSheet 收编成 cy-option-sheet,
  // 断言跟着搬到页面数据上;钉的性质没变 —— 多场次必须先问一次,选中的那个 id 要送对。
  assert.deepEqual(page.data.stationSheetItems, ['周六场', '周日场']);
  assert.equal(page.data.stationSheetShow, true);
  page.onStationSheetSelect({ detail: { index: 1 } });
  assert.equal(page.data.stationSheetShow, false, '选完要收起来');
  assert.equal(navigations[2], '/pages/merchant/game-node/index?activityId=10');

  // 没有场次:说清楚是「还没开出场次」,既不跳空页也不静默
  page.goStation('review');
  requests[3].success({ code: 200, data: [] });
  requests[3].complete();
  assert.equal(navigations.length, 3, '没有场次却还是跳了出去');
  // CU-M-21:从 2 秒 toast 改成要点「知道了」的说明,点完不再像没反应
  assert.match(modals[modals.length - 1].title, /还没有可接待的场次/);
});

test('★负控:四行退回 toast 或改用 upcoming-runs 的 ticketId 都要判红', () => {
  const source = fs.readFileSync(path.resolve(__dirname, PAGE), 'utf8');
  const body = source.slice(source.indexOf('onMorePick('), source.indexOf('\n  findMoreRow('));
  // CU-C-68(2026-09-24 走查):这一组前面多了一道「本人是否同时以商家身份承接本站」的搪,
  // 主办方账号不再被放进来撞后端;走出去这一步本身不变 —— 仍然必须 return this.goStation(key)。
  assert.match(body, /key === 'howto' \|\| key === 'service' \|\| key === 'review' \|\| key === 'pause'\)\s*\{[\s\S]{0,400}?return this\.goStation\(key\)/,
    '这四行必须真的走出去,不能退回 toast');
  assert.match(body, /_stationOperable !== true[\s\S]{0,80}?app\.tips/, '主办方没承接本站时要在本地就拦下并说明');
  const station = source.slice(source.indexOf('goStation(focus)'), source.indexOf('openStation(activityId'));
  assert.doesNotMatch(station, /ticketId/, 'game-node 要 CmsActivity.id,拿 ticketId 会开错场次');
  assert.match(station, /game\/session\/merchant\/entries/);
});

/* 主办方那三行:「邀请其他商家」有现成入口(本页 goInviteMerchant → coop/nearby),接线;
   「开放报名」「结束本章」小程序端没有写接口(全仓只有读 recruitStatus 的那条),
   所以给的是「要在后台改」而不是含糊的「还没做」—— 后者会让人一直等一个不会来的功能。 */
test('主办方章节控制:邀请其他商家真的走出去,结束本章走危险确认', () => {
  const navigations = [];
  const page = makePage();
  page.data.topicId = 42;
  page.data.info = { topicName: '苏州河的回声' };
  page.data.moreSheet = { show: true, groups: [] };
  global.wx.navigateTo = (options) => { navigations.push(options.url); };

  page.onMorePick({ currentTarget: { dataset: { key: 'chapterInvite' } } });
  assert.match(navigations[0], /^\/pages\/coop\/nearby\/index\?topicId=42/);

  /* 2026-09-10 用户定「只有发起人能点」⇒ 端点补上了(/api/topic/chapter/finish)。
     这一行从「弹一句后台改」换成真动作,但它是**不可逆写**:必须走 cy-danger-confirm
     三段式,不能是一个 showModal 点确定就写。 */
  const opened = [];
  page.selectComponent = () => ({ open: (key, params) => opened.push({ key, params }) });
  page._hostChapters = [{ id: 7, name: '第一章', recruitEnabled: 1 }];
  page.onMorePick({ currentTarget: { dataset: { key: 'chapterFinish' } } });
  assert.equal(navigations.length, 1, '结束本章不该跳到任何地方');
  assert.deepEqual(opened.map((o) => o.key), ['topic.chapter.finish'],
    '不可逆写必须走登记过的危险确认 key,文案由 utils/danger-actions.js 出');

  // 已结束的再点一次:不再开确认层(端点那边也会拒,这里只是不让人白走一遍)
  opened.length = 0;
  page._hostChapters = [{ id: 7, name: '第一章', finishTime: '2026-09-10 12:00:00' }];
  page.onMorePick({ currentTarget: { dataset: { key: 'chapterFinish' } } });
  assert.equal(opened.length, 0, '已结束的章节不该再弹确认');
});

/* 结束是不可逆的,所以结束之后「开放报名」那一行必须是死的 ——
   否则「结束」就退化成一个可以来回拨的招商开关(后端也拒,这里是同一条规则的前端一半)。 */
test('本章结束后,开放报名与邀请商家两行都锁死', () => {
  const page = makePage();
  page._hostChapters = [{ id: 7, name: '第一章', recruitEnabled: 1, finishTime: '2026-09-10 12:00:00' }];
  assert.equal(page.chapterFinished(), true);
  assert.match(page.chapterRecruitSub(), /已结束/);
  assert.equal(page.chapterRecruitTag(), '已结束');
  assert.equal(page.chapterRecruitTagKind(), '', '已结束不该继续显示成「开」的绿标签');
});

/* 稿 468:1126「开放报名」= 开放**商家承接**这一章(2026-09-10 用户确认),
   落 cms_topic_chapter.recruit_enabled。这条钉三件事:
   ① 点下去真的发请求,不是弹一个「后台改」;
   ② 发的是当前状态的**反面**(开着就关、关着就开);
   ③ 一条业务规则都不在前端判 —— 服务层 updateCmsTopicChapter 有一整套约束
      (已有申请/供给时不许关、条款档、容量、父主题状态),前端自己先判一遍就会分叉。 */
test('开放报名是真开关:发 chapter/recruit、取反、规则全交服务层', () => {
  const requests = [];
  const tips = [];
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    sendRequest: (options) => { requests.push(options); },
    tips: (message) => { tips.push(message); },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  };
  const realGetApp = global.getApp;
  global.getApp = () => app;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const page = makePage();
  global.getApp = realGetApp;

  page.data.role = 'host';
  page.data.topicId = 42;
  page.data.moreSheet = { show: true, groups: [] };
  page._hostChapters = [{ id: 7, name: '第一章', recruitEnabled: 1 }];

  page.onMorePick({ currentTarget: { dataset: { key: 'chapterOpen' } } });
  assert.equal(requests.length, 1, '点下去必须真发请求');
  assert.equal(requests[0].url, '/api/topic/chapter/recruit');
  assert.equal(requests[0].data.chapterId, 7);
  assert.equal(requests[0].data.enabled, 0, '当前是开,点一下要关');

  // 服务层拒绝时,理由原样回显 —— 「操作失败」四个字帮不了主办方
  requests[0].success({ code: 500, msg: '章节已有 3 条商家申请，不能关闭商家承接' });
  requests[0].complete();
  assert.match(tips[tips.length - 1], /已有 3 条商家申请/);

  // 闸放在 complete:失败一次之后还要能再点
  page.onMorePick({ currentTarget: { dataset: { key: 'chapterOpen' } } });
  assert.equal(requests.length, 2, '失败一次后这个开关不能永久点不动');
});

/* ★负控:章节还没拉到时不许猜状态 —— 写错一个字,主办方会照着它做相反的决定。 */
test('章节没拉到时「开放报名」不带开/关标签,也点不动', () => {
  const requests = [];
  const tips = [];
  // 页面模块顶层 const app = getApp() 只求值一次 —— 必须先钉住这个对象再重新 require
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    sendRequest: (options) => { requests.push(options); },
    tips: (message) => { tips.push(message); },
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  };
  const realGetApp = global.getApp;
  global.getApp = () => app;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const page = makePage();
  global.getApp = realGetApp;

  page.data.role = 'host';
  page._hostChapters = null;
  assert.equal(page.chapterRecruitTag(), '', '状态未知时不许显示「开」或「关」');

  page.toggleChapterRecruit();
  assert.equal(requests.length, 0, '状态未知时不许凭空发一个 enabled 出去');
  assert.match(tips[0] || '', /还没读到章节/);
});

/* CU-M-185:这一行改的是 cms_topic_chapter.recruit_enabled(商家来申请承接),
   标题却写「开放报名」,主办方读成开放玩家买票。
   CU-M-186:一章都没有时 disabled 只由 chapterFinished() 决定 ⇒ 两行照旧可点,
   点完抽屉静默关掉,只留一句「还没读到章节,稍后再试」。 */
test('章节控制:标题按真做的事写,没有章节时两行灰掉并给出下一步', () => {
  const page = makePage();
  page.data.role = 'host';

  page._hostChapters = [];
  page.openMoreSheet();
  const open = page.findMoreRow('chapterOpen');
  assert.equal(open.label, '开放商家承接申请', '不得再写「开放报名」');
  assert.equal(open.disabled, true, '没有章节时这一行没有可操作对象');
  assert.equal(open.tag, '需章节');
  assert.match(open.sub, /先在「票价与主题内容」里添加一章/, '禁用要说清下一步');
  const finish = page.findMoreRow('chapterFinish');
  assert.equal(finish.disabled, true, '没有章节时「结束本章」同样不能点');
  assert.match(finish.sub, /添加一章/);

  // 章节还没读回来时不许编一句「还没有章节」骗主办方去建第二章
  page._hostChapters = null;
  page.openMoreSheet();
  assert.match(page.findMoreRow('chapterOpen').sub, /章节还没读到/);
  assert.equal(page.findMoreRow('chapterOpen').disabled, true);

  // 有章节时恢复原语义:开关照旧、文案照旧
  page._hostChapters = [{ id: 7, name: '第一章', recruitEnabled: 0 }];
  page.openMoreSheet();
  const back = page.findMoreRow('chapterOpen');
  assert.equal(back.disabled, false);
  assert.equal(back.tag, '关');
  assert.match(back.sub, /商家在合作中心看不到这一章/);
  assert.match(page.findMoreRow('chapterFinish').sub, /结束后商家不能再申请承接本章/);
});

test('★负控:把无章节时的 disabled 摘掉,CU-M-186 契约会变红', () => {
  const page = makePage();
  page.data.role = 'host';
  page._hostChapters = [];
  page.openMoreSheet();
  assert.equal(page.findMoreRow('chapterFinish').disabled, true);
  page.chapterFinished = () => false;
  page.noChapter = () => false;   // 退回旧判据(只看是否已结束)
  page.openMoreSheet();
  assert.equal(page.findMoreRow('chapterFinish').disabled, false,
    '旧判据下无章节仍可点 —— 这正是 CU-M-186 的现象');
});
