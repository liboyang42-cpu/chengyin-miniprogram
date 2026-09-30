// publish/fabu 发布前安全预检回归。
//
// 2026-08-09:专业发布的三处 AI 助写(章节概述 / 节点文字说明 / 真实商家主题方案)按产品决定
// 整体下线 —— 简单发布有自己的 AI,专业发布不再提供。对应的 9 个用例随代码一起删除。
// 内容安全预检不是助写、是发布闸门,保留。
//
// 为什么要有这个文件:三口都是 @RequestBody 端点,前端漏 JSON header 时
// request-client 会退回 'application/x-www-form-urlencoded;',后端 Spring 拒收,
// 但 GlobalExceptionHandler 把它兜成 HTTP 200 + {code:500} —— 页面看着"正常",
// 业务方法体一行没执行。坏了不报警,只能靠断言钉死请求形状。
//
// 承重不变量:
//  - 预检调用:header 必须是 {'Content-Type':'application/json'} 且 data 是手动 stringify 的 string。
//  - onLoad 顺序:AI 草稿必须先于 starter 灌注被消费掉,且消费后不滞留 storage。
//  - 预检是发布前置闸门:level=error 阻断提交;
//    但 type=parse_error(AI 自己炸了)只降级成 advisory —— AI 挂了不能堵死发布路(可用性红线)。
//  - 频控/网络挂 → 降级放行,文案做包含匹配(后端运行时拼 dailyLimit,数字随配置变)。
//  - silentError:预检 code!=200 由页面接管内联展示,不关掉 request-client 就是双 toast。
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../pages/publish/fabu/index.js';

let sent = [];
let storage = {};
let navigations = [];

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (p) => { sent.push(p); },
  chooseImage: () => {},
  getUserID: () => 42,
  getNickname: () => '测试创作者',
  getAvatar: () => '',
  getUserInfo: () => null,
  getToken: () => '',
});
global.wx = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  showModal: (options) => { if (options.success) options.success({ confirm: true }); },
  navigateTo: (options) => { navigations.push({ type: 'navigate', ...options }); },
  redirectTo: (options) => { navigations.push({ type: 'redirect', ...options }); },
  createMapContext: () => ({ getCenterLocation: () => {} }),
  pageScrollTo: () => {}, nextTick: (f) => f(),
};

let pageConfig = null;
global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  sent = [];
  storage = {};
  navigations = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  // utils/loading.js 的原生回落带 show/hide 计数,跟页面一起重装,别让上一条用例的余额漏进来
  delete require.cache[require.resolve('../../utils/loading.js')];
  require(PAGE);
});

// 造页面实例:setData 用小程序的路径语义(简化版:支持 'a.b' 与 'a[0].b')
function makePage() {
  const inst = Object.assign({}, pageConfig);
  inst.data = JSON.parse(JSON.stringify(pageConfig.data));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let o = inst.data;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = patch[k];
    });
    if (cb) cb();
  };
  return inst;
}

// 一个「本地校验全过、可直接发布」的页面。
// 每个场景都要新实例:publish-workflow 有在途提交锁,复用实例会被上一次提交锁住(那是脚手架假红,不是产品 bug)。
function makeReadyPage() {
  storage = { topic_starter_prefilled_v1: true };
  const p = makePage();
  p.onLoad({});
  p.data.selectedCategoryIds = [1];
  p.data.startDateTime = '2026-08-01 10:00';
  p.data.endDateTime = '2026-08-08 18:00';
  Object.assign(p.data.formData, {
    name: '测试路线', subtitle: '副标题', description: '描述',
    startDate: '2026-08-01 10:00', endDate: '2026-08-08 18:00', imgUrl: 'https://x/y.png',
    tickets: [{ name: '票', price: 0, mode: 2, startTime: '2026-08-01', endTime: '2026-08-08' }],
    chapters: [{
      name: 'C1', description: '用于发布校验的真实章节剧情', nodes: [
        {
          name: '有玩法的节点', description: '节点说明', templateId: 7,
          longitude: '121.4737', latitude: '31.2304',
          templateInfo: { title: 'G', ruleInstructions: '找到红色招牌', hint1: '看左边', hint2: '在二楼' }
        },
        // 2026-08-10 起每个节点都必须有可用坐标才能发布(没坐标的点玩家走不到),
        // 所以「可直接发布」的 fixture 必须带经纬度
        { name: '没玩法的节点', description: '这里只有文字说明', templateId: 0, templateInfo: {}, longitude: '121.48', latitude: '31.24' }
      ]
    }]
  });
  p.data.myClubs = [];
  // RUN-52 之后「确认发布」还要看发布者实名登记态。本文件测的是内容预检这道闸,
  // 这里统一当作「已登记」;未登记那条路径在文件末尾单独有一条用例钉住。
  p.data.identityRegistered = true;
  p.data.identityReady = true;
  return p;
}

const createdCount = () => sent.filter((s) => s.url === '/api/topic/create').length;

test('自由探索仅对开放承接的章节校验受控品类与容量', () => {
  const p = makeReadyPage();
  p.data.formData.productType = 2;
  p.data.formData.recruitDeadline = '2026-07-31';
  p.data.formData.chapters[0].recruitEnabled = 1;
  p.data.formData.chapters[0].categoryId = null;
  p.data.formData.chapters[0].maxMerchant = -1;

  const invalid = p._buildValidationBag();
  assert.equal(invalid.isValid(), false, '开启商家承接后必须声明匹配品类和合法容量');
  assert.match(invalid.errors.chapterRecruitCategory0, /商家品类/);
  assert.match(invalid.errors.chapterRecruitMax0, /0到127/);

  p.data.formData.chapters[0].categoryId = 18;
  p.data.formData.chapters[0].maxMerchant = 2;
  const valid = p._buildValidationBag();
  assert.equal(valid.errors.chapterRecruitCategory0, undefined);
  assert.equal(valid.errors.chapterRecruitMax0, undefined);

  p.data.formData.chapters[0].recruitEnabled = 0;
  p.data.formData.chapters[0].categoryId = null;
  p.data.formData.chapters[0].maxMerchant = 0;
  assert.equal(p._buildValidationBag().isValid(), true,
    '自由探索章节可作为路线分组；只有开启承接后才成为商家可选章节');
});

// ===== onLoad 顺序:AI 草稿 vs starter 灌注 =====

test('onLoad:AI 草稿当场生效、被消费掉、且不触发 starter 灌注', () => {
  storage = {
    'ai_topic_draft:m42': {
      name: 'AI 生成的路线', subtitle: 'AI副标题', description: 'AI描述',
      chapters: [{ name: 'AI章', nodes: [{ name: 'AI节点', address: '某地' }] }]
    }
  };
  const p = makePage();
  p.onLoad({});

  assert.equal(p.data.formData.name, 'AI 生成的路线', 'starter 若先跑会灌满 formData → applyAiDraft 门控 return → 草稿静默失效');
  assert.equal(p.data.formData.chapters[0].nodes.length, 0, '空剧情章节里的 AI 节点不能直接冒充正式节点');
  assert.equal(p.data.pendingMaterials.length, 1);
  assert.equal(p.data.pendingMaterials[0].kind, 'node');
  assert.equal('ai_topic_draft:m42' in storage, false, '草稿必须被消费,不许滞留到下次进页');
  assert.equal(storage.topic_starter_prefilled_v1, undefined, 'AI 入口不该触发 starter 灌注');
  const persisted = Object.values(storage).find(value => value && value.draftUuid && value.formData);
  assert.equal(persisted.formData.name, 'AI 生成的路线', '消费 AI 草稿后必须立即接力进完整草稿信封，杀进程也不能丢');
});

test('俱乐部 AI 草稿保留 URL 锁定归属，空剧情节点先落地点素材', () => {
  storage = {
    'ai_topic_draft:m42': {
      name: '俱乐部 AI 路线',
      chapters: [{
        name: '第1章', description: '', nodes: [{
          name: '老码头', address: '滨江路 8 号', longitude: '121.48', latitude: '31.23',
        }],
      }],
    },
  };
  const p = makePage();
  p.startClubPlaceCapture = () => {};

  p.onLoad({ clubId: '88' });

  assert.equal(p.data.formData.clubId, '88', '锁定入口必须优先于 AI 草稿里的空/旧 clubId');
  assert.equal(p.data.formData.chapters[0].nodes.length, 0);
  assert.equal(p.data.pendingMaterials.length, 1);
  assert.equal(p.data.pendingMaterials[0].kind, 'place');
  assert.equal(p.data.pendingMaterials[0].longitude, '121.48');
});

test('AI 城市章节已有真实剧情且坐标有效时才允许保留正式节点', () => {
  storage = {
    'ai_topic_draft:m42': {
      name: '有剧情的 AI 路线',
      chapters: [{
        name: '第1章', description: '沿着旧河道寻找消失的码头。', nodes: [{
          name: '老码头', address: '滨江路 8 号', longitude: '121.48', latitude: '31.23',
        }],
      }],
    },
  };
  const p = makePage();

  p.onLoad({});

  assert.equal(p.data.formData.chapters[0].nodes.length, 1);
  assert.equal(p.data.pendingMaterials.length, 0);
});

test('onLoad:无 AI 草稿时保留真实空态并给出剧情起手动作', () => {
  storage = {};
  const p = makePage();
  p.onLoad({});
  assert.equal(p.data.formData.name, '');
  assert.deepEqual(p.data.formData.chapters, []);
  // 2026-09-05:三条起点收敛成同一颗 CTA,label 统一成「＋ 创建章节」。
  assert.equal(p.data.starterAction.label, '＋ 创建章节');
});

test('玩家预览入口删除后不再注册孤立的预览适配器', () => {
  const p = makePage();
  assert.equal(typeof p.openPlayerPreview, 'undefined');
  assert.equal(typeof p.buildPlayPreviewData, 'undefined');
});

test('空草稿切换模式直接改 productType 和全部票，不新建副本', () => {
  storage = { topic_starter_prefilled_v1: true };
  const p = makePage();
  p.onLoad({ mode: '1' });

  assert.equal(p.hasUserDraftConfig(), false, '默认票不能被误判成用户内容');
  p.requestModeSwitch({ currentTarget: { dataset: { mode: '2' } } });

  assert.equal(p.data.formData.productType, 2);
  assert.ok(p.data.formData.tickets.every((ticket) => ticket.mode === 2));
  assert.equal(navigations.length, 0);
});

test('有内容切换模式复制新专业草稿，原草稿不被改写', () => {
  storage = { topic_starter_prefilled_v1: true };
  const p = makePage();
  p.onLoad({ mode: '1' });
  p.setData({ 'formData.name': '原城市定向草稿' });

  p.requestModeSwitch({ currentTarget: { dataset: { mode: '2' } } });

  assert.equal(p.data.formData.productType, 1, '源草稿留在原页面，不能被静默改模式');
  assert.equal(storage['ai_topic_draft:m42'].aiSimple, false);
  assert.equal(storage['ai_topic_draft:m42'].formData.productType, 2);
  assert.ok(storage['ai_topic_draft:m42'].formData.tickets.every((ticket) => ticket.mode === 2));
  assert.equal(navigations[0].type, 'navigate');
  assert.match(navigations[0].url, /mode=2/);
});

test('简单 AI 路线深度编辑复制为新的专业草稿', () => {
  storage = { topic_starter_prefilled_v1: true };
  const p = makePage();
  p.onLoad({ mode: '2' });
  p.setData({ aiSimple: true, 'formData.name': 'AI 路线' });

  p.copyToProfessionalDraft();

  assert.equal(storage['ai_topic_draft:m42'].aiSimple, false);
  assert.equal(storage['ai_topic_draft:m42'].formData.productType, 2);
  assert.equal(navigations[0].type, 'redirect');
  assert.match(navigations[0].url, /mode=2/);
});

// ===== 入口A:发布前安全预检 =====

test('预检:POST /api/ai/safety/precheck 带 JSON header + silentError + 摊平的 nodes', () => {
  const p = makeReadyPage();
  sent = [];
  p.submitForm();

  const req = sent[0];
  assert.equal(req.url, '/api/ai/safety/precheck');
  assert.equal(req.method, 'POST');
  assert.deepEqual(req.header, { 'Content-Type': 'application/json' });
  assert.equal(typeof req.data, 'string');
  assert.equal(req.silentError, true, '不 silentError → request-client 自动 toast + 页面内联报错 = 双弹');

  const body = JSON.parse(req.data);
  assert.equal(body.title, '测试路线');
  assert.equal(body.nodes.length, 2, '节点必须跨章节摊平');
  assert.equal(body.nodes[0].task, '找到红色招牌', '有玩法的节点取 templateInfo.ruleInstructions');
  assert.equal(body.nodes[0].hint1, '看左边');
  assert.equal(body.nodes[0].hint2, '在二楼');
  assert.equal(body.nodes[1].task, '这里只有文字说明', '无玩法节点退化用 description,不许硬传空');
});

test('预检是前置闸门:回包之前绝不能已经把主题发出去', () => {
  const p = makeReadyPage();
  sent = [];
  p.submitForm();
  assert.equal(createdCount(), 0, '不能边检边发');
});

test('预检 error 级 issue → 阻断提交,且「继续发布」无效', () => {
  const p = makeReadyPage();
  sent = [];
  p.submitForm();
  sent[0].success({
    code: '200',
    data: { traceId: 't1', pass: false, issues: [{ level: 'error', type: 'content_security', message: '含违规内容' }] }
  });

  assert.equal(p.data.publishCheck.show, true);
  assert.equal(p.data.publishCheck.blocking.length, 1);
  assert.equal(p.data.publishCheck.blocking[0].label, '含违规内容');
  assert.equal(createdCount(), 0, 'error 必须阻断提交');

  p.confirmPublishCheck();
  assert.equal(createdCount(), 0, '有 blocking 时「继续发布」必须是空操作');
});

test('★ parse_error 是「AI 自己炸了」→ 只降级成 advisory,不许堵死发布路', () => {
  const p = makeReadyPage();
  sent = [];
  p.submitForm();
  sent[0].success({
    code: '200',
    data: { traceId: 't2', pass: false, issues: [{ level: 'error', type: 'parse_error', message: 'AI 响应格式异常,请重试' }] }
  });

  assert.equal(p.data.publishCheck.blocking.length, 0,
    'parse_error 虽然 level=error,但错在 AI 不在用户内容,阻断=可用性事故');
  assert.ok(p.data.publishCheck.advisory.some((a) => a.label === 'AI 响应格式异常,请重试'),
    'parse_error 要以建议项呈现,不能静默吞掉');

  sent = [];
  p.confirmPublishCheck();
  assert.equal(createdCount(), 1, 'parse_error 后必须还能发布');
});

test('★ 预检频控超限 → 降级放行 + 友好文案(包含匹配,不硬编码 dailyLimit 数字)', () => {
  const p = makeReadyPage();
  sent = [];
  p.submitForm();
  // 后端运行时把 dailyLimit 拼进文案,这里故意用 35 而不是默认的 20:
  // 页面若改成硬编码整串匹配,这条就会红。
  sent[0].success({ code: 500, msg: '今日AI次数已用完(35/天),明天再来吧' });

  const labels = p.data.publishCheck.advisory.map((a) => a.label);
  assert.equal(p.data.publishCheck.blocking.length, 0);
  assert.ok(labels.some((l) => l.indexOf('AI 次数已用完') >= 0), '频控要给专门的友好文案,不能落到通用兜底');

  sent = [];
  p.confirmPublishCheck();
  assert.equal(createdCount(), 1, '频控用完必须还能发布');
});

test('预检网络挂 → 降级放行,给通用兜底文案', () => {
  const p = makeReadyPage();
  sent = [];
  p.submitForm();
  sent[0].fail();

  const labels = p.data.publishCheck.advisory.map((a) => a.label);
  assert.equal(p.data.publishCheck.blocking.length, 0);
  assert.ok(labels.some((l) => l.indexOf('安全预检暂不可用') >= 0));

  sent = [];
  p.confirmPublishCheck();
  assert.equal(createdCount(), 1, '网络挂必须还能发布');
});

test('预检防连点:在途再次 submitForm 不重复烧 AI 次数', () => {
  const p = makeReadyPage();
  sent = [];
  p.submitForm();
  p.submitForm();
  assert.equal(sent.filter((s) => s.url === '/api/ai/safety/precheck').length, 1,
    '频控 20/天 是全端点共用一池,连点必须只发一次');
});

// ★★ HTTP statusCode != 200(部署期 502 窗口:本仓库合并即自动部署,「200→502→200」是明写的既有现象)。
// request-client.js:90-98 在这条路上只弹一个 toast 就 return —— success 和 fail 一个都不调,
// 唯一还会触发的是 complete。若重置只写在 success/fail 里:
//   ① _prechecking 永为 true → runPublishPrecheck 首行的在途守卫从此永远拦掉所有请求
//      → 发布按钮彻底变哑巴、零提示;
//   ② 带 mask 的 loading 永不消失 → loading 是 app 全局的,跳页也不消失,冻住用户落到的任何页。
// 这把 AI 变成了发布路的硬依赖 —— 正是「AI 挂了不能堵死发布路」这条可用性红线要防的事。
test('★ 预检遇 HTTP 502(success/fail 都不触发,只有 complete)→ 不许锁死发布路', () => {
  const p = makeReadyPage();
  sent = [];
  p.submitForm();
  const req = sent.find((s) => s.url === '/api/ai/safety/precheck');
  assert.ok(req, '第一次点发布应该发出预检');
  assert.equal(typeof req.complete, 'function',
    '必须传 complete —— 它是 statusCode!=200 时唯一还会跑的回调,不传就没有任何重置时机');

  // 模拟 request-client 的 502 分支:success/fail 都不调,只调 complete
  req.complete({ statusCode: 502 });

  // 用户再点一次发布:必须能重新发出预检(而不是被永久卡住的在途守卫吞掉)
  sent = [];
  p.submitForm();
  assert.equal(sent.filter((s) => s.url === '/api/ai/safety/precheck').length, 1,
    '502 之后发布按钮必须还能用;若这里是 0,说明 _prechecking 泄漏成永久 true = 发布路被 AI 锁死');
});

/* 2026-09-06:预检的在途反馈**用仓库唯一的 cyLoading**(utils/loading.js 明写
 * 「替代 wx.showLoading / hideLoading」),不用结果面板 —— 面板只管**结果**,
 * 在途这一档已经有指定机制,再起一套就是自造平行组件。
 * 被防的失败模式一字未变:502 时 success/fail 一个都不跑,只有 complete 会跑;
 * 漏收就留一块全屏遮罩挡死用户落到的任何页。断言随之钉 cyLoading 的收放配平。 */
test('★ 预检遇 HTTP 502 → 必须收掉在途遮罩,否则挡死整页', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../../pages/publish/fabu/index.js'), 'utf8');
  const precheck = source.slice(source.indexOf('runPublishPrecheck()'),
    source.indexOf('confirmPublishCheck()'));
  assert.ok(precheck.length > 0, '切不出预检那段就等于下面几条是空断言');
  assert.match(precheck, /cyLoading\.show\('安全预检中'\)/,
    '在途遮罩必须走 cyLoading,不许回到 wx.showLoading,也不该另起一套面板');
  const completeBlock = precheck.slice(precheck.indexOf('complete:'), precheck.indexOf('success:'));
  assert.ok(completeBlock.length > 0, 'complete 段必须切得出来');
  assert.match(completeBlock, /cyLoading\.hide\(\)/,
    '收遮罩只能放 complete —— 502 时 success/fail 一个都不跑,放别处就是永久遮罩');
  assert.match(completeBlock, /_prechecking = false/,
    '在途守卫也只能在 complete 重置,否则一次 502 就把发布按钮变哑巴');
});


/* 2026-09-19 RUN-52:发布者实名是发布确认弹层里的第二道闸,和内容预检互不替代。
 * 上面所有用例都在「已登记」的 fixture 上跑(那才是内容预检的路径),这一条专门钉:
 * 没登记时确认发布必须是空操作、登记成功之后同一次点击才把主题发出去。 */
test('★ 发布者实名没登记 → 确认发布不放行;登记成功那一发之后才发主题', () => {
  const p = makeReadyPage();
  p.data.identityRegistered = false;
  p.data.identityReady = false;
  sent = [];
  p.submitForm();
  sent[0].success({ code: '200', data: { traceId: 't9', pass: true, issues: [] } });
  assert.equal(p.data.publishCheck.blocking.length, 0, '实名不属内容预检的 blocking,别混进那份清单');
  assert.equal(p.data.identityReady, false);

  sent = [];
  p.confirmPublishCheck();
  assert.equal(sent.length, 0, '实名没登记时「确认发布」必须是空操作(不静默放行,也不硬发)');

  Object.assign(p.data, {
    identityRealName: '林野',
    identityIdCard: '99000019491231019X', // GB11643 校验位自洽的测试号
    identityConsented: true,
  });
  p.syncIdentityReady();
  assert.equal(p.data.identityReady, true);

  sent = [];
  p.confirmPublishCheck();
  assert.equal(sent[0].url, '/api/publisher/identity');
  assert.equal(JSON.parse(sent[0].data).source, 'topic_publish');
  assert.equal(createdCount(), 0, '实名没落库前不得把主题发出去(后端闸就按这个顺序判)');
  assert.equal(p.data.publishCheck.show, true, '登记在途不关弹层');

  sent[0].success({ code: 200, data: { registered: true } });
  assert.equal(p.data.identityRegistered, true);
  assert.equal(p.data.publishCheck.show, false);
  assert.equal(createdCount(), 1, '实名落地后同一次点击就把主题发出去');
});

test('★ 实名登记失败 → 弹层留在原地报错,字段不丢,主题不发', () => {
  const p = makeReadyPage();
  p.data.identityRegistered = false;
  p.data.identityReady = false;
  sent = [];
  p.submitForm();
  sent[0].success({ code: '200', data: { traceId: 't8', pass: true, issues: [] } });
  assert.equal(p.data.publishCheck.show, true, '后面的断言以「弹层开着」为前提');
  Object.assign(p.data, {
    identityRealName: '林野', identityIdCard: '99000019491231019X', identityConsented: true,
  });
  p.syncIdentityReady();
  sent = [];
  p.confirmPublishCheck();
  assert.equal(sent[0].url, '/api/publisher/identity');
  sent[0].success({ code: 500, msg: '该证件已绑定其他账号' });
  assert.equal(p.data.identityError, '该证件已绑定其他账号');
  assert.equal(p.data.publishCheck.show, true, '报错要让位给同一层的字段,不能把弹层关掉');
  assert.equal(createdCount(), 0);
  assert.equal(p.data.identityReady, true, '三项还在,置灰键不该反过来又被点亮成假可用');
});
