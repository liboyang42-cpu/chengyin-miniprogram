'use strict';

/* playkit-stopwatch · 没停准那一屏要给结论:偏差单列、还剩几次、底部换「再来一局」。
 * 停准了走台面判定屏,这一屏不该出现。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const DIR = path.join(ROOT, 'pages/play/components/playkit-stopwatch');
const COMPONENT_PATH = path.join(DIR, 'index.js');
const WXML = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8');

global.setInterval = () => ({ fake: true });
global.clearInterval = () => {};
global.setTimeout = () => ({ fake: true });

function load(triesLeft) {
  let definition = null;
  global.Component = (config) => { definition = config; };
  global.Behavior = (b) => b;
  global.wx = { vibrateShort() {}, getStorageSync: () => '' };
  delete require.cache[require.resolve(COMPONENT_PATH)];
  const m = new Module(COMPONENT_PATH, null);
  m.filename = COMPONENT_PATH;
  m.paths = Module._nodeModulePaths(DIR);
  m._compile(fs.readFileSync(COMPONENT_PATH, 'utf8'), COMPONENT_PATH);
  const props = { show: true, kicker: '', targetSeconds: 10, toleranceMs: 300, tries: 3 };
  const calls = [];
  const stage = {
    data: { triesLeft },
    miss() { this.data.triesLeft -= 1; return this.data.triesLeft === 0; },
    win(t) { calls.push(['win', t]); },
    fail() { calls.push(['fail']); },
  };
  const vm = Object.assign({}, definition.methods, {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), props),
    properties: props,
  });
  vm.setData = (patch) => Object.assign(vm.data, patch);
  vm.triggerEvent = () => {};
  vm.selectComponent = () => stage;
  vm.calls = calls;
  return vm;
}

function stopAt(vm, elapsedMs) {
  vm.onRun();
  const real = Date.now;
  vm._t0 = real() - elapsedMs;
  vm.onStop();
}

test('没停准还有机会:phase=over,偏差单列,还剩次数取自台面', () => {
  const vm = load(3);
  stopAt(vm, 7600);
  assert.equal(vm.data.phase, 'over');
  assert.match(vm.data.dev, /^早 2\.\d\d 秒$/);
  assert.equal(vm.data.left, 2);
  assert.deepEqual(vm.calls, [], '没停准且还有机会,不出判定屏');
});

test('负控:停准了不进 over,走台面胜利屏', () => {
  const vm = load(3);
  stopAt(vm, 10000);
  assert.notEqual(vm.data.phase, 'over');
  assert.equal(vm.calls[0][0], 'win');
});

test('over 屏:结论 + 「再来一局」按钮替掉计时条,按钮接的是 onStop(开下一局)', () => {
  assert.match(WXML, /wx:if="\{\{phase === 'over'\}\}"><view class="sw__miss-i"><cy-icon name="close-sm" size="28" \/><\/view>没停准/);
  assert.match(WXML, /<view class="sw__foot" wx:if="\{\{phase === 'over'\}\}">[\s\S]*?bindtap="onStop"[\s\S]*?再来一局/);
  assert.match(WXML, /<view class="sw__bar" wx:else>/, '计时条只在非 over 时出现');
  assert.match(WXML, /<cy-play-stage[^>]*skin="glass"/, '浅色玻璃屏要给台面浅色皮肤,否则还能错 / 倒数是暗版');
});
