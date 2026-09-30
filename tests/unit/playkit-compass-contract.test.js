'use strict';

/* playkit-compass · 罗盘指向 · 现场感契约 §3/§5/§6.2
 *
 * 四条命门:
 *   1. 角度差是**环**上的差:359° 与 1° 相差 2°(契约 §6.2 点名的口径),
 *      拿线性减法做,正北附近整片都会判成「没对准」;
 *   2. 针走连续轨道:过正北不许倒着绕一圈 —— 观感直接决定玩法可不可信;
 *   3. 判「对准并保持」不判「扫过」:离开容差区保持计时必须归零;
 *      后台限频的那一帧间隔不许白赚时长(dt 夹 0.1s,与 quiethold 同一条);
 *   4. 提交报的是**读数**不是目标值,done 之后不再开表。
 * 外加三处登记的负控:KIT_PRIORITY / TYPE_OF / ACTION_OF 各删一行,必有对应用例真红。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const COMPONENT_PATH = path.join(ROOT, 'pages/play/components/playkit-compass/index.js');
const WXML = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit-compass/index.wxml'), 'utf8');
const WXSS = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit-compass/index.wxss'), 'utf8');
const VIEW_SRC = path.join(ROOT, 'pages/play/utils/playkit-view.js');
const { pickPlayKit, serverAction, serverPayload } = require('../../pages/play/utils/playkit-view.js');

const VIEW_AT = new Date(2026, 8, 22, 12, 0);

// 计时器一律拦下:表的每一拍由测试手动喂(真 setInterval 会把测试进程吊住)
global.setInterval = () => ({ fake: true });
global.clearInterval = () => {};
function compassKit(seg) {
  return pickPlayKit({ sessionId: 1, version: 0, playKit: { compass: seg } }, VIEW_AT);
}

/* —— 组件装载:node 里没有 wx / selectComponent,罗盘帧由测试手动灌。
   properties 并进 data:微信运行时里属性就在 this.data 上,组件代码按真环境写,
   测试宿主必须供成同一个形状,否则「测过了真机却炸」的缝就开在这里。 —— */
function load(arg, options) {
  const isSource = typeof arg === 'string';
  const source = isSource ? arg : null;
  const opts = isSource ? (options || {}) : (arg || {});
  const events = [];
  let definition = null;
  const compassHandlers = [];

  global.Component = (config) => { definition = config; };
  global.wx = {
    onCompassChange(cb) { compassHandlers.push(cb); },
    offCompassChange(cb) { const i = compassHandlers.indexOf(cb); if (i >= 0) compassHandlers.splice(i, 1); },
    stopCompass() {},
    vibrateShort() {},
    getStorageSync: () => '',
  };
  delete require.cache[require.resolve(COMPONENT_PATH)];
  const m = new Module(COMPONENT_PATH, null);
  m.filename = COMPONENT_PATH;
  m.paths = Module._nodeModulePaths(path.dirname(COMPONENT_PATH));
  m._compile(source || fs.readFileSync(COMPONENT_PATH, 'utf8'), COMPONENT_PATH);
  assert.ok(definition, 'playkit-compass 必须注册 Component');

  const props = Object.assign(
    { show: true, kicker: '', target: 135, tolerance: 15, holdSeconds: 3, hint: '', done: false },
    opts.properties || {},
  );
  const stageCalls = [];
  const vm = Object.assign({}, definition.methods, {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data || {})), props),
    properties: props,
  });
  const stage = {
    begin() { stageCalls.push('begin'); if (opts.autoRun !== false) vm.onRun(); },
    win(text) { stageCalls.push(['win', text]); },
    fail(timedOut) { stageCalls.push(['fail', timedOut]); },
  };
  vm.setData = (patch) => Object.assign(vm.data, patch);
  vm.triggerEvent = (name, detail) => events.push({ name, detail });
  vm.selectComponent = () => stage;
  vm.events = events;
  vm.stageCalls = stageCalls;
  vm.compassHandlers = compassHandlers;
  vm.definition = definition;
  vm.pushHeading = (d) => compassHandlers.slice().forEach((cb) => cb({ direction: d }));
  vm.hide = () => definition.pageLifetimes.hide.call(vm);
  return vm;
}

/** 用假时钟把 n 帧 × ms 毫秒喂过去:真时钟下 for 循环里 dt≈0,保持永远攒不满 */
function advance(vm, frames, ms, step) {
  const real = Date.now;
  let t = real();
  Date.now = () => t;
  try {
    for (let i = 0; i < frames; i++) {
      if (step) t += ms; else vm._last = t - ms;
      vm._tick();
    }
  } finally { Date.now = real; }
}

const sourceOf = () => fs.readFileSync(COMPONENT_PATH, 'utf8');

// ==================== 纯算法 ====================

test('angleDiff:环上最短弧 —— 359° 与 1° 相差 2°(契约 §6.2 点名)', () => {
  const vm = load();
  assert.equal(vm._angleDiff(359, 1), 2);
  assert.equal(vm._angleDiff(1, 359), 2);
  assert.equal(vm._angleDiff(0, 180), 180);
  assert.equal(vm._angleDiff(135, 135), 0);
  assert.equal(vm._angleDiff(142, 135), 7);
  assert.equal(vm._angleDiff(-10, 350), 0, '负读数也要归到环上');
});

test('normalize:四舍五入 + 绕回 0–359', () => {
  const vm = load();
  assert.equal(vm._normalize(359.6), 0);
  assert.equal(vm._normalize(-5), 355);
  assert.equal(vm._normalize(720.4), 0);
});

test('continuous:针走短弧,过正北不绕远路', () => {
  const vm = load();
  // 相对角从 358 走到 2:显示值该顺势继续走到 362(往前 4°),而不是倒着扫回 358;
  // 反向同理落在 -2。显示角越过 0/360 无所谓 —— transform 只吃差值
  assert.equal(vm._continuous(2, 358), 362);
  assert.equal(vm._continuous(358, 2), -2);
  assert.equal(vm._continuous(90, null), 90, '第一帧没有上一针,直接落 0–359');
  let needle = vm._continuous(358, 0);
  needle = vm._continuous(2, needle);
  assert.ok(Math.abs(needle) <= 4, '来回过正北,针的总行程仍是小角度,实际:' + needle);
});

test('signedDelta / turnText:往哪边转、还差几度,跨正北也走短弧', () => {
  const vm = load();
  assert.equal(vm._signedDelta(135, 40), 95);
  assert.equal(vm._turnText(vm._signedDelta(135, 40)), '往右转 95°');
  assert.equal(vm._turnText(vm._signedDelta(10, 350)), '往右转 20°', '350° → 10° 是往右 20°,不是往左 340°');
  assert.equal(vm._turnText(vm._signedDelta(350, 10)), '往左转 20°');
  assert.equal(vm._signedDelta(0, 180), -180, '正对背面落在区间 [-180, 180) 的左端');
});

test('读数不稳只认 Android 枚举;iOS 的数字 accuracy 不表精度,不许据此报不稳', () => {
  const vm = load();
  for (const a of ['low', 'unreliable', 'no-contact']) assert.equal(vm._isLowAccuracy(a), true, a);
  for (const a of ['high', 'medium', 30, 0, undefined]) assert.equal(vm._isLowAccuracy(a), false, String(a));
});

test('容差区短棒:±tolerance 每 2.5° 一根,关于对准线对称', () => {
  const vm = load();
  const bars = vm._zoneBars(15);
  assert.equal(bars.length, 13);
  assert.equal(bars[0], -15);
  assert.equal(bars[bars.length - 1], 15);
  assert.ok(bars.includes(0), '对准线正下方必须有一根');
  const odd = vm._zoneBars(12);
  assert.equal(odd[0], -12, '容差 12° 画到 ±12°,不许被 2.5° 步长截成 ±10°');
  assert.equal(odd[odd.length - 1], 12);
});

test('刻度尺:72 格、12 个标签,四个正方位换成方位字', () => {
  const vm = load();
  assert.equal(vm.data.ticks.length, 72);
  assert.equal(vm.data.ticks.filter((t) => t.major).length, 12);
  assert.deepEqual(vm.data.labels.filter((l) => l.cardinal).map((l) => l.text), ['北', '东', '南', '西']);
});

test('小程序渲染层不认 conic-gradient:罗盘的环与弧只许用分段小棒', () => {
  const code = (WXML + WXSS).replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /conic-gradient/, 'conic-gradient 在小程序里渲成实心灰盘');
  assert.match(WXML, /<cy-ring-meter[^>]*percent="\{\{holdPct\}\}"/);
});

// ==================== 组件行为 ====================

test('开跑后一帧读数:刻度盘反转、转向提示、读数不稳提示都跟着这一帧走', () => {
  const vm = load();
  vm.onStart();
  assert.equal(vm.data.hasHeading, false, '还没读数时不画方位字 —— 画了就是假的');
  vm.compassHandlers.slice().forEach((cb) => cb({ direction: 40, accuracy: 'unreliable' }));
  advance(vm, 1, 100);
  assert.equal(vm.data.hasHeading, true);
  assert.equal(vm.data.roseDeg, 320, '刻度盘转 -40°(连续轨道落在 320)');
  assert.equal(vm.data.turnHint, '往右转 95°');
  assert.equal(vm.data.lowAccuracy, true);
  assert.equal(vm.data.aligned, false);
  vm.compassHandlers.slice().forEach((cb) => cb({ direction: 130, accuracy: 'high' }));
  advance(vm, 10, 100);
  assert.equal(vm.data.lowAccuracy, false);
  assert.equal(vm.data.aligned, true);
  assert.ok(vm.data.holdPct > 0 && vm.data.holdPct < 100, '保持进度在走:' + vm.data.holdPct);
  advance(vm, 30, 100);
  assert.equal(vm.data.holdPct, 100, '保持满判过时进度环要走满,不停在九成多');
});

test('开局前不许订阅罗盘;开始 → stage.begin → run 才起表', () => {
  const vm = load();
  assert.equal(vm.compassHandlers.length, 0, '没点开始就订阅 = 表盘在转但玩家以为没开始');
  vm.onStart();
  assert.deepEqual(vm.stageCalls, ['begin']);
  assert.equal(vm.data.phase, 'run');
  assert.equal(vm.compassHandlers.length, 1);
});

test('扫过容差区不算对准:保持计时离开就归零', () => {
  const vm = load();
  vm.onStart();
  vm.pushHeading(140);
  advance(vm, 10, 100, true);          // 区内攒 1 秒
  assert.equal(vm.data.aligned, true);
  vm.pushHeading(200);
  vm._tick();
  assert.equal(vm.data.aligned, false);
  assert.equal(vm._held, 0, '离开容差区的那一刻就该归零');
  vm.pushHeading(140);
  vm._tick();
  assert.ok(vm._held <= 0.11, '重新攒,不能拿之前那 1 秒凑满 3 秒:' + vm._held);
  assert.equal(vm.events.filter((e) => e && e.name === 'submit').length, 0);
});

test('保持满 holdSeconds 才判过:提交报读数、报一次、并让 stage 出胜利屏', () => {
  const vm = load();
  vm.onStart();
  vm.pushHeading(140);                 // 离目标 135 差 5°,容差 15 内
  advance(vm, 40, 100, true);          // 40 × 0.1s ≥ 3s
  const submits = vm.events.filter((e) => e && e.name === 'submit');
  assert.equal(submits.length, 1, '只交一次');
  assert.deepEqual(submits[0].detail, { bearing: 140 }, '报的是读数不是目标值');
  const win = vm.stageCalls.find((c) => Array.isArray(c) && c[0] === 'win');
  assert.ok(win, '对准了要出胜利屏');
  assert.equal(vm._sent, true);
  vm._tick();
  assert.equal(vm.events.filter((e) => e && e.name === 'submit').length, 1);
});

test('后台限频那一帧不许白赚保持时长(dt 夹 0.1s)', () => {
  const vm = load();
  vm.onStart();
  vm.pushHeading(140);
  vm._last = Date.now() - 10000;       // 模拟切后台 10 秒回来
  vm._tick();
  assert.ok(vm._held <= 0.11, '一帧最多记 0.1 秒,实际:' + vm._held);
});

test('设备不报方向:3 秒后明说没数据,不装忙也不判输', () => {
  const vm = load();
  vm.onStart();
  for (let i = 0; i < 29; i++) vm._tick();
  assert.equal(vm.data.noData, false, '不到 3 秒先别急着下结论');
  vm._tick();
  assert.equal(vm.data.noData, true);
  assert.match(WXML, /这台设备还没报出方向/, '这行字必须真的在屏上(死数据闸)');
  assert.equal(vm.events.filter((e) => e && e.name === 'submit').length, 0);
  assert.equal(vm.stageCalls.find((c) => Array.isArray(c) && c[0] === 'fail'), undefined,
    '设备没罗盘不是玩家的错,不判负');
});

test('切后台中止:停订阅、回待命,不留下后台偷跑的口子', () => {
  const vm = load();
  vm.onStart();
  vm.pushHeading(140);
  vm._tick();
  vm.hide();
  assert.equal(vm.data.phase, 'idle');
  assert.equal(vm.compassHandlers.length, 0, 'hide 之后还在收帧 = 后台偷跑保持时长');
});

test('done 的会话:按钮是只读态,点开始不开表', () => {
  const vm = load({ properties: { done: true } });
  vm.onStart();
  assert.equal(vm.data.phase, 'idle');
  assert.equal(vm.compassHandlers.length, 0);
  assert.deepEqual(vm.stageCalls, [], '已经对准过的人不再被拉起来转一遍');
  assert.match(WXML, /你已经对准过这个方向了/);
});

// ==================== 视觉与文案闸 ====================

test('针用 transition 不用 keyframes(契约 §6.1 关键帧只减不增)', () => {
  assert.match(WXSS, /\.cp__arrow\s*\{[^}]*transition: transform/);
  assert.doesNotMatch(WXSS, /@keyframes/, '新组件一个字节的 keyframes 都不许添');
  assert.match(WXSS, /\.cp--rm \.cp__arrow/, '减动效要能钉住针');
  assert.match(WXML, /\{\{rm \? 'cp--rm' : ''\}\}/);
});

test('wxss 不许有标签选择器', () => {
  assert.doesNotMatch(WXSS, /^\s*(view|text|image|button)\s*[,{]/m);
});

test('首屏安全提示与契约钉的文案逐字一致', () => {
  assert.match(WXML, /找个能站稳的地方再开始/);
});

// ==================== 三处登记 + 动作线 + 负控 ====================

test('playkit-view:compass 认型、题面字段齐全、done 谓词', () => {
  const kit = compassKit({
    kicker: '把手机转向钟楼', bearing: 135, tolerance: 20, holdSeconds: 5, hint: '更靠右', done: false,
  });
  assert.equal(kit.type, 'compass');
  assert.equal(kit.bearing, 135);
  assert.equal(kit.tolerance, 20);
  assert.equal(kit.holdSeconds, 5);
  assert.equal(kit.done, false);
  assert.equal(compassKit({ bearing: 135, done: true }).done, true);
  const bare = compassKit({ done: false });
  assert.equal(bare.tolerance, 15, '服务端没给的字段视图层兜底与运行期同值');
  assert.equal(bare.holdSeconds, 3);
});

test('动作线:compass:submit → SUBMIT_COMPASS,payload 只带取整后的 bearing', () => {
  assert.equal(serverAction('compass', 'submit'), 'SUBMIT_COMPASS');
  assert.deepEqual(serverPayload('compass', 'submit', { bearing: 139.4 }), { bearing: 139 });
});

function viewWith(patch) {
  const m = new Module(VIEW_SRC, null);
  m.filename = VIEW_SRC;
  m.paths = Module._nodeModulePaths(path.dirname(VIEW_SRC));
  m._compile(patch, VIEW_SRC);
  return m.exports;
}

test('负控:KIT_PRIORITY 删掉 compass 行,入口必须消失', () => {
  const src = fs.readFileSync(VIEW_SRC, 'utf8');
  const mutated = src.replace("'quietHold', 'compass', 'shout', 'countdown'", "'quietHold', 'shout', 'countdown'");
  assert.notEqual(mutated, src, '变异没打上 = 这把尺子是橡皮图章');
  const kit = viewWith(mutated).pickPlayKit(
    { sessionId: 1, version: 0, playKit: { compass: { bearing: 1, done: false } } }, VIEW_AT);
  assert.equal(kit, null, '漏登记 = 玩法静默不存在 —— 这条必须真红而不是静默通过');
});

test('负控:TYPE_OF 删掉 compass,认型必须落空', () => {
  const src = fs.readFileSync(VIEW_SRC, 'utf8');
  const mutated = src.replace("  compass: 'compass',\n", '');
  assert.notEqual(mutated, src);
  const kit = viewWith(mutated).pickPlayKit(
    { sessionId: 1, version: 0, playKit: { compass: { bearing: 1, done: false } } }, VIEW_AT);
  assert.notEqual(kit && kit.type, 'compass');
});

test('负控:ACTION_OF 删掉 compass:submit 行,动作线必须断', () => {
  const src = fs.readFileSync(VIEW_SRC, 'utf8');
  const mutated = src.replace("  'compass:submit': 'SUBMIT_COMPASS',\n", '');
  assert.notEqual(mutated, src);
  assert.ok(!viewWith(mutated).serverAction('compass', 'submit'),
    '删行后还认得出动作 = 这条负控是摆设');
});

test('分发器两块登记都在:json 注册 + wxml 分支按 kit.type 接上', () => {
  const dispatcherJson = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit/index.json'), 'utf8');
  const dispatcherWxml = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit/index.wxml'), 'utf8');
  assert.match(dispatcherJson, /"cy-playkit-compass":\s*"\/pages\/play\/components\/playkit-compass\/index"/);
  assert.match(dispatcherWxml, /<cy-playkit-compass wx:elif="\{\{kit\.type === 'compass'\}\}"/);
  assert.match(dispatcherWxml, /target="\{\{kit\.bearing\}\}"/, '服务端叫 bearing、组件叫 target,接线处必须对上');
});
