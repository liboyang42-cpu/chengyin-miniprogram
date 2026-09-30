const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { splitPublishedTopics, buildTodayBoard, hasTodoSummaryPayload } = require('../../utils/merchant-workbench');

test('商家工作台将自由定向主题与普通主题分开', () => {
  const result = splitPublishedTopics([
    { id: 1, productType: 1 },
    { id: 2, productType: '2' },
    { id: 3, productType: null },
  ]);

  assert.deepEqual(result.topicList.map((item) => item.id), [1, 3]);
  assert.deepEqual(result.freeExploreList.map((item) => item.id), [2]);
});

test('待办摘要必须收到完整计数合同，200 + {} 不得冒充成功', () => {
  assert.equal(hasTodoSummaryPayload({}), false);
  assert.equal(hasTodoSummaryPayload([]), false);
  assert.equal(hasTodoSummaryPayload({ pendingOrders: 0 }), false);
  assert.equal(hasTodoSummaryPayload({
    pendingOrders: 0, pendingVerify: 0, pendingScanConfirm: 0, refundCount: 0, verifiedCount: 0,
  }), false, '缺少 biddingTopics 时不得把不完整摘要当成功');
  assert.equal(hasTodoSummaryPayload({
    biddingTopics: 0, pendingOrders: 0, pendingVerify: 0, pendingScanConfirm: 0, refundCount: 0, verifiedCount: 0,
  }), true);
  assert.equal(hasTodoSummaryPayload({
    biddingTopics: '3', pendingOrders: 0, pendingVerify: 0, pendingScanConfirm: 0, refundCount: 0, verifiedCount: 0,
  }), true, '兼容接口层纯数字字符串');
  [null, undefined, '', '   ', 2.7, '2.7', true, {}, []].forEach((badCount) => {
    assert.equal(hasTodoSummaryPayload({
      biddingTopics: badCount, pendingOrders: 0, pendingVerify: 0, pendingScanConfirm: 0, refundCount: 0, verifiedCount: 0,
    }), false, `非法计数 ${String(badCount)} 不得进入 ready 态`);
  });
  assert.equal(hasTodoSummaryPayload({
    biddingTopics: 0, pendingOrders: 0, pendingVerify: 0, pendingScanConfirm: 0, refundCount: -1, verifiedCount: 0,
  }), false);

  const pageJs = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.js'), 'utf8');
  const todoMethod = pageJs.match(/loadTodo\([^)]*\)\s*\{([\s\S]*?)\n  \},\n\n  \/\/ 实时动态/);
  assert.ok(todoMethod, 'loadTodo 方法锚点不见了');
  assert.match(todoMethod[1], /hasTodoSummaryPayload\(res\.data\)/, 'payload 校验必须接在 todo-summary 响应上');

  assert.doesNotMatch(pageJs, /loadFunnel\s*\(/,
    '营销分析已有独立一级页，工作台不得重复请求同一份数据');
  assert.doesNotMatch(pageJs, /\/api\/merchant\/funnel/,
    '工作台不消费兼容路由，避免首屏死请求');
});

test('行动 checklist 只列数量为正的待办项并保留跳转 action', () => {
  const board = buildTodayBoard({ pendingOrders: 0, pendingVerify: 2, pendingScanConfirm: 0, refundCount: 1 });

  assert.deepEqual(board.checklist.map((item) => [item.key, item.label, item.action, item.count]), [
    ['pendingVerify', '待核销', 'verify', 2],
    ['refundCount', '退款', 'refund', 1],
  ]);
});

test('脏计数(null/字符串/负数/小数)不把 NaN 写进 checklist', () => {
  const board = buildTodayBoard({ pendingOrders: null, pendingVerify: '3', pendingScanConfirm: -5, refundCount: 2.7 });

  assert.deepEqual(board.checklist.map((item) => item.count), [3, 2]);
});

test('todo 缺失时给出空 checklist 而不是抛错', () => {
  const board = buildTodayBoard(undefined);

  assert.deepEqual(board.checklist, []);
});

function assertLegacyMerchantHero(wxml, wxss) {
  assert.match(wxml, /class="rv-hero-avatar-hit"[^>]*bindtap="goBrandManage"[^>]*aria-role="button"[^>]*aria-label="管理品牌资料"/);
  // #870 的延续:门店 hero 是商家主体,没配 logo 就空位(容器自带背景),
  // 绝不能兜底到 userInfo.avatar —— 那会把登录者的个人头像挂成门店脸
  // 2026-09-21:cy-avatar.src 是强类型 String,API 给 null 会报类型警告(F-17),
  //   所以允许且只允许归一成空串;任何图片路径或 userInfo 兜底仍判红 —— 空串就是"空位"。
  assert.match(wxml, /class="rv-hero-avatar"[\s\S]{0,80}src="\{\{ merchantInfo\.logo(?: \|\| '')? \}\}"/,
    'hero 头像必须只读 merchantInfo.logo(至多归一为空串)');
  // ⚠️ 负向断言不能写成 /\|\|\s*(?!'')/ —— \s* 会回溯成零宽,于是 (?!'') 在那个空格上成立,
  //   任何兜底都判绿(本文件下方 box-shadow 那条注释记的是同一个坑)。把 \s* 挪进断言里面。
  assert.doesNotMatch(wxml, /merchantInfo\.logo\s*\|\|(?!\s*'')/,
    '商家没配 logo 时是空位,不能兜底到个人头像或玩家默认头像');
  assert.match(wxml, /class="rv-revenue-amount"[^>]*>[\s\S]*dashboardData\.revenue/);
  assert.match(wxml, /<cy-skeleton[^>]*wx:if="\{\{dashboardLoading && dashboardData\.revenue == null\}\}"[^>]*type="amount"/,
    '只有未知收入的首载才显示 amount 骨架');
  assert.match(wxml, /class="rv-actions"/);
  [
    ['goScanQR', '扫码'],
    ['goCustomers', '客户'],
    ['goFinance', '财务'],
    ['openMoreMenu', '更多'],
  ].forEach(([handler, label]) => {
    // 权限闸必须保留；按压态等属性可插在 aria-label 后，不锁属性紧跟 >。
    assert.match(wxml, new RegExp(`<view class="rv-action"[^>]*merchantAccess\\.[^>]*bindtap="${handler}"[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?<text class="rv-action-label">${label}<`));
  });
  assert.doesNotMatch(wxml, /经营概览|class="rv-overview|class="rv-primary-actions"/);

  const amount = wxss.match(/\.rv-revenue-amount \{([^}]*)\}/);
  assert.ok(amount, '.rv-revenue-amount 规则不见了');
  assert.match(amount[1], /font-size:\s*88rpx/, '收入必须恢复为 hero 大数字');
  const avatarHit = wxss.match(/\.rv-hero-avatar-hit \{([^}]*)\}/);
  assert.ok(avatarHit, '.rv-hero-avatar-hit 规则不见了');
  // 2026-09-17 用户定:头像 88→112rpx
  assert.match(avatarHit[1], /width:\s*112rpx/);
  assert.match(avatarHit[1], /height:\s*112rpx/);
  const actionCircle = wxss.match(/\.rv-action-circle \{([^}]*)\}/);
  assert.ok(actionCircle, '.rv-action-circle 规则不见了');
  // 2026-09-17 用户定:快捷圆钮 96→120rpx(icon 不变)
  assert.match(actionCircle[1], /width:\s*120rpx/);
  assert.match(actionCircle[1], /height:\s*120rpx/);
  assert.match(actionCircle[1], /border-radius:\s*50%/);
}

function componentTags(source, name) {
  return Array.from(source.matchAll(new RegExp(`<${name}\\b[^>]*\\/>`, 'g')), (match) => match[0]);
}

function assertWorkbenchStateSemantics(wxml) {
  // 2026-09-16 去闸:未登录/确认中/无身份不再整屏,失败只落页内内联错误 + 重试。
  assert.doesNotMatch(wxml, /rv-gate|consoleState/, '整屏身份闸必须删除');
  assert.doesNotMatch(wxml, /登录后查看商家工作台|去登录|正在确认商家身份|没有商家身份/, '整屏闸文案必须删除');

  const consoleError = componentTags(wxml, 'cy-inline-error')
    .find((tag) => /wx:if="\{\{consoleError\}\}"/.test(tag));
  assert.ok(consoleError, '工作台加载失败必须由页内内联错误表达');
  assert.match(consoleError, /bind:action="reloadConsole"/, '工作台错误态必须提供真实重试动作');
  assert.match(consoleError, /\bsub=/, '工作台错误态必须告诉用户发生了什么');
  assert.doesNotMatch(wxml, /<cy-empty\b[^>]*kind="offline"/, '错误态不得继续走 cy-empty offline 别名');

  // 局部失败保留已加载内容，并用 inline error 只重试该区块。
  assert.doesNotMatch(wxml, /<cy-inline-error\b[^>]*wx:if="\{\{joinError \|\| hostError \|\| todoError\}\}"/,
    '项目刷新失败静默降级:已加载的卡片留在屏上,不挂横幅');
}

test('工作台首屏恢复收入大数字 + 四个圆形快捷入口，待办仍使用 checklist', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.wxss'), 'utf8');

  assertLegacyMerchantHero(wxml, wxss);
  assert.match(wxml, /<cy-skeleton[^>]*wx:if="\{\{!projectCards\.length && \(joinLoading \|\| hostLoading \|\| todoLoading \|\| gameEntryLoading\)\}\}"/,
    '只有没有旧项目的首载才显示项目骨架');
  // 失败不冒充空态：已加载卡片保留，区块内出现唯一恢复动作。
  const js = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.js'), 'utf8');
  assert.doesNotMatch(wxml, /部分项目没更新成功/);
  assert.doesNotMatch(js, /notifyLoadFailed\(\)/, '局部失败不再只靠一次性 toast');
  ['\/api\/registration\/merchant\/list', '\/api\/project\/my', '\/api\/merchant\/todo-summary'].forEach((url) => {
    assert.match(js, new RegExp(url + "'[\\s\\S]{0,120}retry: 2"),
      `只读请求 ${url} 必须带自动重试，大部分抖动不该让用户看见`);
  });
  assert.doesNotMatch(wxml, /todayBoard\.metrics/);
  assert.doesNotMatch(wxml, /residualTodos/,
    '订单/退款不上工作台:不发货 ⇒ 待发货恒 0，退款状态归客户名单');
  assert.ok(!/rv-todo-cell/.test(wxml), '旧的数字格子待办区应已被 checklist 取代');
  assert.doesNotMatch(wxml, /\bcoopCount\b/, '没有合同来源的合作计数不得渲染');
  // 项目卡的触达高度改由封面高度(144rpx)保证,不再有 checklist 行
  const card = wxss.match(/\.rv-project-card \{([^}]*)\}/);
  assert.ok(card, '.rv-project-card 规则不见了');
  assert.match(card[1], /padding:\s*var\(--cy-space-3\)/);
});

test('工作台状态语义:加载失败落页内 inline error，不再有整屏身份/错误闸', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.wxml'), 'utf8');
  assertWorkbenchStateSemantics(wxml);
});

test('负控:把整屏身份闸加回工作台时必须判红', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.wxml'), 'utf8');
  const mutated = wxml.replace(
    '<cy-inline-error class="rv-console-error"',
    '<view class="rv-gate" wx:if="{{consoleState}}"><cy-empty cta="去登录" /></view>\n    <cy-inline-error class="rv-console-error"',
  );
  assert.notEqual(mutated, wxml, '负控锚点失效：找不到工作台页内错误态');
  assert.throws(() => assertWorkbenchStateSemantics(mutated), /整屏身份闸必须删除/);
});

test('负控:首屏注入经营概览卡片形态时，旧版 hero 合同必须判红', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.wxss'), 'utf8');
  const mutated = wxml.replace(
    '<view class="rv-actions"',
    '<view class="rv-overview"><view class="rv-overview-title">经营概览</view><view class="rv-actions"',
  );
  assert.notEqual(mutated, wxml, '负控锚点失效');
  assert.throws(() => assertLegacyMerchantHero(mutated, wxss));
});

test('负控:hero 头像兜底回 userInfo.avatar(#870 修过的病)时必须判红', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.wxss'), 'utf8');
  const mutated = wxml.replace(/src="\{\{ merchantInfo\.logo(?: \|\| '')? \}\}"/g, 'src="{{ merchantInfo.logo || userInfo.avatar }}"');
  assert.notEqual(mutated, wxml, '负控锚点失效:找不到 hero 头像的 src');
  assert.throws(() => assertLegacyMerchantHero(mutated, wxss), /只读 merchantInfo\.logo|不能兜底/);
});

// 「有阴影/有描边」的判据:属性名后跟的不是 none 才算真的有。
// ⚠️ 不能写成 /box-shadow:\s*(?!none)/ —— \s* 会回溯成零宽,于是负向断言在那个空格上成立,
// 「box-shadow: none」(带空格)反而被判成"有阴影",而「box-shadow:none」(不带空格)判 false,
// 同一个语义两种写法两种结果。把 \s* 挪进断言内部就不会回溯出这个洞。
// 2026-08-01 实证:引导卡写了 box-shadow:none + border(正是本纪律要求的"二选一"写法)被误判红。
const HAS_SHADOW = /box-shadow:(?!\s*none)/;
const HAS_BORDER = /(^|\n)\s*border:(?!\s*none)/;

test('亮色域纪律:工作台带阴影的卡不再同时描边', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.wxss'), 'utf8');
  const blocks = wxss.match(/\.[a-z0-9_-]+[^{}]*\{[^}]*\}/g) || [];
  const doubled = blocks.filter((b) => HAS_SHADOW.test(b) && HAS_BORDER.test(b));
  assert.deepEqual(doubled, [], '亮色域禁描边+阴影双上');
});

test('负控:描边+阴影真的双上时必须判红,且 none 的两种写法都算"没有"', () => {
  const bad = '.x { box-shadow: var(--cy-shadow-card);\n  border: 2rpx solid #000; }';
  assert.ok(HAS_SHADOW.test(bad) && HAS_BORDER.test(bad), '真双上必须被抓到,否则门禁被改废了');

  // 二选一的合法写法:留描边、显式取消阴影。带不带空格都不该算"有阴影"。
  assert.ok(!HAS_SHADOW.test('.y { box-shadow: none;\n  border: 2rpx dashed #ccc; }'), 'box-shadow: none 不算有阴影');
  assert.ok(!HAS_SHADOW.test('.y { box-shadow:none;\n  border: 2rpx dashed #ccc; }'), 'box-shadow:none 不算有阴影');
  assert.ok(!HAS_BORDER.test('.z { box-shadow: var(--s);\n  border: none; }'), 'border: none 不算有描边');
});
