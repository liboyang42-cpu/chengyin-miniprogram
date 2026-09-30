'use strict';

/**
 * 断链 #6：自由探索「扫码进店」页（pages/play/merchant/index.js）不认识 advanced 段玩法。
 *
 * 该页的架构既定是**不装玩法组件**（index.json 里没有 cy-playkit / cy-advanced-game，
 * 玩法宿主唯一在 pages/play/index）。所以它自己永远渲染不出 advanced 面板 ——
 * 唯一的正路是同文件 openPreferenceGame 已经用过的那个捷径：navigateBack 回上一页，
 * 把归一化后的节点交给游玩页的 startGame。
 *
 * 本测试钉的是这条捷径对 advanced 也成立，以及**接不上时必须退回任务卡**（不能白屏）。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const MERCHANT_PATH = require.resolve('../../pages/play/merchant/index.js');
const PLAY_PATH = require.resolve('../../pages/play/index.js');

let merchantDef;
let playDef;

function capturePage(file, setDef, extraWx) {
  const savedPage = global.Page;
  const savedGetApp = global.getApp;
  const savedWx = global.wx;
  global.Page = (options) => { setDef(options); };
  global.getApp = () => ({
    globalData: { user_id: 9, features: {} },
    isDevEnv: () => false,
    sendRequest() {},
    chooseImage() {},
  });
  global.wx = Object.assign({
    getStorageSync: () => '',
    setStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
  }, extraWx || {});
  delete require.cache[file];
  require(file);
  global.Page = savedPage;
  global.getApp = savedGetApp;
  global.wx = savedWx;
}

capturePage(MERCHANT_PATH, (def) => { merchantDef = def; });
capturePage(PLAY_PATH, (def) => { playDef = def; });

/** wx 的 setData 支持 'a.b' 点号键；桩也必须支持，否则 'task.show' 会变成一个畸形顶层键。 */
function applyData(target, update) {
  Object.keys(update).forEach((key) => {
    if (key.indexOf('.') === -1) { target[key] = update[key]; return; }
    const parts = key.split('.');
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!cursor[parts[i]] || typeof cursor[parts[i]] !== 'object') cursor[parts[i]] = {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = update[key];
  });
}

function createMerchantPage(node, prev) {
  const calls = [];
  const page = Object.assign({}, merchantDef, {
    data: Object.assign(JSON.parse(JSON.stringify(merchantDef.data)), {
      node: Object.assign({ nodeId: 7, arrived: true, done: false, selfReported: false }, node),
    }),
    setData(update, cb) { applyData(this.data, update); if (cb) cb(); },
    _session: { activityId: 1 },
    _prev: prev === undefined ? null : prev,
  });
  page.calls = calls;
  const wx = {
    navigateBack(opts) {
      calls.push({ navigateBack: true });
      page._back = () => { if (opts && opts.success) opts.success(); };
      page._backFails = () => { if (opts && opts.fail) opts.fail({ errMsg: 'navigateBack:fail' }); };
    },
  };
  global.wx = wx;
  return page;
}

function createPlayPage() {
  const page = Object.assign({}, playDef);
  page.data = JSON.parse(JSON.stringify(playDef.data));
  page.setData = function setData(update, cb) { applyData(this.data, update); if (cb) cb(); };
  page.stopAudio = () => {};
  return page;
}

const ADVANCED_NODE = {
  name: '藏在店里的机关',
  hasGame: true,
  hasTemplate: true,
  hasAdvanced: true,
  advancedConfig: { schemaVersion: '5.1', hiddenObject: { enabled: true } },
  vm: 0,
  validationMethod: 0,
  question: '',
};

test('★advanced 节点扫码进店：必须 navigateBack 交回游玩页 startGame，而不是开一张点不动的任务卡', () => {
  const page = createMerchantPage(ADVANCED_NODE, { startGame() {} });
  const started = [];
  page._prev.startGame = (node) => started.push(node);

  page._maybeAutoPopup();

  assert.equal(page.calls.filter((c) => c.navigateBack).length, 1,
    'advanced 节点必须走 navigateBack 捷径（本页没有玩法组件，自己渲染不出面板）');
  page._back();
  assert.equal(started.length, 1, 'navigateBack 成功后必须把节点交给游玩页 startGame');
  assert.equal(started[0].nodeId, 7);
  assert.equal(started[0].hasAdvanced, true, '交接的必须是带 hasAdvanced 的归一化节点，否则游玩页只会当普通题渲染');
  assert.equal(page.data.task.show, false, '已经交给玩法宿主了，不该再弹任务卡');
  assert.equal(page.data.game.show, false, '商家页那张本地答题弹层不得为 advanced 节点打开');
});

test('★优先序：advanced 与 vm6 偏好题并存时 advanced 先，和游玩页 startGame 的 hasAdvanced early-return 同序', () => {
  const js = read('pages/play/merchant/index.js');
  const body = js.match(/_maybeAutoPopup\(\) \{([\s\S]*?)\n  \},/);
  assert.ok(body, '_maybeAutoPopup 必须存在');
  const advancedAt = body[1].indexOf('this.openAdvancedGame');
  const preferenceAt = body[1].indexOf('this.openPreferenceGame');
  assert.ok(advancedAt >= 0, '_maybeAutoPopup 必须把 advanced 节点接到玩法宿主');
  assert.ok(advancedAt < preferenceAt,
    '游玩页 startGame 是 hasAdvanced 先弹玩法面板，这边也必须 advanced 排在偏好题分支之前');

  const playPage = createPlayPage();
  assert.equal(typeof playPage.startGame, 'function',
    '游玩页 startGame 是这条捷径的接收端，签名变了要同时改本页');
  playPage.setData({ 'sheet.node': Object.assign({}, ADVANCED_NODE, { vm: 6, validationMethod: 6 }) });
  playPage._advancedReadyNodeId = null;
  playPage.startGame();
  assert.equal(playPage.data.advancedPlay.show, true,
    '并存时游玩页实际弹的是 advanced 面板 —— 商家页若把这类节点当偏好题交回去，落地也必须还是它');
});

test('无 advanced 的老 vm6 节点：行为不变，仍走偏好题捷径回游玩页', () => {
  const page = createMerchantPage({
    hasGame: true, hasAdvanced: false, validationMethod: 6, vm: 6, question: '你更喜欢哪种？',
  }, { startGame() {} });
  const started = [];
  page._prev.startGame = (node) => started.push(node);

  page._maybeAutoPopup();

  assert.equal(page.calls.filter((c) => c.navigateBack).length, 1);
  page._back();
  assert.equal(started.length, 1);
  assert.equal(started[0].validationMethod, 6);
  assert.equal(page.data.task.show, false);
});

test('无 advanced、无题面的老店：行为不变，弹任务卡且绝不 navigateBack', () => {
  const page = createMerchantPage(
    { hasGame: false, hasAdvanced: false, validationMethod: 2, vm: 2, question: '' },
    { startGame() {} });

  page._maybeAutoPopup();

  assert.equal(page.calls.length, 0, '老节点不该碰 navigateBack');
  assert.equal(page.data.task.show, true, '没配玩法的店只有这一张任务卡，不能被改成返回上一页');
});

test('有题面无 advanced 的老节点：仍在本页开本地答题卡，不被误劫去 navigateBack', () => {
  const page = createMerchantPage(
    { hasGame: true, hasAdvanced: false, validationMethod: 1, vm: 1, question: '门口石狮子几只？' },
    { startGame() {} });

  page._maybeAutoPopup();

  assert.equal(page.calls.length, 0);
  assert.equal(page.data.game.show, true);
});

test('★接不上（上一页没有 startGame）：必须退回任务卡，不抛错、不白屏', () => {
  const page = createMerchantPage(ADVANCED_NODE, { data: { nodes: [] } });
  assert.doesNotThrow(() => page._maybeAutoPopup());
  assert.equal(page.calls.filter((c) => c.navigateBack).length, 0,
    '上一页根本没有玩法宿主时，返回过去只会落在一张没开的卡上');
  assert.equal(page.data.task.show, true, '退路必须是任务卡：到店后至少还能拍照/核销');
});

test('★接不上（没有上一页，如票夹/分享直达）：同样退回任务卡，不抛错', () => {
  const page = createMerchantPage(ADVANCED_NODE, null);
  assert.doesNotThrow(() => page._maybeAutoPopup());
  assert.equal(page.calls.length, 0);
  assert.equal(page.data.task.show, true);
});

test('navigateBack 失败时不得静默：留在本页给出可读提示或退路，不能白跑一趟', () => {
  const page = createMerchantPage(ADVANCED_NODE, { startGame() {} });
  page._maybeAutoPopup();
  assert.equal(page.data.task.show, false, '返回还没失败前不该提前弹任务卡');
  page._backFails();
  assert.ok(page.data.feedback || page.data.task.show,
    '返回失败要么给一句提示，要么落回任务卡，不能什么都不发生');
});

test('未进店 / 已完成时仍然什么都不弹（进店闸不许被新分支绕过）', () => {
  const notArrived = createMerchantPage(Object.assign({}, ADVANCED_NODE, { arrived: false }), { startGame() {} });
  notArrived._maybeAutoPopup();
  assert.equal(notArrived.calls.length, 0, '未进店不许把玩家甩回上一页开玩法');
  assert.equal(notArrived.data.task.show, false);

  const done = createMerchantPage(Object.assign({}, ADVANCED_NODE, { done: true }), { startGame() {} });
  done._maybeAutoPopup();
  assert.equal(done.calls.length, 0);
  assert.equal(done.data.task.show, false);
});

test('架构既定：本页不装玩法组件，advanced 只能靠交接（index.json 加了就判红）', () => {
  const json = JSON.parse(read('pages/play/merchant/index.json'));
  const used = Object.keys(json.usingComponents || {});
  const hosts = used.filter((k) => /playkit|advanced-game/i.test(k));
  assert.deepEqual(hosts, [],
    '玩法宿主唯一在 pages/play/index；本页一旦自己装一套评分/确认 UI 就又是第二真源');
});

test('mutation 负控：摘掉 hasAdvanced 分支后本契约确实变红', () => {
  const original = read('pages/play/merchant/index.js');
  const mutated = original
    .replace(/[ \t]*if \(node\.hasAdvanced\)[^\n]*openAdvancedGame[^\n]*\n/, '');
  assert.ok(mutated !== original, '负控必须真实删掉 advanced 分支（分支不存在＝断链 #6 本身）');
  const m = mutated.match(/_maybeAutoPopup\(\) \{([\s\S]*?)\n  \},/);
  assert.ok(m, '_maybeAutoPopup 必须仍然存在');
  assert.ok(!m[1].includes('this.openAdvancedGame'),
    '摘掉分支后 _maybeAutoPopup 就不该再有 advanced 出口 —— 契约必须因此变红');
});
