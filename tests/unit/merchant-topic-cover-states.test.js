// 商家招募主题首屏封面四态契约：成功、慢加载、加载失败、空 URL。
// 每态都必须留下主题名、类型/来源、价值说明和明确下一步；封面只提供氛围。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('../helpers/ui-sandbox-vm.js'); // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..');
const WXML = fs.readFileSync(path.join(ROOT, 'pages/topic/merchantinfo/merchantinfo.wxml'), 'utf8');
const WXSS = fs.readFileSync(path.join(ROOT, 'pages/topic/merchantinfo/merchantinfo.wxss'), 'utf8');
const COOP_CENTER_WXML = fs.readFileSync(path.join(ROOT, 'pages/merchant/coop-center/index.wxml'), 'utf8');
const COOP_CENTER_JS = fs.readFileSync(path.join(ROOT, 'pages/merchant/coop-center/index.js'), 'utf8');
let coopCenterPageConfig = null;
global.getApp = () => ({ globalData: {}, getRequestErrorMessage: () => '' });
global.wx = {};
global.Page = (config) => { coopCenterPageConfig = config; };
require('../../pages/merchant/coop-center/index.js');

function merchantInfoPageFrom(source) {
  let config = null;
  const sandbox = {
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 } }),
    wx: {},
    Page: (page) => { config = page; },
    require: (request) => {
      if (request === '../../../utils/merchant-theme.js') {
        return { merchantPageShow() {}, merchantPageRestore() {} };
      }
      if (request === '../../../utils/datetime') {
        return require('../../utils/datetime');
      }
      if (request === '../../../utils/response-shape.js') {
        return require('../../utils/response-shape.js');
      }
      if (request === '../../../utils/motion-preference.js') {
        return require('../../utils/motion-preference.js');
      }
      if (request === '../../../utils/validation-method-labels.js') {
        return require('../../utils/validation-method-labels.js');
      }
      if (request === '../utils/topic-detail-facts.js') {
        return require('../../pages/topic/utils/topic-detail-facts.js');
      }
      if (request === '../../../utils/nav-safe-area.js') {
        return require('../../utils/nav-safe-area.js');
      }
      throw new Error('unexpected require: ' + request);
    },
  };
  vm.runInNewContext(source, sandbox, { filename: 'merchantinfo.js' });
  return config;
}

function assertCoverErrorSetsFallback(page) {
  assert.equal(typeof page.onCoverError, 'function', 'binderror 必须指向可调用 handler');
  page.data = Object.assign({}, page.data, { coverFailed: false });
  page.setDataCalls = [];
  page.setData = function (patch) {
    this.setDataCalls.push(patch);
    Object.assign(this.data, patch);
  };
  page.onCoverError({ type: 'error' });
  assert.equal(page.setDataCalls.length, 1, 'binderror 必须真的写入 coverFailed');
  assert.equal(page.setDataCalls[0].coverFailed, true, 'setData patch 必须把 coverFailed 写为 true');
  assert.equal(page.data.coverFailed, true, '失败后 WXML 才会切到 wx:else 兜底');
}

/* 2026-09-08 稿 181:576 改了这一屏的口径:封面正常出图时上面不压任何字,
   信息锚点只在**封面没出来**的两态(空 URL / binderror)渲染。
   所以这条测试从「四态都要有锚点」收窄成「封面没出来的两态必须有锚点」——
   出图的那两态屏幕上有图,不存在「一个字都没有」的问题,那才是当初 P0-UI-1 要防的。 */
test('招募主题封面缺失时保留信息锚点', () => {
  const hero = /<view class="slide1"[^>]*>([\s\S]*?)<view class="slide2"[^>]*>/.exec(WXML);
  assert.ok(hero, '找不到招募主题首屏');
  const text = hero[1];

  const brief = /<view class="cover-brief">/.exec(text);
  assert.ok(brief, '兜底态的信息锚点缺失');
  assert.match(text, /info\.name \|\| '主题详情'/, '必须保留主题名');
  assert.match(text, /info\.productType/, '必须保留类型或来源');
  assert.match(text, /info\.subtitle \|\| info\.description/, '必须保留价值一句话');
  assert.match(text, /class="slide-txt slide-txt--cover-fallback" wx:if="\{\{ !info\.imgUrl \|\| coverFailed \}\}"/,
    '锚点必须挂在「封面没出来」这个条件上,不能又变回无条件渲染压在图上');

  assert.match(text, /wx:if="\{\{ info\.imgUrl && !coverFailed \}\}"/, '有 URL 且未失败时才渲染封面');
  assert.match(text, /binderror="onCoverError"/, '404 必须进入兜底');
  assert.match(text, /<view class="slide-cover-fallback" wx:else>/, '空 URL 与加载失败必须有兜底');
  assert.match(WXSS, /\.topic \.slide1 \.slide-cover-fallback\s*\{[^}]*background: var\(--cy-bg-card-2\)/,
    '兜底不能是全白/全黑空腔');
});

function assertFallbackContrast(wxml, wxss) {
  const hero = /<view class="slide1"[^>]*>([\s\S]*?)<view class="slide2"[^>]*>/.exec(wxml);
  assert.ok(hero, '找不到招募主题首屏');
  const text = hero[1];

  assert.match(text, /class="slide-scrim \{\{ !info\.imgUrl \|\| coverFailed \? 'slide-scrim--cover-fallback' : '' \}\}"/,
    '浅色兜底必须同步移除图片态的压暗遮罩');
  /* 2026-09-08 稿 181:576:封面正常渲染时上面不压任何字(整页是一条长滚动),
     所以信息锚点整块改成「只有封面没出来才渲染」,类名不再是三元切换。
     契约要守的仍是同一件事 —— 兜底屏必须有那块深色信息锚点,不能整屏空白。 */
  assert.match(text, /class="slide-txt slide-txt--cover-fallback" wx:if="\{\{ !info\.imgUrl \|\| coverFailed \}\}"/,
    '封面缺失时必须渲染浅底信息锚点,且用 fallback 深色样式');
  assert.doesNotMatch(text, /class="slide-hint"/,
    '稿上封面不压提示语,「下滑查看…」不能回来');
  assert.match(wxss, /\.topic \.slide1 \.slide-txt--cover-fallback\s*\{[^}]*color: var\(--cy-text-title\)/,
    '浅色兜底的正文不能继续使用 inverse/白字');
  assert.match(wxss, /\.topic \.slide1 \.slide-txt--cover-fallback \.cover-brief-title\s*\{[^}]*color: var\(--cy-text-title\)/,
    '主题名在浅色兜底上必须使用深色标题 token');
  assert.match(wxss, /\.topic \.slide1 \.slide-txt--cover-fallback \.cover-brief-value\s*\{[^}]*color: var\(--cy-text-body\)/,
    '价值说明在浅色兜底上必须使用深色正文 token');
  assert.match(wxss, /\.topic \.slide1 \.slide-txt--cover-fallback \.jt\s*\{[^}]*background: var\(--cy-color-overlay\)/,
    '浅色兜底的白色下滑箭头必须有深色 token 承载底');
}

test('封面失败或空 URL 时，浅色兜底必须切换为深色信息锚点', () => {
  assertFallbackContrast(WXML, WXSS);
});

test('负控：浅色兜底重新使用 inverse/白字会判红', () => {
  const broken = WXSS.replace(
    '.topic .slide1 .slide-txt--cover-fallback {\n  color: var(--cy-text-title);\n}',
    '.topic .slide1 .slide-txt--cover-fallback {\n  color: var(--cy-text-inverse);\n}'
  );
  assert.notEqual(broken, WXSS, '变异夹具必须真的把兜底正文改回 inverse/白字');
  assert.throws(() => assertFallbackContrast(WXML, broken), /正文不能继续使用 inverse/);
});

test('主题详情 binderror 触发后真的切换 coverFailed 兜底', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages/topic/merchantinfo/merchantinfo.js'), 'utf8');
  assertCoverErrorSetsFallback(merchantInfoPageFrom(source));
});

test('负控：删除或破坏 onCoverError 会被四态测试判红', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages/topic/merchantinfo/merchantinfo.js'), 'utf8');
  const broken = source.replace(
    /onCoverError\(\) \{\s*this\.setData\(\{ coverFailed: true \}\);\s*\},/,
    'onCoverError() {},'
  );
  assert.notEqual(broken, source, '变异夹具必须真的破坏 handler');
  assert.throws(() => assertCoverErrorSetsFallback(merchantInfoPageFrom(broken)), /coverFailed/);
});

// 2026-09-15 契约改写(总控裁决「给过稿的页面听稿」,稿 234:276):合作中心广场卡按稿重做,
//   封面兜底是纯色占位,主题名/模式/档期/看详情留在卡上;旧断言盯的 cc-cover-fallback、
//   prepareApplication 与 typeText 是稿上已删的旧结构,改写为对稿后四态「不丢可理解内容」的断言。
test('合作中心路线卡片的封面四态不丢失可理解内容', () => {
  assert.match(COOP_CENTER_WXML, /wx:if="\{\{item\.cover && !item\._coverFailed\}\}"/, '只在 URL 可用时渲染封面');
  assert.match(COOP_CENTER_WXML, /binderror="onRouteCoverError"/, '图片失败必须切换兜底');
  // 2026-09-15 集成总线:占位从 wx:else 空分支改为常驻纯色底、封面 image 叠在其内(U6 空白状态分支门禁),兜底语义不变。
  assert.match(COOP_CENTER_WXML, /<view class="cc-route-cover"><image class="cc-route-cover__img" wx:if=/, '空 URL/图片失败必须有兜底:纯色占位常驻包住封面');
  assert.match(COOP_CENTER_WXML, /class="cc-route-title">\{\{item\.title\}\}/, '必须保留主题名');
  assert.match(COOP_CENTER_WXML, /item\.modeText/, '必须保留模式标签(城市定向/自由探索)');
  assert.match(COOP_CENTER_WXML, /item\.deadlineText/, '必须保留截止信息');
  assert.match(COOP_CENTER_WXML, /class="cc-detail"[^>]*bindtap="openTopic"/, '必须保留明确的看详情动作');
  assert.match(COOP_CENTER_JS, /onRouteCoverError\(e\)/, '必须处理封面加载失败');
  // 负控:封面不再有兜底分支时必须判红
  const broken = COOP_CENTER_WXML.replace('<view class="cc-route-cover"><image', '<view><image');
  assert.notEqual(broken, COOP_CENTER_WXML, '变异夹具必须真的删掉兜底');
  assert.throws(() => assert.match(broken, /<view class="cc-route-cover"><image class="cc-route-cover__img" wx:if=/), assert.AssertionError);
});

test('合作中心封面失败只标记同一张卡，迟到事件不误伤刷新后的新卡', () => {
  const page = Object.assign({}, coopCenterPageConfig, {
    data: { routes: [{ id: 7 }, { id: 8 }] },
    setData(patch) { this.patch = patch; },
  });
  page.onRouteCoverError({ currentTarget: { dataset: { index: 1, id: 8 } } });
  assert.deepEqual(page.patch, { 'routes[1]._coverFailed': true });

  page.patch = null;
  page.onRouteCoverError({ currentTarget: { dataset: { index: 1, id: 99 } } });
  assert.equal(page.patch, null, '列表已换时不能把失败写到同下标的新卡');

  page.data.routes = [{ id: '' }];
  page.onRouteCoverError({ currentTarget: { dataset: { index: 0, id: '' } } });
  assert.equal(page.patch, null, '空身份不能被误当作同一张卡');
});

/* 探索节点 tab 每一站要写清「谁在接待、在哪儿」(稿 181:715 的「商家名称（地点名称）」)。
   数据本来就在 node.registrationMerchantList[].mmsMerchant.name,只是没渲染 ——
   路线读下来只有玩法名,商家不知道这一站去谁家。
   ⚠️ 没人承接的节点整行不出,不写「待定」:那会让人以为这一站在等谁。 */
test('探索节点 tab:有承接商家的站点写出商家名与地点名，没有的不写「待定」', () => {
  const wxml = WXML;
  /* 2026-09-06 按稿 181:715 把这一段做成整张站点卡(宽图 + 图底玩法名带 + 图下商家行),
     类名 node-host → node-card。判据一条没放宽:没有承接商家仍然整块不渲染、
     不许兜底成「待定」、多家时要说得出还有几家。 */
  const block = wxml.slice(wxml.indexOf('class="node-card-foot"'), wxml.indexOf('class="node-card-foot"') + 900);
  assert.match(block, /wx:if="\{\{node\.registrationMerchantList\.length\}\}"/,
    '没有承接商家时必须整块不渲染');
  assert.match(block, /node\.registrationMerchantList\[0\]\.mmsMerchant\.name/);
  assert.match(block, /node\.name/);
  assert.doesNotMatch(block, /待定|未定|暂无/, '空缺不许兜底成占位文案');
  // 多家承接时要说得出还有几家,不能只显示第一家假装只有一家
  assert.match(block, /registrationMerchantList\.length > 1/);

  /* 玩家侧那份(pages/topic/index,稿 214:568)是同一份内容换深色 —— 两边必须同时有,
     否则商家看得到「这一站谁在接待」而玩家看不到,同一条路线两个说法。 */
  const player = fs.readFileSync(path.join(ROOT, 'pages/topic/index/index.wxml'), 'utf8');
  const pblock = player.slice(player.indexOf('class="node-card-foot"'), player.indexOf('class="node-card-foot"') + 900);
  assert.ok(player.indexOf('class="node-card-foot"') > 0, '玩家侧的站点卡缺商家行');
  assert.match(pblock, /wx:if="\{\{node\.registrationMerchantList\.length\}\}"/);
  assert.match(pblock, /node\.registrationMerchantList\[0\]\.mmsMerchant\.name/);
  assert.doesNotMatch(pblock, /待定|未定|暂无/);
})
