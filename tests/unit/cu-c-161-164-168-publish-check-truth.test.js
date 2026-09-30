// 走查 2026-09-25 · 批次 flow-club:「发布前检查」这张弹层在说实话吗?
//
// CU-C-168 两条假绿:
//   ① 发布钮置灰时点它(onPublishDisabledTap)根本没跑过 AI 预检,却传了空 skipLabel ——
//      而 _showPublishCheck 里 `precheckOk = !skipLabel && !issues.length`,空串 + 空数组
//      正好等于「跑过了且没问题」。于是弹层一边列着「还差封面/还差点位」,
//      一边绿着「内容安全预检通过」。
//   ② 「已配置 N 种票单」只数数组长度:一张名称、集合时间、集合地点全空的默认票
//      既能以缺项身份出现在「还差什么」里,又被算进「自动检查已通过 · N 项」。
//      同一张空票既红又绿。
//
// CU-C-164 「配置模板」开关态不入库(nodesForm.showTemplate 是纯 UI 态,真源是 templateId)。
//   从玩法编辑器点「放弃未保存的玩法」返回时没人回传 ⇒ 开关停在 true 而 templateId 还是 0,
//   下面只给「选择或创建玩法模板」,是个点了必落空的假已配置。
//
// CU-C-161 节点卡的地点空态写着「自由探索可稍后补」,这半句是自由探索那一档的规则,
//   城市定向的节点也照着它显示 ⇒ 看起来像可以跳过(实际两种模式发布时都硬性要坐标)。
//
// 三条的共同点:**判据只许有一份**。票填没填全 = _ticketBlockReason();
// 开关开没开 = !!templateId;预检状态 = 三值(未跑 / 跳过 / 通过),不许用空串冒充「通过」。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const FABU_JS = 'pages/publish/fabu/index.js';
const FABU_WXML = 'pages/publish/fabu/index.wxml';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const noop = () => {};
const makeWx = () => ({
  getStorageSync: () => '', setStorageSync: noop, removeStorageSync: noop,
  getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
  showToast: noop, hideLoading: noop, showLoading: noop, showModal: noop,
  createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }), exec() {} }),
  pageScrollTo: noop, nextTick: (cb) => cb(),
});

// src 传入**改写过的源码字符串** —— 负控靠这条才能真跑到病灶形态那一版。
// 依赖全部走 createRequire(页目录):判据函数(cityOrientationScheduleIssues 等)
// 必须是真的,否则「一张票填没填全」这件事在测试里就又被复刻了一遍。
function loadFabu(src) {
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 42,
    sendRequest: noop,
    chooseImage: noop,
    chooseDocument: noop,
    tips: noop,
    getRequestErrorMessage: (err, fallback) => (err && err.errMsg) || fallback,
  };
  global.getApp = () => app;
  global.wx = makeWx();
  const file = path.resolve(ROOT, FABU_JS);
  let definition;
  vm.runInNewContext(src || read(FABU_JS), {
    getApp: () => app,
    Page(p) { definition = p; },
    Component(p) { definition = p; },
    getCurrentPages: () => [{}],
    require: createRequire(file),
    setTimeout(fn) { if (fn) fn(); return 1; },
    clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
    console, Date, JSON, wx: makeWx(),
  }, { filename: file });

  const page = Object.assign({}, definition, {
    data: {},
    setData(patch, callback) {
      Object.keys(patch).forEach((key) => {
        if (key.indexOf('.') < 0) { page.data[key] = patch[key]; return; }
        const segs = key.split('.');
        let cursor = page.data;
        segs.slice(0, -1).forEach((seg) => {
          if (!cursor[seg] || typeof cursor[seg] !== 'object') cursor[seg] = {};
          cursor = cursor[seg];
        });
        cursor[segs[segs.length - 1]] = patch[key];
      });
      if (callback) callback.call(page);
    },
    // 本地缺项判定另有 tests/unit/publish-precheck-blind-field-contract.test.js 钉住,
    // 这里只关心「预检状态」和「票数」这两件事说的对不对,给个空壳即可。
    buildPublishCheck: () => ({ blocking: [], advisory: [] }),
    _buildPublishPreview: () => null,
    setEditorState: noop,
  });
  page.data.formData = {
    name: '城市漫游', imgUrl: 'https://cdn/cover.png', description: '一条真实简介',
    productType: 1, chapters: [{ name: '第一章', nodes: [{ id: 1 }] }], tickets: [],
  };
  page.data.completionRuleMode = 'ALL';
  page.data.identityRegistered = true;
  return page;
}

const labels = (items) => (items || []).map((item) => item.label);
const precheckLine = (passed) => labels(passed).find((label) => /内容安全预检/.test(label));
const ticketLine = (passed) => labels(passed).find((label) => /种票单/.test(label));

// ============================================================ CU-C-168 ①预检状态
test('CU-C-168 没跑过预检时,「内容安全预检通过」不得出现在已通过那一栏', () => {
  const page = loadFabu();
  page.onPublishDisabledTap();

  assert.equal(precheckLine(page.data.publishCheck.passed), undefined,
    `点灰钮这条路径没发过请求,却报通过: ${JSON.stringify(labels(page.data.publishCheck.passed))}`);
  assert.equal(page._publishPrecheckOk, false);
  assert.ok(labels(page.data.publishCheck.advisory).some((label) => /预检还没跑/.test(label)),
    '没跑过要说成人家听得懂的话,别只留一条空白');
});

test('CU-C-168 真跑过预检且没问题时仍算通过 —— 修这个不能把它修成永远红', () => {
  const page = loadFabu();
  page._showPublishCheck([], '');
  assert.ok(/内容安全预检通过/.test(String(precheckLine(page.data.publishCheck.passed))));
  assert.equal(page._publishPrecheckOk, true);
});

// ============================================================ CU-C-168 ②票数
test('CU-C-168 「已配置 N 种票单」只数填全了的票', () => {
  const page = loadFabu();
  page.data.formData.tickets = [
    { name: '标准票', mode: 2 },                                  // 填全
    { name: '', mode: 2 },                                        // 缺名称
    { name: '集合票', mode: 1, startTime: '', meetingPoint: '' }, // 缺集合时间 + 地点
  ];
  const passed = page._buildPublishPassed(true);
  assert.equal(ticketLine(passed), '已配置 1 种票单',
    `两张空票不该被算成配好了: ${JSON.stringify(labels(passed))}`);
});

test('CU-C-168 没填全的差额要在摘要里如实报出来,不能悄悄消失', () => {
  const page = loadFabu();
  page.data.formData.tickets = [
    { name: '标准票', mode: 2 },
    { name: '', mode: 2 },
    { name: '集合票', mode: 1, startTime: '', meetingPoint: '' },
  ];
  const summary = page._buildPublishSummary().join(' ');
  assert.match(summary, /当前配置 1 种票单，另有 2 种没填完/, summary);
});

test('CU-C-168 票全填完时摘要不多余那句「另有没填完」', () => {
  const page = loadFabu();
  page.data.formData.tickets = [{ name: '标准票', mode: 2 }];
  const summary = page._buildPublishSummary().join(' ');
  assert.match(summary, /当前配置 1 种票单。/, summary);
  assert.doesNotMatch(summary, /没填完/, summary);
});

test('CU-C-168 保存票种的可用态与「填没填全」共用同一条判据', () => {
  const page = loadFabu();
  page.data.editingTicket = { name: '标准票', mode: 1, startTime: '09:00', endTime: '10:00', meetingPoint: '' };
  page.refreshTicketSaveState();
  assert.equal(page.data.canSaveTicket, false, '集合地点没选就不该能保存');
  assert.equal(page._ticketSaveBlockReason(), '请选择集合地点');

  page.data.editingTicket = { name: '标准票', mode: 1, startTime: '09:00', endTime: '10:00', meetingPoint: '某某书店' };
  page.refreshTicketSaveState();
  assert.equal(page.data.canSaveTicket, true, '填全了必须放行人 —— 闸不能改过头');
  assert.equal(page._ticketSaveBlockReason(), '');
});

// ============================================================ CU-C-164 开关态
test('CU-C-164 放弃玩法编辑返回时,开关跟着 templateId 落回关闭', () => {
  const page = loadFabu();
  page.setData({
    popChapterNodes: true,
    nodesForm: { showTemplate: true, templateId: 0 },
  });
  page.onShow();
  assert.equal(page.data.nodesForm.showTemplate, false,
    'templateId=0 意味着没有玩法,开关绿着就是假已配置');
});

test('CU-C-164 玩法在的时候开关不许被派生动到', () => {
  const page = loadFabu();
  page.setData({ popChapterNodes: true, nodesForm: { showTemplate: false, templateId: 7 } });
  page.onShow();
  assert.equal(page.data.nodesForm.showTemplate, true);
});

test('CU-C-164 节点抽屉没开着时不碰表单项(返回页可能正停在别的 Tab)', () => {
  const page = loadFabu();
  page.setData({ popChapterNodes: false, nodesForm: { showTemplate: true, templateId: 0 } });
  page.onShow();
  assert.equal(page.data.nodesForm.showTemplate, true, '不在眼前的一表单不该被顺手改写');
});

// ============================================================ CU-C-161 文案
function assertNodeAddressCopy(wxml) {
  const line = wxml.match(/<text class="node-card__addr">\{\{([^}]*)\}\}<\/text>/);
  assert.ok(line, '节点卡的地点空态行必须存在');
  const expr = line[1];
  assert.match(expr, /^nodesForm\.address \|\|/, '选了点位仍旧显示点位地址,分支只接管空态');
  const branches = expr.match(/formData\.productType === 2 \? '([^']*)' : '([^']*)'/);
  assert.ok(branches, `空态文案必须按玩法模式分两支(=== 2 是自由探索): ${expr}`);
  const [, freeRoam, city] = branches;
  assert.match(freeRoam, /自由探索可稍后补/, '自由探索那一支保留「可稍后补」(它是这一档的真实规则)');
  assert.doesNotMatch(city, /自由探索/, `城市定向那一支不该借用另一档的规则: ${city}`);
  assert.match(city, /点位|选择/, `城市定向那一支要说清这一步该干什么: ${city}`);
  return wxml;
}

test('CU-C-161 城市定向节点的地点空态不再借用自由探索的文案', () => {
  assertNodeAddressCopy(read(FABU_WXML));
});

// ============================================================ 负控
function mutate(src, from, to, label) {
  assert.ok(src.indexOf(from) >= 0, `负控锚点失效(源码已改动?): ${label}`);
  const out = src.replace(from, to);
  assert.notEqual(out, src, `负控锚点失效(替换没生效): ${label}`);
  return out;
}

test('negative control:把 skipLabel 改回空串,「没跑预检」立刻又变假绿', () => {
  const broken = mutate(read(FABU_JS),
    "this._showPublishCheck([], '内容安全预检还没跑');",
    "this._showPublishCheck([], '');",
    'onPublishDisabledTap');
  const page = loadFabu(broken);
  page.onPublishDisabledTap();
  assert.equal(precheckLine(page.data.publishCheck.passed), '内容安全预检通过',
    '摘掉修复后没复现假绿 ⇒ 这条断言没量到东西');
  assert.equal(page._publishPrecheckOk, true);
});

test('negative control:票数改回数组长度,空票立刻又被算成已配置', () => {
  const broken = mutate(read(FABU_JS),
    'const readyTickets = (fd.tickets || []).filter((t) => !this._ticketBlockReason(t));',
    'const readyTickets = (fd.tickets || []);',
    '_buildPublishPassed 票数');
  const page = loadFabu(broken);
  page.data.formData.tickets = [
    { name: '标准票', mode: 2 }, { name: '', mode: 2 },
    { name: '集合票', mode: 1, startTime: '', meetingPoint: '' },
  ];
  assert.equal(ticketLine(page._buildPublishPassed(true)), '已配置 3 种票单',
    '摘掉修复后票数没回到 3 ⇒ 这条断言没量到东西');

  const brokenSummary = mutate(read(FABU_JS),
    'const ticketCount = allTickets.filter((t) => !this._ticketBlockReason(t)).length;',
    'const ticketCount = allTickets.length;',
    '_buildPublishSummary 票数');
  const page2 = loadFabu(brokenSummary);
  page2.data.formData.tickets = [
    { name: '标准票', mode: 2 }, { name: '', mode: 2 },
    { name: '集合票', mode: 1, startTime: '', meetingPoint: '' },
  ];
  const summary = page2._buildPublishSummary().join(' ');
  assert.equal(summary.indexOf('没填完'), -1, `摘要没复现「差额消失」: ${summary}`);
  assert.match(summary, /当前配置 3 种票单/, summary);
});

test('negative control:摘掉 onShow 里的重派生,返回后开关又停在假的开', () => {
  const broken = mutate(read(FABU_JS),
    '    this.syncNodeGameSwitchWithTemplate();\n',
    '',
    'onShow 重派生');
  const page = loadFabu(broken);
  page.setData({ popChapterNodes: true, nodesForm: { showTemplate: true, templateId: 0 } });
  page.onShow();
  assert.equal(page.data.nodesForm.showTemplate, true,
    '摘掉修复后开关没停在错误态 ⇒ 这条断言没量到东西');
});

test('negative control:节点地点文案退回共用一行,CU-C-161 检查器必须判红', () => {
  const broken = mutate(read(FABU_WXML),
    "{{nodesForm.address || (formData.productType === 2 ? '搜索并选择一个 POI；自由探索可稍后补' : '搜索并选择一个 POI，城市定向的每一站都要点位')}}",
    "{{nodesForm.address || '搜索并选择一个 POI；自由探索可稍后补'}}",
    '节点地点空态');
  assert.throws(() => assertNodeAddressCopy(broken), assert.AssertionError);
});
