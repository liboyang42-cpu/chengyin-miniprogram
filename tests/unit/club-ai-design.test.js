// club/detail AI 策划(入口B)回归 —— /api/ai/club/design + 一键采用交接。
//
// 为什么要有这个文件:/api/ai/club/design 是 @RequestBody 端点,前端漏 JSON header 时
// request-client 退回 'application/x-www-form-urlencoded;',Spring 拒收,
// 但 GlobalExceptionHandler 兜成 HTTP 200 + {code:500,msg:"Content type ... not supported"} ——
// 不是 415、不报警,业务方法体一行没执行。只能靠断言钉死请求形状。
//
// 承重不变量:
//  - data 必须是手动 stringify 的 string + header 大写 'Content-Type: application/json'(两者必须配套)。
//  - silentError:错误在 sheet 内联展示,不关掉 request-client 的自动 toast 就是双弹。
//  - parseError 非 null(解析炸了)≠ plan 为 null(AI 没给方案)—— 两条分支文案不同,不许混。
//  - 频控用包含匹配(后端运行时拼 dailyLimit,数字随配置变),且不给重试按钮。
//  - 一键采用走 storage 交接,URL 绝不许带 from=ai:
//    fabu 的 applyAiDraft 里 `options.from === 'ai' ? options : null` 分支还活着,
//    带上它会让扁平的 query 参数顶掉 storage 里的 draft,灌一个空草稿进发布页。
//  - 在途回调 token 守卫:取消后旧回调不许 setData。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../pages/club/detail/index.js';

let sent = null;
let toasts = [];
let modals = [];
let nav = [];
let storage = {};
let clip = [];

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 1,
  getUserRole: () => 'club',
  sendRequest: (p) => { sent = p; },
  getImgUrl: (u) => u,
  getAuthorization: () => 'tk',
});
global.wx = {
  showToast: (o) => toasts.push(o.title),
  showModal: (o) => { modals.push(o); if (o.success) o.success({ confirm: true }); },
  navigateTo: (o) => nav.push(o.url),
  setStorageSync: (k, v) => { storage[k] = v; },
  getStorageSync: (k) => storage[k],
  removeStorageSync: (k) => { delete storage[k]; },
  setClipboardData: (o) => clip.push(o.data),
  showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
  getSystemInfoSync: () => ({ windowWidth: 375 }),
};

let pageConfig = null;
global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  sent = null; toasts = []; modals = []; nav = []; storage = {}; clip = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

const OWNER = { club: { id: 7, isOwner: true }, clubId: 7 };

function makePage(over) {
  const p = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) });
  p.setData = function (patch) { Object.keys(patch).forEach((k) => { p.data[k] = patch[k]; }); };
  Object.assign(p.data, over || {});
  return p;
}

// 跑到 done 态的完整回包(后端 AiClubDesignResp 形状)
const DONE_RESP = {
  traceId: 'tr-9',
  plan: {
    title: '夜行静安', subtitle: '90分钟', storyline: '故事', tags: ['夜间'],
    estDurationMin: 90, fitReason: '合适', risks: ['雨天'],
    nodes: [{ merchantName: '咖啡馆', address: '南京西路1号', longitude: 121.4, latitude: 31.2, businessTime: '10-22', order: 1 }]
  },
  merchantSuggestions: ['A 咖啡'],
  promoCopy: '来吧',
};

function makeDonePage() {
  const p = makePage(Object.assign({ aiIdea: 'x' }, OWNER));
  p.onClubAiGenerate();
  sent.success({ code: '200', data: DONE_RESP });
  return p;
}

// ===== 门禁 =====

test('sheet 门禁:非 owner 打不开,owner 能打开', () => {
  const outsider = makePage({ club: { id: 7, isOwner: false } });
  outsider.onClubAiOpen();
  assert.equal(outsider.data.aiSheetShow, false, '非 owner 不该开 sheet');

  const owner = makePage(OWNER);
  owner.onClubAiOpen();
  assert.equal(owner.data.aiSheetShow, true);
});

// ===== 请求形状(本轮核心 bug)=====

test('★ 生成:POST /api/ai/club/design 必须 stringify + 大写 Content-Type + silentError', () => {
  const p = makePage(Object.assign({ aiIdea: ' 静安 夜间 ', aiClubStyle: '文艺', aiDurationMin: '90' }, OWNER));
  p.onClubAiGenerate();

  assert.equal(sent.url, '/api/ai/club/design');
  assert.equal(sent.method, 'POST');
  assert.equal(typeof sent.data, 'string',
    'data 必须手动 stringify:大写 Content-Type 配裸对象 = 翻车组合,wx.request 不会替你序列化');
  assert.equal(sent.header['Content-Type'], 'application/json',
    '@RequestBody 端点缺 JSON header → urlencoded → 后端拒收但兜成 200,业务方法体不执行');
  assert.equal(sent.silentError, true, '不 silentError → request-client 自动 toast + sheet 内联报错 = 双弹');
  assert.deepEqual(JSON.parse(sent.data), { idea: '静安 夜间', clubStyle: '文艺', targetDurationMin: 90 },
    'idea/clubStyle 要 trim,时长要转 int');
  assert.equal(p.data.aiState, 'generating');
});

test('时长留空 → 不带 targetDurationMin(而不是 NaN/null)', () => {
  const p = makePage(Object.assign({ aiIdea: 'x', aiDurationMin: '' }, OWNER));
  p.onClubAiGenerate();
  assert.equal('targetDurationMin' in JSON.parse(sent.data), false);
});

test('idea 为空(仅空白)→ 不发请求,只提示', () => {
  const p = makePage(Object.assign({ aiIdea: '   ' }, OWNER));
  p.onClubAiGenerate();
  assert.equal(sent, null, '空 idea 不该发请求');
  assert.deepEqual(toasts, ['先用一句话说说想法']);
});

test('在途再次点生成 → 不重复发请求(频控是全端点共用一池)', () => {
  const p = makePage(Object.assign({ aiIdea: 'x' }, OWNER));
  p.onClubAiGenerate();
  sent = null;
  p.onClubAiGenerate();
  assert.equal(sent, null, 'generating 态必须挡住第二次');
});

// ===== 错误分支:两条容易混的路 =====

test('★ parseError 非 null(解析炸了)→ error 态、原样展示后端文案、可重试', () => {
  const p = makePage(Object.assign({ aiIdea: 'x' }, OWNER));
  p.onClubAiGenerate();
  sent.success({ code: '200', data: { traceId: 't', parseError: 'AI 响应格式异常,请重试', plan: null } });

  assert.equal(p.data.aiState, 'error', 'parseError 时 plan 不可信,不许当成功');
  assert.equal(p.data.aiErrorText, 'AI 响应格式异常,请重试');
  assert.equal(p.data.aiCanRetry, true);
  assert.equal(p.data.aiPlan, null, '解析炸了不许落 plan');
});

test('★ plan=null 且无 parseError(静默空成功)→ 走「AI 没给方案」文案,与解析失败区分', () => {
  const p = makePage(Object.assign({ aiIdea: 'x' }, OWNER));
  p.onClubAiGenerate();
  sent.success({ code: '200', data: { traceId: 't', plan: null } });

  assert.equal(p.data.aiState, 'error');
  assert.equal(p.data.aiErrorText, 'AI 这次没给出方案,换个说法再试试',
    '「AI 没给建议」≠「解析炸了」:两条分支文案必须不同,混为一谈会误导用户重试无效的操作');
  assert.equal(p.data.aiCanRetry, true);
});

test('★ 频控超限:包含匹配后端文案(数字随 dailyLimit 配置变)+ 关掉重试 + 不双弹', () => {
  const p = makePage(Object.assign({ aiIdea: 'x' }, OWNER));
  p.onClubAiGenerate();
  // 故意用 35 而不是默认 20:页面若硬编码整串,这条就红。
  sent.success({ code: 500, msg: '今日AI次数已用完(35/天),明天再来吧' });

  assert.equal(p.data.aiState, 'error');
  assert.equal(p.data.aiErrorText, '今日AI次数已用完(35/天),明天再来吧', '应原样展示后端拼好的文案');
  assert.equal(p.data.aiCanRetry, false, '频控超限给重试按钮 = 骗用户点,点了还是失败');
  assert.deepEqual(toasts, [], 'silentError 下不该再自己弹 toast(防双弹)');
});

test('身份门禁文案(后端拦 player)照样展示,且保留重试语义', () => {
  const p = makePage(Object.assign({ aiIdea: 'x' }, OWNER));
  p.onClubAiGenerate();
  sent.success({ code: 500, msg: '当前身份暂不支持AI创作,请切换到俱乐部或商家身份' });

  assert.equal(p.data.aiErrorText, '当前身份暂不支持AI创作,请切换到俱乐部或商家身份');
  assert.equal(p.data.aiCanRetry, true, '非频控错误保留重试');
});

test('网络失败 → error 态 + 网络文案', () => {
  const p = makePage(Object.assign({ aiIdea: 'x' }, OWNER));
  p.onClubAiGenerate();
  sent.fail();
  assert.equal(p.data.aiState, 'error');
  assert.equal(p.data.aiErrorText, '网络错误,请检查网络后重试');
});

// ===== 在途回调守卫 =====

test('★ 取消后在途回调作废(sendRequest 不可中断,只能靠 token)', () => {
  const p = makePage(Object.assign({ aiIdea: 'x' }, OWNER));
  p.onClubAiGenerate();
  const inflight = sent;
  p.onClubAiCancel();
  assert.equal(p.data.aiState, 'idle');

  inflight.success({ code: '200', data: { plan: { title: '迟到的方案' } } });
  assert.equal(p.data.aiState, 'idle', '取消后旧回调不许改状态');
  assert.equal(p.data.aiPlan, null);
});

// ===== 成功态与交接 =====

test('成功 → done 且 plan/商家建议/推广文案落 data', () => {
  const p = makeDonePage();
  assert.equal(p.data.aiState, 'done');
  assert.equal(p.data.aiPlan.title, '夜行静安');
  assert.deepEqual(p.data.aiMerchantSuggestions, ['A 咖啡']);
  assert.equal(p.data.aiPromoCopy, '来吧');
});

test('复制推广文案:setClipboardData 自带提示,不补 toast', () => {
  const p = makeDonePage();
  p.onClubAiCopy();
  assert.deepEqual(clip, ['来吧']);
  assert.deepEqual(toasts, []);
});

test('★ 一键采用:落 storage + URL 不许带 from=ai + 提示手动补封面图/分类', () => {
  const p = makeDonePage();
  p.onClubAiAdopt();

  const draft = storage['ai_topic_draft:m1'];
  assert.ok(draft, 'draft 必须落 storage:URL query 是扁平的,承载不了 chapters');
  assert.equal(draft.name, '夜行静安');
  assert.equal(draft.aiTraceId, 'tr-9', 'traceId 丢了 = AI 生成内容零留痕');
  assert.equal(draft.chapters[0].nodes[0].name, '咖啡馆');

  assert.equal(nav.length, 1);
  assert.equal(nav[0], '/pages/publish/fabu/index?clubId=7');
  assert.ok(!/from=ai/.test(nav[0]),
    '★ 带 from=ai 会让 fabu 的 applyAiDraft 拿扁平 options 当 draft,storage 里的真草稿被无视 → 灌一个空草稿');

  assert.ok(/封面图/.test(modals[0].content) && /分类/.test(modals[0].content),
    'AI 给不了封面图和分类,不提示用户就是发布前才发现的死路');
  assert.equal(p.data.aiSheetShow, false);
});

test('没有结果时采用 = 空操作(不导航、不写 storage)', () => {
  const p = makePage(OWNER);
  p.onClubAiAdopt();
  assert.deepEqual(nav, []);
  assert.deepEqual(Object.keys(storage), []);
});
