'use strict';

/* playkit-shout · 喊一嗓子 · 现场感契约 §4
 *
 * 四条命门:
 *   1. 电平算法必须来自共享的 play-audio-level —— 与 quietHold 同一把尺,
 *      两处各养一份的话「同一嗓子一个赢一个输」迟早出现;
 *   2. 「持续」是真持续:掉线清零,不许攒着喊 —— 这是 shout 与 quietHold
 *      判定方向之外最大的差别(那边过线即死,这边掉线即归零);
 *   3. 录音不上传不落盘:组件里不许出现任何 wx.uploadFile / 保存路径,
 *      提交只交一个 heldMs,服务端按服务器时间复核;
 *   4. 拿不到麦克风就明说 —— 不假装在听(micdenied 事件线)。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const COMPONENT_PATH = path.join(ROOT, 'pages/play/components/playkit-shout/index.js');
const WXML = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit-shout/index.wxml'), 'utf8');
const WXSS = fs.readFileSync(path.join(ROOT, 'pages/play/components/playkit-shout/index.wxss'), 'utf8');
const SOURCE = fs.readFileSync(COMPONENT_PATH, 'utf8');

// 组件里的 setInterval 由测试手动喂拍,别让 node 事件循环真挂着表
global.setInterval = () => ({ fake: true });
global.clearInterval = () => {};

function pcmPeak(x) {
  const buf = new Int16Array(4);
  buf[0] = Math.round(x * 32768);
  return buf.buffer;
}

function load(source) {
  const events = [];
  let definition = null;
  let frameCb = null;
  let errCb = null;
  let tickFn = null;

  // 定时器不真挂事件循环,只把回调抓出来手动喂拍(onRun 只许调一次,
  // 重调会把 _held 清零、把 start 事件翻倍 —— 那是要测的行为,不是脚手架)
  global.setInterval = (fn) => { tickFn = fn; return { fake: true }; };
  global.clearInterval = () => {};

  global.Component = (config) => { definition = config; };
  global.wx = {
    getRecorderManager() {
      return {
        onFrameRecorded(cb) { frameCb = cb; },
        onError(cb) { errCb = cb; },
        start(o) { events.push('rec.start:' + (o && o.format)); },
        stop() { events.push('rec.stop'); },
      };
    },
    vibrateShort() {},
    showToast() {},
    getStorageSync: () => '',
  };

  delete require.cache[require.resolve(COMPONENT_PATH)];
  const m = new Module(COMPONENT_PATH, null);
  m.filename = COMPONENT_PATH;
  m.paths = Module._nodeModulePaths(path.dirname(COMPONENT_PATH));
  m._compile(source || SOURCE, COMPONENT_PATH);
  assert.ok(definition, 'playkit-shout 必须注册 Component');

  const stageCalls = [];
  const vm = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    properties: { show: true, kicker: '喊出来', seconds: 5 },
  });
  Object.assign(vm.data, vm.properties);
  vm.setData = (patch) => Object.assign(vm.data, patch);
  vm.triggerEvent = (name, detail) => events.push({ name, detail });
  vm.selectComponent = () => ({
    begin() { stageCalls.push('begin'); },
    win(t) { stageCalls.push('win:' + t); },
    fail(t) { stageCalls.push('fail:' + t); },
  });
  vm.events = events;
  vm.stageCalls = stageCalls;
  vm.frame = (x) => frameCb && frameCb({ frameBuffer: pcmPeak(x) });
  vm.micError = () => errCb && errCb({});
  vm.tick = () => {
    if (!tickFn) throw new Error('表还没开:先 onRun() 再喂拍');
    tickFn();
  };
  vm.definition = definition;
  return vm;
}

/** 手动喂 n 拍定时器(每拍 stepMs 毫秒真实时间,source 在每一拍前送帧) */
function advance(vm, ticks, stepMs, source) {
  const realNow = Date.now;
  let now = vm._last == null ? Date.now() : vm._last;
  Date.now = () => now;
  try {
    for (let i = 0; i < ticks; i++) {
      now += stepMs;
      if (source) source(i);
      vm.tick();
    }
  } finally {
    Date.now = realNow;
  }
}

test('电平算法走共享模块:组件里不许留第二份尺', () => {
  assert.match(SOURCE, /require\('\.\.\/\.\.\/utils\/play-audio-level\.js'\)/);
  assert.ok(!/function peakOf\(/.test(SOURCE) && !/function baseline\(/.test(SOURCE),
    '契约 §4.2:九成基建在 quietHold,继承的方式是 require,不是复制');
});

test('新壳不许用 Behavior(§6.1):减动效走 motion-preference', () => {
  assert.ok(!/behaviors:/.test(SOURCE), 'node 夹具里没有全局 Behavior,新壳照 compass 的路子');
  assert.match(SOURCE, /readReducedMotion/);
});

test('开跑先开表:submit 之前必有 start 事件(成绩按服务器时间复核)', () => {
  const vm = load();
  vm.onStart();
  assert.deepEqual(vm.stageCalls, ['begin'], '校准屏由 stage 出');
  assert.ok(vm.events.includes('rec.start:PCM'), '采样链路是 PCM 逐帧,与 quietHold 同参数');
  vm.onCalibrated();
  vm.onRun();
  const names = vm.events.filter((e) => e && e.name).map((e) => e.name);
  assert.deepEqual(names, ['start']);
});

test('校准:2 秒采样取 80 分位当底噪,线 = thresholds 的红档', () => {
  const vm = load();
  vm.onStart();
  const level = require('../../pages/play/utils/play-audio-level.js');
  for (let i = 0; i < 20; i++) { vm.frame(0.05); vm.onSample(); }
  vm.frame(0.9); vm.onSample();   // 校准期混进一声大的,不许抬走底噪
  vm.onCalibrated();
  const expect = level.thresholds(level.baseline(Array(20).fill(0.05).concat([0.9])));
  assert.equal(vm._mid, expect.mid);
  assert.equal(vm._hot, expect.hot);
});

test('持续是真持续:过线累计,掉线清零,攒着喊不算', () => {
  const vm = load();
  vm.onStart();
  for (let i = 0; i < 20; i++) { vm.frame(0.05); vm.onSample(); }
  vm.onCalibrated();
  vm.onRun();
  const hot = vm._hot + 0.05;

  // 过 2 秒(20 拍 × 100ms),掉线 1 拍,再过 2 秒 —— 若不清零会凑成 4 秒假胜
  advance(vm, 20, 100, () => vm.frame(hot));
  assert.equal(vm.data.loud, true, '过线时 loud 亮,屏上「过线了，别停」');
  advance(vm, 1, 100, () => vm.frame(0.01));
  assert.equal(vm.data.loud, false);
  assert.equal(vm._held, 0, '掉线那一拍必须把攒的秒数清零');
  advance(vm, 19, 100, () => vm.frame(hot));
  assert.ok(vm._held > 1.5 && vm._held < 2.5, '2+2 拍过线只认最近一段:实得 ' + vm._held);
});

test('喊满秒数:判一次,交的是 submit + { heldMs },并且停表停麦', () => {
  const vm = load();
  vm.onStart();
  for (let i = 0; i < 20; i++) { vm.frame(0.05); vm.onSample(); }
  vm.onCalibrated();
  vm.onRun();
  const hot = vm._hot + 0.05;
  advance(vm, 52, 100, () => vm.frame(hot));   // 5.2 秒,过线即胜
  const submits = vm.events.filter((e) => e && e.name === 'submit');
  assert.equal(submits.length, 1, '判过之后表已停,不许再交第二次');
  assert.ok(submits[0].detail.heldMs >= 5000 && submits[0].detail.heldMs <= 5300,
    'payload 只有毫秒数:实得 ' + JSON.stringify(submits[0].detail));
  assert.ok(vm.events.includes('rec.stop'), '用完即弃:停麦');
  assert.match(vm.stageCalls.join('|'), /整整 5 秒，声音没掉下去/);
});

test('一帧最多记 0.1 秒:后台限频回来的大间隔不送分', () => {
  const vm = load();
  vm.onStart();
  for (let i = 0; i < 20; i++) { vm.frame(0.05); vm.onSample(); }
  vm.onCalibrated();
  vm.onRun();
  const hot = vm._hot + 0.05;
  advance(vm, 3, 5000, () => vm.frame(hot));   // 三拍各隔 5 秒
  assert.ok(vm._held <= 0.31, '3 拍最多记 0.3 秒,不许一次送 15 秒:实得 ' + vm._held);
});

test('拿不到麦克风就明说:micdenied 事件 + 停表,不假装在听', () => {
  const vm = load();
  vm.onStart();
  vm.onCalibrated();
  vm.onRun();
  vm.micError();
  assert.ok(vm.events.some((e) => e && e.name === 'micdenied'));
  assert.equal(vm.data.running, false);
});

test('切后台中止:表停麦停,回来不许接着攒', () => {
  const vm = load();
  vm.onStart();
  for (let i = 0; i < 20; i++) { vm.frame(0.05); vm.onSample(); }
  vm.onCalibrated();
  vm.onRun();
  const hot = vm._hot + 0.05;
  advance(vm, 10, 100, () => vm.frame(hot));
  const hide = vm.definition.pageLifetimes.hide;
  hide.call(vm);
  assert.equal(vm.data.running, false);
  assert.ok(vm.events.includes('rec.stop'));
});

test('文案全角逗号:胜利句与过线句钉死', () => {
  assert.match(SOURCE, /整整 ' \+ this\.data\.seconds \+ ' 秒，声音没掉下去/);
  assert.match(WXML, /过线了，别停/);
});

test('wxss:只有 transition 没有 keyframes,无 tag 选择器', () => {
  assert.ok(!/@keyframes/.test(WXSS), '契约 §6.1 关键帧只减不增');
  assert.match(WXSS, /transition: background/);
  assert.ok(!/(^|\})\s*(view|text|button)\s*\{/.test(WXSS));
});

test('负控:删掉掉线清零那一行,上一条「持续」必须真红', () => {
  const mutated = SOURCE.replace('else this._held = 0;', 'else void 0;');
  assert.notEqual(mutated, SOURCE, '变异没打上 = 这把尺子是橡皮图章');
  const vm = load(mutated);
  vm.onStart();
  for (let i = 0; i < 20; i++) { vm.frame(0.05); vm.onSample(); }
  vm.onCalibrated();
  vm.onRun();
  const hot = vm._hot + 0.05;
  advance(vm, 20, 100, () => vm.frame(hot));
  advance(vm, 1, 100, () => vm.frame(0.01));
  advance(vm, 19, 100, () => vm.frame(hot));
  assert.ok(vm._held > 3.5,
    '去掉清零后 2+2 秒被攒成 4 秒 —— 所以「持续」必须靠这一行成立:实得 ' + vm._held);
});
