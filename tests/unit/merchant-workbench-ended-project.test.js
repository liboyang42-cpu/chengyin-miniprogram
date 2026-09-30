// 2026-09-16 用户裁决:「项目已结束就不显示了」。
// 契约:工作台首页项目卡过滤掉已结束项目、右上角「全部 N」只数未结束的、
// 过滤后为空走现有空态;完整列表页不动,历史项目仍可在那里查到。
// 判据必须复用卡片自己的状态签(statusLabel / isEndedProject),不另算一套日期。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PAGE_PATH = path.join(ROOT, 'pages/merchant/index/index.js');
const { buildProjectCards, isEndedProject } = require('../../utils/merchant-workbench.js');

const TODAY = '2026-09-16';

let pageConfig;
let requests = [];

global.getApp = () => ({
  globalData: { statusBarHeight: 44, navBarHeight: 44 },
  getUserID: () => 9,
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  sendRequest: (request) => { requests.push(request); },
});

global.wx = {
  getStorageSync: () => '',
  setStorageSync() {},
  getWindowInfo: () => ({ statusBarHeight: 44 }),
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
  showToast() {},
  switchTab() {},
  navigateTo() {},
  stopPullDownRefresh() {},
  setNavigationBarColor() {},
  setBackgroundColor() {},
  setNavigationBarTitle() {},
};

global.Page = (config) => { pageConfig = config; };

function loadPage() {
  requests = [];
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  page._dataEpoch = 1;
  page._dataMemberId = '9';
  page._merchantGameEntries = [];
  page._gameSessionClient = null;
  return page;
}

function assertNoEndedCard(cards) {
  assert.equal(
    (cards || []).some((card) => card && card.statusLabel === '已结束'),
    false,
    '已结束项目不得出现在工作台卡片列表',
  );
}

test('工作台项目卡过滤已结束项目,未开始/进行中/档期未知都保留', () => {
  const page = loadPage();
  page.data.projectList = [
    { id: 1, topicId: 1, topicName: '已结束的路线', startDate: '2000-01-01', endDate: '2000-01-02' },
    { id: 2, topicId: 2, topicName: '进行中的路线', startDate: '2000-01-01', endDate: '2999-12-31' },
    { id: 3, topicId: 3, topicName: '还没开始的路线', startDate: '2999-12-01' },
    { id: 4, topicId: 4, topicName: '档期未知的路线' },
  ];
  page.data.hostProjectList = [
    { id: 9, bizType: 'activity', titleText: '已结束的活动', startTime: '2000-01-01', endTime: '2000-01-02' },
  ];

  page.data.todo = { byProject: [] };
  page.data.todoError = false;
  page.refreshProjectCards();

  assertNoEndedCard(page.data.projectCards);
  assert.deepEqual(page.data.projectCards.map((card) => card.title), [
    '进行中的路线', '还没开始的路线', '档期未知的路线',
  ], '档期未知不是结束,不能静默吞掉');
});

test('过滤后没有卡片时隐藏项目整块', () => {
  const page = loadPage();
  page.data.projectList = [
    { id: 1, topicId: 1, topicName: '已结束的路线', startDate: '2000-01-01', endDate: '2000-01-02' },
  ];
  page.data.todo = { byProject: [] };
  page.data.todoError = false;
  page.refreshProjectCards();

  assert.deepEqual(page.data.projectCards, []);
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/merchant/index/index.wxml'), 'utf8');
  assert.match(wxml, /merchantAccess\.canManageProjects && \(projectCards\.length \|\| joinLoading \|\| hostLoading/,
    '项目整块只在有卡片、加载中或失败时出现');
  assert.doesNotMatch(wxml, /title="还没有项目"/,
    '项目为零时不保留空态占位');
});

test('「全部 N」只数未结束的项目:承接与主办两侧都按状态签真源计数', () => {
  const page = loadPage();
  page.loadJoinList(1);
  const joinRequest = requests.find((item) => item.url === '/api/registration/merchant/list');
  assert.ok(joinRequest);
  joinRequest.success({
    code: 200,
    data: {
      rows: [
        { id: 1, topicId: 1, topicName: '已结束', startDate: '2000-01-01', endDate: '2000-01-02' },
        { id: 2, topicId: 2, topicName: '进行中', startDate: '2000-01-01', endDate: '2999-12-31' },
        { id: 3, topicId: 3, topicName: '没结束的', startDate: '2999-12-01' },
      ],
    },
  });
  assert.equal(page.data.joinTotal, 2, 'joinTotal 不得把已结束项目算进去');

  page.loadHostProjects(1);
  const hostRequest = requests.find((item) => item.url === '/api/project/my');
  assert.ok(hostRequest);
  hostRequest.success({
    code: 200,
    data: {
      rows: [
        { id: 9, bizType: 'activity', titleText: '已结束的活动', startTime: '2000-01-01', endTime: '2000-01-02' },
        { id: 10, bizType: 'topic', titleText: '进行中的主题', startTime: '2000-01-01', endTime: '2999-12-31' },
      ],
      total: 30,
      activeTotal: 28,
    },
  });
  assert.equal(page.data.hostProjectTotal, 28,
    'hostProjectTotal 必须用后端下发的全量未结束总数,不能数当前这一页');
});

test('工作台把已通过且供给生效的章节承接投影为可进入的项目卡', () => {
  const page = loadPage();
  page.loadChapterProjectList(1);
  const request = requests.find((item) => item.url === '/api/merchant/chapter-application/mine');
  assert.ok(request, '章节承接必须读取权威 application/offer 投影');
  request.success({
    code: 200,
    data: [
      { id: 71, topicId: 990027, topicName: 'E2E 探店日一期', chapterId: 31,
        chapterName: '咖啡章节', status: 1, offerActive: true },
      { id: 72, topicId: 990028, topicName: '仍在申请', chapterId: 32,
        chapterName: '书店章节', status: 0, offerActive: false },
    ],
  });

  // chapterProjectList 只喂 projectCards 计算、不进 WXML,已按死数据字段门禁移出 data;
  // 断言内容不变:两行里只有「已通过且供给生效」那一行被留下。
  assert.equal(page._chapterProjectList.length, 1);
  assert.equal(page.data.projectCards.length, 1);
  assert.equal(page.data.projectCards[0].ownerId, 990027);
  assert.equal(page.data.projectCards[0].projectSource, 'chapter');

  const navigations = [];
  global.wx.navigateTo = (options) => navigations.push(options.url);
  page.openProjectCard({ currentTarget: { dataset: {
    role: 'join', id: 71, topicid: 990027, source: 'chapter',
  } } });
  assert.equal(navigations.at(-1),
    '/pages/topic/merchantinfo/merchantinfo?topicId=990027&scope=MERCHANT');
});

test('已结束判据与卡片状态签同源:复用 isEndedProject,不另算日期', () => {
  assert.equal(isEndedProject('2026-09-01', '2026-09-02', TODAY), true);
  assert.equal(isEndedProject('2026-09-10', '2026-09-20', TODAY), false);
  assert.equal(isEndedProject('2026-10-01', '', TODAY), false);
  assert.equal(isEndedProject('', '', TODAY), false, '档期未知不算结束');

  const source = fs.readFileSync(PAGE_PATH, 'utf8');
  assert.match(source, /\.filter\(\(card\) => card\.statusLabel !== '已结束'\)/,
    '卡片过滤必须消费卡片自己的状态签');
  assert.match(source, /isEndedProject\(item\.startDate, item\.endDate, today\)/,
    '承接总数必须复用 isEndedProject');
  assert.match(source, /finiteCount\(res\.data\.activeTotal\)/,
    '主办总数必须读后端下发的全量未结束项目总数(不能数被截断的这一页)');
  assert.doesNotMatch(source, /只数这一页/,
    '按页计数的 ponytail 说明与逻辑必须删除');
});

test('负控:主办总数若回到只数当前页,与后端全量总数会对不上必须判红', () => {
  const page = loadPage();
  page.loadHostProjects(1);
  const hostRequest = requests.find((item) => item.url === '/api/project/my');
  hostRequest.success({
    code: 200,
    data: {
      rows: [
        { id: 10, bizType: 'topic', titleText: '进行中的主题', startTime: '2000-01-01', endTime: '2999-12-31' },
        { id: 11, bizType: 'topic', titleText: '还没开始的主题', startTime: '2999-12-01', endTime: '2999-12-02' },
      ],
      total: 12,
      activeTotal: 12,
    },
  });
  const pageCount = 2; // 只数当前页时会是 2
  assert.notEqual(pageCount, page.data.hostProjectTotal,
    '把总数换回本页计数时,「用后端全量数」的断言必须不再成立');
  assert.throws(() => assert.equal(pageCount, page.data.hostProjectTotal), assert.AssertionError);
});

test('负控:去掉已结束过滤后,卡片列表会重新出现已结束项目,门禁必须判红', () => {
  const source = fs.readFileSync(PAGE_PATH, 'utf8');
  const anchor = "    }).filter((card) => card.statusLabel !== '已结束');";
  assert.ok(source.includes(anchor), '负控锚点失效:找不到卡片过滤');
  const mutated = source.replace(anchor, '    });');

  const tmp = path.join(ROOT, 'pages/merchant/index/.index.mutant.js');
  fs.writeFileSync(tmp, mutated);
  try {
    delete require.cache[require.resolve(tmp)];
    require(tmp);
    const page = Object.assign({}, pageConfig);
    page.data = JSON.parse(JSON.stringify(pageConfig.data));
    page.setData = function (patch) { Object.assign(this.data, patch); };
    page.data.projectList = [
      { id: 1, topicId: 1, topicName: '已结束的路线', startDate: '2000-01-01', endDate: '2000-01-02' },
    ];
    page.data.todo = { byProject: [] };
    page.data.todoError = false;
    page.refreshProjectCards();

    assert.throws(() => assertNoEndedCard(page.data.projectCards), /已结束项目不得出现在工作台卡片列表/);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('负控:把已结束项目重新算进「全部 N」时必须判红', () => {
  const page = loadPage();
  page.loadJoinList(1);
  const joinRequest = requests.find((item) => item.url === '/api/registration/merchant/list');
  joinRequest.success({
    code: 200,
    data: {
      rows: [
        { id: 1, topicId: 1, topicName: '已结束', startDate: '2000-01-01', endDate: '2000-01-02' },
        { id: 2, topicId: 2, topicName: '进行中', startDate: '2000-01-01', endDate: '2999-12-31' },
      ],
    },
  });
  // 变异检查器:把总数换回 list.length 就会让下面这条断言不成立
  const legacyTotal = 2; // list.length
  assert.notEqual(legacyTotal, page.data.joinTotal,
    '把总数换回未过滤的 list.length 时,「只数未结束」的断言必须不再成立');
  assert.throws(() => assert.equal(legacyTotal, page.data.joinTotal), assert.AssertionError);
});
