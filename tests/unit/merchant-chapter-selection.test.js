const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { attachDangerConfirm } = require('./helpers/danger-confirm-stub')

const PAGE = '../../pages/topic/merchantinfo/merchantinfo.js';
const WXML = fs.readFileSync(path.resolve(__dirname, '../../pages/topic/merchantinfo/merchantinfo.wxml'), 'utf8');
const PICKER_WXML = fs.readFileSync(path.resolve(
  __dirname,
  '../../pages/topic/components/cy/chapter-target-picker/index.wxml',
), 'utf8');
const CMS_TOPIC_NODE = fs.readFileSync(path.resolve(
  __dirname,
  '../../../chengyinhub-system/src/main/java/com/chengyinhub/business/domain/CmsTopicNode.java',
), 'utf8');

let pageConfig;
let navigations;
let toasts;
let tips;
let requests;
let modals;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 1,
  sendRequest: (request) => requests.push(request),
  tips: (message) => tips.push(message),
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
});
global.wx = {
  navigateTo: (options) => navigations.push(options),
  showToast: (options) => toasts.push(options),
  showLoading: () => {},
  hideLoading: () => {},
  navigateBack: () => {},
  openLocation: () => {},
  pageScrollTo: () => {},
  showModal: (options) => modals.push(options),
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  navigations = [];
  toasts = [];
  tips = [];
  requests = [];
  modals = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch) => Object.assign(page.data, patch);
  return page;
}

function requestByUrl(url) {
  return requests.find(request => request.url === url);
}

function withdrawControlVisible(application) {
  const tag = WXML.match(/<cy-btn\b[^>]*bindtap="withdrawChapterApplication"[^>]*>/);
  if (!tag) return false;
  const condition = tag[0].match(/wx:if="\{\{([^}]+)\}\}"/);
  if (!condition) return true;
  const field = condition[1].trim().match(/^application\.([A-Za-z][A-Za-z0-9]*)$/);
  if (!field) throw new Error('撤回入口使用了测试无法解释的条件: ' + condition[1]);
  return Boolean(application[field[1]]);
}

test('自由探索点申请承接先打开点位表单，不提前写入申请', () => {
  const page = makePage();
  Object.assign(page.data, {
    isJoin: 1,
    selectedMode: 2,
    selectedChapterId: 33,
    selectedNodeId: 99,
    selectedTemplateId: 88,
    topicId: 7,
    info: { merchantSignUpStartDate: '2026-08-01', merchantSignUpEndDate: '2026-08-08' },
  });

  page.goSettlement();

  assert.equal(navigations.length, 0);
  assert.equal(requests.length, 0);
  assert.equal(page.data.topicShow, false);
  assert.equal(page.data.chapterNodeFormVisible, true);
});

test('申请链路严格按 apply → node/submit 串联，不提前写生效供给', () => {
  const page = makePage();
  page.data.chapterNodeFormVisible = true;

  page.onChapterNodeFormSubmit({ detail: {
    chapterId: 33,
    message: '适合夜间活动',
    templateId: 88,
    name: '夜航咖啡',
    address: '星海街 8 号',
    xpValue: null,
  } });

  assert.equal(requests.length, 1, '首步只能提交承接申请');
  assert.equal(requests[0].url, '/api/merchant/chapter-application/apply');
  assert.equal(requests[0].header['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].data), { chapterId: 33, message: '适合夜间活动' });

  requests[0].success({ code: '200' });
  assert.equal(requests.length, 2, '申请闸通过后只能进入点位闸');
  assert.equal(requests[1].url, '/api/merchant/chapter-node/submit');
  assert.equal(requests[1].header['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[1].data), {
    chapterId: 33,
    templateId: 88,
    name: '夜航咖啡',
    address: '星海街 8 号',
    xpValue: null,
  });
  assert.equal(requestByUrl('/api/coop/offer/enroll'), undefined,
    '申请待审阶段不得越过 offer/enroll 的已批准授权闸');

  requests[1].success({ code: '200' });
  requests[1].complete();
  assert.equal(page.data.chapterNodeFormVisible, false, '申请和点位均成功后关闭表单');
});

test('apply 回复已申请时只续交点位，其他失败不越过申请闸', () => {
  const draft = {
    chapterId: 33, message: '', templateId: 88, name: '咖啡点', address: '', xpValue: 12,
  };
  const retryPage = makePage();
  retryPage.onChapterNodeFormSubmit({ detail: draft });
  requests[0].success({ code: '500', errorCode: 'CHAPTER_APPLICATION_EXISTS', msg: '文案可变' });
  assert.equal(requests[1].url, '/api/merchant/chapter-node/submit');

  requests = [];
  const failedPage = makePage();
  failedPage.onChapterNodeFormSubmit({ detail: draft });
  requests[0].success({ code: '500', msg: '章节已关闭招募' });
  assert.equal(requests.length, 1, '真实 apply 失败不得继续 submit');
  assert.equal(tips.at(-1), '章节已关闭招募');
});

test('apply 已存在冲突优先认稳定错误码，不依赖中文文案', () => {
  const page = makePage();
  page.onChapterNodeFormSubmit({ detail: {
    chapterId: 33,
    message: '',
    templateId: 88,
    name: '咖啡点',
    address: '',
    xpValue: 12,
  } });

  requests[0].success({
    code: '500',
    errorCode: 'CHAPTER_APPLICATION_EXISTS',
    msg: '状态已变更，请刷新',
  });

  assert.equal(requests.length, 2,
    '后端文案改字时，稳定码仍必须让申请链安全续到点位闸');
  assert.equal(requests[1].url, '/api/merchant/chapter-node/submit');
});

test('只有待审承接申请向商家显示撤回入口', () => {
  const page = makePage();
  page.data.myChapterApplications = [
    { id: 71, chapterId: 31, status: 0 },
    { id: 72, chapterId: 32, status: 1 },
    { id: 73, chapterId: 33, status: 2 },
  ];

  page.refreshMyChapterApplications();

  assert.equal(withdrawControlVisible(page.data.myChapterApplications[0]), true);
  assert.equal(withdrawControlVisible(page.data.myChapterApplications[1]), false);
  assert.equal(withdrawControlVisible(page.data.myChapterApplications[2]), false);
});

test('撤回待审申请须二次确认，取消确认不发请求', () => {
  // 2026-08-27:二次确认从 wx.showModal 换成 cy-danger-confirm 三段式,断言的意思不变 ——
  // 没确认就不许发请求;确认文案里必须写明「此操作不可撤销」。
  const page = makePage();
  const dc = attachDangerConfirm(page, { confirmHandler: 'onConfirmWithdrawApplication' });
  page.data.myChapterApplications = [{ id: 71, chapterId: 31, status: 0 }];

  page.withdrawChapterApplication({ currentTarget: { dataset: { applicationId: 71 } } });

  assert.equal(requests.length, 0);
  assert.equal(dc.opens.length, 1, '撤回必须先弹确认');
  assert.ok(
    dc.opens[0].action.consequences.some(item => item.text.includes('此操作不可撤销')),
    '不可逆动作的确认文案必须写明不可撤销',
  );
  dc.cancel();
  assert.equal(requests.length, 0, '商家取消二次确认后不得核销或撤回任何记录');

  dc.confirm();
  const withdrawRequest = requestByUrl('/api/merchant/chapter-application/withdraw');
  assert.ok(withdrawRequest);
  assert.deepEqual(JSON.parse(withdrawRequest.data), { applicationId: 71 });

  withdrawRequest.success({ code: '200' });
  assert.ok(requestByUrl('/api/merchant/chapter-application/mine'),
    '撤回回执后必须从服务端回读可重新申请状态');
  assert.match(dc.doneCalls.length ? '已撤回，可重新提交' : '', /可重新提交/,
    '成功后必须走结果确认卡(第三段),不是一闪而过的 toast');
});

test('撤回不存在或状态冲突都认稳定错误码并回读，不依赖中文文案', () => {
  for (const errorCode of ['CHAPTER_APPLICATION_NOT_FOUND', 'CHAPTER_APPLICATION_STATE_CHANGED']) {
    requests = [];
    tips = [];
    modals = [];
    const page = makePage();
    page.data.myChapterApplications = [{ id: 71, chapterId: 31, status: 0 }];

    const dc = attachDangerConfirm(page, { confirmHandler: 'onConfirmWithdrawApplication' });
    page.withdrawChapterApplication({ currentTarget: { dataset: { applicationId: 71 } } });
    dc.confirm();
    requestByUrl('/api/merchant/chapter-application/withdraw').success({
      code: '500',
      errorCode,
      msg: '服务端展示文案已经改名',
    });

    assert.ok(requestByUrl('/api/merchant/chapter-application/mine'),
      `${errorCode} 必须触发服务端状态回读`);
    // 失败留在确认弹窗原地给重试(第二段的失败态),不再靠 app.tips 飘一下
    assert.equal(dc.failedCalls.at(-1), '申请状态已变化，请刷新后重试');
  }
});

test('只有已通过且尚无生效供给的申请能打开实际供给表单', () => {
  const page = makePage();
  page.data.myChapterApplications = [
    { chapterId: 31, status: 0, offerActive: false, termsMode: 'TRAFFIC' },
    { chapterId: 32, status: 2, offerActive: false, termsMode: 'REVSHARE' },
    { chapterId: 33, status: 1, offerActive: false, termsMode: 'PERK', chapterName: '夜航咖啡' },
  ];

  page.openChapterOfferForm({ currentTarget: { dataset: { chapterId: 31 } } });
  assert.equal(page.data.chapterNodeFormVisible, false, '待审核申请不得越过审核通过闸');
  page.openChapterOfferForm({ currentTarget: { dataset: { chapterId: 32 } } });
  assert.equal(page.data.chapterNodeFormVisible, false, '已驳回申请不得越过审核通过闸');
  page.openChapterOfferForm({ currentTarget: { dataset: { chapterId: 33 } } });
  assert.equal(page.data.chapterNodeFormVisible, true, '已通过申请应进入实际供给表单');
  assert.equal(page.data.chapterNodeFormMode, 'offer');
});

test('已有承接申请时可进入进度弹层，不受新申请窗口与可申请章节空态阻断', () => {
  const page = makePage();
  Object.assign(page.data, {
    info: { productType: 2, memberId: 2, merchantStatus: 0 },
    allChaptersList: [],
    myChapterApplications: [
      { chapterId: 33, chapterName: '夜航咖啡', status: 1, offerActive: false, termsMode: 'PERK' },
    ],
  });

  // CU-M-07(2026-09-23):底部「承接进度」只滚到正文的进度块,不再弹「申请承接章节」。
  const scrolls = [];
  const originalScroll = wx.pageScrollTo;
  wx.pageScrollTo = (opts) => scrolls.push(opts);
  try {
    page.bmClick2({ currentTarget: { dataset: {} } });
  } finally {
    wx.pageScrollTo = originalScroll;
  }
  assert.deepEqual(scrolls.map(o => o.selector), ['.my-apply'], '承接进度按钮必须落到进度块');
  assert.notEqual(page.data.topicShow, true, '承接进度按钮不得打开申请弹层');

  // 进度块里「申请承接其他章节」(data-apply)才开弹层,且不受新申请窗口闸阻断。
  page.bmClick2({ currentTarget: { dataset: { apply: '1' } } });
  assert.equal(page.data.topicShow, true,
    '已批准申请的供给入口不得被报名期限、招募开关或当前章节满额闸挡在弹层外');
  assert.equal(page.data.chapterApplicationOpen, false,
    '绕过的是既有申请进度入口，不得顺便放开新的章节申请');
});

test('F-45 自由探索报名只按已加载的章节招募状态开窗，并区分全关与加载失败', () => {
  const openPage = makePage();
  Object.assign(openPage.data, {
    info: {
      productType: 2,
      memberId: 2,
      merchantStatus: 0,
      merchantSignUpStartDate: null,
      merchantSignUpEndDate: null,
    },
    chapterRecruitmentState: 'ready',
    allChaptersList: openPage.buildMerchantChapters([{
      id: 31,
      name: '夜航咖啡',
      recruitStatus: { state: 'OPEN', isOpen: true, termsMode: 'PERK' },
    }]),
    myChapterApplications: [],
  });

  openPage.bmClick2();

  assert.equal(openPage.data.topicShow, true,
    '已有开放章节时不得被 legacy 主题报名日期或主题级 merchantStatus 挡住');
  assert.equal(openPage.data.chapterApplicationOpen, true);
  assert.equal(openPage.data.selectedChapterId, 31);
  assert.equal(toasts.some(item => item.title === '报名时间信息不完整'), false);

  const closedPage = makePage();
  Object.assign(closedPage.data, {
    info: { productType: 2, memberId: 2 },
    chapterRecruitmentState: 'ready',
    allChaptersList: closedPage.buildMerchantChapters([{
      id: 32,
      name: '收官章',
      recruitStatus: { state: 'CLOSED', isOpen: false },
    }]),
    myChapterApplications: [],
  });
  closedPage.bmClick2();
  assert.equal(closedPage.data.topicShow, true,
    '全关时应打开既有选择层的业务空态，不能伪装成日期配置问题');
  assert.equal(closedPage.data.chapterApplicationOpen, false);
  assert.equal(toasts.some(item => item.title === '报名时间信息不完整'), false);

  const failedPage = makePage();
  Object.assign(failedPage.data, {
    info: { productType: 2, memberId: 2 },
    chapterRecruitmentState: 'error',
    chapterRecruitmentError: '网络异常，可承接章节暂时没能加载',
    allChaptersList: [],
    myChapterApplications: [],
  });
  failedPage.bmClick2();
  assert.equal(failedPage.data.topicShow, true,
    '加载失败时应打开既有错误态与重试入口，不能伪装成日期配置问题');
  assert.equal(failedPage.data.chapterApplicationOpen, false);
  assert.equal(toasts.some(item => item.title === '报名时间信息不完整'), false);
  assert.match(PICKER_WXML,
    /wx:if="\{\{!applicationOpen && chaptersState === 'ready' && rows\.length\}\}"/,
    '加载失败或全关已有各自状态文案时，不得再误报主题招商窗口已关闭');
});

test('服务端 offerActive 回读决定冻结，重进页面不能靠内存状态解冻', () => {
  const page = makePage();
  page.data.topicId = 42;
  page.data.info = { chaptersList: [{ id: 33, termsMode: 'PERK' }] };
  page.loadMyChapterApplications();

  const mineRequest = requestByUrl('/api/merchant/chapter-application/mine');
  assert.ok(mineRequest, '冻结事实必须主动从我的章节申请接口回读');
  mineRequest.success({
    code: '200',
    data: [{ topicId: 42, chapterId: 33, chapterName: '夜航咖啡', status: 1, offerActive: true }],
  });
  page.openChapterOfferForm({ currentTarget: { dataset: { chapterId: 33 } } });

  assert.equal(page.data.chapterNodeFormVisible, false,
    '服务端已有生效 offer 时必须停在只读闸，不能重开空表单覆盖快照');
  assert.equal(page.data.myChapterApplications[0].offerReadOnly, true,
    '只读态必须由服务端 offerActive 映射，而不是页面提交回调自封');
});

test('审核通过后的供给提交只写 offer/enroll，并在成功后重新回读冻结事实', () => {
  const page = makePage();
  Object.assign(page.data, {
    chapterNodeFormVisible: true,
    chapterNodeFormMode: 'offer',
    myChapterApplications: [{ chapterId: 33, status: 1, offerActive: false, termsMode: 'PERK' }],
  });

  page.onChapterNodeFormSubmit({ detail: {
    chapterId: 33, termsMode: 'PERK', perkTemplateId: 7, quotaTotal: 12,
  } });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/coop/offer/enroll');
  assert.deepEqual(JSON.parse(requests[0].data), {
    chapterId: 33, termsMode: 'PERK', perkTemplateId: 7, quotaTotal: 12,
  });
  requests[0].success({ code: '200' });
  assert.equal(page.data.chapterNodeFormVisible, false);
  assert.ok(requestByUrl('/api/merchant/chapter-application/mine'),
    'offer 写入回执后必须再向服务端读取 offerActive，不能本地直接置冻结');
});

test('经典定向保持节点和模板目标，不接受章节代替节点', () => {
  const page = makePage();
  Object.assign(page.data, {
    isJoin: 1,
    selectedMode: 1,
    selectedNodeId: 99,
    selectedTemplateId: 88,
    topicId: 7,
    info: { merchantSignUpStartDate: '2026-08-01', merchantSignUpEndDate: '2026-08-08' },
  });

  page.goSettlement();

  // 2026-07-31:这条入口恒为经典定向(mode=1),改走弹窗规范类型 B 旗舰案例——
  // 一个 cy-sheet 全屏弹窗页收完"填写→提交→成功",不再连跳三个整页 merchantapply1。
  assert.match(navigations[0].url, /^\/pages\/topic\/merchantapply\/index\?/,
    '经典定向改走 cy-sheet 旗舰案例页，不再是三页版 merchantapply1');
  assert.match(navigations[0].url, /nodeId=99/);
  assert.match(navigations[0].url, /templateId=88/);
  assert.doesNotMatch(navigations[0].url, /chapterId=/);
});

test('自由探索报名详情用承接章节而不是任务或模板来解释分配结果', () => {
  const page = makePage();

  page.processData({
    mode: 2,
    chapterName: '夜航咖啡',
    totalOrderNum: 0,
    verifiedNum: 0,
  });

  assert.equal(page.data.assignedLabel, '承接的章节');
  assert.equal(page.data.info.chapterName, '夜航咖啡');
});

test('只展示服务端判定可申请的章节，并采用章节承接状态', () => {
  const page = makePage();

  const chapters = page.buildMerchantChapters([
    {
      id: 1,
      name: '咖啡夜航',
      category: '咖啡',
      required: 1,
      recruitStatus: {
        isOpen: true,
        termsMode: 'PERK',
        remainingMerchantCount: 2,
        maxMerchant: 3,
        allowedValidationMethods: '1,5',
        maxNodeXp: 80,
      },
    },
    {
      id: 2,
      name: '已满章节',
      recruitStatus: { isOpen: false, termsMode: 'TRAFFIC', remainingMerchantCount: 0, maxMerchant: 1 },
    },
  ]);

  assert.deepEqual(chapters.map(item => item.id), [1]);
  assert.equal(chapters[0].termsLabel, '权益承接');
  assert.equal(chapters[0].merchantLimitLabel, '剩余 2 / 3 家可承接');
  assert.equal(chapters[0].boundaryLabel, '玩法限 文字作答/GPS 到达 · 探索值上限 80');
});

test('主办方打开项目页才读取自己的章节申请队列', () => {
  const host = makePage();
  host.data.topicId = 42;
  host.loadProjectHome();
  requestByUrl('/api/project/home').success({
    code: '200', data: { role: 'host', topic: { id: 42, productType: 2 }, host: {} },
  });

  const ownerRequest = requestByUrl('/api/merchant/chapter-application/owner-list');
  assert.ok(ownerRequest, '主办方项目页必须读取自己主题下的申请队列');
  assert.equal(ownerRequest.method, 'POST');
  assert.deepEqual(ownerRequest.header, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(ownerRequest.data), { topicId: 42, scope: '' });

  requests = [];
  const join = makePage();
  join.data.topicId = 42;
  join.loadProjectHome();
  requestByUrl('/api/project/home').success({
    code: '200', data: { role: 'join', join: { registration: { id: 7 }, registrations: [] } },
  });
  assert.equal(requestByUrl('/api/merchant/chapter-application/owner-list'), undefined,
    '非主办方不得读取 owner-list');
});

test('章节承接方没有旧报名记录时仍进入既有点位管理视图', () => {
  const page = makePage();
  page.data.topicId = 42;
  let browseLoads = 0;
  page.loadBrowseData = () => { browseLoads += 1; };
  page.loadProjectHome();

  requestByUrl('/api/project/home').success({
    code: '200',
    data: {
      role: 'join',
      join: {
        chapterApplications: [{
          id: 71, topicId: 42, chapterId: 31, status: 1, offerActive: true,
        }],
      },
    },
  });

  assert.equal(page.data.loadFailed, false);
  assert.equal(page.data.role, 'join');
  assert.equal(page.data.fromMerchantJoin, true,
    '章节承接复用现有浏览态的“我的点位/承接申请”管理界面');
  assert.equal(page.data.regId, 0, '不得伪造旧 registration id');
  assert.equal(browseLoads, 1);
});

test('下架章节承接项目用商家授权详情读取，不回退玩家公开详情', () => {
  const page = makePage();
  page.data.topicId = 42;
  page.loadProjectHome();
  requestByUrl('/api/project/home').success({
    code: '200',
    data: {
      role: 'join',
      join: { chapterApplications: [
        { id: 71, topicId: 42, chapterId: 31, status: 1, offerActive: true },
      ] },
    },
  });

  const detailRequest = requestByUrl('/api/topic/info-to-merchant');
  assert.ok(detailRequest, '承接管理态必须读取商家授权投影，公开下架不等于失去履约权限');
  assert.equal(requestByUrl('/api/topic/info-to-user'), undefined,
    '不可再用玩家公开详情决定承接项目是否存在');
  detailRequest.success({
    code: '200', data: { id: 42, name: '已下架但仍在履约', productType: 2, chaptersList: [] },
  });
  assert.ok(requestByUrl('/api/merchant/chapter-application/mine'));
  assert.ok(requestByUrl('/api/merchant/chapter-node/mine'));
});

test('承接方多站列表包含空元素时 fail-closed，不进入详情链路', () => {
  const page = makePage();
  page.data.topicId = 42;
  let detailLoads = 0;
  page.loadDetail = () => { detailLoads += 1; };
  page.loadProjectHome();

  assert.doesNotThrow(() => requestByUrl('/api/project/home').success({
    code: '200',
    data: {
      role: 'join',
      join: { registration: { id: 7 }, registrations: [null, null] },
    },
  }));
  assert.equal(page.data.loadFailed, true);
  assert.equal(detailLoads, 0);
});

test('项目详情的申请、节点、场次、合作方和玩家列表都拒绝空元素', () => {
  const page = makePage();
  page.data.topicId = 42;

  page.loadMyChapterApplications();
  assert.doesNotThrow(() => requests.at(-1).success({ code: '200', data: [null] }));
  assert.equal(page.data.myChapterApplicationsLoaded, false);

  page.loadMyChapterNodes();
  assert.doesNotThrow(() => requests.at(-1).success({ code: '200', data: [null] }));
  assert.equal(page.data.myChapterNodesLoaded, false);

  page.loadUpcomingRuns();
  assert.doesNotThrow(() => requests.at(-1).success({ code: '200', data: [null] }));
  // 2026-09-05「接下来」改「进度」后场次不再上屏,runs 收回成实例字段(wxml 零引用,
  // 不该走 setData)。保护目标没变:脏数据里的 null 元素不能让它崩或塞进列表。
  assert.deepEqual(page._runs, []);

  page.loadCoop();
  assert.doesNotThrow(() => requests.at(-1).success({
    code: '200', data: { role: 'host', host: { clubs: [null] } },
  }));
  assert.equal(page.data.coopState, 'error');

  page.openPlayerSheet();
  assert.doesNotThrow(() => requestByUrl('/api/project/players').success({
    code: '200', data: { rows: [null] },
  }));
  // CU-2026-09-24 C-67:脏数据的拒绝从「空态文案」挪到了错态字段 —— 名单没拿到
  // 与「一单没卖」必须分开说,不能再共用 emptyText(那一句会被读成真空态)。
  assert.equal(page.data['playerSheet.errorText'], '名单没加载出来');
  assert.equal(page.data['playerSheet.emptyText'], '');
});

test('权益章节公开最低权益价值，引流档不展示该门槛', () => {
  const page = makePage();
  const chapters = page.buildMerchantChapters([
    {
      id: 11, name: '夜航咖啡线',
      recruitStatus: { isOpen: true, termsMode: 'PERK', perkMinValue: '50.00' },
    },
    {
      id: 12, name: '城市漫步线',
      recruitStatus: { isOpen: true, termsMode: 'TRAFFIC', perkMinValue: '99.00' },
    },
  ]);

  assert.equal(chapters[0].perkMinValueLabel, '权益零售价不少于 ¥50');
  assert.equal(chapters[1].perkMinValueLabel, '');
});

test('商家打开自由探索承接页时就读取自己的点位列表', () => {
  const page = makePage();
  page.onLoad({ id: '42' });
  const detailRequest = requestByUrl('/api/topic/info-to-user');
  detailRequest.success({
    code: '200',
    data: { id: 42, name: '夜航计划', productType: 2, chaptersList: [] },
  });

  const mineRequest = requestByUrl('/api/merchant/chapter-node/mine');
  assert.ok(mineRequest, '页面加载链必须主动读取点位，不能等提交回调刷新');
  assert.equal(mineRequest.method, 'POST');
  assert.deepEqual(mineRequest.data, { topicId: 42 });
  assert.ok(requestByUrl('/api/merchant/chapter-application/mine'),
    '页面重进必须同时回读申请审核态和 offerActive 冻结事实');
});

test('我的点位只渲染 CmsTopicNode 真字段或页面明确派生字段', () => {
  const referenced = Array.from(WXML.matchAll(/chapterNode\.([A-Za-z][A-Za-z0-9]*)/g), match => match[1]);
  assert.ok(referenced.length > 0, '我的点位区必须真实消费点位字段，不能让契约空转');
  const cmsTopicNodeFields = new Set(
    Array.from(CMS_TOPIC_NODE.matchAll(/private\s+(?:[\w.<>]+)\s+([A-Za-z][A-Za-z0-9]*)\s*;/g), match => match[1]),
  );
  cmsTopicNodeFields.add('auditLabel');
  const phantom = referenced.filter(field => !cmsTopicNodeFields.has(field));
  assert.deepEqual(phantom, [], `我的点位渲染了 CmsTopicNode 不存在的字段: ${phantom.join(', ')}`);
});

test('三档 offer payload 只携带章节供给字段，不接受服务端接管字段', () => {
  const page = makePage();

  assert.deepEqual(page.buildChapterOfferPayload({
    chapterId: 11, termsMode: 'TRAFFIC', quotaTotal: '30',
    merchantId: 999, topicId: 888, status: 0, quotaUsed: 27,
  }), { chapterId: 11, termsMode: 'TRAFFIC' });
  assert.deepEqual(page.buildChapterOfferPayload({
    chapterId: 12, termsMode: 'REVSHARE', perHeadFee: '8.50', quotaTotal: '20',
    merchantId: 999, topicId: 888, status: 0, quotaUsed: 19,
  }), { chapterId: 12, termsMode: 'REVSHARE', perHeadFee: 8.5 });
});
