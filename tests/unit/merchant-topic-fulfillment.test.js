process.env.TZ = 'UTC';

const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { toTimestamp, chinaDayStart, chinaParts } = require('../../utils/datetime');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = '../../pages/topic/merchantinfo/merchantinfo.js';
const PAGE_WXML = path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.wxml');
const PAGE_JSON = path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.json');
// 承接视图 2026-08-04 拆成组件;页面只剩浏览视图和组件调用,断言跟着搬到组件上
const WXML = path.resolve(__dirname, '../../pages/topic/components/project-join/index.wxml');
const HOST_WXML = path.resolve(__dirname, '../../pages/topic/components/project-host/index.wxml');

let pageConfig;
let navigations;
let relaunches;
let toasts;
let requests;
let downloads;
let saves;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 1,
  sendRequest: (options) => { requests.push(options); return { abort() {} }; },
  tips: (msg) => toasts.push({ title: msg }),
});
global.wx = {
  navigateTo: (options) => navigations.push(options),
  reLaunch: (options) => relaunches.push(options),
  showToast: (options) => toasts.push(options),
  showLoading: () => {},
  hideLoading: () => {},
  navigateBack: () => {},
  openLocation: () => {},
  pageScrollTo: () => {},
  showModal: () => {},
  downloadFile: (options) => { downloads.push(options); },
  saveImageToPhotosAlbum: (options) => { saves.push(options); },
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  navigations = [];
  relaunches = [];
  toasts = [];
  requests = [];
  downloads = [];
  saves = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  // 真 setData 认 'a.b' 这种路径写法;桩不认的话会静默塞一个字面量键名,
  // 页面读 data.a.b 永远读不到 —— 那是桩的假绿,不是代码的问题。
  page.setData = (patch) => {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('.') < 0) { page.data[k] = patch[k]; return; }
      const path = k.split('.');
      let cur = page.data;
      for (let i = 0; i < path.length - 1; i++) {
        if (cur[path[i]] == null || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
        cur = cur[path[i]];
      }
      cur[path[path.length - 1]] = patch[k];
    });
  };
  return page;
}

/** 相对今天造日期,避免测试跟着日历过期 */
function daysFromToday(days) {
  const d = chinaParts(chinaDayStart(Date.now()) + days * 86400000);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.year}-${pad(d.month)}-${pad(d.day)} 00:00:00`;
}

test('F-47 merchantinfo 在组件调用边界把可空 String/Array 属性归一为声明类型', () => {
  const pageWxml = fs.readFileSync(PAGE_WXML, 'utf8');
  const joinWxml = fs.readFileSync(WXML, 'utf8');
  const hostWxml = fs.readFileSync(HOST_WXML, 'utf8');

  assert.match(pageWxml, /assignedNodeText="\{\{ assignedNodeText \|\| '' \}\}"/,
    'project-join 的 String 属性不能在首屏收到 null');
  assert.match(joinWxml, /subtitle="\{\{ moreSheet\.subtitle \|\| '' \}\}"/,
    '承接方更多抽屉的 subtitle 必须在传入 project-drawer 前归一');
  assert.match(hostWxml, /subtitle="\{\{ moreSheet\.subtitle \|\| '' \}\}"/,
    '主办方更多抽屉的 subtitle 必须在传入 project-drawer 前归一');
  assert.match(joinWxml, /title="\{\{ nodeSheet\.name \|\| '' \}\}"/,
    '节点抽屉的 title 必须在传入 project-drawer 前归一');
  assert.match(joinWxml, /actions="\{\{ nodeSheet\.actions \|\| \[\] \}\}"/,
    '节点抽屉的 actions 必须在传入 project-drawer 前归一为数组');
});

test('F-48 formatDateMd 不依赖 iOS 不兼容的 yyyy-MM-dd HH:mm:ss 隐式解析', () => {
  const page = makePage();
  const NativeDate = Date;
  class IOSDate extends NativeDate {
    constructor(...args) {
      if (args.length === 1 && typeof args[0] === 'string'
          && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(args[0])) {
        super(NaN);
        return;
      }
      super(...args);
    }
    static parse(value) { return NativeDate.parse(value); }
    static now() { return NativeDate.now(); }
    static UTC(...args) { return NativeDate.UTC(...args); }
  }

  global.Date = IOSDate;
  try {
    assert.equal(page.formatDateMd('2026-09-26 18:30:00'), '9.26');
    assert.equal(page.formatDateMd('2026-02-30 18:30:00'), '',
      '非法日历日期必须 fail closed，不能显示 NaN.NaN');
  } finally {
    global.Date = NativeDate;
  }
});

test('待审核的承接显示审核中，而不是直接当成已确认', () => {
  const page = makePage();
  page.processData({ status: 0, topicStartDate: daysFromToday(10) });

  assert.equal(page.data.stateKey, 'pending');
  assert.equal(page.data.stateText, '审核中');
});

test('被驳回时把驳回原因显示出来', () => {
  const page = makePage();
  page.processData({ status: 3, auditStatus: 2, reason: '资质材料不全' });

  assert.equal(page.data.stateKey, 'rejected');
  assert.equal(page.data.stateSub, '资质材料不全');
});

test('已通过未开始时显示倒计时天数', () => {
  const page = makePage();
  page.processData({ status: 1, topicStartDate: daysFromToday(5), topicEndDate: daysFromToday(9) });

  assert.equal(page.data.stateKey, 'confirmed');
  assert.equal(page.data.stateSub, '还有 5 天');
});

test('开始日到了就是进行中，主动作是去核销', () => {
  const page = makePage();
  page.processData({ status: 1, topicStartDate: daysFromToday(-1), topicEndDate: daysFromToday(3) });

  assert.equal(page.data.stateKey, 'running');
  assert.equal(page.data.primaryAction, 'verify');

  page.onPrimaryTap();
  assert.equal(relaunches.length, 1, '核销流程在商家首页，这里只做交接不复制一份');
});

test('UTC 下商家报名截止到中国自然日 24 点，跨日后才结束', () => {
  const page = makePage();
  page.data.info = {
    merchantSignUpStartDate: '2026-08-03',
    merchantSignUpEndDate: '2026-08-03',
    merchantStatus: 1,
    productType: 1,
    memberId: 999,
    isSignUp: 0,
  };
  const realNow = Date.now;
  try {
    Date.now = () => toTimestamp('2026-08-03 23:59:59.999');
    page.bmClick2();
    assert.equal(page.data.topicShow, true, '中国当天最后一毫秒仍可报名');

    page.data.topicShow = false;
    Date.now = () => toTimestamp('2026-08-04 00:00:00');
    page.bmClick2();
    assert.equal(page.data.topicShow, false, '中国次日零点不得再打开报名流程');
    assert.equal(toasts.at(-1).title, '商家报名已结束');
  } finally {
    Date.now = realNow;
  }
});

/**
 * ★ 这条是修 P0-4 的核心:后端 cancelByMerchant 只拦 auditStatus==1,
 * 前端原来按「距开始≥3天」显示取消按钮 —— 中标商家点下去必报错。
 */
test('已中标不给取消按钮，只能联系客服（后端必拒，不假装能退）', () => {
  const page = makePage();
  page.processData({ status: 1, auditStatus: 1, topicStartDate: daysFromToday(30) });

  assert.equal(page.data.primaryAction, 'service');
  assert.equal(page.data.primaryText, '联系客服申请退出');
});

test('未中标可以自行取消，距开始多久都不影响（口径以后端为准）', () => {
  const page = makePage();
  page.processData({ status: 1, auditStatus: 0, topicStartDate: daysFromToday(1) });

  assert.equal(page.data.primaryAction, 'cancel');
});

/**
 * 核销三格从「开始接待」那天起才有意义。稿 88:4368(M3 已确认未开始)上没有这一块 ——
 * 还没开场时三个数必然是 0/0/N,摆在首屏只会让商家以为自己漏了什么没核销;
 * 被驳回的更不该看到,那是「在等团来」的假象。
 */
test('核销三格只在开始接待之后出现', () => {
  const pending = makePage();
  pending.processData({ status: 0 });
  assert.equal(pending.data.showFulfillment, false);

  const rejected = makePage();
  rejected.processData({ status: 2, reason: 'x' });
  assert.equal(rejected.data.showFulfillment, false);

  const confirmed = makePage();
  confirmed.processData({ status: 1, topicStartDate: daysFromToday(3) });
  assert.equal(confirmed.data.showFulfillment, false, '已确认但没开场,核销数还没有意义');

  const running = makePage();
  running.processData({ status: 1, topicStartDate: daysFromToday(-1), topicEndDate: daysFromToday(5) });
  assert.equal(running.data.showFulfillment, true);

  const ended = makePage();
  ended.processData({ status: 1, topicStartDate: daysFromToday(-9), topicEndDate: daysFromToday(-2) });
  assert.equal(ended.data.showFulfillment, true, '已结束仍要能回看这一站接了多少人');
});

/**
 * 「开场前要准备」从「已确认」起才出。稿 88:4014(M1 审核中)上没有这一块:
 * 这一步能不能开场还没定,先催他备料是把没落地的事当成已落地。
 * 驳回/已结束同样不用再配。
 */
test('开场前要准备只在已确认与进行中出现', () => {
  const pending = makePage();
  pending.processData({ status: 0 });
  assert.equal(pending.data.showPrep, false, '审核中还没定下来,不催备料');

  const confirmed = makePage();
  confirmed.processData({ status: 1, topicStartDate: daysFromToday(3) });
  assert.equal(confirmed.data.showPrep, true);

  const running = makePage();
  running.processData({ status: 1, topicStartDate: daysFromToday(-1), topicEndDate: daysFromToday(5) });
  assert.equal(running.data.showPrep, true);

  const rejected = makePage();
  rejected.processData({ status: 2, reason: 'x' });
  assert.equal(rejected.data.showPrep, false, '已驳回不用再配');

  const ended = makePage();
  ended.processData({ status: 1, topicStartDate: daysFromToday(-9), topicEndDate: daysFromToday(-2) });
  assert.equal(ended.data.showPrep, false, '已结束不用再配');
});

/** 章节与节点是两件不同的事实,原来 chapterName || nodeName 会让有章节时看不见点位。 */
test('章节与节点同时下发时两个都要显示,不互相顶替', () => {
  const page = makePage();

  page.processData({ status: 1, chapterName: '夜航咖啡', nodeName: '第三站' });
  assert.equal(page.data.assignedLabel, '承接的章节');
  assert.equal(page.data.assignedValue, '夜航咖啡');
  assert.equal(page.data.assignedNodeText, '第三站', '章节占主行时,节点必须还有自己的一行');

  const page2 = makePage();
  page2.processData({ status: 1, nodeName: '第三站' });
  assert.equal(page2.data.assignedLabel, '承接的节点');
  assert.equal(page2.data.assignedValue, '第三站');
  assert.equal(page2.data.assignedNodeText, '', '只有节点时它已占主行,不重复成两行');

  const page3 = makePage();
  page3.processData({ status: 1, chapterName: '夜航咖啡' });
  assert.equal(page3.data.assignedValue, '夜航咖啡');
  assert.equal(page3.data.assignedNodeText, '');
});

/** 原来整页只有一行模板名,商家不知道玩家到店会跟他做什么、要准备什么。 */
test('玩法/奖励/准备三块由 templateDetail 驱动，没有就整块不出', () => {
  const tpl = {
    title: '暗号对答', imgUrl: 'https://cdn/game.png',
    description: '说暗号换线索卡', ruleInstructions: '一次只发一张', storyText: '1937 年的苏州河边',
    players: '2-6 人', duration: 25, difficulty: '中等',
    requiredMaterials: '线索卡 20 张、印章 1 枚',
    validationMethod: 1, medalName: '霓虹电报员', xpValue: 120,
  };

  const page = makePage();
  page.processData({ status: 1, templateDetail: tpl });
  assert.equal(page.data.play.img, 'https://cdn/game.png');
  assert.equal(page.data.play.name, '暗号对答');
  assert.deepEqual(page.data.play.chips, ['2-6 人', '25 分钟', '难度 中等']);
  assert.equal(page.data.play.verifyText, '玩家答文字题,你对暗号');
  assert.equal(page.data.reward.medalName, '霓虹电报员');
  assert.equal(page.data.reward.xp, 120);
  assert.equal(page.data.prepText, '线索卡 20 张、印章 1 枚');

  // 老数据/模板被删:三块必须整块消失,不能渲染空壳
  const bare = makePage();
  bare.processData({ status: 1 });
  assert.equal(bare.data.play, null);
  assert.equal(bare.data.reward, null);
  assert.equal(bare.data.prepText, '');

  // 模板在但没有任何可展示字段(没图没名没人数没验证方式),也不该开一个空卡
  const empty = makePage();
  empty.processData({ status: 1, templateDetail: { id: 1 } });
  assert.equal(empty.data.play, null);
  assert.equal(empty.data.reward, null);
});

/** 核销方式是商家现场要做的动作,一行,留在卡上。 */
test('核销方式按 validationMethod 给一行人话', () => {
  const cases = [[1, '玩家答文字题,你对暗号'], [2, '玩家拍照打卡,你确认'], [3, '玩家选选项,你确认'], [0, '']];
  cases.forEach(([m, expected]) => {
    const page = makePage();
    page.processData({ status: 1, templateDetail: { title: 'x', validationMethod: m } });
    assert.equal(page.data.play.verifyText, expected, 'validationMethod=' + m);
  });
});

/**
 * 稿 88:4170(M2 未通过)里玩法和「玩家可获得」都照常在:被驳回的商家正要照着它们
 * 改内容重报,这时候把奖励藏起来,他连这一站原本要给玩家什么都看不到了。
 */
test('驳回态玩法与奖励都要留着', () => {
  const page = makePage();
  page.processData({ status: 2, reason: 'x', templateDetail: { title: '暗号对答', medalName: '霓虹电报员', xpValue: 120 } });
  assert.notEqual(page.data.play, null);
  assert.equal(page.data.reward && page.data.reward.medalName, '霓虹电报员');
  assert.equal(page.data.reward && page.data.reward.xp, 120);
});

/** sharingAmount 是已累计分润,不是预估 —— 后端明确禁止报名阶段预写,前端不许当收入预测用。 */
test('已分润金额有值才显示，且措辞是「已分润」不是预估', () => {
  const paid = makePage();
  paid.processData({ status: 1, sharingRate: 15, sharingAmount: 486.5 });
  assert.equal(paid.data.sharingText, '分润比例 15% · 已分润 ¥486.5');

  const unpaid = makePage();
  unpaid.processData({ status: 1, sharingRate: 15, sharingAmount: 0 });
  assert.equal(unpaid.data.sharingText, '分润比例 15%');
});

/**
 * 编辑按身份分流:主办方改的是主题(权益票夹 / 票价主题),承接方改的是自己那条报名。
 * 原来共用一个 handler —— host 路径压根没有 stateKey,点了必然撞上
 * 「该报名已通过审核」那句文不对题的提示。
 */
// 2026-09-05「编辑」改名「更多」:同一颗按钮两个角色都打开抽屉,不再一个开弹层一个直接跳。
// 抽屉内容按 role + stateKey 分组(与 Figma 468:960 / 1009 / 1086 / 1126 一一对应),
// 「修改承接内容」只是其中一行 —— 原来那条「承接方点了直接跳报名页」的行为搬进了这一行。
test('两个角色点更多都开抽屉，分组按角色给', () => {
  const host = makePage();
  host.data.role = 'host';
  host.onQuickAction({ currentTarget: { dataset: { key: 'more' } } });
  assert.equal(host.data.moreSheet.show, true);
  assert.equal(navigations.length, 0, '先给选择,不直接跳走');
  const hostKeys = host.data.moreSheet.groups.flatMap((g) => g.rows.map((r) => r.key));
  assert.ok(hostKeys.includes('perk') && hostKeys.includes('topic'), '主办方保留编辑二选一');
  assert.ok(hostKeys.includes('chapterOpen'), '主办方独有章节控制');

  const join = makePage();
  join.processData({ status: 2, reason: 'x' });   // 驳回态可改
  join.data.regId = 900;
  join.onQuickAction({ currentTarget: { dataset: { key: 'more' } } });
  assert.equal(join.data.moreSheet.show, true, '承接方点更多也是开抽屉');
  const joinKeys = join.data.moreSheet.groups.flatMap((g) => g.rows.map((r) => r.key));
  assert.ok(!joinKeys.includes('chapterOpen'), '承接方看不到章节控制');
  assert.ok(joinKeys.includes('editRegistration'));
  assert.equal(navigations.length, 0, '开抽屉这一步不跳页');
});

test('抽屉里主办方那两行各跳一个已有页面', () => {
  const page = makePage();
  page.data.role = 'host';
  page.data.topicId = 8001;
  page.openMoreSheet();

  page.onMorePick({ currentTarget: { dataset: { key: 'perk' } } });
  assert.match(navigations[0].url, /merchant\/decor/, '权益票夹在店铺装修页');
  assert.equal(page.data.moreSheet.show, false, '选完要关掉');

  page.openMoreSheet();
  page.onMorePick({ currentTarget: { dataset: { key: 'topic' } } });
  assert.match(navigations[1].url, /publish\/fabu/);
  assert.match(navigations[1].url, /id=8001/);
});

// 承接方过审后「修改承接内容」是死的:点了不能跳,只能给出为什么。
test('过审后点修改承接内容不跳页，只说明原因', () => {
  const page = makePage();
  page.processData({ status: 1, auditStatus: 1 });   // 已确认承接
  page.data.regId = 900;
  page.openMoreSheet();
  const row = page.findMoreRow('editRegistration');
  assert.equal(row.disabled, true, '过审后这一行必须是禁用态');
  page.onMorePick({ currentTarget: { dataset: { key: 'editRegistration' } } });
  assert.equal(navigations.length, 0, '禁用行点了不许跳走');
});

test('承接方三个入口、主办方四个入口', () => {
  const page = makePage();
  assert.deepEqual(page.buildQuickActions('join').map((a) => a.key), ['scan', 'club', 'customer', 'more']);
  assert.deepEqual(page.buildQuickActions('host').map((a) => a.key), ['club', 'merchant', 'customer', 'more']);
  assert.deepEqual(page.data.quickActions.map((a) => a.key), ['scan', 'club', 'customer', 'more'],
    '接口没回来之前先按承接方给,不能渲染成空');
});

/** 电话可见范围由后端判死,前端只负责显示;这里只锁「拿到什么就显示什么」不做二次过滤。 */
test('俱乐部半屏按后端给的原样映射，缺电话时不编一个出来', () => {
  const page = makePage();
  const rows = page.mapClubs([
    { clubId: 1, name: '夜行者俱乐部', leaderName: '张明', phone: '13800000001', status: 1, terms: '分成 20%' },
    { clubId: 2, status: 0 },
  ]);
  assert.equal(rows[0].phone, '13800000001');
  assert.equal(rows[0].statusText, '合作中');
  assert.equal(rows[1].name, '未命名俱乐部');
  assert.equal(rows[1].phone, '', '后端没给电话就是没有,不兜一个假的');
  assert.equal(rows[1].statusText, '待对方确认');

  // fail-closed:status 缺失时按「待确认」,不按「合作中」——
  // 把还没答应的人标成合作方,商家会照着去安排场次
  const noStatus = page.mapClubs([{ clubId: 3, name: '未知状态' }]);
  assert.equal(noStatus[0].statusText, '待对方确认');
  assert.equal(noStatus[0].accepted, false);

  // 组件不许渲染空胶囊:后端没给状态时那个位置该整个消失,不是留一条灰杠
  const join = fs.readFileSync(WXML, 'utf8');
  const host = fs.readFileSync(path.resolve(__dirname, '../../pages/topic/components/project-host/index.wxml'), 'utf8');
  assert.match(join, /class="dr-tag[^"]*" *\n?\s*wx:if="\{\{ item\.statusText \}\}"/);
  assert.match(host, /class="dr-tag" wx:if="\{\{ item\.statusText \}\}"/);
});

/**
 * 抽屉里的黑按钮按身份和有没有俱乐部变文案 —— 空态也照常打开抽屉,
 * 直接跳走会让人不知道自己刚才点了什么。
 */
test('俱乐部抽屉的动作按身份/空态给不同文案', () => {
  const empty = makePage();
  empty.openClubSheet();
  assert.equal(empty.data.clubSheet.show, true, '空态也要开抽屉,里面那句引导就是下一步');
  assert.deepEqual(empty.data.clubActions.map((a) => a.label), ['去找俱乐部']);

  const withClubs = makePage();
  withClubs.data.clubSheet = { show: false, items: [{ clubId: 1, name: 'x' }] };
  withClubs.openClubSheet();
  assert.deepEqual(withClubs.data.clubActions.map((a) => a.label), ['再找一家俱乐部带团']);

  const host = makePage();
  host.data.role = 'host';
  host.openClubSheet();
  assert.deepEqual(host.data.clubActions.map((a) => a.key), ['goInviteClub', 'goReceivedApplies'],
    '主办方是两个并排:邀请 + 收到的申请');
});

/**
 * 项目页的每个入口都是「本项目作用域」。跨项目的全量关系在 pages/merchant/relation,
 * 那是从商家工作台首页进的 —— 从一个项目里点进去却看到别的项目的人,是把作用域丢了。
 */
test('客户入口开玩家名单抽屉，不跳全局关系页', () => {
  const page = makePage();
  page.data.topicId = 8001;
  page.onQuickAction({ currentTarget: { dataset: { key: 'customer' } } });
  assert.equal(page.data.playerSheet.show, true);
  assert.equal(navigations.length, 0, '就地开抽屉,不跳页');

  // 资金域核销记录是二级出口,但不再假装按 topicId 过滤（旧页此前会静默丢参）。
  const ledger = makePage();
  ledger.data.topicId = 8001;
  ledger.goLedger();
  assert.match(navigations[0].url, /merchant\/ledger/);
  assert.match(navigations[0].url, /view=redemptions/);
  assert.doesNotMatch(navigations[0].url, /topicId=/);
  assert.doesNotMatch(navigations[0].url, /merchant\/relation/);
});

/**
 * 名单空态三种说法分开:「一单没卖」「全部已核销」「还没人核销」的下一步完全不同,
 * 合成一句等于什么都没说。
 */
test('玩家名单按场次分组，空态分三种说法', () => {
  const page = makePage();
  const data = {
    rows: [
      { registrationId: 1, name: '张明', phone: '138', ticketNo: 'A1', arrived: true, participateDate: '8.6 周三 · 19:30' },
      { registrationId: 2, name: '王小强', phone: '139', ticketNo: 'A2', arrived: false, participateDate: '8.6 周三 · 19:30' },
      { registrationId: 3, name: '李蔓', phone: '137', ticketNo: 'A3', arrived: false, participateDate: '8.9 周六 · 14:00' },
    ],
    summary: { paidCount: 3, arrivedCount: 1, pendingCount: 2 },
    contactVisible: true,
  };

  page.setData(page.buildPlayerSheet(data, 'all'));
  assert.deepEqual(page.data.playerSheet.groups.map((g) => g.key), ['8.6 周三 · 19:30', '8.9 周六 · 14:00']);
  assert.equal(page.data.playerSheet.groups[0].rows.length, 2);

  page.setData(page.buildPlayerSheet(data, 'arrived'));
  assert.equal(page.data.playerSheet.groups.length, 1);
  assert.equal(page.data.playerSheet.groups[0].rows[0].name, '张明');

  page.setData(page.buildPlayerSheet(data, 'pending'));
  assert.equal(page.data.playerSheet.groups.length, 2);

  // 一单都没卖 vs 卖了但筛空,说法必须不同
  page.setData(page.buildPlayerSheet({ rows: [] }, 'all'));
  assert.match(page.data.playerSheet.emptyText, /还没有人下单/);
  page.setData(page.buildPlayerSheet({ rows: [{ registrationId: 1, arrived: true }] }, 'pending'));
  assert.equal(page.data.playerSheet.emptyText, '没有待核销的客户');
  page.setData(page.buildPlayerSheet({ rows: [{ registrationId: 1, arrived: false }] }, 'arrived'));
  assert.equal(page.data.playerSheet.emptyText, '没有已核销的客户');

  // CU-C-125:零单样本下切 Tab,空态要跟着换 —— 旧实现拿未筛的 rows 判,四档同一句。
  const zeroOrderTexts = ['all', 'pending', 'contacted', 'arrived']
    .map((key) => {
      page.setData(page.buildPlayerSheet({ rows: [] }, key));
      return page.data.playerSheet.emptyText;
    });
  assert.equal(new Set(zeroOrderTexts).size, 2,
    `零单时四档至少分「总单为零」与「这一档也没记录」两种说法,实际:${zeroOrderTexts.join(' | ')}`);
  assert.match(zeroOrderTexts[0], /还没有人下单。路线上架后/);
  assert.doesNotMatch(zeroOrderTexts.join('\n'), /,/u, '中文文案不用半角逗号');
  // 有人扫码待确认时,「待核销」为空不等于「全部客户都已核销」—— 那句是假的。
  page.setData(page.buildPlayerSheet({ rows: [{ registrationId: 1, state: 'contacted' }] }, 'pending'));
  assert.equal(page.data.playerSheet.emptyText, '没有待核销的客户');
  page.setData(page.buildPlayerSheet({ rows: [{ registrationId: 1, state: 'pending' }] }, 'contacted'));
  assert.equal(page.data.playerSheet.emptyText, '还没有客户接洽');
});

/**
 * 主办视图的数据整形。数字一律兜底 —— 后端少给一个字段就渲染出 undefined,
 * 是这类聚合页最常见的翻车方式。
 */
test('主办段整形:进度条按站点数等分，数字有兜底', () => {
  const page = makePage();
  page.applyHome({
    topic: { name: '外滩夜行', startDate: '2026-08-02', endDate: '2026-08-16', started: true },
    host: {
      recruit: { nodeTotal: 5, nodeFilled: 2, pendingCount: 3, openNodes: [{ nodeId: 9, nodeName: '第 4 站' }] },
      clubs: [{ clubId: 1, name: '夜行者', phone: '138', status: 1 }],
      merchants: [
        { registrationId: 1, name: '幸会咖啡', auditStatus: 1, status: 1 },
        { registrationId: 2, name: '隔壁书店', status: 0, isSelf: true },
      ],
      players: { paidCount: 24 },
      canEdit: true,
    },
  });

  assert.deepEqual(page.data.hostRecruit.segments, [true, true, false, false, false]);
  assert.equal(page.data.hostRecruit.pendingCount, 3);
  assert.equal(page.data.hostPlayers.paidCount, 24);
  assert.equal(page.data.hostMerchants[0].statusText, '已中标');
  assert.equal(page.data.hostMerchants[1].statusText, '待审核');
  assert.equal(page.data.hostMerchants[1].isSelf, true, '自己报名自己的主题要标出来');
  assert.deepEqual(page.data.quickActions.map((a) => a.key), ['club', 'merchant', 'customer', 'more']);

  // 后端只给了个空壳:不能渲染出 undefined,也不能画一条空的进度条
  const bare = makePage();
  bare.applyHome({});
  assert.deepEqual(bare.data.hostRecruit.segments, []);
  assert.equal(bare.data.hostRecruit.nodeTotal, 0);
  assert.equal(bare.data.hostPlayers.paidCount, 0);
  assert.deepEqual(bare.data.hostMerchants, []);
});

/** 从哪条链路进来的就重走哪条:host 没有 regId,走 loadDetail 会直接失败。 */
test('主办视图重试走项目主页而不是报名详情', () => {
  const page = makePage();
  let calls = [];
  page.loadProjectHome = () => calls.push('home');
  page.loadDetail = () => calls.push('detail');

  page.data.role = 'host';
  page.retryLoad();
  assert.deepEqual(calls, ['home']);

  calls = [];
  page.data.role = 'join';
  page.data.regId = 900;
  page.retryLoad();
  assert.deepEqual(calls, ['detail']);
});

test('统计口径:待我核销 = 本场总人数 - 我已核销，且不为负', () => {
  const page = makePage();
  page.processData({ status: 1, totalOrderNum: 10, verifiedNum: 4 });

  assert.equal(page.data.totalCount, 10);
  assert.equal(page.data.verifiedCount, 4);
  assert.equal(page.data.pendingCount, 6);

  const page2 = makePage();
  page2.processData({ status: 1, totalOrderNum: 0, verifiedNum: 3 });
  assert.equal(page2.data.pendingCount, 0, '脏数据也不能显示负数');
});

/**
 * 准备清单是「三项固定 + 打勾」,不是「只列缺的」——
 * 只列缺的时候勾选框永远是空的,商家也看不出自己一共要配几样。
 */
test('准备清单三项固定，按现码字段判打没打勾', () => {
  const page = makePage();
  page.processData({ status: 1 });
  assert.deepEqual(page.data.todos.map((t) => t.key), ['template', 'perk', 'image']);
  assert.deepEqual(page.data.todos.map((t) => t.done), [false, false, false]);
  assert.match(page.data.todos[2].text, /还没上传/);

  const page2 = makePage();
  page2.processData({ status: 1, templateId: 5, templateName: '暗号接头', couponId: 9, picUrl: 'a.png' });
  assert.equal(page2.data.todos.length, 3, '配好了也要列出来,打上勾');
  assert.deepEqual(page2.data.todos.map((t) => t.done), [true, true, true]);
  assert.doesNotMatch(page2.data.todos[2].text, /还没/, '配好的项不该还说「还没」');
});

/**
 * 「开始接待」不能顶掉底部按钮:底部那个是退出口径(已中标只能联系客服申请退出),
 * 两件事挤到一个按钮上,商家就没有退出的入口了。
 */
test('已确认态的「开始接待」在章节卡里，底部仍是退出口径', () => {
  const won = makePage();
  won.processData({ status: 1, auditStatus: 1, topicStartDate: daysFromToday(3) });
  assert.equal(won.data.chapterActionText, '开始接待');
  assert.equal(won.data.primaryAction, 'service');
  assert.match(won.data.primaryText, /退出/);

  const running = makePage();
  running.processData({ status: 1, topicStartDate: daysFromToday(-1), topicEndDate: daysFromToday(5) });
  assert.equal(running.data.chapterActionText, '', '开场后就不该再有「开始接待」');
});

/** 审核中没有能推进的动作,按钮只是把状态再说一遍,不能长得像「取消参与」。 */
test('审核中底部按钮是禁用的状态说明', () => {
  const page = makePage();
  page.processData({ status: 0 });
  assert.equal(page.data.primaryText, '等待审核中');
  assert.equal(page.data.primaryAction, 'none');
  assert.equal(page.data.primaryDisabled, true);
});

/** 驳回后可以直接改内容重新提交(后端 /registration/merchant/update 已放开这一档)。 */
test('驳回态引导改内容重新提交，而不是取消重报', () => {
  const page = makePage();
  page.processData({ status: 3, auditStatus: 2, reason: 'x' });
  assert.equal(page.data.primaryText, '修改并重新提交');
  assert.equal(page.data.primaryAction, 'edit');
  assert.equal(page.canEditRegistration(), true);

  const running = makePage();
  running.processData({ status: 1, topicStartDate: daysFromToday(-1), topicEndDate: daysFromToday(5) });
  assert.equal(running.canEditRegistration(), false, '开场后不能再改');
});

/**
 * 两块各是一个入口,不是两坨字:「我承接的」点进整条路线,「这一站玩什么」点进玩法规则。
 * 玩法说明/剧情/规则/拍照要求都在模板详情页看,不在这页铺开。
 */
// 2026-09-05:承接卡从「跳主题详情整页」改成「打开章节抽屉」(Figma 439:6336)。
// 主题详情是玩家视角的路线页、带地图,而 09-04 拍板承接页不补地图;商家要的是
// 本章剧情与本章各站的玩法,那是抽屉里的内容。判据跟着落点走,严格度没变:
// 整卡仍必须是一个入口,不能退化成一坨不可点的字。
test('承接块打开章节抽屉、玩法块跳模板，规则文案不在本页铺开', () => {
  const wxml = fs.readFileSync(WXML, 'utf8');
  assert.match(wxml, /class="card card--flush" bindtap="emit" data-act="openChapterSheet"/, '承接卡整卡是章节入口');
  assert.match(wxml, /data-act="goTemplateDetail"[\s\S]{0,160}玩法规则/, '玩法规则是显式入口');
  assert.match(wxml, /class="game-img"/, '玩法要先看到游戏图');
  assert.doesNotMatch(wxml, /play\.rule|play\.story|play\.intro|play\.photoDesc/, '规则/剧情/说明/拍照要求不在本页渲染');
  // 四个关系入口是本页骨干,不是装饰;图标必须来自 Figma 导出的资源文件
  assert.match(wxml, /wx:for="\{\{ quickActions \}\}"[\s\S]{0,160}data-act="onQuickAction"/, '四个关系入口');
  assert.doesNotMatch(wxml, /<svg|<path /, '图标不许在 wxml 里手画,必须用导出的资源');

  const page = makePage();
  page.processData({ status: 1 });
  assert.equal(page.data.templateReady, false);
  assert.equal(page.data.templateSubText, '未配置玩法模板', '没配模板时给出的是待办口径,不暗示可点进去');

  page.processData({ status: 1, templateId: 5, templateName: '暗号接头' });
  assert.equal(page.data.templateReady, true);
});

test('场次带俱乐部名和预计到店区间', () => {
  const page = makePage();
  const runs = page.buildRuns([{
    ticketId: 1,
    startTime: '2026-08-03 14:00:00',
    clubName: '野路子徒步社',
    paidCount: 12,
    teamStatus: 1,
    nodeOrder: 2,
    nodeTotal: 4,
    arrivalStart: '2026-08-03 15:00:00',
    arrivalEnd: '2026-08-03 16:00:00',
  }]);

  assert.equal(runs[0].sourceText, '野路子徒步社');
  assert.equal(runs[0].timeText, '14:00');
  assert.equal(runs[0].teamText, '已成团');
  assert.equal(runs[0].stepText, '第 2/4 站');
  assert.equal(runs[0].arrivalText, '预计 15:00-16:00 到店');
});

/** 后端事实不齐时返回 null 区间,前端不许自己补一个 —— 宁可不显示这一行。 */
test('后端没给到店区间时前端不编一个出来', () => {
  const page = makePage();
  const runs = page.buildRuns([{
    ticketId: 2,
    startTime: '2026-08-03 14:00:00',
    clubName: null,
    paidCount: 3,
    arrivalStart: null,
    arrivalEnd: null,
  }]);

  assert.equal(runs[0].arrivalText, '');
  assert.equal(runs[0].sourceText, '自由报名场', '没有俱乐部就不能凭空写一个名字');
  assert.equal(runs[0].stepText, '');
});

/**
 * 核销答案对中标商家可见(2026-08-06 用户拍板)。
 *
 * 商家现场就是靠对暗号核销的,看不到答案这活干不了。但可见性判定**只在后端**:
 * `MerchantRegistrationDetailReadServiceImpl` 只在 auditStatus==1 时走
 * `TemplateSecrets.merchantView` 放行,其余一律 strip 成 null。
 * 所以前端的正确行为是「有就显示、没有就不显示」,绝不能自己判身份或兜底凑。
 */
test('文字验证:答案原样透出,商家现场好对暗号', () => {
  const page = makePage();
  page.processData({ status: 1, templateDetail: {
    title: '暗号对答', validationMethod: 1,
    questionName: '今晚的暗号是什么?', questionAnswer: '夜航船',
  } });
  assert.equal(page.data.play.questionText, '今晚的暗号是什么?');
  assert.equal(page.data.play.answerText, '夜航船');
});

test('选项验证:只给 A/B/C/D 商家对不上题,要补选项原文', () => {
  const page = makePage();
  page.processData({ status: 1, templateDetail: {
    title: '选一个', validationMethod: 3, correctAnswer: 'C',
    questionA: '红', questionB: '黄', questionC: '蓝', questionD: '绿',
  } });
  assert.equal(page.data.play.answerText, 'C. 蓝');

  // 选项原文缺失(老数据)时退回只给字母,别把整行吞掉
  const bare = makePage();
  bare.processData({ status: 1, templateDetail: {
    title: '选一个', validationMethod: 3, correctAnswer: 'C',
  } });
  assert.equal(bare.data.play.answerText, 'C');
});

test('图片验证没有标准答案,不出这一行', () => {
  const page = makePage();
  page.processData({ status: 1, templateDetail: {
    title: '拍照打卡', validationMethod: 2, questionAnswer: '不该被用到',
  } });
  assert.equal(page.data.play.answerText, '');
});

test('★负控:后端没下发答案(非中标商家被 strip)时前端必须空着,不许兜底凑', () => {
  const page = makePage();
  page.processData({ status: 1, templateDetail: {
    title: '暗号对答', validationMethod: 1,
    questionName: '今晚的暗号是什么?',
    // 后端 TemplateSecrets.strip 之后就是这个形状
    questionAnswer: null, correctAnswer: null,
  } });
  assert.equal(page.data.play.answerText, '', '拿不到答案就该是空,前端不许自己编或改判身份');
  // 题面本身不是秘密,可以留着 —— 商家至少知道玩家会被问什么
  assert.equal(page.data.play.questionText, '今晚的暗号是什么?');
});

/**
 * 「开场前要准备」块的负控 —— wxml 守卫是
 * `showPrep && (todos.length > 0 || prepText)`,这里钉住 prepText 那一半:
 * 模板没写要准备的物品时,prepText 必须是空串而不是 undefined/'undefined',
 * 否则 wx:if 判真,渲染出一个只有标题的空壳。
 */
test('★负控:requiredMaterials 置空时 prepText 为空串,块不会渲染空壳', () => {
  const withMaterials = makePage();
  withMaterials.processData({ status: 1, templateDetail: { title: 'X', requiredMaterials: '印章 1 枚' } });
  assert.equal(withMaterials.data.prepText, '印章 1 枚');
  assert.equal(withMaterials.data.showPrep, true);

  for (const blank of [undefined, null, '']) {
    const page = makePage();
    page.processData({ status: 1, templateDetail: { title: 'X', requiredMaterials: blank } });
    assert.equal(page.data.prepText, '', 'requiredMaterials=' + String(blank) + ' 时必须是空串');
    // showPrep 仍为 true(状态决定),挡住空壳的是 prepText 这一半守卫
    assert.equal(page.data.showPrep, true);
  }
});

/* 打开章节 / 打开节点(Figma 439:6336 / 336:461)。
   这两个抽屉的内容都从**已有的** buildPlay / buildReward 出,不另起一套渲染口径 ——
   仓库里已经有过 12 对「页面与场景弹窗各写一份、改错那份零报红」的教训。
   这里守三件事:
     ① 章节内容按需拉、只拉一次(不打开就不发请求);
     ② 别的站拿不到答案 —— 那是后端 strip 的结果,不是前端在判身份;
     ③ 两层是下钻不是叠加:开节点关章节、关节点回章节(两个抽屉同开会叠两层遮罩)。 */
function chapterPayload() {
  return {
    code: 200,
    data: {
      name: '苏州河的回声',
      chaptersList: [{
        id: 1, name: '第二章 · 苏州河的回声', description: '沿着苏州河往东走……',
        nodes: [
          { id: 302, name: '第 3 站 · 幸会咖啡', cmsMemberTemplate: {
            id: 401, title: '暗号对答 · 霓虹密语', players: '2–6 人', duration: 25,
            difficulty: '中等', validationMethod: 1, medalName: '霓虹电报员勋章', xpValue: 120,
            // 自己那一站以外的模板后端已 strip,这里给的是「自己那站」在公开投影里的样子:
            // 答案同样是 null —— 页面要用答案得走承接单详情那条链路
            questionAnswer: null, correctAnswer: null } },
          { id: 303, name: '第 4 站 · 旧书店', cmsMemberTemplate: {
            id: 402, title: '拍照打卡', validationMethod: 2 } },
        ],
      }],
    },
  };
}

test('打开章节:按需拉一次主题投影，组装本章剧情与各站玩法', () => {
  const requests = [];
  const app = global.getApp();
  const page = makePage();
  page.data.topicId = 9;
  page.data.info = { nodeId: 302, chapterName: '第二章 · 苏州河的回声' };
  const realSend = app.sendRequest;
  global.getApp = () => Object.assign({}, app, {
    sendRequest: (options) => requests.push(options),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  });
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const p = makePage();
  p.data.topicId = 9;
  p.data.info = { nodeId: 302, chapterName: '第二章 · 苏州河的回声' };

  p.openChapterSheet();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/topic/info-to-user');
  assert.equal(p.data.chapterSheet.state, 'loading');
  requests[0].success(chapterPayload());

  assert.equal(p.data.chapterSheet.state, 'ready');
  assert.equal(p.data.chapterSheet.chapterName, '第二章 · 苏州河的回声');
  assert.match(p.data.chapterSheet.story, /苏州河/);
  assert.equal(p.data.chapterSheet.nodes.length, 2, '本章两站都要列出来');
  assert.equal(p.data.chapterSheet.nodes[0].mine, true, '自己那一站要标出来');
  assert.equal(p.data.chapterSheet.nodes[1].mine, false);
  assert.equal(p.data.chapterSheet.nodes[0].play.name, '暗号对答 · 霓虹密语');

  // 再打开不重复发请求:章节内容不会自己变,一次就够
  p.closeChapterSheet();
  p.openChapterSheet();
  assert.equal(requests.length, 1, '第二次打开又发了一轮');
  assert.equal(p.data.chapterSheet.show, true);
  global.getApp = () => app;
});

test('打开节点:自己那站带答案，别的站没有答案可给', () => {
  const requests = [];
  const app = global.getApp();
  global.getApp = () => Object.assign({}, app, {
    sendRequest: (options) => requests.push(options),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  });
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const p = makePage();
  p.data.topicId = 9;
  p.data.info = { nodeId: 302 };
  // 承接单详情那条链路给的自己那一站(后端 merchantView 只对 auditStatus=1 放行)
  p.data.play = { img: '', name: '暗号对答 · 霓虹密语', chips: [], verifyText: '玩家答文字题,你对暗号',
    questionText: '今晚的第三种光', answerText: '霓虹拾光' };
  p.openChapterSheet();
  requests[0].success(chapterPayload());

  p.openNodeSheet({ currentTarget: { dataset: { id: 302 } } });
  assert.equal(p.data.nodeSheet.show, true);
  assert.equal(p.data.chapterSheet.show, false, '开节点必须关章节:两个抽屉同开会叠两层遮罩');
  assert.equal(p.data.nodeSheet.play.answerText, '霓虹拾光', '自己那一站要能看到现场答案');
  assert.match(p.data.nodeSheet.chapterText, /^我承接的站点 · /);
  assert.equal(p.data.nodeSheet.reward.medalName, '霓虹电报员勋章');
  assert.equal(p.data.nodeSheet.reward.xp, 120);
  assert.deepEqual(p.data.nodeSheet.actions, [{ key: 'openNodeTemplate', label: '看模板' }]);

  // 关节点 = 回章节,不是关掉整条路
  p.closeNodeSheet();
  assert.equal(p.data.nodeSheet.show, false);
  assert.equal(p.data.chapterSheet.show, true);

  p.openNodeSheet({ currentTarget: { dataset: { id: 303 } } });
  assert.ok(!p.data.nodeSheet.play.answerText, '别的站不该有答案 —— 后端就没给');
  assert.ok(!p.data.nodeSheet.reward, '那一站没配勋章就不显示奖励块,不补 0');
  assert.ok(!/我承接的站点/.test(p.data.nodeSheet.chapterText));
  global.getApp = () => app;
});

test('打开章节:拉不到时说清楚，不假装这条路线没有章节', () => {
  const requests = [];
  const app = global.getApp();
  global.getApp = () => Object.assign({}, app, {
    sendRequest: (options) => requests.push(options),
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  });
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
  const p = makePage();
  p.data.topicId = 9;

  p.openChapterSheet();
  requests[0].fail({ errMsg: 'request:fail' });
  assert.equal(p.data.chapterSheet.state, 'error');
  assert.match(p.data.chapterSheet.error, /没加载出来/);

  // 真的一个章节都没有,才是 empty
  const p2 = makePage();
  p2.data.topicId = 9;
  p2.openChapterSheet();
  requests[1].success({ code: 200, data: { chaptersList: [] } });
  assert.equal(p2.data.chapterSheet.state, 'empty');
  global.getApp = () => app;
});

/**
 * 稿 88:3776 的两种日期写法各有各的用处,不能合成一个:
 * 档期行「8月2日 – 8月16日」跨半个月,写星期没用;
 * 进度行「8.6 周三 19:30」是要照着排班的那一天,星期和钟点都得在。
 */
test('档期行不带星期,进度行带星期和钟点', () => {
  const page = makePage();
  page.processData({
    status: 1,
    topicStartDate: '2026-08-02 19:30:00',
    topicEndDate: '2026-08-16 22:00:00',
    createTime: '2026-08-01 10:20:00',
  });

  assert.equal(page.data.scheduleValue, '8月2日 – 8月16日');

  const rows = page.data.progress;
  const byKey = (k) => rows.filter((r) => r.key === k)[0];
  assert.equal(byKey('submitted').time, '8.1 10:20', '提交时间来自 create_time,接口一直在下发');
  assert.equal(byKey('start').time, '8.2 周日 19:30');
  assert.equal(byKey('end').time, '8.16 周日 22:00');
});

/** ★负控:数据只到日(零点)时不许补一个「00:00」出来 —— 商家会以为零点开门。 */
test('日期不带钟点时进度行只写日期', () => {
  const page = makePage();
  page.processData({
    status: 1,
    topicStartDate: '2026-08-02',
    topicEndDate: '2026-08-16',
  });
  const start = page.data.progress.filter((r) => r.key === 'start')[0];
  assert.equal(start.time, '8.2 周日');
  assert.equal(start.time.indexOf(':'), -1, '零点不能被写成 00:00');
});

/** create_time 缺失时提交行没有时间,不拿别的时间顶替。 */
test('没有提交时间就不写时间', () => {
  const page = makePage();
  page.processData({ status: 1, topicStartDate: '2026-08-02' });
  assert.equal(page.data.progress.filter((r) => r.key === 'submitted')[0].time, '');
});

/**
 * 稿 88:4583 / 468:1086:已结束态的主动作是「查看结算报告」,去的是结算明细页
 * (coop/settlement-detail),不是核销台账。台账回答「谁来过」,结算报告回答
 * 「这一站给我结了多少」—— 两个页面互相顶替,商家点进去看不到钱。
 */
test('已结束的主按钮是查看结算报告,落到结算明细页', () => {
  const page = makePage();
  page.processData({ status: 1, topicId: 990056,
    topicStartDate: daysFromToday(-9), topicEndDate: daysFromToday(-2) });

  assert.equal(page.data.primaryText, '查看结算报告');
  assert.equal(page.data.primaryAction, 'settlement');
  assert.equal(page.data.fulfillActionText, '', '底部已有这颗按钮,履约卡里不再放第二颗同名的');

  page.onPrimaryTap();
  assert.equal(navigations.length, 1);
  assert.match(navigations[0].url, /^\/pages\/coop\/settlement-detail\/index\?source=finance&topicId=990056$/);
});

/** ★负控:拿不到 topicId 时不跳一个必然报「缺少结算记录标识」的页面。 */
test('没有 topicId 就不跳结算明细', () => {
  const page = makePage();
  page.processData({ status: 1, topicStartDate: daysFromToday(-9), topicEndDate: daysFromToday(-2) });
  page.data.topicId = 0;
  page.data.info = {};
  page.onPrimaryTap();
  assert.equal(navigations.length, 0);
});

function runningJoin(extra) {
  return Object.assign({
    status: 1,
    auditStatus: 1,
    nodeId: 8,
    topicStartDate: daysFromToday(-1),
    topicEndDate: daysFromToday(5),
  }, extra || {});
}

test('进行中/已确认且有 nodeId 才出示本站打卡码，审核中和已结束不出', () => {
  const running = makePage();
  running.processData(runningJoin());
  assert.equal(running.data.showCheckinQr, true);

  const confirmed = makePage();
  confirmed.processData({ status: 1, auditStatus: 1, nodeId: 8, topicStartDate: daysFromToday(3) });
  assert.equal(confirmed.data.showCheckinQr, true);

  const noNode = makePage();
  noNode.processData(runningJoin({ nodeId: 0 }));
  assert.equal(noNode.data.showCheckinQr, false);

  const pending = makePage();
  pending.processData({ status: 0, nodeId: 8 });
  assert.equal(pending.data.showCheckinQr, false);

  const ended = makePage();
  ended.processData({
    status: 1, nodeId: 8,
    topicStartDate: daysFromToday(-10), topicEndDate: daysFromToday(-1),
  });
  assert.equal(ended.data.showCheckinQr, false);
});

test('承接详情核销区是出示二维码 + 下载到本地，码卡挂在页面上', () => {
  const wxml = fs.readFileSync(WXML, 'utf8');
  const pageWxml = fs.readFileSync(PAGE_WXML, 'utf8');
  const pageJson = JSON.parse(fs.readFileSync(PAGE_JSON, 'utf8'));
  const pageJs = fs.readFileSync(path.resolve(__dirname, PAGE), 'utf8');
  assert.match(wxml, /wx:if="\{\{ showCheckinQr \}\}"/);
  assert.match(wxml, /data-act="showLiveCheckin"[\s\S]{0,80}出示二维码/);
  assert.match(wxml, /data-act="downloadCheckinQr"[\s\S]{0,80}下载到本地/);
  assert.match(wxml, /贴在店里长期使用/);
  assert.doesNotMatch(wxml, /扫过即作废/);
  assert.match(pageWxml, /<cy-qr-voucher[\s\S]*bind:secondary="downloadCheckinQr"/);
  assert.doesNotMatch(pageWxml, /自动换新/);
  assert.doesNotMatch(pageWxml, /扫过即作废/);
  assert.match(pageWxml, /<cy-privacy-gate[\s/>]/);
  assert.match(pageJs, /\/api\/merchant\/chapter-node\/poster-code/);
  assert.doesNotMatch(pageJs, /live-checkin-code/);
  assert.equal(pageJson.usingComponents['cy-qr-voucher'], '/components/cy/qr-voucher/index');
  assert.equal(pageJson.usingComponents['cy-privacy-gate'], '/components/cy/privacy-gate/index');
});

test('出示二维码取本站静态打卡码，不倒计时换新', () => {
  const page = makePage();
  page.processData(runningJoin());
  page.onJoinAct({ detail: { act: 'showLiveCheckin', dataset: {} } });
  assert.equal(page.data.checkinVisible, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/merchant/chapter-node/poster-code');
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].data, { nodeId: 8 });
  requests[0].success({
    code: 200,
    data: { code: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', qrcodeUrl: 'https://oss/poster.png', nodeId: 8 },
  });
  assert.equal(page.data.checkinQrState, 'ready');
  assert.equal(page.data.checkinQrUrl, 'https://oss/poster.png');
  assert.ok(!page._checkinTimer);
  page.closeLiveCheckin();
  assert.equal(page.data.checkinVisible, false);
});

test('下载到本地取静态码再存进相册', () => {
  const page = makePage();
  page.processData(runningJoin());
  page.onJoinAct({ detail: { act: 'downloadCheckinQr', dataset: {} } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/merchant/chapter-node/poster-code');
  requests[0].success({
    code: 200,
    data: { code: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', qrcodeUrl: 'https://oss/poster.png', nodeId: 8 },
  });
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].url, 'https://oss/poster.png');
  downloads[0].success({ statusCode: 200, tempFilePath: '/tmp/poster.png' });
  assert.equal(saves.length, 1);
  assert.equal(saves[0].filePath, '/tmp/poster.png');
  saves[0].success();
  assert.equal(toasts[toasts.length - 1].title, '已保存到相册');
});

/**
 * CU-M-183:抽屉里「已售 1 / 已核销 1」是本项目,点「查看台账」却是全部项目。
 * 商家那本接口不按 topicId 过滤(上一条已锁死),所以作用域必须写在入口上,
 * 而不是点进去让人自己发现少了/多了单。
 */
test('CU-M-183:主办方抽屉的台账入口写明「全店」作用域', () => {
  const host = makePage();
  host.data.role = 'host';
  host.data.topicId = 8001;
  host.openPlayerSheet();
  assert.deepEqual(host.data.playerActions.map((a) => a.key), ['goLedger']);
  assert.match(host.data.playerActions[0].label, /全店/, '入口要先说清这不是本主题台账');

  const joiner = makePage();
  joiner.data.role = 'join';
  joiner.data.topicId = 8001;
  joiner.openPlayerSheet();
  assert.deepEqual(joiner.data.playerActions, [], '承接方不下发主办方的台账出口');

  const source = fs.readFileSync(path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.js'), 'utf8');
  const withoutScopeWord = source.replace(/label: '查看全店台账'/, "label: '查看台账'");
  assert.notEqual(withoutScopeWord, source, '负控锚点失效:入口文案没被改回去');
  assert.doesNotMatch(withoutScopeWord, /key: 'goLedger', label: '查看全店台账'/, '去掉「全店」二字必须判红');
});
/* ===== CU-M-181:承接商家抽屉的主按钮必须对得上「现在做得动的事」 =====
   走查:抽屉空态写着「先去编辑里加站点再招商」,底部按钮却恒是「去找商家」;
   点进去的附近商家页在零站点时既招不成,空态又叫人「换个位置」,而全页没有位置控件。 */

const NEARBY_WXML = path.resolve(__dirname, '../../pages/coop/nearby/index.wxml');
const HOST_PAGE_SRC = fs.readFileSync(path.resolve(__dirname, PAGE), 'utf8');

function hostRecruitOf(nodeTotal) {
  return { nodeTotal, nodeFilled: 0, pendingCount: 0, openNodes: [] };
}

test('有站点时抽屉主按钮照旧是「去找商家」，落地仍是附近商家页', () => {
  const page = makePage();
  page.setData({ hostRecruit: hostRecruitOf(3), topicId: '77' });
  page.onQuickAction({ currentTarget: { dataset: { key: 'merchant' } } });

  assert.deepEqual(page.data.merchantActions.map((a) => a.key), ['goInviteMerchant', 'goReceivedApplies']);
  page.onJoinAct({ detail: { act: 'goInviteMerchant', dataset: {} } });
  assert.equal(navigations.length, 1);
  assert.match(navigations[0].url, /^\/pages\/coop\/nearby\/index\?topicId=77/);
});

test('★零站点时主按钮换成「去加站点」，点了进主题编辑器(站点在那里配)', () => {
  const page = makePage();
  page.setData({ hostRecruit: hostRecruitOf(0), topicId: '77' });
  page._hostCanEdit = true;
  page.onQuickAction({ currentTarget: { dataset: { key: 'merchant' } } });

  const keys = page.data.merchantActions.map((a) => a.key);
  assert.ok(!keys.includes('goInviteMerchant'), '没有站点还能「去找商家」= 把人带到招不成的空页');
  assert.equal(keys[0], 'goAddStations');
  page.onJoinAct({ detail: { act: 'goAddStations', dataset: {} } });
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, '/pages/publish/fabu/index?id=77');
});

test('★零站点且没有编辑资格时不给主按钮，只留「查看收到的申请」', () => {
  const page = makePage();
  page.setData({ hostRecruit: hostRecruitOf(0), topicId: '77' });
  page._hostCanEdit = false;
  page.onQuickAction({ currentTarget: { dataset: { key: 'merchant' } } });

  assert.deepEqual(page.data.merchantActions.map((a) => a.key), ['goReceivedApplies']);
});

test('抽屉空态只陈述前置条件，不再指一条页面上没有的「编辑」入口', () => {
  const hostWxml = fs.readFileSync(HOST_WXML, 'utf8');
  const line = hostWxml.split('\n').find((l) => l.includes('这条路线还没有配置站点'));
  assert.ok(line, '主办方抽屉的零站点空态必须还在');
  assert.ok(!/先去编辑里加站点/.test(line), '空态指向的「编辑」不是这个抽屉里的入口，指错等于没指');
});

test('附近商家空态不再教人「换个位置」，改指向本页真有的刷新', () => {
  const nearby = fs.readFileSync(NEARBY_WXML, 'utf8');
  assert.ok(!/换个位置/.test(nearby), '这一页只有设备定位 + 刷新，没有任何位置控件');
  assert.match(nearby, /title="附近暂无可联系商家" sub="[^"]*刷新[^"]*"[^>]*cta="刷新附近商家"/);
});

test('★负控:把 nodeTotal 分流改回恒有站点，零站点又会拿到「去找商家」', () => {
  const matched = HOST_PAGE_SRC.match(/buildMerchantActions\(\) \{([\s\S]*?)\n  \},/)
  assert.ok(matched, 'merchantinfo.js 里找不到 buildMerchantActions')
  const run = (body, nodeTotal, canEdit) =>
    new Function(body).call({ data: { hostRecruit: hostRecruitOf(nodeTotal) }, _hostCanEdit: canEdit })
  const real = run(matched[1], 0, true)
  assert.equal(real[0].key, 'goAddStations', '读法不对:真码在零站点时已经不给「去找商家」了')

  const mutated = matched[1].replace('nodeTotal || 0) > 0', 'nodeTotal || 1) > 0')
  assert.notEqual(mutated, matched[1], '负控未命中 nodeTotal 判据')
  assert.equal(run(mutated, 0, true)[0].key, 'goInviteMerchant',
    '撤掉分流后零站点还能拿到「去找商家」= 上面那条合同是假的')
})


test('自由探索尚无站点仍可邀请商家承接章节，模式由主题回包决定', () => {
  const page = makePage();
  page.setData({ topicId: '77' });
  page.applyHome({
    topic: { productType: 2 },
    host: { ownerType: 'merchant', canEdit: true, recruit: hostRecruitOf(0) },
  });
  page.onQuickAction({ currentTarget: { dataset: { key: 'merchant' } } });
  assert.equal(page.data.merchantActions[0].key, 'goInviteMerchant');
  page.onJoinAct({ detail: { act: 'goInviteMerchant', dataset: {} } });
  assert.match(navigations[0].url, /^\/pages\/coop\/nearby\/index\?topicId=77/);

  page.applyHome({
    topic: { productType: 1 },
    host: { ownerType: 'merchant', canEdit: true, recruit: hostRecruitOf(0) },
  });
  page.onQuickAction({ currentTarget: { dataset: { key: 'merchant' } } });
  assert.equal(page.data.merchantActions[0].key, 'goAddStations');
});
