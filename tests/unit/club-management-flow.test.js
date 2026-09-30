const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 2026-08-06 主页统一到 cy-profile 共用组件：member/index 与 userinfo 的 wxml/wxss
// 只剩壳，本文件的断言原本钉在旧结构上。约束没失效、只是搬进了组件 ——
// 在读文件这一层展开，断言原样保留。
const { readResolved } = require('../helpers/resolve-profile');

const DETAIL = '../../pages/club/detail/index.js';
const CREATE = '../../pages/club/create/index.js';

let pageConfig;
let sent;
let redirects;
let navigations;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 1,
  getUserRole: () => 'club',
  getImgUrl: (url) => url,
  getAuthorization: () => 'token',
  sendRequest: (request) => { sent = request; },
});

global.wx = {
  showToast() {}, showModal() {}, showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
  navigateTo: (option) => navigations.push(option.url),
  redirectTo: (option) => redirects.push(option.url),
  showShareMenu() {},
};

global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  pageConfig = null;
  sent = null;
  redirects = [];
  navigations = [];
});

function loadPage(path) {
  delete require.cache[require.resolve(path)];
  require(path);
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) });
  page.setData = (patch, callback) => {
    Object.keys(patch).forEach((key) => { page.data[key] = patch[key]; });
    if (callback) callback();
  };
  return page;
}

test('俱乐部榜单:完成用时用真实分钟格式化,无有效计时不伪装成 0 分钟', () => {
  const page = loadPage(DETAIL);

  assert.equal(page.decorateRank({ mileage: 3, durationMin: 95 }, 'duration').primaryText, '1小时35分');
  assert.equal(page.decorateRank({ mileage: 3, durationMin: 0 }, 'duration').primaryText, '—');
});

/* CU-C-72(9-25 裁决:按单个榜剔除)。后端每个榜只留「该榜成绩>0」的人,于是空榜的含义
   也跟着变了 —— 里程榜为空 = 本周没人跑出里程,而不是"没人通关过本团活动"。
   空态文案若还是一句通用话,就会在里程榜上说出与事实不符的理由(综合榜有人、里程榜没人)。 */
test('CU-C-72 榜单空态按当前榜各说一句,不是一句通用的「还没有人通关」', () => {
  const cases = {
    composite: '本周还没有人产生贡献',
    mileage: '本周还没有人跑出里程',
    duration: '本周还没有人跑出用时',
  };
  Object.keys(cases).forEach((sortBy) => {
    const page = loadPage(DETAIL);
    page.data.clubId = 7;
    page._leaderboardSort = sortBy;
    page.loadLeaderboard();
    sent.success({ code: '200', data: [] });
    assert.equal(page.data.leaderboardEmptyTitle, cases[sortBy], `sortBy=${sortBy} 的空态文案不对`);
    assert.equal(page.data.leaderboardLoaded, true);
    assert.equal(page.data.leaderboardError, '', '空榜不是错误,不得落到错误态');
  });

  // 空态文案绑在 data 上,不能退回 wxml 里写死一句(那样切榜就不会变)
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.wxml'), 'utf8');
  const emptyTag = wxml.match(/<cy-empty[^>]*class="ov-lb-empty"[\s\S]*?\/>/);
  assert.ok(emptyTag, '找不到榜单空态的 cy-empty');
  assert.match(emptyTag[0], /title="\{\{leaderboardEmptyTitle\}\}"/, '空态文案必须由 data 提供,切榜才跟着变');

  // ★负控:文案退回与 sortBy 无关(一律同一句)→ 判红
  const script = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.js'), 'utf8');
  assert.match(script, /function leaderboardEmptyTitle\(sortBy\)[\s\S]*sortBy === 'mileage'[\s\S]*sortBy === 'duration'/,
    '空态文案不再按榜区分 —— 每个榜各判各的成绩这条口径就断了');

  // 失败态仍走 cy-error,不得把"不知道"说成"没有"
  const failing = loadPage(DETAIL);
  failing.data.clubId = 7;
  failing.loadLeaderboard();
  sent.fail();
  assert.equal(failing.data.leaderboardError, '网络不稳定，榜单没能加载出来');
});

test('俱乐部成员资料入口:普通成员跳到既有脱敏公开主页', () => {
  const page = loadPage(DETAIL);
  page.data.club = { isOwner: false, viewerIsAdmin: false, id: 7 };
  page.data.clubId = 7;
  page.data.canManageMembers = false;

  page.goMemberProfile({ currentTarget: { dataset: { memberId: 88 } } });
  assert.deepEqual(navigations, ['/pages/userinfo/userinfo?userId=88']);
});

test('CU-C-83 俱乐部成员行:主理人/管理员点成员弹「公开资料 / 客户档案」两选;普通成员仍直进公开主页', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.js'), 'utf8');

  // 无客户管理权限(非主理人非管理员):点成员行照旧直接进脱敏公开主页,不弹清单、不给客户档案入口。
  [
    { club: { isOwner: false, viewerIsAdmin: false, id: 7 }, canManageMembers: true },
    { club: { isOwner: false, viewerIsAdmin: false, id: 7 }, canReadMembers: true },
  ].forEach((viewer) => {
    const page = loadPage(DETAIL);
    navigations.length = 0;
    page.data.club = viewer.club;
    page.data.clubId = 7;
    page.data.canManageMembers = !!viewer.canManageMembers;
    page.data.canReadMembers = !!viewer.canReadMembers;
    page.goMemberProfile({ currentTarget: { dataset: { memberId: 92 } } });
    assert.deepEqual(navigations, ['/pages/userinfo/userinfo?userId=92'],
      '无客户管理权限的人看不到「客户档案」入口,点成员行就是公开主页');
    assert.notEqual(page.data.choiceSheetShow, true, '无权限时不该弹选择清单');
  });

  // 主理人 / 管理员:两个落点都摆出来,点哪个去哪个(不再悄悄改道)。
  [
    { club: { isOwner: true, viewerIsAdmin: false, id: 7 }, memberId: 88 },
    { club: { isOwner: false, viewerIsAdmin: true, id: 7 }, memberId: 91 },
  ].forEach((viewer) => {
    const page = loadPage(DETAIL);
    navigations.length = 0;
    page.data.club = viewer.club;
    page.data.clubId = 7;
    page.goMemberProfile({ currentTarget: { dataset: { memberId: viewer.memberId } } });
    assert.deepEqual(navigations, [], '有权限时先弹清单,不直接跳');
    assert.equal(page.data.choiceSheetShow, true);
    assert.deepEqual(page.data.choiceSheetItems.map((i) => i.key), ['public', 'customer'],
      '入口按裁决固定为「公开资料 + 客户档案」');

    navigations.length = 0;
    page.onChoiceSheetSelect({ currentTarget: { dataset: { key: 'customer' } } });
    assert.deepEqual(navigations, ['/pages/club/customer-detail/index?clubId=7&memberId=' + viewer.memberId],
      '客户档案直达该成员在本俱乐部的 CRM 客户详情,沿用客户列表 openCustomer 的路由');

    navigations.length = 0;
    page.goMemberProfile({ currentTarget: { dataset: { memberId: viewer.memberId } } });
    page.onChoiceSheetSelect({ currentTarget: { dataset: { key: 'public' } } });
    assert.deepEqual(navigations, ['/pages/userinfo/userinfo?userId=' + viewer.memberId],
      '选「公开资料」仍进公开主页');
  });

  // CRM 客户列表整页入口没被砍掉:设置 → 查看客户。
  const pageList = loadPage(DETAIL);
  navigations.length = 0;
  pageList.data.club = { isOwner: true, viewerIsAdmin: false, id: 7 };
  pageList.data.clubId = 7;
  pageList.goCustomers();
  assert.deepEqual(navigations, ['/pages/club/customers/index?clubId=7']);

  assert.doesNotMatch(script, /phone\s*\.\s*(slice|substr|substring|replace)|match\(\s*\/\\d/,
    '成员点击不得在客户端拆解原始手机号');
});

test('俱乐部成员资料:仅展示服务端给出的真实等级', () => {
  const template = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.wxml'), 'utf8');
  const mapper = fs.readFileSync(path.join(__dirname, '../../../chengyinhub-system/src/main/resources/mapper/business/ClubMemberMapper.xml'), 'utf8');

  assert.match(template, /item\.levelId\s*!=\s*null\s*&&\s*item\.levelId\s*>\s*0/);
  assert.match(template, /Lv\.\{\{item\.levelId\}\}/);
  assert.doesNotMatch(template, /item\.levelId\s*\|\|\s*1/);
  assert.match(mapper, /<result property="levelId"\s+column="level_id"/);
  // RUN-13(拍板 2026-09-19 第4条):名单等级单一真源 = player_growth(coalesce 兜底 Lv.1),
  // 旧 ums_member.level_id 不得再回潮。
  assert.match(mapper, /coalesce\(pg\.level,\s*1\)\s+as\s+level_id/);
  assert.match(mapper, /left join player_growth pg on pg\.member_id = cm\.member_id/);
  assert.doesNotMatch(mapper, /m\.level_id\s+as\s+level_id/);
});

test('俱乐部主页不在首屏拉或展示收益;分润只在主理人打开设置弹窗后出现', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../../pages/club/detail/index.wxml'), 'utf8');
  assert.doesNotMatch(script, /\/api\/coop\/finance|loadRevenueSummary|summarizeRevenue/);

  // 2026-09-09:稿 M 268:223 在管理弹窗里给了「俱乐部分润 ¥128.00」,这条不再是「一个数都不许有」。
  // 要守住的变成两件:①金额不在首屏/概览,只在主理人点开设置弹窗之后 ②前端一分钱都不算。
  const opener = script.match(/loadSettingsCounts\(\)\s*\{[\s\S]*?\n  \},/);
  assert.ok(opener, '分润读取必须收在 loadSettingsCounts 里');
  assert.match(opener[0], /\/api\/club\/settlement\/summary/);
  assert.match(opener[0], /club\.isOwner/, '只有主理人才去读这个数');
  const outsideOpener = script.replace(opener[0], '');
  assert.doesNotMatch(outsideOpener, /\/api\/club\/settlement\/summary/,
    '首屏加载链路上不许出现分润请求');
  assert.match(script, /res\.data\.settledAmountText/, '金额由服务端格式化好,前端只透传');
  assert.doesNotMatch(script, /settledAmount\s*[*/+-]/, '前端不许对金额做任何运算');

  // 概览/帖子/活动三个公开 tab 里一个收益字样都不许有
  const sheetAt = template.indexOf('<cy-sheet show="{{settingsShow}}"');
  assert.ok(sheetAt > 0);
  assert.doesNotMatch(template.slice(0, sheetAt), /已结算收益|待结算|分账|settledAmountText/);
});

test('创建俱乐部成功:直接进入该俱乐部管理页', () => {
  const page = loadPage(CREATE);
  Object.assign(page.data, { bootstrapState: 'ready', clubType: '兴趣社群', name: '夜行俱乐部', city: '上海' });
  page.submit();
  assert.equal(sent.url, '/api/club/create');
  sent.success({ code: '200', data: { clubId: 77 } });
  assert.equal(page.data.submitState, 'success', '成功后先留下可读回执');
  page.goCreatedClub();

  assert.deepEqual(redirects, ['/pages/club/detail/index?id=77']);
});
