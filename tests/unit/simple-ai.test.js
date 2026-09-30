const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = '../../pages/publish/simple/index.js';
const WXML = path.join(__dirname, '../../pages/publish/simple/index.wxml');

let sent = [];
let pageConfig = null;

global.getApp = () => ({
  sendRequest: (request) => { sent.push(request); },
  getAuthorization: () => '',
});
global.wx = {
  navigateBack: () => {},
  choosePoi: () => {},
  setStorageSync: () => {},
  navigateTo: () => {},
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  sent = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch) => {
    Object.keys(patch).forEach((key) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = page.data;
      for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
      target[parts[parts.length - 1]] = patch[key];
    });
  };
  return page;
}

test('简单 AI 入口加载并展示玩家的剩余额度', () => {
  const page = makePage();
  page.onLoad({ mode: '2' });

  assert.equal(page.data.mode, 2);
  assert.equal(sent[0].url, '/api/ai/theme/draft/quota');
  assert.equal(sent[0].method, 'POST');

  sent[0].success({ code: 200, data: { limited: true, remaining: 2 } });
  assert.equal(page.data.aiQuotaLoaded, true);
  assert.equal(page.data.aiRemaining, 2);
});

test('成功生成后用响应中的额度刷新提示', () => {
  const page = makePage();
  page.onLoad({ mode: '1' });
  sent[0].success({ code: 200, data: { limited: true, remaining: 3 } });
  page.setData({ aiIdea: '老城夜游' });

  page.generateAiPlan();
  const request = sent[1];
  assert.equal(request.url, '/api/ai/theme/draft');
  request.success({
    code: 200,
    data: {
      traceId: 'trace-1',
      remainingQuota: 2,
      draft: { title: '夜游', storyline: '沿街探索', nodes: [{ merchantName: '第一站', task: '观察招牌' }] }
    }
  });

  assert.equal(page.data.aiPlan.title, '夜游');
  assert.equal(page.data.aiRemaining, 2);
});

test('AI 返回超过三站的草稿时保持 fail-closed，不进入后续编辑', () => {
  const page = makePage();
  page.onLoad({ mode: '2' });
  sent[0].success({ code: 200, data: { limited: true, remaining: 3 } });
  page.setData({ aiIdea: '给我一条四站城市路线' });

  page.generateAiPlan();
  sent[1].success({
    code: 200,
    data: {
      traceId: 'trace-too-many-nodes',
      remainingQuota: 2,
      draft: {
        title: '四站路线',
        nodes: Array.from({ length: 4 }, (_, index) => ({ merchantName: '第' + (index + 1) + '站' })),
      },
    },
  });

  assert.equal(page.data.aiPlan, null, '超过已定上限的草稿不能被当作可编辑结果');
  assert.match(page.data.aiError, /不超过 3 个点位/);
  assert.equal(page.data.aiRemaining, 3, '结构不合格响应不能被前端显示为已扣额度');
});

test('AI 重试失败时保留已经生成的草稿与点位', () => {
  const page = makePage();
  page.onLoad({ mode: '2' });
  sent[0].success({ code: 200, data: { limited: true, remaining: 3 } });
  const previousPlan = { title: '老城夜游', storyline: '沿街探索' };
  const previousNodes = [{ name: '第一站', confirmed: false }];
  page.setData({ aiIdea: '换一种说法', aiPlan: previousPlan, aiPlanNodes: previousNodes });

  page.generateAiPlan();
  sent[1].fail({ errMsg: 'request:fail timeout' });
  sent[1].complete();

  assert.deepEqual(page.data.aiPlan, previousPlan);
  assert.deepEqual(page.data.aiPlanNodes, previousNodes);
  assert.match(page.data.aiError, /网络暂时不可用/);
  assert.equal(page.data.aiGenerating, false);
});

test('AI 进度与错误使用同一互斥状态链，不得在 complete 前同屏', () => {
  const wxml = fs.readFileSync(WXML, 'utf8');
  assert.match(wxml,
    /<cy-progress-status wx:if="\{\{aiGenerating\}\}"[\s\S]*?<cy-inline-error wx:elif="\{\{aiError\}\}"/,
    'success/fail 写入 aiError 后到 complete 清 loading 的间隙，只能保留进度态');
});

// —— 死分支回归闸:简易版曾有一整套「暗色手动编辑」子树,挂在永远为真的 wx:if="{{aiMode}}"
// 的 wx:else 上,任何用户都点不到。下面两条断言防止它被重新接回页面。 ——
test('页面不再暴露已禁用的模式切换 / 就地建玩法能力', () => {
  makePage();

  assert.equal(pageConfig.data.aiMode, undefined, 'aiMode 是恒真开关,不应重新出现');
  assert.equal(pageConfig.data.gameEditor, undefined, 'gameEditor 状态属于已删除的暗色子树');
  ['onPickMode', 'onToggleMode', 'openGameEditor', 'closeGameEditor',
    'onGameField', 'selectGameMethod', 'selectGameAnswer', 'saveInlineGame',
  ].forEach((name) => {
    assert.equal(pageConfig[name], undefined, name + ' 只被已删除的死子树调用,不应重新出现');
  });
});

test('置灰的主 CTA 必须自己给理由:disabledtap 与 canEnterAiEditor 同判据', () => {
  const page = makePage();
  page.data.aiPlan = { title: '有标题', storyline: '' };
  page.data.aiPlanNodes = [{ name: '一站', confirmed: false, longitude: '', latitude: '' }];
  // 前提:这就是按钮置灰的那一态
  page.refreshEnterEditorState();
  assert.equal(page.data.canEnterAiEditor, false, '点位未确认时按钮应当置灰');

  page.enterAiEditor();
  assert.match(page.data.aiError, /请逐个在地图中确认地点/,
    '置灰态下 enterAiEditor 必须给得出理由 —— disabledtap 接的就是它');

  const wxml = fs.readFileSync(WXML, 'utf8');
  assert.match(wxml, /disabled="\{\{!canEnterAiEditor\}\}"[^>]*bind:disabledtap="enterAiEditor"/,
    'cy-btn 会吞掉禁用态的 tap,不接 disabledtap 这句理由永远出不来');
});

test('wxml 只保留可达的简单 AI 链路,不含暗色手动编辑子树', () => {
  const wxml = fs.readFileSync(WXML, 'utf8');

  // 可达链路必须完整:输入 → 生成 → 逐点确认 POI → 进 fabu
  ['bindinput="onAiIdeaInput"', 'bindtap="generateAiPlan"',
    'bindtap="confirmAiNodePoi"', 'bindtap="enterAiEditor"',
  ].forEach((marker) => assert.ok(wxml.includes(marker), '可达链路缺失:' + marker));

  // 死子树的特征串一个都不许回来
  ['cy-page--dark', 'onToggleMode', 'onPickMode', 'openGameEditor',
    'saveInlineGame', 'selectGameMethod', 'gameEditor.',
  ].forEach((marker) => assert.ok(!wxml.includes(marker), '死子树残留:' + marker));

  // 根节点不再挂恒真条件
  assert.ok(!/wx:if="\{\{aiMode\}\}"/.test(wxml), '根节点不应再有恒真的 wx:if="{{aiMode}}"');
});

// —— 审查 #14 回归闸:旧「快速发布」链路(站点编辑 → 预览 → 存草稿 → 直接发布)在 wxml
//    上一个绑定都没有,而它的反馈通道本身是坏的 —— tip() 只写 data.toast,wxml 从不渲染它。
//    整块删掉是为了不让下一个人「顺手修一个进不去的页面」。真要重新接线:先换成
//    cy-toast / cy-inline-error 通道,再谈接线。 —— 2026-09-19
test('简易版不带发布链路:零绑定的孤儿方法不得复活', () => {
  const page = makePage();
  ['onPublish', 'onSaveDraft', '_doPublish', 'validate', 'buildPayload', 'onPreview',
    'onClosePreview', 'onClubChange', 'loadMyClubs', 'applyPreset', 'cloneStations',
    'onPickPreset', 'onPickCustom', 'redrawMap', 'onPickStationLoc', 'onPickMeetLoc',
    'onMarkerTap', 'onDeleteStation', 'onAddStation', 'onPickTemplate', 'tip',
    '_offerDraftResume', '_restoreDraft', 'onResultSheetClose',
  ].forEach((name) => {
    assert.equal(page[name], undefined, name + ' 是零绑定孤儿,不该回到页面上');
  });
  assert.equal(page.data.toast, undefined, 'tip() 的渲染目标 wxml 从不消费');
  assert.equal(page.data.stations, undefined, '站点编辑属于已退役的发布链路');
  assert.equal(page.data.resultSheet, undefined, '成功面板只剩死生产者,一并退役');

  assert.doesNotMatch(fs.readFileSync(WXML, 'utf8'), /cy-result-sheet/,
    '本页不发发布请求,成功面板没有生产者');
  const js = fs.readFileSync(path.join(__dirname, '../../pages/publish/simple/index.js'), 'utf8');
  assert.doesNotMatch(js, /\/api\/topic\/create/, '发布只在 fabu,简易页不得重新直提');
});
