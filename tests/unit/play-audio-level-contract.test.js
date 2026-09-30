'use strict';

/* play-audio-level · 现场感契约 §5.1(S3a 纯重构闸)
 *
 * 这一抽的验收标准只有一条:quiethold 的行为逐字不变。
 * 所以这里钉的全是**旧文件里的原话口径** —— 80 分位、两个夹逼区间、
 * 峰值不判均值、拿不到数据给 0 不猜。shout(S3b)将 require 同一个模块,
 * 谁要是想给某个玩法单独调线,必须在这里改并想清楚另一个玩法跟不跟。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const MODULE_PATH = path.join(ROOT, 'pages/play/utils/play-audio-level.js');
const QUIETHOLD_JS = path.join(ROOT, 'pages/play/components/playkit-quiethold/index.js');
const level = require('../../pages/play/utils/play-audio-level.js');

function pcm(values) {
  const buf = new Int16Array(values.length);
  values.forEach((v, i) => { buf[i] = v; });
  return buf.buffer;
}

test('peakOf:取峰值不取均值,负样本按绝对值算', () => {
  assert.equal(level.peakOf(pcm([100, -16384, 200])), 0.5,
    '一声咳嗽(半量程)不能被周围的小样本摊平');
  assert.equal(level.peakOf(pcm([0, 0, 0])), 0);
  assert.equal(level.peakOf(null), 0, '拿不到数据给 0,不猜');
  assert.equal(level.peakOf(new ArrayBuffer(0)), 0);
});

test('baseline:80 分位而不是最大值;空样本给保守低值 0.06', () => {
  const samples = [0.01, 0.02, 0.02, 0.03, 0.03, 0.04, 0.05, 0.06, 0.07, 0.9];
  assert.equal(level.baseline(samples), 0.07,
    '校准那两秒里的一声咳嗽(0.9)不许把底噪抬到天上');
  assert.equal(level.baseline([]), 0.06);
  assert.equal(level.baseline(null), 0.06);
});

test('thresholds:黄线 = 底噪+0.06 夹在 [0.12, 0.5];红线 = 黄线+0.09 封顶 0.72', () => {
  assert.deepEqual(level.thresholds(0.2), { mid: 0.26, hot: 0.35 });
  assert.deepEqual(level.thresholds(0), { mid: 0.12, hot: 0.21 }, '极静场所也有下限线,不然呼吸都算出声');
  assert.deepEqual(level.thresholds(0.9), { mid: 0.5, hot: 0.59 }, '极吵场所线封顶,不然永远「过不了」');
});

test('bandOf:边界值本身不算过线(> 才是),hot 优先于 mid', () => {
  assert.equal(level.bandOf(0.26, 0.26, 0.35), 'ok');
  assert.equal(level.bandOf(0.27, 0.26, 0.35), 'mid');
  assert.equal(level.bandOf(0.35, 0.26, 0.35), 'mid');
  assert.equal(level.bandOf(0.36, 0.26, 0.35), 'hot');
});

test('quiethold 改为 require 本模块:组件里不再自带算法副本', () => {
  const src = fs.readFileSync(QUIETHOLD_JS, 'utf8');
  assert.match(src, /require\('\.\.\/\.\.\/utils\/play-audio-level\.js'\)/,
    'quiethold 必须走共享模块 —— 两处各一份是这次重构要消灭的东西');
  assert.ok(!/function peakOf\(/.test(src), '组件里不许再留一份 peakOf');
  assert.ok(!/function baseline\(/.test(src), '组件里不许再留一份 baseline');
  // 单测出口三个别名还在原位:老测试与未来回归都从组件上拿
  assert.match(src, /_baseline: baseline/);
  assert.match(src, /_peakOf: peakOf/);
});

test('负控:把 80 分位改成取最大值,上面的咳嗽用例必须真红', () => {
  const mutated = fs.readFileSync(MODULE_PATH, 'utf8')
    .replace('return list[Math.floor(list.length * 0.8)] || 0.06;', 'return list[list.length - 1] || 0.06;');
  assert.notEqual(mutated, fs.readFileSync(MODULE_PATH, 'utf8'), '变异没打上 = 这把尺子是橡皮图章');
  const m = new (require('node:module').Module)(MODULE_PATH, null);
  m.filename = MODULE_PATH;
  m._compile(mutated, MODULE_PATH);
  assert.equal(m.exports.baseline([0.01, 0.02, 0.03, 0.9]), 0.9,
    '取最大值时一次咳嗽就抬走整条线 —— 所以旧实现选的是 80 分位');
});
