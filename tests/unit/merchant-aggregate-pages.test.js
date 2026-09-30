const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const {
  normalizeRelationHome,
  normalizeMarketingHome,
} = require('../../pages/merchant/utils/merchant-aggregate.js');

test('关系首页只接纳完整聚合合同并保留三类关系数据', () => {
  const result = normalizeRelationHome({
    stats: { merchantCount: 2, clubCount: '3', pendingCoopCount: 1 },
    relations: [{ id: 11, partnerType: 'merchant' }],
    discovery: { merchants: [{ id: 21 }], clubs: [{ id: 31 }] },
  });

  assert.deepEqual(result.stats, { merchantCount: 2, clubCount: 3, pendingCoopCount: 1 });
  assert.equal(result.relations[0].id, 11);
  assert.equal(result.merchants[0].id, 21);
  assert.equal(result.clubs[0].id, 31);
});

test('关系首页拒绝 200 加空对象，不能伪装成成功空态', () => {
  assert.equal(normalizeRelationHome({}), null);
  assert.equal(normalizeRelationHome({ stats: {}, relations: [], discovery: null }), null);
  assert.equal(normalizeRelationHome({
    stats: { merchantCount: 0, clubCount: 0 },
    relations: [], discovery: { merchants: [], clubs: [] },
  }), null);
});

function analyticsPayload(windowDays = 30) {
  const day = 24 * 60 * 60 * 1000;
  const endExclusive = Date.parse('2026-08-23T16:00:00.000Z');
  const currentStartInclusive = endExclusive - windowDays * day;
  const previousStartInclusive = currentStartInclusive - windowDays * day;
  return {
    semantics: 'INDEPENDENT_EVENT_COUNTS',
    windowDays,
    window: {
      timezone: 'Asia/Shanghai',
      basis: 'COMPLETE_CALENDAR_DAYS',
      previousStartInclusive,
      currentStartInclusive,
      endExclusive,
    },
    stages: [
      { code: 'BROWSE', label: '浏览', currentCount: 120, previousCount: 100, changeRate: '0.2000' },
      { code: 'SIGNUP', label: '报名', currentCount: 24, previousCount: 20, changeRate: '0.2000' },
      { code: 'PAYMENT', label: '支付', currentCount: 18, previousCount: 0, changeRate: null },
      { code: 'VERIFY', label: '核销', currentCount: 12, previousCount: 15, changeRate: '-0.2000' },
      { code: 'REFUND_APPLY', label: '退款申请', currentCount: 2, previousCount: 1, changeRate: '1.0000' },
    ],
    touchpoints: {
      coverage: 'PARTIAL',
      attributed: false,
      items: [
        { code: 'IN_APP_TOPIC', label: '主题入口', eventCount: 16 },
        { code: 'IN_APP_ACTIVITY', label: '活动入口', eventCount: 8 },
        { code: 'UNATTRIBUTED', label: '未归因', eventCount: 0 },
      ],
    },
  };
}

test('营销首页从一个聚合响应生成招募、券、内容和独立事件分析', () => {
  const result = normalizeMarketingHome({
    recruiting: { count: 4, items: [{ id: 1 }] },
    coupons: { couponCount: 2, received: 8, verified: 3 },
    content: { topicCount: 5, freeExploreCount: 1, activityCount: 2 },
    analytics: analyticsPayload(30),
  });

  assert.equal(result.recruiting.count, 4);
  // CU-M-51/M-86:couponCount 改成「在投放」后,归一化新增 couponTotal(总券数)。
  // 老 jar 不传 couponTotal 时退回 couponCount,所以这里也钉住缺省行为。
  assert.deepEqual(result.coupons, { couponCount: 2, couponTotal: 2, received: 8, verified: 3 });
  assert.deepEqual(result.content, { topicCount: 5, freeExploreCount: 1, activityCount: 2 });
  assert.equal(result.analytics.semantics, 'INDEPENDENT_EVENT_COUNTS');
  assert.equal(result.analytics.stages[2].changeRate, null, '上一期为 0 时不能伪造环比');
  assert.deepEqual(result.analytics.touchpoints.items.map((item) => item.code), [
    'IN_APP_TOPIC', 'IN_APP_ACTIVITY', 'UNATTRIBUTED',
  ]);
});

test('营销首页拒绝缺字段合同且把脏计数收敛为零', () => {
  assert.equal(normalizeMarketingHome({ recruiting: {}, coupons: {}, content: {} }), null);
  const result = normalizeMarketingHome({
    recruiting: { count: 1.8, items: [] },
    coupons: { couponCount: 2.9, received: 0, verified: 0 },
    content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
    analytics: analyticsPayload(7),
  });
  assert.equal(result.recruiting.count, 1);
  assert.equal(result.coupons.couponCount, 2);
  assert.equal(normalizeMarketingHome({
    recruiting: { count: 0, items: [] }, coupons: { couponCount: 0, received: 0, verified: 0 },
    content: { topicCount: 0, freeExploreCount: 0 }, analytics: analyticsPayload(30),
  }), null);
});

test('营销分析拒绝转化漏斗、非法窗口和伪渠道归因合同', () => {
  const base = {
    recruiting: { count: 0, items: [] },
    coupons: { couponCount: 0, received: 0, verified: 0 },
    content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
  };
  assert.equal(normalizeMarketingHome(Object.assign({}, base, {
    analytics: Object.assign(analyticsPayload(30), { semantics: 'ADJACENT_CONVERSION_FUNNEL' }),
  })).analytics, null);
  assert.equal(normalizeMarketingHome(Object.assign({}, base, {
    analytics: Object.assign(analyticsPayload(30), { windowDays: 14 }),
  })).analytics, null);
  assert.equal(normalizeMarketingHome(Object.assign({}, base, {
    analytics: Object.assign(analyticsPayload(30), {
      touchpoints: Object.assign({}, analyticsPayload(30).touchpoints, { attributed: true }),
    }),
  })).analytics, null);
  assert.equal(normalizeMarketingHome(Object.assign({}, base, {
    analytics: Object.assign(analyticsPayload(30), {
      window: Object.assign({}, analyticsPayload(30).window, { timezone: 'UTC' }),
    }),
  })).analytics, null, '营销自然日必须显式使用 Asia/Shanghai，不能跟随 JVM/设备时区');
  assert.equal(normalizeMarketingHome(Object.assign({}, base, {
    analytics: Object.assign(analyticsPayload(30), {
      window: Object.assign({}, analyticsPayload(30).window, {
        endExclusive: analyticsPayload(30).window.endExclusive + 1,
      }),
    }),
  })).analytics, null, '上界必须落在北京时间 00:00 且保持半开区间');
});

function loadPage(relativePath, app) {
  const absolute = path.join(__dirname, '../..', relativePath);
  delete require.cache[require.resolve(absolute)];
  let config;
  global.getApp = () => Object.assign({ getUserID: () => 'member-1' }, app);
  global.wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateTo() {},
    switchTab() {},
    reLaunch() {},
    setNavigationBarColor() {},
    setBackgroundColor() {},
  };
  global.Page = value => { config = value; };
  require(absolute);
  config.data = JSON.parse(JSON.stringify(config.data));
  config.setData = patch => Object.assign(config.data, patch);
  return config;
}

test('关系一级页首屏只通过 relation-home 读取关系聚合', () => {
  const requests = [];
  const page = loadPage('pages/merchant/relation/index.js', {
    globalData: {},
    sendRequest(options) { requests.push(options); },
  });

  page.onLoad();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/merchant/relation-home');
  assert.equal(requests[0].method, 'POST');
});

test('关系一级页过滤缺少名称的半成品关系卡', () => {
  const requests = [];
  const page = loadPage('pages/merchant/relation/index.js', {
    globalData: {},
    sendRequest(options) { requests.push(options); },
  });

  page.onLoad();
  requests[0].success({
    code: 200,
    data: {
      stats: { merchantCount: 1, clubCount: 1, pendingCoopCount: 0 },
      relations: [{ id: 1, partnerId: 1, partnerType: 'merchant' }],
      discovery: {
        merchants: [{ id: 2, name: { raw: true } }],
        clubs: [{ id: 3, name: '外滩夜行俱乐部' }],
      },
    },
  });

  assert.equal(page.data.merchants.length, 0);
  assert.equal(page.data.clubs.length, 1);
  // 2026-08-09:「我的合作」已删,relations 即使后端还在下发也不进 data。
  assert.equal(page.data.relations, undefined);
});

test('关系聚合 403 清除旧门店数据并静默回会员中心，不冒充岗位权限也不摆整屏闸', () => {
  const requests = [];
  const navigations = [];
  const page = loadPage('pages/merchant/relation/index.js', {
    globalData: {},
    getRequestErrorMessage: () => '当前岗位没有合作权限',
    sendRequest(options) { requests.push(options); },
    getUserID: () => 'member-1',
  });
  global.wx.switchTab = (options) => { navigations.push(options.url); };

  page.onLoad();
  requests[0].success({
    code: 200,
    data: {
      stats: { merchantCount: 1, clubCount: 0, pendingCoopCount: 0 },
      relations: [],
      discovery: {
        merchants: [{ id: 2, memberId: 20, name: '旧门店' }],
        clubs: [],
      },
    },
  });
  requests[0].complete();
  assert.equal(page.data.merchants.length, 1);

  page.loadRelationHome();
  requests[1].success({ code: 403, msg: '商家身份无效或权限不足' });

  assert.deepEqual(navigations, ['/pages/member/index/index'],
    '无商家身份的深链误入静默回会员中心,不摆整屏错误页');
  assert.equal(page.data.merchants.length, 0, '403 后不得继续显示上一经营主体的商家数据');
  assert.equal(page.data.clubs.length, 0);
});

test('营销一级页先确认商家岗位，再用 marketing-home 替代分散首页请求', () => {
  const requests = [];
  const page = loadPage('pages/merchant/marketing/index.js', {
    globalData: {},
    getUserID: () => 9,
    sendRequest(options) { requests.push(options); },
  });

  page.onLoad();
  page.onShow();

  assert.deepEqual(requests.map(item => item.url), ['/api/merchant/access/me']);
  requests[0].success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_MARKETING',
      permissions: ['merchant:basic:read', 'merchant:marketing:read', 'merchant:marketing:write'],
    },
  });
  assert.deepEqual(requests.map(item => item.url), [
    '/api/merchant/access/me',
    '/api/merchant/marketing-home?windowDays=30',
  ]);
  assert.equal(requests.some(item => item.url === '/api/merchant/info'), false,
    '营销首页只需 access/me 的商家摘要，不应额外请求 PROFILE_WRITE 接口');
});

test('营销一级页 hero 取 30 天 analytics.stages 的报名/核销,不再渲染经营事件区', () => {
  const requests = [];
  const page = loadPage('pages/merchant/marketing/index.js', {
    globalData: {},
    getUserID: () => 9,
    getRequestErrorMessage: () => '营销数据加载失败',
    sendRequest(options) { requests.push(options); },
  });

  page.onLoad();
  page.onShow();
  requests.find(item => item.url === '/api/merchant/access/me').success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_MARKETING',
      permissions: ['merchant:basic:read', 'merchant:marketing:read'],
    },
  });
  const marketing = requests.find(item => item.url === '/api/merchant/marketing-home?windowDays=30');
  assert.equal(marketing.data, undefined,
    'Spring 接口按 @RequestParam 绑定窗口，不能继续把 windowDays 放在 JSON body');
  marketing.success({
    code: 200,
    data: {
      recruiting: { count: 0, items: [] },
      coupons: { couponCount: 0, received: 0, verified: 0 },
      content: { topicCount: 0, freeExploreCount: 0, activityCount: 0 },
      analytics: analyticsPayload(30),
    },
  });
  // 2026-08-26 营销页重做:两个指标不再是 statCards,报名量升成 hero、核销退到副行。
  // 规则不变 —— 这一级页只展示这两个,不许再冒出第三个指标(尤其是已下线的曝光量)。
  // ★数据源是 analytics.stages(报名 24 / 核销 12),不是 home.funnel ——
  //   后端把 funnel 固定回空数组,只为兼容旧版小程序不报错,读它永远拿不到数。
  // ★副行只报核销绝对数,**不报核销率**:五步是各自发生过的事件数,相邻步骤可能跨窗口,
  //   拿这一屏的核销除以这一屏的报名不是同一批人,那个百分比是个算错的数字。
  assert.equal(page.data.hero.value, '24');
  assert.equal(page.data.hero.sub, '核销 12');

  // 2026-09-18 UI-09:按用户稿 p07zJMtMOc1yT1AuLTKtSs 37:2 删掉「经营事件」区块(窗口切换 +
  // 五步事件卡 + 入口触点),页面不再产出 stageCards/touchpoints,也没有 7 天窗口请求。
  assert.equal(page.data.stageCards, undefined);
  assert.equal(page.selectWindow, undefined);
});

test('没有营销读权限的岗位看到明确受限态且不请求聚合数据', () => {
  const requests = [];
  const page = loadPage('pages/merchant/marketing/index.js', {
    globalData: {},
    getUserID: () => 9,
    getRequestErrorMessage: (res, fallback) => fallback,
    sendRequest(options) { requests.push(options); },
  });

  page.onLoad();
  page.onShow();
  requests[0].success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 7, name: '测试门店' },
      roleCode: 'MERCHANT_CHECKIN',
      permissions: ['merchant:basic:read', 'merchant:verify'],
    },
  });

  // 2026-08-26 重做:权限结论字段从 marketingState 换成 accessState(未登录/无权限已拆开)
  assert.equal(page.data.accessState, 'denied');
  assert.equal(requests.some(item => item.url === '/api/merchant/marketing-home'), false);
});

test('商家内容入口携带 MERCHANT scope，空活动去合作而不是冒充俱乐部发布', () => {
  const navigations = [];
  const page = loadPage('pages/merchant/marketing/index.js', {
    globalData: {},
    getUserID: () => 9,
    sendRequest() {},
  });
  global.wx.navigateTo = ({ url }) => navigations.push(url);
  page.data.merchantAccess = {
    active: true,
    canManageProjects: true,
  };

  page.goMyContent({ currentTarget: { dataset: { key: 'topic', count: 0 } } });
  page.goMyContent({ currentTarget: { dataset: { key: 'free', count: 0 } } });
  page.goMyContent({ currentTarget: { dataset: { key: 'activity', count: 0 } } });
  page.goMyContent({ currentTarget: { dataset: { key: 'activity', count: 2 } } });

  assert.deepEqual(navigations, [
    '/pages/publish/fabu/index?scope=MERCHANT',
    '/pages/publish/fabu/index?mode=2&scope=MERCHANT',
    '/pages/merchant/coop-center/index',
    '/subpackageA/pages/myproject/index?type=club_activity&scope=MERCHANT',
  ]);
  assert.equal(navigations.includes('/pages/publish/activity/index'), false,
    '活动发布后端只允许俱乐部主理人，商家零活动时应去合作中心');
});

test('商家一级导航保持五格且关系域对用户显示为合作', () => {
  const absolute = path.join(__dirname, '../../components/tabBar/index.js');
  delete require.cache[require.resolve(absolute)];
  let component;
  global.Behavior = value => value;
  global.Component = value => { component = value; };
  require(absolute);
  const instance = {
    data: { mode: 'merchant', list: [] },
    setData(patch) { Object.assign(this.data, patch); },
  };

  component.methods.applyMode.call(instance);

  assert.deepEqual(instance.data.list.map(item => [item.key, item.text]), [
    ['workbench', '工作台'],
    ['marketing', '营销'],
    ['template', '模板'],
    ['relation', '合作'],
    ['mine', '我的'],
  ]);
});

test('我的模板入口会让项目管理页直接打开模板 tab', () => {
  const page = loadPage('subpackageA/pages/myproject/index.js', {
    sendRequest() {},
  });

  page.onLoad({ type: 'template' });

  assert.equal(page.data.typeTab, 'template');
});

// 「今日待办」区块已并进项目卡(中标主题数由卡片列表本身表达),
// 原来的 _resolveProjectState 空态文案随之退役。
test('项目卡按 (ownerType,ownerId) 拿各自的待办与动态，活动和主题同一套口径', () => {
  const page = loadPage('pages/merchant/index/index.js', {
    globalData: {},
  });

  page.data.projectList = [{ id: 11, topicId: 77, topicName: '外滩夜游', assignmentText: '第2章' }];
  page.data.hostProjectList = [
    { id: 88, bizType: 'topic', titleText: '建筑可阅读', startDateStr: '周六 8月10日' },
    // 活动 id 故意和主题 id 撞号:两套 id 各自编号，只用 id 当键会串号
    { id: 77, bizType: 'activity', titleText: '夏夜市集', startDateStr: '周日 8月11日' },
  ];
  page.data.notifications = [
    { id: 0, ownerType: 1, ownerId: 77, label: '核销' },
    { id: 1, ownerType: 1, ownerId: 77, label: '收入到账' },
    { id: 2, ownerType: 2, ownerId: 77, label: '活动分润' },
    { id: 3, label: '没有项目归属的动态' },
  ];
  page.data.todo = {
    pendingVerify: 5, pendingScanConfirm: 1, pendingOrders: 2, refundCount: 0, biddingTopics: 1, verifiedCount: 0,
    byProject: [
      { ownerType: 1, ownerId: 77, pendingVerify: 3, pendingScanConfirm: 1 },
      { ownerType: 2, ownerId: 77, pendingVerify: 2, pendingScanConfirm: 0 },
    ],
  };

  page.refreshProjectCards();

  const [join, host, activity] = page.data.projectCards;
  assert.equal(join.roleName, '承接');
  assert.deepEqual(join.todoChips.map((chip) => [chip.label, chip.count]), [['待核销', 3], ['待扫码', 1]]);
  assert.equal(join.msgCount, 2, '没有 topicId 的动态不许算进任一张卡');
  assert.equal(host.roleName, '主办');
  assert.deepEqual(host.todoChips, []);
  assert.equal(host.todoText, '今日无待办');
  assert.equal(host.msgCount, 0);
  // 活动 #77 和主题 #77 撞号:各拿各的,不许互相串
  assert.equal(activity.roleName, '主办');
  assert.equal(activity.bizType, 'activity');
  assert.deepEqual(activity.todoChips.map((chip) => [chip.label, chip.count]), [['待核销', 2]]);
  assert.equal(activity.msgCount, 1, '活动只认 ownerType=2 那条动态');

  // 后端还没带 byTopic(小程序先于 ECS 上线的窗口)时,不许替后端宣布"今日无待办"
  page.data.todo = Object.assign({}, page.data.todo, { byProject: undefined });
  page.refreshProjectCards();
  assert.equal(page.data.projectCards[0].todoText, '',
    '待办没取到时卡上这格留空：不谎报"无待办"，也不在每张卡上写报错文案');
});

// 2026-09-23 裁决(CU-C-22):俱乐部主理人可发独立单场活动,原来全站没有新建入口。
test('我的项目:俱乐部主理人在活动页签有「发布单场活动」入口,商家口径与非主理人没有', () => {
  const guardPath = require.resolve(path.join(__dirname, '../../utils/roleGuard.js'));
  const real = require.cache[guardPath];
  const withGuard = (isLeader, options) => {
    require.cache[guardPath] = { id: guardPath, filename: guardPath, loaded: true,
      exports: { role: () => (isLeader ? 'club' : 'merchant'), load: (cb) => cb && cb(), hasSnapshot: () => true } };
    const navigations = [];
    const page = loadPage('subpackageA/pages/myproject/index.js', { sendRequest() {} });
    global.wx.navigateTo = (o) => navigations.push(o.url);
    page.onLoad(options);
    return { page, navigations };
  };
  try {
    const leader = withGuard(true, { type: 'club_activity' });
    assert.equal(leader.page.data.canPublishActivity, true);
    leader.page.applyView();   // 真机上在项目列表回来后调用
    assert.equal(leader.page.data.emptySub, '在这里发布你的第一场单场活动', '只对能发的人给发布提示');
    leader.page.onEmptyCta();
    assert.deepEqual(leader.navigations, ['/pages/publish/activity/index'], '活动页签空态按钮进活动发布页');
    assert.equal(withGuard(true, { type: 'club_activity', scope: 'MERCHANT' }).page.data.canPublishActivity, false,
      '商家口径不给(商家发布活动另行立项)');
    const other = withGuard(false, { type: 'club_activity' });
    assert.equal(other.page.data.canPublishActivity, false);
    other.page.applyView();
    assert.equal(other.page.data.emptySub, '', '不能发的人不给「可以在这里发布」的空头提示');
    const wxml = require('node:fs').readFileSync(path.join(__dirname, '../../subpackageA/pages/myproject/index.wxml'), 'utf8');
    assert.match(wxml, /typeTab === 'activity' && canPublishActivity && list\.length > 0[\s\S]*?bindtap="goCreateActivity"/,
      '有活动时也要有常驻入口,不能只藏在空态里');
  } finally {
    if (real) require.cache[guardPath] = real; else delete require.cache[guardPath];
  }
});
