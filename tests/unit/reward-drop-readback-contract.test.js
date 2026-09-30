const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const WALL_PATH = require.resolve('../../subpackageP3/pages/badge-wall/index/index.js');
let wallDef;
{
  const prevPage = global.Page;
  const prevApp = global.getApp;
  const prevWx = global.wx;
  global.Page = (options) => { wallDef = options; };
  global.getApp = () => ({ globalData: {} });
  global.wx = { getWindowInfo: () => ({}), getSystemInfoSync: () => ({}) };
  delete require.cache[WALL_PATH];
  require(WALL_PATH);
  global.Page = prevPage;
  global.getApp = prevApp;
  global.wx = prevWx;
}

function createWall(focusCode) {
  const page = Object.assign({}, wallDef, {
    data: JSON.parse(JSON.stringify(wallDef.data)),
    setData(update, cb) { Object.assign(this.data, update); if (cb) cb(); },
    destroyEngine() {},
    initCanvas() {},
  });
  page._focusCode = focusCode;
  return page;
}

// ── 奖励掉落卡:留住服务端稳定 ID,不用 toast ────────────────
test('★徽章掉落必须留住 badgeCode，并给出查看收藏 + 继续两条路', () => {
  const js = read('pages/play/index.js');
  const wxml = read('pages/play/index.wxml');

  const hunk = js.slice(js.indexOf('const newBadges'), js.indexOf('const newBadges') + 700);
  assert.match(hunk, /code: b\.code/, 'badgeCode 是回读用的稳定 ID，映射时不能丢');
  assert.doesNotMatch(hunk, /this\.diegetic\('解锁徽章/,
    '奖励落位不能只是一句 toast —— 一闪而过就没有回读入口了');

  assert.match(wxml, /bindtap="openRewardCollection"/);
  assert.match(wxml, /bindtap="closeRewardDrop"/);
  assert.match(js, /openRewardCollection\(\)/);
});

test('查看收藏跳的是注册过的徽章墙路由，并带上 badgeCode', () => {
  const js = read('pages/play/index.js');
  const appJson = JSON.parse(read('app.json'));
  assert.match(js, /badgeCode=' \+ encodeURIComponent/);

  const target = 'pages/badge-wall/index/index';
  const registered = (appJson.subPackages || appJson.subpackages || [])
    .some((pkg) => (pkg.pages || []).includes(target));
  assert.ok(registered, '徽章墙必须是 app.json 注册过的页面，否则这个入口点了就是死的');
});

// ── 徽章墙侧:真的去墙上找那枚徽章 ────────────────────────
test('★墙上找得到且已点亮 ⇒ 说在墙上', () => {
  const wall = createWall('FIRST_STEP');
  wall._resolveFocus([{ code: 'FIRST_STEP', name: '第一步', locked: false }]);
  assert.match(wall.data.focusText, /第一步/);
  assert.match(wall.data.focusText, /已在墙上/);
});

test('★墙上找不到 ⇒ 只说本页范围，不断言「徽章没发」', () => {
  // 本页只渲染 identity 一层，而 identity 目录是全量的（含未点亮）。
  // 所以「不在 list」= 它不是身份卡，不是「还没同步」。
  // 成长六枚 MILE_*/STREAK_* 天生不在这面墙上，advanceProgress 又恰恰在发它们——
  // 原文案「还没出现在墙上,稍后下拉重试」会对真发下来的徽章说没到。
  const wall = createWall('STREAK_3');
  wall._resolveFocus([{ code: 'TOPIC_CLEAR', name: '完成一程', locked: false }]);
  assert.doesNotMatch(wall.data.focusText, /还没出现|稍后下拉重试/,
    '不得断言一件本页无权断言的事');
  assert.doesNotMatch(wall.data.focusText, /已在墙上|已点亮/);
  assert.match(wall.data.focusText, /不是身份卡|成长中心/);
});

test('找得到但仍是未点亮态 ⇒ 说没点亮，不与「已在墙上」混为一谈', () => {
  const wall = createWall('FIRST_STEP');
  wall._resolveFocus([{ code: 'FIRST_STEP', name: '第一步', locked: true }]);
  assert.match(wall.data.focusText, /还没点亮/);
});

test('没带 badgeCode 进来时不显示任何回读结论', () => {
  const wall = createWall('');
  wall._resolveFocus([{ code: 'FIRST_STEP', name: '第一步', locked: false }]);
  assert.equal(wall.data.focusText, '');
});

test('★两个 mapper 都必须保留 badgeCode —— 丢了就没法按 ID 回读', () => {
  const js = read('subpackageP3/pages/badge-wall/index/index.js');
  const identity = js.slice(js.indexOf('function itemToBadge'), js.indexOf('function medalToBadge'));
  assert.match(identity, /code: item\.badgeCode/);
  const medal = js.slice(js.indexOf('function medalToBadge'));
  assert.match(medal.slice(0, 600), /code: item\.badgeCode/);
});

test('回读结论必须真渲染出来，不能只喂无障碍属性', () => {
  const wxml = read('subpackageP3/pages/badge-wall/index/index.wxml');
  assert.match(wxml, /wx:if="\{\{focusText\}\}"[^>]*>\{\{focusText\}\}/);
});
